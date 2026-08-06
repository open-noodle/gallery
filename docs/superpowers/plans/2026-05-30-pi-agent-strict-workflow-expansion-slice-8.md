# Workflow Expansion — Slice 8: `favorite_assets` execution

> Implement test-first against the contract-faithful fake client.

**Goal:** Add `run()` to `favorite-assets.mjs`: resolver →
`proposeAssetBatchFromSelection({ action: asset.setFavorite{favorite}, selectionHandleId })`
→ `gatePlanResult` → copy. `handoff`/`empty`/tool-error →
`handoff_open`/`needs_input`/`failed`. No raw ids.

**Spec scope:** Slice 8. **Depends on:** Slice 7 (router), resolver, plan-gate,
contract fixtures. Verified contract: action `{ type:'asset.setFavorite', favorite:boolean }`.

## Design — `run({ client, slots, signal })`

Identical structure to `archive-assets.mjs run()` (resolve → propose → gate), with:

- `const favorite = Boolean(slots?.favorite);`
- propose: `action: { type: 'asset.setFavorite', favorite }`, summary
  `favorite ? 'Favorite matching photos.' : 'Unfavorite matching photos.'`.
- `const verb = favorite ? 'favorite' : 'unfavorite';`
- successText: `I prepared a plan to ${verb} ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`
- successSummary `{ workflowKind: KIND, assetCount, target: verb }`.
- gate with `planTool: 'proposeAssetBatchFromSelection'`.

Imports to add: `resolveAssetSource` (extend the resolver import), `failed`,
`handoffOpen`, `needsInput`, `gatePlanResult`, `safeFailureText`.

Registry/manifest: still NOT registered (Slice 11).

## TDD — exact tests (add to `favorite-assets.test.mjs`)

Add `import { makeContractClient } from './contract-fixtures.mjs';`. Flip the
router-only `typeof wf.run === 'undefined'` assertion to `'function'`.

- [ ] **favorite planned (no raw ids):** `wf.run({ client, slots: { favorite: true, sourceDescription: 'my newest 10 photos' } })`
      → `planned`; recorded `proposeAssetBatchFromSelection.args.action` deepEqual
      `{ type:'asset.setFavorite', favorite:true }`, `selectionHandleId === 'handle-1'`;
      `JSON.stringify(client.calls).includes('assetIds') === false`.
- [ ] **unfavorite polarity:** `wf.run({ client, slots: { favorite: false, sourceDescription: 'my newest 5' } })`
      → planned; action `{ type:'asset.setFavorite', favorite:false }`.
- [ ] **subjective → handoff:** `{ favorite: true, sourceDescription: 'the best ones' }`
      → `handoff_open`; no propose call.
- [ ] **zero assets → needs_input:** `makeContractClient({ handleAssetCount: 0 })`,
      `{ favorite: true, sourceDescription: 'my newest 10 photos' }`
      → `needs_input`; no propose call.
- [ ] **planless → failed (gate), no success copy:** `makeContractClient({ planResult: { status: 'success', plan: {} } })`
      → `failed`; `outcome.text` does not match `/prepared|favorite /i`.
- [ ] **search error → failed:** client whose `searchAssets` throws → `failed`.

## Edge cases covered

- favorite/unfavorite polarity in the op payload.
- subjective → handoff; zero → needs_input; gate blocks planless success copy;
  selection handle only.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green; `typeof wf.run === 'function'`.

## Commit

`feat: add favorite_assets execution (batch setFavorite plan) (slice 8)`
