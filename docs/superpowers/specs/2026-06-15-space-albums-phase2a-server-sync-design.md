# Space Albums — Phase 2A: Server Offline-Sync Subsystem — Design

Companion to [`2026-06-09-space-albums-design.md`](./2026-06-09-space-albums-design.md) (master) and
[`2026-06-15-space-albums-phase2-mobile-design.md`](./2026-06-15-space-albums-phase2-mobile-design.md)
(mobile UX + decomposition). This spec covers **Step 0 (the sync wire contract)** and **Sub-project A
(the server offline-sync subsystem)** only — the grant table, triggers, `user_has_album_path()`, the
five sync repository classes + entity types, and dispatch/OpenAPI wiring. The Flutter app
(Sub-project B) gets its own spec after this one ships. Target: a spec ready for `/impl-loop`.

Implemented **test-first (TDD mandatory)** per the master doc — every trigger, predicate, and stream
behavior is pinned by a failing test before the production code exists.

## 1. Scope & non-goals

**In scope (Sub-project A):**

- `shared_space_album_user` internal grant table (the per-user album-access watermark).
- `shared_space_album_audit` (link-removal channel) and `shared_space_album_user_audit` (grant-revocation
  channel) audit tables, plus their delete-side fan-out triggers and the grant consumer trigger.
- `user_has_album_path()` SQL function.
- Create-side triggers: `shared_space_album_after_insert_user`, `shared_space_member_after_insert_album`.
- Five sync repository classes (metadata, link, membership, asset, exif) + their `SharedSpaceAlbum*V1`
  entity types + dispatch/checkpoint wiring.
- OpenAPI regen (TS + Dart) so the client SDK carries the new wire types.
- Full server test coverage (medium triggers/sync, unit predicates, sync E2E).

**Out of scope:** all Flutter/Drift/UI work (Sub-project B); any change to web (Phase 1, shipped); any
change to personal album sync, library sync, or `album_user`.

## 2. Decision record

Two decisions were made during brainstorming (2026-06-15). Both refine the master doc and are binding
for this spec.

### D1 — The grant table mirrors `library_user`

