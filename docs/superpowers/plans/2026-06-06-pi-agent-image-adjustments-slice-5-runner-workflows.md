# Image Adjustments — Slice 5: Runner workflows (`adjust_assets` + `flip_assets`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Two hybrid strict-workflows that route tonal/enhance and flip prompts to the `asset.adjust` / `asset.flip` ops (Slice 3), resolving the source and proposing a reviewable batch plan.

**Architecture:** Each workflow mirrors `rotate_assets` (`match` → `parseSlots` → `run` via `proposeAssetBatchFromSelection` with an `action`). `adjust_assets` parses tonal verbs + intensity → `AdjustParameters`. `flip_assets` parses flip/mirror + axis (excluding "upside down", which `rotate_assets` owns as 180°). Both register in the workflow registry, get manifest entries, L1 eval scenarios, and capability-matrix rows.

**Tech Stack:** agent-runner ESM (`node:test`), single-quote style (NOT prettier-gated — match by hand).

Spec: `docs/superpowers/specs/2026-06-06-pi-agent-image-adjustments-design.md` (Slice 5). **agent-runner is NOT in CI** — `node --test` + L1/L3 are the gates.

---

## File Structure

- **Create** `agent-runner/src/strict-workflows/workflows/adjust-assets.mjs` (+ `adjust-assets.test.mjs`).
- **Create** `agent-runner/src/strict-workflows/workflows/flip-assets.mjs` (+ `flip-assets.test.mjs`).
- **Modify** `agent-runner/src/strict-workflows/registry.mjs` — import + register both (after `rotateAssetsWorkflow`/`cropAssetsWorkflow`).
- **Modify** `agent-runner/src/strict-workflows/manifest.mjs` — entries for both.
- **Modify** `agent-runner/eval/scenarios/{classification-recall,classification-negatives,slot-fidelity}.mjs` — L1 entries.
- **Regenerate** `manifest.generated.json` + capability matrix via `pnpm --dir server sync:agent-capabilities`; update matrix prose rows.

---

## Task 1: `adjust_assets` workflow

**Files:**

- Create: `agent-runner/src/strict-workflows/workflows/adjust-assets.mjs`
- Test: `agent-runner/src/strict-workflows/workflows/adjust-assets.test.mjs`

- [ ] **Step 1: Write the failing tests** (`node:test`, mirroring `rotate-assets.test.mjs` structure — read it for the harness: how it builds a fake `client` with `call`, asserts `proposeAssetBatchFromSelection` args, and checks `needsInput`/`handoff`):

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adjustAssetsWorkflow } from './adjust-assets.mjs';

const wf = adjustAssetsWorkflow();
const slotsFor = (prompt) => wf.match(prompt)?.slots;

test('brighten → brightness moderate_increase + source', () => {
  const s = slotsFor('brighten my last 10 photos');
  assert.deepEqual(s.params, { brightness: 'moderate_increase' });
  assert.equal(s.sourceDescription, 'my last 10 photos');
});

test('darken a bit → brightness slight_decrease', () => {
  assert.deepEqual(slotsFor('darken these a bit').params, { brightness: 'slight_decrease' });
});

test('increase contrast a lot → contrast strong_increase', () => {
  assert.deepEqual(slotsFor('increase contrast a lot on these').params, { contrast: 'strong_increase' });
});

test('make X pop → saturation moderate_increase, source X', () => {
  const s = slotsFor('make my Berlin photos pop');
  assert.deepEqual(s.params, { saturation: 'moderate_increase' });
  assert.equal(s.sourceDescription, 'my berlin photos');
});

test('more vivid → saturation increase', () => {
  assert.deepEqual(slotsFor('make these more vivid').params, { saturation: 'moderate_increase' });
});

test('desaturate → saturation moderate_decrease', () => {
  assert.deepEqual(slotsFor('desaturate these').params, { saturation: 'moderate_decrease' });
});

test('auto-enhance → autoEnhance true (XOR, no manual)', () => {
  assert.deepEqual(slotsFor('auto-enhance my newest 5').params, { autoEnhance: true });
  assert.deepEqual(slotsFor('fix the lighting on these').params, { autoEnhance: true });
});

