# Pi Agent Strict/Hybrid Workflow Expansion — Slice 1 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a reusable, **contract-faithful** fake MCP client
(`contract-fixtures.mjs`) that enforces the real server tool DTO shapes, so a
call the live server would reject also throws in unit tests. Migrate the existing
`add_photos_to_album` test onto it to prove the helper matches reality.

**Spec scope:** Slice 1 of
`docs/superpowers/specs/2026-05-30-pi-agent-strict-workflow-expansion-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `node:assert/strict`,
`pnpm --dir agent-runner test`. No server/runtime/network side effects (pure
in-memory fake client).

## Why this slice first

Every later slice's L2 tests drive a workflow's `run()` against a fake MCP client.
The `add_photos` bug shipped because its fake client **ignored call args**, hiding
that the workflow sent shapes the real tools reject. This helper centralizes a fake
client that mirrors the real DTOs (`server/src/dtos/agent-tool.dto.ts`,
`server/src/dtos/agent-operation.dto.ts`), so that class of bug fails in unit tests.

## Real contracts to mirror (verified against the server DTOs)

- `resolveAssetSearchFilters` — `z.strictObject` with `people/tags/albums/spaces/
cameraMakes/cameraModels/lensModels/scope/toolCallId`; **no `query`**.
- `searchAssets` — `mode` default `metadata`; metadata mode **rejects `query`**
  (`query` only for smart/description/ocr/filename); `detail ∈ {ids,handle,summary,
metadata}`; returns a `selectionHandle` for `detail:'handle'`.
- `proposeAssetBatchFromSelection` — `{ summary?, action, selectionHandleId }`;
  `action` is a discriminated union on `type`: `asset.setFavorite{favorite:boolean}`,
  `asset.setArchive{archived:boolean}`, `asset.addTag{tagId? , tagName?}` (exactly
  one), `asset.rotate{…}`, `asset.updateMetadata{…}`.
- `proposeAlbumOperations` — `{ summary, operations:[…] }`; `operations` is the full
  `AgentGalleryOperationInput` union (album._, space._ incl.
  `space.updateDetails/addMembers/removeMembers/updateMemberRole`, asset.\*).
- `proposeAlbumFromSelection` — `{ summary?, albumName, description?, selectionHandleId }`.
- Read tools used by workflows: `listAlbums`, `listSpaces`, `readSpace`,
  `searchUsers`.

## File structure

- Create `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
  - Exports `makeContractClient(config?)` returning `{ calls, call(name, args) }`.
  - Exports `KNOWN_OPERATION_TYPES` and `KNOWN_BATCH_ACTION_TYPES` sets for reuse.
- Create `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`
  - Asserts the fake client throws on the rejected shapes and accepts valid ones.
- Edit `agent-runner/src/strict-workflows/workflows/add-photos-to-album.test.mjs`
  - Replace the local `fakeClient` with `makeContractClient`; keep all assertions.

## `makeContractClient` contract (what it enforces)

`call(name, args)` records the call then, by `name`:

- `listAlbums` → `{ albums }` (config, default `[{ id:'alb-1', albumName:'Family' }]`).
- `listSpaces` → `{ spaces }` (config; strip `members` from the summary view).
- `readSpace` → the configured space incl. `members` (each `{ userId, name, role }`),
  or throws "space not found" if `args.spaceId` unknown.
- `searchUsers` → `{ users }` (config, default one user).
- `resolveAssetSearchFilters` → **throws** if `'query' in args` (Unrecognized key);
  else `{ resolvedFilters: {} }`.
- `searchAssets` → **throws** if `(args.mode ?? 'metadata') === 'metadata' &&
args.query !== undefined`; **throws** if `args.detail` set and not in the enum;
  else `{ selectionHandle: { id:'handle-1', assetCount: config.handleAssetCount ?? 20 } }`.