`shared_space_album_user` is **write-once, trigger-maintained, internal-only**, with a `createId`
(uuid_v7) watermark and **no role / no `updateId`**. Space access is binary; role lives on
`shared_space_member`. **It is never `album_user`** — revocation touches only this table, so a manual
`album_user` share is never disturbed (the master doc's "absorbed" + "separate-table" invariants).

### D2 — The four sync classes clone the **personal album sync**, re-keyed to the grant (Option A)

The master doc named the `library` sync as the blueprint. Exploration showed the **personal album
sync** (`AlbumSync` / `AlbumToAssetSync` / `AlbumAssetSync` / `AlbumAssetExifSync`, all keyed off
`album_user`) is the better structural fit, because albums are **many-to-many with assets** via the
`album_asset` join — which the personal album sync already handles (membership stream + `album_asset`
already carries `updateId` and has an `album_asset_audit` + delete trigger for removal). The library
sync keys assets off the 1:1 `asset.libraryId` column and has no membership concept.

**Decision:** clone the four personal-album sync classes (`AlbumSync`, `AlbumToAssetSync`,
`AlbumAssetSync`, `AlbumAssetExifSync`), swapping their `album_user` join for the new
`shared_space_album_user` grant, **plus** a fifth space-keyed **link** stream cloned from
`SharedSpaceLibrarySync` (the album↔space `showInTimeline` mapping has no personal-album analogue —
see §6/§7 for the corrected **five-class** breakdown). **Reuse the existing wire DTO schemas**
(`SyncAlbumV1`, `SyncAlbumToAssetV1`, `SyncAssetV1`, `SyncAssetExifV1`; only the link DTO is new) but
emit them under **distinct entity types** (`SharedSpaceAlbum*V1`) so the client routes them into space
Drift tables, never the personal album list. Structure them as **independent copies** (copy-first),
matching the existing `SharedSpaceLibrarySync`-beside-`LibrarySync` precedent; extract a shared helper
only where trivially clean (e.g. the grant-keyed backfill loop). The shipping personal album sync is
left untouched.

## 3. What Phase 1 already built (and two corrections)

Confirmed on this branch (`feat/space-albums`):

- `shared_space_album` link table exists (`1775300000000-AddSharedSpaceAlbumTable.ts`): PK
  `(spaceId, albumId)`, `showInTimeline boolean NOT NULL DEFAULT true`, `addedById` (SET NULL),
  `createId`/`updateId`, `updatedAt` trigger. Table decorator: `shared-space-album.table.ts`.
- Read predicates exist (`access.repository.ts`: `checkSpaceLinkedAlbumAccess` Editor+,
  `checkSpaceLinkedAlbumReadAccess` any member; asset-access UNIONs include the album branch).
- Write extension exists (`access.ts`: `AlbumAssetCreate`/`Delete` unioned with the space-linked album
  check; `AlbumUpdate` deliberately **not** extended → no circular grant).
- Service/controller/DTOs exist (`linkAlbum`/`unlinkAlbum`/`updateAlbumLink`/`getLinkedAlbums`;
  `GET/PUT/PATCH/DELETE /shared-spaces/:id/albums[/:albumId]`).
- Space timeline composition exists (`asset.repository.ts`, `utils/database.ts`, `map.repository.ts`:
  EXISTS over `shared_space_album ⋈ album_asset` where `showInTimeline = true`).
- Face sync exists (`SharedSpaceAlbumFaceSync` job).

**Correction 1 — the audit table was NOT created in Phase 1.** The master doc says a companion
`shared_space_album_audit` was created in Phase 1 "so the schema is stable." It was not. Sub-project A
creates **both** audit tables.

**Correction 2 — `unlinkAlbum` already computes orphaned assets.** Phase 1's `unlinkAlbum` already
calls `getAlbumAssetIdsWithoutOtherSpacePath` for face cleanup. Phase 2 must ensure the **grant/sync**
revocation path is consistent with that same multi-path logic (they answer the same question — "does
the user/asset retain another path?" — and must not disagree).

**Reused, already-present infrastructure:** `album_asset` (which carries `updateId` plus
`album-asset-audit.table.ts` and the `album_asset_delete_audit` trigger), `album_audit`,
`accessibleSpaces` (`sync.repository.ts`), and the personal
`AlbumSync`/`AlbumToAssetSync`/`AlbumAssetSync`/`AlbumAssetExifSync` classes (the clone source).

## 4. Data model

### 4.1 `shared_space_album_user` (grant) — mirrors `library_user` exactly

```
shared_space_album_user
  userId    uuid  NOT NULL  FK → user  (ON UPDATE CASCADE, ON DELETE CASCADE)
  albumId   uuid  NOT NULL  FK → album (ON UPDATE CASCADE, ON DELETE CASCADE)
  createId  uuid  NOT NULL  DEFAULT immich_uuid_v7()
  createdAt timestamptz NOT NULL DEFAULT now()
  PRIMARY KEY (userId, albumId)
  INDEX shared_space_album_user_userId_createId_idx (userId, createId)
```

Table decorator `shared-space-album-user.table.ts` clones `library-user.table.ts` (FK `primary: true,
index: false`; `@CreateIdColumn`; `@CreateDateColumn`; **no** `updateId`/`updateDate`). `(userId,
albumId)` PK dedupes a user who reaches the album via multiple spaces.

### 4.2 `shared_space_album_audit` (link-removal channel) — mirrors `shared_space_library_audit`

```
shared_space_album_audit
  id        uuid pk DEFAULT immich_uuid_v7()
  spaceId   uuid NOT NULL  (indexed)
  albumId   uuid NOT NULL  (indexed)
  deletedAt timestamptz NOT NULL DEFAULT clock_timestamp() (indexed)
```

**Ungated**, one row per removed `(space, album)` link. Consumed by `SharedSpaceAlbumLinkSync.getDeletes`
to emit `SharedSpaceAlbumLinkDeleteV1 {spaceId, albumId}` to every member of that space (scoped by
`accessibleSpaces`). Drives the client dropping `(S, A)` from a space's shelf — independent of whether
that member retains the album by another path (a member who _owns_ A drops the space-shelf entry but
keeps their personal album, because they are distinct entity types/Drift tables).

### 4.3 `shared_space_album_user_audit` (grant-revocation channel) — mirrors `library_audit`'s role

```
shared_space_album_user_audit
  id        uuid pk DEFAULT immich_uuid_v7()
  albumId   uuid NOT NULL  (indexed)
  userId    uuid NOT NULL  (indexed)
  deletedAt timestamptz NOT NULL DEFAULT clock_timestamp() (indexed)
```

**Gated** on `NOT user_has_album_path(albumId, userId, excludeSpaceId)` — one row per `(album, user)`
who has genuinely lost all paths. Consumed by **two readers**, mirroring how `library_audit` is read by
both `library_user_delete_after_audit` and `LibrarySync.getDeletes`:

1. The **consumer trigger** `shared_space_album_user_delete_after_audit` blindly deletes the matching
   grant row (trusts the gate at insert time — never re-checks, so it is correct during the space-delete
   cascade ordering). This stops asset/membership backfill.
2. `SharedSpaceAlbumSync.getDeletes` reads it to emit `SharedSpaceAlbumDeleteV1 {albumId}` — the album
   metadata is gone for this user. **Gated**, so a user who retains the album by another path (owner,
   `album_user`, another linking space) is **not** told to drop it.

Together with the link-removal channel (§4.2), the client receives both signals: "album A is no longer
linked to space S" (always) and "album A is fully gone for you" (only when no path remains).

> **Why two audit tables (the topology that matters).** Link-removal (drop `(S, A)` from a shelf) and
> grant-revocation (stop asset backfill) have **different gating**: link-removal is **ungated** (the
> link is objectively gone for everyone in the space), grant-revocation is **gated** (only members
> with no other path). They cannot share one gated row without either leaking the album on a shelf
> (if gated) or revoking still-valid grants (if ungated). This mirrors the library blueprint's
> `shared_space_library_audit` (ungated link) + `library_audit` (gated per-user) split exactly.

### 4.4 Reused: `album_asset_audit` (membership-removal channel)

When a photo is removed from a linked album, `album_asset` deletes → `album_asset_delete_audit` writes
`album_asset_audit (albumId, assetId)` (existing). `SharedSpaceAlbumToAssetSync.getDeletes` /
`SharedSpaceAlbumAssetSync.getDeletes` read this audit **re-scoped by the grant** (album ∈
accessible-via-grant), emitting `SharedSpaceAlbumToAssetDeleteV1` so members drop the photo from the
album's grid (and thus the space timeline, since the timeline Drift query joins membership). No new
table; the existing audit is read by an additional, grant-scoped reader.

## 5. Functions & triggers (mirror the `library_user` blueprint, album substitutions)

### 5.1 `user_has_album_path(target_album_id, target_user_id, exclude_space_id)` → boolean

`STABLE LANGUAGE SQL`, registered in `schema/functions.ts` and in the migration. Returns true if **any**
path holds (so revocation never strips access a user legitimately retains, and never consults
`album_user` for write — only for existence):

1. **Owner or manual `album_user`** — a row `album_user(albumId = target, userId = target)` of **any**
   role, joined to a **non-deleted** album (`album.deletedAt IS NULL`). **Note:** the `album` table has
   **no `ownerId` column** — album ownership is represented as an `album_user` row with `role = 'owner'`
   (enforced by the `album_user_unique_owner` partial unique index), so this single branch covers both
   the owner and manual shares. The space grant never touches `album_user`.
2. **Another linking space (membership)** — `shared_space_album ⋈ shared_space_member` for
   `albumId = target`, `userId = target`, `spaceId <> exclude_space_id`.
3. **Another linking space (creator)** — `shared_space_album ⋈ shared_space.createdById` for
   `albumId = target`, `userId = target`, `spaceId <> exclude_space_id`.

Mirrors `user_has_library_path`'s membership/creator branches; its single ownership-or-share branch
replaces the library's separate `library.ownerId` ownership branch (libraries have an `ownerId` column;
albums do not). Unit-pinned per branch + the `excludeSpaceId` gating.

### 5.2 Create-side triggers (statement-level, `REFERENCING NEW TABLE AS inserted_rows`)

**`shared_space_album_after_insert_user`** — AFTER INSERT ON `shared_space_album`. Clone of
`shared_space_library_after_insert_user`:

```sql
-- grant every current member of the space access to the newly-linked album
INSERT INTO shared_space_album_user ("userId", "albumId")
SELECT DISTINCT ssm."userId", ir."albumId"
FROM inserted_rows ir
JOIN shared_space_member ssm ON ssm."spaceId" = ir."spaceId"
ON CONFLICT DO NOTHING;
-- bump the album's metadata watermark so the link/album re-flows on next sync
UPDATE album SET "updatedAt" = clock_timestamp(), "updateId" = immich_uuid_v7(clock_timestamp())
WHERE "id" IN (SELECT DISTINCT "albumId" FROM inserted_rows);
```

**`shared_space_member_after_insert_album`** — AFTER INSERT ON `shared_space_member`. Clone of
`shared_space_member_after_insert_library`: grants for every album currently linked to the joined
space + bumps those albums' `updateId`.

> Note: there is **no** `album_after_insert` analogue. The library blueprint grants `library_user` to
> the owner on library creation; we do not, because the album owner already syncs the album via the
> **personal** path (ownership/`album_user`). A grant is written **only** for space-derived access. An
> owner who is also a space member receives a grant from the create-side triggers like any member, so
> the album appears in both their personal list and the space shelf (correct).

### 5.3 Delete-side fan-out (mirror the library delete topology exactly)

Three fan-out triggers populate the two audit channels; one consumer drains the grant. The exact
write-attribution mirrors the verified library bodies (`functions.ts` `shared_space_library_delete_audit`
et al.) — get this right or revocation breaks:

- **`shared_space_album_delete_audit`** — AFTER DELETE ON `shared_space_album` (statement,
  `REFERENCING OLD TABLE AS old`). Two sections, mirroring `shared_space_library_delete_audit`:
  - **Section 1 (UNCONDITIONAL)** — `INSERT INTO shared_space_album_audit (spaceId, albumId) SELECT … FROM old;`
    This is the **only** writer of the link-removal channel, and it fires for **all three** removal
    causes — direct **unlink**, **whole-space-delete cascade**, and **album-hard-delete cascade** —
    because each deletes `shared_space_album` rows.
  - **Section 2/3 (GATED + `EXISTS(SELECT 1 FROM shared_space WHERE id = old.spaceId)` guard)** —
    `INSERT INTO shared_space_album_user_audit (albumId, userId)` per member (and the space creator)
    where `NOT user_has_album_path(albumId, userId, old.spaceId)`. The `EXISTS` guard makes section 2/3
    a no-op during whole-space delete (the BEFORE trigger owns the grant audit then). On
    **album-hard-delete** the album row is already gone, so `user_has_album_path` is false for everyone
    ⇒ grants revoked; the client is notified via section 1's link-removal. This **supersedes** the
    master doc's "album hard-delete → no audit emitted" note (which would strand a stale album on
    space-only members' devices — see §8).
- **`shared_space_member_delete_album_audit`** — AFTER DELETE ON `shared_space_member` (statement).
  Writes **only** the gated `shared_space_album_user_audit` (per album linked to the leaving member's
  space, `NOT user_has_album_path`). **No** link-removal row — the link persists for remaining members;
  the leaving client drops the whole space via the membership delete it already processes. Same
  `EXISTS(shared_space)` guard.
- **`shared_space_delete_album_audit`** — BEFORE DELETE ON `shared_space` (**row-level**, like the
  library one) so the `shared_space_album`/`shared_space_member` rows for this space are still visible.
  Writes **only** the gated `shared_space_album_user_audit` for every member/creator where
  `NOT user_has_album_path(albumId, userId, OLD.id)` — the single source of truth for the grant audit on
  whole-space delete. (The link-removal rows for this case come from section 1 of the cascade-fired
  `shared_space_album_delete_audit`, not from here.)

- **Consumer `shared_space_album_user_delete_after_audit`** — AFTER INSERT ON
  `shared_space_album_user_audit` (statement). Blindly `DELETE FROM shared_space_album_user` matching
  `(albumId, userId)`. No re-check (trusts the gate).

### 5.4 Schema-tools registration (boilerplate volume ≈ the library migration)

Per the fork's schema-tools requirements: `registerFunction()` for each of the 3 fan-out functions +
2 create-side + 1 consumer + `user_has_album_path` in `schema/functions.ts`; the corresponding
`@AfterInsertTrigger`/`@AfterDeleteTrigger`/`@BeforeDeleteTrigger` decorators on the
`SharedSpaceAlbumTable`, `SharedSpaceMemberTable`, `SharedSpaceTable`, and audit-table decorators; and
the `migration_overrides` INSERTs (one per function + trigger) in the migration with a reversible
`down()`. New fork migration in `migrations-gallery/` with a round timestamp after `1778300000000`
(e.g. `1779000000000`).

## 6. Sync wire contract (Step 0)

The library blueprint splits an in-space collection into **two families**: a grant-keyed metadata
stream (`LibrarySync` over `library_user`) and a space-keyed link stream (`SharedSpaceLibrarySync`
over `accessibleSpaces`). Albums need the same split — the album's metadata + asset-backfill watermark
is per-`(user, album)` (the grant), while the link (`spaceId`, `showInTimeline`) is per-`(space,
album)`. **A single entity cannot carry both keys**, so we have two entity families, plus the
membership/asset/exif streams personal albums already define. This is the corrected refinement of the
master doc's "4 classes": it is really **5** = libraries' 4 analogues **+** the membership stream that
libraries lack (`album_asset` is many-to-many; `asset.libraryId` is not).

### 6.1 Entity types (additions to `SyncEntityType`, `enum.ts`)

Distinct names from personal `Album*V1` so the client dispatch routes them to space Drift tables. The
asset/exif streams are **split** (`Create`/`Update`/`Backfill`) because the personal `AlbumAssetSync`
they clone is split (not a single upsert) — the client assembles the `shared_space_album` Drift row
from the metadata stream + the per-space link stream (a Sub-project B concern).

```
# metadata family (grant-keyed)         clone of personal AlbumSync
SharedSpaceAlbumV1 / SharedSpaceAlbumDeleteV1 / SharedSpaceAlbumBackfillV1
# link family (space-keyed)             clone of SharedSpaceLibrarySync
SharedSpaceAlbumLinkV1 / SharedSpaceAlbumLinkDeleteV1 / SharedSpaceAlbumLinkBackfillV1
# membership                            clone of AlbumToAssetSync
SharedSpaceAlbumToAssetV1 / SharedSpaceAlbumToAssetDeleteV1 / SharedSpaceAlbumToAssetBackfillV1
# assets (split create/update/backfill) clone of AlbumAssetSync
SharedSpaceAlbumAssetCreateV1 / SharedSpaceAlbumAssetUpdateV1 / SharedSpaceAlbumAssetBackfillV1
# exif (split create/update/backfill)   clone of AlbumAssetExifSync
SharedSpaceAlbumAssetExifCreateV1 / SharedSpaceAlbumAssetExifUpdateV1 / SharedSpaceAlbumAssetExifBackfillV1
```

…and **five** `SyncRequestType`s, mirroring the personal album's request granularity (which keeps
membership and assets as separate requests — `AlbumToAssetsV1` vs `AlbumAssetsV2`):
`SharedSpaceAlbumsV1` (metadata), `SharedSpaceAlbumLinksV1` (link), `SharedSpaceAlbumToAssetsV1`
(membership), `SharedSpaceAlbumAssetsV1` (assets), `SharedSpaceAlbumAssetExifsV1` (exif). The greenfield
streams need **no** V1/V2 legacy split — clone the **current** personal query shapes under single `…V1`
entity types (the album metadata mirrors the V1 `AlbumSync`/`SyncAlbumV1` shape A4 cloned; the asset rows
use the current `SyncAssetV2` DTO).

