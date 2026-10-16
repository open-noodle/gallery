# Adjust tool: exposure, contrast, saturation, invert

## Summary

The image editor gains colour adjustments next to crop, rotate and mirror: exposure, contrast and saturation
(-100..100, 0 = unchanged) and an invert switch for scanned film negatives. Like the other edits they are stored as
parameters and rendered into the asset's edited thumbnails, so the original file is never modified and the adjustment
can be undone in the app. A downloaded or re-uploaded copy is a flat file with the adjustment baked in.

The editor shows the controls inside the Transform tool: a toggle below Orientation switches between the sliders
(Edit, the default) and Immich's aspect-ratio grid (Crop). Both belong to one Save.

## Roadmap

- **v1 (web)**: exposure, contrast, saturation, invert.
- **v2 (web)**: highlights/shadows curve, sharpness, masking, each only if it works out. None has a CSS filter
  equivalent, so v2 needs its own preview design.
- **v3 (mobile)**: not scoped. Until then the mobile app shows adjusted photos (its thumbnails are the server's edited
  ones) and keeps the adjustment when it crops, rotates, mirrors or reverts a photo, but cannot change it.

## Storage: a side table, not an `asset_edit` action

The adjustment lives in `asset_image_adjust` (one row per asset, `assetId` primary key, cascade with the asset),
behind `GET/PUT/DELETE /assets/{id}/adjust` in `GalleryAssetController`. It is **not** an `adjust` action in
Immich's `asset_edit`. The first version of this PR (#1124) did that, and the review rejected it:

1. **Every installed app breaks on it.** `asset_edit` rows reach the mobile app through the `AssetEditsV1` sync
   stream. The generated Dart `AssetEditAction.fromJson` returns null for an unknown value, the non-null assertion in
   `SyncAssetEditV1.fromJson` throws, the whole batch fails and is never acknowledged, and every retry replays it.
   Stock Immich apps and every Gallery app released before the change (5.7.x, 5.8.0, 5.9.0-rc.0) have no `adjust`.
   The version gate the first version added let all of those through; a gate keyed to a future release number is
   fragile by nature.
2. **The mobile editor would delete it.** Mobile maps unknown actions to `other` and filters them out before the
   editor opens, then saves with `replaceAll()`, a full replace. Preserving the row needed User-Agent sniffing in
   `AssetService.editAsset`/`removeAssetEdits`, auth-session fields and a client-capability module: new logic in
   upstream files.