- `proposeAssetBatchFromSelection` → validate `args.action` (below) and require a
  non-empty `args.selectionHandleId`; return `config.planResult ?? { status:'success',
plan:{ id:'plan-1' } }`.
- `proposeAlbumOperations` → require `Array.isArray(args.operations)` and every
  `op.type ∈ KNOWN_OPERATION_TYPES` (else throw "unknown operation type"); return
  the plan result.
- `proposeAlbumFromSelection` → require `selectionHandleId` and `albumName`; return
  the plan result.
- default → `throw new Error('unexpected ' + name)`.

Action validation (`proposeAssetBatchFromSelection.action`):

- `asset.setFavorite` → `typeof favorite === 'boolean'`.
- `asset.setArchive` → `typeof archived === 'boolean'`.
- `asset.addTag` → exactly one of `tagName`/`tagId` (`Number(tagName!==undefined) +
Number(tagId!==undefined) === 1`), else throw.
- unknown `type` → throw "unknown batch action".

Config knobs (all optional): `albums`, `spaces`, `users`, `handleAssetCount`,
`planResult`. Defaults make the common "happy path" work with no config.

## TDD steps

### Task 1: contract-fixtures helper (red → green)

- [ ] Write `contract-fixtures.test.mjs` with these cases (run red first — module
      doesn't exist yet):
  - throws on `resolveAssetSearchFilters({ query: 'x' })`; returns filters for `{}`.
  - throws on `searchAssets({ query: 'x' })` (metadata default); throws on
    `searchAssets({ mode:'metadata', query:'x' })`; **accepts**
    `searchAssets({ mode:'smart', query:'x', detail:'handle' })`; accepts
    `searchAssets({ mode:'metadata', order:'desc', limit:20, detail:'handle' })`
    and returns a `selectionHandle`.
  - throws on `searchAssets({ detail:'bogus' })`.
  - `proposeAssetBatchFromSelection`: accepts `setArchive{archived:true}`,
    `setFavorite{favorite:false}`, `addTag{tagName:'T'}`; **throws** on
    `addTag{}` (neither), `addTag{tagName:'T',tagId:uuid}` (both),
    `{type:'asset.bogus'}` (unknown), and missing `selectionHandleId`.
  - `proposeAlbumOperations`: accepts `[{type:'album.addAssets',…}]` and
    `[{type:'space.updateDetails',…}]`; throws on `[{type:'bogus.op'}]`.
  - `proposeAlbumFromSelection`: accepts `{albumName:'A',selectionHandleId:'h'}`;
    throws on missing `albumName` or `selectionHandleId`.
  - `readSpace` returns members for a known id; throws for unknown id.
  - `calls` records each invocation in order.
- [ ] Implement `contract-fixtures.mjs` to pass. Run green.

### Task 2: migrate add_photos test (green stays green)

- [ ] Replace `add-photos-to-album.test.mjs`'s local `fakeClient` with
      `makeContractClient` (same config surface: `albums`, `handleAssetCount`,
      `planResult`). Keep every existing assertion unchanged.
- [ ] Run `pnpm --dir agent-runner test` — full suite green (was 322; now 322 + new
      contract-fixtures cases, add_photos unchanged count).

## Edge cases (must be in the tests)

- `resolveAssetSearchFilters` rejects `query` (the live bug).
- metadata `searchAssets` rejects `query`; smart mode accepts it.
- `asset.addTag` exactly-one-of `tagName`/`tagId` (neither and both rejected).
- unknown batch action type and unknown operation type rejected.
- `proposeAlbumOperations` accepts `space.*` ops (proves group 2 path is valid).
- `readSpace` unknown id throws (so membership guards can rely on it).

## Acceptance

- `contract-fixtures.mjs` exports `makeContractClient` importable by later slices.
- `add_photos_to_album` test runs on `makeContractClient` and stays green (proves
  the helper matches the real contracts add_photos already exercises live).
- `pnpm --dir agent-runner test` green; no `src/` runtime changes (test-only slice).

## Commit

- One commit: `test: add contract-faithful fake MCP client and migrate add_photos onto it`.
