# Pi Agent Workflow Expansion (Phase 2) — Slice 18 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.
> Combined slice — do it in phases: (1) module + fixture + module tests → green;
> (2) registration + manifest + disambiguation + scenarios → green.

**Goal:** `rotate_assets` (hybrid): match an EXPLICIT-angle rotate over a resolvable
source, normalize the angle to `{90,180,270}`, resolve via the shared resolver, propose
`proposeAssetBatchFromSelection { action:{ type:'asset.rotate', angle } }` — handing off
subjective/no-angle/non-resolvable. Add the `asset.rotate` angle validator to the
fixture. Register + manifest + L1/L3.

**Spec scope:** Slice 18 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/rotate-assets.mjs` (new)
- `agent-runner/src/strict-workflows/workflows/rotate-assets.test.mjs` (new)
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`
- `agent-runner/src/strict-workflows/registry.mjs`
- `agent-runner/src/strict-workflows/manifest.mjs`
- `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate)
- `agent-runner/src/strict-workflows/manifest.test.mjs`
- `agent-runner/src/strict-workflows/disambiguation.test.mjs`
- `agent-runner/eval/scenarios/classification-recall.mjs`
- `agent-runner/eval/scenarios/classification-negatives.mjs`
- `agent-runner/eval/scenarios/slot-fidelity.mjs`
- `agent-runner/eval/scenarios/l3-readonly.mjs`

## Key design

- The angle regex is `$`-anchored so the angle binds the LAST number even when the source
  contains digits ("rotate my newest 20 photos 90 clockwise" → angle 90, source includes 20).
- CCW (counterclockwise/anticlockwise/ccw) negates: `90 ccw → 270`, `270 ccw → 90`;
  `180` and CW stay. flip/upside-down → 180. Anything not in `{90,180,270}` → no match.

## Phase 1 — module + fixture + module tests

### A. `rotate-assets.mjs`

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'rotate_assets';

const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const cleanSource = (value) =>
  clean(value)
    .replace(/[.?!]+$/u, '')
    .trim();

const tripSourcePattern = /\brecent\s+trip\b/i;
const declinesSource = (source) => SUBJECTIVE_PATTERN.test(source) || tripSourcePattern.test(source);

const ANGLES = new Set([90, 180, 270]);
const isCcw = (dir) => (dir ? /counter|anti|ccw|left/i.test(dir) : false);
const normalizeAngle = (n, ccw) => {
  if (!ANGLES.has(n)) {
    return undefined;
  }
  if (n === 180) {
    return 180;
  }
  const effective = (((ccw ? -n : n) % 360) + 360) % 360;
  return ANGLES.has(effective) ? effective : undefined;
};

const ROTATE_PATTERN =
  /\b(?:rotate|turn|spin)\s+(?<source>.+?)\s+(?<angle>\d{1,3})\s*(?:°|degrees?)?\s*(?<dir>clockwise|counter-?clockwise|anti-?clockwise|cw|ccw)?\s*$/i;
const FLIP_PATTERN = /\b(?:flip|rotate|turn)\s+(?<source>.+?)\s+upside\s*down\s*$/i;

const tryMatch = (prompt) => {
  let source;
  let angle;
  const rotate = ROTATE_PATTERN.exec(prompt);
  if (rotate?.groups) {
    angle = normalizeAngle(Number(rotate.groups.angle), isCcw(rotate.groups.dir));
    source = rotate.groups.source;
  } else {
    const flip = FLIP_PATTERN.exec(prompt);
    if (flip?.groups) {
      angle = 180;
      source = flip.groups.source;
    }
  }
  if (angle === undefined || source === undefined) {
    return undefined;
  }
  const sourceDescription = cleanSource(source);
  if (!sourceDescription || declinesSource(sourceDescription)) {
    return undefined;
  }
  return { angle, sourceDescription };
};

const coerceAngle = (raw) => {
  if (typeof raw === 'number') {
    return raw;
  }
  const text = clean(raw).toLowerCase();
  if (/^\d+$/.test(text)) {
    return Number(text);
  }
  if (/counter|anti|ccw/.test(text)) {
    return 270;
  }
  if (/clockwise|cw/.test(text)) {
    return 90;
  }
  if (/upside|flip|180/.test(text)) {
    return 180;
  }
  return Number(text);
};

export const rotateAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',

  match(prompt) {
    const text = clean(prompt);
    if (!text) {
      return undefined;
    }
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },

  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription) {
      return null;
    }
    const angle = coerceAngle(rawSlots?.angle);
    if (!ANGLES.has(angle)) {
      return null;
    }
    return { angle, sourceDescription };
  },

  async run({ client, slots, signal }) {
    const angle = slots?.angle;
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!ANGLES.has(angle) || !sourceDescription) {
      return needsInput({ text: 'Tell me which photos to rotate and by 90, 180, or 270 degrees.' });
    }

    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') {
      return needsInput({ text: resolution.text });
    }
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to rotate. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Rotate matching photos ${angle} degrees.`,
          action: { type: 'asset.rotate', angle },
          selectionHandleId,
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to rotate ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${angle} degrees. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, angle },
    });
  },
});
```

### B. `contract-fixtures.mjs` — asset.rotate validator

In `validateBatchAction`, after the `asset.updateMetadata` branch, add:

```js
if (type === 'asset.rotate') {
  if (![90, 180, 270].includes(action.angle)) fail('asset.rotate angle must be 90, 180, or 270');
}
```

### C. module + fixture tests (red → green)

`rotate-assets.test.mjs`: `const wf = rotateAssetsWorkflow();`

- [ ] match: `'rotate my newest 20 photos 90 clockwise'` → `{ slots:{ angle:90, sourceDescription:'my newest 20 photos' } }`;
      `'rotate my last 10 photos 90 counterclockwise'` → `angle 270`; `'rotate my 2024 photos 180'` → `angle 180`;
      `'flip my newest 5 photos upside down'` → `angle 180`; `'rotate the sideways photos clockwise'` → `undefined`;
      `'rotate the best ones 90 clockwise'` → `undefined`; `'rotate my newest 20 photos 45 clockwise'` → `undefined`;
      `'rotate my newest 20 photos 270 clockwise'` → `angle 270`; `'rotate my newest 20 photos 90 anticlockwise'` → `angle 270`; `''` → `undefined`.
- [ ] parseSlots: `{ angle:90, sourceDescription:'my newest 20 photos' }` → `{ angle:90, sourceDescription:'my newest 20 photos' }`;
      `{ angle:'90', sourceDescription:'x' }.angle===90`; `{ angle:'counterclockwise', sourceDescription:'x' }.angle===270`;
      `{ angle:45, sourceDescription:'x' }`→`null`; `{ sourceDescription:'x' }`→`null`; `{ angle:90, sourceDescription:'   ' }`→`null`.
- [ ] run: planned over recency handle → `action` deepEquals `{ type:'asset.rotate', angle:90 }`, `selectionHandleId==='handle-1'`,
      no `'assetIds'`; angle 270 carried (deepEqual `{ type:'asset.rotate', angle:270 }`); date source → `searchAssets.filters`
      deepEquals `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`; subjective → `handoff_open` no propose;
      `handleAssetCount:0` → `needs_input` no propose; gate `{ status:'success', plan:{} }` → `failed`, no success copy;
      `searchAssets` throws → `failed`.
- [ ] identity: `wf.kind==='rotate_assets'`, `wf.flow==='hybrid'`, `typeof wf.run==='function'`.
- [ ] CONTRACT (in this file or contract-fixtures.test.mjs): `proposeAssetBatchFromSelection`
      with `action:{ type:'asset.rotate', angle:45 }` rejects `/angle/i`; angle 90/180/270 accepted (`.plan.id==='plan-1'`).
- [ ] Run RED → implement A+B → GREEN.

## Phase 2 — registration + manifest + disambiguation + scenarios

- [ ] `registry.mjs`: import `rotateAssetsWorkflow`; insert into `WORKFLOW_FACTORIES`
      **immediately after `updateAssetMetadataWorkflow,`** (grouped with the batch
      workflows, before the space/album workflows and add_photos). "rotate" is a unique verb.
- [ ] `manifest.mjs`: add the entry (after the `update_asset_metadata` entry):

```js
  Object.freeze({
    kind: 'rotate_assets',
    flow: 'hybrid',
    title: 'Rotate photos',
    classifierDescription:
      'User wants to rotate a metadata-describable set of photos by an EXPLICIT angle (90, 180, or 270 degrees, clockwise or counterclockwise).',
    positiveExamples: Object.freeze([
      'Rotate my newest 20 photos 90 clockwise',
      'Flip my newest 5 photos upside down',
      'Rotate my 2024 photos 180',
    ]),
    negativeExamples: Object.freeze([
      'Rotate the sideways photos clockwise',
      'Rotate the best ones 90 clockwise',
      'Rotate my newest 20 photos 45 clockwise',
    ]),
    slots: Object.freeze({
      angle: Object.freeze({ type: 'number', required: true, description: 'Rotation angle: 90, 180, or 270.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos to rotate.' }),
    }),
    requiredReadTools: Object.freeze(['resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAssetBatchFromSelection',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Rotate assets',
      tier: 'Solid now',
      workflowOrBoundary: 'Pi resolves the source + explicit angle; Gallery owns the batch rotate plan from the handle.',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test — `getWorkflowManifestEntry('rotate_assets').planTool === 'proposeAssetBatchFromSelection'`,
      `requiredReadTools` includes `'searchAssets'`, `flow==='hybrid'`.
- [ ] `disambiguation.test.mjs`: add `['rotate my newest 20 photos 90 clockwise', 'rotate_assets']`
      and `['flip my newest 5 photos upside down', 'rotate_assets']`. (The "exercises every kind"
      test then covers the new kind.) The existing `['rotate the sideways photos clockwise', ...]`
      is NOT in the disambiguation table (it's an L1 negative) — verify it still routes to `none`
      via `classify` if you add it, but it is NOT required.
- [ ] `classification-recall.mjs`: append
  - `recall.rotate.canonical` → `'rotate my newest 20 photos 90 clockwise'` → `{ kind:'rotate_assets', slotsSurvive:true }`
  - `recall.rotate.ccw` → `'rotate my last 10 photos 90 counterclockwise'` → `{ kind:'rotate_assets', slotsSurvive:true }`
  - `recall.rotate.flip` → `'flip my newest 5 photos upside down'` → `{ kind:'rotate_assets', slotsSurvive:true }`
- [ ] `classification-negatives.mjs`: append (KEEP the existing `neg.unsup.rotate` — it stays `none`)
  - `neg.rotate.subjective` → `'rotate the best ones 90 clockwise'` → `{ kind:'none' }`
  - `neg.rotate.badangle` → `'rotate my newest 20 photos 45 clockwise'` → `{ kind:'none' }`
- [ ] `slot-fidelity.mjs`: append
  - `slots.rotate.ccw-polarity` → `'rotate my newest 5 photos 90 counterclockwise'` →
    `{ kind:'rotate_assets', slots:{ angle:270, sourceDescription:'my newest 5 photos' } }`
- [ ] `l3-readonly.mjs`: append
  - `l3.recall.rotate` (category `'l3.recall'`) → `'rotate my newest 20 photos 90 clockwise'` → `{ kind:'rotate_assets' }`
  - `l3.plan.rotate.recency` (category `'l3.plan'`, `threshold:0.5`) → `'rotate my newest 20 photos 90 clockwise'` →
    `{ kind:'rotate_assets', planProposed:true }`

Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Part C — eval runs (controller-driven)

- [ ] L1 full `eval/run.mjs --diff`: confirm `recall.rotate.*` route, `neg.rotate.*` +
      `neg.unsup.rotate` stay `none`, `slots.rotate.ccw-polarity` exact, NO regression.
      (Do NOT `--accept` — baseline re-seed is deferred to the final slice.)
- [ ] L3: deferred to the final RC.

## Edge cases

- CCW → 270, flip/upside-down → 180, no-angle/45/0/360 → no match (never a guessed angle).
- `$`-anchored angle (source may contain numbers).
- subjective/recent-trip source declines; no raw asset ids.
- registry order: among batch workflows before add_photos; unique "rotate" verb.

## Acceptance

- `rotate_assets` routes + plans a batch `asset.rotate` with a normalized angle, gated;
  the fixture rejects a bad angle; registered + manifest + mirror.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 --diff clean.

## Commit

- One commit: `feat(agent): add rotate_assets (angle extractor + execution + fixture + registration + L1/L3) (phase 2 slice 18)`.