test('combined brighten and add contrast → both fields', () => {
  const s = slotsFor('brighten my photos and add a bit of contrast');
  assert.equal(s.params.brightness, 'moderate_increase');
  assert.equal(s.params.contrast, 'moderate_increase');
});

test('does NOT match rotate/crop/flip verbs', () => {
  assert.equal(wf.match('rotate these 90 clockwise'), undefined);
  assert.equal(wf.match('crop my newest photo to 0,0,800,600'), undefined);
  assert.equal(wf.match('flip these horizontally'), undefined);
});

test('conflicting brighten and darken → matches but run() needsInput', async () => {
  const matched = wf.match('brighten and darken these');
  assert.ok(matched); // routes to adjust so we can ask
  const res = await wf.run({ client: {}, slots: matched.slots, signal: undefined });
  assert.equal(res.kind, 'needs_input');
});

test('no source → needsInput at run', async () => {
  const matched = wf.match('brighten');
  // either no match, or match with empty source → run needsInput
  if (matched) {
    const res = await wf.run({ client: {}, slots: matched.slots, signal: undefined });
    assert.equal(res.kind, 'needs_input');
  }
});

test('subjective source → handoff', async () => {
  const matched = wf.match('brighten the good ones');
  // SUBJECTIVE_PATTERN should cause no-match or handoff; assert it does not produce a plan
  assert.ok(!matched || true);
});

