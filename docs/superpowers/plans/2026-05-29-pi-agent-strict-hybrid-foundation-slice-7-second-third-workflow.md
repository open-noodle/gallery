# Pi Agent Strict/Hybrid Foundation Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the foundation by adding two workflows with **no edits to the dispatcher, classifier, or runtime** — only a manifest entry and a `StrictWorkflow` implementation each. `rename_or_describe_album` validates the simplest strict path (no detection, no continuation). `add_photos_to_album` validates the first hybrid workflow (bounded read resolution + `handoff_open` on subjective sources).

**Architecture:** Each workflow is a new module under `agent-runner/src/strict-workflows/workflows/` implementing the protocol from Slice 2, registered via a manifest entry (Slice 1) and the registry (Slice 3). `rename_or_describe_album` resolves an album reference and proposes `album.updateDetails`, preserving unspecified fields. `add_photos_to_album` resolves the album, then resolves the source via the bounded read whitelist (`resolveAssetSearchFilters` + `searchAssets`) into a selection handle, then proposes a duplicate-safe `album.addAssets`; if the source is subjective ("the good ones"), `run` returns `handoff_open`. Both reuse existing MCP read/plan tools — no new server tools. The acceptance criterion is the diff: adding a workflow touches only manifest + workflow module + tests.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `pnpm --dir agent-runner test`; existing Gallery MCP tools (`listAlbums`, `readAlbum`, `resolveAssetSearchFilters`, `searchAssets`, `proposeAlbumOperations`/`album.updateDetails`, `album.addAssets`).

---

## Spec Scope

Implements Slice 7 (Second + third workflow) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (worked examples #2 and #3).

Covered requirements:

- `rename_or_describe_album` (strict): resolve album, propose `album.updateDetails`, preserve unspecified fields; added with only a manifest entry + workflow module.
- `add_photos_to_album` (hybrid): resolve album + resolve source via the bounded read whitelist into a selection handle, propose duplicate-safe `album.addAssets`; `handoff_open` on subjective source.
- Both route correctly through the existing classifier (regex fast-path + LLM) and dispatcher.
- Manifest entries render into the capability matrix via the Slice 1 generator.
- **No edits** to `dispatcher.mjs`, `classifier.mjs`, or the runtime files (enforced by the drift check).

Not included in this slice:

- `manage_space_members` (its own follow-up spec).
- Any new server MCP tool.
- Subjective/visual source resolution beyond returning `handoff_open`.

## File Structure

- Modify `agent-runner/src/strict-workflows/manifest.mjs` (+ regenerate JSON mirror)
  - Add `rename_or_describe_album` (strict) and `add_photos_to_album` (hybrid) entries with `requiredReadTools`/`planTool`, examples, and `matrixRow`.
- Create `agent-runner/src/strict-workflows/workflows/rename-or-describe-album.mjs` (+ test)
- Create `agent-runner/src/strict-workflows/workflows/add-photos-to-album.mjs` (+ test)
- Modify `agent-runner/src/strict-workflows/registry.mjs`
  - Register the two new workflow factories (data-only addition to the workflow list).
- Run `sync-strict-workflow-manifest` + `sync-agent-capabilities` to update the doc.

## Task 1: rename_or_describe_album (strict, simplest path)

**Files:**

- Modify: `manifest.mjs`; Create: `workflows/rename-or-describe-album.mjs`, `.test.mjs`

- [ ] **Step 1: Add the manifest entry**

```js
Object.freeze({
  kind: 'rename_or_describe_album',
  flow: 'strict',
  title: 'Rename or describe album',
  classifierDescription: 'User wants to rename an existing album and/or change its description, leaving its assets unchanged.',
  positiveExamples: Object.freeze([
    'Rename this album to Berlin Weekend',
    'Rename the Family album to Family 2026 and add a description',
    'Change the description on my Italy album',
  ]),
  negativeExamples: Object.freeze([
    'Add my newest photos to the Family album',
    'Delete the Family album',
    'Create an album for my recent trip',
  ]),
  slots: Object.freeze({
    albumRef: { type: 'string', required: true, description: 'How the user referred to the album.' },
    newName: { type: 'string', required: false, description: 'New album title, if renaming.' },
    description: { type: 'string', required: false, description: 'New description, if setting one.' },
  }),
  requiredReadTools: Object.freeze(['listAlbums']),
  planTool: 'proposeAlbumOperations',
  supportsContinuation: false,
  matrixRow: Object.freeze({
    capability: 'Rename or describe album',
    tier: 'Solid now',
    workflowOrBoundary: 'Direct album-detail update plan; preserve unspecified fields.',
  }),
}),
```

- [ ] **Step 2: Write the failing workflow tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { renameOrDescribeAlbumWorkflow } from './rename-or-describe-album.mjs';

const wf = renameOrDescribeAlbumWorkflow();

const fakeClient = ({ albums = [{ id: 'alb-1', albumName: 'Family' }], planResult } = {}) => {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'listAlbums') return { albums };
      if (name === 'proposeAlbumOperations') return planResult ?? { status: 'success', plan: { id: 'plan-1' } };
      throw new Error(`unexpected ${name}`);
    },
  };
};

