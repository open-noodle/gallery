# Pi Agent Workflow Expansion (Phase 2) — Slice 8 Implementation Plan

> **For agentic workers:** Implement test-first. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement `update_asset_metadata` `run()`: resolve the source via
`resolveAssetSource` (handoff/needs_input/empty/failed mapping identical to archive),
then `proposeAssetBatchFromSelection` with action `{ type:'asset.updateMetadata',
…payload }`, gated on a persisted plan id. Half-coordinate / place-name (defensive) →
`needs_input`. No raw asset ids ever reach the model (selection handle only).

**Spec scope:** Slice 8 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/update-asset-metadata.mjs`
- `agent-runner/src/strict-workflows/workflows/update-asset-metadata.test.mjs`

## Notes

- `run()` receives `slots = { sourceDescription, payload }` (the `parseSlots` output).
  `run()` does NOT parse — it carries `payload` straight into the flat
  `asset.updateMetadata` action. (Date-string parsing is the router's job; the
  20xx-only `parseDateRange` limitation for absolute non-recent dates like "June 1998"
  is a known router gap, NOT a run() concern — run() passes a typed `dateTimeOriginal`
  through.)
- The action is FLAT (`{ type, …payload }`) — the Slice-6 contract client throws on a
  nested `{ type, payload }` shape, so the deepEqual tests lock the flat shape.

## Implementation (exact)

### 1. Replace the import lines at the top of `update-asset-metadata.mjs`

```js
import { SUBJECTIVE_PATTERN, parseDateRange, resolveAssetSource } from '../asset-source-resolver.mjs';
import { failed, handoffOpen, needsInput } from '../protocol.mjs';
import { gatePlanResult, safeFailureText } from './plan-gate.mjs';
```

### 2. Add the success-copy helper (near the other helpers)

```js
// Field-specific before/after framing for the success copy + the plan summary target.
const describeChange = (payload, assetCount) => {
  const noun = assetCount === 1 ? 'photo' : 'photos';
  const scope = `${assetCount} ${noun}`;
  if (payload.description !== undefined) {
    return payload.description === ''
      ? { text: `clear the description on ${scope}`, target: 'description' }
      : { text: `set the description on ${scope} to "${payload.description}"`, target: 'description' };
  }
  if (payload.rating !== undefined) {
    return payload.rating === null
      ? { text: `clear the rating on ${scope}`, target: 'rating' }
      : {
          text: `set the rating on ${scope} to ${payload.rating} star${payload.rating === 1 ? '' : 's'}`,
          target: 'rating',
        };
  }
  if (payload.timeZone !== undefined) {
    return { text: `set the timezone on ${scope} to ${payload.timeZone}`, target: 'timezone' };
  }
  if (payload.latitude !== undefined) {
    return { text: `set the location on ${scope} to ${payload.latitude}, ${payload.longitude}`, target: 'location' };
  }
  if (payload.dateTimeOriginal !== undefined) {
    return { text: `set the date on ${scope} to ${payload.dateTimeOriginal}`, target: 'date' };
  }
  if (payload.dateTimeRelative !== undefined) {
    return { text: `shift the date on ${scope} by ${payload.dateTimeRelative} minutes`, target: 'date' };
  }
  return { text: `update metadata on ${scope}`, target: 'metadata' };
};
```

### 3. Replace the stub `run()` with the full implementation

```js
  async run({ client, slots, signal }) {
    const sourceDescription = clean(slots?.sourceDescription);
    const payload = slots?.payload && typeof slots.payload === 'object' ? slots.payload : null;
    if (!sourceDescription || !payload || Object.keys(payload).length === 0) {
      return needsInput({ text: 'Tell me which photos to update and what to change.' });
    }
    // Defensive half-coordinate / place-name guard (parseSlots already prevents it).
    if ((payload.latitude !== undefined) !== (payload.longitude !== undefined)) {
      return needsInput({ text: 'I need both a latitude and a longitude to set a location.' });
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
        text: `I could not find any photos matching "${sourceDescription}". Can you describe them differently?`,
      });
    }
    const { selectionHandleId, assetCount } = resolution;

    const change = describeChange(payload, assetCount);
    let planResult;
    try {
      planResult = await client.call(
        'proposeAssetBatchFromSelection',
        {
          summary: `Update photo ${change.target}.`,
          action: { type: 'asset.updateMetadata', ...payload },
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
      successText: `I prepared a plan to ${change.text}. Review the plan before applying it.`,
      successSummary: { workflowKind: KIND, assetCount, target: change.target },
    });
  },
