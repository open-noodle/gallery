# Space Album Folders — Design

**Date:** 2026-08-04
**Status:** Approved, ready for planning
**Scope:** Server + web. Mobile stays folder-blind (own follow-up spec).

## 1. Summary

Members of a Shared Space can organise the space's linked albums into folders. Folders nest to
arbitrary depth, exist only inside a space, and carry no permissions of their own — a folder is
visible to exactly the people who can already see the space, and editable by exactly the people who
can already curate its album links.

Folders are **purely visual organisation**. They do not affect the space timeline, asset visibility,
album membership, or any RBAC decision.

### Goals

- Create, rename, move, and delete folders inside a space.
- Move albums into and out of folders, by drag-and-drop and by an accessible menu path.
- Deleting a folder promotes its direct children one level up; it never deletes albums.
- Drill-in navigation with a breadcrumb, deep-linkable via a query parameter.
- Search continues to find albums anywhere in the space, regardless of folder.

### Non-goals

Listed in full in §12. The load-bearing one: **personal albums get no folders.** Space albums
inherit a coherent permission set from their space; personal albums do not, so nesting them would
invent a permission hierarchy that does not exist. This is enforced by where the foreign key lives
(§3.2) — there is no column on `album` with which to nest a personal album.

## 2. Terminology

| Term           | Meaning                                                                                 |
| -------------- | --------------------------------------------------------------------------------------- |
| **Folder**     | A row in `shared_space_album_folder`. Belongs to exactly one space.                     |
| **Root**       | The virtual top level of a space. Represented by `parentId = NULL` / `folderId = NULL`. |
| **Album link** | A row in `shared_space_album` — the join between a space and an album.                  |
| **Placement**  | An album link's `folderId`. Per space, so one album in two spaces has two placements.   |
| **Subtree**    | A folder plus all its descendants.                                                      |
| **Editor**     | Space role Owner or Editor — `requireRole(auth, spaceId, SharedSpaceRole.Editor)`.      |

## 3. Data model

### 3.1 New table `shared_space_album_folder`

`server/src/schema/tables/shared-space-album-folder.table.ts`, with the migration in
`server/src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts` (round
timestamp per the fork convention; the highest existing fork migration is `1784800000000`).

| Column        | Type                | Notes                                                                              |
| ------------- | ------------------- | ---------------------------------------------------------------------------------- |
| `id`          | uuid PK             | `@PrimaryGeneratedColumn()`                                                        |
| `spaceId`     | uuid FK             | → `shared_space`, `onDelete: 'CASCADE'`                                            |
| `parentId`    | uuid FK, nullable   | → **self**, `onDelete: 'CASCADE'`. Same shape as `TagTable.parentId`.              |
| `name`        | `character varying` | Stored trimmed. See §3.3.                                                          |
| `createdById` | uuid FK, nullable   | → `user`, `onDelete: 'SET NULL'`                                                   |
| `createdAt`   | timestamptz         | `@CreateDateColumn()`                                                              |
| `updatedAt`   | timestamptz         | `@UpdateDateColumn()` + `@UpdatedAtTrigger('shared_space_album_folder_updatedAt')` |
| `createId`    | uuid                | `@CreateIdColumn({ index: true })`                                                 |
| `updateId`    | uuid                | `@UpdateIdColumn({ index: true })`                                                 |

`createId` / `updateId` are unused by web. They are a deliberate two-column hedge so the mobile
parity spec can add a sync entity without a second migration.

Non-unique indexes: `spaceId`, and `parentId WHERE "parentId" IS NOT NULL`.

### 3.2 New column on `shared_space_album`

```ts
@ForeignKeyColumn(() => SharedSpaceAlbumFolderTable, { nullable: true, onDelete: 'SET NULL' })
folderId!: string | null;
```

`NULL` means the album sits at the space root.

**Why the join table and not `album`.** Putting placement on `shared_space_album` makes "space
albums only" a property of the schema rather than a UI rule. It also means one album linked into two
spaces has an independent placement in each, at no extra cost.

### 3.2.1 Cross-space placement is enforced in the service, not the schema — deliberately

The single-column FK does not prevent a row where `shared_space_album.spaceId ≠ folder.spaceId`.
The textbook fix is a composite FK `(spaceId, folderId) → (spaceId, id)`, backed by a redundant
`UNIQUE (spaceId, id)` on the folder table.

**That fix is not available on PG14.** A composite FK with `ON DELETE SET NULL` nulls _every_
referencing column, including `spaceId` — which is `NOT NULL` and half of `shared_space_album`'s
composite primary key, so the delete would error. Per-column `ON DELETE SET NULL (folderId)` is
PG15+. The alternative, `NO ACTION`, would make the promote-transaction mandatory but risks tripping
on cascade ordering when a whole space is deleted.

**Decision:** keep the single-column FK, enforce same-space in the service (§3.4), and pin the
invariant with medium tests P-07 and A-05 rather than a constraint. Revisit if the minimum
PostgreSQL version ever moves to 15.

### 3.3 Name uniqueness needs two partial indexes

Gallery targets **PostgreSQL 14** (`ghcr.io/immich-app/postgres:14-vectorchord0.4.3-…` across every
compose file), so `UNIQUE NULLS NOT DISTINCT` (PG15+) is unavailable. A single unique index over
`(spaceId, parentId, lower(name))` would let two _root_ folders share a name, because PG treats
`NULL` parents as distinct. Two partial unique indexes — `IndexOptions` in `@immich/sql-tools@0.5.2`
accepts `unique`, `expression` and `where` together, so both are declarable:

