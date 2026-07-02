# Slice 4 — LOW#1: mask owner `isFavorite` in shared-space sync

**Finding:** LOW · `server/src/repositories/sync.repository.ts` (`SharedSpaceAssetSync`, ~:977-1017) —
the fork's shared-space asset-sync select streams the asset owner's raw `isFavorite` to every space
member. Upstream v3 stopped doing this for the equivalent `AlbumAssetSync` / `PartnerAssetsSync`
selects in the same file (`CASE WHEN asset.ownerId = <syncing userId> THEN asset.isFavorite ELSE
false END`, or a hard `false` when the class only ever streams non-owned rows).

## Problem

`SharedSpaceAssetSync` (`sync.repository.ts:977-1017`) has three methods, each selecting
`columns.syncAsset` — the raw column list that **includes** `asset.isFavorite`
(`server/src/database.ts:497-518`):

- `getBackfill` (~:980-987) — initial full sync of a space's assets.
- `getCreates` (~:992-1000) — new (space, asset) join rows.
- `getUpdates` (~:1005-1014) — metadata changes on assets the client already has.

None of the three masks `isFavorite` by row-owner, so a space member syncing another member's asset
receives that owner's true favorite flag — a privacy leak of personal metadata (what someone else
favorited) to other space members.

## How the sibling selects already solve this (same file)

`AlbumAssetSync` (`getBackfill`/`getUpdates`/`getCreates`, ~:216-276) selects
`columns.syncAlbumAsset` — identical to `syncAsset` **minus** `isFavorite` — then adds it back
explicitly, masked:

```ts
.select((eb) =>
  eb
    .case()
    .when('asset.ownerId', '=', userId)
    .then(eb.ref('asset.isFavorite'))
    .else(eb.val(false))
    .end()
    .as('isFavorite'),
)
```

`PartnerAssetsSync` (`getBackfill`/`getUpsert`, ~:641-673) selects `columns.syncPartnerAsset` (also
`isFavorite`-less) and adds a hard `sql.val(false).as('isFavorite')` — no `CASE` needed because that
class only ever streams a partner's (non-owned) assets, so the syncing user can never be the owner.

`SharedSpaceAssetSync` is shaped like `AlbumAssetSync`, not `PartnerAssetsSync`: a space can contain
assets owned by the syncing user (own asset shared into their own space) **and** assets owned by other
members, so it needs the full `CASE WHEN ownerId = <syncing userId> ...` mask, not a hard `false`.

### The syncing-user column to compare `asset.ownerId` against

- `getCreates(options: SyncQueryOptions)` and `getUpdates(options: SyncQueryOptions, ack)` already
  receive `options.userId` (`SyncQueryOptions` has `userId`) — same as `AlbumAssetSync.getCreates` /
  `getUpdates`, which do `const userId = options.userId;` then reference `userId` in the `CASE`.
- `getBackfill(options: SyncBackfillOptions, spaceId: string)` does **not** currently receive a
  `userId` — `SyncBackfillOptions` (`nowId`, `afterUpdateId?`, `beforeUpdateId`) has no `userId` field.
  `AlbumAssetSync.getBackfill(options, albumId, userId)` solves this with an explicit third
  parameter, filled at the call site from `options.userId` (`sync.service.ts:1059-1063`,
  `this.syncRepository.albumAsset.getBackfill({...}, album.id, options.userId)`). The shared-space
  call site (`sync.service.ts:606-609`) currently calls `getBackfill(options, space.id)` — it has
  `options.userId` available (the enclosing `syncSharedSpaceAssetsV1(options: SyncQueryOptions, ...)`
  parameter), it's just not threaded through. Mirroring `AlbumAssetSync` exactly: add a third
  `userId: string` parameter to `SharedSpaceAssetSync.getBackfill` and pass `options.userId` at the
  call site.

This touches one extra call site in `sync.service.ts` (a one-line argument addition, no logic change)
— it is the same shape of change `AlbumAssetSync`'s backfill already required, not a shared projection
helper used by any owner-facing (non-shared-space) sync path. Nothing else in the class or its callers
changes.

## Minimal implementation

1. `server/src/database.ts` — add a `syncSharedSpaceAsset` column list identical to `syncAlbumAsset`
   (i.e. `syncAsset` minus `isFavorite`), next to the existing `syncAlbumAsset`/`syncPartnerAsset`
   entries, for naming clarity (mirrors the one-list-per-sync-class convention already in the file).
