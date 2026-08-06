# Slice 2.3 — `lock_assets` workflow + routing guards

Spec: Phase 2. Depends on: 2.1 (`lockAssets` scope), 2.2 (`asset.setVisibility` op +
its registration in the `proposeAssetBatchFromSelection` action union). Adds the
agent-runner workflow that resolves a bounded source and proposes moving it to the Locked
folder. One-directional (lock only; no unlock).

TEMPLATE: `agent-runner/src/strict-workflows/workflows/archive-assets.mjs` (read it fully —
`lock_assets` is a near-exact mirror minus polarity). TDD throughout.

## `lock-assets.mjs`

`KIND = 'lock_assets'`, `flow: 'hybrid'`. Mirror archive-assets.mjs:

- `match(prompt)` accepts ONLY prompts with a lock / Locked-folder / private-folder cue:
  - `LOCK_PATTERN = /\block\s+(?<source>.+)$/i` — "lock my passport scans".
  - `MOVE_TO_LOCKED = /\b(?:move|put|add)\s+(?<source>.+?)\s+(?:in|into|to)\s+(?:the\s+|my\s+)?(?:locked|private)\s+folder\b/i` — "move my passport scans to the locked folder", "put these in my private folder".
  - `HIDE_IN_LOCKED = /\bhide\s+(?<source>.+?)\s+(?:in|into)\s+(?:the\s+|my\s+)?(?:locked|private)\s+folder\b/i` — "hide these in my locked folder" (requires the folder cue).
  - Decline subjective sources via `declinesSourceFastPath` (reuse SUBJECTIVE_PATTERN +
    trip pattern, as archive does). Empty source → undefined.
- `parseSlots(rawSlots)` → `{ sourceDescription }` (mirror archive; no polarity).
- `run({ client, slots, signal, now })`:
  - `resolveAssetSource({ client, sourceDescription, signal, now })` → handoff /
    needs_input / empty handled exactly like archive.
  - propose: `client.call('proposeAssetBatchFromSelection', { summary: 'Move matching photos to the Locked folder.', action: { type: 'asset.setVisibility', visibility: 'locked' }, selectionHandleId }, { signal })`.
  - `gatePlanResult({ planResult, planTool: 'proposeAssetBatchFromSelection', successText: 'I prepared a plan to move ${assetCount} matching photo(s) to the Locked folder. Review the plan before applying it.', successSummary: { workflowKind: KIND, assetCount, target: 'lock' } })`.

NO continuation/disambiguation (source-based, like archive). NO runner-side
already-locked / non-owned pre-checks: those are server-enforced (the plan service's
`getAgentLockedIds` / owned-scope writable filter + `updateAll`). Document that in the
file header comment.

## Routing guards (verify by test)

- "archive these photos" → does NOT match (different verb → archive_assets).
- "hide Alex" / "hide my friend Sam" → does NOT match (no folder cue → hide_person).
- "lock my passport scans" / "move my 2024 receipts to the locked folder" / "put these in
  my private folder" → match.
- subjective source ("lock the best ones") → undefined (declines).

## Register + manifest + matrix

Import `lockAssetsWorkflow` in `registry.mjs`, add to the factory list. Regenerate the
manifest (`node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`). Add the
hand-authored Flow Ownership row "Move photos to the Locked folder | Hybrid |
`lock_assets`: …" to `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md` and
run `pnpm --dir server sync:agent-capabilities` so the generated table + the
`agent-capability-matrix.spec` cross-check pass.

## Tests (write first — RED)

`lock-assets.test.mjs` (mirror archive-assets.test.mjs):

- match accepts the 3 cue forms; DECLINES "archive these photos", "hide Alex",
  "lock the best ones" (subjective), empty.
- parseSlots: source present → slots; missing → null.
- run (fake client mirroring archive's fake): resolved source → `proposeAssetBatchFromSelection`
  called with `action: { type:'asset.setVisibility', visibility:'locked' }` + gated plan;
  resolver handoff → handoffOpen; needs_input → needsInput; empty → needsInput; plan with
  no persisted id → failed; resolver/tool throws → failed.

RED: `cd agent-runner && export PATH="$HOME/.local/share/mise/shims:$PATH" && node --test 'src/**/lock-assets.test.mjs'` → fails (absent).

## L1 / L3 scenarios (model-run deferred to RC)

Add `recall.lock.*` (the 3 cue forms) + slot fidelity + negatives protecting
`archive_assets` and `hide_person`, to `eval/scenarios/`. Add `l3.recall.lock`
ROUTING-ONLY (no `planProposed` — `lockAssets` is OFF in the eval preset → propose-blocked,
like share_album) to `l3-readonly.mjs`. Model-backed eval + baseline re-seed at RC.

## Validate

- `cd agent-runner && node --test 'src/**/lock-assets.test.mjs'` → green; full
  `node --test 'src/**/*.test.mjs'` → no regressions (manifest/registry/matrix tests pass).
- Server: `pnpm exec vitest run --config test/vitest.config.mjs src/services/agent-capability-matrix.spec.ts` → green; `npx tsc --noEmit` clean.
- No OpenAPI change (no new op — `asset.setVisibility` already exists from 2.2).

## Commit

`feat(agent): lock_assets workflow (move photos to the Locked folder)`

## Out of scope

Matrix Core rows + integrated verify + (Phase-2 push) = slice 2.4. No prettier on agent-runner/docs.