```
shared_space_album_folder_nested_name_key
  UNIQUE ("spaceId", "parentId", LOWER(BTRIM("name"))) WHERE "parentId" IS NOT NULL

shared_space_album_folder_root_name_key
  UNIQUE ("spaceId", LOWER(BTRIM("name")))             WHERE "parentId" IS NULL
```

**The database is authoritative on case folding.** Postgres `LOWER()` and JavaScript
`.toLowerCase()` disagree on locale-sensitive pairs (Turkish dotted/dotless I among others). Any
client-side duplicate-name hint is advisory only; the server always re-checks and the index is the
final word.

**The service's collision pre-check must exclude the row being modified.** Renaming `Trips` to
`Trips`, or moving a folder into the parent it already has, are no-ops (N-03, M-09) — but a naive
`SELECT … WHERE LOWER(BTRIM(name)) = $1 AND "parentId" = $2` finds the row **itself** and would
reject them. The pre-check carries `AND id <> :folderId`. The indexes are unaffected: an `UPDATE`
that does not change the indexed value conflicts with nothing.

### 3.4 Constraints enforced in the service, not the schema

- **Max depth 10.** A root folder is depth **1**, so a folder at depth 10 may hold albums but no
  subfolders. On create the check is `depth(parent) + 1 <= 10`; on move it is
  `depth(target) + 1 + height(movedSubtree) <= 10`, where `height` is 0 for a leaf folder. Albums do
  not count toward depth.
- **Max 500 folders per space.** The web client fetches every folder in the space on page load
  (§4.2); the cap is what makes that safe rather than merely likely. One constant beside the depth
  cap.
- **No cycles.** A folder may not move into itself or any descendant.
- **Same space.** A folder's parent, and an album's target folder, must belong to the same space.
- **Name pre-check excludes self** (§3.3).

### 3.5 Sync side effect worth knowing

`shared_space_album` carries `@UpdatedAtTrigger` and `@UpdateIdColumn`, so writing `folderId` bumps
`updateId` and re-emits the link row through `SharedSpaceAlbumLinkSync` to every mobile client.
`folderId` is deliberately **not** added to the sync payload, so mobile receives an idempotent
upsert of unchanged data. Harmless, but bulk reorganising churns mobile sync traffic. Covered by
regression test S-01 so a future change that _does_ add it to the payload is a conscious decision.

## 4. API surface

New `Permission` values in `server/src/enum.ts`, following the existing `sharedSpaceAlbum.*` block:

```
SharedSpaceAlbumFolderCreate = 'sharedSpaceAlbumFolder.create',
SharedSpaceAlbumFolderUpdate = 'sharedSpaceAlbumFolder.update',
SharedSpaceAlbumFolderDelete = 'sharedSpaceAlbumFolder.delete',
```

Routes on `SharedSpaceController`, following the existing album-link routes' decorator stack
(`@Authenticated({ permission })`,
`@Endpoint({ summary, history: new HistoryBuilder().added('v1').beta('v1') })`,
`@HttpCode(HttpStatus.NO_CONTENT)` on void writes):

| Method   | Path                                         | Permission                     | Service gate          |
| -------- | -------------------------------------------- | ------------------------------ | --------------------- |
| `GET`    | `/shared-spaces/:id/album-folders`           | `SharedSpaceRead`              | `requireMembership`   |
| `POST`   | `/shared-spaces/:id/album-folders`           | `SharedSpaceAlbumFolderCreate` | `requireRole(Editor)` |
| `PATCH`  | `/shared-spaces/:id/album-folders/:folderId` | `SharedSpaceAlbumFolderUpdate` | `requireRole(Editor)` |
| `DELETE` | `/shared-spaces/:id/album-folders/:folderId` | `SharedSpaceAlbumFolderDelete` | `requireRole(Editor)` |
| `PUT`    | `/shared-spaces/:id/albums/:albumId/folder`  | `SharedSpaceAlbumUpdate`       | `requireRole(Editor)` |

**Modified:** `PUT /shared-spaces/:id/albums/:albumId` (link) gains an **optional `folderId` query
parameter**. See §4.4.

### 4.1 DTOs

In `server/src/dtos/shared-space.dto.ts`, zod schemas with `.meta({ id })` + `createZodDto`,
matching the file's existing style.

```ts
SharedSpaceAlbumFolderSchema = {
  id: string,
  spaceId: string,
  parentId: string | null,
  name: string,
  createdById: string | null,
  createdAt: date-time,
  updatedAt: date-time,
}

SharedSpaceAlbumFolderCreateSchema = { name: string (1..128), parentId?: uuidv4 | null }
SharedSpaceAlbumFolderUpdateSchema = { name?: string (1..128), parentId?: uuidv4 | null }
  // .refine: at least one key present
SharedSpaceAlbumFolderMoveAlbumSchema = { folderId: uuidv4 | null }

SharedSpaceAlbumFolderParamSchema = { id: uuidv4, folderId: uuidv4 }
SharedSpaceAlbumLinkQuerySchema    = { folderId?: uuidv4 }   // §4.4
```

`SharedSpaceLinkedAlbumSchema` gains `folderId: z.string().nullable()`. Additive; mobile's generated
client ignores it.

### 4.2 The listing returns a flat list and no derived data

`GET /:id/album-folders` returns **every folder in the space as a flat array**, and only folders of
that space (asserted by R-08). The client builds the tree.

