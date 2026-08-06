# Pi Agent Strict/Hybrid Foundation Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise router recall by adding LLM structured-output intent classification behind the regex fast-path, without weakening any safety invariant — execution stays fully deterministic and any uncertainty falls through to open orchestration.

**Architecture:** Add `agent-runner/src/strict-workflows/classifier.mjs` exporting `createIntentClassifier({ getModel, manifest, mode })`. `classify(prompt)` runs in two stages: (1) try each workflow's regex `match` (free, deterministic) — a hit short-circuits with `via: 'regex'`; (2) otherwise, if the prompt looks plausibly actionable and `mode !== 'regex'`, make one non-streaming, tool-free structured-output call built from the manifest's `classifierDescription`/`positiveExamples`/`negativeExamples`, returning `{ workflow, slots, confidence }`. Low confidence, `workflow: 'none'`, unknown kind, or any classifier error falls back to the regex result and then to `{ kind: 'none' }`. The classifier is injected into the registry's `classify` (Slice 3) so the dispatcher is unchanged. A `STRICT_ROUTER_MODE` env/config (`regex` | `llm` | `hybrid`, default `hybrid`) controls behavior; tests force `regex` for determinism.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, Pi `@earendil-works/pi-ai` model handle (`getModel`) injected as a fake in tests, `pnpm --dir agent-runner test`.

---

## Spec Scope

Implements Slice 4 (Classification) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P3).

Covered requirements:

- The regex fast-path short-circuits canonical prompts with no LLM call.
- The LLM classifier returns structured `{ workflow, slots, confidence }`; `parseSlots` validates/rejects the slots.
- Paraphrases that previously fell back now route to the strict workflow (recall cases), e.g. "put my Japan trip from last week into an album".
- `confidence: 'low'`, `workflow: 'none'`, unknown kind, and classifier errors fall back to open orchestration.
- The classifier call is tool-free, low-temperature, and sees only the user message + manifest descriptions.
- `STRICT_ROUTER_MODE=regex` disables the LLM path deterministically; `=llm` skips the fast-path; `=hybrid` is the default.
- The `nonGenericPattern` guard no longer _forces open orchestration_: a declined fast-path `match` now defers to the LLM classifier (which picks the dominant intent or `none`), instead of short-circuiting to open. The guard is also applied to album-name-stripped text so explicit names like "called Travel Tag" still match.

Not included in this slice:

- A separate `routerModel` credential (reserved, not implemented).
- Durable state (Slice 5), copy delegation / observability beyond a router-decision return value (Slice 6).
- Multi-intent splitting beyond picking the single dominant intent.

## File Structure

- Create `agent-runner/src/strict-workflows/classifier.mjs`
  - `createIntentClassifier(...)`, `buildClassifierPrompt(manifest)`, `looksActionable(prompt)`.
- Create `agent-runner/src/strict-workflows/classifier.test.mjs`
  - Stage ordering, structured parse, recall cases, fallbacks, mode flags.
- Modify `agent-runner/src/strict-workflows/registry.mjs`
  - Build `classify` from the injected classifier instead of regex-only.
- Modify `agent-runner/src/pi-runtime.mjs`
  - Construct the classifier with the session model handle + `STRICT_ROUTER_MODE`; pass to the registry/dispatcher.
- Modify `agent-runner/src/strict-workflows.mjs` (only if needed)
  - Drop `nonGenericPattern` from `matchStrictWorkflow`'s positive recognition; keep place/album extraction. Adjust the legacy reject tests to assert via the classifier path.

## Task 1: Intent Classifier (regex fast-path → structured LLM)

**Files:**

- Create: `agent-runner/src/strict-workflows/classifier.mjs`
- Create: `agent-runner/src/strict-workflows/classifier.test.mjs`

- [ ] **Step 1: Write the failing classifier tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIntentClassifier } from './classifier.mjs';

const manifest = [
  {
    kind: 'create_recent_trip_album',
    flow: 'strict',
    classifierDescription: 'User wants an album built from a recent trip.',
    positiveExamples: ['Create an album for my recent trip to USA'],
    negativeExamples: ['Add my recent trip photos to Family'],
  },
];

const tripWorkflow = {
  kind: 'create_recent_trip_album',
  match: (p) => (/recent\s+trip/i.test(p) && /album/i.test(p) ? { slots: { albumName: 'Recent Trip' } } : undefined),
  parseSlots: (s) => s,
};

const fakeModel = (result) => ({
  // one-shot structured generate; assert no tools are passed
  async generateStructured({ tools }) {
    assert.equal(tools, undefined);
    return result;
  },
});

