# Pi Agent Workflow Expansion (Phase 2) — Slice 3 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Never guess. The resolver inspects `resolveAssetSearchFilters` `results[]`:
any `'ambiguous'` or `'not_found'` → a NEW 4th return shape
`{ status:'needs_input', text }` (carrying a clarifying question, labels only — never
ids); only when ALL are `'matched'` does it proceed to `searchAssets`. Wire the one-line
`needs_input` branch into all five source workflows.

**Spec scope:** Slice 3 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/asset-source-resolver.mjs`
- `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`
- `agent-runner/src/strict-workflows/workflows/add-photos-to-album.mjs`
- `agent-runner/src/strict-workflows/workflows/archive-assets.mjs`
- `agent-runner/src/strict-workflows/workflows/favorite-assets.mjs`
- `agent-runner/src/strict-workflows/workflows/tag-assets.mjs`
- `agent-runner/src/strict-workflows/workflows/create-album-from-source.mjs`
- `agent-runner/src/strict-workflows/workflows/add-photos-to-album.test.mjs`
- `agent-runner/src/strict-workflows/workflows/tag-assets.test.mjs`
- `agent-runner/src/strict-workflows/workflows/create-album-from-source.test.mjs`

## Verified facts

- `results[]` element: `{ kind:'person'|'tag'|'album'|'space'|'cameraMake'|'cameraModel'|
'lensModel', query, status:'matched'|'ambiguous'|'not_found', value?, id?, searchFilter?,
choices:[{ id?, value, label, … }], message }`.
- The fixture already returns `results` when `config.resolveResults` is set (Slice 2). A
  matched result set is the default (`resolveResults` absent → `results:[]` ⇒ all-matched
  by absence), so Slice 2 happy-path tests stay green.
- All 5 source workflows already `import { …, needsInput } from '../protocol.mjs'` and
  share the identical branch sequence `if (resolution.status === 'handoff') {…}` directly
  followed by `if (resolution.status === 'empty') {…}`. `resolveAssetSource` has exactly
  these 5 callers (no unhandled `needs_input` elsewhere).
- `needsInput({ text })` → `{ status:'needs_input', … }`.

## Implementation (exact)

### A. `asset-source-resolver.mjs`

**A1.** Add needs_input copy helpers after `mergeResultSearchFilters`:

```js
// Human nouns for needs_input copy. Copy uses choice LABELS / queries only — never
// ids or raw choice payloads (model-facing-arg safety invariant).
const RESOLVE_KIND_NOUN = {
  person: 'person',
  tag: 'tag',
  album: 'album',
  space: 'space',
  cameraMake: 'camera',
  cameraModel: 'camera',
  lensModel: 'lens',
};