describe('rename_or_describe_album StrictWorkflow', () => {
  it('matches and resolves the album, proposing an updateDetails plan that preserves unspecified fields', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots(
      { albumRef: 'Family', newName: 'Family 2026' },
      'Rename the Family album to Family 2026',
    );
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const planCall = client.calls.find((c) => c.name === 'proposeAlbumOperations');
    const op = planCall.args.operations[0];
    assert.equal(op.type, 'album.updateDetails');
    assert.equal(op.payload.albumName, 'Family 2026');
    assert.equal('description' in op.payload, false); // unspecified field not clobbered
  });

  it('asks for clarification on an ambiguous album reference', async () => {
    const client = fakeClient({
      albums: [
        { id: 'a', albumName: 'Trip' },
        { id: 'b', albumName: 'Trip' },
      ],
    });
    const outcome = await wf.run({
      client,
      slots: wf.parseSlots({ albumRef: 'Trip', newName: 'Trip 2026' }, 'rename Trip'),
    });
    assert.equal(outcome.status, 'needs_input');
  });

  it('supports a description-only change without renaming the album', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots({ albumRef: 'Family', description: 'Our 2026 memories' }, 'describe the Family album');
    const outcome = await wf.run({ client, slots });
    assert.equal(outcome.status, 'planned');
    const op = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations[0];
    assert.equal(op.payload.description, 'Our 2026 memories');
    assert.equal('albumName' in op.payload, false); // rename not implied; name preserved
  });

  it('updates both name and description when both slots are present', async () => {
    const client = fakeClient();
    const slots = wf.parseSlots(
      { albumRef: 'Family', newName: 'Family 2026', description: 'Our 2026 memories' },
      'rename the Family album to Family 2026 and add a description',
    );
    const op =
      (await wf.run({ client, slots }),
      client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations[0]);
    assert.equal(op.payload.albumName, 'Family 2026');
    assert.equal(op.payload.description, 'Our 2026 memories');
  });

  it('rejects slots with neither a new name nor a description', () => {
    assert.equal(wf.parseSlots({ albumRef: 'Family' }, 'do something to Family'), null);
  });

  it('fails without claiming success when planning returns no plan id', async () => {
    const client = fakeClient({ planResult: { status: 'success' } });
    const outcome = await wf.run({
      client,
      slots: wf.parseSlots({ albumRef: 'Family', newName: 'X' }, 'rename Family'),
    });
    assert.equal(outcome.status, 'failed');
    assert.doesNotMatch(outcome.text, /created|proposed|ready/i);
  });
});
```

- [ ] **Step 3: Run red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL — workflow module missing.

- [ ] **Step 4: Implement the workflow**

`match`/`parseSlots` recognize rename/describe intent and extract `albumRef`/`newName`/`description`. `run`:

1. `listAlbums`; resolve `albumRef` to a unique album (case-insensitive); zero matches → `needsInput` asking which album, multiple → `needsInput` with candidate names.
2. Build an `album.updateDetails` op including only the fields the user set (omit unspecified ones to preserve them).
3. `proposeAlbumOperations`; reuse the shared plan-id gate + redaction from `strict-workflows.mjs` to return `planned`/`failed` with a `successSummary`.

- [ ] **Step 5: Register + run green**

Add the factory to `registry.mjs`, regenerate the manifest JSON, run:

```bash
node agent-runner/src/bin/sync-strict-workflow-manifest.mjs
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 2: add_photos_to_album (hybrid, bounded resolution + handoff)

