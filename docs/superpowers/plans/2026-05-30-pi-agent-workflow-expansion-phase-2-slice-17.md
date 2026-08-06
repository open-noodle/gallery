# Pi Agent Workflow Expansion (Phase 2) — Slice 17 Implementation Plan

> **For agentic workers:** Implement test-first where a unit gate exists. Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Register `create_space_from_source`, add its manifest entry (+ regen), lock
disambiguation, add L1/L3 scenarios. **Closes Phase 4.** The L3 plan-proposed scenario is
the LOAD-BEARING proof (Open Q3) that the real server accepts the selectionHandle
assetSource and expands it to `space.create` + `space.addAssets`.

**Spec scope:** Slice 17 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Files:**

- `agent-runner/src/strict-workflows/registry.mjs`
- `agent-runner/src/strict-workflows/manifest.mjs`
- `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate)
- `agent-runner/src/strict-workflows/manifest.test.mjs`
- `agent-runner/src/strict-workflows/disambiguation.test.mjs`
- `agent-runner/eval/scenarios/classification-recall.mjs`
- `agent-runner/eval/scenarios/classification-negatives.mjs`
- `agent-runner/eval/scenarios/slot-fidelity.mjs`
- `agent-runner/eval/scenarios/l3-readonly.mjs`

## Part A — registry + manifest (unit-gated)

- [ ] `registry.mjs`: add import (alphabetical):
      `import { createSpaceFromSourceWorkflow } from './workflows/create-space-from-source.mjs';`
      Insert `createSpaceFromSourceWorkflow,` into `WORKFLOW_FACTORIES` **immediately after
      `createAlbumFromSourceWorkflow,`** (before `renameOrDescribeSpaceWorkflow,`). Extend
      the order-rationale comment (create-verb workflows grouped; album-noun vs space-noun
      discriminates).
- [ ] `manifest.mjs`: add the entry (after the `create_album_from_source` entry):

```js
  Object.freeze({
    kind: 'create_space_from_source',
    flow: 'hybrid',
    title: 'Create space from a source',
    classifierDescription:
      'User wants a NEW shared space built from a metadata-describable set of photos — not a new album, not an existing-space photo add, and not a member add.',
    positiveExamples: Object.freeze([
      'Make a Family space of my newest 50 photos',
      'Create a shared space from my 2024 photos',
      'Make a space of my newest 20 photos titled South Africa',
    ]),
    negativeExamples: Object.freeze([
      'Make an album of my newest 50 photos',
      'Add my newest 20 photos to the Family space',
      'Rename the Family space to Family 2026',
    ]),
    slots: Object.freeze({
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos for the new space.' }),
      spaceName: Object.freeze({ type: 'string', required: false, description: 'Space name (defaults to New Space).' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeSpaceFromSearch',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Create space from a source',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the source; Gallery owns space creation from the wrapped selection handle (proposeSpaceFromSearch).',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test — entry kind `'create_space_from_source'`, `flow:'hybrid'`,
      `planTool:'proposeSpaceFromSearch'`, `requiredReadTools` includes `'searchAssets'`,
      `supportsContinuation:false`, non-empty examples, `matrixRow.capability`.
- [ ] `disambiguation.test.mjs`: add to `CASES`:
  - `['make a Family space of my newest 50 photos', 'create_space_from_source']`
  - `['create a shared space from my 2024 photos', 'create_space_from_source']`
  - KEEP green (verify): `['make an album of my newest 50 photos', 'create_album_from_source']`,
    `['add my newest 20 photos to the Family space', 'manage_space_assets']`,
    `['add Alex to the Family space', 'manage_space_members']`,
    `['rename the Family space to Family 2026', 'rename_or_describe_space']`.

## Part B — L1 / L3 scenarios (additive; L1 validated in Part C)

- [ ] `classification-recall.mjs`: append
  - `recall.createspace.canonical` → `'make a Family space of my newest 50 photos'` →
    `{ kind:'create_space_from_source', slotsSurvive:true, slots:{ spaceName:'Family' } }`
  - `recall.createspace.named` → `'create a space from my newest 50 photos called Trips'` →
    `{ kind:'create_space_from_source', slotsSurvive:true, slots:{ spaceName:'Trips' } }`
  - `recall.createspace.album-disambig` → `'make an album of my newest 50 photos'` →
    `{ kind:'create_album_from_source' }` (must NOT become create_space)
  - `recall.createspace.member-disambig` → `'add Alex to the Family space'` →
    `{ kind:'manage_space_members' }`
- [ ] `classification-negatives.mjs`: append
  - `neg.createspace.subjective` → `'create a space of the best photos from last weekend'` → `{ kind:'none' }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.createspace.default-name` → `'create a space from my 2024 photos'` →
    `{ kind:'create_space_from_source', slots:{ sourceDescription:'my 2024 photos' } }`
    (NOTE: assert only `sourceDescription` — the parseSlots default `spaceName:'New Space'`
    is in the normalized slots; the L1 slot comparator matches string fields, so keep the
    `slots` to `sourceDescription` to avoid a brittle nested check.)
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.createspace` (category `'l3.recall'`) → `'make a Highlights space of my newest 20 photos'` →
    `{ kind:'create_space_from_source' }`
  - `l3.plan.createspace` (category `'l3.plan'`, `threshold:0.5`) →
    `'make a space of my newest 20 photos called eval-l3-space'` →
    `{ kind:'create_space_from_source', planProposed:true }` (plan-only — never applied, so
    no real space is created; the LOAD-BEARING live proof of the selectionHandle assetSource)

## TDD / verification gate (subagent stops here)

- [ ] `mise exec -- pnpm --dir agent-runner test` → all green (disambiguation, manifest
      mirror + new test, prior suite). Add disambiguation/manifest cases FIRST → RED → register → GREEN.

## Part C — eval runs (controller-driven, AFTER the unit commit)

- [ ] L1 full `eval/run.mjs --diff`: confirm `recall.createspace.*` route, the album/member
      disambig recalls stay with their owners, `neg.createspace.subjective` → none, NO
      regression; then `--accept` (re-seed `baseline.json`).
- [ ] L3: deferred to the final RC — `l3.plan.createspace` is the load-bearing proof.

## Edge cases

- registry ORDER: after `create_album_from_source` (create-verb workflows grouped); the
  album-noun vs space-noun discriminator keeps album-from-source green.
- `manifest.generated.json` regenerated in lockstep.
- `l3.plan.createspace` uses a fresh name (`eval-l3-space`); `plan-only` guarantees no real
  space is created.

## Acceptance

- `create_space_from_source` registered + manifest + mirror; disambiguation locks the
  album/space/member boundaries; L1 recall/slot/negatives added.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 ≥ baseline re-seeded.

## Commit

- One commit: `feat(agent): register create_space_from_source + manifest + disambiguation + L1/L3 (phase 2 slice 17)`.