3. **It breaks the layering rules** (CLAUDE.md, "Gallery sits on top of Immich"): Immich's tables keep Immich's
   meaning (rule 1), switching back stays safe (rule 3), upstream files carry hooks, not logic (rule 5). Video trims
   left `asset_edit` for `asset_video_trim` in wave 3 (#1186) for the same reasons; this follows that precedent.

With the side table, `asset_edit` and its sync stream stay upstream-shaped, so no client sees anything new; the mobile
editor's full replace of `asset_edit` cannot touch the adjustment; and no request classification is needed.

`1799000000000-AddAssetImageAdjustTable` creates the table and moves any `adjust` row a pre-release build wrote into
it. Its `down()` cannot move the values anywhere an older Gallery could read, so it drops the adjusted files and clears
the thumbhash, and the missing-thumbnails job regenerates them from `asset_edit` alone. `scripts/revert-to-immich.sql`
does the same before dropping the table; the revert CI job seeds an adjusted photo and checks both.

## `isEdited`

The adjusted thumbnails are the asset's edited ones, so `asset.isEdited` must be true while an adjustment exists.
`ImageAdjustRepository.upsert` sets it; `delete` clears it only when no `asset_edit` row and no trim remains.
Immich's `asset_edit_delete` trigger clears it when the last crop/rotate/mirror goes, unaware of the adjustment, so
the edit job (`MediaService.generateEditedThumbnails`) reads the adjustment through `getForRender`, which calls `markEdited`. A trigger
was rejected: it would add a fork trigger, `migration_overrides` rows and parity specs to an upstream table, and the
edit job runs after every edit change anyway.

## Rendering

`applyImageAdjust` (`server/src/gallery/utils/image-adjust.ts`) renders exactly what the browser previews with
`imageAdjustFilter` (`web/src/lib/gallery/edit/image-adjust.ts`): the CSS filter list
`saturate() invert() brightness() contrast()`, each function as the Filter Effects spec defines it.

- **Clamping between steps.** Browsers clamp each filter function's output to the colour range before the next one
  runs. The first version folded exposure and contrast into one `sharp().linear(a, b)` call, which does not: exposure
  +100 then contrast -50 turned red 199 into 255 on the server and 191 in the browser. Measured in headless Chromium,
  the per-step implementation now matches the preview within ±1 for that case and a combined edit.
- **Plain arithmetic, not sharp.** `linear`, `recomb` and `negate` are single option slots libvips applies in a fixed
  order with no clamping between them (and `recomb` then `negate` produced black), so the function walks the raw
  buffer: one lookup table when saturation is unchanged, the `saturate()` matrix per pixel otherwise. 8-bit and 16-bit
  buffers are handled; alpha is left untouched.
- **Encoded values, after geometry.** Since Immich v3.3, `MediaRepository.transform()` applies crop/rotate/mirror and
  the resize in linear-light scRGB. The CSS functions are defined on encoded values, so the adjustment runs on that
  pass's output (one hook in `transform()`, fed by an `adjust` field on `TransformOptions`), as the browser filters
  the scaled image on screen. The scRGB pass flags its output premultiplied while returning straight alpha; the
  function reads it as straight alpha.
- **Invert first.** On a film negative the user wants exposure and contrast to act on the positive they see, so invert
  runs before them: a negative exposure darkens.

Only the edited outputs get the adjustment (`generateImageThumbnails` passes it when `useEdits`), including the
thumbhash; the original thumbnails stay unadjusted.

## Web client

All fork code is in `web/src/lib/gallery/edit/`:

- `ImageAdjustManager` holds the slider state and the server's value, loads it on activation and saves it with
  `PUT` (or `DELETE` once everything is neutral). `hasChanges` compares against the loaded value, so loading counts
  as no change.
- `withImageAdjust(transformManager)` wraps the transform tool's manager in `EditManager.tools` (the only upstream
  change in `edit-manager.svelte.ts`). Changes, reset and the discard prompt cover both; its `save` writes the
  adjustment first and, if crop/rotate/mirror changed too, waits for that edit job's `AssetEditReadyV2` before saving
  them, so two edit jobs never render the same asset at once (the editor queue runs two jobs concurrently). Whether
  crop/rotate/mirror changed is judged against the edits the tool opened with, because Immich's "Reset changes" does
  not set the transform tool's `hasChanges`.
- `AdjustPanel.svelte` renders the Edit/Crop toggle and the sliders (double-click resets one) and the invert `Switch`.
  `TransformTool.svelte` renders it in place of the Crop heading and hides the aspect-ratio grid in Edit;
  `CropArea.svelte` applies the CSS filter to the preview image and hides the crop overlay and frame in Edit (hidden,
  not unmounted, because `draw()` keeps writing the frame's position).

## Testing

- Server unit: `image-adjust.spec.ts` (each function, clamping order, browser-measured values, alpha, grey, 16-bit),
  `image-adjust.media.spec.ts` (through sharp: P3 decode, straight alpha, after crop, thumbhash),
  `image-adjust-thumbnails.spec.ts` (edit job with and without other edits, originals unadjusted), `gallery-asset.service.spec.ts` and
  the controller spec (validation, neutral values remove, the images Immich refuses to edit, space-edit logging).
- Server medium: the repository's `isEdited` rules against a real database, the migration's up/down, schema drift.
- Web unit: the manager and the wrapper's save sequencing, including "Reset changes".
- Revert CI: an adjusted photo survives the stock Immich trial and is cleaned by the revert.
- Manual: headless Chromium against a local stack: preview vs saved pixels, combined rotate + adjust save, reset,
  discard prompt, and a mobile user agent cropping and reverting an adjusted photo.