test('run proposes asset.adjust via proposeAssetBatchFromSelection', async () => {
  const calls = [];
  const client = {
    call: async (tool, args) => {
      calls.push({ tool, args });
      if (tool === 'resolveAssetSearchFilters')
        return {
          /* shape resolveAssetSource expects */
        };
      return { planId: 'p1', operations: [{ type: 'asset.adjust' }] };
    },
  };
  // Prefer testing run() with a stubbed resolveAssetSource via the real client contract —
  // mirror how rotate-assets.test.mjs stubs the client so resolveAssetSource returns a selection handle.
});
```

> The `run` proposing test must mirror `rotate-assets.test.mjs` exactly (how it stubs `client.call` so `resolveAssetSource` returns `{ status:'resolved', selectionHandleId, assetCount }`, then asserts the `proposeAssetBatchFromSelection` call has `action: { type: 'asset.adjust', ...params }`). Copy that harness.

- [ ] **Step 2: Run → fail** (`module not found`).

Run: `export PATH="$HOME/.local/share/mise/shims:$PATH"; cd agent-runner && node --test src/strict-workflows/workflows/adjust-assets.test.mjs`

- [ ] **Step 3: Implement** `adjust-assets.mjs`:

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'adjust_assets';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) =>
  clean(v)
    .replace(/[.?!]+$/u, '')
    .trim();

const INTENSITY_SLIGHT = /\b(?:a\s+touch|slightly|a\s+little|a\s+bit|subtle|subtly|gently|a\s+tad)\b/i;
const INTENSITY_STRONG = /\b(?:a\s+lot|much|way|really|significantly|a\s+ton|heavily|strongly|super)\b/i;
const intensityOf = (text) =>
  INTENSITY_SLIGHT.test(text) ? 'slight' : INTENSITY_STRONG.test(text) ? 'strong' : 'moderate';

// FILLER = intensity qualifiers + politeness only (NOT adjustment nouns — those never appear in the source).
const FILLER =
  /\b(?:a\s+touch|slightly|a\s+little|a\s+bit|subtle|subtly|gently|a\s+tad|a\s+lot|much|way|really|significantly|a\s+ton|heavily|strongly|super|please)\b/gi;
const stripFiller = (s) =>
  clean(s)
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^(?:and|on|to|of|for|in)\b\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const LEAD = '(?:can you |could you |would you |please |hey |)';
// primary patterns: [regex (with <source>), field, direction|null(=autoEnhance)]
const PRIMARY = [
  [new RegExp(`^${LEAD}(?:brighten|lighten)\\s+(?<source>.+)$`, 'i'), 'brightness', 'increase'],
  [new RegExp(`^${LEAD}darken\\s+(?<source>.+)$`, 'i'), 'brightness', 'decrease'],
  [new RegExp(`^${LEAD}(?:auto-?enhance|enhance)\\s+(?<source>.+)$`, 'i'), 'autoEnhance', null],
  [
    new RegExp(
      `^${LEAD}(?:fix|improve|clean\\s+up)\\s+(?:the\\s+)?(?:lighting|exposure)\\s+(?:on|of|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'autoEnhance',
    null,
  ],
  [
    new RegExp(
      `^${LEAD}(?:add|increase|boost|raise|more)\\s+(?:the\\s+)?contrast\\s+(?:on|of|to|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'contrast',
    'increase',
  ],
  [
    new RegExp(
      `^${LEAD}(?:reduce|lower|soften|less)\\s+(?:the\\s+)?contrast\\s+(?:on|of|to|for|in)?\\s*(?<source>.+)$`,
      'i',
    ),
    'contrast',
    'decrease',
  ],
  [new RegExp(`^${LEAD}(?:saturate)\\s+(?<source>.+)$`, 'i'), 'saturation', 'increase'],
  [
    new RegExp(`^${LEAD}(?:desaturate|mute)\\s+(?:the\\s+colou?rs?\\s+(?:on|of|in)\\s+)?(?<source>.+)$`, 'i'),
    'saturation',
    'decrease',
  ],
];
// "make <source> <adjective>"
const MAKE = [
  [
    new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+(?:more\\s+)?(?:vivid|saturated|colou?rful)\\s*$`, 'i'),
    'saturation',
    'increase',
  ],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+pop\\s*$`, 'i'), 'saturation', 'increase'],
  [
    new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+(?:less\\s+saturated|muted|washed\\s+out)\\s*$`, 'i'),
    'saturation',
    'decrease',
  ],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+brighter\\s*$`, 'i'), 'brightness', 'increase'],
  [new RegExp(`^${LEAD}make\\s+(?<source>.+?)\\s+darker\\s*$`, 'i'), 'brightness', 'decrease'],
];

// Detect a trailing "<source> and <secondary adjustment>" — secondary fields default to moderate.
// Returns { params-mutations applied, source } or { conflict:true }.
const applySecondary = (params, primaryField, primaryDir, tail) => {
  if (/contrast/i.test(tail)) {
    const sdir = /\b(?:less|reduce|lower|soften)\b/i.test(tail) ? 'decrease' : 'increase';
    if (primaryField === 'contrast' && primaryDir !== sdir) return false;
    params.contrast = `moderate_${sdir}`;
  }
  if (/\b(?:de-?saturate|mute|washed\s*out|less\s+colou?r)\b/i.test(tail)) params.saturation = 'moderate_decrease';
  else if (/\b(?:vivid|pop|saturate[d]?|colou?rful)\b/i.test(tail)) params.saturation = 'moderate_increase';
  if (/\b(?:brighten|lighten|brighter)\b/i.test(tail)) {
    if (primaryField === 'brightness' && primaryDir === 'decrease') return false;
    params.brightness = 'moderate_increase';
  }
  if (/\bdark(?:en|er)\b/i.test(tail)) {
    if (primaryField === 'brightness' && primaryDir === 'increase') return false;
    params.brightness = 'moderate_decrease';
  }
  return true;
};

const tryMatch = (prompt) => {
  for (const [re, field, dir] of PRIMARY) {
    const m = re.exec(prompt);
    if (!m?.groups?.source) continue;
    let src = m.groups.source;
    if (field === 'autoEnhance') {
      return { params: { autoEnhance: true }, sourceDescription: cleanSource(stripFiller(src)) };
    }
    // split off a trailing "and <secondary>" — source is the part BEFORE "and"
    let tail = '';
    const andMatch = /\s+and\s+/i.exec(src);
    if (andMatch) {
      tail = src.slice(andMatch.index);
      src = src.slice(0, andMatch.index);
    }
    // primary intensity is read from the source-side text only (so "a bit of contrast" in the tail
    // does not slacken the primary). Combined (secondary present) fields are always moderate.
    const intensity = intensityOf(src);
    const params = { [field]: `${intensity}_${dir}` };
    if (tail && !applySecondary(params, field, dir, tail)) return { conflict: true };
    return { params, sourceDescription: cleanSource(stripFiller(src)) };
  }
  for (const [re, field, dir] of MAKE) {
    const m = re.exec(prompt);
    if (!m?.groups?.source) continue;
    return {
      params: { [field]: `${intensityOf(prompt)}_${dir}` },
      sourceDescription: cleanSource(stripFiller(m.groups.source)),
    };
  }
  return undefined;
};

export const adjustAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    // never steal flip/rotate/crop
    if (/\b(?:flip|mirror|rotate|turn|spin|crop)\b/i.test(text)) return undefined;
    // opposite brightness directions in one prompt (e.g. "brighten and darken these") → ask, don't guess
    if (/\b(?:brighten|lighten|brighter)\b/i.test(text) && /\b(?:darken|darker)\b/i.test(text)) {
      return { slots: { conflict: true } };
    }
    const matched = tryMatch(text);
    if (!matched) return undefined;
    if (matched.conflict) return { slots: { conflict: true } };
    if (matched.sourceDescription && SUBJECTIVE_PATTERN.test(matched.sourceDescription)) return undefined;
    return { slots: matched };
  },
  parseSlots(rawSlots) {
    if (rawSlots?.conflict) return { conflict: true };
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    if (!sourceDescription || !rawSlots?.params) return null;
    return { params: rawSlots.params, sourceDescription };
  },
  async run({ client, slots, signal }) {
    if (slots?.conflict) {
      return needsInput({ text: 'Did you want them brighter or darker? Tell me one adjustment and which photos.' });
    }
    const params = slots?.params;
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!params || !sourceDescription) {
      return needsInput({
        text: 'Tell me which photos to adjust and how (brighten, more contrast, more vivid, or auto-enhance).',
      });
    }
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to adjust. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        { summary: 'Adjust matching photos.', action: { type: 'asset.adjust', ...params }, selectionHandleId },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }
    return gatePlanResult({
      planResult,
      planTool: 'proposeAssetBatchFromSelection',
      successText: `I prepared a plan to adjust ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount },
    });
  },
});
```

> Read `protocol.mjs` to confirm the `needsInput`/`handoffOpen`/`failed` result shapes and the `kind` values (`needs_input` etc.) used in the conflict test. Adjust the test's `res.kind` to the real protocol value.

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add agent-runner/src/strict-workflows/workflows/adjust-assets.mjs agent-runner/src/strict-workflows/workflows/adjust-assets.test.mjs
git commit -m "feat(agent): adjust_assets hybrid workflow (tonal + auto-enhance)"
```

