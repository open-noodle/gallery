# Pi Agent Workflow Expansion (Phase 2) — Slice 9 Implementation Plan

> **For agentic workers:** Implement test-first where a unit gate exists. Steps use
> checkbox (`- [ ]`) syntax.

**Goal:** Register `update_asset_metadata`, add its manifest entry (+ regen mirror),
lock disambiguation precedence, and add L1/L3 eval scenarios. **Closes Phase 1.**

**Spec scope:** Slice 9 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

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

- [ ] `registry.mjs`: add import (after the `tagAssetsWorkflow` import, alphabetical):
      `import { updateAssetMetadataWorkflow } from './workflows/update-asset-metadata.mjs';`
      Insert `updateAssetMetadataWorkflow,` into `WORKFLOW_FACTORIES` **immediately after
      `tagAssetsWorkflow,`** (grouped with the batch workflows, after the rename*\* gate).
      Extend the order-rationale comment: `update_asset_metadata` after
      `rename_or_describe*\*` so album/space describe wins; it declines album/space refs.
- [ ] `manifest.mjs`: add this entry immediately after the `tag_assets` entry:

```js
  Object.freeze({
    kind: 'update_asset_metadata',
    flow: 'hybrid',
    title: 'Edit photo metadata',
    classifierDescription:
      'User wants to edit metadata (description/caption, star rating, capture date, time zone, or explicit lat+lng location) on a metadata-describable set of LOOSE photos — not an album or a space.',
    positiveExamples: Object.freeze([
      'Set the description on my newest 20 photos to Berlin weekend',
      'Rate my newest 12 photos five stars',
      'Set the timezone on my newest 20 photos to Europe/Berlin',
    ]),
    negativeExamples: Object.freeze([
      'Set the description on the Family album to Summer 2026',
      'Set the description on the Trips space to Our adventures',
      'Set the location on these photos to Paris',
    ]),
    slots: Object.freeze({
      field: Object.freeze({ type: 'string', required: true, description: 'description, rating, timeZone, location, or date.' }),
      value: Object.freeze({ type: 'string', required: false, description: 'New value (text, 1-5 or clear for rating, IANA zone, ISO date).' }),
      latitude: Object.freeze({ type: 'number', required: false, description: 'Latitude for a location edit (with longitude).' }),
      longitude: Object.freeze({ type: 'number', required: false, description: 'Longitude for a location edit (with latitude).' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to edit.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Batch asset metadata edits',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves a loose-asset source and the field/value; Gallery owns the batch metadata-update plan from the handle.',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test —
      `getWorkflowManifestEntry('update_asset_metadata')` has `flow:'hybrid'`,
      `planTool:'proposeAssetBatchFromSelection'`, `requiredReadTools` includes `'searchAssets'`,
      non-empty positive/negative examples, and a `matrixRow.capability`. (The mirror
      round-trip test already covers the JSON parity after regen.)
- [ ] `disambiguation.test.mjs`: add to `CASES`:
  - `['set the description on my newest 20 photos to Berlin', 'update_asset_metadata']`
  - `['rate my newest 12 photos five stars', 'update_asset_metadata']`
  - `['set the timezone on my newest 20 photos to Europe/Berlin', 'update_asset_metadata']`
  - `['set the description on the Family album to Summer 2026', 'rename_or_describe_album']`
  - `['set these photos to Paris', 'none']`
    (The "exercises every registered workflow kind" test then auto-covers the new kind.)

## Part B — L1 / L3 eval scenarios (additive; L1 validated in Part C)

- [ ] `classification-recall.mjs`: append
  - `recall.metadata.describe` → `'set the description on my newest 20 photos to Berlin weekend'`
    → `{ kind:'update_asset_metadata', slotsSurvive:true, slots:{ sourceDescription:/newest 20 photos/i } }`
  - `recall.metadata.rating` → `'rate my newest 12 photos five stars'` →
    `{ kind:'update_asset_metadata', slotsSurvive:true, slots:{ sourceDescription:/newest 12 photos/i } }`
  - `recall.metadata.caption` (LLM paraphrase) → `'add a caption of Beach day to my newest 20 photos'` →
    `{ kind:'update_asset_metadata', slotsSurvive:true }`
- [ ] `classification-negatives.mjs`: append
  - `neg.metadata.album` → `'set the description on the Family album to Summer'` →
    `{ kind:'rename_or_describe_album' }` (NOT update_asset_metadata) — note: this is a
    routing-boundary negative, so `expect.kind` is the OWNER, not `'none'`.
  - `neg.metadata.placename` → `'set the location on these photos to Paris'` → `{ kind:'none' }`
  - `neg.metadata.filename` → `'change the filename on these photos to beach.jpg'` → `{ kind:'none' }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.metadata.describe` → `'set the description on my newest 20 photos to Berlin weekend'`
    → `{ kind:'update_asset_metadata', slots:{ sourceDescription:'my newest 20 photos' } }`
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.metadata.describe` (category `'l3.recall'`) →
    `'set the description on my newest 20 photos to eval-l3'` → `{ kind:'update_asset_metadata' }`
  - `l3.plan.metadata.recency` (category `'l3.plan'`, `threshold:0.5`) →
    `'rate my newest 10 photos five stars'` → `{ kind:'update_asset_metadata', planProposed:true }`

## TDD / verification gate (subagent stops here)

- [ ] `mise exec -- pnpm --dir agent-runner test` → all green. The disambiguation table,
      manifest mirror + new manifest test, and the existing suite pass. (Eval `.mjs`
      scenario files are data, not node:test, so the count rises only from the new
      manifest/disambiguation cases.)

## Part C — eval runs (controller-driven, AFTER the unit commit)

NOT the subagent's job:

- [ ] L1 (local model up): run `eval/run.mjs --diff` (full). Confirm the new
      `recall.metadata.*` / `slots.metadata.*` pass and the `neg.metadata.album` boundary
      holds, with NO regression (watch the rename*or_describe*\* boundary). Then `--accept`
      to re-seed `baseline.json`.
- [ ] L3: deferred to the final RC (entity routing/plan + metadata scenarios), then
      `--accept` `baseline.l3.json`.

## Edge cases

- registry ORDER: `update_asset_metadata` after `rename_or_describe_*` (album/space
  describe wins their refs) and grouped with the batch workflows.
- disambiguation: album/space describe stays with `rename_*`; loose-asset describe →
  `update_asset_metadata`; place-name-only location → `none`.
- `manifest.generated.json` regenerated in lockstep (mirror round-trip is the first red
  test if forgotten).

## Acceptance

- `update_asset_metadata` registered + in the manifest + mirror; disambiguation locks the
  rename boundary; L1 recall/slot/negatives added.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 ≥ baseline re-seeded.

## Commit

- One commit: `feat(agent): register update_asset_metadata + manifest + disambiguation + L1/L3 (phase 2 slice 9)`.