It deliberately carries **no** `albumCount`, `folderCount`, or `previewAssetIds`:

- `GET /:id/albums` already returns _every_ linked album — unpaginated — each with its `folderId`
  and a **space-visible resolved cover**. `getLinkedAlbums` resolves that cover through
  `spaceVisibilityGate` (exported from `src/utils/shared-space-album-scope.ts`) in a COALESCE — the
  "L17" fix: a raw `album.albumThumbnailAssetId` can point at a Hidden/Locked or since-soft-deleted
  asset, whose gated thumbnail request 403s and renders a broken tile.
- So recursive counts and the folder collage are pure functions of two arrays the client already
  holds. Computing them client-side removes a recursive-CTE lateral join **and opens no new asset
  visibility surface at all** — the folder collage can only ever show covers that `getLinkedAlbums`
  already cleared.

**Recorded dependency:** this relies on `GET /:id/albums` staying unpaginated, and on the 500-folder
cap (§3.4). If pagination lands there, counts and previews move server-side. Noted in §11.

### 4.3 Why the album move gets its own endpoint

`SharedSpaceAlbumLinkUpdateDto` currently declares `showInTimeline` as **required**. Adding
`folderId` to it would force both fields optional, which regenerates the Dart client into
three-state territory — where `.value` throws on an absent field and `.isPresent` is required
instead. That trap has bitten this fork on rebases before. A separate
`PUT /:id/albums/:albumId/folder` leaves the existing DTO byte-identical.

### 4.4 Folder-aware linking uses a query param, not a body

The link route `PUT /:id/albums/:albumId` currently takes **no body at all**, and
`SpaceLinkAlbumModal.onSubmit` links in a loop — one call per selected album. Without a change
there, linking into the open folder would need an extra `PUT …/folder` per album: double the
round-trips on a bulk link, plus a visible flash of every album landing at root first.

The fix is an **optional `folderId` query parameter**, not an optional body. A NestJS `@Body() dto`
emits `required: true` in the OpenAPI document **even when every field is optional**, so adding a
body would change the generated `linkAlbum` signature and break the Dart client's existing
no-argument call. An optional query param stays optional through codegen.

An invalid or cross-space `folderId` on the link route is rejected **before** the link is created,
so a failed link never half-succeeds (scenario A-09).

### 4.5 Exception → status mapping

`shared-space.service.ts` imports `BadRequestException`, `ForbiddenException` and
`NotFoundException`, and **never `ConflictException`** — it returns 400 even for genuine conflicts
("User is already a member of this space", line 421). This spec follows that convention rather than
introducing a second one.

| Condition                                                      | Service throws              | HTTP |
| -------------------------------------------------------------- | --------------------------- | ---- |
| Not a member of the space                                      | `ForbiddenException`        | 403  |
| Member, but below Editor                                       | `ForbiddenException`        | 403  |
| Name collision at destination                                  | `BadRequestException`       | 400  |
| Empty / whitespace-only / >128-char name                       | `BadRequestException`       | 400  |
| Folder / album / parent not found, or belongs to another space | `BadRequestException`       | 400  |
| Cycle, depth cap, folder cap                                   | `BadRequestException`       | 400  |
| Malformed uuid in a path or query param                        | zod → `BadRequestException` | 400  |

Service unit tests assert the **exception type and message**; e2e tests assert the **status code**.
The two are tied together by this table, and by nothing else.

### 4.6 No activity feed rows, no new socket events

Folder churn would drown `shared_space_activity`. The albums tab already refreshes via `reload()` on
mount plus `invalidateAll()`; folders ride the same path.

## 5. Behaviour specification

Every scenario below is a test. §10 maps each ID to exactly one owning layer.

### 5.1 Create — `F-*`

| ID   | Given                                        | When                                         | Then                                            |
| ---- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| F-01 | an editor and a space                        | create a folder named `Trips` at root        | 201; folder exists with `parentId = null`       |
| F-02 | a folder `Trips`                             | create `2026` with `parentId = Trips`        | 201; nested under `Trips`                       |
| F-03 | a root folder `Trips`                        | create another root folder `trips`           | 400 — case-insensitive collision                |
| F-04 | `Trips/2026`                                 | create root folder `2026`                    | 201 — different parents, no collision           |
| F-05 | any editor                                   | create with name `"  Trips  "`               | 201; stored as `Trips`                          |
| F-06 | any editor                                   | create with name `"   "`                     | 400 — empty after trim                          |
| F-07 | any editor                                   | create with a 129-character name             | 400                                             |
| F-08 | a folder in space A                          | create in space B with `parentId` from A     | 400 — cross-space parent                        |
| F-09 | a chain 10 deep (deepest folder at depth 10) | create a child of the depth-10 folder        | 400 — depth cap, message names the actual depth |
| F-10 | any editor                                   | create with a `parentId` that does not exist | 400                                             |
| F-11 | a chain 9 deep                               | create a child of the depth-9 folder         | 201 — depth 10 is allowed, the cap is inclusive |
| F-12 | a space with 500 folders                     | create a 501st                               | 400 — folder cap                                |

### 5.2 Rename — `N-*`

| ID   | Given                | When                      | Then                                   |
| ---- | -------------------- | ------------------------- | -------------------------------------- |
| N-01 | `Trips`              | rename to `Travel`        | 204; name updated, placement unchanged |
| N-02 | `Trips` and `Family` | rename `Family` → `trips` | 400                                    |
| N-03 | `Trips`              | rename to `Trips`         | 204 — no-op; pre-check excludes self   |
| N-04 | `Trips`              | rename to `"  Travel  "`  | 204; stored as `Travel`                |

