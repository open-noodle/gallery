# Space Albums — Linking Albums into Shared Spaces — Design

## Summary

Let a shared space **compose albums by reference**: an Editor links one or more albums into a
space, and the album's photos appear inside the space — shown in the space timeline and browsable
in a new in-space "Albums" section — shared with every member. All members can **view** the linked
album's photos; only space **Editors/Owners** can **add or remove** photos in it. Removing a photo
from the album (or unlinking the album) removes it from the space automatically, because the link
is a live reference, never a copy.

This generalizes the pattern the fork already uses for **external libraries** (a collection linked
into a space) to **albums**, and moves the product toward "a space feels like a self-contained
Immich" — its own timeline, its own people, and now its own albums.

This is the first deliverable of a broader "more ways to feed a space" effort. Out of scope here
but explicitly designed-around: upload-target-to-space and rule/filter-based sources (see
[Future work](#future-work)).

## Motivation

Users want more ways to get photos into a space automatically. Today the only automatic source is a
linked **external library**. The two most-requested additions are "auto-add an album's photos to a
space" and "send my uploads to a space." During design we concluded that the right primitive is not
a copy-based _sync engine_ (which needs provenance tracking, mirror toggles, and removal
reconciliation) but **composition by reference**: a space _references_ existing collections and
shows their contents live. This is simpler, removal-correct by construction, and reuses albums — a
mature primitive with its own sharing, contributors, and asset management — instead of reinventing
collection management inside spaces.

Albums are the first by-reference source we add. Libraries already work this way.

## Goals

- An Editor/Owner can **link** an existing album into a space and **unlink** it.
- A linked album's photos are **visible to all space members** and appear in:
  - the **space timeline** (subject to a per-link `showInTimeline` toggle), and
  - a new **in-space Albums section** that lists linked albums and lets members browse them like the
    global albums view — but only _inside_ the space.
- **Write access follows the space role**, not album sharing: Viewers are strictly read-only;
  Editors/Owners can add/remove photos in the linked album.
- A linked album is **never added to a member's personal "Shared albums" list** ("absorbed").
- **Removal propagates for free**: removing a photo from the album, unlinking the album, or deleting
  the album removes those photos from the space.
- **Clean access revocation**: leaving the space or unlinking the album removes a member's access to
  the album's photos _only when they have no other path to them_, and **never disturbs a manual
  album share**.
- Linked-album photos participate in the space's **face recognition** when the space has it enabled,
  mirroring the existing library face-sync.
- Photos sync to members' **devices for offline use** (Phase 2), matching the sync-first expectation
  of the app.

## Non-goals

- **No copy semantics, no provenance/mirror subsystem.** Links are live references.
- **No `album_user` writes for space access.** We never grant album-level sharing to confer space
  access (that would leak album-edit rights and pollute personal album lists).
- **No change to existing album sharing, album ownership, or the library-link feature.**
- **No upload-target-to-space and no rule/filter sources** in this work (future).
- **No per-member `showInTimeline` for albums** (the toggle is space-level in v1; per-member is
  future).
- **No album deletion via the space.** Space Editors get asset add/remove on a linked album, not
  destroy-the-album (that stays with the album owner).

## Background: the `library_user` blueprint we mirror

The fork already solved "link a collection into a space, show + sync its assets to members, revoke
cleanly" for **libraries**. See `specs/2026-04-11-library-user-access-backfill-design.md`. The
shape:

- **Link table** `shared_space_library (spaceId, libraryId, addedById)`.
- **Internal per-user grant table** `library_user (userId, libraryId, createId)` — _not_ user-facing,
  written only by triggers. Its per-user `createId` is the signal that drives sync backfill.
- **Create-side triggers**: linking a library (`shared_space_library_after_insert_user`) grants
  `library_user` to every current member; joining a space (`shared_space_member_after_insert_library`)
  grants `library_user` for every currently-linked library. Each bumps `library.updateId` so the
  upsert stream re-delivers the metadata to the newly-accessing user.
- **Delete-side**: the existing `library_audit` fan-out triggers gate on
  `NOT user_has_library_path(libraryId, userId, excludeSpaceId)`; a consumer trigger
  (`library_user_delete_after_audit`) deletes the `library_user` row when the audit chain says the
  user has lost all paths. All "lost access" policy lives in one place.
- **Sync read**: `LibrarySync.getCreatedAfter` queries `library_user` keyed by the per-user grant
  `createId`; the per-library asset backfill loop streams `LibraryAssetBackfillV1`, etc.

The album feature follows this exactly, with **one deliberate divergence that makes albums _safer_
than libraries**: because the album's space-grant lives in a **separate** table
(`shared_space_album_user`) and we _never_ touch the user-facing `album_user`, a space grant can
never collide with or clobber a manual album share. `user_has_album_path()` simply treats a manual
`album_user` row (and ownership, and any other linking space) as an independent path that keeps the
photos accessible.

## Design overview

A space's asset set becomes the union of three sources:

| Source                               | Kind         | Membership table                                 | Removal behavior                     |
| ------------------------------------ | ------------ | ------------------------------------------------ | ------------------------------------ |
| **Directly-added assets** _(exists)_ | by-value     | `shared_space_asset`                             | manual, or when the asset is deleted |
| **Linked libraries** _(exists)_      | by-reference | `shared_space_library` + `library_user`          | propagates automatically             |
| **Linked albums** _(new)_            | by-reference | `shared_space_album` + `shared_space_album_user` | propagates automatically             |

Two access planes for a linked album, both governed by the **space** role (never by `album_user`):

- **Read + offline sync** — all members. Web reads live via an access predicate; mobile (Phase 2)
  receives photos via a grant-driven backfill modeled on `library_user`.
- **Write (add/remove album assets)** — Editors/Owners only, via a live permission-predicate
  extension evaluated per request.

A linked album is **absorbed**: it appears in the space's Albums section and (optionally) the space
timeline, but never in a member's personal album list, and there is no album surface a member can
navigate to outside the space.

## Phasing

The sync grounding (`sync.repository.ts`, mobile Drift/handlers) shows the client is the heavy,
risky part — the mobile app has no concept of a "space album" today. Web needs **no** sync machinery
(it reads live via the server API + access predicates). So we stage delivery to ship the valuable,
low-risk part first and isolate the offline-sync subsystem.

### Phase 1 — Server authorization + Web (no sync subsystem)

Delivers the full feature for **web** users.

- Schema: `shared_space_album` link table (+ `showInTimeline`, `addedById`) and its audit table.
- **Read access predicate**: assets in a space-linked album are readable by space members (extends
  the `accessibleSpaces`/`ownedOrSpaceAccessible` pattern).
- **Write permission extension**: `checkSpaceLinkedAlbumAccess` for `AlbumAssetCreate`/`Delete`,
  gated on space role ≥ Editor.
- **Space timeline composition**: the space timeline query unions linked-album assets where
  `showInTimeline = true`.
- **Album face-sync** job (parallel to `SharedSpaceLibraryFaceSync`) when the space has
  `faceRecognitionEnabled`.
- **API**: link / unlink / list / toggle endpoints under the space.
- **Web UI**: in-space Albums section, link/unlink, the timeline toggle, and Editor-only add/remove.

Phase 1 needs **no** grant table, triggers, sync entity types, or mobile changes. On mobile, the
in-space Albums section is hidden until Phase 2 (and linked-album photos do not yet sync to devices).

### Phase 2 — Offline sync + Mobile

Delivers the photos to devices and the in-space Albums UI on mobile.

- Internal grant table `shared_space_album_user` mirroring `library_user`.
- Create-side triggers (link → grant members; join → grant for linked albums; album asset/metadata
  `updateId` bumps for re-delivery) and delete-side revocation via an album-audit fan-out +
  `user_has_album_path()` + a consumer trigger.
- New `SharedSpaceAlbum*V1` sync entity types + sync repository classes that deliver the album,
  its asset membership, and its assets/exifs to members — distinct from personal-album entity types
  so the client routes them into the space UI, not the personal album list.
- Mobile Drift schema (space↔album link + grouping), sync dispatch handlers, and the in-space Albums
  UI + Editor add/remove affordances.

The `showInTimeline = false` case only becomes visible on mobile in Phase 2 (until then such an
album has no surface on mobile); `showInTimeline = true` albums show in the space timeline on web in
Phase 1 and on mobile in Phase 2.

## Data model

### `shared_space_album` (Phase 1, link table)

Mirrors `shared_space_library`.

```
shared_space_album
  spaceId        uuid  pk fk → shared_space (ON DELETE CASCADE)
  albumId        uuid  pk fk → album        (ON DELETE CASCADE)
  addedById      uuid?    fk → user         (ON DELETE SET NULL)
  showInTimeline boolean  NOT NULL DEFAULT true   -- include this album's photos in the space timeline
  createdAt / updatedAt / createId / updateId
```

- Composite PK `(spaceId, albumId)` — an album links to a space at most once; idempotent re-link.
- Companion `shared_space_album_audit` table (mirrors `shared_space_library_audit`) for the
  delete-side fan-out used by Phase 2 revocation. Created in Phase 1 so the schema is stable, even
  though its consumer trigger lands in Phase 2.

Fork migration in `server/src/schema/migrations-gallery/` with a round timestamp (e.g.
`1775300000000`) and a reversible `down()`. TypeScript table decorators + `migration_overrides`
mirror per the fork's schema-tools requirements (see the `library_user` doc's "Schema-tools
registration" — same boilerplate volume).

### `shared_space_album_user` (Phase 2, internal grant)

Mirrors `library_user` exactly. **Write-once**, trigger-maintained, never user-facing.

```
shared_space_album_user
  userId    uuid  fk → user  (ON DELETE CASCADE)
  albumId   uuid  fk → album (ON DELETE CASCADE)
  createId  uuid  NOT NULL DEFAULT immich_uuid_v7()
  createdAt timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (userId, albumId)
  INDEX (userId, createId)   -- hot path for getCreatedAfter
```

- `(userId, albumId)` PK dedupes when a user reaches the album via multiple spaces.
- `createId` (uuid_v7) is the per-user access-grant watermark that drives backfill.
- **No `updateId`/`updatedAt`/`role`** — rows are write-once; access is binary; role lives on
  `shared_space_member`. (Same YAGNI as `library_user`.)
- **Critical invariant:** this table is independent of `album_user`. Revocation deletes only
  `shared_space_album_user` rows and is gated on `user_has_album_path()`, so a manual `album_user`
  share is never affected.

## Access & roles

### Read (Phase 1)

A space member can read an asset if it is in an album linked to a space they belong to. New branch,
mirroring the existing **`shared_space_library`** branch already present in the per-asset access
predicates in `server/src/repositories/access.repository.ts` (the asset namespace — the broad
`EXISTS` union around line 633, plus the scoped variants near lines 236 / 290 / 346, each of which
already carries both a `shared_space_asset` and a `shared_space_library` path). `accessibleSpaces`
(`sync.repository.ts:857`) is the analogous helper on the **sync** side. (Note: `ownedOrSpaceAccessible`
is _not_ a single shared helper — it exists as private, duplicated methods in `view-repository.ts`
and `tag.repository.ts`; the album branch follows the `access.repository.ts` asset-predicate shape,
not those.) The SQL shape:

```sql
-- asset is readable via a space-linked album
EXISTS (
  SELECT 1
  FROM album_asset aa
  JOIN shared_space_album ssa ON ssa."albumId" = aa."albumId"
  JOIN shared_space_member ssm ON ssm."spaceId" = ssa."spaceId"
  WHERE aa."assetId" = asset.id
    AND ssm."userId" = :userId
)
```

This branch (an `EXISTS` over `album_asset ⋈ shared_space_album ⋈ shared_space_member`) is added
**everywhere** the `shared_space_library` branch currently appears — there are **multiple** such
predicates in the asset namespace (the broad union + the scoped/role-filtered variants), one per read
surface (asset detail, download, thumbnails, and the equivalents). The album branch must be added to
each; a test asserts read access through every surface, not just one. Unlike the library branch (which
joins the single `asset.libraryId` column), the album branch joins through the `album_asset` membership
table.

### Write (Phase 1)

Extend `Permission.AlbumAssetCreate` and `Permission.AlbumAssetDelete` evaluation in
`server/src/utils/access.ts` with a new branch backed by `access.album.checkSpaceLinkedAlbumAccess`:

```ts
// passes if the user is Owner/Editor of a space that links this album
db.selectFrom('album')
  .innerJoin('shared_space_album', 'shared_space_album.albumId', 'album.id')
  .innerJoin('shared_space_member', 'shared_space_member.spaceId', 'shared_space_album.spaceId')
  .where('album.id', 'in', albumIds)
  .where('shared_space_member.userId', '=', userId)
  .where('shared_space_member.role', 'in', [SharedSpaceRole.Owner, SharedSpaceRole.Editor])
  .select('album.id');
```

`union` of `{owner, album_user-editor, space-editor}`. Evaluated live per request — **no data
written, nothing to revoke**. Bounded to albums linked to spaces the user edits.

### Role matrix (linked album, inside a space)

| Space role | View + sync photos | Add/remove photos in the album | Link/unlink albums, manage space | Delete the album |
| ---------- | ------------------ | ------------------------------ | -------------------------------- | ---------------- |
| **Viewer** | ✅                 | ❌                             | ❌                               | ❌               |
| **Editor** | ✅                 | ✅                             | ✅                               | ❌               |
| **Owner**  | ✅                 | ✅                             | ✅                               | ❌               |

Album owner and any manual `album_user` editors retain their existing rights independently. Album
_deletion_ always remains with the album owner.

### Linking authorization

Linking/unlinking requires **space role ≥ Editor** _and_ the actor must **own or be an editor of the
album** (you may not re-share into a space an album that was only shared _to_ you read-only). Toggling
`showInTimeline` requires space role ≥ Editor.

> **Deliberate divergence from the library endpoints.** `linkLibrary`/`unlinkLibrary`
> (`shared-space.service.ts:603-605, 633-635`) additionally require `auth.user.isAdmin`, because an
> external library is an **admin-scoped server resource**. Albums are **user-owned**, so album
> link/unlink is gated on space role (≥ Editor) + album ownership/edit rights and is **NOT** admin-gated
> — a non-admin space Editor who owns the album can link it. The spec mirrors the library link _shape_
> (link table, triggers, sync), but intentionally **not** its admin gate. Grid 3/4 below pin this: the
> Editor actors are non-admins and must be ALLOWED.

## Space timeline composition (Phase 1)

The space timeline = `shared_space_asset` assets ∪ linked-library assets ∪ **linked-album assets
where `shared_space_album.showInTimeline = true`**. The album toggle is space-level (one setting per
link, set by Editors). It composes the **space** timeline; the existing per-member
`shared_space_member.showInTimeline` independently decides whether the space timeline bleeds into a
member's _personal_ timeline. The two nest; neither changes the other's semantics.

Albums with `showInTimeline = false` remain fully accessible and browsable via the in-space Albums
section — they are simply excluded from the aggregated timeline.

## Face recognition (Phase 1)

When a space has `faceRecognitionEnabled`, linking an album queues an album face-sync job
(`SharedSpaceAlbumFaceSync`, modeled on `SharedSpaceLibraryFaceSync` at `shared-space.service.ts:1617`)
that runs the linked album's assets through `processSpaceFaceMatch` (`shared-space.service.ts:2026`)
to create/match space persons. No face sync when the space has recognition disabled.

> **⚠️ Unlink face-cleanup is genuinely harder for albums than for libraries — call this out in the
> plan.** Library unlink (`unlinkLibrary`, `shared-space.service.ts:632-643`) removes contributed
> faces in bulk via `removePersonFacesByLibrary(libraryId)` + `deleteOrphanedPersons()` +
> `SharedSpacePersonMetadataBackfill`. That clean bulk key works because **a library asset belongs to
> exactly one library**. Album assets are **individual photos that may also be direct-added to the
> space, owned, or members of another linked album/library** — so there is no single key to bulk-remove
> by. Album unlink must remove space-person faces **only for the unlinked album's assets that retain no
> other space path**, then `deleteOrphanedPersons()` + metadata backfill. This per-asset,
> multi-path-aware removal is new work (not a drop-in reuse of `removePersonFacesByLibrary`) and is the
> highest-risk part of Phase 1's face handling; it gets its own dedicated medium test (see Testing). The
> downstream reconciliation/dedup jobs (`SharedSpaceIdentityReconciliation`, `SharedSpacePersonDedup`)
> are reusable as-is once the correct faces are removed. See the recognition pipeline spec
> `specs/2026-05-07-shared-space-recognition-pipeline-design.md`.

## Offline sync delivery (Phase 2)

Mirror the `library_user` mechanism:

- **`SharedSpaceAlbumSync` / `SharedSpaceAlbumAssetSync` / `SharedSpaceAlbumAssetExifSync` /
  `SharedSpaceAlbumToAssetSync`** repository classes, keyed off `shared_space_album_user.createId`
  for backfill and `accessibleSpaces`-style scoping for upserts.
- **New `SharedSpaceAlbum*V1` sync entity types** (distinct from personal `Album*V1`) so the client
  knows these belong to a space and routes them into the in-space Albums UI, never the personal album
  list.
- **Create-side triggers**:
  - `shared_space_album_after_insert_user` — linking an album grants `shared_space_album_user` to all
    current members and bumps the album's metadata `updateId` for re-delivery.
  - `shared_space_member_after_insert_album` — joining a space grants for all currently-linked albums.
- **Delete-side**: a `shared_space_album_audit` fan-out (on unlink, member-leave, space-delete,
  album-delete cascade) gated on `NOT user_has_album_path(albumId, userId, excludeSpaceId)`, plus a
  consumer trigger `shared_space_album_user_delete_after_audit` that deletes the grant row. The
  `user_has_album_path()` helper enumerates **all** access paths — album ownership, a manual
  `album_user` row, and any _other_ space that links the album — so revocation never strips access a
  user still legitimately has, and never touches `album_user`.

`updateId` bumps + the per-grant `createId` deliver newly-linked albums to existing members and new
members joining spaces with pre-linked albums, exactly as the library design does. No changes to
unrelated sync methods.

## API surface (Phase 1)

Under the existing shared-space controller:

```
GET    /shared-spaces/:id/albums                 — list linked albums (with showInTimeline)
PUT    /shared-spaces/:id/albums/:albumId        — link an album (Editor+, must own/edit album)
PATCH  /shared-spaces/:id/albums/:albumId        — update link (showInTimeline) (Editor+)
DELETE /shared-spaces/:id/albums/:albumId        — unlink (Editor+)
```

Mirrors the library endpoints (`PUT/DELETE /shared-spaces/:id/libraries`). Adding/removing the
album's _assets_ reuses the **existing** album-asset endpoints (`POST/DELETE
/albums/:id/assets`) — now permitted for space Editors/Owners via the extended write predicate, with
no new endpoint. OpenAPI clients (TS SDK + Dart) regenerated.

## Web & Mobile UI

- **Web (Phase 1):** an "Albums" section in the space view listing linked albums (cards like the
  global albums grid), a link picker (your albums you own/can edit), an unlink action, the per-album
  `showInTimeline` toggle, and — for Editors/Owners — add/remove affordances that call the existing
  album-asset endpoints. Read-only members see view-only.
- **Mobile (Phase 2):** Drift tables for the space↔album link and grouping, sync handlers for the new
  entity types, the in-space Albums section, and Editor add/remove. Until Phase 2, the section is
  hidden on mobile.

## Lifecycle & edge cases

(Each becomes a test — see [Testing](#testing-strategy-tdd-mandatory).)

- **Link / re-link / unlink**: idempotent re-link (PK conflict → no-op); unlink removes the album from
  the space immediately.
- **Remove asset from album** → leaves the space (unless the same asset is direct-added, owned, or in
  another linked album/library — then it remains via that path).
- **Delete the album** → link cascades; photos leave the space; (Phase 2) grants cascade.
- **Asset in multiple sources**: album linked to two spaces; album + direct-add; album + library;
  album + ownership. Read holds via any path; removing one path doesn't revoke the others.
- **Soft-deleted album/asset, trashed/archived assets, hidden visibility, stacked/live-photo assets**:
  match the existing space + album visibility rules (excluded/included consistently with libraries).
- **Write boundary**: Viewer add/remove denied; Editor on a _non-linked_ album denied; album owner /
  manual `album_user` editor unaffected.
- **`showInTimeline` toggle**: true ⇒ in space timeline; false ⇒ excluded from timeline but still
  accessible/browsable; per-member personal-timeline toggle composes on top.
- **Face recognition**: link with recognition on ⇒ album assets matched into space persons; off ⇒ no
  sync; unlink ⇒ faces removed only for the album's assets that retain no other space path
  (per-asset, multi-path-aware — _not_ a bulk `removePersonFacesByLibrary`); multi-path faces retained.
- **Revocation (Phase 2)**: member leaves / album unlinked / space deleted ⇒ grant removed iff no
  other path; **manual `album_user` share never touched**; owner-of-album-who-leaves keeps access.
- **Concurrency race (Phase 2)**: simultaneous member-insert + album-link may miss a grant — the same
  documented, low-probability hazard as `library_user`; pinned by a test, not fixed in v1.
- **Sync checkpoint value-space (Phase 2)**: new grant `createId` watermark behaves like
  `library_user`'s — worst case is a harmless idempotent re-delivery.

## Development methodology: TDD (mandatory)

**This feature is implemented test-first, following `superpowers:test-driven-development`.** Every
unit of behavior below is built RED → GREEN → REFACTOR:

1. **RED** — write a failing test that pins the behavior (access allowed/denied, predicate result,
   trigger row created/deleted, timeline inclusion/exclusion, sync stream contents). Run it; confirm
   it fails for the right reason.
2. **GREEN** — write the minimum code to pass.
3. **REFACTOR** — clean up with tests green.

No production code is written before a failing test exists for it. Access-control and trigger
behavior in particular are specified by tests _first_, because they are the correctness-critical,
security-relevant parts. Permission-matrix tests (the full Viewer/Editor/Owner × read/write grid)
are written before the predicate code, mirroring how PR #646/#651 pinned the space-access matrices.

## Testing strategy (full coverage)

Organized by layer. Coverage targets **every row** in [Lifecycle & edge cases](#lifecycle--edge-cases)
and the [role matrix](#role-matrix-linked-album-inside-a-space). Modeled on the depth of the
`library_user` doc's testing section.

### Permission matrix (authoritative test grid — written FIRST, TDD)

This grid is the load-bearing correctness contract. It is implemented as a parameterized **medium
test** (`server/test/medium/specs/shared-space-album-permissions.spec.ts`) against a real DB, and
**every cell is written as a failing test before any predicate code exists**. Each cell asserts the
exact outcome; `DENY` at the HTTP boundary asserts the correct status with the
`401 < 403 < 404` precedence preserved (unauthenticated → 401; authenticated-but-forbidden →
403; absent/invisible resource → 404).

> **Status-code realism.** Immich's `requireAccess` (`src/utils/access.ts`) frequently throws
> `400 BadRequest` ("…no … access") for the no-path case rather than 403/404. The tests assert the
> **actual** status the existing album/asset endpoints return for each denial (do not assume 403 — pin
> what the code does, and keep the relative precedence consistent). The `403/404` entries below mean
> "a denial in the 400/403/404 family"; the test records the exact code.

**Fixture world (seeded once per suite):**

- Space `S` links album `A`. Space `S2` links album `C`.
- Album `B` is linked to **no** space.
- Actors:
  - `spaceOwner` — Owner of `S`, **non-admin**, no independent album rights.
  - `spaceEditor` — Editor of `S`, **non-admin**, no independent album rights. (Non-admin is load-bearing:
    it proves album link/unlink is _not_ admin-gated, unlike libraries.)
  - `spaceViewer` — Viewer of `S`, no independent album rights.
  - `nonMember` — not in `S`/`S2`, no album rights.
  - `albumOwner` — owns `A`, **not** a member of `S`.
  - `albumEditor` — manual `album_user` **editor** on `A`, **not** a member of `S`.
  - `albumViewer` — manual `album_user` **viewer** on `A`, **not** a member of `S`.
  - `crossEditor` — Editor of `S2` (links `C`); also owns a private album `B`.
  - `admin` — server admin.

#### Grid 1 — READ / view + sync album `A`'s assets (and list `A` in the in-space Albums section)

| Actor                       | Expected                                                  | Path that grants it                         |
| --------------------------- | --------------------------------------------------------- | ------------------------------------------- |
| `spaceOwner`                | **ALLOW**                                                 | space membership → `A` linked to `S`        |
| `spaceEditor`               | **ALLOW**                                                 | space membership                            |
| `spaceViewer`               | **ALLOW**                                                 | space membership                            |
| `nonMember`                 | **DENY (404)**                                            | no path                                     |
| `albumOwner`                | **ALLOW**                                                 | album ownership (independent of `S`)        |
| `albumEditor`               | **ALLOW**                                                 | manual `album_user` (independent)           |
| `albumViewer`               | **ALLOW**                                                 | manual `album_user` (independent)           |
| `crossEditor` (reading `A`) | **DENY (404)**                                            | edits `S2`, not `S`; `A` not linked to `S2` |
| `admin`                     | per existing admin-content rules (no space-derived grant) |

#### Grid 2 — WRITE: add/remove assets in album `A` (`AlbumAssetCreate` / `AlbumAssetDelete`)

| Actor                                       | Expected           | Rationale                                             |
| ------------------------------------------- | ------------------ | ----------------------------------------------------- |
| `spaceOwner`                                | **ALLOW**          | space role ≥ Editor on a space linking `A`            |
| `spaceEditor`                               | **ALLOW**          | space role ≥ Editor                                   |
| `spaceViewer`                               | **DENY (403)**     | **the key constraint** — Viewer is strictly read-only |
| `nonMember`                                 | **DENY (403/404)** | no path                                               |
| `albumOwner`                                | **ALLOW**          | existing album-owner right (unchanged)                |
| `albumEditor`                               | **ALLOW**          | existing `album_user` editor right (unchanged)        |
| `albumViewer`                               | **DENY (403)**     | existing `album_user` viewer is read-only (unchanged) |
| `crossEditor` writing to `A`                | **DENY (403/404)** | bounded: edits `S2`, `A` not linked there             |
| `spaceEditor` writing to **`B`** (unlinked) | **DENY (403/404)** | bounded: write grant is per-linked-album              |

#### Grid 3 — LINK an album into `S` (`PUT /shared-spaces/:id/albums/:albumId`)

Requires space role ≥ Editor **AND** actor owns or can edit the album. **Not admin-gated** — the
`spaceOwner`/`spaceEditor` actors below are non-admins and must be ALLOWED (the deliberate divergence
from `linkLibrary`, which requires `isAdmin`).

| Actor                      | Album                              | Expected                                                  |
| -------------------------- | ---------------------------------- | --------------------------------------------------------- |
| `spaceOwner`               | owns it                            | **ALLOW**                                                 |
| `spaceEditor`              | owns it                            | **ALLOW**                                                 |
| `spaceEditor`              | only `album_user`-**viewer** on it | **DENY (403)** — can't re-share a read-only album         |
| `spaceEditor`              | `album_user`-**editor** on it      | **ALLOW**                                                 |
| `spaceViewer`              | owns it                            | **DENY (403)** — Viewer can't manage links                |
| `nonMember`                | owns it                            | **DENY (403/404)**                                        |
| re-link already-linked `A` | —                                  | **idempotent no-op** (PK conflict, 2xx, no duplicate row) |

#### Grid 4 — UNLINK / toggle `showInTimeline` (`DELETE` / `PATCH .../albums/:albumId`)

| Actor         | Expected           |
| ------------- | ------------------ |
| `spaceOwner`  | **ALLOW**          |
| `spaceEditor` | **ALLOW**          |
| `spaceViewer` | **DENY (403)**     |
| `nonMember`   | **DENY (403/404)** |

#### Grid 5 — DELETE the album entirely

| Actor                                          | Expected           | Rationale                                                     |
| ---------------------------------------------- | ------------------ | ------------------------------------------------------------- |
| `albumOwner`                                   | **ALLOW**          | unchanged album-owner right                                   |
| `spaceOwner` / `spaceEditor` (not album owner) | **DENY (403)**     | space link grants asset add/remove, **not** destroy-the-album |
| `spaceViewer` / `nonMember`                    | **DENY (403/404)** | —                                                             |

#### Grid 6 — Multi-path invariants (read holds via _any_ path; revoking one never revokes another)

| Scenario                                            | Assertion                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| asset in `A` **and** direct-added to `S`            | unlink `A` → asset **still** readable (direct path)                                                 |
| asset in `A` **and** owned by actor                 | unlink `A` → still readable (ownership)                                                             |
| `A` linked to `S` **and** `S2`; actor in only `S`   | readable; unlink from `S` → still readable iff also in `S2`                                         |
| actor is `albumEditor` **and** `spaceViewer`        | **WRITE ALLOW** (album-editor path wins; space-viewer doesn't subtract)                             |
| actor has manual `album_user` **and** a space grant | leaving `S` (Phase 2) deletes only `shared_space_album_user`; the `album_user` row is **untouched** |

#### Grid 7 — "Absorbed" invariant

| Assertion                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| For **every** member of `S` (Owner/Editor/Viewer), album `A` does **not** appear in their personal/`album_user`-derived album list — it is visible **only** inside `S`'s Albums section. |
| Linking `A` to `S` writes **no** `album_user` row for any member (Phase 2: only `shared_space_album_user`).                                                                              |

Grids 1–7 are mirrored at the **unit** layer (predicate/service specs with mocked repos, fast
RED-GREEN loop) and asserted end-to-end at the **API E2E** layer. The medium grid above is the
authoritative source of truth; the others must agree with it (a set-equality regression guard ties
the unit predicate output to the medium results, mirroring PR #646/#651).

### Unit / small tests (vitest, mocked repos)

- **Access predicate (read)** — `asset-access` spec: member of a space linking album A can read A's
  assets; non-member cannot; multi-path union (album + owned, album + direct-add, album in two spaces)
  returns readable; unlinking removes the path.
- **Write predicate** — `access.ts` / `access.repository` spec: `checkSpaceLinkedAlbumAccess` returns
  the album for space Owner/Editor, **not** for Viewer, **not** for a non-member, **not** for an album
  linked to a _different_ space; union with owner + `album_user`-editor preserves existing grants.
- **Service layer** — `shared-space.service` spec: `linkAlbum`/`unlinkAlbum`/`updateAlbumLink` require
  Editor+; reject Viewer; reject linking an album the actor can't edit; idempotent re-link; toggle
  persists; face-sync job queued only when `faceRecognitionEnabled`.
- **Timeline composition** — linked-album assets included iff `showInTimeline = true`; excluded album
  still resolvable by id.
- **DTO / validation** — link DTO defaults `showInTimeline = true`; role/permission errors map to the
  correct HTTP codes (401 < 403 < 404 ordering preserved).

### Medium tests (real DB via testcontainers)

Use the `immich-postgres` image (vchord) and the medium factory; register any new repo in
`test/medium.factory.ts`.

- **Read predicate against real rows** — full permission matrix (Viewer/Editor/Owner/non-member) ×
  (asset only in linked album / also direct-added / also owned / in two linked spaces / album
  unlinked) → exact readable-set assertions. Set-equality regression guard against the existing
  space-access predicates (no drift).
- **Write predicate against real rows** — Editor/Owner can `addAssets`/`removeAssets` on the linked
  album via the existing album endpoints; Viewer gets 403; non-member 403; album-not-linked-to-their-
  space 403; album owner unaffected.
- **Timeline buckets** — space timeline includes/excludes linked-album assets per `showInTimeline`;
  per-member `showInTimeline` composition; removed-from-album asset disappears from the space.
- **Face sync** — linking into a recognition-enabled space matches album faces into space persons;
  disabled space does nothing. **Unlink (the high-risk path — see the face-recognition section):**
  - album-only assets → their faces are removed from the space person(s);
  - **asset in the album AND direct-added to the space** → unlink must **NOT** remove its faces (the
    asset still has a space path) — this is the per-asset multi-path case libraries never hit;
  - **asset in the album AND in a second linked album/library** → faces retained;
  - person reachable only through the unlinked album → orphan-cleaned; person still reachable through a
    retained asset → kept.
    (Engine-compat: exercise on the vchord medium harness; if any centroid/`avg(vector)` path is
    touched, also cover the pgvecto.rs harness per `feedback_pgvecto_rs_no_avg_vector`.)

### Medium tests — triggers & sync (Phase 2)

A dedicated `server/test/medium/specs/sync/shared-space-album-user.spec.ts`, modeled on the
`library_user` trigger/consumer suite:

- **Create-side**: link album to a space with M members → M grant rows with fresh `createId`s + album
  `updateId` bumped; member joins a space with N linked albums → N grant rows; bulk link/join
  statement-level semantics with distinct `createId`s; zero-member / zero-album no-ops.
- **Delete-side**: member leaves → grant removed iff no other path; **manual `album_user` share
  preserved** (separate-table invariant — assert the `album_user` row is untouched); album unlinked →
  grants removed for members w/o other path; whole-space delete → cascade correctness (the regression
  guard for the "trust-the-gate, no defensive re-check" rule, since the space delete fires before FK
  cascades); album hard-delete → grants vanish via FK cascade with no audit emitted.
- **Multi-path dedup**: owner + member; member of two spaces linking the same album → single grant
  row; `ON CONFLICT DO NOTHING` correctness.
- **`getUpserts` re-delivery**: after a grant, the album metadata re-flows on the member's next sync
  (asserted independently of the `getCreatedAfter` stream so it can't be masked).
- **`getCreatedAfter`**: ordered by `createId`; filters by `afterCreateId`; empty for no-access;
  owned/manual/space paths union without duplicates; set-equality with the access predicate.
- **Concurrency race**: documentation test pinning the member+link race (annotated, like the library
  one).
- **`user_has_album_path()`**: unit-pins every path branch (ownership, manual `album_user`, other
  linking space) and the `excludeSpaceId` gating.

### Integration / E2E

- **API E2E** (`e2e/`): link/unlink/list/toggle endpoints with the role matrix; add/remove album
  assets as a space Editor (allowed) and Viewer (403); OpenAPI contract round-trip.
- **Sync E2E (Phase 2)**: the three `library_user` scenarios re-cast for albums — (1) re-add to a
  space, (2) first-time invite to a space with pre-linked albums, (3) album linked to a space the
  user is already in — assert the new `SharedSpaceAlbum*V1` events arrive; assert the album does
  **not** arrive as a personal `AlbumV1` (the absorbed invariant).
- **Regression**: existing album, library, shared-space, and sync suites stay green.

### Web component tests (Phase 1)

- Albums section renders linked albums; Editor sees link/unlink/toggle/add-remove; Viewer sees
  read-only; the `showInTimeline` toggle round-trips; the link picker only offers albums the user
  owns/can edit.

### Mobile tests (Phase 2)

- Drift upsert/delete for the space↔album link + grouping; sync dispatch routes `SharedSpaceAlbum*V1`
  into space state (not personal albums); in-space Albums UI renders; `dart analyze --fatal-infos lib
test` clean (per `feedback_mobile_dart_analyze_ci_fatal_infos`).

### CI gates (run the real gates, not just vitest)

Per `feedback_impl_loop_subagent_gaps_vs_gates`: `tsc --noEmit` directly (cache can mask spec
breaks), `make check-server` / `check-web`, **`eslint --max-warnings 0`** (Lint Web/Server is a
separate job — watch floating-promises and `void 0`), OpenAPI regen for **both** TS and Dart, and
the full `test.yml` as the authoritative gate.

## Rollback plan

- **Phase 1 is additive**: the link table + predicates are new; reverting app code leaves the table
  unread and harmless. The migration `down()` drops the link/audit tables.
- **Phase 2 is additive** in the `library_user` sense: the grant table + triggers can stay in place
  under an app rollback (unread); `down()` drops triggers, functions, `migration_overrides` rows,
  indexes, and the table. `updateId` bumps from the running version are harmless inflation. Safe to
  roll forward/back without coordinated restarts.

## Future work

- **Upload-target → space**: a member's future uploads land in the space (by-value direct assets;
  designed-around but deferred).
- **Rule/filter sources**: "all photos tagged X / of person Y / matching this search" sync into a
  space. The link-table + predicate shape generalizes to a `type`-discriminated source if/when this
  lands.
- **Per-member `showInTimeline` for linked albums** (album currently space-level).
- **Mirror/by-value options** if a use case ever needs copy semantics (none identified).

## Open questions for the implementation plan

- Exact `SharedSpaceAlbum*V1` entity-type set and whether any can reuse existing album wire shapes
  without leaking into the personal album list (confirm with a mobile consult before Phase 2).
- Face-cleanup-on-unlink precision: confirm the reconciliation job correctly retains multi-path faces
  at scale on the vchord and pgvecto.rs engines.
- Whether the in-space Albums section should support album _creation_ inside a space (create-then-link
  in one step) or only linking existing albums in v1 (lean: link-only first).
