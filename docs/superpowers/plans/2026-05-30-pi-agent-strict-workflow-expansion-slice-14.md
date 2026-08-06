# Workflow Expansion — Slice 14: `rename_or_describe_space` execution

> Test-first against the contract-faithful fake client.

**Goal:** Add `run()` to `rename-or-describe-space.mjs`: `listSpaces` → resolve by
name (none/multiple → needs_input) → `proposeAlbumOperations([space.updateDetails])`
preserving unspecified fields → `gatePlanResult` → copy.

**Spec scope:** Slice 14. **Depends on:** Slice 13 (router), `makeContractClient`,
plan-gate. Verified DTO: `space.updateDetails` =
`{ type, summary, targetKind:'existing_space', targetId, payload:{ spaceName?, description?, color? } }`
(payload strictObject, ≥1 field; field is **spaceName**, not name).

## Contract fixture — validate space.updateDetails shape

In `contract-fixtures.mjs` `validateOperations`, when `op.type === 'space.updateDetails'`:

- `op.targetKind === 'existing_space'` else fail.
- `op.targetId` present else fail.
- `op.payload` is an object whose keys ⊆ `{ spaceName, description, color }` and ≥1
  present, else fail (mirrors the strictObject + refine).

(Add `KNOWN_SPACE_DETAILS_KEYS = new Set(['spaceName','description','color'])`.)

## Design — `run({ client, slots, signal })`

```
const newName = clean(slots?.newName);
const description = clean(slots?.description);
if (!newName && !description) {
  return needsInput({ text: 'Tell me the new space name or the description you would like to set.' });
}
const result = await client.call('listSpaces', {}, { signal });
const spaces = Array.isArray(result?.spaces) ? result.spaces : [];
const ref = normalizeSpaceRef(slots?.spaceRef);
const matches = spaces.filter((s) => clean(s?.name).toLowerCase() === ref.toLowerCase());
if (matches.length === 0) return needsInput({ text: `I could not find a space called "${ref}". Which space do you mean?` });
if (matches.length > 1)  return needsInput({ text: `Multiple spaces are called "${ref}". Which one do you mean?` });
const space = matches[0];

const payload = {};
if (newName) payload.spaceName = newName;
if (description) payload.description = description;

const changeParts = [];
if (newName) changeParts.push(`rename it to "${newName}"`);
if (description) changeParts.push('update its description');

let planResult;
try {
  planResult = await client.call('proposeAlbumOperations', {
    summary: 'Update space details.',
    operations: [{ type:'space.updateDetails', summary:'Update space details.', targetKind:'existing_space', targetId: space.id, payload }],
  }, { signal });
} catch (error) { return failed({ text: safeFailureText(error?.message ?? 'The planning tool failed.') }); }

return gatePlanResult({
  planResult,
  successText: `I prepared a plan to ${changeParts.join(' and ')} for the "${clean(space.name) || ref}" space. Review the plan before applying it.`,
  successSummary: { workflowKind: KIND, target: clean(space.name) || ref },
});
```

Imports to add: `failed`, `needsInput` from `../protocol.mjs`; `gatePlanResult`,
`safeFailureText` from `./plan-gate.mjs`. Including only the set fields in `payload`
preserves the unspecified ones (server semantics). Registry/manifest: Slice 19.

## TDD — exact tests (add to `rename-or-describe-space.test.mjs`)

Add `import { makeContractClient } from './contract-fixtures.mjs';`. Flip the
router-only `typeof wf.run === 'undefined'` assertion to `'function'`.

- [ ] **rename preserves description:** `wf.run({ client: makeContractClient({ spaces:[{ id:'spc-1', name:'Family', members:[] }] }), slots:{ spaceRef:'Family', newName:'Family 2026' } })`
      → `planned`; the `proposeAlbumOperations` op deepEquals
      `{ type:'space.updateDetails', summary:'Update space details.', targetKind:'existing_space', targetId:'spc-1', payload:{ spaceName:'Family 2026' } }` (no `description` key).
- [ ] **describe preserves name:** `slots:{ spaceRef:'Family', description:'Our memories' }`
      → op `payload` deepEquals `{ description:'Our memories' }` (no `spaceName`).
- [ ] **both fields:** `slots:{ spaceRef:'Family', newName:'Family 2026', description:'Our memories' }`
      → `payload` deepEquals `{ spaceName:'Family 2026', description:'Our memories' }`.
- [ ] **ambiguous space → needs_input (no propose):** `makeContractClient({ spaces:[{ id:'a', name:'Family' }, { id:'b', name:'Family' }] })`,
      `slots:{ spaceRef:'Family', newName:'X' }` → `needs_input`; no `proposeAlbumOperations`.
- [ ] **unknown space → needs_input:** default client, `slots:{ spaceRef:'Nope', newName:'X' }` → `needs_input`; no propose.
- [ ] **planless → failed (gate), no success copy:** `makeContractClient({ planResult:{ status:'success', plan:{} } })`,
      `slots:{ spaceRef:'Family', newName:'X' }` → `failed`; `outcome.text` does not match `/prepared/i`.
- [ ] **defensive no-field → needs_input:** `slots:{ spaceRef:'Family' }` → `needs_input` (never a no-op plan); no propose.

## Edge cases covered

- rename-only preserves description; describe-only preserves name; both.
- unknown / ambiguous space → needs_input (never a guess).
- gate blocks planless success copy; defensive no-field guard.
- correct DTO shape (targetKind existing_space, payload.spaceName) pinned by the
  fixture + the op deepEqual.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'
```

- New execution tests green; all prior green; `typeof wf.run === 'function'`.

## Commit

`feat: add rename_or_describe_space execution (space.updateDetails plan) (slice 14)`
