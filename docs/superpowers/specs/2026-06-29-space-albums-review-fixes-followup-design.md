# Space Albums — Review-Fix Follow-up Spec (Design)

## Summary

After PR #726 ("space-albums review fixes") merged into `feat/space-albums`, **three independent
adversarial reviews** were run against the branch at commit `5f0076cd6e` (post-#726):

| Review | Scope | Verdict |
| --- | --- | --- |
| `sa-rbac-k7` | access-control / RBAC | model **SOUND**; no shippable security bug. LOW/consistency: sync-stream `album.deletedAt` parity, `user_has_album_path` nit, unvalidated `albumId` param → 500; two informational notes. |
| `sa-faces-m3` | server correctness — face/person pipeline + membership/link lifecycle | **1 HIGH ship-blocker** (album branch never propagated to the space *people-projection* read/stat/face queries), **2 MEDIUM** (owner-account hard/soft delete face cleanup), 2 LOW, 1 product note. |
| `sa-mobile-p2` | Flutter client | **1 HIGH** (add-photos false-failure for non-owner editors, reproduced), **1 MEDIUM** (link picker only offers owned albums / dead `currentUserRole`), 3 LOW. |

This follow-up spec defines a TDD fix for **every** finding across all three reviews. The companion
plan (`docs/superpowers/plans/2026-06-29-space-albums-review-fixes-followup.md`) slices them for
`/impl-loop`. This document is the design rationale: the grouped problem set, intended behavior per
fix, edge cases, and the decisions baked into the slices.

It mirrors the structure of the prior round
(`docs/superpowers/specs/2026-06-25-space-albums-review-fixes-design.md` →
`…/plans/2026-06-25-space-albums-review-fixes.md`), which produced PR #726.

**Engineering vs. product.** Findings that are pure product calls — the headline-count vs.
`showInTimeline` divergence (faces F6), transitive-write awareness (RBAC F4), and the
membership-removed creator path (RBAC F5) — are **noted, not implemented**, in
[Product decisions](#product-decisions-noted-not-implemented-unless-decided). Everything else is an
engineering slice.

## Source reviews (authoritative finding list)

- `/Users/pierre/dev/firstmate/data/sa-rbac-k7/report.md`
- `/Users/pierre/dev/firstmate/data/sa-faces-m3/report.md`
- `/Users/pierre/dev/firstmate/data/sa-mobile-p2/report.md`

All `file:line` references below were re-verified against the worktree at `5f0076cd6e`. Because
`server/src/repositories/shared-space.repository.ts` is ~2647 lines and shifts easily, **line numbers
are anchors only — the durable anchor is the method name + the scoping construct** (`eb.or([...])` /
`asset_scope` CTE / EXISTS). Re-grep by symbol before editing.

## The unifying theme

The product vision is "a full Immich experience per space — its own timeline, its own people, its
own albums." PR #726 made album-linked assets first-class in the space **timeline**, **access
predicates**, **counts**, and the secondary read surfaces (tags/folders/memories/search). The
follow-up closes the **last** place the album branch was never propagated — the space **people
projection** (faces F1, the ship-blocker) — plus the **lifecycle edges** that strand or hide
album-derived face data (owner-account delete, soft-delete, asset-delete), and the remaining
**consistency / robustness / client** gaps the reviews surfaced.

---

## Findings (grouped, verified against code @ `5f0076cd6e`)

### Group F — Server faces / people correctness (`sa-faces-m3`)

#### F1 — Album-sourced space *people* are broken across every people-projection read/stat/face query — **HIGH, ship-blocker**

**The defect.** In the people-projection block of `server/src/repositories/shared-space.repository.ts`
(~lines 793–1620), `shared_space_library` appears 29 times and `shared_space_album` appears **0**
times. The album feature added the album branch to the *asset* surfaces (access predicates, timeline,
counts — all in #726) but never to the *people* projection's read surfaces. The result is two sources
of truth that disagree:

- **Projection write/grid INCLUDE album faces.** `recountPersons` (~`:2104`) recomputes
  `shared_space_person.assetCount` / `faceCount` from `shared_space_person_face` with **no path
  scoping**, and `getPersonAssetIds` → `getSpacePersonAssets` (~`:1599–1670`) reads the projection
  directly. So an album-only person shows in the list with a thumbnail and `assetCount > 0`, and the
  asset grid shows the album photos.
- **Read / statistics / face-listing EXCLUDE album faces.** Each of the following re-derives
  "in-space" scoping from an `eb.or([...])` / `asset_scope` CTE that contains **only**
  `shared_space_asset` + `shared_space_library`:

  | # | Surface (service → repo method) | Scoping construct | Symptom for an album-sourced person |
  | --- | --- | --- | --- |
  | 1 | person faces strip / representative — `getSpacePersonFaces` → `getSpaceRepresentativeFaces` | `eb.or([...])` | **empty faces strip** though person + thumbnail exist |
  | 2 | per-person stats — `getSpacePersonStatistics` | `asset_scope` CTE | **assets: 0, faces: 0** (contradicts the card's `assetCount>0`) |
  | 3 | people header — `getSpacePeopleStatistics` → `countPersonsBySpaceId` (+ its `datePersonFilter` + `detectedFaceCount` subquery) | `asset_scope` CTE | **`detectedFaceCount` undercounts**; album-only people **drop under a date filter** |
  | 4 | face stats — `getSpacePeopleFaceStatistics` → `getPeopleFaceStatisticsBySpaceId` | `asset_scope` CTE | detected/assigned/unassigned face counts **exclude album** |
  | 5 | people list (+ date filter) — `getPersonsBySpaceId` | EXISTS `eb.or([...])` | album-only person **disappears** when filtering `takenAfter/takenBefore` |
  | 6 | set representative face — `getSpaceRepresentativeFaceForUpdate` | `eb.or([...])` | **cannot pick an album face** as the representative |
  | 7 | identity evidence — `getIdentityEvidenceForSpacePerson` | `eb.or([...])` | identity reconciliation evidence **omits album faces** |

  (#7 was not in the report's numbered table but is the same library-only pattern; it completes the
  "7 distinct queries" phrasing.)

**Repro.** Create a face-recognition-enabled space; link an album whose photos are *not* directly
added and *not* in a linked library. `handleSharedSpaceAlbumFaceSync` → `processSpaceFaceMatch`
creates `shared_space_person` rows and `recountPersons` sets `assetCount > 0`. In the web People tab:
the person shows with a thumbnail and the grid shows album photos, **but** opening the person shows an
empty faces strip and "0 assets / 0 faces", the header `detectedFaceCount` ignores those faces, and a
date filter hides the person.

**Why it's in scope (not a documented deferral).** "Linked-album photos participate in the space's
face recognition … matched into space persons" is a Phase-1 goal
(`2026-06-09-space-albums-design.md`), and PR #726 explicitly fixed B1 to make album-sourced *people*
**readable** (`PersonAccess.checkSharedSpaceAccess`). The statistics/face-listing surfaces remaining
album-blind is an **incomplete implementation** of that goal. The #726 B-group fixed
`tag/view/memory/search` but not the `shared-space.repository` people queries.

**Untested.** No medium test calls any of these 7 read surfaces for an album-linked space — the gap
passes CI (see [Test Strategy](#test-strategy)).

**Intended behavior.** For each of the 7 queries, add the album `EXISTS`/`asset_scope` branch that
mirrors the adjacent `shared_space_library` branch, with `INNER JOIN album ON album.id =
shared_space_album.albumId AND album.deletedAt IS NULL` (the A1 invariant). After the fix, an
album-sourced person renders identical statistics, face strip, list-membership, and date-filter
behavior to a direct/library-sourced person.

**Edge cases the slice must cover.**
- **Album-only person** (faces solely on album assets) — now fully visible/counted.
- **Multi-path person** (faces on album *and* direct/library assets) — counted **once**, not
  doubled. The branches are `eb.or` / `UNION`-by-asset, so a face whose asset matches multiple paths
  still yields one row per `(person, face)`; the test must assert no inflation.
- **Trashed album** (soft-deleted) — the `album.deletedAt IS NULL` join means an album-only person
  whose album is soft-deleted correctly **disappears** from all 7 surfaces (consistent with A1, and
  with F3 below).
- **Date filters** (`takenAfter`/`takenBefore`) — the album branch in the `asset_scope` CTE and
  `datePersonFilter` must carry the same date predicates as the library branch, so date-filtered
  people headers/lists include album people in-range and exclude out-of-range.
- **Representative-face selection** — `getSpaceRepresentativeFaceForUpdate` must be able to choose an
  album-only face; the strip/representative read (`getSpaceRepresentativeFaces`) must then return it.
- **`detectedFaceCount`** — the subquery inside `countPersonsBySpaceId` is a *second* scoping site in
  the same method; both must get the album branch or the header count stays wrong.

#### F2 — Owner-account HARD delete bypasses space face cleanup → stranded faces + orphan persons — **MEDIUM**

`handleUserDelete` (`server/src/services/user.service.ts` ~`:274`) hard-deletes the user's albums via
`albumRepository.deleteAll(user.id)` (~`:326`, `album.repository.ts:373` = `deleteFrom('album')`),
which **emits no event** — and `shared-space.service` has no `UserDelete` handler (its only `@OnEvent`
handlers are `AlbumAssetsAdd`, `AlbumDelete`, `AlbumAssetsRemove`). So when a user who owns an album
linked into someone else's face-enabled space is hard-deleted:

- The `shared_space_album` link rows cascade away (FK `albumId → album ON DELETE CASCADE`) and the
  delete-side trigger cleans the **grants** + link-sync rows ✅.
- But the app-level `onAlbumDelete` face cleanup **never runs**, so `shared_space_person_face` rows for
  the album's assets owned by **other** users (album contributors — those assets survive) are
  **stranded**: the album path is gone, the projection rows remain → stale space people ❌.
- The deleted user's **own** album assets are hard-deleted by the user cascade →
  `asset_face → shared_space_person_face` cascade, potentially leaving **zero-face
  `shared_space_person` orphans** (no `deleteOrphanedPersons` runs) ❌.

These do **not** self-heal (`deleteAllOrphanedPersons` runs only under a forced full re-detection).

**Intended behavior.** Owner-account hard delete must run the same space-face cleanup that
`onAlbumDelete` performs, for each face-enabled linking space, **before** the albums/assets are
deleted (so `album_asset` rows still exist for `getAlbumAssetIdsWithoutOtherSpacePath`).

**Edge cases.** other users' surviving photos (faces cleaned), the deleted user's own photos
(zero-face orphans removed by `deleteOrphanedPersons`), album linked to **multiple** spaces (loop all
linking face-enabled spaces; per-space orphan calc), album asset **also** direct-added to the space
(face **retained** via the direct path — `getAlbumAssetIdsWithoutOtherSpacePath` excludes it),
non-face-enabled spaces (skipped).

#### F3 — Owner-account SOFT delete leaves album faces visible/addable as space people; face-pipeline gates ignore `album.deletedAt` — **MEDIUM**

Account soft-delete (`user-admin.service.ts:105` → `albumRepository.softDeleteAll(id)`,
`album.repository.ts:369` sets `album.deletedAt`) is the **only** writer of `album.deletedAt`. A1
correctly hides such an album's *assets* from read/timeline/count, but two gaps remain on the **face**
pipeline:

- **No cleanup on soft-delete.** There is no `AlbumSoftDelete` event (`onAlbumDelete` fires only on
  hard delete), so existing `shared_space_person_face` rows persist → the album's faces keep appearing
  as space people, and `getSpacePersonThumbnail` keeps serving a crop of the now-hidden assets.
- **The two face-pipeline gates omit the `album.deletedAt IS NULL` filter** that every A1-fixed query
  has: `isAssetInSpace` (~`:2298`, album branch ~`:2321`) and `getSpaceIdsForAsset` (~`:2458`, album
  branch ~`:2476`). So during the soft-delete window a late-detected face on a trashed-album asset is
  still **queued** (`getSpaceIdsForAsset`) and still **added** (`isAssetInSpace`).

On restore (`user-admin.service.ts:121` `restoreAll`) it should re-converge; on hard delete it hits
F2.

**Note on interaction with F1.** Once F1 lands, the 7 people *read* surfaces carry `album.deletedAt
IS NULL`, so a soft-deleted album-only person already disappears from reads/stats. F3 still matters
for: (a) the gates that keep **adding** faces during the window; (b) the raw projection
(`recountPersons` counts, `getSpacePersonThumbnail` crop) that reads tables directly and stays stale.

**Intended behavior.**
- **F3a (gates):** add `INNER JOIN album … AND album.deletedAt IS NULL` to the album branches of
  `isAssetInSpace` and `getSpaceIdsForAsset`, so the pipeline stops projecting faces for
  soft-deleted albums (consistent with A1).
- **F3b (cleanup + restore):** on owner-account soft-delete, run the same orphan face cleanup as
  `onAlbumDelete` for each face-enabled linking space (clears stale projection rows + thumbnail
  exposure); on restore, re-queue face matching for the restored albums' assets per linking space so
  people re-converge.

**Edge cases.** soft-delete then read (album people gone), late-detected face during window (not
added), restore (people re-projected), soft-delete of an album also reachable via a direct-add/library
path in the same space (face retained), hard-delete-after-soft (F2 path), multi-space.

#### F4 — Metadata inheritance omits the album-adder branch — **LOW**

`getSpacePersonAssetAdderIds` (~`:1494`) collects asset-adder user ids from
`shared_space_asset.addedById` + `shared_space_library.addedById` but has **no
`shared_space_album.addedById` branch** — unlike its sibling `getSpaceAssetAdder` (~`:1530`), which
*does* include album. So an album-sourced space person doesn't treat the album-linker as an asset
adder, weakening name/birth-date inheritance for album-only people.

**Intended behavior.** Add the album-adder subquery mirroring the library subquery, following the same
person linkage (`shared_space_person_face → asset_face → asset → album_asset → shared_space_album`,
`WHERE personId = … AND spaceId = …`, `addedById IS NOT NULL`).

#### F5 — Asset hard-delete leaves stale space-person counts + orphans — **LOW (pre-existing, not album-specific)**

Deleting a single asset (`asset.service.ts:485` emits `AssetDelete`) cascades
`asset_face → shared_space_person_face`, but nothing recounts the affected persons or removes
zero-face orphans (no shared-space `AssetDelete` handler). `assetCount`/`faceCount` go stale and
zero-face persons linger until a forced full re-detection. Predates albums (affects direct/library
spaces too) but reachable for album assets.

**Intended behavior.** A new shared-space `AssetDelete` handler that, for the spaces the asset
belonged to, recounts the affected persons (`recountPersons(personIds)`) and removes orphaned persons
(`deleteOrphanedPersons`). **Timing caveat** (open item, mirrors #726's `AlbumDelete` question):
verify whether `AssetDelete` fires **before or after** the `asset_face` cascade; if after, the
affected `(spaceIds, personIds)` must be captured before deletion (richer event payload) or the
handler must recount all persons in the affected spaces.

#### F6 — Headline count vs. `showInTimeline` divergence — **NOTE (product)**

`getAssetCount`/`getRecentAssets`/`getNewAssetCount` include album assets **regardless of
`showInTimeline`**, while the timeline gates on `showInTimeline = true`. So a card's count can exceed
what the timeline shows when a linked album has `showInTimeline = false`. The #726 C2 note already
left "should the headline gate on `showInTimeline`" as a deferred product question. **Not
implemented** — see [Product decisions](#product-decisions-noted-not-implemented-unless-decided).

### Group R — RBAC / sync consistency (`sa-rbac-k7`)

#### R-F1 — Album-asset sync streams don't apply the A1 `album.deletedAt` guard — **LOW / consistency**

In `server/src/repositories/sync.repository.ts`, the album-asset/exif sync streams gate on the
`shared_space_album_user` **grant only** and never exclude soft-deleted albums:
`SharedSpaceAlbumAssetSync.getBackfill/getUpdates/getCreates` (~`:1508/:1527/:1549`),
`SharedSpaceAlbumAssetExifSync.getBackfill/getUpdates/getCreates` (~`:1574/:1585/:1598`),
`SharedSpaceAlbumToAssetSync.getUpserts` (~`:1489`), and `SharedSpaceAlbumSync.getCreatedAfter`
(~`:1367`). The grant is **not** revoked on soft-delete (soft-delete is an `UPDATE`, no trigger
fires). Meanwhile `SharedSpaceAlbumSync.getUpserts` (~`:1396`) and
`SharedSpaceAlbumToAssetSync.getDeletes` (~`:1480`) **do** exclude soft-deleted albums via
`accessibleSpaceAlbums` (~`:1112`, which joins `album` and filters `album.deletedAt IS NULL`).

**Why it's not a security hole.** Only users who already had legitimate access (past/current members
with a grant) can reach it; no new user can. It also matches upstream personal-album sync. The
space-albums-specific wrinkle is the *internal asymmetry* (metadata upsert filters `deletedAt`, asset
streams don't), which during the owner account-deletion grace window lets a fresh-syncing client
backfill asset/exif rows for a trashed album without its parent metadata shell.

**Intended behavior.** Add the `accessibleSpaceAlbums`/`album.deletedAt` scope to the four
grant-gated album-asset streams so trashed-owner albums stop streaming, matching the A1 web fix and
the sibling streams that already do this. Thematically this is the *sync* leg of the same
"soft-deleted album should disappear everywhere" goal as F3.

#### R-F2 — `user_has_album_path` branches 2 & 3 omit `album.deletedAt` — **LOW / cosmetic**

`user_has_album_path(target_album_id, target_user_id, exclude_space_id)` is defined in
`server/src/schema/migrations-gallery/1779100000000-AddSharedSpaceAlbumCreateSideTriggers.ts:14-42`
(and as the schema source-of-truth in `server/src/schema/functions.ts:520`, body `:526-551`). Branch
1 (`album_user`) filters `a.deletedAt IS NULL`; branch 2 (other-space member) and branch 3
(other-space creator) join `shared_space_album` **without** an `album.deletedAt` check. Effect: a
soft-deleted album still *linked* to another space is treated as a valid "path," so a grant is
**retained** (under-revocation) during the same owner-deletion window as R-F1/F3. Direction is
grant-retention, not over-revocation, and all reads are independently `deletedAt`-guarded → **no read
leak**; purely a consistency nit, fix alongside R-F1.

**Intended behavior.** A new fork migration `CREATE OR REPLACE FUNCTION user_has_album_path` adding
`AND a.deletedAt IS NULL` (via a non-deleted `album` join) to branches 2 & 3, **plus** the matching
edit to `functions.ts` so the schema source and migration stay in sync.

#### R-F3 — Unvalidated `albumId` route param → 500 — **LOW / robustness**

`server/src/controllers/shared-space.controller.ts` link/unlink/update endpoints
(`PUT|PATCH|DELETE /shared-spaces/:id/albums/:albumId`, ~`:609/:623/:637`) use `@Param('albumId')
albumId: string` with **no** UUID validation, while the space `id` uses the validated `UUIDParamDto`
(`validation.ts:112` = `z.object({ id: z.uuidv4() })`). A non-UUID `albumId` reaches the service and
yields a **500** (invalid-uuid SQL error) instead of a clean **400**. No authorization bypass (role
checks run first). #726 explicitly deferred this.

**Intended behavior.** Validate `albumId` as a UUID (mirroring `id`) so malformed input returns 400.
See the OpenAPI caveat in [Decisions](#decisions-baked-into-the-plan).

#### R-F4 — Transitive write expansion via album-editor linking — **NOTE (informational, by design)**

An `album_user`-**editor** (not owner) who is also a space Editor may link an album into a space;
thereafter **other** space Editors gain add/remove on that album via `checkSpaceLinkedAlbumAccess`.
This is the documented model ("write follows space role"; linking requires album owner *or* editor) —
flagged for product awareness, not a defect. **Not implemented.**

#### R-F5 — `accessibleSpaces` creator path — **NOTE (informational, pre-existing infra)**

`accessibleSpaces` (`sync.repository.ts:867`) grants sync via `shared_space.createdById` independent
of membership, whereas read predicates are membership-only. If a space creator's membership row were
ever removed by another owner, they'd retain **sync** access while reads deny them. This is shared
shared-space infrastructure (identical for direct assets and libraries), **not** introduced by
space-albums → out of scope. **Not implemented.**

### Group M — Mobile / Flutter (`sa-mobile-p2`)

#### M-F1 — "Add photos" to a non-owned linked album shows a false failure — **HIGH (reproduced)**

A space **editor who is not the album's owner** opens a linked album's detail page, taps the kebab →
**Add photos**, and gets a **"Failed to add photos"** toast even though the server add **succeeded**
(the photos appear seconds later). Root cause: the detail page adds via the **personal-album** path,
which writes the local personal junction table for an **absorbed** album that has no personal
`remote_album` row → SQLite FK violation, rollback, rethrow, error toast:

`space_album_detail.page.dart:55` `addAssetsToAlbum(...)` → `remote_album.provider.dart:231/248` →
`remote_album.service.dart:178-184` (`addAssets` does the REST add **then** the local junction
insert) → `remote_album.repository.dart:281-302` batch-inserts into `remote_album_asset_entity`,
whose FK `albumId → RemoteAlbumEntity.id` (`remote_album_asset.entity.dart:14`) is enforced
(`db.repository.dart:377,459` PRAGMA `foreign_keys = ON`). For a non-owner editor the album lives only
in `shared_space_album` (absorbed) — no `remote_album` row → FK 787. The owner case works (the album
*is* in `remote_album`). The **remove** path is safe (DELETE of absent junction rows is a no-op).

**Intended behavior.** Route the space-album add through a **server-only** path that does not touch
the personal junction table — consistent with the "absorbed invariant" (space-album sync never writes
`remote_album*`). Add `SpaceAlbumActions.addAssets(albumId, assetIds)` that calls
`DriftAlbumApiRepository.addAssets(albumId, assetIds)` (the REST add, `drift_album_api_repository.dart:51-69`,
provider `:10`) then `_syncManager.syncRemote()`; the `spaceAlbum()` Drift watch already drives the
grid. Point `SpaceAlbumDetailPage._addPhotos` at the new action.

**Edge cases.** non-owner editor (absorbed album, no `remote_album` row — the bug), owner (album *is*
in `remote_album` — must still succeed via the new path, no double insert), remove path (already safe;
unchanged), absorbed-album-with-no-remote-row (the core: no local junction write attempted), empty
selection (no-op), server failure (toast shows a **real** error).

#### M-F2 — Link picker only offers OWNED albums; `currentUserRole` never populated — **MEDIUM**

The design says the picker candidate list = albums the user **owns or can edit**, but
`linkableAlbumCandidates` (`space_link_album_candidates.dart:21-23`) gates on `isOwner ||
album.currentUserRole == AlbumUserRole.editor`, and `RemoteAlbum.currentUserRole`
(`album.model.dart:38`, added by this branch) is **never populated** — the album mapper
(`remote_album.repository.dart:570-587` `toDto`) omits it, and it's assigned nowhere in production
`lib` (the only other `currentUserRole` hits are an unrelated `SharedSpaceRole` field in
`space_detail.page.dart:447` / `space_bottom_sheet.widget.dart`). So `currentUserRole` is always
`null`, the `isEditor` branch is dead, and only owned albums appear.

**Intended behavior.** Populate `currentUserRole` in the album DB mapper by reading the current user's
`remote_album_user.role` (the album queries already `leftOuterJoin remoteAlbumUserEntity` — add a
current-user-keyed read and pass it into `toDto`). The existing filter then works as designed and
editor-owned albums become linkable. (Alternative product call: if editor-linking is out of scope for
mobile v1, drop the `isEditor` branch and the "or can edit" wording — noted, but the design grants the
capability, so the slice **implements** it.)

#### M-F3 — Detail header missing "{count} photos · in {space.name}" subtitle — **LOW**

`SpaceAlbumDetailPage` app bar sets only the album name (`space_album_detail.page.dart:196`); the spec
specifies a `{count} photos · in {space.name}` subtitle. `assetCount` is in hand
(`SpaceAlbum.assetCount`, already resolved via `spaceAlbumsProvider`); the **space name** is not
currently watched in this page and must be sourced (space-metadata provider or route param).

#### M-F4 — Covers are always the placeholder icon — **LOW (known/deferred in #726)**

Shelf, list cards, and link-picker rows render `Icons.photo_album_outlined` rather than the album
cover (`space_albums_shelf.widget.dart:198`, `space_albums.page.dart:176`,
`space_link_album.page.dart:202-219`). The reuse pattern is `album_tile.dart:20,36-64`
(`assetServiceProvider.getRemoteAsset(thumbnailAssetId)` + `Thumbnail.remote` in a `FutureBuilder`
with the icon as fallback). `thumbnailAssetId` is present on `SpaceAlbum`/`RemoteAlbum`.

#### M-F5 — "Show/Hide in timeline" silently no-ops before album metadata loads — **LOW**

`_toggleTimeline` (`space_album_detail.page.dart:69-72`) returns early if the album is `null`, but the
kebab renders as soon as `canEdit` is known (`:198-204`, `showInTimeline: album?.showInTimeline ??
true`). An editor who taps the toggle while metadata is still loading gets no feedback and no effect.
Guard: disable the toggle (or show a "still loading" toast) until the album resolves.

---

## Product decisions (noted, not implemented unless decided)

These are surfaced for the captain; the plan does **not** schedule them.

1. **faces F6 — headline count gating on `showInTimeline`.** All three summary queries now
   (post-#726 C2) include album assets regardless of `showInTimeline`, so a card's count can exceed
   the timeline. Decide whether the headline should gate on `showInTimeline` (then the count/recent
   strip would drop `showInTimeline=false` albums). Engineering-cheap either way; it's a product call
   about what "the space's photo count" means.
2. **RBAC F4 — transitive write awareness.** Confirm the model is intended: granting album-edit to
   someone who is a space Editor lets them re-share the album's *write* surface to that space's
   Editors. No code change unless the model is to change.
3. **RBAC F5 — creator sync path.** Decide whether a space *creator* can be membership-removed at all,
   and if so whether sync access should follow membership. Pre-existing shared-space infra, broader
   than albums.
4. **F3b cleanup eagerness (mild).** The plan implements eager face cleanup on owner-account
   soft-delete + re-projection on restore (matches A1 intent and the report's recommendation). The
   alternative — lazily relying on F1's read-scoping + F3a gates and accepting stale projection counts
   until hard-delete/restore — is simpler but leaves `getSpacePersonThumbnail` exposing trashed-album
   crops. The plan proceeds with the eager approach; flagged here as the one place with a defensible
   alternative.

## Non-goals

- **No new API/DTO/endpoint surface** beyond the `albumId` param validation in R-F3 (which may touch
  generated validation metadata — see Decisions). No new SDK methods. No changes to the
  write-permission model, link/unlink authorization, the "absorbed" invariant, or trigger/grant
  semantics (all verified correct by RBAC).
- **No re-litigating #726.** A1 (trashed-album read/timeline/count), A2 (`removeAssets` multi-path),
  A3 (`onAlbumDelete`), B1 (PersonRead), B2 (tag/view/memory/search), C2 (counts), the web
  stale-timeline fix, and the mobile double-link fix are present and correct on this branch — verified.
- **No mobile thumbnail/i18n beyond F4** (covers); other deferred mobile polish stays deferred.

## Decisions baked into the plan

- **F1 fix shape:** add the album `EXISTS` / `asset_scope` branch mirroring the adjacent
  `shared_space_library` branch in each of the 7 queries, with `INNER JOIN album … AND
  album.deletedAt IS NULL`. Carry the same date predicates into the `asset_scope`/`datePersonFilter`
  album branch. Do **not** touch `recountPersons`/`getPersonAssetIds` (they intentionally read the
  projection directly — the fix is to make the *read* surfaces agree with them, scoped to non-deleted
  albums).
- **F2/F3 cleanup reuse:** reuse the exact `onAlbumDelete` cleanup sequence
  (`getSpacesLinkedToAlbum` → skip non-face-enabled → `getAlbumAssetIdsWithoutOtherSpacePath` →
  `removePersonFacesByAssetIds` → `deleteOrphanedPersons` → `queueSpacePersonMetadataBackfill`). For
  F2 (hard delete), emit `AlbumDelete` per owned album **before** `albumRepository.deleteAll`
  (`eventRepository.emit` awaits handlers in-process; `album_asset` rows still exist) — or, if a bulk
  sweep is preferred, call the repository sequence directly. For F3b (soft delete), trigger the same
  cleanup from the owner-account soft-delete path and re-queue face matching on restore.
- **R-F2 migration:** edit `functions.ts` **and** ship a new fork migration in
  `server/src/schema/migrations-gallery/` with a round timestamp **after** `1779200000000` (e.g.
  `1779300000000`) that `CREATE OR REPLACE FUNCTION user_has_album_path` with the `album.deletedAt`
  guard on branches 2 & 3. Verify the timestamp doesn't collide (CLAUDE.md fork-migration rules).
- **R-F3 validation + OpenAPI caveat:** mirror the existing `id` validation by folding `albumId` into
  a zod param DTO (e.g. `{ id: z.uuidv4(), albumId: z.uuidv4() }`). **This is the one slice that may
  alter the generated OpenAPI param metadata.** The slice gate must check whether the generated spec
  changes; if it does, run the OpenAPI regen workflow (TS SDK + Dart) — unlike the #726 round which
  was strictly no-regen. If a no-regen path is preferred, use a runtime-only UUID guard that doesn't
  emit format metadata. Resolve at plan-review.
- **M-F1 fix shape:** new `SpaceAlbumActions.addAssets` calling `DriftAlbumApiRepository.addAssets`
  + `syncRemote()`; no local personal-junction write (absorbed invariant). Detail page routes through
  it.

## Test Strategy

The reviews flagged many gaps as **untested**; closing them is part of every slice. Tests are
**written first** (RED), then the implementation makes them green.

### Server

- **Unit** (`cd server && pnpm test -- --run <path>`): mocked repos via `newTestService`. Used for the
  service-level wiring (e.g. F2 emit loop, F5 handler dispatch) where SQL isn't exercised. Files live
  beside the source as `server/src/**/*.spec.ts`
  (`shared-space.service.spec.ts`, `album.service.spec.ts`, `user.service.spec.ts`,
  `user-admin.service.spec.ts`).
- **Medium** (`cd server && pnpm test:medium -- --run <path>`, real Postgres via testcontainers /
  Docker): the home for every SQL-predicate change. Key files and where each slice slots in:
  - `server/test/medium/specs/repositories/shared-space.repository.spec.ts` — already exercises
    `getPersonsBySpaceId`, `countPersonsBySpaceId`, `getSpacePersonStatistics`,
    `getPeopleFaceStatisticsBySpaceId`, `getSpaceRepresentativeFaces`,
    `getSpaceRepresentativeFaceForUpdate`, `getPersonAssetIds`, `recountPersons` for **direct/library**
    spaces, and has an `addAlbum(...)` helper (used ~`:3294+`). **F1, F3a, F4** tests go here, reusing
    `addAlbum` to build album-only and multi-path people.
  - `server/test/medium/specs/services/shared-space-album.service.spec.ts` — album-link service flows.
    **F2, F3b, F5** cleanup tests (drive the real `albumService.delete` / user-admin soft-delete /
    asset delete and assert face-row outcomes).
  - `server/test/medium/specs/repositories/shared-space-album.repository.spec.ts` — counts /
    `getAssetIdsWithoutOtherSpacePath` / soft-deleted album leg. Count/consistency assertions.
  - `server/test/medium/specs/services/shared-space-album-permissions.service.spec.ts` — access/RBAC
    over the album leg.
  - `server/test/medium/specs/sync/shared-space-album-asset-sync.spec.ts`,
    `…-album-asset-exif-sync.spec.ts`, `…-album-to-asset-sync.spec.ts`, `…-album-sync.spec.ts`,
    `user-has-album-path.spec.ts`, `shared-space-album-delete-triggers.spec.ts` — **R-F1** (soft-delete
    exclusion on the four asset/exif/to-asset streams; currently only the metadata stream asserts it)
    and **R-F2** (`user_has_album_path` soft-deleted-album path).
- **E2E** (`e2e/`): `e2e/src/specs/server/api/shared-space-album.e2e-spec.ts` — **R-F3** malformed
  `albumId` → **400** (today there's only a valid-UUID access-gate 400 case at ~`:122`).

### Mobile

Run: `cd mobile && flutter test <path>` (or `mise //mobile:test`); analyze `mise //mobile:analyze`.
CI: "Static Code Analysis" + "Unit Test Mobile". Local mobile runs are version-skew-prone — rely on CI
for the authoritative pass; still analyze touched files.

- `mobile/test/providers/infrastructure/space_album_actions_test.dart` — mocktail unit test; the
  **only** place that asserts the `syncRemote()` nudge. **M-F1** extends it for the new `addAssets`.
- `mobile/test/medium/repositories/space_album_repository_test.dart` — real Drift DB. A focused
  **M-F1** regression here (an absorbed album with no `remote_album` row) proves the server-only path
  doesn't hit the junction FK. **M-F2** repo-mapper test asserts `toDto` populates `currentUserRole`
  from `remote_album_user`.
- `mobile/test/utils/space_link_album_candidates_test.dart` — pure unit; already sets
  `currentUserRole`. Confirms the gate once the field is populated (**M-F2**).
- `mobile/test/presentation/pages/space_album_detail_page_test.dart` /
  `space_b6_mutations_test.dart` — widget tests for **M-F3** (subtitle), **M-F5** (toggle guard), and
  the detail-page **M-F1** routing.
- `mobile/test/presentation/widgets/spaces/space_albums_shelf_test.dart` (+ list/link page tests) —
  **M-F4** cover rendering.

### Ordering principle

Slices are ordered ship-blocker-first (faces F1, mobile F1), then the owner-account/soft-delete
cleanup cluster (faces F2/F3 + RBAC F1 + RBAC F2 — the "soft-deleted album disappears everywhere"
theme), then LOW server/RBAC items, then mobile polish. Each slice is independently testable and
committable; later slices do not depend on earlier ones except where noted (F3a's gates precede F3b's
cleanup; F1's `album.deletedAt` join makes the soft-delete read behavior observable).