### 6.2 DTOs — reuse, do not redefine

- `SharedSpaceAlbumV1` (metadata) reuses **`SyncAlbumV2`** — the exact column set the metadata stream
  selects: `{id, name, description, createdAt, updatedAt, thumbnailAssetId, isActivityEnabled, order}`
  (+ `updateId` as the ack). **`SyncAlbumV2`, not `SyncAlbumV1`** — `SyncAlbumV1` carries an `ownerId`
  field, but the `album` table has no `ownerId` column (ownership is an `album_user` row) and the stream
  selects none, so `SyncAlbumV2` (identical minus `ownerId`) is the matching DTO. Delete reuses the
  `{albumId}` shape (`SyncAlbumDeleteV1`-like).
- `SharedSpaceAlbumLinkV1` is the one genuinely new DTO: `{spaceId, albumId, showInTimeline, addedById,
createdAt, updatedAt}` (mirrors `SyncSharedSpaceLibraryV1` + `showInTimeline`); link-delete
  `{spaceId, albumId}`.
- `SharedSpaceAlbumToAssetV1` reuses **`SyncAlbumToAssetV1`** `{albumId, assetId}`; delete reuses
  `SyncAlbumToAssetDeleteV1`.
- `SharedSpaceAlbumAsset(Create|Update)V1` reuse **`SyncAssetV1`** via `columns.syncAlbumAsset`
  (including the **`isFavorite` masking** — `isFavorite` is reported only when `asset.ownerId = userId`,
  else `false`, exactly as the personal album asset sync does); exif reuses **`SyncAssetExifV1`**.

