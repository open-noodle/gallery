# Pi Agent Workflow Expansion (Phase 2) — Slice 5 Implementation Plan

> **For agentic workers:** Implement test-first where a unit gate exists; eval-scenario
> data is additive. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every source workflow advertise the entity capability and prove it. Add
`resolveAssetSearchFilters` to `requiredReadTools` for archive/favorite/tag/create_album
(add_photos already has it); broaden their classifier examples to entity sources; finish
the contract-fixture (rating-range + visibility-enum validation — caps + configurable
returns already landed in Slice 2); add L1 entity recall/slot scenarios and L3 entity
routing + plan-proposed scenarios. **Closes Phase 0.**

**Spec scope:** Slice 5 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/manifest.mjs`
- `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate, do not hand-edit)
- `agent-runner/src/strict-workflows/manifest.test.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`
- `agent-runner/eval/scenarios/classification-recall.mjs`
- `agent-runner/eval/scenarios/slot-fidelity.mjs`
- `agent-runner/eval/scenarios/l3-readonly.mjs`

## Part A — manifest (unit-gated)

The four source workflows reach the resolver, which calls `resolveAssetSearchFilters` for
entity sources. Advertise it + broaden the classifier copy.

- [ ] `archive_assets` (requiredReadTools line ~129): `['searchAssets']` →
      `['resolveAssetSearchFilters', 'searchAssets']`. classifierDescription: append
      `' or a named entity (people, place, tag, camera, rating, favorites)'` before the
      closing period. positiveExamples: append `'Archive my Berlin photos'`.
- [ ] `favorite_assets` (~166): same requiredReadTools change; classifierDescription append
      the same entity clause; positiveExamples append `'Favorite my 5-star photos'`.
- [ ] `tag_assets` (~200): same requiredReadTools change; classifierDescription append the
      entity clause; positiveExamples append `'Tag photos of Alex as Family'`.
- [ ] `create_album_from_source` (~334): same requiredReadTools change; classifierDescription
      append the entity clause; positiveExamples append `'Make an album of my Sony photos'`.
- [ ] Regenerate the mirror:
      `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`
      (writes `manifest.generated.json`). Do NOT hand-edit the JSON.
- [ ] `manifest.test.mjs`: add a test —
      `js
it('lists resolveAssetSearchFilters for every entity-source workflow', () => {
  for (const kind of ['add_photos_to_album', 'archive_assets', 'favorite_assets', 'tag_assets', 'create_album_from_source']) {
    assert.ok(getWorkflowManifestEntry(kind).requiredReadTools.includes('resolveAssetSearchFilters'), kind);
  }
});
`

(The capability-matrix doc derives only from `matrixRow`/`kind`/`flow`/`planTool`, so the
server matrix is unaffected by these field changes — no `sync:agent-capabilities` doc
change. The unit gate is the manifest mirror + the new test.)

## Part B — contract fixture (unit-gated)

`validateResolveRequest` (caps/unknown-key) and the `resolvedFilters`/`resolveResults`
config already exist (Slice 2). Add the missing filter-value validation.

- [ ] `contract-fixtures.mjs`: add `const KNOWN_VISIBILITY = new Set(['archive', 'timeline',
'hidden', 'locked']);` near `KNOWN_ASSET_TYPES`. In `validateSearchAssets`, after the
      `type` enum check, add:
      ``js
if (args.filters.rating !== undefined && args.filters.rating !== null) {
  const r = args.filters.rating;
  if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
    fail(`invalid searchAssets filter rating "${r}"`);
  }
}
if (args.filters.visibility !== undefined && !KNOWN_VISIBILITY.has(args.filters.visibility)) {
  fail(`invalid searchAssets filter visibility "${args.filters.visibility}"`);
}
``
- [ ] `contract-fixtures.test.mjs`: add tests:
  - resolver caps/shape: `resolveAssetSearchFilters({ foo: ['x'] })` rejects `/unrecognized|foo/i`;
    `({ people: Array(21).fill('x') })` rejects `/exceed|20/i`; `({ people: ['x'.repeat(121)] })`
    rejects `/120|exceed/i`; `({ people: ['Alex'] })` (default client) still deepEquals `{ resolvedFilters: {} }`.
  - configurable returns: `makeContractClient({ resolvedFilters:{ personIds:['per-1'] },
resolveResults:[{ kind:'person', query:'Alex', status:'matched', choices:[], message:'' }] })`
    → `resolveAssetSearchFilters({ people:['Alex'] })` returns `resolvedFilters` deepEqual
    `{ personIds:['per-1'] }` and `results[0].status === 'matched'`. An `ambiguous`-configured
    client returns `results[0].status === 'ambiguous'` with non-empty `choices`.
  - searchAssets value validation: with `mode:'metadata', detail:'handle'`, `filters:{ rating:0 }`
    rejects `/rating/i`; `{ rating:6 }` rejects `/rating/i`; `{ rating:null }` accepted;
    `{ visibility:'bogus' }` rejects `/visibility/i`; `{ visibility:'archive' }` accepted;
    `{ rating:5 }` accepted.
