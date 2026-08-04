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
invent a permission hierarchy that does not exist. This is enforced structurally by where the
foreign key lives (§3.2), not by UI convention.

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

**Why the join table and not `album`.** Putting placement on `shared_space_album` makes
"space albums only" a property of the schema rather than a UI rule — there is no column on `album`
to nest a personal album with. It also means one album linked into two spaces has an independent
placement in each, at no extra cost.

### 3.3 Name uniqueness needs two partial indexes

Gallery targets **PostgreSQL 14** (`ghcr.io/immich-app/postgres:14-vectorchord0.4.3-…` across every
compose file), so `UNIQUE NULLS NOT DISTINCT` (PG15+) is unavailable. A single unique index over
`(spaceId, parentId, lower(name))` would let two _root_ folders share a name, because PG treats
`NULL` parents as distinct. Two partial unique indexes, declared via `@Index({ unique, expression, where })`:

```
shared_space_album_folder_nested_name_key
  UNIQUE ("spaceId", "parentId", LOWER(BTRIM("name"))) WHERE "parentId" IS NOT NULL

shared_space_album_folder_root_name_key
  UNIQUE ("spaceId", LOWER(BTRIM("name")))             WHERE "parentId" IS NULL
```

The service also validates names up-front so the common case returns a clean 409 rather than
surfacing a constraint violation; the indexes are the hard guard against races.

### 3.4 Constraints enforced in the service, not the schema

- **Max depth 10.** A root folder is depth **1**, so a folder at depth 10 may hold albums but no
  subfolders. On create the check is `depth(parent) + 1 <= 10`; on move it is
  `depth(target) + 1 + height(movedSubtree) <= 10`, where `height` is 0 for a leaf folder. Albums do
  not count toward depth.
- **No cycles.** A folder may not move into itself or any descendant.
- **Same space.** A folder's parent, and an album's target folder, must belong to the same space.

### 3.5 Sync side effect worth knowing

`shared_space_album` carries `@UpdatedAtTrigger` and `@UpdateIdColumn`, so writing `folderId` bumps
`updateId` and re-emits the link row through `SharedSpaceAlbumLinkSync` to every mobile client.
`folderId` is deliberately **not** added to the sync payload, so mobile receives an idempotent
upsert of unchanged data. Harmless, but bulk reorganising churns mobile sync traffic. Covered by a
regression test (§9, scenario S-01) so a future change that _does_ add it to the payload is a
conscious decision.

## 4. API surface

New `Permission` values in `server/src/enum.ts`, following the existing `sharedSpaceAlbum.*` block:

```
SharedSpaceAlbumFolderCreate = 'sharedSpaceAlbumFolder.create',
SharedSpaceAlbumFolderUpdate = 'sharedSpaceAlbumFolder.update',
SharedSpaceAlbumFolderDelete = 'sharedSpaceAlbumFolder.delete',
```

Routes on `SharedSpaceController`, following the existing album-link routes' decorator stack
(`@Authenticated({ permission })`, `@Endpoint({ summary, history: new HistoryBuilder().added('v1').beta('v1') })`,
`@HttpCode(HttpStatus.NO_CONTENT)` on void writes):