describe('intent classifier', () => {
  it('short-circuits canonical prompts via regex without calling the model', async () => {
    let called = false;
    const getModel = () => ({ generateStructured: async () => ((called = true), {}) });
    const classifier = createIntentClassifier({ getModel, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    const decision = await classifier.classify('Create an album for my recent trip to USA');
    assert.equal(decision.kind, 'create_recent_trip_album');
    assert.equal(decision.via, 'regex');
    assert.equal(called, false);
  });

  it('uses the LLM for paraphrases the regex misses', async () => {
    const getModel = () =>
      fakeModel({ workflow: 'create_recent_trip_album', slots: { placeHint: 'Japan' }, confidence: 'high' });
    const classifier = createIntentClassifier({ getModel, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    const decision = await classifier.classify('put my Japan trip from last week into an album');
    assert.equal(decision.kind, 'create_recent_trip_album');
    assert.equal(decision.via, 'llm');
    assert.equal(decision.slots.placeHint, 'Japan');
  });

  it('falls back to none on low confidence, unknown kind, or model error', async () => {
    const low = createIntentClassifier({
      getModel: () => fakeModel({ workflow: 'create_recent_trip_album', slots: {}, confidence: 'low' }),
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await low.classify('maybe do trip stuff?')).kind, 'none');

    const unknown = createIntentClassifier({
      getModel: () => fakeModel({ workflow: 'not_real', slots: {}, confidence: 'high' }),
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await unknown.classify('weird request')).kind, 'none');

    const boom = createIntentClassifier({
      getModel: () => ({
        generateStructured: async () => {
          throw new Error('provider down');
        },
      }),
      manifest,
      workflows: [tripWorkflow],
      mode: 'hybrid',
    });
    assert.equal((await boom.classify('something actionable please')).kind, 'none');
  });

  it('mode=regex never calls the model', async () => {
    let called = false;
    const getModel = () => ({ generateStructured: async () => ((called = true), {}) });
    const classifier = createIntentClassifier({ getModel, manifest, workflows: [tripWorkflow], mode: 'regex' });
    assert.equal((await classifier.classify('put my Japan trip into an album')).kind, 'none');
    assert.equal(called, false);
  });

  it('skips the model for non-actionable chatter in hybrid mode', async () => {
    let called = false;
    const getModel = () => ({ generateStructured: async () => ((called = true), {}) });
    const classifier = createIntentClassifier({ getModel, manifest, workflows: [tripWorkflow], mode: 'hybrid' });
    assert.equal((await classifier.classify('thanks, that looks great')).kind, 'none');
    assert.equal(called, false);
  });
});
```

- [ ] **Step 2: Run and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — `classifier.mjs` missing.

- [ ] **Step 3: Implement the classifier**

Key behaviors:

- `classify(prompt)`:
  1. For each workflow, `match(prompt)` → on hit return `{ kind, slots, via: 'regex', confidence: 'high' }`.
  2. If `mode === 'regex'` → `{ kind: 'none', via: 'regex' }`.
  3. If `!looksActionable(prompt)` → `{ kind: 'none', via: 'heuristic' }`.
  4. Call `getModel().generateStructured({ system: buildClassifierPrompt(manifest), input: prompt, schema: CLASSIFY_SCHEMA, temperature: 0 })`.
  5. Validate: workflow is a known `kind` and `confidence === 'high'`; else `{ kind: 'none', via: 'llm' }`.
  6. On any thrown error, return `{ kind: 'none', via: 'llm-error' }` (never throw).
- `buildClassifierPrompt(manifest)`: enumerates each `kind` with its `classifierDescription`, positive/negative examples, and instructs the model to return `none` when unsure. No tool definitions are passed.
- `CLASSIFY_SCHEMA`: `{ workflow: string, slots: Record<string,string>, confidence: 'high'|'low' }` enforced via the Pi model's structured-output mechanism (forced tool/JSON schema).
- `looksActionable(prompt)`: cheap heuristic — contains an imperative/creation verb (`create|make|add|put|rename|tag|archive|set|move|organize|build|...`) or ends with a request; pure-acknowledgement chatter returns false.

Map `via` and `confidence` onto the decision so Slice 6 can record a `strict_router_decision` event.

> **Provider-API assumption (confirm before implementing).** `getModel().generateStructured(...)`
> is a placeholder name. The runtime today exposes only streaming
> `session.prompt()`; `@earendil-works/pi-ai`'s one-shot/structured API on the
> `getModel()` handle is unconfirmed. Implement a single `classifyIntent({ getModel, system, prompt, schema })`
> adapter behind a dependency boundary and wire it to whichever the SDK actually
> provides:
>
> - If pi-ai exposes a non-streaming `generate`/`complete` with response-format /
>   JSON-schema or forced tool-call output → call it directly.
> - Otherwise, fall back to a **minimal ephemeral agent session**
>   (`createAgentSession` with `noTools` and a single forced `classify` tool whose
>   input schema is `CLASSIFY_SCHEMA`), prompt once, read the forced tool args,
>   then `dispose()`. This reuses the proven session path and keeps Gallery MCP
>   tools inactive.
>
> Either path is Gallery-tool-free, low-temperature, and wrapped so it never
> throws into the runtime. Tests inject a fake `classifyIntent`/`getModel` (as
> above), so the exact SDK wiring stays isolated behind that boundary.

- [ ] **Step 4: Run and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 2: Integrate Classifier Into Registry + Runtime

**Files:**

- Modify: `agent-runner/src/strict-workflows/registry.mjs`
- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/strict-workflows.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Build registry `classify` from the classifier**

`registry.classify` delegates to the injected classifier; default-construct a regex-only classifier when none is provided so Slice 3 dispatcher tests keep working without a model.

- [ ] **Step 2: Construct the classifier in the runtime**

In `createSession`/runtime setup, build `createIntentClassifier({ getModel: () => ai.getModel(providerName, body.model) ?? modelRegistry.find(providerName, body.model), manifest, workflows, mode: process.env.STRICT_ROUTER_MODE ?? 'hybrid' })` and pass it into the dispatcher's registry. Reuse the session credential; do not open a second auth path.

- [ ] **Step 3: Reframe `nonGenericPattern` as a fast-path conservatism guard**

Do **not** delete `nonGenericPattern` — the regex `match` runs before the LLM and
short-circuits, so dropping it would make the fast-path over-match compound
prompts (e.g. "Create an album for my recent trip to USA and add them to
Family") and never reach the classifier. Instead:

- Keep `nonGenericPattern`/`questionOnlyPattern` in `match`, but apply
  `nonGenericPattern` to the **album-name-stripped** text (as `highlightPattern`
  already is) so explicit names like "called Travel Tag" match at the fast-path.
- The only behavioral change is downstream: a declined `match` (returns
  `undefined`) now flows into the LLM classifier rather than meaning terminal
  "unsupported → open orchestration". The classifier then either picks the
  dominant intent, or returns `none` and the turn falls through to open.

Update the legacy reject tests: assert `match` still returns `undefined` for
those competing prompts (unchanged), and add classifier-level assertions (fake
model returning the competing intent or `none`) proving they do not wrongly run
the trip workflow.

- [ ] **Step 4: Add runtime recall + slot-reject tests**

In `pi-runtime.test.mjs`:

- With a fake model returning `{ workflow: 'create_recent_trip_album', slots: { placeHint: 'Japan' }, confidence: 'high' }`, assert "put my Japan trip from last week into an album" routes through the strict workflow (MCP calls `findTripCandidates,proposeAlbumFromSelection`, no provider prompt). With `STRICT_ROUTER_MODE=regex`, assert the same prompt falls through to the provider.
- With a fake model returning a known `workflow` but slots that `parseSlots` rejects (e.g. `{ placeHint: 'somewhere nice' }` only, which normalizes away and yields no usable name/hint → `parseSlots` → `null`), assert the turn falls through to the provider (no plan created). This proves the "classifier proposes, `parseSlots` disposes" boundary end-to-end.

- [ ] **Step 5: Run full suite and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS. Canonical prompts still match via regex (no model call); paraphrases match via LLM; chatter and `none` fall through.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src/strict-workflows agent-runner/src/pi-runtime.mjs agent-runner/src/strict-workflows.mjs
```

Expected: no durable persistence, no copy delegation; classifier never throws into the runtime; execution path unchanged after a match.

```bash
git add agent-runner/src/strict-workflows agent-runner/src/pi-runtime.mjs agent-runner/src/strict-workflows.mjs agent-runner/src/pi-runtime.test.mjs docs/superpowers/plans/2026-05-29-pi-agent-strict-hybrid-foundation-slice-4-intent-classification.md
git commit -m "feat: add LLM intent classification behind regex fast-path"
```

## Plan Self-Review

- Spec coverage: stage ordering, structured parse, recall, slot-reject fallthrough, all fallbacks, and mode flags each have a test.
- TDD order: classifier tests run red before integration.
- Safety: classifier is advisory only; it cannot execute tools, never throws into the runtime, and uncertainty always routes to open orchestration.
- Fast-path integrity: `nonGenericPattern` is reframed as a conservatism guard (declined `match` → LLM, not → open), so the fast-path never over-matches compound prompts before the classifier sees them.
- Honesty: the one-shot structured-output SDK call is flagged as an assumption with a confirmed-feasible ephemeral-session fallback, isolated behind an injectable boundary.
- Cost control: regex fast-path + actionable heuristic keep canonical and chatter turns off the LLM.
- Placeholder scan: no TODO/TBD placeholders.
