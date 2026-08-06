# Pi Agent Workflow Expansion (Phase 2) — Slice 12 Implementation Plan

> **For agentic workers:** Implement test-first where a unit gate exists. Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Register `remove_photos_from_album`, add its manifest entry (+ regen), lock
disambiguation precedence + collision guards, add L1/L3 scenarios. **Closes Phase 2.**

**Spec scope:** Slice 12 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Open contract question #4 (resolved):** entity sources reach this workflow via the
shared resolver, so `requiredReadTools` includes `resolveAssetSearchFilters` (consistent
with the other source workflows now that Phase 0 landed).

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

- [ ] `registry.mjs`: add import (alphabetical, after the imports block):
      `import { removePhotosFromAlbumWorkflow } from './workflows/remove-photos-from-album.mjs';`
      Insert `removePhotosFromAlbumWorkflow,` into `WORKFLOW_FACTORIES` **immediately
      before `addPhotosToAlbumWorkflow,`** (so favorite/tag/manage_space_members win their
      "remove … from …" phrasings, and add_photos stays LAST). Extend the order-rationale
      comment: `remove_photos_from_album` AFTER `favorite_assets`/`tag_assets`/
      `manage_space_members`, before `add_photos_to_album`.
- [ ] `manifest.mjs`: add this entry immediately after the `add_photos_to_album` entry:

```js
  Object.freeze({
    kind: 'remove_photos_from_album',
    flow: 'hybrid',
    title: 'Remove photos from album',
    classifierDescription:
      'User wants to remove a metadata-describable set of photos from an existing album (the inverse of adding) — not a member removal, an out-of-favorites, or a tag removal.',
    positiveExamples: Object.freeze([
      'Remove my newest 20 photos from Family',
      'Take my newest 20 photos out of the Trips album',
      'Remove my 2024 photos from the Italy album',
    ]),
    negativeExamples: Object.freeze([
      'Remove the Travel tag from my newest 20',
      'Remove Bob from the Family space',
      'Add my newest 20 photos to Family',
    ]),
    slots: Object.freeze({
      albumRef: Object.freeze({ type: 'string', required: true, description: 'The album to remove photos from.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to remove.' }),
    }),
    requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAlbumOperations',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Remove photos from album',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the album and source; Gallery owns the album.removeAssets plan from the handle (never an empty removal).',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test —
      `getWorkflowManifestEntry('remove_photos_from_album')` has `flow:'hybrid'`,
      `planTool:'proposeAlbumOperations'`, `requiredReadTools` includes `'listAlbums'` and
      `'searchAssets'`, `supportsContinuation:false`, non-empty examples, `matrixRow.capability`.
- [ ] `disambiguation.test.mjs`: add to `CASES`:
  - `['remove my newest 20 photos from Family', 'remove_photos_from_album']`
  - `['take my newest 20 photos out of the Family album', 'remove_photos_from_album']`
  - `['remove my Berlin photos from last weekend from the Trips album', 'remove_photos_from_album']`
  - `['remove Bob from the Family space', 'manage_space_members']` (collision guard)
  - `['remove my newest 20 from my favorites', 'favorite_assets']` (collision guard)
  - `['remove the Travel tag from my newest 20', 'none']` (collision guard)
    (The "exercises every registered workflow kind" test then auto-covers the new kind.)

## Part B — L1 / L3 scenarios (additive; L1 validated in Part C)

- [ ] `classification-recall.mjs`: append
  - `recall.remove.canonical` → `'remove my newest 20 photos from Family'` →
    `{ kind:'remove_photos_from_album', slotsSurvive:true, slots:{ albumRef:'Family' } }`
  - `recall.remove.takeout` → `'take my newest 20 photos out of the Family album'` →
    `{ kind:'remove_photos_from_album', slotsSurvive:true, slots:{ albumRef:'Family' } }`
  - `recall.remove.llm` → `'pull my 2024 photos out of the Trips album'` →
    `{ kind:'remove_photos_from_album' }` (forces the LLM path — 'pull' is not a regex verb)
- [ ] `classification-negatives.mjs`: append
  - `neg.remove.tag` → `'remove the Travel tag from my newest 20'` → `{ kind:'none' }`
  - `neg.remove.subjective` → `'remove the best ones from Family'` → `{ kind:'none' }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.remove.canonical` → `'remove my newest 5 photos from Family'` →
    `{ kind:'remove_photos_from_album', slots:{ albumRef:'Family', sourceDescription:'my newest 5 photos' } }`
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.remove` (category `'l3.recall'`) → `'remove my newest 20 photos from {album}'` →
    `{ kind:'remove_photos_from_album' }`
  - `l3.plan.remove.recency` (category `'l3.plan'`, `threshold:0.5`) →
    `'remove my newest 20 photos from {album}'` → `{ kind:'remove_photos_from_album', planProposed:true }`

## TDD / verification gate (subagent stops here)

- [ ] `mise exec -- pnpm --dir agent-runner test` → all green (disambiguation + collision
      guards, manifest mirror + new test, prior suite). Run RED first by adding the
      disambiguation/manifest cases before registering, then register → GREEN.

## Part C — eval runs (controller-driven, AFTER the unit commit)

- [ ] L1 (local model up): `eval/run.mjs --diff` (full). Confirm `recall.remove.*` /
      `slots.remove.*` pass, the `neg.remove.*` and collision-guard boundaries hold, NO
      regression. Then `--accept` (re-seed `baseline.json`). If `recall.remove.llm` ('pull
      … out of …') flakes below threshold, either add `pull` to the Slice-10 router verbs
      OR relax that one scenario — note the choice.
- [ ] L3: deferred to the final RC.

## Edge cases

- Registry placement is load-bearing: AFTER favorite/tag/manage_space_members; add_photos
  stays LAST. Collision guards (favorites→favorite, space→manage, tag→none) verified.
- `manifest.generated.json` regenerated in lockstep.
- `l3.plan.remove.recency` is data-dependent (needs a real album with removable matching
  assets) — threshold 0.5; on an empty stack it may legitimately not propose.

## Acceptance

- `remove_photos_from_album` registered + manifest + mirror; disambiguation + collision
  guards lock the seam; L1 recall/slot/negatives added.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 ≥ baseline re-seeded.

## Commit

- One commit: `feat(agent): register remove_photos_from_album + manifest + disambiguation + L1/L3 (phase 2 slice 12)`.
