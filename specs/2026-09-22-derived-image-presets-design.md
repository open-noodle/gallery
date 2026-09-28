# Derived Image Presets

**Decided:** 2026-09-22 · **Config:** `image.presets` · **Endpoint:** `GET /assets/:id/thumbnail?preset=&width=`

## Problem

Every generated image in Gallery keeps the source photo's aspect ratio. `thumbnail` and `preview` are
made with `resize(size, size, { fit: 'outside' })`: the shorter edge lands on `size`, the longer edge
follows. A 3:2 photo stays 3:2. That is right for a photo library and wrong for anything that embeds
photos in a layout — a blog hero that must be 1600×900, a card grid that wants squares, a `srcset`
that needs the same crop at five widths. Today a site doing this has to download the preview and run
its own image pipeline, which means a second copy of every photo it uses and a second place where the
crop can go stale.

The three existing variant slots are also fixed by an enum (`AssetFileType`) and by a unique key on
`asset_file (assetId, type, isEdited)`; there is no room in that table for "one more size", let alone
an admin-defined set of them.

## Decision

A **preset** is an aspect ratio plus the list of widths a client may request. Height is derived, so a
preset yields exact dimensions no matter what the source looks like. Presets live in system config and
default to none:

```yaml
image:
  presets:
    landscape: { aspectRatio: '16:9', widths: [1600, 1280, 960, 640, 320] }
    square: { aspectRatio: '1:1', widths: [1024, 768, 640, 320], position: attention }
```

Each preset may also set `position` (`center` | `attention` | `entropy`, sharp's cover strategies;
default `center`), `format` (default `webp`) and `quality` (default 80). Names are lowercase slugs
because they appear in URLs and filenames.

Variants are **rendered on demand and cached**, never pre-generated. The alternatives were weighed and
rejected in the design conversation:

| Option                     | Why not                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Pre-generate for every asset | 9 extra files per photo for every photo, whether or not a page ever uses it; a full regeneration when a preset changes. |
| Pre-generate for a scope   | Needs album/space/tag scoping and a job trigger on scope entry/exit for a saving the lazy path gets for free.             |
| Pad instead of crop        | Hero images with bars are unusable.                                                                                       |
| Scale the long edge only   | "1600×900" would not actually be a guarantee.                                                                             |

## Request path

```
GET /assets/{id}/thumbnail?preset=landscape&width=1280[&edited=true]
```

The endpoint is the existing one. When `preset` (or `width`) is present, `size` is ignored and
`AssetMediaService.viewDerivedImage` takes over; without them the code path is byte-for-byte upstream.
Reusing the endpoint means the generated SDKs gain two optional query fields and nothing else, and every
existing rule — `Permission.AssetView`, API keys, shared links (which force `edited=true` and hide the
original file name when `showExif` is off) — applies unchanged.

Validation is strict on purpose: `preset` must exist in config **and** `width` must be one of that
preset's widths, or the request is `400`. Anything else would let a client fill the cache with
arbitrary sizes.

```
validate (preset, width) against config
→ asset_derived_file lookup on (assetId, preset, width, isEdited)
→ hit:  serve the path
→ miss: pick source → render to <dir>/<uuid>.tmp → rename into place → upsert row → serve
```

### Source selection (`selectDerivedImageSource`)

Cheapest source that will not upscale wins:

1. the **preview**, when its estimated dimensions cover the target. Cover scales by
   `max(W/srcW, H/srcH)`, which is ≤ 1 exactly when both `srcW ≥ W` and `srcH ≥ H`. The preview's
   dimensions are estimated from EXIF width/height (orientation-corrected) and `image.preview.size`,
   since `asset_file` does not store them;
2. the **fullsize** file, when one exists (RAW/HEIC conversions, or fullsize generation enabled);
3. the **original**, when the asset is an image sharp can decode (`mimeTypes.isWebSupportedImage`);
4. otherwise the preview anyway, accepting enlargement — a soft hero beats a 404.

`edited=true` prefers the edited generated files and never falls back to the untouched original, because
the edit only exists in those files. A video always renders from its preview frame.

For the responsive package that motivated this — 16:9 at 1600 and below from typical 3:2 camera
output — the 1440p preview covers every width, so no original is ever decoded. A 1600-wide 16:9 hero
from a portrait photo is the case that reaches the original.

### Rendering (`MediaRepository.generateDerivedImage`)

