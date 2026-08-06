# Pi Agent Strict/Hybrid Foundation Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a single declarative workflow registry/manifest as the source of truth for which strict/hybrid workflows exist, how to recognize them, what tools they require, and where they sit in the flow-ownership matrix. Make the capability-matrix doc derive from it instead of being validated by prose `toContain` checks.

**Architecture:** Add `agent-runner/src/strict-workflows/manifest.mjs` exporting a frozen plain-data array of `WorkflowManifestEntry` objects (no functions). A tiny generator writes a committed JSON mirror (`agent-runner/src/strict-workflows/manifest.generated.json`) that server tooling reads without a cross-package import. A new server bin `sync-agent-capabilities.ts` renders the Flow Ownership Matrix rows of the capability-matrix doc from the manifest, mirroring the existing `sync-agent-mcp-docs.ts` pattern. The capability-matrix spec is rewritten to assert against the typed manifest and to generate-and-diff the doc. This slice adds no routing, execution, or runtime behavior.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`, `pnpm --dir agent-runner test`; server TypeScript, Vitest, `pnpm --dir server test`.

---

## Spec Scope

Implements Slice 1 (Manifest + registry) from `docs/superpowers/specs/2026-05-29-pi-agent-strict-hybrid-foundation-design.md` (Pillar P1, E5).

Covered requirements:

- A manifest entry exists for `create_recent_trip_album` with correct `flow`, `requiredReadTools`, and `planTool`.
- A registry accessor resolves entries by `kind` and lists all kinds.
- Every manifest `requiredReadTools`/`planTool` value matches a registered `AgentToolName` in `agent-mcp-tool-registry.service.ts`.
- The Flow Ownership Matrix in the capability-matrix doc is generated from the manifest.
- `agent-capability-matrix.spec.ts` asserts against the typed manifest and fails on doc/manifest drift (generate-and-diff), replacing the brittle `toContain` flow-ownership assertions.

Not included in this slice:

- Any `StrictWorkflow` execution interface, `WorkflowOutcome`, or dispatcher (Slice 2/3).
- Any classifier prompt construction (Slice 4).
- Any change to runtime routing or `strict-workflows.mjs` behavior.

## File Structure

- Create `agent-runner/src/strict-workflows/manifest.mjs`
  - Exports `WORKFLOW_MANIFEST` (frozen array) and `getWorkflowManifestEntry(kind)`, `listWorkflowKinds()`.
- Create `agent-runner/src/strict-workflows/manifest.test.mjs`
  - Validates manifest shape, uniqueness of `kind`, and the `create_recent_trip_album` entry.
- Create `agent-runner/src/strict-workflows/manifest.generated.json`
  - Committed JSON mirror of `WORKFLOW_MANIFEST`.
- Create `agent-runner/src/bin/sync-strict-workflow-manifest.mjs`
  - Writes the JSON mirror from `manifest.mjs`; fails CI if out of sync.
- Create `server/src/bin/sync-agent-capabilities.ts`
  - Renders the Flow Ownership Matrix section of the capability-matrix doc from the JSON mirror.
- Modify `server/src/services/agent-capability-matrix.spec.ts`
  - Replace flow-ownership `toContain` checks with manifest-driven assertions + generate-and-diff.

## Task 1: Workflow Manifest + Registry Accessors

**Files:**

- Create: `agent-runner/src/strict-workflows/manifest.mjs`
- Create: `agent-runner/src/strict-workflows/manifest.test.mjs`

- [ ] **Step 1: Write the failing manifest tests**

Create `agent-runner/src/strict-workflows/manifest.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WORKFLOW_MANIFEST, getWorkflowManifestEntry, listWorkflowKinds } from './manifest.mjs';