### 5.3 Move a folder — `M-*`

| ID   | Given                                      | When                                    | Then                                                       |
| ---- | ------------------------------------------ | --------------------------------------- | ---------------------------------------------------------- |
| M-01 | root `Trips`, root `Archive`               | move `Trips` into `Archive`             | 204; `Trips.parentId = Archive`; its subtree moves with it |
| M-02 | `Archive/Trips`                            | move `Trips` to root (`parentId: null`) | 204; back at root                                          |
| M-03 | `Trips`                                    | move `Trips` into itself                | 400                                                        |
| M-04 | `Trips/2026`                               | move `Trips` into `2026`                | 400 — descendant target                                    |
| M-05 | `Trips/2026/Italy`                         | move `Trips` into `Italy`               | 400 — deep descendant                                      |
| M-06 | a subtree of height 4, a target at depth 7 | move the subtree under the target       | 400 — `7 + 1 + 4 = 12 > 10`                                |
| M-07 | root `Trips`, `Archive/Trips`              | move root `Trips` into `Archive`        | 400 — name collision at destination                        |
| M-08 | folder in space A                          | move it under a folder in space B       | 400                                                        |
| M-09 | `Archive/Trips`                            | move `Trips` into `Archive` again       | 204 — idempotent; pre-check excludes self                  |

### 5.4 Delete promotes one level — `D-*`

| ID   | Given                                           | When           | Then                                                                |
| ---- | ----------------------------------------------- | -------------- | ------------------------------------------------------------------- |
| D-01 | `Trips` containing albums A, B                  | delete `Trips` | 204; A and B have `folderId = null`; **both albums still linked**   |
| D-02 | `Archive/Trips` containing album A              | delete `Trips` | 204; A has `folderId = Archive`                                     |
| D-03 | `Trips/2026/Italy`, album A in `Italy`          | delete `2026`  | 204; `Italy.parentId = Trips`; **A is still in `Italy`**, untouched |
| D-04 | `Trips` containing folders X, Y and albums A, B | delete `Trips` | 204; X, Y, A, B all at root                                         |
| D-05 | empty `Trips`                                   | delete `Trips` | 204                                                                 |
| D-06 | `Trips`                                         | delete twice   | second call → 400 (not found)                                       |

D-03 is the load-bearing one: **promotion is one level and shallow.** Grandchildren keep their
parents, so structure below the deleted folder survives intact.

### 5.5 Move an album — `A-*`

| ID   | Given                            | When                                              | Then                                                  |
| ---- | -------------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| A-01 | album A linked at root           | move A into `Trips`                               | 204; `folderId = Trips`                               |
| A-02 | album A in `Trips`               | move A to root (`folderId: null`)                 | 204; `folderId = null`                                |
| A-03 | album A in `Trips`               | move A into `Trips` again                         | 204 — idempotent                                      |
| A-04 | album A linked to spaces X and Y | move A into a folder in X                         | 204; **A's placement in Y is unchanged**              |
| A-05 | album A linked to space X        | move A into a folder belonging to Y               | 400 — cross-space folder (pins §3.2.1)                |
| A-06 | album A **not** linked to X      | move A into a folder in X                         | 400 — no link row to update                           |
| A-07 | album A in `Trips`               | unlink A from the space                           | link row gone; no orphan; re-linking lands at root    |
| A-08 | any editor                       | move A into a `folderId` that does not exist      | 400                                                   |
| A-09 | any editor                       | link an album with an invalid `?folderId=` (§4.4) | 400; **no link row created**                          |
| A-10 | inside folder `Trips`            | link album A with `?folderId=Trips`               | 201; link created with `folderId = Trips` in one call |

### 5.6 RBAC — `R-*`

| ID   | Actor                                   | Action                                        | Then                                                         |
| ---- | --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------ |
| R-01 | space **owner**                         | any folder write                              | 204/201                                                      |
| R-02 | space **editor**                        | any folder write                              | 204/201                                                      |
| R-03 | space **viewer**                        | any folder write                              | 403 (`requireRole`)                                          |
| R-04 | **non-member**                          | any folder write                              | 403                                                          |
| R-05 | space **viewer**                        | `GET /:id/album-folders`                      | 200 with the folder list                                     |
| R-06 | **non-member**                          | `GET /:id/album-folders`                      | **403, not an empty 200**                                    |
| R-07 | space **editor**                        | move an album owned by someone else           | 204 — space Editor is sufficient, matching `updateAlbumLink` |
| R-08 | member of spaces A+B, each with folders | `GET /A/album-folders`                        | returns **all of A's folders and none of B's**               |
| R-09 | space **viewer**                        | create a folder with a cross-space `parentId` | **403, not 400** — the role gate precedes validation         |

R-06 is a privacy requirement, not a formality: **a folder name is itself information** ("Divorce",
"Medical", "Surprise party"). Returning `[]` to a non-member would confirm the space exists. The
membership gate must precede any read.

R-08 is the cross-space read-leak test. It is the read-side counterpart to A-05.

R-09 pins gate **ordering**, mirroring how `shared-space-album.e2e-spec.ts` documents it for linking
("Gate 1 is checked BEFORE gate 2, so a space viewer … fails with 403 from the role gate"). Every
folder route runs `requireRole` / `requireMembership` **first**, so an unauthorised actor learns
nothing about whether their payload was otherwise valid.

