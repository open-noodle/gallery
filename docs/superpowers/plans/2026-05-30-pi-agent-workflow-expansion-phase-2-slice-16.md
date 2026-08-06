# Pi Agent Workflow Expansion (Phase 2) — Slice 16 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement `create_space_from_source` `run()`: resolve the source; handoff →
handoffOpen; empty → needsInput; resolved → `proposeSpaceFromSearch({ summary, spaceName,
assetSource:{ kind:'selectionHandle', selectionHandleId } })`, gated. Add a
`proposeSpaceFromSearch` handler to the contract fixture validating the REAL DTO so a
wrong-shape call throws. **No raw assetIds and no bare top-level `selectionHandleId`.**

**Spec scope:** Slice 16 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Verified contract:** `proposeSpaceFromSearch` = `strictObject({ summary?, spaceName
(1-100), description? (max 500), color? (UserAvatarColor), assetSource })`. `assetSource`
accepts `{ kind:'selectionHandle', selectionHandleId }` (Open Q3 — schema-valid; the L3
scenario in Slice 17 is the load-bearing live proof). UserAvatarColor ∈ {primary, pink,
red, yellow, blue, green, purple, orange, gray, amber}.

**Files:**

- `agent-runner/src/strict-workflows/workflows/create-space-from-source.mjs`
- `agent-runner/src/strict-workflows/workflows/create-space-from-source.test.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`

## Implementation (exact)

### A. `contract-fixtures.mjs` — proposeSpaceFromSearch handler

Add constants near the other validators:

```js
const KNOWN_SPACE_FROM_SEARCH_KEYS = new Set(['summary', 'spaceName', 'description', 'color', 'assetSource']);
const KNOWN_AVATAR_COLORS = new Set([
  'primary',
  'pink',
  'red',
  'yellow',
  'blue',
  'green',
  'purple',
  'orange',
  'gray',
  'amber',
]);
const KNOWN_ASSET_SOURCE_KINDS = new Set(['search', 'previousSearch', 'selectionHandle']);
```

Add the handler in the `handlers` object:

```js
    proposeSpaceFromSearch: (args) => {
      if (!args || typeof args !== 'object') fail('proposeSpaceFromSearch requires an object');
      for (const key of Object.keys(args)) {
        if (!KNOWN_SPACE_FROM_SEARCH_KEYS.has(key)) fail(`proposeSpaceFromSearch: unknown key "${key}"`);
      }
      if (typeof args.spaceName !== 'string' || args.spaceName.trim().length === 0) {
        fail('proposeSpaceFromSearch requires a non-empty spaceName');
      }
      const source = args.assetSource;
      if (!source || typeof source !== 'object') fail('proposeSpaceFromSearch requires an assetSource');
      if (!KNOWN_ASSET_SOURCE_KINDS.has(source.kind)) fail(`proposeSpaceFromSearch assetSource kind "${source.kind}" is invalid`);
      if (source.kind === 'selectionHandle' && !source.selectionHandleId) {
        fail('selectionHandle assetSource requires selectionHandleId');
      }
      if (args.color !== undefined && !KNOWN_AVATAR_COLORS.has(args.color)) {
        fail(`proposeSpaceFromSearch color "${args.color}" is invalid`);
      }
      return ok(config);
    },
```

### B. `create-space-from-source.mjs` — imports + run()

Replace the import lines:

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';
```

Replace the stub `run()`:

```js
  async run({ client, slots, signal }) {
    const sourceDescription = cleanSource(slots?.sourceDescription);
    const spaceName = clean(slots?.spaceName) || DEFAULT_NAME;

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
        text: `I could not find any photos matching "${sourceDescription}" for the new space. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // The handle is WRAPPED as a selectionHandle assetSource — there is no
    // proposeSpaceFromSelection tool. No raw asset ids reach the model.
    let planResult;
    try {
      planResult = await client.call(
        'proposeSpaceFromSearch',
        {
          summary: `Create the "${spaceName}" space.`,
          spaceName,
          assetSource: { kind: 'selectionHandle', selectionHandleId },
        },
        { signal },
      );
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    return gatePlanResult({
      planResult,
      planTool: 'proposeSpaceFromSearch',
      successText: `I prepared a plan to create the "${spaceName}" space from ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, spaceName, assetCount },
    });
  },