One sharp call on the shared decode pipeline (rotation, colorspace, ICC handling reused as-is):
`resize(width, height, { fit: 'cover', position })` then `toFormat`. `position` is passed straight
through, which is what leaves room for a face-aware strategy later without changing the config shape.
Height is `round(width × H / W)` snapped to an even number: chroma-subsampled encoders want even
dimensions, and 16:9 at every common width is an integer anyway.

The output is written to a temp file in the target directory and renamed into place, so a concurrent
reader never sees a partial file. Two simultaneous first requests both render and both rename; the
second `upsert` wins and the cost is one duplicated render. No lock.

### Storage

Path: `thumbs/<ownerId>/<xx>/<yy>/<assetId>_<preset>_<width>[_edited].<ext>` — the same nested scheme
as thumbnails, so the fork's opt-in storage accounting (`storageUsage.includeDerivatives`) counts
them, and the S3 write backend is handled by the same `persistFile` step the thumbnail job uses
(moved from `MediaService` to `BaseService` for that reason).

## Persistence

```
asset_derived_file (id, assetId → asset CASCADE, createdAt, preset, width, height, isEdited, path)
UNIQUE (assetId, preset, width, isEdited)
```

Not shoehorned into `asset_file`: its unique key is `(assetId, type, isEdited)`, `type` is an enum, and
the thumbnail job owns those rows end to end (`syncFiles` deletes anything it did not just write).
Derived rows are written by the serve path and are a cache index, not a record of truth — losing the
table loses nothing that a request cannot recreate.

Migration `1793000000000-AddAssetDerivedFile` lives in `migrations-gallery/` like every fork migration;
`scripts/revert-to-immich.sql` drops the table and forgets the migration.

## Lifecycle

| Event                                        | What happens                                                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Asset deleted                                | Rows cascade. `handleAssetDeletion` reads the paths **before** `remove()` and adds them to the `FileDelete` job.           |
| Thumbnails regenerated (edit, new preview size, RAW re-extract) | `handleGenerateThumbnails` drops the asset's derived rows after `syncFiles` and queues the files. Next request re-renders. |
| Preset or width removed from config          | Nightly `AssetDerivedFileCleanup` (in the `databaseCleanup` group) deletes rows whose `(preset, width)` is no longer configured, 1000 at a time, and queues the files. Nothing is eager. |
| Preset added                                 | Nothing. The first request renders.                                                                                       |

## What this does not do

- **Face-aware cropping.** `position` is an enum with room for it; faces are already detected and
  stored, so a `faces` strategy could crop to keep them in frame and fall back to `attention`.
- **Pre-generation.** Deliberately. If a deployment wants warm caches it can request the variants after
  upload from its own side.
- **Mobile.** The Dart client gains the two optional fields from the OpenAPI regen and uses neither.

## Testing

- `utils/image-preset.spec.ts` — pure functions: patterns, ratio parsing, height derivation
  (including the even-rounding and the whole 16:9/1:1 package), preset/width validation, the
  cover-without-enlargement rule, preview dimension estimation, orientation swap, and every branch of
  source selection.
- `asset-media.service.spec.ts` — the serve path: 400s, cache hit skips rendering, cache miss renders
  with the right dimensions/position/format and passes `.tmp` → rename → upsert → serve, `edited`
  handling, orientation only for originals, temp cleanup on failure, 404 without a source, shared-link
  file naming.
- `media.repository.spec.ts` — real sharp: exact output dimensions for landscape and square, and a
  three-band image proving the centre crop keeps only the middle band (crop, not letterbox).
- `media.service.spec.ts` — invalidation on regeneration; the cleanup job batching and the
  empty-config-means-everything-stale case.
- `asset.service.spec.ts` — derived paths are read before the cascade and land in `FileDelete`.
- `system-config.service.spec.ts` — empty default, defaults filled in, and rejections for a malformed
  ratio, a zero side, duplicate/empty widths and a non-slug name (each with a `[path] message` an admin
  can act on).
- `ImageSettings.spec.ts` — the admin card: empty state, render, add with defaults, slug/duplicate
  refusal, widths text folding (junk and duplicates dropped), inline validation, removal, config-file
  lock.
- `e2e asset.e2e-spec.ts` — end to end against a real stack: exact dimensions and format, cache
  stability, square crop, GPS stripped, 400 on bad width/preset, 401 unauthenticated.