R-07 records a deliberate decision: folders are space-scoped metadata, so any space editor may
reorganise any linked album regardless of who owns or linked it. This matches `updateAlbumLink`,
which already gates on space Editor alone.

### 5.7 Concurrency — `C-*`

| ID   | Given                      | When                                                     | Then                                                                                  |
| ---- | -------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| C-01 | root folders X and Y       | two editors concurrently move X→Y and Y→X                | one succeeds, the other 400s — **no cycle**                                           |
| C-02 | album A at root            | two editors concurrently move A to different folders     | both 204; last write wins, A has one placement                                        |
| C-03 | `Trips` containing album A | one editor deletes `Trips` while another moves A into it | either A ends at root or the move 400s; **A is never orphaned into a deleted folder** |

C-01 is a genuine TOCTOU: both ancestor checks pass before either write lands. Mitigation — the
descendant CTE runs **inside the same transaction as the `UPDATE`**, taking `FOR UPDATE` on the
moved folder's ancestor chain, so the second transaction re-reads post-commit state and rejects.

C-03 is why the promote-and-delete is one transaction, and why `folderId` is `ON DELETE SET NULL`
rather than left dangling: even if a move interleaves, the worst outcome is an album at root.

### 5.8 Cascade — `X-*`

| ID   | Given                              | When                    | Then                                                                 |
| ---- | ---------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| X-01 | a space with a 3-deep folder tree  | delete the space        | all folders gone; no constraint violation from the self-FK           |
| X-02 | album A in `Trips`, A soft-deleted | —                       | existing soft-delete trigger removes the link row; folder unaffected |
| X-03 | `Trips` containing album A         | delete album A entirely | link row cascades away; `Trips` remains, now empty                   |

`shared_space` has no `deletedAt` column — spaces are hard-deleted, so X-01 exercises a real
cascade rather than a soft-delete path.

### 5.9 Repository primitives — `P-*`

The repository owns only primitives. Promotion, guards and ordering are service concerns and are
**not** tested here (see §9).

| ID   | Primitive                                 | Asserts                                                            |
| ---- | ----------------------------------------- | ------------------------------------------------------------------ |
| P-01 | `createFolder`                            | row persisted with trimmed name and correct `spaceId` / `parentId` |
| P-02 | `getFoldersBySpace`                       | every folder of the space, none from another                       |
| P-03 | `getAncestors(folderId)` CTE              | root-first chain; single-element for a root folder                 |
| P-04 | `getSubtreeIds(folderId)` CTE             | folder plus all descendants; self-only for a leaf                  |
| P-05 | `reparentChildren(folderId, newParentId)` | direct child folders **and** album links repointed, one level only |
| P-06 | `countFoldersBySpace`                     | powers the 500 cap                                                 |
| P-07 | `setAlbumFolder`                          | writes `folderId`; rejected by same-space guard when mismatched    |

### 5.10 Web pure module — `U-*`

Unit tests for `space-album-folders.ts` (§6.3), no DOM.

| ID   | Given                                             | Then                                                                        |
| ---- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| U-01 | a flat folder list                                | `buildFolderTree` nests correctly, roots first                              |
| U-02 | a folder whose `parentId` is absent from the list | treated as root, **does not throw** (mid-flight delete)                     |
| U-03 | a 3-deep chain                                    | `getFolderPath` returns the root-first ancestor chain                       |
| U-04 | folders + albums at mixed levels                  | `getFolderContents` returns only this level                                 |
| U-05 | a subtree with albums at several depths           | `getRecursiveAlbumCount` counts the whole subtree                           |
| U-06 | a subtree with >4 albums                          | `getFolderPreviewAssetIds` returns 4, newest first                          |
| U-07 | an empty folder                                   | `getFolderPreviewAssetIds` returns `[]`                                     |
| U-08 | an album whose resolved cover is null             | skipped, not emitted as a null entry                                        |
| U-09 | a 3-deep chain                                    | `isDescendant` true for descendants, false for ancestors and self           |
| U-10 | albums across several folders                     | `flattenForSearch` matches space-wide, each with its path label             |
| U-11 | an empty query                                    | `flattenForSearch` returns no results (search is inactive, not "match all") |

## 6. Web design

### 6.1 Navigation and state

Drill-in via `?folder=<uuid>` on `/spaces/[spaceId]/albums`. `Route.viewSpaceAlbums` gains an
optional `folderId`, appended through the existing `asQueryString` helper.

An unknown or since-deleted folder id **falls back to root and strips the param** rather than
erroring — another editor deleting the folder you have open must not break your page (W-06).

### 6.2 Data loading

The page already fetches albums on mount via `getSharedSpaceAlbums`. Add a parallel
`getSharedSpaceAlbumFolders`. Both live in `$state`; the tree is a `$derived`.

### 6.3 New pure module `web/src/lib/utils/space-album-folders.ts`

No DOM, no SDK calls — straight unit tests (`U-*`). `space-albums-list.svelte` already does filter +
sort + group; tree logic belongs outside it.

| Function                                           | Returns                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `buildFolderTree(folders)`                         | root nodes with `children`                                   |
| `getFolderPath(folders, folderId)`                 | ancestor chain for the breadcrumb, root-first                |
| `getFolderContents(tree, albums, folderId)`        | `{ folders, albums }` at this level                          |
| `getRecursiveAlbumCount(tree, albums, folderId)`   | albums anywhere in the subtree                               |
| `getFolderPreviewAssetIds(tree, albums, folderId)` | up to 4 resolved album covers from the subtree, newest first |
| `isDescendant(folders, candidateId, ancestorId)`   | guards drop targets and the picker modal                     |
| `flattenForSearch(folders, albums, query)`         | space-wide album hits, each with its path label              |

