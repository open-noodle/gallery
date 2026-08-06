# Pi Agent Workflow Expansion (Phase 2) — Slice 6 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the contract-faithful fake client reject every malformed
`asset.updateMetadata` batch action exactly as the real schema does, so the Slice-8
execution tests' wrong-shape calls THROW in L2 (the `add_photos` lesson) rather than
passing silently. Fixture-only slice.

**Spec scope:** Slice 6 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/workflows/contract-fixtures.mjs`
- `agent-runner/src/strict-workflows/workflows/contract-fixtures.test.mjs`

## Verified real contract (server/src/dtos/agent-operation.dto.ts:432-510)

The `asset.updateMetadata` action is a **flat strictObject** (`type` + fields siblings),
fields = `description, rating, dateTimeOriginal, dateTimeRelative, timeZone, latitude,
longitude`:

- `description`: string, trimmed, max 1000. **Empty string is VALID** (clears it).
- `rating`: int 1..5, nullable (null clears).
- `dateTimeOriginal`: ISO datetime.
- `dateTimeRelative`: int (minute offset).
- `timeZone`: IANA string (non-empty).
- `latitude`: -90..90; `longitude`: -180..180.

Cross-field superRefine rules:

1. ≥1 field supplied (else "Provide at least one metadata field").
2. NOT both `dateTimeOriginal` and `dateTimeRelative`.
3. `dateTimeRelative === 0` as the SOLE field → no-op error.
4. `latitude`/`longitude` exactly-one → error ("Provide both latitude and longitude").

`KNOWN_BATCH_ACTION_TYPES` already lists `asset.updateMetadata` — only
`validateBatchAction` needs the branch.

## Implementation (exact)

**Add** near the other batch-action constants in `contract-fixtures.mjs`:

```js
const UPDATE_METADATA_FIELDS = new Set([
  'description',
  'rating',
  'dateTimeOriginal',
  'dateTimeRelative',
  'timeZone',
  'latitude',
  'longitude',
]);

