# Workflow Expansion — Slice 10: `tag_assets` execution

> Implement test-first against the contract-faithful fake client.

**Goal:** Add `run()` to `tag-assets.mjs`: resolver →
`proposeAssetBatchFromSelection({ action: asset.addTag{tagName}, selectionHandleId })`
→ `gatePlanResult` → copy. `handoff`/`empty`/tool-error →
`handoff_open`/`needs_input`/`failed`. No raw ids. Exactly one tag field
(`tagName`).

**Spec scope:** Slice 10. **Depends on:** Slice 9 (router), resolver, plan-gate,
contract fixtures. Verified contract: `asset.addTag` requires **exactly one** of
`tagName`/`tagId` (the fixture rejects both/neither); we always send `tagName`.

## Design — `run({ client, slots, signal })`

Same structure as `archive-assets.mjs run()`:

- `const tagName = clean(slots?.tagName);` `const sourceDescription = clean(slots?.sourceDescription);`
- Defensive: if `!tagName`, `return needsInput({ text: 'What tag would you like to add?' })`
  (parseSlots already requires it, but never plan a tagless add).
- resolve → handoff/empty as in archive.
- propose: `action: { type: 'asset.addTag', tagName }`, `selectionHandleId`,
  summary `Tag matching photos with "${tagName}".`
- gate with `planTool: 'proposeAssetBatchFromSelection'`,
  successText `I prepared a plan to tag ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} with "${tagName}". Review the plan before applying it.`,
  successSummary `{ workflowKind: KIND, assetCount, label: tagName }`.

Imports to add: `resolveAssetSource` (extend resolver import), `failed`,
`handoffOpen`, `needsInput`, `gatePlanResult`, `safeFailureText`.

Registry/manifest: still NOT registered (Slice 11).

## TDD — exact tests (add to `tag-assets.test.mjs`)

Add `import { makeContractClient } from './contract-fixtures.mjs';`. Flip the
router-only assertion to `typeof wf.run === 'function'`.

- [ ] **recency tag planned (exactly one tag field, no raw ids):**
      `wf.run({ client, slots: { sourceDescription: 'my newest 20 photos', tagName: 'Travel' } })`
      → `planned`; recorded `proposeAssetBatchFromSelection.args.action` deepEqual
      `{ type:'asset.addTag', tagName:'Travel' }` (so `tagId` is absent → exactly one);
      `selectionHandleId === 'handle-1'`; `JSON.stringify(client.calls).includes('assetIds') === false`.
- [ ] **multi-word tag honored:** `{ sourceDescription: 'my newest 20', tagName: 'Spring Break' }`
      → action `{ type:'asset.addTag', tagName:'Spring Break' }`.
- [ ] **subjective → handoff:** `{ sourceDescription: 'the best ones', tagName: 'Travel' }`
      → `handoff_open`; no propose call.
- [ ] **zero assets → needs_input:** `makeContractClient({ handleAssetCount: 0 })`,
      `{ sourceDescription: 'my newest 10 photos', tagName: 'Travel' }`
      → `needs_input`; no propose call.
- [ ] **planless → failed (gate), no success copy:** `makeContractClient({ planResult: { status: 'success', plan: {} } })`
      → `failed`; `outcome.text` does not match `/prepared|tag /i`.
- [ ] **search error → failed:** client whose `searchAssets` throws → `failed`.

## Edge cases covered

- add-only `asset.addTag` with exactly one tag field (`tagName`).
- multi-word tag honored.
- subjective → handoff; zero → needs_input; gate blocks planless success copy;
  selection handle only (no raw ids).

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green; `typeof wf.run === 'function'`.

## Commit

`feat: add tag_assets execution (batch addTag plan) (slice 10)`