All are total functions over the two arrays the page already holds — no fetches — and all must
tolerate a `parentId` pointing at a folder absent from the list (U-02).

### 6.4 Components

| File                                          | Change                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `spaces/space-album-folder-card.svelte`       | _new_ — `SpaceCollage` + folder badge + name + recursive count; kebab: Rename / Move to folder… / Delete; drop target |
| `spaces/space-album-folder-breadcrumb.svelte` | _new_ — crumbs, each a drop target; middle crumbs collapse to `…` past 4 levels                                       |
| `modals/SpaceAlbumFolderPickerModal.svelte`   | _new_ — tree picker; the moved node and its descendants rendered disabled                                             |
| `spaces/space-albums-controls.svelte`         | "New folder" button beside Create/Link, editor-gated                                                                  |
| `spaces/space-albums-list.svelte`             | folders row(s), then the album grid                                                                                   |
| `spaces/space-albums-table.svelte`            | folder rows first in List mode                                                                                        |
| `spaces/space-album-card.svelte`              | `draggable`; kebab gains "Move to folder…"                                                                            |
| `modals/SpaceLinkAlbumModal.svelte`           | passes the open folder as `?folderId=` (§4.4)                                                                         |
| `spaces/[spaceId]/albums/+page.svelte`        | folder state, handlers, folder-aware create/link                                                                      |

Reusing `SpaceCollage` is deliberate: it already renders 1 / 2–3 / 4-up layouts from
`{ id, thumbhash }[]`, has an `empty` layout for childless folders, and is unit-tested.

### 6.5 Folders vs the existing toolbar

- **Folders always render above albums**, at every level, and are never grouped.
- **Group-by** (Year / LinkedBy / Owner) regroups only the albums in the current folder.
- **Search flattens tree-wide.** A non-empty query hides the breadcrumb and folders and lists every
  matching album in the space with a `Trips › 2026` path subtitle. `?folder=` is untouched, so
  clearing the box returns you to where you were.
- **Search wins over group-by.** While a query is active the flattened results render **ungrouped**,
  even if group-by ≠ None — the path subtitle is already the organising signal, and grouping
  space-wide hits by year would bury it. Group-by resumes when the query is cleared (W-18).
- **Folder sort order:** always by name, honouring the current sort _direction_ but ignoring the
  sort _key_. `assetCount` and `mostRecentPhoto` do not map onto a folder, and folders reshuffling
  under "sort by item count" is noise.

### 6.6 Drag and drop

Hand-rolled HTML5 — no new dependency. `web/` has no DnD library and only one existing drag surface,
the file-upload overlay.

- `dataTransfer.setData('application/x-gallery-space-item', JSON.stringify({ kind, id }))`. The
  **custom MIME type is load-bearing**: `DragAndDropUploadOverlay` listens for file drags, and a
  generic payload would light it up mid-drag.
- Drop targets: folder cards, breadcrumb crumbs, and the grid background of the current folder.
- `dragover` must `preventDefault()` for a drop to fire; the highlight ring appears on valid targets
  only.
- Optimistic local move; rollback plus `handleError` toast on failure.
- Self-drops, drops onto the current parent, and descendant drops are rejected client-side by
  `isDescendant` — **no request is fired**, so an illegal drop never shows a spinner-then-error.
- A drop onto a folder that has since been deleted server-side fails the same way as any other
  failure: rollback + toast, then the folder disappears on the next refresh (W-19).
- `draggable={false}` for viewers.

The kebab's "Move to folder…" path is not a fallback but the primary accessible route: HTML5 DnD
works on neither touch nor keyboard.

### 6.7 Create and link inherit the open folder

`handleCreateAlbum` links the new album with `?folderId=<open folder>`, and `SpaceLinkAlbumModal`
passes the same param on each call in its loop — one request per album either way, no follow-up
move (§4.4).

### 6.8 Empty states

- Space with no folders: renders **exactly as today**.
- Space with no albums and no folders: today's empty state, unchanged.
- **Empty folder: its own empty state**, not the space-level one — reusing that would wrongly claim
  the space has no albums (W-08).

### 6.9 Web behaviour scenarios — `W-*`