const joinList = (items) => {
  const list = items.filter(Boolean);
  if (list.length <= 1) {
    return list[0] ?? '';
  }
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

const ambiguousNeedsInputText = (results) => {
  const phrases = results.map((result) => {
    const labels = (result.choices ?? []).map((choice) => choice?.label).filter(Boolean);
    const suffix = labels.length > 0 ? ` (${joinList(labels)})` : '';
    return `"${result.query}"${suffix}`;
  });
  return `Which did you mean for ${joinList(phrases)}?`;
};

const notFoundNeedsInputText = (results) => {
  const phrases = results.map(
    (result) => `a ${RESOLVE_KIND_NOUN[result.kind] ?? result.kind} called "${result.query}"`,
  );
  return `I could not find ${joinList(phrases)}. Could you say which one you mean?`;
};
```

**A2.** In `resolveAssetSource`, replace the name-lookup block (the
`if (Object.keys(nameRequest).length > 0) { … }` body) with status inspection BEFORE
reading `resolvedFilters`:

```js
const nameRequest = buildResolverNameRequest(entity);
let resolvedFilters = {};
if (Object.keys(nameRequest).length > 0) {
  const resolution = await client.call('resolveAssetSearchFilters', nameRequest, { signal });
  const results = resolution?.results ?? [];
  // Never guess: any ambiguous or not-found entity asks for input instead of
  // trusting a partial/empty resolvedFilters.
  const ambiguous = results.filter((result) => result?.status === 'ambiguous');
  if (ambiguous.length > 0) {
    return { status: 'needs_input', text: ambiguousNeedsInputText(ambiguous) };
  }
  const notFound = results.filter((result) => result?.status === 'not_found');
  if (notFound.length > 0) {
    return { status: 'needs_input', text: notFoundNeedsInputText(notFound) };
  }
  resolvedFilters = resolution?.resolvedFilters ?? {};
  if (Object.keys(resolvedFilters).length === 0) {
    resolvedFilters = mergeResultSearchFilters(results);
  }
}
```

**A3.** Update the module doc comment block (top of file) to list the 4th return shape:
`| { status: 'needs_input', text }   // ambiguous / not-found named entity`.

### B. The 5 source workflows (identical one-line branch each)

In EACH of `add-photos-to-album.mjs`, `archive-assets.mjs`, `favorite-assets.mjs`,
`tag-assets.mjs`, `create-album-from-source.mjs`, insert the `needs_input` branch
between the existing `handoff` block and the `empty` block. The anchor (identical in all
five) is:

```js
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'empty') {
```

Insert so it becomes:

```js
    if (resolution.status === 'handoff') {
      return handoffOpen({ reason: resolution.reason });
    }
    if (resolution.status === 'needs_input') {
      return needsInput({ text: resolution.text });
    }
    if (resolution.status === 'empty') {
```

No other change to the workflows (they already import `needsInput`).

## TDD steps

### Task 1: resolver tests (red)

In `asset-source-resolver.test.mjs`, add `describe('resolveAssetSource — entity ambiguity / not-found')`:

- [ ] ambiguous person: `makeContractClient({ resolveResults: [{ kind:'person', query:'Alex',
status:'ambiguous', choices:[{ value:'p1', label:'Alex Smith' }, { value:'p2', label:'Alex Jones' }], message:'' }] })`,
      source `'photos of Alex'` → `result.status === 'needs_input'`, `/which.*Alex/i.test(result.text)`,
      and NO `searchAssets` call.
- [ ] not-found tag: `resolveResults: [{ kind:'tag', query:'Trvel', status:'not_found', choices:[], message:'' }]`,
      source `'photos tagged Trvel'` → `needs_input`, `/could not find.*tag.*Trvel/i`, NO `searchAssets`.
- [ ] mixed (matched person + not-found tag): `resolveResults: [{ kind:'person', query:'Alex',
status:'matched', choices:[], message:'' }, { kind:'tag', query:'Trvel', status:'not_found', choices:[], message:'' }]`,
      source `'photos of Alex tagged Trvel'` → `needs_input`, text mentions `Trvel`, NO `searchAssets`.
- [ ] two ambiguous → single needs_input: `resolveResults: [{ kind:'person', query:'Alex',
status:'ambiguous', choices:[{ value:'a', label:'Alex Smith' }], message:'' }, { kind:'tag', query:'Travel',
status:'ambiguous', choices:[{ value:'t', label:'Travel 2024' }], message:'' }]`, source
      `'photos of Alex tagged Travel'` → `needs_input`, text matches BOTH `/Alex/` and `/Travel/`.
- [ ] all-matched proceeds (regression): `makeContractClient({ resolvedFilters:{ personIds:['per-1'] },
resolveResults:[{ kind:'person', query:'Alex', status:'matched', choices:[], message:'' }] })`,
      source `'photos of Alex'` → `status === 'resolved'`; `searchAssets.filters` deepEqual `{ personIds:['per-1'] }`.
- [ ] ambiguous-vs-empty distinction: matched person with ZERO photos →
      `makeContractClient({ resolvedFilters:{ personIds:['per-1'] }, resolveResults:[{ kind:'person',
query:'Alex', status:'matched', choices:[], message:'' }], handleAssetCount:0 })`, source
      `'photos of Alex'` → `status === 'empty'` (NOT `needs_input` — different branch).
- [ ] needs_input copy carries NO ids: in the ambiguous test, assert
      `result.text.includes('p1') === false` and `result.text.includes('p2') === false`
      (labels only).
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED (resolver still resolves /
      ignores result status).

### Task 2: caller tests (red→green wiring)

- [ ] `tag-assets.test.mjs`: add a test — `makeContractClient({ resolveResults:[{ kind:'person',
query:'Alex', status:'ambiguous', choices:[{ value:'a', label:'Alex Smith' }, { value:'b', label:'Alex Jones' }],
message:'' }] })`, `wf.run({ client, slots:{ tagName:'Family', sourceDescription:'photos of Alex' } })`
      → `outcome.status === 'needs_input'` AND `client.calls.some((c) => c.name === 'proposeAssetBatchFromSelection') === false`.
- [ ] `add-photos-to-album.test.mjs`: add a test — `makeContractClient({ resolveResults:[{ kind:'person',
query:'Alex', status:'not_found', choices:[], message:'' }] })`,
      `wf.run({ client, slots:{ albumRef:'Family', sourceDescription:'photos of Alex' } })`
      → `outcome.status === 'needs_input'` AND `proposeAlbumOperations` NOT called. (Album `Family`
      resolves from the default `albums` config; only the SOURCE is not-found.)
- [ ] `create-album-from-source.test.mjs`: add a test — `makeContractClient({ resolveResults:[{ kind:'album',
query:'Italy', status:'ambiguous', choices:[{ value:'x', label:'Italy 2023' }, { value:'y', label:'Italy 2024' }],
message:'' }] })`, `wf.run({ client, slots:{ sourceDescription:'photos in the Italy album', albumName:'X' } })`
      → `outcome.status === 'needs_input'` AND `proposeAlbumFromSelection` NOT called.
- [ ] Apply edit B to all 5 workflows.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- ambiguous-vs-empty: a single matched person with zero photos → `empty` (the existing
  zero-asset branch), DISTINCT from `ambiguous` (multiple matches) → `needs_input`.
- mixed matched + not_found → `needs_input` (never partial-resolve).
- multiple ambiguous → ONE `needs_input` listing all (no loop-ask within a turn).
- needs_input copy leaks NO ids / raw choice payloads — labels and queries only.
- existing `'empty'` (zero-asset) and `'handoff'` (subjective/unbounded) branches
  unchanged (prior tests stay green).
- all-matched still proceeds to `searchAssets` (Slice-2 happy path preserved, results
  default `[]` ⇒ all-matched by absence).

## Acceptance

- The resolver returns `{ status:'needs_input', text }` for any ambiguous/not-found
  entity and only resolves on all-matched; `searchAssets` is not called on needs_input.
- All five source workflows map `resolution.status === 'needs_input'` →
  `needsInput({ text })`, asserted live in tag/add/create-album.
- `mise exec -- pnpm --dir agent-runner test` green.

## Commit

- One commit: `feat(agent): ambiguous/not-found entity sources ask for input instead of guessing (phase 2 slice 3)`.
