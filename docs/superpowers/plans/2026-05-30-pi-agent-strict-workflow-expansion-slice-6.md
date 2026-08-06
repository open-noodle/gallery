# Workflow Expansion — Slice 6: `archive_assets` execution

> Implement test-first. The L2 fixture is the contract-faithful fake client.

**Goal:** Add `run()` to `archive-assets.mjs`: resolve the source via the shared
resolver → `proposeAssetBatchFromSelection({ action: asset.setArchive{archived}, selectionHandleId })`
→ `gatePlanResult` → success copy. Map `handoff`/`empty`/tool-error to
`handoff_open`/`needs_input`/`failed`. No raw asset ids ever reach the model
(selection handle only).

**Spec scope:** Slice 6. **Depends on:** Slice 5 (router), the shared resolver
(Slices 2-4), `gatePlanResult`/`safeFailureText` (`plan-gate.mjs`), the
contract-faithful `makeContractClient` (Slice 1). Verified contract:
`proposeAssetBatchFromSelection` action `{ type:'asset.setArchive', archived:boolean }`

- `selectionHandleId`; result gated via `plan.id`/`planId`.

## Design — `run({ client, slots, signal })`

Mirrors `add-photos-to-album.mjs` minus the album-resolve step (no target):

```
const archived = Boolean(slots?.archived);
const sourceDescription = clean(slots?.sourceDescription);

// 1. Resolve the source into a selection handle (shared resolver).
let resolution;
try {
  resolution = await resolveAssetSource({ client, sourceDescription, signal });
} catch (error) {
  return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
}
if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
if (resolution.status === 'empty') {
  return needsInput({ text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?` });
}
const { selectionHandleId, assetCount } = resolution;

// 2. Propose a batch archive over the handle (no raw ids).
let planResult;
try {
  planResult = await client.call(
    'proposeAssetBatchFromSelection',
    {
      summary: archived ? 'Archive matching photos.' : 'Unarchive matching photos.',
      action: { type: 'asset.setArchive', archived },
      selectionHandleId,
    },
    { signal },
  );
} catch (error) {
  return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
}

// 3. Gate on a persisted plan id.
const verb = archived ? 'archive' : 'unarchive';
return gatePlanResult({
  planResult,
  planTool: 'proposeAssetBatchFromSelection',
  successText: `I prepared a plan to ${verb} ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
  successSummary: { workflowKind: KIND, assetCount, target: verb },
});
```

Imports to add: `resolveAssetSource` (already importing `SUBJECTIVE_PATTERN` from
the resolver — extend the import), `failed`, `handoffOpen`, `needsInput` from
`../protocol.mjs`, and `gatePlanResult`, `safeFailureText` from `./plan-gate.mjs`.
Add a local `clean` is already present.

**Registry/manifest:** still NOT registered here (Slice 11 registers + manifests
all three at once). This slice is verified via direct `run()` unit tests against the
contract fixture, exactly like the `add_photos` L2 tests.

## TDD — exact tests (add to `archive-assets.test.mjs`)

Add imports: `import { makeContractClient } from './contract-fixtures.mjs';`

- [ ] **recency archive planned:** `wf.run({ client, slots: { archived: true, sourceDescription: 'my newest 50 photos' } })`
      → `status: 'planned'`. The recorded `proposeAssetBatchFromSelection` call has
      `args.action` deepEqual `{ type:'asset.setArchive', archived:true }` and
      `args.selectionHandleId === 'handle-1'`. Assert `JSON.stringify(client.calls).includes('assetIds') === false` (no raw ids).
- [ ] **unarchive polarity:** `wf.run({ client, slots: { archived: false, sourceDescription: 'my newest 5 photos' } })`
      → planned; recorded action `{ type:'asset.setArchive', archived:false }`.
- [ ] **date source plans (resolver integration):** `wf.run({ client, slots: { archived: true, sourceDescription: 'my photos from 2024' } })`
      → planned; the `searchAssets` call carries the 2024 `takenAfter/takenBefore` filters.
- [ ] **subjective → handoff:** `wf.run({ client, slots: { archived: true, sourceDescription: 'the best ones' } })`
      → `status: 'handoff_open'`; no `proposeAssetBatchFromSelection` call.
- [ ] **zero assets → needs_input (no empty plan):** `wf.run({ client: makeContractClient({ handleAssetCount: 0 }), slots: { archived: true, sourceDescription: 'my newest 10 photos' } })`
      → `status: 'needs_input'`; no `proposeAssetBatchFromSelection` call.
- [ ] **planless propose → failed (gate), no success copy:** drive a client whose
      `proposeAssetBatchFromSelection` returns `{ status: 'success', plan: {} }` (no id)
      via `makeContractClient({ planResult: { status: 'success', plan: {} } })`
      → `status: 'failed'`; `outcome.text` does NOT contain "prepared"/"archive ".
- [ ] **search tool error → failed:** a client whose `searchAssets` throws → `status: 'failed'`.

(Use `makeContractClient({ planResult })` for the planless case — confirm the
fixture's `ok(config)` returns `config.planResult` when provided; it does.)

## Edge cases covered

- archive/unarchive polarity in the op payload.
- recency AND date sources both resolve and plan (resolver integration).
- subjective → handoff (never a fabricated batch).
- zero-asset → needs_input (never an empty plan).
- gate blocks success copy when the plan has no id.
- selection handle only; no raw asset ids in model-facing args.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior tests still green.
- `typeof wf.run === 'function'` now (update the Slice-5 router-only assertion to
  expect a function, since run lands this slice).

## Commit

`feat: add archive_assets execution (batch setArchive plan) (slice 6)`
