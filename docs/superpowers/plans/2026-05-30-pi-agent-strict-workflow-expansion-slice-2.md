# Workflow Expansion — Slice 2: Extract the shared asset source-resolver

> Implement test-first. Checkbox steps.

**Goal:** Move recency source resolution out of `add_photos_to_album` into a shared
`asset-source-resolver.mjs` (`resolveAssetSource`), refactor `add_photos` to use
it, with **zero observable behavior change**.

**Spec scope:** Slice 2 of the workflow-expansion design.

## Resolver contract

`resolveAssetSource({ client, sourceDescription, signal })` →

- `{ status: 'resolved', selectionHandleId, assetCount }` — recency source resolved
  to a metadata-search selection handle.
- `{ status: 'empty' }` — resolved but zero assets.
- `{ status: 'handoff', reason }` — subjective, or not deterministically resolvable
  (only recency is supported this slice; dates/type arrive in Slices 3-4).

It owns: the subjective check, the recency parse, and the
`searchAssets({ mode:'metadata', order:'desc', limit:N, detail:'handle' })` call.
It does **not** catch tool errors — a thrown tool error propagates to the caller
(so `add_photos` keeps its `failed` mapping).

## Files

- Create `agent-runner/src/strict-workflows/asset-source-resolver.mjs`
  - Export `resolveAssetSource`. Move `SUBJECTIVE_PATTERN`, `RECENCY_PATTERN`,
    `COUNT_PATTERN`, `MAX_RECENCY_LIMIT`, `parseRecencyLimit` here (also export the
    pattern/parse helpers the add router still needs).
- Create `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`
- Edit `agent-runner/src/strict-workflows/workflows/add-photos-to-album.mjs`
  - `run()` step 2-4 become a single `resolveAssetSource` call; map
    `handoff`→`handoffOpen`, `empty`→`needsInput`, `resolved`→propose. Keep the
    `try/catch`→`failed` around the resolver call. Album resolution (step 1) and
    propose (step 5) unchanged. Import `SUBJECTIVE_PATTERN`/`parseRecencyLimit` from
    the resolver if the matcher still needs them (it uses `declinesAddFastPath`).

## TDD

### Task 1: resolver (red → green)

- [ ] `asset-source-resolver.test.mjs` (red — module missing). Cases, using
      `makeContractClient` from Slice 1:
  - "my newest 20 photos" → `resolved`, and the recorded `searchAssets` call is
    `{ mode:'metadata', order:'desc', limit:20, detail:'handle' }` with **no
    `query`**.
  - "the good ones" → `handoff` (subjective).
  - "Berlin photos from last weekend" → `handoff` (not recency yet).
  - "newest photos" (no count) → `handoff`.
  - recency with `handleAssetCount: 0` → `empty`.
  - a tool error (client whose searchAssets throws) **propagates** (assert.rejects).
- [ ] Implement `asset-source-resolver.mjs`. Green.

### Task 2: refactor add_photos (stays green)

- [ ] Replace `add_photos` run() steps 2-4 with the resolver; keep `failed`
      try/catch. Remove the now-moved helpers from `add_photos` (or re-import).
- [ ] `pnpm --dir agent-runner test` — full suite green; `add_photos` assertions
      unchanged.

## Edge cases (in tests)

- Subjective → handoff (never a search).
- No-count recency → handoff.
- Recency → metadata search, no `query`, correct order/limit.
- Zero assets → empty (→ add maps to needs_input).
- Tool error propagates (→ add maps to failed).

## Acceptance

- `resolveAssetSource` exported and unit-tested; `add_photos` behavior unchanged
  (same statuses for the same inputs); full suite green.

## Commit

`refactor: extract shared asset source-resolver from add_photos (no behavior change)`