- [ ] TDD: write the searchAssets rating/visibility tests first → RED (validation absent) →
      add the two validation blocks → GREEN. The caps/configurable tests pass immediately
      (already implemented in Slice 2).

## Part C — eval scenario data (additive; validated in Part D)

- [ ] `classification-recall.mjs`: append (mirror existing `{ id, category:'recall', prompt,
expect:{ kind, slotsSurvive, slots } }` shape):
  - `recall.archive.entity` → `'archive my Berlin photos'` → `archive_assets`, `slotsSurvive:true`,
    `slots:{ archived:true, sourceDescription:/berlin photos/i }`
  - `recall.tag.entity` → `'tag photos of Alex as Family'` → `tag_assets`, `slotsSurvive:true`,
    `slots:{ tagName:'Family', sourceDescription:/of Alex/i }`
  - `recall.favorite.entity` → `'favorite my 5-star photos'` → `favorite_assets`, `slotsSurvive:true`,
    `slots:{ favorite:true, sourceDescription:/5-star/i }`
  - `recall.createalbum.entity` → `'make an album of my Sony photos from May'` →
    `create_album_from_source`, `slotsSurvive:true`, `slots:{ sourceDescription:/sony photos/i }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.archive.entity` → `'archive my Berlin photos'` → `archive_assets`,
    `slots:{ archived:true, sourceDescription:'my Berlin photos' }`
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.archive.entity` (category `'l3.recall'`) → `'archive my Berlin photos'` →
    `{ kind:'archive_assets' }`
  - `l3.plan.tag.entity` (category `'l3.plan'`, `threshold:0.5`) →
    `'tag photos in the {album} album as eval-l3'` → `{ kind:'tag_assets', planProposed:true }`
    (the `{album}` discovery token resolves the album entity live → `resolveAssetSearchFilters`
    → `searchAssets` handle → addTag plan, proposed never applied).

## TDD / verification gate (subagent stops here)

- [ ] `mise exec -- pnpm --dir agent-runner test` → all green (manifest mirror + new
      manifest test + fixture validation + existing suite). Expected total = 602 + the new
      contract-fixtures/manifest cases (the eval-scenario `.mjs` files are data, not
      node:test, so they don't change the count).

## Part D — eval runs (controller-driven, AFTER the unit commit)

NOT part of the subagent task. The controller:

- [ ] L1 (local model is up at `127.0.0.1:8080`): run
      `/opt/homebrew/bin/mise exec -- node --env-file-if-exists=.env eval/run.mjs --filter recall.archive.entity`
      (and the other 3 new ids) to confirm the entity recall routes ≥ threshold; then run a
      full L1 (`eval/run.mjs --diff`) and, if clean, `--accept` to re-seed `baseline.json`.
- [ ] L3: deferred to the Phase-0 RC boundary — RC the branch (`/rc-personal`), then
      `GALLERY_PRESET=careful … eval/run.mjs --layer L3 --filter l3.recall.archive.entity` +
      `--filter l3.plan.tag.entity`, audits clean, then `--accept` to re-seed `baseline.l3.json`.
      Run async; do NOT block the loop (Slice 6 can proceed).

## Acceptance

- The four source workflows advertise `resolveAssetSearchFilters`; the manifest mirror is
  regenerated and `manifest.test.mjs` is green.
- The contract fixture validates resolver arg caps/shape (Slice 2) AND searchAssets
  rating-range + visibility-enum (this slice); configurable matched/ambiguous/not_found
  returns are testable.
- L1 entity recall/slot + L3 entity routing/plan scenarios are added; `pnpm test` green.
- (Part D) L1 recall ≥ baseline re-seeded; L3 entity routing + plan-proposed pass live at
  the RC boundary (async).

## Commit

- One commit (unit core + scenario data): `feat(agent): advertise + cover named-entity sources across the source workflows (phase 2 slice 5)`.
- A follow-up commit re-seeds `baseline.json` (L1) after the controller's eval run; another
  re-seeds `baseline.l3.json` after the L3 RC run.