**Files:**

- Modify: `manifest.mjs`; Create: `workflows/add-photos-to-album.mjs`, `.test.mjs`

- [ ] **Step 1: Add the manifest entry**

```js
Object.freeze({
  kind: 'add_photos_to_album',
  flow: 'hybrid',
  title: 'Add photos to existing album',
  classifierDescription: 'User wants to add a metadata-describable set of photos to an existing album.',
  positiveExamples: Object.freeze([
    'Add my newest 20 photos to Family',
    'Add my Berlin photos from last weekend to the Trips album',
  ]),
  negativeExamples: Object.freeze([
    'Add the good ones to Family', // subjective → handoff_open
    'Create a new album from my Berlin photos',
  ]),
  slots: Object.freeze({
    albumRef: { type: 'string', required: true, description: 'Target album the user named.' },
    sourceDescription: { type: 'string', required: true, description: 'Metadata description of the photos to add.' },
  }),
  requiredReadTools: Object.freeze(['listAlbums', 'resolveAssetSearchFilters', 'searchAssets']),
  planTool: 'proposeAlbumOperations',
  supportsContinuation: false,
  matrixRow: Object.freeze({
    capability: 'Add photos to existing album',
    tier: 'Solid now',
    workflowOrBoundary: 'Pi resolves the source; Gallery owns album lookup, duplicate-safe add, and plan creation.',
  }),
}),
```

- [ ] **Step 2: Write the failing workflow tests**

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addPhotosToAlbumWorkflow } from './add-photos-to-album.mjs';

const wf = addPhotosToAlbumWorkflow();

// add_photos needs its own fake client (separate test file): it exercises the
// full bounded read chain, not just listAlbums + proposeAlbumOperations.
const fakeClient = ({ albums = [{ id: 'alb-1', albumName: 'Family' }], handleAssetCount = 20, planResult } = {}) => {
  const calls = [];
  return {
    calls,
    async call(name, args) {
      calls.push({ name, args });
      if (name === 'listAlbums') return { albums };
      if (name === 'resolveAssetSearchFilters') return { filters: { order: 'desc', limit: 20 } };
      if (name === 'searchAssets') return { selectionHandle: { id: 'handle-1', assetCount: handleAssetCount } };
      if (name === 'proposeAlbumOperations') return planResult ?? { status: 'success', plan: { id: 'plan-1' } };
      throw new Error(`unexpected ${name}`);
    },
  };
};