Wire into the `SyncItem` discriminated union in `sync.dto.ts` (one line per entity type) with
`@ExtraModel()` so OpenAPI picks them up. Net-new DTO definitions: just the two small
`SharedSpaceAlbumLink(Delete)V1` schemas.

## 7. Sync repository classes (`sync.repository.ts`)

Two helpers. `accessibleSpaceAlbums` is the grant's logical scope (for metadata/asset upsert
filtering); it mirrors `accessibleLibraries` and **excludes soft-deleted albums** (matching the
Phase-1 read predicate and `accessibleLibraries`' `deletedAt IS NULL` handling):

```ts
// albums the user can reach via a space, excluding soft-deleted albums
export function accessibleSpaceAlbums(eb, userId) {
  return eb
    .selectFrom('shared_space_album')
    .innerJoin('album', 'album.id', 'shared_space_album.albumId')
    .select('shared_space_album.albumId as id')
    .where('album.deletedAt', 'is', null)
    .where('shared_space_album.spaceId', 'in', (e) => accessibleSpaces(e, userId));
}
```

| Class                           | Clones                   | Re-key / scope                                                    | getCreatedAfter / backfill key                                                  | getDeletes reads                                                                           |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `SharedSpaceAlbumSync`          | `AlbumSync`              | `getUpserts` over `album` ∈ `accessibleSpaceAlbums`               | **grant** `shared_space_album_user.createId` (drives asset/membership backfill) | **gated** `shared_space_album_user_audit` → `SharedSpaceAlbumDeleteV1 {albumId}`           |
| `SharedSpaceAlbumLinkSync`      | `SharedSpaceLibrarySync` | upserts over `shared_space_album` ∈ `accessibleSpaces`            | per-space (`shared_space.createId`)                                             | **ungated** `shared_space_album_audit` → `SharedSpaceAlbumLinkDeleteV1 {spaceId, albumId}` |
| `SharedSpaceAlbumToAssetSync`   | `AlbumToAssetSync`       | `album_asset` join `album_user` → **grant**                       | per-album (grant `createId`)                                                    | `album_asset_audit`, album ∈ `accessibleSpaceAlbums`                                       |
| `SharedSpaceAlbumAssetSync`     | `AlbumAssetSync`         | `getCreates`/`getUpdates`/`getBackfill`, `album_user` → **grant** | per-album (grant `createId`)                                                    | (membership-driven; `getUpdates` coupled to the `SharedSpaceAlbumToAsset` ack)             |
| `SharedSpaceAlbumAssetExifSync` | `AlbumAssetExifSync`     | `getCreates`/`getUpdates`/`getBackfill`, `album_user` → **grant** | per-album (grant `createId`)                                                    | (membership-driven; coupled to the `SharedSpaceAlbumToAsset` ack)                          |

`SharedSpaceAlbumSync.getCreatedAfter` reads the **grant** (`shared_space_album_user`, keyed
`(userId, createId)`) — the direct analogue of `LibrarySync.getCreatedAfter` over `library_user` — and
its result drives the per-album asset/membership/exif backfill loops in the handler. The **link** stream
(`SharedSpaceAlbumLinkSync`) is space-scoped with per-space backfill, exactly as `SharedSpaceLibrarySync`.

> **Hybrid clone gotcha.** `SharedSpaceAlbumSync` borrows `getCreatedAfter`/`getUpserts` from `AlbumSync`
> but its **`getDeletes` follows the `LibrarySync` pattern** — reading the gated grant-revocation audit
> (`shared_space_album_user_audit`) **directly**. There is deliberately **no** `SharedSpaceAlbumUserSync`
> (the grant is never streamed as rows — the absorbed invariant), so unlike personal albums (where
> `AlbumUserSync` handles grant changes) the metadata-delete is driven straight off the grant audit, as
> libraries do. Do **not** copy `AlbumSync.getDeletes` (which reads `album_audit` and assumes a separate
> grant-sync class).

> **Checkpoint coupling (inherited, must be preserved).** Personal `AlbumAssetSync.getUpdates` /
> `AlbumAssetExifSync.getUpdates` gate on `album_asset.updateId <= albumToAssetAck.updateId` — asset
> updates are only sent for assets the client already knows about via the membership stream. The space
> clones must thread the `SharedSpaceAlbumToAsset` ack through the same way; a test pins it.

> **Write-amplification, accepted (documented).** Because `album_asset` is many-to-many, an asset in
> two linked albums (or album + direct-add) is streamed per `(album, asset)` — the same amplification
> `SharedSpaceAssetSync` already accepts. The client dedupes via `ON CONFLICT` on the asset row. We do
> **not** engineer a cross-album dedup in v1; a test pins idempotent re-delivery.

## 8. Edge cases & invariants (from the master doc) → how A handles each

| Case                                            | Handling                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Link album → members get assets                 | create-side trigger grants all members; backfill streams assets keyed off grant `createId`.                                                                                                                                                                                                                                  |
| Member joins space with pre-linked albums       | `shared_space_member_after_insert_album` grants for all linked albums; backfill on next sync.                                                                                                                                                                                                                                |
| Unlink album from space                         | `shared_space_album_delete_audit`: ungated link-removal (all members drop `(S,A)`) + gated grant revocation (members w/o other path lose backfill).                                                                                                                                                                          |
| Remove photo from album                         | `album_asset_audit` → grant-scoped `getDeletes` emits membership delete; photo leaves album grid + timeline (unless another path keeps it).                                                                                                                                                                                  |
| Member leaves space                             | `shared_space_member_delete_album_audit`: gated grant revocation; client drops whole space via membership delete (no per-album event needed).                                                                                                                                                                                |
| Whole-space delete                              | BEFORE-DELETE row trigger writes the **gated grant audit** (single source on this path); the **link-removal** rows come from the cascade-fired `shared_space_album_delete_audit` section 1; `exclude_space_id = OLD.id`.                                                                                                     |
| **Album hard-delete**                           | FK cascades `shared_space_album` → fires `shared_space_album_delete_audit`; album row gone ⇒ `user_has_album_path` false for all ⇒ grants revoked + clients notified. **Supersedes** the master doc's "no audit emitted" note (which would strand a stale album on space-only members' devices). Pinned by a dedicated test. |
| Album in two linking spaces; member in only one | grant survives (single `(userId, albumId)` PK); unlink from one space → `user_has_album_path(…, excludeThisSpace)` finds the other ⇒ grant kept; link-removal only for the unlinked space's shelf.                                                                                                                           |
| Manual `album_user` + space grant               | leaving the space deletes only `shared_space_album_user`; the `album_user` row is **untouched** (separate-table invariant — asserted).                                                                                                                                                                                       |
| Concurrency race (member-insert + link)         | same documented low-probability hazard as `library_user`; pinned by an annotated test, not fixed in v1.                                                                                                                                                                                                                      |
| Absorbed invariant                              | members receive `SharedSpaceAlbum*V1`, never personal `AlbumV1`; asserted in sync E2E.                                                                                                                                                                                                                                       |
| Member with both `album_user` AND a space grant | correctly appears in **both** the personal album list (personal `AlbumV1` via `album_user`) and the space shelf (`SharedSpaceAlbum*V1` via the grant) — independent paths; unlinking the space removes only the shelf entry, never the personal share.                                                                       |
| Soft-deleted album (`album.deletedAt`)          | excluded from `accessibleSpaceAlbums` (so metadata/asset upserts stop), matching the Phase-1 read predicate and `accessibleLibraries`' `deletedAt IS NULL` handling.                                                                                                                                                         |
| `isFavorite` of a synced album asset            | reported only when `asset.ownerId = userId`, else `false` — inherited from the personal album asset sync's masking; a member never sees another user's favorite flag.                                                                                                                                                        |

