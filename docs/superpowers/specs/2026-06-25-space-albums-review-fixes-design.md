# Space Albums — Review-Fix Spec

## Summary

A fan-out review of the shipped **space albums** feature (link albums by-reference into a shared
space; design: `docs/superpowers/specs/2026-06-09-space-albums-design.md`) found the security core
correct and well-tested, but surfaced **9 concrete, TDD-fixable defects**. This spec defines each as
a behavior to pin with a failing test, then fix. The implementation plan
(`docs/superpowers/plans/2026-06-25-space-albums-review-fixes.md`) slices them 1:1.

The unifying theme for the product vision ("a full Immich experience per space — its own people, its
own albums") is **Group B below**: album-linked assets are first-class in the space _timeline_ and
_access_, but not yet in _people / tags / folders / memories / search filters_ inside a space.

## Findings (verified against code)

### Group A — Security / correctness

- **A1 — Trashed album still grants asset read.** The asset-level read predicates join
  `shared_space_album → album_asset → asset` and filter only `asset.deletedAt`, never
  `album.deletedAt`. The album-_level_ predicates (`access.repository.ts:151,172`) and the sync
  helper _do_ filter it. A soft-deleted album's photos stay readable to space members (and counted)
  until hard-delete, while the listing UI hides the album. Affected branches:
  `access.repository.ts:305,375`, `asset.repository.ts:320,360,1385,1423`,
  `map.repository.ts:129,175`, `utils/database.ts:630,657`, and the count at
  `shared-space.repository.ts:262`.
- **A2 — Removing a direct-added asset strips its space faces even when it survives via a linked
  album/library.** `shared-space.service.ts:780` (`removeAssets`) calls `removePersonFacesByAssetIds`
  unconditionally — no `getAssetIdsWithoutOtherSpacePath` guard, unlike `unlinkAlbum` (`:670`) and
  `onAlbumAssetsRemove` (`:2813`).
- **A3 — Deleting a linked album runs no space face-cleanup.** `album.service.ts:192-195`
  (`delete()`) emits no event; the FK cascade drops the link/grant rows but leaves orphaned
  `shared_space_person_face` rows for album-only assets. Spec line 373 requires cleanup here.

### Group B — "Full experience per space" read-surface gaps

- **B1 — Person/face read** (`access.repository.ts:677-721`, `checkSharedSpaceAccess` →
  `Permission.PersonRead`) has `shared_space_asset` + `shared_space_library` branches but **no album
  branch**. A person whose faces are only on album-linked assets is not readable by members → "its
  own people" breaks for album-sourced faces.
- **B2 — Tag / folder / memory / search-suggestion** read surfaces each have the `shared_space_library`
  branch but no album branch: `tag.repository.ts:104`, `view-repository.ts:69`,
  `memory.repository.ts:86`, `search.repository.ts:1110,1129,1210,1234,1253`. Album-only tags,
  folders, memories, and filter-dropdown values are invisible inside a space.

### Group C — Consistency / sync

- **C1 — Phase-2 grant backfill — DROPPED (not needed).** Initially flagged as "the create-side
  triggers install no standalone backfill (the library blueprint has one)." On reflection this does
  **not** apply to albums: orphan grants can only exist if `shared_space_album` rows were created on
  a DB **before** the `1779100000000` triggers were applied to it — i.e. a staged Phase-1-then-Phase-2
  deployment. This feature ships as one unit (table + triggers in the same release; never released at
  a Phase-1-only state), so on every real deploy the triggers exist before any album can be linked →
  no orphans. The library blueprint needs its backfill only because `library_user` was bolted onto an
  already-deployed library feature with pre-existing rows. No migration is shipped for C1.
- **C2 — Space summary counts inconsistent.** `getAssetCount` (`shared-space.repository.ts:239`)
  unions the album branch; `getRecentAssets` (`:490`) and `getNewAssetCount` (`:538`) omit it. The
  headline count jumps but the card thumbnail strip and "N new" badge never reflect album assets.

### Group D — Client

- **D1 — Web: in-space album detail timeline goes stale after add/remove photos.** The page omits
  the `timelineManager.upsertAssets/removeAssets` calls the global album page makes;
  `updateOptions` early-returns on deep-equal and album timelines never websocket-connect.
  `web/src/routes/(user)/spaces/[spaceId]/albums/[albumId=id]/[[photos=photos]]/[[assetId=id]]/+page.svelte:130-159`.
- **D2 — Mobile: link picker double-fires the PUT loop** (double link + double sync-nudge + double
  toast). `space_detail.page.dart:241-257` both passes `onAlbumsPicked` and re-runs it on the popped
  result; `space_link_album.page.dart:75-85` invokes the callback **and** `maybePop(ids)`.

### Group E — Test backfill (no production change)

- **E1 — Manual `album_user` untouched on member-_leave_** is tested only for the _unlink_ path.
- **E2 — No concurrency-race documentation test** (spec mandates one, annotated, like the library suite).
- **E3 — `getUpserts` post-grant re-delivery** is not asserted independently of `getCreatedAfter`.

## Non-goals

- No change to the API surface, DTOs, endpoints, OpenAPI spec, or SDKs. **No `mise //:open-api`
  regen is required by any slice** (avoids the fork's TS-only-regen drift trap).
- No change to the write-permission model, link/unlink authorization, the "absorbed" invariant, or
  the trigger/grant semantics (all verified correct).
- Not addressing the LOW polish items (unvalidated `albumId` route param → 500; mobile i18n
  hardcoded strings; mobile icon-only covers; `AssetUpdate` album-branch omission — likely
  intentional). Listed in the plan's "Deferred" section for visibility, not scheduled.

## Decisions baked into the plan

- **A1 fix shape:** add `.innerJoin('album', (j) => j.onRef('album.id','=','shared_space_album.albumId').on('album.deletedAt','is',null))`
  to every album read/timeline/count branch (mirrors how the asset join already carries
  `asset.deletedAt`). New Group-B branches include the same `album.deletedAt` filter from the start.
- **A3 fix shape:** a new server-internal `AlbumDelete` event emitted **before** `albumRepository.delete()`,
  consumed by `shared-space.service` using the album-excluding `getAlbumAssetIdsWithoutOtherSpacePath`
  (the same helper `unlinkAlbum` uses) — correct because the emit precedes the FK cascade, so
  `album_asset` rows still exist. Verify `eventRepository.emit` awaits handlers synchronously (it
  does for `AlbumAssetsAdd/Remove`); if not, fall back to capturing the orphan set in `album.service`
  before delete.
- **C2 semantics:** make all three summary queries **consistent** by adding the album branch to
  `getRecentAssets` + `getNewAssetCount`, matching `getAssetCount` (album assets counted/shown
  regardless of `showInTimeline`). Whether the headline count _should_ instead gate on
  `showInTimeline` is a deferred product question — flagged, not decided here.