| ID   | Given                                              | When                            | Then                                                                        |
| ---- | -------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| W-01 | a space with folders and root albums               | the albums tab renders          | folders render before albums                                                |
| W-02 | folders `Trips`, `Archive`                         | click `Trips`                   | URL gains `?folder=<Trips>`; grid shows Trips' contents                     |
| W-03 | inside `Trips/2026`                                | click `Trips` in the breadcrumb | navigates up one level                                                      |
| W-04 | inside a folder                                    | browser back                    | returns to the parent level                                                 |
| W-05 | a space with no folders                            | the albums tab renders          | no breadcrumb, layout identical to today                                    |
| W-06 | `?folder=<deleted-uuid>`                           | the page loads                  | falls back to root, param stripped, no error                                |
| W-07 | inside `Trips`, group-by = Year                    | the grid renders                | folders ungrouped on top; only albums grouped by year                       |
| W-08 | an empty folder                                    | the page renders                | folder-specific empty state, **not** the space one                          |
| W-09 | inside `Trips`, query `ven`                        | typing in search                | breadcrumb + folders hidden; space-wide hits with paths                     |
| W-10 | a search is active                                 | clearing the query              | returns to `Trips`                                                          |
| W-11 | a viewer                                           | the page renders                | no kebabs, no New folder button, nothing draggable                          |
| W-12 | dragging album A over folder `Trips`               | drop                            | `PUT …/albums/A/folder` with `{ folderId: Trips }`                          |
| W-13 | dragging folder `Trips` over its child             | drop                            | rejected client-side; **no request fired**                                  |
| W-14 | dragging album A over its current folder           | drop                            | no-op; no request fired                                                     |
| W-15 | a move request fails                               | the response returns            | optimistic move rolls back; error toast shown                               |
| W-16 | inside `Trips`                                     | create an album                 | linked with `?folderId=Trips` in a single request                           |
| W-17 | the picker modal for folder `Trips`                | it opens                        | `Trips` and its descendants are disabled options                            |
| W-18 | search active **and** group-by = Year              | the grid renders                | flattened hits render **ungrouped**; grouping returns when the query clears |
| W-19 | dragging album A onto a folder deleted server-side | drop                            | rollback + error toast; folder gone after refresh                           |
| W-20 | any folder-related surface                         | rendering                       | all strings resolve through `$t()` — no hardcoded English                   |

## 7. TDD implementation order

Each slice is **RED → GREEN → refactor**: write the listed tests first, watch them fail for the
right reason, then implement. No slice starts before the previous one is green.

| Slice | Deliverable                                                          | Tests written first                                                                  |
| ----- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1     | Table + migration + `folderId` column                                | X-01–X-03; medium tests that both partial unique indexes reject F-03 and permit F-04 |
| 2     | Repository primitives (CRUD, subtree/ancestor CTEs, reparent, count) | P-01–P-07                                                                            |
| 3     | Service create / rename / delete-with-promotion                      | F-01–F-12, N-01–N-04, D-01–D-06                                                      |
| 4     | Service move, cycle + depth + collision guards                       | M-01–M-09, C-01                                                                      |
| 5     | Album move + `folderId` on the listing DTO                           | A-01–A-08, C-02, C-03, S-01                                                          |
| 6     | Controller + DTOs + `Permission` values; `make open-api`             | R-01–R-09 at controller-spec level                                                   |
| 7     | Folder-aware link query param                                        | A-09, A-10                                                                           |
| 8     | `space-album-folders.ts` pure module                                 | U-01–U-11                                                                            |
| 9     | Folder card, breadcrumb, picker modal                                | W-01, W-08, W-11, W-17, W-20                                                         |
| 10    | List/table integration, controls, folder-aware create                | W-02–W-07, W-09, W-10, W-16, W-18                                                    |
| 11    | Drag and drop                                                        | W-12–W-15, W-19                                                                      |
| 12    | e2e RBAC matrix                                                      | R-01–R-09 end-to-end                                                                 |

Slices 1–7 are server and independently shippable; 8–11 are web; 12 closes the loop. **Slice 8 needs
only the generated types**, so it can start as soon as slice 6 lands the SDK — in parallel with
slices 7 and 9.

## 8. Files touched

**Server**

- `src/schema/tables/shared-space-album-folder.table.ts` _(new)_
- `src/schema/tables/shared-space-album.table.ts` — `folderId`
- `src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts` _(new)_
- `src/enum.ts` — three `Permission` values
- `src/dtos/shared-space.dto.ts` — folder DTOs; `folderId` on `SharedSpaceLinkedAlbumSchema`; link
  query schema
- `src/repositories/shared-space.repository.ts` — folder methods, each with `@GenerateSql`
- `src/services/shared-space.service.ts` — folder service methods
- `src/controllers/shared-space.controller.ts` — four new routes + the link query param
- `src/queries/shared.space.repository.sql` — regenerated by `make sql`

**Web**

- `src/lib/utils/space-album-folders.ts` _(new)_
- `src/lib/components/spaces/space-album-folder-card.svelte` _(new)_
- `src/lib/components/spaces/space-album-folder-breadcrumb.svelte` _(new)_
- `src/lib/modals/SpaceAlbumFolderPickerModal.svelte` _(new)_
- `src/lib/components/spaces/space-albums-{controls,list,table,album-card}.svelte`
- `src/lib/modals/SpaceLinkAlbumModal.svelte` — folder-aware linking
- `src/lib/route.ts` — `viewSpaceAlbums({ id, folderId? })`
- `src/routes/(user)/spaces/[spaceId]/albums/+page.svelte`

**Shared**

`i18n/en.json` — English only; translations arrive via Weblate. This directory is shared by web
**and** mobile. New keys:

```
space_album_folder_new                space_album_folder_rename
space_album_folder_delete             space_album_folder_delete_confirm
space_album_folder_move               space_album_folder_move_here
space_album_folder_name_label         space_album_folder_name_taken
space_album_folder_empty              space_album_folder_albums_count
space_album_folder_root               space_album_folder_depth_exceeded
space_album_folder_limit_reached      space_album_folder_error_create
space_album_folder_error_rename       space_album_folder_error_move
space_album_folder_error_delete
```

`open-api/` + `packages/sdk/` — regenerated.

## 9. Test plan

