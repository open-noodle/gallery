# Pi Agent Workflow Expansion (Phase 2) — Slice 4 Implementation Plan

> **For agentic workers:** Implement test-first (write the failing test, run it red,
> implement minimally, run it green). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Lock the full combination behavior so entity sources combine correctly with
recency / date / type / direct parsers, and prove the clean-gate REFUSES to over-resolve
on an unconsumed residual. The over-resolution guards already landed (Slice 2 empty-merged
guard + Slice 1 entity-aware `isCleanSource`; Slice 3 not-found → needs_input). This slice
is mostly the matrix test battery plus ONE small parser fix (`favorited`).

**Spec scope:** Slice 4 of
`docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-2-design.md`.

**Tech stack:** Node.js ESM, `node:test`, `mise exec -- pnpm --dir agent-runner test`.

**Files:**

- `agent-runner/src/strict-workflows/asset-source-resolver.mjs` (two 2-char regex edits)
- `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs` (matrix battery)

## Code change (small)

The matrix surfaces one gap: `favorited` / `favourited` is a favorites signal but the
Slice-1 regex `favou?rites?` lacks the `d` suffix (no trailing boundary on `favorited`).

- [ ] In `parseEntitySource` rule (6), change the test+replace regex from
      `/\bfavou?rites?\b/...` to `/\bfavou?rite[ds]?\b/...` (matches favorite / favorites /
      favorited / favourited; still rejects `unfavorite`). Apply to BOTH the `if (…test…)`
      and the `.replace(…)` in rule (6).
- [ ] In `ENTITY_KEYWORD_STRIP`, change `favou?rites?` → `favou?rite[ds]?` so
      `isCleanSource` consumes `favorited` too.

No other resolver code change — the guards are already in place.

## Deliberate deviation: place-vs-person collision (`photos of Paris`)

The spec's Slice-4 edge note suggests "try people via the resolver, and if person
not_found fall to **city**." We do NOT implement the silent person→city fallback:

- It is lexically indistinguishable from a genuine not-found person (`'photos of Alex'`)
  without a place gazetteer, so a blanket fallback would silently search `city:'Alex'`.
- It would break the Slice-3 invariant (and its `add_photos` not-found test): a not-found
  person source returns `needs_input`, never a guessed search.
- "Never guess; ambiguous/not-found → `needs_input`" is a HARD spec invariant that
  outranks the convenience fallback.

So `'photos of Paris'` resolves via `personIds` when the person matches, and asks for
input (`needs_input`) when not found — the safe, consistent branch. We lock BOTH branches
with tests (matched → `personIds`; not_found → `needs_input`).

## TDD steps

### Task 1: matrix tests (red on the `favorited` case only)

Add `describe('resolveAssetSource — entity × recency/date/type/direct matrix')` to
`asset-source-resolver.test.mjs`. Use `NOW` (already defined) where dates are relative.
Find the `searchAssets` call via `client.calls.find((c) => c.name === 'searchAssets')`.

- [ ] `'newest 20 photos of Alex'` + `makeContractClient({ resolvedFilters:{ personIds:['per-1'] },
resolveResults:[{ kind:'person', query:'Alex', status:'matched', choices:[], message:'' }] })`
      → resolved; `search.args.order === 'desc'`, `search.args.limit === 20`,
      `search.args.filters` deepEqual `{ personIds:['per-1'] }`.
- [ ] `'5-star videos from 2024'` + `makeContractClient()` → resolved; resolver NOT called;
      `search.args.filters` deepEqual `{ takenAfter:'2024-01-01T00:00:00.000Z',
takenBefore:'2024-12-31T23:59:59.999Z', type:'VIDEO', rating:5 }`.
- [ ] `'my Sony photos of Alex'` + `makeContractClient({ resolvedFilters:{ personIds:['per-1'], make:'Sony' },
resolveResults:[{ kind:'person', query:'Alex', status:'matched', choices:[], message:'' },
{ kind:'cameraMake', query:'Sony', status:'matched', choices:[], message:'' }] })`
      → resolved; the `resolveAssetSearchFilters` call args deepEqual `{ people:['Alex'], cameraMakes:['Sony'] }`;
      `search.args.filters` deepEqual `{ personIds:['per-1'], make:'Sony' }`.
- [ ] `'tagged Travel and favorited'` + `makeContractClient({ resolvedFilters:{ tagIds:['tag-1'] },
resolveResults:[{ kind:'tag', query:'Travel', status:'matched', choices:[], message:'' }] })`
      → resolved; `resolveAssetSearchFilters` args deepEqual `{ tags:['Travel'] }`;
      `search.args.filters` deepEqual `{ isFavorite:true, tagIds:['tag-1'] }`.
- [ ] over-resolution guard: `'photos of Alex underwater'` + `makeContractClient()`
      → `status === 'handoff'`; NEITHER `resolveAssetSearchFilters` NOR `searchAssets`
      called (unconsumed residual `underwater` fails the clean gate BEFORE any tool call).
- [ ] subjective-beats-entity: `'the best Berlin photos'` + `makeContractClient()`
      → `status === 'handoff'`; no `searchAssets` call.
- [ ] place-vs-person matched: `'photos of Paris'` + `makeContractClient({ resolvedFilters:{ personIds:['per-9'] },
resolveResults:[{ kind:'person', query:'Paris', status:'matched', choices:[], message:'' }] })`
      → resolved; `search.args.filters` deepEqual `{ personIds:['per-9'] }`.
- [ ] place-vs-person not_found (safe branch): `'photos of Paris'` + `makeContractClient({
resolveResults:[{ kind:'person', query:'Paris', status:'not_found', choices:[], message:'' }] })`
      → `status === 'needs_input'`; no `searchAssets` call (never silently searches city).
- [ ] regression: `'my newest 20 photos'` → resolved; `search.args` deepEqual
      `{ mode:'metadata', order:'desc', limit:20, detail:'handle' }` (NO `filters` key).
- [ ] `parseEntitySource` units for the new favorites spelling:
      `parseEntitySource('photos I favorited')` → `{ directFilters:{ isFavorite:true } }`;
      `parseEntitySource('tagged Travel and favorited')` → deepEqual
      `{ tags:['Travel'], directFilters:{ isFavorite:true } }`.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → RED: the `favorited` cases fail
      (current regex misses `favorited`); the rest already pass (guards in place).

### Task 2: implement (green)

- [ ] Apply the two `favou?rite[ds]?` regex edits.
- [ ] Run `mise exec -- pnpm --dir agent-runner test` → all green.

## Edge cases (covered above)

- recency bounds an entity search (limit applies on top of entity filters).
- multi-kind merge: `people` + `cameraMakes` resolve together → `{ personIds, make }`;
  tag + direct favorite → `{ tagIds, isFavorite }` (disjoint, nothing dropped).
- `5-star videos from 2024` combines direct rating + type + date with NO resolver call.
- unconsumed residual (`underwater`) → handoff before any tool call (no over-resolve).
- subjective qualifier beats a present entity → handoff.
- place-vs-person: matched → `personIds`; not_found → `needs_input` (documented
  deviation: no silent city fallback).
- recency-only source still sends NO `filters` key (regression guard).

## Acceptance

- The full entity × recency × date × type × direct matrix resolves to the exact merged
  `searchAssets.filters`; unconsumable residual and subjective sources hand off; not-found
  entities ask for input. `favorited`/`favourited` is recognized as `isFavorite`.
- `mise exec -- pnpm --dir agent-runner test` green.

## Commit

- One commit: `test(agent): lock entity × recency/date/type/direct matrix + over-resolution guards (phase 2 slice 4)`.