| Method   | Path                                         | Permission                     | Service gate          |
| -------- | -------------------------------------------- | ------------------------------ | --------------------- |
| `GET`    | `/shared-spaces/:id/album-folders`           | `SharedSpaceRead`              | `requireMembership`   |
| `POST`   | `/shared-spaces/:id/album-folders`           | `SharedSpaceAlbumFolderCreate` | `requireRole(Editor)` |
| `PATCH`  | `/shared-spaces/:id/album-folders/:folderId` | `SharedSpaceAlbumFolderUpdate` | `requireRole(Editor)` |
| `DELETE` | `/shared-spaces/:id/album-folders/:folderId` | `SharedSpaceAlbumFolderDelete` | `requireRole(Editor)` |
| `PUT`    | `/shared-spaces/:id/albums/:albumId/folder`  | `SharedSpaceAlbumUpdate`       | `requireRole(Editor)` |

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
```

`SharedSpaceLinkedAlbumSchema` gains `folderId: z.string().nullable()`. Additive; mobile's generated
client ignores it.

### 4.2 The listing returns a flat list and no derived data

`GET /:id/album-folders` returns **every folder in the space as a flat array**. The client builds
the tree.

It deliberately carries **no** `albumCount`, `folderCount`, or `previewAssetIds`:

- `GET /:id/albums` already returns _every_ linked album — unpaginated — each with its `folderId`
  and a **space-visible resolved cover**. `getLinkedAlbums` resolves that cover through a
  `spaceVisibilityGate` COALESCE (the "L17" fix: a raw `album.albumThumbnailAssetId` can point at a
  Hidden/Locked or since-soft-deleted asset, whose gated thumbnail request 403s and renders a broken
  tile).
- So recursive counts and the folder collage are pure functions of two arrays the client already
  holds. Computing them client-side removes a recursive-CTE lateral join **and opens no new asset
  visibility surface at all** — the folder collage can only ever show covers that
  `getLinkedAlbums` already cleared.

**Recorded dependency:** this relies on `GET /:id/albums` staying unpaginated. If pagination is ever
added there, folder counts and previews must move server-side. Noted in §11.

### 4.3 Why the album move gets its own endpoint

`SharedSpaceAlbumLinkUpdateDto` currently declares `showInTimeline` as **required**. Adding
`folderId` to it would force both fields optional, which regenerates the Dart client into
three-state territory — where `.value` throws on an absent field and `.isPresent` is required
instead. That trap has bitten this fork on rebases before. A separate
`PUT /:id/albums/:albumId/folder` leaves the existing DTO byte-identical.

### 4.4 No activity feed rows, no new socket events

Folder churn would drown `shared_space_activity`. The albums tab already refreshes via `reload()` on
mount plus `invalidateAll()`; folders ride the same path.

## 5. Behaviour specification

Every scenario below is a test. IDs are referenced from the test plan in §9.

### 5.1 Create — `F-*`

| ID   | Given                                        | When                                         | Then                                            |
| ---- | -------------------------------------------- | -------------------------------------------- | ----------------------------------------------- |
| F-01 | an editor and a space                        | create a folder named `Trips` at root        | 201; folder exists with `parentId = null`       |
| F-02 | a folder `Trips`                             | create `2026` with `parentId = Trips`        | 201; nested under `Trips`                       |
| F-03 | a root folder `Trips`                        | create another root folder `trips`           | 409 — case-insensitive collision                |
| F-04 | `Trips/2026`                                 | create root folder `2026`                    | 201 — different parents, no collision           |
| F-05 | any editor                                   | create with name `"  Trips  "`               | 201; stored as `Trips`                          |
| F-06 | any editor                                   | create with name `"   "`                     | 400 — empty after trim                          |
| F-07 | any editor                                   | create with a 129-character name             | 400                                             |
| F-08 | a folder in space A                          | create in space B with `parentId` from A     | 400 — cross-space parent                        |
| F-09 | a chain 10 deep (deepest folder at depth 10) | create a child of the depth-10 folder        | 400 — depth cap, message names the actual depth |
| F-11 | a chain 9 deep                               | create a child of the depth-9 folder         | 201 — depth 10 is allowed, the cap is inclusive |
| F-10 | any editor                                   | create with a `parentId` that does not exist | 400                                             |

### 5.2 Rename — `N-*`

| ID   | Given                | When                      | Then                                   |
| ---- | -------------------- | ------------------------- | -------------------------------------- |
| N-01 | `Trips`              | rename to `Travel`        | 204; name updated, placement unchanged |
| N-02 | `Trips` and `Family` | rename `Family` → `trips` | 409                                    |
| N-03 | `Trips`              | rename to `Trips`         | 204 — no-op, not a self-collision      |
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
| M-07 | root `Trips`, `Archive/Trips`              | move root `Trips` into `Archive`        | 409 — name collision at destination                        |
| M-08 | folder in space A                          | move it under a folder in space B       | 400                                                        |
| M-09 | `Archive/Trips`                            | move `Trips` into `Archive` again       | 204 — idempotent no-op                                     |

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

| ID   | Given                            | When                                | Then                                               |
| ---- | -------------------------------- | ----------------------------------- | -------------------------------------------------- |
| A-01 | album A linked at root           | move A into `Trips`                 | 204; `folderId = Trips`                            |
| A-02 | album A in `Trips`               | move A to root (`folderId: null`)   | 204; `folderId = null`                             |
| A-03 | album A in `Trips`               | move A into `Trips` again           | 204 — idempotent                                   |
| A-04 | album A linked to spaces X and Y | move A into a folder in X           | 204; **A's placement in Y is unchanged**           |
| A-05 | album A linked to space X        | move A into a folder belonging to Y | 400 — cross-space folder                           |
| A-06 | album A **not** linked to X      | move A into a folder in X           | 400 — no link row to update                        |
| A-07 | album A in `Trips`               | unlink A from the space             | link row gone; no orphan; re-linking lands at root |

### 5.6 RBAC — `R-*`

| ID   | Actor            | Action                              | Then                                                         |
| ---- | ---------------- | ----------------------------------- | ------------------------------------------------------------ |
| R-01 | space **owner**  | any folder write                    | 204/201                                                      |
| R-02 | space **editor** | any folder write                    | 204/201                                                      |
| R-03 | space **viewer** | any folder write                    | 403 (`requireRole`)                                          |
| R-04 | **non-member**   | any folder write                    | 403                                                          |
| R-05 | space **viewer** | `GET /:id/album-folders`            | 200 with the folder list                                     |
| R-06 | **non-member**   | `GET /:id/album-folders`            | **403, not an empty 200**                                    |
| R-07 | space **editor** | move an album owned by someone else | 204 — space Editor is sufficient, matching `updateAlbumLink` |

R-06 is a privacy requirement, not a formality: **a folder name is itself information**
("Divorce", "Medical", "Surprise party"). Returning `[]` to a non-member would confirm the space
exists. The membership gate must precede any read.

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

## 6. Web design

### 6.1 Navigation and state

Drill-in via `?folder=<uuid>` on `/spaces/[spaceId]/albums`. `Route.viewSpaceAlbums` gains an
optional `folderId`, appended through the existing `asQueryString` helper.

An unknown or since-deleted folder id **falls back to root and strips the param** rather than
erroring — another editor deleting the folder you have open must not break your page (scenario
W-06).

### 6.2 Data loading

The page already fetches albums on mount via `getSharedSpaceAlbums`. Add a parallel
`getSharedSpaceAlbumFolders`. Both live in `$state`; the tree is a `$derived`.

### 6.3 New pure module `web/src/lib/utils/space-album-folders.ts`

No DOM, no SDK calls — straight unit tests. `space-albums-list.svelte` already does filter + sort +
group; tree logic belongs outside it.

| Function                                           | Returns                                                      |
| -------------------------------------------------- | ------------------------------------------------------------ |
| `buildFolderTree(folders)`                         | root nodes with `children`                                   |
| `getFolderPath(folders, folderId)`                 | ancestor chain for the breadcrumb, root-first                |
| `getFolderContents(tree, albums, folderId)`        | `{ folders, albums }` at this level                          |
| `getRecursiveAlbumCount(tree, albums, folderId)`   | albums anywhere in the subtree                               |
| `getFolderPreviewAssetIds(tree, albums, folderId)` | up to 4 resolved album covers from the subtree, newest first |
| `isDescendant(folders, candidateId, ancestorId)`   | guards drop targets and the picker modal                     |
| `flattenForSearch(folders, albums, query)`         | space-wide album hits, each with its path label              |

All are total functions over the two arrays the page already holds — no fetches, and they must
tolerate a `parentId` pointing at a folder absent from the list (treat as root) so a mid-flight
delete cannot throw.

### 6.4 Components

| File                                          | Change                                                                                                                |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `spaces/space-album-folder-card.svelte`       | _new_ — `SpaceCollage` + folder badge + name + recursive count; kebab: Rename / Move to folder… / Delete; drop target |
| `spaces/space-album-folder-breadcrumb.svelte` | _new_ — crumbs, each a drop target                                                                                    |
| `modals/SpaceAlbumFolderPickerModal.svelte`   | _new_ — tree picker; the moved node and its descendants rendered disabled                                             |
| `spaces/space-albums-controls.svelte`         | "New folder" button beside Create/Link, editor-gated                                                                  |
| `spaces/space-albums-list.svelte`             | folders row(s), then the album grid                                                                                   |
| `spaces/space-albums-table.svelte`            | folder rows first in List mode                                                                                        |
| `spaces/space-album-card.svelte`              | `draggable`; kebab gains "Move to folder…"                                                                            |
| `spaces/[spaceId]/albums/+page.svelte`        | folder state, handlers, folder-aware create/link                                                                      |

Reusing `SpaceCollage` is deliberate: it already renders 1 / 2–3 / 4-up layouts from
`{ id, thumbhash }[]`, has an `empty` layout for childless folders, and is unit-tested.

### 6.5 Folders vs the existing toolbar

- **Folders always render above albums**, at every level, and are never grouped.
- **Group-by** (Year / LinkedBy / Owner) regroups only the albums in the current folder.
- **Search flattens tree-wide.** A non-empty query hides the breadcrumb and folders and lists every
  matching album in the space with a `Trips › 2026` path subtitle. `?folder=` is untouched, so
  clearing the box returns you to where you were.
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
- `dragover` must `preventDefault()` for a drop to fire; the highlight ring appears on valid
  targets only.
- Optimistic local move; rollback plus `handleError` toast on failure.
- Self-drops, drops onto the current parent, and descendant drops are rejected client-side by
  `isDescendant` — **no request is fired**, so an illegal drop never shows a spinner-then-error.
- `draggable={false}` for viewers.

The kebab's "Move to folder…" path is not a fallback but the primary accessible route: HTML5 DnD
works on neither touch nor keyboard.

### 6.7 Create and link inherit the open folder

`handleCreateAlbum` and `SpaceLinkAlbumModal` both stamp new links with the currently-open
`folderId`, so a new or newly-linked album lands where you are standing.

### 6.8 Empty states

- Space with no folders: renders **exactly as today**.
- Space with no albums and no folders: today's empty state, unchanged.
- **Empty folder: its own empty state**, not the space-level one — reusing that would wrongly claim
  the space has no albums (scenario W-08).

### 6.9 Web behaviour scenarios — `W-*`

| ID   | Given                                    | When                            | Then                                                    |
| ---- | ---------------------------------------- | ------------------------------- | ------------------------------------------------------- |
| W-01 | a space with folders and root albums     | the albums tab renders          | folders render before albums                            |
| W-02 | folders `Trips`, `Archive`               | click `Trips`                   | URL gains `?folder=<Trips>`; grid shows Trips' contents |
| W-03 | inside `Trips/2026`                      | click `Trips` in the breadcrumb | navigates up one level                                  |
| W-04 | inside a folder                          | browser back                    | returns to the parent level                             |
| W-05 | a space with no folders                  | the albums tab renders          | no breadcrumb, layout identical to today                |
| W-06 | `?folder=<deleted-uuid>`                 | the page loads                  | falls back to root, param stripped, no error            |
| W-07 | inside `Trips`, group-by = Year          | the grid renders                | folders ungrouped on top; only albums grouped by year   |
| W-08 | an empty folder                          | the page renders                | folder-specific empty state, **not** the space one      |
| W-09 | inside `Trips`, query `ven`              | typing in search                | breadcrumb + folders hidden; space-wide hits with paths |
| W-10 | a search is active                       | clearing the query              | returns to `Trips`                                      |
| W-11 | a viewer                                 | the page renders                | no kebabs, no New folder button, nothing draggable      |
| W-12 | dragging album A over folder `Trips`     | drop                            | `PUT …/albums/A/folder` with `{ folderId: Trips }`      |
| W-13 | dragging folder `Trips` over its child   | drop                            | rejected client-side; **no request fired**              |
| W-14 | dragging album A over its current folder | drop                            | no-op; no request fired                                 |
| W-15 | a move request fails                     | the response returns            | optimistic move rolls back; error toast shown           |
| W-16 | inside `Trips`                           | create an album                 | the new album's link carries `folderId = Trips`         |
| W-17 | the picker modal for folder `Trips`      | it opens                        | `Trips` and its descendants are disabled options        |

## 7. TDD implementation order

Each slice is **RED → GREEN → refactor**: write the listed tests first, watch them fail for the
right reason, then implement. No slice starts before the previous one is green.

| Slice | Deliverable                                              | Tests written first                                                                        |
| ----- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | Table + migration + `folderId` column                    | X-01, plus medium tests asserting both partial unique indexes reject F-03 / F-04 correctly |
| 2     | Repository CRUD, tree read, subtree/ancestor CTEs        | repository-level F-01/F-02, D-01–D-04, M-01/M-02                                           |
| 3     | Service create / rename / delete-with-promotion          | F-03–F-11, N-01–N-04, D-01–D-06                                                            |
| 4     | Service move, cycle + depth + collision guards           | M-01–M-09, C-01                                                                            |
| 5     | Album move: service + `folderId` on the listing DTO      | A-01–A-07, C-02, C-03, S-01                                                                |
| 6     | Controller + DTOs + `Permission` values; `make open-api` | R-01–R-07 at the controller-spec level                                                     |
| 7     | `space-album-folders.ts` pure module                     | every function in §6.3, including the absent-parent tolerance                              |
| 8     | Folder card, breadcrumb, picker modal                    | W-01, W-08, W-11, W-17                                                                     |
| 9     | List/table integration, controls, folder-aware create    | W-02–W-07, W-09, W-10, W-16                                                                |
| 10    | Drag and drop                                            | W-12–W-15                                                                                  |
| 11    | e2e RBAC matrix                                          | R-01–R-07 end-to-end                                                                       |

Slices 1–6 are server and independently shippable; 7–10 are web; 11 closes the loop. Slices 7 and 8
have no dependency on each other and can proceed in parallel once slice 6 lands the SDK.

## 8. Files touched

**Server**

- `src/schema/tables/shared-space-album-folder.table.ts` _(new)_
- `src/schema/tables/shared-space-album.table.ts` — `folderId`
- `src/schema/migrations-gallery/1785000000000-AddSharedSpaceAlbumFolderTable.ts` _(new)_
- `src/enum.ts` — three `Permission` values
- `src/dtos/shared-space.dto.ts` — folder DTOs; `folderId` on `SharedSpaceLinkedAlbumSchema`
- `src/repositories/shared-space.repository.ts` — folder methods, each with `@GenerateSql`
- `src/services/shared-space.service.ts` — folder service methods
- `src/controllers/shared-space.controller.ts` — five routes
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

- `i18n/en.json` — new `space_album_folder_*` keys (shared by web **and** mobile; English only,
  translations arrive via Weblate)
- `open-api/` + `packages/sdk/` — regenerated

## 9. Test plan

| Layer                   | Location                                                                                  | Scenarios                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Server unit             | `src/services/shared-space.service.spec.ts`                                               | F-\*, N-\*, M-\*, D-\*, A-\*, R-01–R-07                                        |
| Server unit             | `src/controllers/shared-space.controller.spec.ts`                                         | route wiring, param validation                                                 |
| Server medium (real DB) | `test/medium/specs/repositories/shared-space-album-folder.repository.spec.ts` _(new)_     | F-03, F-04, D-01–D-04, M-01–M-09, C-01–C-03, X-01–X-03                         |
| Server medium (sync)    | `test/medium/specs/sync/shared-space-album-link-sync.spec.ts`                             | S-01                                                                           |
| Web unit                | `src/lib/utils/space-album-folders.spec.ts` _(new)_                                       | every §6.3 function                                                            |
| Web unit                | `src/lib/components/spaces/space-album-folder-card.spec.ts` _(new)_ and siblings          | W-01, W-07, W-08, W-11, W-17                                                   |
| Web unit                | `src/routes/(user)/spaces/[spaceId]/albums/space-albums-page.spec.ts` _(exists — extend)_ | W-02–W-06, W-09, W-10, W-12–W-16                                               |
| e2e API                 | `e2e/src/specs/server/api/shared-space-album-folder.e2e-spec.ts` _(new)_                  | R-01–R-07, mirroring the existing `shared-space-album.e2e-spec.ts` role matrix |

**S-01** (new, sync regression): moving an album between folders re-emits its
`SharedSpaceAlbumLinkSync` row with **unchanged payload content** — asserting `folderId` is absent
from the sync payload, so a future change that adds it is deliberate rather than accidental.

### 9.1 Test traps this repo has already been bitten by

These apply directly and must be respected:

- **Web vitest has no `clearMocks`.** Mock history leaks across a file — reset explicitly per test.
- **`$t()` returns raw keys** in web unit tests. Assert on keys (`space_album_folder_empty`), never
  on English strings.
- **`SpaceCollage` renders `alt=""` images**, so `queryByRole('img')` against it is an assertion
  that _cannot fail_. Count `<img>` elements in the container, exactly as the existing
  `space-collage.spec.ts` does.
- **`pnpm test -- --run <path>` silently drops the path filter** — verify the intended file
  actually ran.
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

| Risk                                                                       | Mitigation                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Client-side counts and previews assume `GET /:id/albums` stays unpaginated | Recorded in §4.2. If pagination lands, both move server-side.               |
| Reorganising churns mobile sync with no-op link upserts                    | Idempotent by construction; pinned by S-01.                                 |
| Cycle-check TOCTOU under concurrent moves                                  | Ancestor CTE + `FOR UPDATE` inside the mutating transaction (C-01).         |
| Hand-rolled DnD is the least-tested interaction surface                    | W-12–W-15 cover it, and the menu path is a complete, accessible substitute. |
| A deep tree makes the breadcrumb overflow on narrow screens                | Breadcrumb collapses middle crumbs to `…` past 4 levels.                    |
| Depth cap of 10 is a judgement call                                        | Enforced in one service constant, trivially raised.                         |

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