```

## TDD steps

### Task 1: tests (red)

Add a `describe('create_space_from_source execution')` block (import `makeContractClient`).

- [ ] planned: `wf.run({ client: makeContractClient(), slots:{ sourceDescription:'my newest 50 photos', spaceName:'Family' } })`
      → `outcome.status==='planned'`; the `proposeSpaceFromSearch` call args deepEqual
      `{ summary:'Create the "Family" space.', spaceName:'Family', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' } }`
      (EXACT — no `description`/`color`, no top-level `selectionHandleId`).
- [ ] default name: `slots:{ sourceDescription:'my newest 50 photos', spaceName:'New Space' }` → the
      call's `spaceName==='New Space'`. (Or pass no spaceName and assert default — but note `run()`
      receives parseSlots output which already defaults; test with `spaceName:'New Space'` directly.)
- [ ] no raw ids: `JSON.stringify(client.calls).includes('assetIds')===false` AND
      `JSON.stringify(client.calls).includes('"selectionHandleId":"handle-1"')===true` AND
      `JSON.stringify(client.calls).includes('"kind":"selectionHandle"')===true`.
- [ ] date source: `slots:{ sourceDescription:'my photos from 2024', spaceName:'X' }` →
      `searchAssets.filters` deepEqual `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`; status `'planned'`.
- [ ] handoff: `sourceDescription:'the good ones'` → `'handoff_open'`; NO `proposeSpaceFromSearch` call.
- [ ] empty: `makeContractClient({ handleAssetCount:0 })` → `'needs_input'`; NO `proposeSpaceFromSearch` call.
- [ ] gate-block: `makeContractClient({ planResult:{ status:'success', plan:{} } })` →
      `'failed'` AND `/prepared|created/i.test(outcome.text)===false`.
- [ ] search throws → `'failed'`.
- [ ] contract-fixtures (in this test file or a fixture describe block):
  - `proposeSpaceFromSearch({ assetSource:{ kind:'selectionHandle', selectionHandleId:'h' } })` rejects `/spaceName/i`
  - `proposeSpaceFromSearch({ spaceName:'X' })` rejects `/assetSource/i`
  - `proposeSpaceFromSearch({ spaceName:'X', assetSource:{ kind:'selectionHandle' } })` rejects `/selectionHandleId/i`
  - `proposeSpaceFromSearch({ spaceName:'X', selectionHandleId:'h' })` rejects `/unknown|selectionHandleId/i` (bare top-level)
  - `proposeSpaceFromSearch({ spaceName:'X', assetSource:{ kind:'explicitAssets', assetIds:['a'] } })` rejects `/kind|invalid/i`
  - `proposeSpaceFromSearch({ spaceName:'X', assetSource:{ kind:'selectionHandle', selectionHandleId:'h' } })` → returns `{ status:'success', plan:{ id:'plan-1' } }` (`.plan.id === 'plan-1'`)
  - `proposeSpaceFromSearch({ spaceName:'X', assetSource:{ kind:'selectionHandle', selectionHandleId:'h' }, color:'chartreuse' })` rejects `/color/i`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (run() is the stub; the fixture
      has no proposeSpaceFromSearch handler).

### Task 2: implement (green)

- [ ] Apply edits A and B. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- `assetSource.kind` literal `'selectionHandle'`; the handle is wrapped (NO bare top-level
  `selectionHandleId`, NO raw assetIds, NO `explicitAssets` kind).
- `description`/`color` keys omitted entirely (no `''` default) — the call args have no
  `description` key.
- singular/plural copy; gate blocks success copy without a persisted plan id; tool errors → failed.
- the fixture handler mirrors the `strictObject` (rejects unknown keys like a copy-pasted
  `albumName`/`operations`/`assetIds`).

## Acceptance

- `run()` plans a space via `proposeSpaceFromSearch` with a wrapped selectionHandle
  assetSource, gated; the fixture throws on wrong-shape space-from-search calls.
- `mise exec -- pnpm --dir agent-runner test` green; not registered yet (Slice 17).

## Commit

- One commit: `feat(agent): create_space_from_source execution — proposeSpaceFromSearch selectionHandle assetSource (phase 2 slice 16)`.