// Mirror AgentAssetBatch asset.updateMetadata: flat strictObject + the 4 cross-field
// rules + per-field bounds, so a wrong-shape live call also throws here.
const validateUpdateMetadataAction = (action) => {
  for (const key of Object.keys(action)) {
    if (key !== 'type' && !UPDATE_METADATA_FIELDS.has(key)) {
      fail(`unknown asset.updateMetadata field "${key}"`);
    }
  }
  const supplied = [...UPDATE_METADATA_FIELDS].filter((field) => action[field] !== undefined);
  if (supplied.length === 0) fail('asset.updateMetadata requires at least one metadata field');
  if (
    action.description !== undefined &&
    (typeof action.description !== 'string' || action.description.length > 1000)
  ) {
    fail('asset.updateMetadata description must be a string of at most 1000 chars');
  }
  if (action.rating !== undefined && action.rating !== null) {
    const r = action.rating;
    if (typeof r !== 'number' || !Number.isInteger(r) || r < 1 || r > 5) {
      fail('asset.updateMetadata rating must be an integer 1..5 or null');
    }
  }
  if (
    action.dateTimeRelative !== undefined &&
    (typeof action.dateTimeRelative !== 'number' || !Number.isInteger(action.dateTimeRelative))
  ) {
    fail('asset.updateMetadata dateTimeRelative must be an integer');
  }
  if (action.timeZone !== undefined && (typeof action.timeZone !== 'string' || action.timeZone.trim().length === 0)) {
    fail('asset.updateMetadata timeZone must be a non-empty IANA time zone');
  }
  if (
    action.latitude !== undefined &&
    (typeof action.latitude !== 'number' || action.latitude < -90 || action.latitude > 90)
  ) {
    fail('asset.updateMetadata latitude must be between -90 and 90');
  }
  if (
    action.longitude !== undefined &&
    (typeof action.longitude !== 'number' || action.longitude < -180 || action.longitude > 180)
  ) {
    fail('asset.updateMetadata longitude must be between -180 and 180');
  }
  if (action.dateTimeOriginal !== undefined && action.dateTimeRelative !== undefined) {
    fail('asset.updateMetadata: choose dateTimeOriginal or dateTimeRelative, not both');
  }
  if (action.dateTimeRelative === 0 && supplied.length === 1) {
    fail('asset.updateMetadata dateTimeRelative: 0 is a no-op unless another field changes');
  }
  if (Number(action.latitude !== undefined) + Number(action.longitude !== undefined) === 1) {
    fail('asset.updateMetadata requires both latitude and longitude');
  }
};
```

**Add** the branch in `validateBatchAction` (after the existing `asset.addTag` branch):

```js
if (type === 'asset.updateMetadata') {
  validateUpdateMetadataAction(action);
}
```

(No change to `KNOWN_BATCH_ACTION_TYPES` — `asset.updateMetadata` is already listed. The
existing setFavorite/setArchive/addTag branches and tests stay untouched.)

## TDD steps

### Task 1: tests (red)

Add a `describe('makeContractClient — asset.updateMetadata action')` block to
`contract-fixtures.test.mjs`. Use `client.call('proposeAssetBatchFromSelection',
{ action, selectionHandleId: 'h' })` and assert `plan.id === 'plan-1'` on accept,
`assert.rejects(..., /regex/)` on reject.

- [ ] accepts `{ type:'asset.updateMetadata', description:'Berlin weekend' }` → `plan.id === 'plan-1'`
- [ ] accepts `{ type:'asset.updateMetadata', description:'' }` (empty clears) → `plan.id`
- [ ] accepts `{ type:'asset.updateMetadata', rating:5 }` and `{ …, rating:null }`
- [ ] accepts `{ type:'asset.updateMetadata', latitude:48.8566, longitude:2.3522 }`
- [ ] accepts `{ type:'asset.updateMetadata', dateTimeRelative:120 }`
- [ ] rejects `{ type:'asset.updateMetadata' }` → `/at least one metadata field/i`
- [ ] rejects `{ …, latitude:48.8 }` → `/both latitude and longitude/i`
- [ ] rejects `{ …, longitude:2.3 }` → `/both latitude and longitude/i`
- [ ] rejects `{ …, dateTimeOriginal:'2024-01-01T00:00:00.000Z', dateTimeRelative:120 }` → `/dateTimeOriginal or dateTimeRelative/i`
- [ ] rejects `{ …, dateTimeRelative:0 }` → `/no-op|dateTimeRelative/i`
- [ ] rejects `{ …, rating:0 }` and `{ …, rating:6 }` → `/rating/i`
- [ ] rejects `{ …, placeName:'Paris' }` → `/unknown|placeName/i`
- [ ] `assert.equal(KNOWN_BATCH_ACTION_TYPES.has('asset.updateMetadata'), true)`
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (validator branch absent;
      malformed actions currently pass).

### Task 2: implement (green)

- [ ] Add `UPDATE_METADATA_FIELDS`, `validateUpdateMetadataAction`, and the
      `validateBatchAction` branch.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- `description:''` is VALID (clear path) — must NOT throw.
- `rating:null` valid; `rating:0`/`6` invalid.
- half-coordinate rejected (lat XOR lng).
- `dateTimeOriginal` + `dateTimeRelative` mutually exclusive.
- `dateTimeRelative:0` sole field is a no-op error.
- unknown key (`placeName`) rejected (strictObject).
- additive: setFavorite/setArchive/addTag branches and `KNOWN_BATCH_ACTION_TYPES` unchanged.

## Acceptance

- Every malformed `asset.updateMetadata` action throws in the fixture exactly as the real
  schema rejects it; valid ones return `plan.id`.
- `mise exec -- pnpm --dir agent-runner test` green.

## Commit

- One commit: `test(agent): validate the asset.updateMetadata batch action in the contract fixture (phase 2 slice 6)`.
