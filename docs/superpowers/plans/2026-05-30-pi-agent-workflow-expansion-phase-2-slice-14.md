# Pi Agent Workflow Expansion (Phase 2) — Slice 14 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.
> This is a LARGE slice — do it in two phases: (1) fixtures + run() + run tests → green;
> (2) registration + manifest + disambiguation + scenarios → green.

**Goal:** Implement `manage_space_assets` `run()` (resolve space via `listSpaces`; ADD →
`proposeAddAssetsToSpaceFromSearch`, REMOVE → `proposeAlbumOperations([space.removeAssets])`,
gated), extend the contract fixture, register it BEFORE `add_photos_to_album`, and add
L1/L3 scenarios (flipping the stale `add_photos`/space assertions). **Closes Phase 3.**

**Spec scope:** Slice 14 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Verified contracts:**

- `proposeAddAssetsToSpaceFromSearch` = `strictObject({ summary?, spaceId?, spaceName?,
assetSource })`, superRefine `Boolean(spaceId) === Boolean(spaceName)` → error (pass
  `spaceId` ONLY). `assetSource` accepts `{ kind:'selectionHandle', selectionHandleId }`.
- `space.removeAssets` op = `{ type:'space.removeAssets', summary, targetKind:'existing_space',
targetId, assetSource:{ kind:'selectionHandle', selectionHandleId }, payload:{} }`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/manage-space-assets.mjs`
- `agent-runner/src/strict-workflows/workflows/manage-space-assets.test.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- `agent-runner/src/strict-workflows/registry.mjs`
- `agent-runner/src/strict-workflows/manifest.mjs`
- `agent-runner/src/strict-workflows/manifest.generated.json` (regenerate)
- `agent-runner/src/strict-workflows/manifest.test.mjs`
- `agent-runner/src/strict-workflows/disambiguation.test.mjs`
- `agent-runner/eval/scenarios/classification-recall.mjs`
- `agent-runner/eval/scenarios/classification-negatives.mjs`
- `agent-runner/eval/scenarios/slot-fidelity.mjs`
- `agent-runner/eval/scenarios/l3-readonly.mjs`

## Phase 1 — fixtures + run() + run tests

### A. `contract-fixtures.mjs`

Add the `space.removeAssets` op validator (register it in `SPACE_OP_VALIDATORS`):

```js
const validateSpaceRemoveAssets = (op) => {
  if (op.targetKind !== 'existing_space') fail('space.removeAssets requires targetKind "existing_space"');
  if (!op.targetId) fail('space.removeAssets requires targetId');
  if (op.payload !== undefined && Object.keys(op.payload).length > 0) fail('space.removeAssets payload must be empty');
  const source = op.assetSource;
  if (!source || source.kind !== 'selectionHandle' || !source.selectionHandleId) {
    fail('space.removeAssets requires an assetSource selectionHandle');
  }
};
```

In the `SPACE_OP_VALIDATORS` object, add: `'space.removeAssets': validateSpaceRemoveAssets,`.

Add a `proposeAddAssetsToSpaceFromSearch` handler in the `handlers` object:

```js
    proposeAddAssetsToSpaceFromSearch: (args) => {
      if (Boolean(args?.spaceId) === Boolean(args?.spaceName)) {
        fail('proposeAddAssetsToSpaceFromSearch requires exactly one of spaceId or spaceName');
      }
      const source = args?.assetSource;
      if (!source || typeof source !== 'object') fail('proposeAddAssetsToSpaceFromSearch requires an assetSource');
      if (source.kind === 'selectionHandle' && !source.selectionHandleId) {
        fail('selectionHandle assetSource requires selectionHandleId');
      }
      return ok(config);
    },
```

### B. `manage-space-assets.mjs` — imports + resolveSpace + run()

Replace imports:

```js
import { SUBJECTIVE_PATTERN, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';
```

Add the space resolver (near `normalizeSpaceRef`):