## 9. Dispatch, checkpoint & OpenAPI wiring

- `sync.service.ts`: add the **five** request types (`SharedSpaceAlbumsV1` metadata,
  `SharedSpaceAlbumLinksV1` link, `SharedSpaceAlbumToAssetsV1` membership, `SharedSpaceAlbumAssetsV1`
  assets, `SharedSpaceAlbumAssetExifsV1` exif) to `SYNC_TYPES_ORDER` **after** `SharedSpaceLibrariesV1`
  (metadata + link before membership/assets/exif); add the five handler methods, cloning the personal
  album handlers (`syncAlbumsV1` → metadata; `syncSharedSpaceLibrariesV1` → link; `syncAlbumToAssetsV1`
  → membership; `syncAlbumAssetsV2` → assets; `syncAlbumAssetExifsV1` → exif), swapping the repo accessor
  to `syncRepository.sharedSpaceAlbum*` and the entity types to `SharedSpaceAlbum*`. The
  membership/asset/exif per-album backfill loops key off `sharedSpaceAlbum.getCreatedAfter` (the grant
  watermark); the asset/exif `getUpdates` thread the `SharedSpaceAlbumToAsset` ack. The
  `onAuditTableCleanup` calls were already wired in A1.
- `sync.repository.ts`: the five classes are instantiated in the `SyncRepository` constructor (A1 wired
  the two stub classes; A4 wired the other three).