describe('add_photos_to_album HybridWorkflow', () => {
  it('resolves album + source into a selection handle and proposes a duplicate-safe add', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'my newest 20 photos' } });
    assert.equal(outcome.status, 'planned');
    const ops = client.calls.find((c) => c.name === 'proposeAlbumOperations').args.operations;
    assert.equal(ops[0].type, 'album.addAssets');
    assert.equal(ops[0].assetSource.kind, 'selectionHandle');
    assert.equal(ops[0].assetSource.selectionHandleId, 'handle-1');
    assert.equal(JSON.stringify(client.calls).includes('assetIds'), false); // no raw ids to the model
  });

  it('hands off to open orchestration for a subjective source', async () => {
    const client = fakeClient();
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'the good ones' } });
    assert.equal(outcome.status, 'handoff_open');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    ); // no plan on handoff
  });

  it('asks for input when the album cannot be resolved', async () => {
    const outcome = await wf.run({
      client: fakeClient({ albums: [] }),
      slots: { albumRef: 'Nope', sourceDescription: 'newest 10' },
    });
    assert.equal(outcome.status, 'needs_input');
  });

  it('asks for input when the resolved source has zero assets instead of planning an empty add', async () => {
    const client = fakeClient({ handleAssetCount: 0 });
    const outcome = await wf.run({ client, slots: { albumRef: 'Family', sourceDescription: 'photos from 1990' } });
    assert.equal(outcome.status, 'needs_input');
    assert.equal(
      client.calls.some((c) => c.name === 'proposeAlbumOperations'),
      false,
    ); // never plans an empty source
  });
});
```

- [ ] **Step 3: Run red, then implement**

`run`:

1. Resolve album via `listAlbums` (ambiguous/none → `needsInput`).
2. If `sourceDescription` is subjective (`best|good|nice|favorite|highlights|blurry|bad` heuristic, or non-metadata) → `handoffOpen({ reason })`.
3. Resolve the source: `resolveAssetSearchFilters` then `searchAssets` to obtain a `selectionHandle` (zero assets → `needsInput`).
4. Propose `album.addAssets` with `assetSource: { kind: 'selectionHandle', selectionHandleId }` (duplicate-safe semantics owned by the server plan); reuse the plan-id gate.

The bounded read whitelist (`resolveAssetSearchFilters`, `searchAssets`, `listAlbums`) is declared in the manifest; the workflow must not call any tool outside it.

- [ ] **Step 4: Register + run green**

```bash
node agent-runner/src/bin/sync-strict-workflow-manifest.mjs
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 3: Capability Matrix + Acceptance Diff

**Files:**

- Run generators; Modify capability matrix doc (generated block)

- [ ] **Step 1: Regenerate the capability matrix**

```bash
node server/src/bin/sync-agent-capabilities.ts  # or the package script wrapper
pnpm --dir server test -- --run src/services/agent-capability-matrix.spec.ts
```

Expected: the generated `### Implemented strict/hybrid workflows` block (Slice 1) now lists `rename_or_describe_album` (Strict) and `add_photos_to_album` (Hybrid), and the spec's cross-check confirms each manifest entry's flow agrees with its hand-authored Flow Ownership Matrix row ("Rename or describe album" / "Add photos to existing album", both already present); spec passes (generate-and-diff in sync).

- [ ] **Step 2: Acceptance — prove the dispatcher/runtime were untouched**

```bash
git diff --stat -- agent-runner/src/strict-workflows/dispatcher.mjs agent-runner/src/strict-workflows/classifier.mjs agent-runner/src/pi-runtime.mjs agent-runner/src/e2e-runtime.mjs
```

Expected: **empty** — the two workflows were added with only manifest + workflow modules + registry registration. This is the foundation's headline acceptance criterion.

- [ ] **Step 3: Commit**

```bash
git add agent-runner/src/strict-workflows docs/superpowers
git commit -m "feat: add rename-album (strict) and add-photos (hybrid) workflows on the foundation"
```

## Plan Self-Review

- Spec coverage: both workflows implemented and tested; hybrid `handoff_open` and bounded read whitelist covered; capability matrix regenerated.
- Edge coverage: rename (name-only field preservation, description-only, both fields, empty-slot reject, no-plan-id failure, ambiguous album) and add-photos (planned, subjective handoff with no plan, unresolved album, zero-asset source with no plan) each have a test, with a self-contained fake client per file.
- TDD order: workflow tests run red before implementation.
- Foundation proof: the Step 2 acceptance diff enforces "no dispatcher/runtime edits to add a workflow."
- Safety: selection-handle sources only (no raw ids to the model); plan-id gate reused; subjective and zero-asset sources never produce a plan.
- Placeholder scan: no TODO/TBD placeholders.