Each scenario ID has **exactly one owning layer**, with one deliberate exception: F-03 and F-04 are
owned by the service unit spec for their exception behaviour **and** by the medium spec for the
underlying index behaviour, because the whole point of §3.3 is that the two partial indexes are the
hard guard behind the service pre-check. Nothing else is duplicated. Medium tests assert persistence
and constraint
outcomes; service unit tests assert branch and exception outcomes (per §4.5); e2e tests assert
status codes and role gating.

| Layer                   | Location                                                                                  | Owns                                                                           |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Server unit             | `src/services/shared-space.service.spec.ts`                                               | F-_, N-_, M-_, D-_, A-01–A-10                                                  |
| Server unit             | `src/controllers/shared-space.controller.spec.ts`                                         | route wiring, param/query validation                                           |
| Server medium (real DB) | `test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts` _(new)_     | P-01–P-07, C-01–C-03, X-01–X-03, F-03/F-04 index behaviour                     |
| Server medium (sync)    | `test/medium/specs/sync/shared-space-album-link-sync.spec.ts`                             | S-01                                                                           |
| Web unit                | `src/lib/utils/space-album-folders.spec.ts` _(new)_                                       | U-01–U-11                                                                      |
| Web unit                | `src/lib/components/spaces/space-album-folder-card.spec.ts` _(new)_ and siblings          | W-01, W-07, W-08, W-11, W-17, W-20                                             |
| Web unit                | `src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts` _(exists — extend)_ | W-02–W-06, W-09, W-10, W-12–W-16, W-18, W-19                                   |
| e2e API                 | `e2e/src/specs/server/api/shared-space-album-folder.e2e-spec.ts` _(new)_                  | R-01–R-09, mirroring the existing `shared-space-album.e2e-spec.ts` role matrix |

**S-01** (sync regression): moving an album between folders re-emits its `SharedSpaceAlbumLinkSync`
row with **unchanged payload content** — asserting `folderId` is absent from the sync payload, so a
future change that adds it is deliberate rather than accidental.

### 9.1 Test traps this repo has already been bitten by

These apply directly and must be respected:

- **Web vitest has no `clearMocks`.** Mock history leaks across a file — reset explicitly per test.
- **`$t()` returns raw keys** in web unit tests. Assert on keys (`space_album_folder_empty`), never
  on English strings. W-20 depends on this.
- **`SpaceCollage` renders `alt=""` images**, so `queryByRole('img')` against it is an assertion
  that _cannot fail_. Count `<img>` elements in the container, exactly as the existing
  `space-collage.spec.ts` does.
- **`pnpm test -- --run <path>` silently drops the path filter** — verify the intended file actually
  ran.
- **`make sql` deletes every query file when no DB is running.** Only run it against a live dev DB.
- **`svelte-check` can scan zero files locally**, making it a push-only gate. Do not read a local
  pass as coverage.
- No new repository class is introduced, so the medium-test repository factory needs no
  registration — folder methods live on the existing `SharedSpaceRepository`.

## 10. Verification gates

```
make check-server      # tsc --noEmit
make check-web         # svelte-check + tsc
make lint-server       # eslint --max-warnings 0
make lint-web
make format-server     # prettier is a SEPARATE CI gate from eslint
make format-web
cd server && pnpm test && pnpm test:medium
cd web    && pnpm test
cd e2e    && pnpm test
make open-api          # after the DTO changes (server build first)
make sql               # requires a running dev DB
```

Prettier must also be run over this spec file — CI Docs Build is strict and reaches
`docs/superpowers/specs/`.

## 11. Risks and recorded assumptions

| Risk                                                                       | Mitigation                                                                       |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Client-side counts and previews assume `GET /:id/albums` stays unpaginated | Recorded in §4.2. If pagination lands, both move server-side.                    |
| Whole-space folder fetch on page load                                      | Bounded by the 500-folder cap (§3.4) and F-12.                                   |
| Cross-space placement is service-enforced, not schema-enforced             | Unavoidable on PG14 (§3.2.1); pinned by P-07 and A-05. Revisit at PG15.          |
| Reorganising churns mobile sync with no-op link upserts                    | Idempotent by construction; pinned by S-01.                                      |
| Cycle-check TOCTOU under concurrent moves                                  | Ancestor CTE + `FOR UPDATE` inside the mutating transaction (C-01).              |
| Hand-rolled DnD is the least-tested interaction surface                    | W-12–W-15 and W-19 cover it; the menu path is a complete, accessible substitute. |
| A deep tree overflows the breadcrumb on narrow screens                     | Middle crumbs collapse to `…` past 4 levels (§6.4).                              |
| Depth cap of 10 and folder cap of 500 are judgement calls                  | Two service constants, trivially raised.                                         |
| Locale-sensitive case folding differs between PG `LOWER()` and JS          | DB is authoritative; client checks are advisory only (§3.3).                     |

## 12. Out of scope

- **Mobile** — stays folder-blind. It keeps listing every linked album flat, which degrades
  gracefully: a mobile user sees all the albums, just not the organisation. Own spec.
- **Personal / normal albums** — no folders, by design (§1).
- **Folder-level timeline controls** — folders have no timeline semantics; per-album
  `showInTimeline` is unchanged. A one-shot bulk toggle is an easy follow-up.
- **Manual folder ordering** — folders sort by name.
- **Multi-select drag** — the space albums grid has no selection today.
- **Folder colours, icons, descriptions, covers** — the collage is derived, never chosen.
- **Folders for linked libraries** — the libraries tab is untouched.
- **Sharing or deep-linking a folder outside the space** — folders are not shareable objects.