```

(Remove the Slice-7 stub `run()`.)

## TDD steps

### Task 1: tests (red)

Add a `describe('update_asset_metadata execution')` block. Use
`makeContractClient` (import it). `const wf = updateAssetMetadataWorkflow();` Build
`slots = { sourceDescription, payload }` directly.

- [ ] description run: `slots={ sourceDescription:'my newest 20 photos', payload:{ description:'Berlin weekend' } }`,
      `makeContractClient()` → `outcome.status==='planned'`; the
      `proposeAssetBatchFromSelection` call `args.action` deepEquals
      `{ type:'asset.updateMetadata', description:'Berlin weekend' }`; `args.selectionHandleId==='handle-1'`;
      `JSON.stringify(client.calls).includes('assetIds')===false`.
- [ ] rating run: `payload:{ rating:5 }` → `args.action` deepEquals `{ type:'asset.updateMetadata', rating:5 }`.
- [ ] clear-rating: `payload:{ rating:null }` → action `{ type:'asset.updateMetadata', rating:null }`.
- [ ] clear-description: `payload:{ description:'' }` → action `{ type:'asset.updateMetadata', description:'' }`; does NOT throw.
- [ ] timezone: `payload:{ timeZone:'Europe/Berlin' }` → action `{ …, timeZone:'Europe/Berlin' }`.
- [ ] location: `payload:{ latitude:48.8566, longitude:2.3522 }` → action `{ …, latitude:48.8566, longitude:2.3522 }`.
- [ ] date-absolute: `payload:{ dateTimeOriginal:'1998-06-15T00:00:00.000Z' }` → `action.dateTimeOriginal` matches `/^1998-06/`; status `'planned'`.
- [ ] relative-shift: `payload:{ dateTimeRelative:120 }` → `action.dateTimeRelative===120`.
- [ ] date SOURCE + field: `slots={ sourceDescription:'my photos from 2024', payload:{ rating:5 } }` →
      the `searchAssets` call `args.filters` deepEquals `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }`
      AND `action` deepEquals `{ type:'asset.updateMetadata', rating:5 }`.
- [ ] success copy: description run `outcome.text` matches `/set the description/` and includes `Berlin weekend`;
      rating run matches `/rating/` and includes `5`; timezone matches `/timezone/i` and includes `Europe/Berlin`.
- [ ] handoff: `slots={ sourceDescription:'the best ones', payload:{ description:'X' } }` → `outcome.status==='handoff_open'`;
      `proposeAssetBatchFromSelection` NOT called.
- [ ] empty: `makeContractClient({ handleAssetCount:0 })`, `payload:{ rating:5 }` → `outcome.status==='needs_input'`;
      propose NOT called.
- [ ] half-coordinate defensive: `slots={ sourceDescription:'my newest 20 photos', payload:{ latitude:48.8 } }` →
      `outcome.status==='needs_input'` (text mentions latitude/longitude); resolver/propose NOT called.
- [ ] gate: `makeContractClient({ planResult:{ status:'success', plan:{} } })`, `payload:{ rating:5 }` →
      `outcome.status==='failed'` AND `/prepared|set the/i.test(outcome.text)===false`.
- [ ] search throws → `outcome.status==='failed'` (use a client whose `searchAssets` throws).
- [ ] propose throws → `outcome.status==='failed'` (`makeContractClient` with a propose that throws, or override).
- [ ] singular/plural: `makeContractClient({ handleAssetCount:1 })`, `payload:{ rating:5 }` → `outcome.text` contains `1 photo` (not `1 photos`).
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (run() is the stub; returns handoff_open for everything).

### Task 2: implement (green)

- [ ] Apply edits 1-3. Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- FLAT action shape (deepEqual on `{ type, …fields }`).
- `description:''` clear path does not throw; `rating:null` clear path.
- date FIELD applied while a date SOURCE bounds the search (both present).
- half-coordinate → defensive `needs_input` before any tool call.
- resolver `empty` → `needs_input`; `handoff` → `handoff_open`; `needs_input` passthrough.
- gate blocks success copy without a persisted plan id; tool errors → `failed`.
- singular/plural copy; no raw asset ids in any call.

## Acceptance

- `run()` plans a flat `asset.updateMetadata` over a resolved handle, gated, with
  field-specific copy; all resolver outcomes and the no-raw-ids invariant hold.
- `mise exec -- pnpm --dir agent-runner test` green.

## Commit

- One commit: `feat(agent): update_asset_metadata execution — resolve → asset.updateMetadata → gate (phase 2 slice 8)`.