```js
const resolveSpace = async ({ client, spaceRef, signal }) => {
  const ref = normalizeSpaceRef(spaceRef);
  const result = await client.call('listSpaces', {}, { signal });
  const spaces = Array.isArray(result?.spaces) ? result.spaces : [];
  const matches = spaces.filter((space) => clean(space?.name).toLowerCase() === ref.toLowerCase());
  return { ref, spaces, matches };
};
```

Replace the stub `run()`:

```js
  async run({ client, slots, signal }) {
    const action = clean(slots?.action).toLowerCase();
    const sourceDescription = cleanSource(slots?.sourceDescription);

    // 1. Resolve the space (none/ambiguous → ask).
    const { ref, matches } = await resolveSpace({ client, spaceRef: slots?.spaceRef, signal });
    if (matches.length === 0) {
      return needsInput({ text: `I could not find a space called "${ref}". Which space do you mean?` });
    }
    if (matches.length > 1) {
      return needsInput({ text: `Multiple spaces are called "${ref}". Which one do you mean?` });
    }
    const space = matches[0];
    const spaceName = clean(space.name) || ref;

    // 2. Resolve the source into a selection handle.
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
        text: `I could not find any photos matching "${sourceDescription}" to ${action === 'remove' ? 'remove from' : 'add to'} the "${spaceName}" space. Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    // 3. Propose ADD (proposeAddAssetsToSpaceFromSearch, spaceId only) or REMOVE
    //    (proposeAlbumOperations space.removeAssets). No raw asset ids reach the model.
    let planResult;
    let planTool;
    try {
      if (action === 'remove') {
        planTool = 'proposeAlbumOperations';
        planResult = await client.call(
          'proposeAlbumOperations',
          {
            summary: `Remove matching photos from the "${spaceName}" space.`,
            operations: [
              {
                type: 'space.removeAssets',
                summary: 'Remove matching photos.',
                targetKind: 'existing_space',
                targetId: space.id,
                assetSource: { kind: 'selectionHandle', selectionHandleId },
                payload: {},
              },
            ],
          },
          { signal },
        );
      } else {
        planTool = 'proposeAddAssetsToSpaceFromSearch';
        planResult = await client.call(
          'proposeAddAssetsToSpaceFromSearch',
          {
            summary: `Add matching photos to the "${spaceName}" space.`,
            spaceId: space.id,
            assetSource: { kind: 'selectionHandle', selectionHandleId },
          },
          { signal },
        );
      }
    } catch (error) {
      return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') });
    }

    const verb = action === 'remove' ? 'remove' : 'add';
    const preposition = action === 'remove' ? 'from' : 'to';
    return gatePlanResult({
      planResult,
      planTool,
      successText: `I prepared a plan to ${verb} ${assetCount} matching ${assetCount === 1 ? 'photo' : 'photos'} ${preposition} the "${spaceName}" space. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, spaceName, assetCount, action },
    });
  },
```

### C. run tests (add a `manage_space_assets execution` describe block; import `makeContractClient`)

- [ ] ADD planned: `wf.run({ client: makeContractClient(), slots:{ action:'add', spaceRef:'Family', sourceDescription:'my newest 20 photos' } })`
      → `outcome.status==='planned'`; a `proposeAddAssetsToSpaceFromSearch` call with
      `args.spaceId==='spc-1'`, `args.spaceName===undefined`, `args.assetSource` deepEquals
      `{ kind:'selectionHandle', selectionHandleId:'handle-1' }`; `JSON.stringify(calls)` has no `'assetIds'`.
- [ ] ADD `searchAssets` is metadata, order desc, limit 20, `args.query===undefined`.
- [ ] REMOVE planned: `slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my photos from 2024' }`
      → `'planned'`; the `proposeAlbumOperations` `operations[0]` deepEquals
      `{ type:'space.removeAssets', summary:'Remove matching photos.', targetKind:'existing_space', targetId:'spc-1', assetSource:{ kind:'selectionHandle', selectionHandleId:'handle-1' }, payload:{} }`.
- [ ] REMOVE date source → `searchAssets.filters` deepEquals `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`.
- [ ] handoff: `sourceDescription:'my screenshots'` (ADD) → `'handoff_open'`, no propose call.
- [ ] handoff: subjective `'the best ones'` → `'handoff_open'`, no propose.
- [ ] empty: `makeContractClient({ handleAssetCount:0 })`, ADD → `'needs_input'`, no propose.
- [ ] space unknown: `makeContractClient({ spaces:[] })`, `spaceRef:'Nope'` → `'needs_input'`; no `searchAssets`/propose.
- [ ] space ambiguous: `makeContractClient({ spaces:[{ id:'s1', name:'Family' }, { id:'s2', name:'Family' }] })` → `'needs_input'`; no propose.
- [ ] gate: `makeContractClient({ planResult:{ status:'success', plan:{} } })` → `'failed'` AND `!/prepared/i.test(text)` for BOTH add and remove.
- [ ] `listSpaces` throws → `'failed'`; `searchAssets` throws → `'failed'`; propose tool throws → `'failed'`.
- [ ] success summary: ADD planned → `outcome.successSummary` deepEquals `{ workflowKind:'manage_space_assets', spaceName:'Family', assetCount:20, action:'add' }`; text matches `/add/` + `Family`.
- [ ] contract-fixtures: `proposeAddAssetsToSpaceFromSearch` rejects `{ spaceId:'a', spaceName:'b', assetSource:{ kind:'selectionHandle', selectionHandleId:'h' } }` (both) `/exactly one/i`; rejects `{ spaceId:'a' }` (missing assetSource) `/assetSource/i`; accepts `{ spaceId:'a', assetSource:{ kind:'selectionHandle', selectionHandleId:'h' } }` → `{ plan:{ id:'plan-1' } }`.
- [ ] contract-fixtures: `proposeAlbumOperations` with a `space.removeAssets` op rejects `targetKind:'new_space'` `/existing_space/i`, rejects missing `targetId` `/targetId/i`, rejects `payload:{ x:1 }` `/payload/i`, accepts the valid op.

Run RED → implement A+B → GREEN.

## Phase 2 — registration + manifest + disambiguation + scenarios

- [ ] `registry.mjs`: import `manageSpaceAssetsWorkflow`; insert into `WORKFLOW_FACTORIES`
      **immediately before `addPhotosToAlbumWorkflow,`** (after `removePhotosFromAlbumWorkflow,`).
      Extend the order-rationale comment (members(people)/assets(photos)/album precedence).
- [ ] `manifest.mjs`: add the entry (after the `remove_photos_from_album` entry):

```js
  Object.freeze({
    kind: 'manage_space_assets',
    flow: 'hybrid',
    title: 'Add or remove photos in a space',
    classifierDescription:
      'User wants to add or remove a metadata-describable set of PHOTOS in a shared space (not members). Requires both a "space" target and a photo source.',
    positiveExamples: Object.freeze([
      'Add my newest 20 photos to the Family space',
      'Remove my screenshots from the Family space',
      'Put my 2024 photos into the Trips space',
    ]),
    negativeExamples: Object.freeze([
      'Add Alex to the Family space',
      'Add my newest 20 photos to Family',
      'Add my newest 20 photos to the Trips album',
    ]),
    slots: Object.freeze({
      action: Object.freeze({ type: 'string', required: true, description: 'add or remove.' }),
      spaceRef: Object.freeze({ type: 'string', required: true, description: 'How the user referred to the space.' }),
      sourceDescription: Object.freeze({ type: 'string', required: true, description: 'Metadata description of the photos.' }),
    }),
    requiredReadTools: Object.freeze(['listSpaces', 'resolveAssetSearchFilters', 'searchAssets']),
    planTool: 'proposeAddAssetsToSpaceFromSearch',
    supportsContinuation: false,
    matrixRow: Object.freeze({
      capability: 'Add/remove photos in a space',
      tier: 'Solid now',
      workflowOrBoundary:
        'Pi resolves the space and source; Gallery owns the space add (from-search) / remove (space.removeAssets) plan from the handle.',
    }),
  }),
```

- [ ] Regenerate: `/opt/homebrew/bin/mise exec -- node agent-runner/src/bin/sync-strict-workflow-manifest.mjs`.
- [ ] `manifest.test.mjs`: add a test — entry kind `'manage_space_assets'`, `flow:'hybrid'`,
      `planTool` present, `requiredReadTools` includes `'listSpaces'` and `'searchAssets'`.
- [ ] `disambiguation.test.mjs`:
  - CHANGE the existing `['add my newest 20 photos to the Family space', 'add_photos_to_album']`
    case to `'manage_space_assets'`.
  - ADD `['remove my screenshots from the Family space', 'manage_space_assets']`.
  - KEEP green (verify): `['add my newest 20 photos to Family', 'add_photos_to_album']`,
    `['add my newest 20 photos to the Trips album', 'add_photos_to_album']`,
    `['add Alex to the Family space', 'manage_space_members']`.
- [ ] `classification-recall.mjs`: append
  - `recall.spaceassets.add` → `'add my newest 20 photos to the Family space'` →
    `{ kind:'manage_space_assets', slotsSurvive:true, slots:{ action:'add', spaceRef:'Family' } }`
  - `recall.spaceassets.put` → `'put my newest 20 photos into the Family space'` →
    `{ kind:'manage_space_assets', slotsSurvive:true }`
  - `recall.spaceassets.takeout` → `'take my newest 20 photos out of the Family space'` →
    `{ kind:'manage_space_assets', slotsSurvive:true }`
- [ ] `classification-negatives.mjs`: append
  - `neg.spaceassets.member` → `'add Alex to the Family space'` → `{ kind:'manage_space_members' }` (NOT manage_space_assets)
- [ ] `slot-fidelity.mjs`: append
  - `slots.spaceassets.remove` → `'remove my newest 20 photos from the Family space'` →
    `{ kind:'manage_space_assets', slots:{ action:'remove', spaceRef:'Family', sourceDescription:'my newest 20 photos' } }`
- [ ] `l3-readonly.mjs`: FLIP the stale `l3.neg.space.add-photos` (currently
      `anyKind:['none','add_photos_to_album']`) — replace it with:
  - `l3.recall.space.add-photos` (category `'l3.recall'`) → `'add my newest 20 photos to the {space} space'` → `{ kind:'manage_space_assets' }`
  - `l3.plan.space.add` (category `'l3.plan'`, `threshold:0.5`) → `'add my newest 20 photos to the {space} space'` → `{ kind:'manage_space_assets', planProposed:true }`

Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Part C — eval runs (controller-driven, AFTER the unit commit)

- [ ] L1 full `eval/run.mjs --diff`: confirm `recall.spaceassets.*` / `slots.spaceassets.*`
      pass, `neg.spaceassets.member` stays manage_space_members, NO regression; then `--accept`.
- [ ] L3: deferred to the final RC (the `proposeAddAssetsToSpaceFromSearch` selectionHandle
      path is data-dependent on the user being an Editor of a real space — threshold 0.5).

## Edge cases

- ADD passes `spaceId` ONLY (exactly-one rule); REMOVE op `payload:{}`; both use selection
  handles (no raw ids).
- non-Editor → server error → `failed` (runner can't pre-guard role).
- "my screenshots" matches the router but the resolver hands it off → handoff_open.
- registry order: manage_space_assets immediately before add_photos; the stale
  `add_photos`/`l3.neg.space.add-photos` assertions flipped.

## Acceptance

- `manage_space_assets` plans space add/remove via the verified contracts, gated; the
  fixture throws on wrong-shape space-asset calls; registered before add_photos.
- `mise exec -- pnpm --dir agent-runner test` green; (Part C) L1 ≥ baseline re-seeded.

## Commit

- One commit: `feat(agent): manage_space_assets — add/remove photos in a space + fixtures + registration + L1/L3 (phase 2 slice 14)`.
