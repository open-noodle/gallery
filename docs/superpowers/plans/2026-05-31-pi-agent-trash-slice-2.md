# Trash + Duplicate Cleanup — Slice 2 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-31-pi-agent-trash-and-duplicate-cleanup-design.md`
Slice: 2 — MCP operation-contract example for `asset.trash` + agent-runner contract fixture.

Builds on Slice 1 (the server `asset.trash` operation exists, gated, High risk,
reversible apply). This slice exposes it to the model and to the agent-runner test
fixture so Slice 3's workflow can be tested.

## Goal

- A `proposeAlbumOperations` example showing a reversible, High-risk `asset.trash`
  operation, so the LLM path can propose trash correctly.
- The agent-runner contract fixture recognizes `asset.trash` (in
  `KNOWN_OPERATION_TYPES` + a `validateAssetTrash` validator) so Slice 3 can L2-test
  the `trash_assets` workflow.

## Implementation

### 1. `server/src/services/agent-mcp-tool-contract.service.ts`

Add an `asset.trash` operation example to the `proposeAlbumOperations` examples,
modelled on the `AssetRemoveTag` example (~`:1653`). It has NO payload,
`targetKind: 'asset_batch'`, an asset selection (selectionHandle), and
`riskLevel: 'high'`. Use reversible language in any summary ("Move … to Trash
(recoverable)"). Do NOT add it to the batch-action hint lists (`:2222`, `:2310`) —
those are for `proposeAssetBatchFromSelection`; trash is an operation.

If `agent-mcp-tool-contract.service.spec.ts` enumerates op-type examples, add the
matching assertion (a valid trash example parses; the example's riskLevel is high).

### 2. `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`

- `KNOWN_OPERATION_TYPES`: add `'asset.trash'`.
- Add `validateAssetTrash`, modelled on `validateAssetRemoveTag` (`:217`) but with
  NO payload:

```js
const validateAssetTrash = (op) => {
  if (op.targetKind !== 'asset_batch') fail('asset.trash requires targetKind "asset_batch"');
  if (op.targetId !== undefined) fail('asset.trash must not set targetId');
  if (op.temporaryTargetId !== undefined) fail('asset.trash must not set temporaryTargetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('asset.trash must not set a payload');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('asset.trash requires an assetSource selectionHandle');
  }
};
```

Register it in the `ALBUM_OP_VALIDATORS` map keyed by `'asset.trash'` (next to
`'asset.removeTag'`).

## TDD steps

### Task 1: failing tests (red)

- `contract-fixtures.test.mjs`: a valid `asset.trash` op passes `validateOperations`;
  rejects a `payload`, a `targetId`, wrong `targetKind`, missing/`search`-kind
  assetSource. (Red: validator not registered / unknown op type.)
- Server contract spec (if it asserts examples): a trash example is present with
  `riskLevel: 'high'`. (Red: example missing.)

### Task 2: implement (green)

Add the contract example + the fixture validator. Green:

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
/opt/homebrew/bin/mise exec -- pnpm -C server test -- --run src/services/agent-mcp-tool-contract.service.spec.ts
```

## Edge cases

- Trash example must not appear in the batch-action allowlist hints.
- The fixture rejects a trash op with a payload (trash takes none).

## Acceptance

- Agent-runner contract-fixture tests green; server contract spec green; full
  agent-runner unit suite green.
- `asset.trash` is recognized by the fixture (Slice 3 can use it).

## Commit

`feat(agent): expose asset.trash in the MCP contract + agent-runner fixture (trash slice 2)`