describe('strict/hybrid workflow manifest', () => {
  it('exposes unique kinds', () => {
    const kinds = listWorkflowKinds();
    assert.deepEqual(kinds, [...new Set(kinds)]);
    assert.ok(kinds.includes('create_recent_trip_album'));
  });

  it('describes create_recent_trip_album as a strict workflow with its tools', () => {
    const entry = getWorkflowManifestEntry('create_recent_trip_album');
    assert.equal(entry.flow, 'strict');
    assert.deepEqual(entry.requiredReadTools, ['findTripCandidates']);
    assert.equal(entry.planTool, 'proposeAlbumFromSelection');
    assert.equal(entry.supportsContinuation, true);
    assert.ok(entry.positiveExamples.includes('Create an album for my recent trip to USA'));
    assert.ok(entry.negativeExamples.length > 0);
    assert.equal(entry.matrixRow.capability, 'Create recent trip album');
  });

  it('requires plain-data entries with no functions', () => {
    const serialized = JSON.stringify(WORKFLOW_MANIFEST);
    assert.deepEqual(JSON.parse(serialized).length, WORKFLOW_MANIFEST.length);
    for (const entry of WORKFLOW_MANIFEST) {
      for (const value of Object.values(entry)) {
        assert.notEqual(typeof value, 'function');
      }
    }
  });

  it('returns undefined for unknown kinds', () => {
    assert.equal(getWorkflowManifestEntry('does_not_exist'), undefined);
  });
});
```

- [ ] **Step 2: Run the tests and verify red**

```bash
pnpm --dir agent-runner test
```

Expected: FAIL with `Cannot find module './manifest.mjs'`.

- [ ] **Step 3: Implement the manifest**

Create `agent-runner/src/strict-workflows/manifest.mjs`:

```js
export const WORKFLOW_MANIFEST = Object.freeze([
  Object.freeze({
    kind: 'create_recent_trip_album',
    flow: 'strict',
    title: 'Create recent trip album',
    classifierDescription:
      'User wants a new album built from a recent trip detected from photo date/location metadata.',
    positiveExamples: Object.freeze([
      'Create an album for my recent trip to USA',
      'Make an album for my recent trip',
      'Put my Japan trip from last week into an album',
    ]),
    negativeExamples: Object.freeze([
      'Add my recent trip photos to Family',
      'How many photos are in my recent trip album?',
      'Pick the best photos from my recent trip',
    ]),
    slots: Object.freeze({
      albumName: { type: 'string', required: false, description: 'Explicit album name if the user gave one.' },
      placeHint: { type: 'string', required: false, description: 'Place text to bias trip detection.' },
    }),
    requiredReadTools: Object.freeze(['findTripCandidates']),
    planTool: 'proposeAlbumFromSelection',
    supportsContinuation: true,
    matrixRow: Object.freeze({
      capability: 'Create recent trip album',
      tier: 'Solid now',
      workflowOrBoundary:
        '`create_recent_trip_album` handles recent-trip detection, candidate choice, and album plan creation from the handle.',
    }),
  }),
]);

const byKind = new Map(WORKFLOW_MANIFEST.map((entry) => [entry.kind, entry]));

export const getWorkflowManifestEntry = (kind) => byKind.get(kind);
export const listWorkflowKinds = () => WORKFLOW_MANIFEST.map((entry) => entry.kind);
```

- [ ] **Step 4: Run the tests and verify green**

```bash
pnpm --dir agent-runner test
```

Expected: PASS.

## Task 2: JSON Mirror + Sync Script

**Files:**

- Create: `agent-runner/src/strict-workflows/manifest.generated.json`
- Create: `agent-runner/src/bin/sync-strict-workflow-manifest.mjs`

- [ ] **Step 1: Add the sync script**

`sync-strict-workflow-manifest.mjs` imports `WORKFLOW_MANIFEST`, writes pretty JSON to `manifest.generated.json`, and supports a `--check` mode that exits non-zero if the file would change.

```js
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WORKFLOW_MANIFEST } from '../strict-workflows/manifest.mjs';

const target = fileURLToPath(new URL('../strict-workflows/manifest.generated.json', import.meta.url));
const next = `${JSON.stringify(WORKFLOW_MANIFEST, null, 2)}\n`;

if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== next) {
    console.error('manifest.generated.json is out of date. Run sync-strict-workflow-manifest.');
    process.exit(1);
  }
} else {
  writeFileSync(target, next, 'utf8');
}
```

- [ ] **Step 2: Generate the mirror and add a test asserting parity**

Run the script, then add a test in `manifest.test.mjs` that parses `manifest.generated.json` and deep-equals `WORKFLOW_MANIFEST`. Wire `--check` into the agent-runner test/CI script.

```bash
node agent-runner/src/bin/sync-strict-workflow-manifest.mjs
pnpm --dir agent-runner test
```

Expected: PASS; the generated JSON matches the source.

## Task 3: Capability Matrix From Manifest

**Files:**

- Create: `server/src/bin/sync-agent-capabilities.ts`
- Modify: `server/src/services/agent-capability-matrix.spec.ts`

Design note: the `## Flow Ownership Matrix` table has ~22 rows but only the rows
with an _implemented_ workflow have manifest entries; the rest are
flow-ownership designations with no workflow yet. HTML-comment markers between
rows of a single markdown table break the table (and prettier reflows it), so we
do **not** rewrite rows in place. Instead the generator manages a separate
`### Implemented strict/hybrid workflows` block (its own table) placed under the
Flow Ownership Matrix, and the spec test cross-checks the hand-authored rows
against the manifest.

