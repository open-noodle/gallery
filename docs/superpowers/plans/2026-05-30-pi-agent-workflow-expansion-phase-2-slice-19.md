# Pi Agent Workflow Expansion (Phase 2) — Slice 19 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a `readAlbum` handler to the contract fixture (returns the album members +
current cover) and a `validateAlbumSetCover` mirroring the real DTO, so Slice 20's `run()`
tests catch a wrong-shape `album.setCover` op in L2. Fixture-only slice.

**Spec scope:** Slice 19 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Verified contracts:**

- `album.setCover` op = `{ type:'album.setCover', summary?, targetKind:'existing_album',
targetId, assetIds: uniqueCoverAssetIds (1-500 unique uuids), payload:{} }`. The cover is
  the ASSET SELECTION (`assetIds:[coverId]`), NOT a payload field.
- `readAlbum` success returns the album detail (incl. `assetIds` + `albumThumbnailAssetId`).

**Files:**

- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

## Implementation (exact)

### A. `contract-fixtures.mjs`

Add the `album.setCover` validator (register it in the existing `ALBUM_OP_VALIDATORS`
alongside `album.removeAssets`):

```js
const validateAlbumSetCover = (op) => {
  if (op.targetKind !== 'existing_album') fail('album.setCover requires targetKind "existing_album"');
  if (!op.targetId) fail('album.setCover requires targetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('album.setCover payload must be empty');
  if (!Array.isArray(op.assetIds) || op.assetIds.length === 0)
    fail('album.setCover requires a non-empty cover assetIds');
  if (op.assetIds.length > 500) fail('album.setCover assetIds exceeds 500');
};
```

In `ALBUM_OP_VALIDATORS`, add: `'album.setCover': validateAlbumSetCover,`.

Add a `readAlbum` handler in the `handlers` object (near `listAlbums`):

```js
    readAlbum: (args) => {
      const album = albums.find((candidate) => candidate.id === args?.albumId);
      if (!album) fail(`album not found: ${args?.albumId}`);
      return {
        id: album.id,
        albumName: album.albumName,
        assetIds: album.assetIds ?? [],
        albumThumbnailAssetId: album.albumThumbnailAssetId ?? null,
      };
    },
```

(`albums` is already destructured from config; an album may now carry `assetIds` +
`albumThumbnailAssetId`.)

### B. `contract-fixtures.test.mjs` tests (red → green)

- [ ] `readAlbum`: `makeContractClient({ albums:[{ id:'alb-1', albumName:'Family',
assetIds:['00000000-0000-4000-8000-000000000001'], albumThumbnailAssetId:'00000000-0000-4000-8000-000000000001' }] })`
      → `client.call('readAlbum', { albumId:'alb-1' })` returns `{ id:'alb-1', albumName:'Family',
assetIds:['…001'], albumThumbnailAssetId:'…001' }`; unknown id throws `/album not found/i`.
- [ ] `proposeAlbumOperations` with an `album.setCover` op:
  - `{ type:'album.setCover', targetKind:'existing_album', assetIds:['…001'] }` (no targetId) rejects `/targetId/i`
  - `{ type:'album.setCover', targetKind:'existing_album', targetId:'…001', assetIds:['…002'] }` ACCEPTED → `.plan.id==='plan-1'`
  - `{ type:'album.setCover', targetKind:'existing_album', targetId:'…001', assetIds:[] }` rejects `/assetId|cover/i`
  - `{ type:'album.setCover', targetKind:'asset_batch', targetId:'…001', assetIds:['…002'] }` rejects `/existing_album/i`
  - `{ type:'album.setCover', targetKind:'existing_album', targetId:'…001', assetIds:['…002'], payload:{ x:1 } }` rejects `/payload/i`
- [ ] `assert.equal(KNOWN_OPERATION_TYPES.has('album.setCover'), true)` (already true; lock it).
- [ ] Run RED → implement A → GREEN.

## Edge cases (covered above)

- cover is the ASSET SELECTION (`assetIds`), NOT a payload field — payload stays empty.
- `uniqueCoverAssetIds` max 500; a single-element array is normal.
- additive: existing `album.removeAssets`/space/asset validators + `readAlbum` unknown-id
  guard stay green; `listAlbums` unchanged.

## Acceptance

- The fixture returns a configurable `readAlbum` and throws on a wrong-shape `album.setCover`
  op; Slice 20's `run()` tests can rely on both.
- `mise exec -- pnpm --dir agent-runner test` green.

## Commit

- One commit: `test(agent): contract fixture readAlbum + album.setCover validator (phase 2 slice 19)`.