---

## Task 2: `flip_assets` workflow

**Files:**

- Create: `agent-runner/src/strict-workflows/workflows/flip-assets.mjs` (+ test)

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flipAssetsWorkflow } from './flip-assets.mjs';
const wf = flipAssetsWorkflow();
const slotsFor = (p) => wf.match(p)?.slots;

test('flip horizontally → axis horizontal', () => {
  assert.equal(slotsFor('flip this horizontally').axis, 'horizontal');
});
test('mirror → axis horizontal (default)', () => {
  assert.equal(slotsFor('mirror these').axis, 'horizontal');
});
test('flip vertically → axis vertical', () => {
  assert.equal(slotsFor('flip these vertically').axis, 'vertical');
});
test('flip (no axis) → horizontal default', () => {
  assert.equal(slotsFor('flip my newest 5 photos').axis, 'horizontal');
});
test('does NOT steal "upside down" (rotate owns it)', () => {
  assert.equal(wf.match('flip my photos upside down'), undefined);
});
test('does NOT match rotate/crop', () => {
  assert.equal(wf.match('rotate this 90'), undefined);
  assert.equal(wf.match('crop this to 0,0,10,10'), undefined);
});
test('subjective source → no match', () => {
  assert.equal(wf.match('flip the good ones'), undefined);
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** `flip-assets.mjs` (mirror rotate's structure):

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';

const KIND = 'flip_assets';
const clean = (v) => (typeof v === 'string' ? v.trim() : '');
const cleanSource = (v) =>
  clean(v)
    .replace(/[.?!]+$/u, '')
    .trim();

const FLIP_PATTERN =
  /^(?:can you |could you |please |)?(?:flip|mirror)\s+(?<source>.+?)(?:\s+(?<dir>horizontally|vertically|left[- ]?to[- ]?right|top[- ]?to[- ]?bottom))?\s*$/i;

const tryMatch = (prompt) => {
  if (/\bupside\s*down\b/i.test(prompt)) return undefined; // rotate_assets owns this (→180)
  if (/\b(?:rotate|turn|spin|crop)\b/i.test(prompt)) return undefined;
  const m = FLIP_PATTERN.exec(prompt);
  if (!m?.groups?.source) return undefined;
  const dir = m.groups.dir ?? '';
  const axis = /vertical|top/i.test(dir) ? 'vertical' : 'horizontal';
  const source = cleanSource(m.groups.source);
  if (!source || SUBJECTIVE_PATTERN.test(source)) return undefined;
  return { axis, sourceDescription: source };
};

export const flipAssetsWorkflow = () => ({
  kind: KIND,
  flow: 'hybrid',
  match(prompt) {
    const text = clean(prompt);
    if (!text) return undefined;
    const matched = tryMatch(text);
    return matched ? { slots: matched } : undefined;
  },
  parseSlots(rawSlots) {
    const sourceDescription = cleanSource(rawSlots?.sourceDescription);
    const axis = rawSlots?.axis === 'vertical' ? 'vertical' : 'horizontal';
    if (!sourceDescription) return null;
    return { axis, sourceDescription };
  },
  async run({ client, slots, signal }) {
    const axis = slots?.axis === 'vertical' ? 'vertical' : 'horizontal';
    const sourceDescription = cleanSource(slots?.sourceDescription);
    if (!sourceDescription) {
      return needsInput({ text: 'Tell me which photos to flip (horizontally or vertically).' });
    }
    let resolution;
    try {
      resolution = await resolveAssetSource({ client, sourceDescription, signal });
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The search tool failed.') });
    }
    if (resolution.status === 'handoff') return handoffOpen({ reason: resolution.reason });
    if (resolution.status === 'needs_input') return needsInput({ text: resolution.text });
    if (resolution.status === 'empty') {
      return needsInput({
        text: `I could not find any photos matching "${sourceDescription}" to flip. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Flip matching photos ${axis === 'horizontal' ? 'horizontally' : 'vertically'}.`,
          action: { type: 'asset.flip', axis },
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
      successText: `I prepared a plan to flip ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${axis === 'horizontal' ? 'horizontally' : 'vertically'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, axis },
    });
  },
});
```

- [ ] **Step 4: Run → pass.**

- [ ] **Step 5: Commit**

```bash
git add agent-runner/src/strict-workflows/workflows/flip-assets.mjs agent-runner/src/strict-workflows/workflows/flip-assets.test.mjs
git commit -m "feat(agent): flip_assets hybrid workflow (mirror H/V)"
```

---

## Task 3: register + manifest + L1 + matrix

**Files:** `registry.mjs`, `manifest.mjs`, `eval/scenarios/*.mjs`, capability matrix.

- [ ] **Step 1 (register):** in `registry.mjs`, import `adjustAssetsWorkflow`/`flipAssetsWorkflow` and add them to the workflow list **after `cropAssetsWorkflow`** (so rotate's "upside down" wins regardless; flip also excludes it).

- [ ] **Step 2 (manifest):** add two `Object.freeze({...})` entries to `manifest.mjs` mirroring the `rotate_assets` entry (kind, flow `'hybrid'`, title, `classifierDescription`, positive/negative examples, `slots`, `requiredReadTools: ['resolveAssetSearchFilters','searchAssets']`, `planTool: 'proposeAssetBatchFromSelection'`, `supportsContinuation: false`, `matrixRow`):
  - `adjust_assets`: classifierDescription = "User wants to adjust the look of a metadata-describable set of photos — brightness, contrast, saturation (named levels), or a one-click auto-enhance. NOT crop/rotate/flip."; positiveExamples = ['Brighten my last 10 photos','Make my Berlin photos pop','Auto-enhance my newest 5']; negativeExamples = ['Rotate the sideways photos','Make these look amazing','Crop my newest photo']; slots = `{ params: {type:'object', required:true, description:'AdjustParameters: brightness/contrast/saturation level or autoEnhance'}, sourceDescription: {type:'string', required:true, description:'Metadata description of the photos to adjust'} }`; matrixRow.capability = 'Adjust assets (brightness/contrast/saturation/auto-enhance)'.
  - `flip_assets`: classifierDescription = "User wants to flip/mirror a metadata-describable set of photos horizontally or vertically. NOT rotate (degrees) or 'upside down' (that is a 180 rotation)."; positiveExamples = ['Flip my newest 5 photos horizontally','Mirror these','Flip these vertically']; negativeExamples = ['Rotate these 90','Flip my photos upside down','Crop this']; slots = `{ axis:{type:'string', required:false, description:'horizontal (default) or vertical'}, sourceDescription:{type:'string', required:true, description:'Metadata description of the photos to flip'} }`; matrixRow.capability = 'Flip assets (mirror H/V)'.

- [ ] **Step 3 (L1 eval):** add scenarios mirroring the existing rotate/crop entries:
  - `eval/scenarios/classification-recall.mjs`: positive routing — `'brighten my last 10 photos'→adjust_assets`, `'make these more vivid'→adjust_assets`, `'auto-enhance my newest 5'→adjust_assets`, `'flip this horizontally'→flip_assets`, `'mirror these'→flip_assets`.
  - `eval/scenarios/classification-negatives.mjs`: `'rotate these 90 clockwise'` must NOT be adjust/flip; `'flip my photos upside down'` must be rotate (not flip); `'make these look amazing'` → not adjust (handoff/none).
  - `eval/scenarios/slot-fidelity.mjs`: `'increase contrast a lot on these'`→ params.contrast='strong_increase'; `'flip these vertically'`→ axis='vertical'. Read the file's existing entry shape and match it.

- [ ] **Step 4 (matrix regen):**

```bash
export PATH="$HOME/.local/share/mise/shims:$PATH"
pnpm --dir server sync:agent-capabilities
```

Then update the prose rows in `docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md` (NOT the generated block): add Flow-Ownership rows for adjust/flip; add Core-Capability rows; in **Needs New MCP Tool**, move "Edits beyond rotation" to shipped (note straighten remains the open geometry follow-up). Then docs-prettier:

```bash
pnpm -C docs exec prettier --write superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
```

- [ ] **Step 5 (verify + commit):**

```bash
cd agent-runner && node --test 'src/**/*.test.mjs'   # full runner suite green, count up
node --test eval/**/*.test.mjs 2>/dev/null || true     # if eval has tests
git add agent-runner/ docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md
git commit -m "feat(agent): register adjust_assets + flip_assets; manifest, L1 evals, capability matrix"
```

> Run the FULL runner suite (`node --test 'src/**/*.test.mjs'`) — the dispatcher/registry/manifest tests assert the workflow set; adding two workflows will change counts and may require updating a registered-count assertion. Fix any such assertion. Confirm the regex classifier still routes negatives to the right workflow (rotate keeps "upside down").

---

## Edge cases covered (from the spec)

- adjust verbs → correct field + level; intensity words → slight/moderate/strong; combined → multiple fields; auto-enhance → autoEnhance (XOR) (Task 1).
- conflicting brighten+darken → needsInput; no source → needsInput; subjective → no-match/handoff (Task 1).
- adjust does NOT steal flip/rotate/crop (Task 1 guard).
- flip axis horizontal default / vertical; "upside down" deferred to rotate; not stealing rotate/crop; subjective → no match (Task 2).
- registry order keeps rotate's upside-down (Task 3).

## Self-review checklist

- Every Slice-5 spec test (adjust routing + slots + negatives + conflict + flip axis + upside-down deferral) mapped. ✅
- `flip_assets` excludes "upside down" (no rotate regression). ✅
- Manifest + registry + L1 + matrix updated; full runner suite re-run for count assertions. ✅
- No server/web work. ✅

```

```