- OpenAPI: `cd server && pnpm build && pnpm sync:open-api && make open-api` (regen **both** TS SDK and
  Dart client — the Dart types are Sub-project B's contract).

## 10. Testing strategy (TDD; every row is RED-first)

- **Unit — `user_has_album_path()`** (`sync`/repo spec, mocked or small): each branch (ownership /
  `album_user` any-role / other-space membership / other-space creator) + `excludeSpaceId` gating.
- **Unit — sync predicates**: `accessibleSpaceAlbums` membership; `getCreatedAfter` ordering by
  `createId`, `afterCreateId` filtering, empty-for-no-access; set-equality with the Phase-1 read
  predicate (no drift).
- **Medium — triggers & grant** (`server/test/medium/specs/sync/shared-space-album-user.spec.ts`,
  modeled on the `library_user` suite): create-side fan-out counts + `updateId` bumps + multi-path
  dedup (`ON CONFLICT`); delete-side revoke-iff-no-other-path; **manual `album_user` untouched**;
  whole-space delete cascade ordering; **album hard-delete via cascade** (the §8 superseding case);
  zero-member/zero-album no-ops; concurrency-race doc test.
- **Medium — sync streams**: `getUpserts` re-delivery after a grant (asserted independently of
  `getCreatedAfter`); membership/asset/exif backfill per-album; removal via `album_asset_audit`;
  set-equality between the stream contents and the access predicate.
- **Medium — the two delete families are distinct** (the topology guard): unlink emits a
  `SharedSpaceAlbumLinkDeleteV1` to all members **and** a (gated) `SharedSpaceAlbumDeleteV1` only to
  members with no other path; a member in two spaces linking the album gets the link-delete for the
  unlinked space but **keeps** the metadata + grant (other path); the album-owner member gets the
  link-delete but keeps the personal album.
- **Medium — inherited behaviors that must survive the clone**: (a) the asset/exif `getUpdates` ↔
  `SharedSpaceAlbumToAsset`-ack coupling (updates sent only for assets the client already knows);
  (b) `isFavorite` masked to `false` for non-owner members; (c) soft-deleted album excluded from upserts;
  (d) a member holding **both** `album_user` and a space grant receives both personal `AlbumV1` and
  `SharedSpaceAlbum*V1` (no suppression).
- **E2E — sync** (`e2e/`): the three `library_user` scenarios re-cast — (1) re-add to a space, (2)
  first-time invite to a space with pre-linked albums, (3) album linked to a space the user is already
  in — assert `SharedSpaceAlbum*V1` events arrive and the album does **not** arrive as personal
  `AlbumV1` (absorbed). Regression: existing album/library/space/sync suites stay green.
- **CI gates (real gates):** `tsc --noEmit` directly, `make check-server`, `eslint --max-warnings 0`,
  OpenAPI regen for both clients, full `test.yml`.

## 11. Decomposition into `/impl-loop` slices

Each slice is RED → GREEN → REFACTOR; later slices depend on earlier ones.

- **A1 — Grant + audit tables.** `shared_space_album_user`, `shared_space_album_audit`,
  `shared_space_album_user_audit`: table decorators + fork migration + `migration_overrides` + `down()`.
  RED: table-shape / FK-cascade medium tests.
- **A2 — `user_has_album_path()` + create-side triggers.** The function + the two create-side triggers
  (grant fan-out + `updateId` bump). RED: per-branch path tests; create-side fan-out + dedup + bump tests.
- **A3 — Delete-side fan-out + consumer.** The three fan-out triggers + the grant consumer. RED:
  revoke-iff-no-other-path, `album_user`-untouched, space-delete cascade, album-hard-delete, member-leave.
- **A4 — Wire contract + sync classes.** The entity types (two families + membership/asset/exif), the
  reused DTOs + the one new `SharedSpaceAlbumLink(Delete)V1` schema, `accessibleSpaceAlbums`, and the
  **five** sync repository classes (`SharedSpaceAlbumSync` ← `AlbumSync`; `SharedSpaceAlbumLinkSync` ←
  `SharedSpaceLibrarySync`; `…ToAssetSync` ← `AlbumToAssetSync`; `…AssetSync` ← `AlbumAssetSync` with
  the split create/update/backfill; `…AssetExifSync` ← `AlbumAssetExifSync`). **Locks Step 0** (the
  wire contract). This is the largest slice — an `/impl-loop` run may sub-split it per class. RED:
  `getCreatedAfter`/`getUpserts`/`getDeletes` stream tests per class + the two-delete-families guard +
  set-equality with the access predicate.
- **A5 — Dispatch + checkpoint + OpenAPI + E2E.** `SYNC_TYPES_ORDER` (four request types), the four
  handlers (with the ToAsset-ack threading), audit cleanup for both audit tables, regen both clients.
  RED: sync E2E (3 scenarios + absorbed invariant).

Sequencing: strictly A1 → A5. A4 is the point at which Sub-project B can begin against the regenerated
Dart SDK (the compression option in the mobile companion doc).

## 12. Open items to confirm during the plan

- **Audit topology** (§4–5): the two-audit split + which trigger writes which audit, validated against
  the live `library_user` migration during A1–A3 (the highest-novelty area; pin every cell with a test).
- **Two-family wire contract → client assembly**: the client builds its `shared_space_album` Drift row
  from the metadata stream (`SharedSpaceAlbumV1`) + the per-space link stream (`SharedSpaceAlbumLinkV1`,
  carrying `showInTimeline`). Confirm this assembly with the mobile consult when regenerating the Dart
  SDK — it's the Sub-project B contract (the resolution of the master doc's "exact entity-type set" open
  question).
- **`album_asset_audit` multi-reader scoping**: confirm the grant-scoped `getDeletes` does not interfere
  with the personal `AlbumToAssetSync` reader (idempotent for users on both paths).
- **`getByAlbumIdWithFaces`-style helpers**: confirm any new repository read methods are registered in
  `test/medium.factory.ts`.

## 13. Rollback

Additive in the `library_user` sense: the grant/audit tables + triggers can remain under an app
rollback (unread); `updateId` bumps from the running version are harmless. The migration `down()`
drops triggers, functions, `migration_overrides` rows, indexes, and the three tables. Safe to roll
forward/back without coordinated restarts.