2. `server/src/repositories/sync.repository.ts`, `SharedSpaceAssetSync`:
   - `getBackfill(options: SyncBackfillOptions, spaceId: string, userId: string)` — add the `userId`
     param; swap `columns.syncAsset` → `columns.syncSharedSpaceAsset`; add the masked `CASE` select
     (identical shape to `AlbumAssetSync.getBackfill`).
   - `getCreates(options: SyncQueryOptions)` — `const userId = options.userId;`; same swap + masked
     select.
   - `getUpdates(options: SyncQueryOptions, ack)` — `const userId = options.userId;`; same swap +
     masked select.
   - Update the three `@GenerateSql({ params: [...] })` decorators: `getBackfill`'s gains a third
     `DummyValue.UUID` (matching `AlbumAssetSync.getBackfill`'s decorator).
3. `server/src/services/sync.service.ts`, `syncSharedSpaceAssetsV1` (~:606-609) — pass `options.userId`
   as the third argument to `this.syncRepository.sharedSpaceAsset.getBackfill(...)`.

No DTO/controller/OpenAPI change — the wire shape of `isFavorite` (a `boolean`) is unchanged; only its
resolved value differs. No SQL-doc (`mise //:sql`) run in this slice per the working agreements — the
`@GenerateSql` decorator param-list edit is captured in source now and picked up by the deferred final
`mise //:sql` gate.

## Edge cases

- **Owner-owned asset unaffected** — auth.user syncing their own asset (whether in their own space or
  a space they're a member of) still gets the true `isFavorite` value (`ownerId = userId` branch of the
  `CASE`).
- **Multiple owners in one space** — each member is masked per row-owner: a space containing assets
  from owners A and B, synced by member C, masks both A's and B's favorite flags to `false`; if C is
  also an owner of some assets in that space, C's own rows stay true (`CASE` evaluates per row).
- **Delete/checkpoint rows unaffected** — `SharedSpaceToAssetSync.getDeletes`/`getBackfill` (join-row
  id/assetId/spaceId only, no `isFavorite` column at all) and the backfill-checkpoint bookkeeping in
  `syncSharedSpaceAssetsV1` are untouched; only the `isFavorite` projection in the three
  `SharedSpaceAssetSync` methods changes.
- **Create vs. update vs. backfill path** — all three methods that project `isFavorite` get the same
  mask (a member joining a pre-existing space via backfill must not learn another owner's favorite
  flag from the initial full sync any more than from the incremental create/update streams).

## Related, explicitly out of scope

`LibraryAssetSync` (`sync.repository.ts:1194-1221`, `getBackfill`/`getUpserts`) also selects raw
`columns.syncAsset` (including `isFavorite`) scoped only by `accessibleLibraries(userId)`, with no
per-row ownership mask — the same bug shape, but a **different** finding/file scope than LOW#1 (which
names `sync.repository.ts:996`, inside `SharedSpaceAssetSync`). Not touched here; flagged in the final
report as a candidate follow-up finding, not fixed in this slice.

## Files

- `server/src/database.ts` — new `syncSharedSpaceAsset` column list.
- `server/src/repositories/sync.repository.ts` — `SharedSpaceAssetSync.getBackfill`/`getCreates`/
  `getUpdates` masked `isFavorite` projection.
- `server/src/services/sync.service.ts` — thread `options.userId` into the `getBackfill` call site.
- `server/test/medium/specs/sync/sync-shared-space-asset.spec.ts` — new RED-first tests.
- `docs/superpowers/plans/2026-07-02-rolling-rebase-audit-slice-04.md` — this plan.
- `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` — LOW#1 bullet → append
  `— FIXED (slice S4)`.

## Tests (medium/DB, RED-first)

Test path: `server/test/medium/specs/sync/sync-shared-space-asset.spec.ts` (existing file — the
correct home per its `describe(SyncRequestType.SharedSpaceAssetsV1, ...)` block; mirrors the sibling
`isFavorite`-masking tests already in `sync-album-asset.spec.ts` / `sync-partner-asset.spec.ts`).

New tests:

1. **`masks isFavorite for a foreign-owned asset shared into the space`** — owner A (`peer`) creates a
   space, favorites an asset, shares it in; member B (`auth.user`, Editor) syncs
   `SharedSpaceAssetsV1` fresh (create path) → the emitted row's `isFavorite === false`.
   Expected RED: current code selects raw `asset.isFavorite` → row has `isFavorite: true`.
2. **`syncs true isFavorite for an asset owned by the requesting user`** — auth.user owns the space and
   favorites their own asset shared into it → the emitted row's `isFavorite === true`.
   (Regression guard — passes before and after; proves the mask doesn't over-mask the owner's own
   rows.)
3. **`masks isFavorite on the update path for a foreign-owned asset`** — mirrors the existing
   `'re-emits an asset on the update path...'` test but cross-owner: owner A's asset (favorite `false`
   initially) is shared into a space auth.user (member, non-owner) belongs to; after the initial ack,
   the DB is updated so the asset becomes a favorite (`isFavorite: true` on the `asset` row, owned by
   A); the next sync's `SharedSpaceAssetUpdateV1` row for that asset must still read `isFavorite:
   false` for member B (`getUpdates`'s mask).
   Expected RED: current `getUpdates` selects raw `asset.isFavorite` → row has `isFavorite: true`.

Edge cases covered: owner-owned unaffected (test 2); cross-owner masked on both the create path
(test 1) and the update path (test 3, exercising `getUpdates`'s separate `CASE`); delete/checkpoint
rows are untouched by construction (no code path change there, not a new test needed — the existing
`'does not emit assets from spaces the user has no access to'` test already proves scoping is
unaffected). Multiple-owners-in-one-space per-row masking follows from test 1 + test 2 both using the
same `CASE WHEN asset.ownerId = ...` expression evaluated per row — not re-tested with a third
combined scenario to keep the slice's new-test count proportionate to the existing file's style.

## GREEN

`cd server && pnpm test:medium -- --run test/medium/specs/sync/sync-shared-space-asset.spec.ts`

Regression:

- `cd server && npx tsc --noEmit -p tsconfig.json` (grep `error TS` — none new; 3 pre-existing
  unrelated failures in `exif/audio-video.spec.ts`, `Cannot find ffprobe`, environmental, ignored).

## Commit

```
fix(server): mask owner isFavorite in shared-space sync (LOW #1)
```

Body: `SharedSpaceAssetSync`'s backfill/create/update selects streamed the asset owner's raw
`isFavorite` to every space member. Apply the same `CASE WHEN asset.ownerId = <syncing userId> THEN
asset.isFavorite ELSE false END` mask `AlbumAssetSync` already uses, threading the syncing user's id
through `getBackfill`'s new third parameter (mirroring how `AlbumAssetSync.getBackfill` does it) and
`options.userId` for `getCreates`/`getUpdates`.