- [ ] **Step 1: Render an Implemented-Workflows block from the manifest**

`sync-agent-capabilities.ts` reads `manifest.generated.json` and renders a
`### Implemented strict/hybrid workflows` table (columns: `Kind | Flow | Required read tools | Plan tool`),
writing it between marker comments (`<!-- generated:workflows:start -->` /
`<!-- generated:workflows:end -->`) in
`docs/superpowers/specs/2026-05-19-pi-agent-capability-matrix.md`. The markers sit
between block elements (not inside a table), so they are prettier-safe. Mirror
`sync-agent-mcp-docs.ts` structure and add a `--check` flag that exits non-zero
on drift.

- [ ] **Step 2: Add the managed block + markers to the capability-matrix doc**

Insert the empty `<!-- generated:workflows:start -->` / `:end` marker pair under
the Flow Ownership Matrix, then run the generator to fill it. The Flow Ownership
Matrix table itself stays hand-authored and untouched.

- [ ] **Step 3: Rewrite the spec to assert against the manifest**

In `agent-capability-matrix.spec.ts`, replace the flow-ownership `toContain`
block with manifest-driven assertions: (a) the generated block is in sync, and
(b) every manifest entry has a Flow Ownership Matrix row whose flow agrees.

```ts
import manifest from '../../../agent-runner/src/strict-workflows/manifest.generated.json';
import { renderImplementedWorkflowsBlock } from '../bin/sync-agent-capabilities'; // shared renderer

it('keeps the generated implemented-workflows block in sync with the manifest', () => {
  const markdown = readMatrix();
  const managed = markdown.slice(
    markdown.indexOf('<!-- generated:workflows:start -->'),
    markdown.indexOf('<!-- generated:workflows:end -->'),
  );
  expect(managed).toContain(renderImplementedWorkflowsBlock(manifest).trim());
});

it('agrees with the hand-authored Flow Ownership Matrix for every workflow', () => {
  const markdown = readMatrix();
  const flowSection = markdown.slice(markdown.indexOf('## Flow Ownership Matrix'));
  const flowLabel = { strict: 'Strict', hybrid: 'Hybrid' };
  for (const entry of manifest) {
    const row = flowSection.split('\n').find((line) => line.includes(entry.matrixRow.capability));
    expect(row, entry.kind).toBeDefined();
    expect(row).toContain(flowLabel[entry.flow]);
  }
});
```

Keep the existing `## Core Capability Matrix` / `## Needs New MCP Tool` prose assertions (those rows are not manifest-driven yet).

- [ ] **Step 4: Add a contract test that manifest tools exist**

Add a server test asserting every `requiredReadTools`/`planTool` in the manifest resolves to a registered `AgentToolName` in `agent-mcp-tool-registry.service.ts`.

- [ ] **Step 5: Run server tests and verify green**

```bash
pnpm --dir server test -- --run src/services/agent-capability-matrix.spec.ts
```

Expected: PASS. Doc and manifest are in sync; tool names validated.

- [ ] **Step 6: Drift check + commit**

```bash
git diff -- agent-runner/src/strict-workflows server/src/bin/sync-agent-capabilities.ts server/src/services/agent-capability-matrix.spec.ts docs/superpowers
```

Expected: no `StrictWorkflow` interface, dispatcher, or classifier code; only manifest, sync tooling, and doc/spec changes.

```bash
git add agent-runner/src/strict-workflows agent-runner/src/bin/sync-strict-workflow-manifest.mjs server/src/bin/sync-agent-capabilities.ts server/src/services/agent-capability-matrix.spec.ts docs/superpowers
git commit -m "feat: add strict/hybrid workflow manifest and generated capability matrix"
```

## Plan Self-Review

- Spec coverage: P1 + E5 requirements map to manifest tests, generate-and-diff, and a tool-existence contract test.
- TDD order: manifest and sync tests are written and run red before implementation.
- Scope: no execution protocol, dispatcher, or classifier; manifest is plain data only.
- Single source of truth: runtime imports `manifest.mjs`; server/doc tooling reads the committed JSON mirror; `--check` prevents drift.
- Placeholder scan: no TODO/TBD placeholders.
