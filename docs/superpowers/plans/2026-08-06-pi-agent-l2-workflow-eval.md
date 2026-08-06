# L2 Workflow Eval Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the L2 rung of the Pi agent eval harness — score workflow _execution_ (tool-call sequence, plan shape, outcome arm) against a seeded fake MCP client, with no database and no Gallery server.

**Architecture:** `createWorkflowDispatcher` already takes every dependency as an injected parameter. L2 supplies a fake MCP client via `buildClient`, a fixed clock via `now`, and collectors via `observe`/`emit`, then exposes the same driver interface (`classify` / `converse` / `polishCopy`) that `score.mjs` already calls — so `run.mjs` needs no special-casing beyond layer selection.

**Tech Stack:** Node 24.15.0 ESM (`.mjs`), `node:test` + `node:assert/strict`, no new dependencies.

**Design spec:** `docs/superpowers/specs/2026-08-06-pi-agent-l2-workflow-eval-design.md`

## Scope reconciliation with the spec — read this first

The design spec's Coverage table lists a seven-workflow slice and roughly 30 scenarios. **This plan
deliberately delivers less: the complete harness plus a three-workflow proving slice**
(`rename_or_describe_album`, `create_recent_trip_album`, `cleanup_duplicates`) and six scenarios.

That is not a shortcut, it is sequencing. Every tool response shape in the "Verified contracts"
table below was read out of the codebase before being written into this plan. The remaining four
workflows (`delete_album`, `manage_album_access`, `add_photos_to_album`, `archive_assets`) need
dataset entries for assets and space membership whose contracts have **not** been verified the same
way, and writing unverified shapes into a plan produces code that looks authoritative and is wrong.

Adding each remaining workflow is then mechanical and independently reviewable: seed its dataset
entries, add any missing handler, add scenarios. Do that as a follow-up plan once this harness is
proven green — Task 6 Step 3 is the step that proves it.

## Global Constraints

- All work happens in the worktree `/Users/pierre/dev/gallery-worktrees/pi-agent-main`, package `agent-runner`.
- **Every test in this plan must pass with no model server running.** The suite must stay comparable to the existing agent-runner suite (1782 tests, ~1s).
- **TDD is mandatory.** Write the failing test, run it and watch it fail _for the reason you intended_, then write the minimum code to pass. A test that passes before the implementation exists is asserting nothing.
- **Every harness-enforced invariant needs a test proving it can fail.** This is test infrastructure: a no-op check makes scenarios pass, not fail, so it is invisible unless explicitly probed.
- ESM only, `import`/`export`, no CommonJS. Node's built-in test runner — never Vitest/Jest in this package.
- Do not modify `agent-runner/src/strict-workflows/test-helpers.mjs`; it is imported by `strict-workflows.test.mjs` and `workflows/create-recent-trip-album.test.mjs`.
- Prettier must pass on any touched Markdown (`npx prettier --check`); CI Docs Build is strict.
- Never add a Co-Authored-By or Generated-with trailer to a commit.

## Verified contracts (do not re-derive these)

These were read out of the codebase while writing this plan. Use them verbatim.

| Tool                        | Response shape the workflow reads                                                         | Source                              |
| --------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| `listAlbums`                | `{ albums: [{ id, albumName, ownerId }] }`                                                | `rename-or-describe-album.mjs:62`   |
| `readAlbum`                 | `{ album: {...} }` (or the album directly — code does `detail?.album ?? detail`)          | `change-album-member-role.mjs:132`  |
| `searchUsers`               | `{ users: [{ userId, ... }] }`                                                            | `change-album-member-role.mjs:192`  |
| `listDuplicateGroups`       | `{ groups: [...] }` — **empty groups ⇒ workflow returns `handoffOpen`**                   | `cleanup-duplicates.mjs:74-76`      |
| `resolveAssetSearchFilters` | `{ results: [{ query, status }], resolvedFilters: {...} }`                                | `asset-source-resolver.mjs:456-507` |
| `searchAssets`              | `{ selectionHandle: { id, assetCount } }` — missing id or `assetCount === 0` ⇒ unresolved | `asset-source-resolver.mjs:557-564` |
| `findTripCandidates`        | `{ status, recommendation: { action, candidateDedupeKey, reason }, candidates }`          | `test-helpers.mjs:36-45`            |
| plan tools (all)            | `{ status: 'success', plan: { id } }` — `planId` also accepted                            | `plan-gate.mjs:13-18`               |

Observability payloads emitted through `observe`:

- `{ kind: 'strict_router_decision', matched, workflowKind, via, confidence, latencyMs, fellBackToOpen }` (`dispatcher.mjs:227`)
- `{ kind: 'strict_workflow_outcome', workflowKind, status, planId, toolCalls, fellBackToOpen }` (`dispatcher.mjs:119`)

Two behaviours that are easy to get wrong:

1. **`gatePlanResult` treats any non-`success` status as `failed`** (`plan-gate.mjs:51`). Only `create_recent_trip_album` translates `approval-required` into the `approval_required` arm, and it does so at `strict-workflows.mjs:323` _before_ gating. For every other workflow in the slice, an `approval-required` plan result yields `failed`.
2. **`createWorkflowRegistry()` with no classifier falls back to `createRegexClassifier`** (`registry.mjs:203`) — a deterministic, model-free classifier. Driver tests use it for prompts the regex matches, and an explicit stub only when forcing a kind the regex would not pick.

## File structure

| File                                             | Responsibility                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `agent-runner/eval/fixtures/dataset.mjs`         | Frozen seed data. No logic.                                                                |
| `agent-runner/eval/fixtures/fake-mcp-client.mjs` | Answers every tool the L2 slice calls, from the dataset; records calls; injects overrides. |
| `agent-runner/eval/drivers/l2-workflow.mjs`      | Wires registry + dispatcher + fake client; builds the decision object.                     |
| `agent-runner/eval/scenarios/l2-workflow.mjs`    | Scenario data. No logic.                                                                   |
| `agent-runner/eval/score.mjs` (modify)           | Gains `toolSequence` / `planOps` / `noPlan` assertions.                                    |
| `agent-runner/eval/run.mjs` (modify)             | `--layer L2` selection.                                                                    |

---

### Task 1: Fixture dataset, fake MCP client, and the test glob

Nothing in `eval/` is currently covered by `npm test`, so the very first step is making eval tests runnable at all.

**Files:**

- Create: `agent-runner/eval/fixtures/dataset.mjs`
- Create: `agent-runner/eval/fixtures/fake-mcp-client.mjs`
- Test: `agent-runner/eval/fixtures/fake-mcp-client.test.mjs`
- Modify: `agent-runner/package.json` (test glob)

**Interfaces:**

- Produces: `DATASET`, `ALBUM_JAPAN_ID`, `ALBUM_SUMMER_A_ID`, `ALBUM_SUMMER_B_ID`, `TRIP_HANDLE_ID`, `PLAN_ID` from `dataset.mjs`; `createFakeMcpClient({ dataset, overrides }) -> { client, calls }` and `PLAN_TOOLS` from `fake-mcp-client.mjs`.

- [ ] **Step 1: Widen the test glob so `eval/` tests run at all**

In `agent-runner/package.json`, change the `test` script:

```json
"test": "node --test '{src,eval}/**/*.test.mjs'"
```

Brace expansion is verified working on the pinned Node 24.15.0.

- [ ] **Step 2: Write the failing test**

Create `agent-runner/eval/fixtures/fake-mcp-client.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ALBUM_JAPAN_ID, DATASET, PLAN_ID } from './dataset.mjs';
import { createFakeMcpClient } from './fake-mcp-client.mjs';

describe('fake MCP client', () => {
  it('answers listAlbums from the dataset', async () => {
    const { client } = createFakeMcpClient();
    const result = await client.call('listAlbums', {}, {});
    assert.equal(result.status, 'success');
    assert.deepEqual(
      result.albums.map((a) => a.albumName),
      ['Japan', 'Summer', 'Summer'],
    );
  });

  it('records every call with name, args and order', async () => {
    const { client, calls } = createFakeMcpClient();
    await client.call('listAlbums', {}, {});
    await client.call('readAlbum', { albumId: ALBUM_JAPAN_ID }, {});
    assert.deepEqual(
      calls.map((c) => c.name),
      ['listAlbums', 'readAlbum'],
    );
    assert.deepEqual(calls[1].args, { albumId: ALBUM_JAPAN_ID });
  });

  it('throws on an unknown tool rather than returning undefined', async () => {
    const { client } = createFakeMcpClient();
    await assert.rejects(() => client.call('noSuchTool', {}, {}), /unexpected tool "noSuchTool"/);
  });

  it('still records a call that throws', async () => {
    const { client, calls } = createFakeMcpClient();
    await client.call('noSuchTool', {}, {}).catch(() => {});
    assert.deepEqual(
      calls.map((c) => c.name),
      ['noSuchTool'],
    );
  });

  it('returns a plan id from every plan tool', async () => {
    const { client } = createFakeMcpClient();
    for (const tool of ['proposeAlbumOperations', 'proposeAlbumFromSelection', 'proposeAssetBatchFromSelection']) {
      const result = await client.call(tool, {}, {});
      assert.equal(result.plan.id, PLAN_ID, `${tool} should return the seeded plan id`);
    }
  });

  it('override: an Error instance is thrown', async () => {
    const boom = new Error('planning exploded');
    const { client } = createFakeMcpClient({ overrides: { proposeAlbumOperations: boom } });
    await assert.rejects(() => client.call('proposeAlbumOperations', {}, {}), /planning exploded/);
  });

  it('override: a plain object is returned verbatim', async () => {
    const { client } = createFakeMcpClient({
      overrides: { proposeAlbumFromSelection: { status: 'approval-required', toolCall: { id: 'tc-1' } } },
    });
    const result = await client.call('proposeAlbumFromSelection', {}, {});
    assert.equal(result.status, 'approval-required');
    assert.equal(result.toolCall.id, 'tc-1');
  });

  it('override: a function receives the args', async () => {
    const { client } = createFakeMcpClient({
      overrides: { listAlbums: (args) => ({ status: 'success', albums: [], echoed: args }) },
    });
    const result = await client.call('listAlbums', { q: 1 }, {});
    assert.deepEqual(result.albums, []);
    assert.deepEqual(result.echoed, { q: 1 });
  });

  it('override: an empty result set is expressible', async () => {
    const { client } = createFakeMcpClient({ overrides: { listDuplicateGroups: { status: 'success', groups: [] } } });
    const result = await client.call('listDuplicateGroups', {}, {});
    assert.deepEqual(result.groups, []);
  });

  it('does not share the calls array between clients', async () => {
    const a = createFakeMcpClient();
    const b = createFakeMcpClient();
    await a.client.call('listAlbums', {}, {});
    assert.equal(a.calls.length, 1);
    assert.equal(b.calls.length, 0);
  });

  it('seeds two albums with the same name so ambiguity is reachable', () => {
    const summer = DATASET.albums.filter((a) => a.albumName === 'Summer');
    assert.equal(summer.length, 2);
    assert.notEqual(summer[0].id, summer[1].id);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails for the right reason**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/fixtures/fake-mcp-client.test.mjs'
```

Expected: FAIL — `Cannot find module .../eval/fixtures/dataset.mjs`. That is the correct red: the module does not exist yet.

- [ ] **Step 4: Write `dataset.mjs`**

```js
// Frozen seed data for the L2 eval layer. Fixed UUIDs, no wall-clock, no
// randomness — every scenario must produce the same result on every run.

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';
export const ALBUM_JAPAN_ID = '00000000-0000-4000-8000-000000000101';
export const ALBUM_SUMMER_A_ID = '00000000-0000-4000-8000-000000000102';
export const ALBUM_SUMMER_B_ID = '00000000-0000-4000-8000-000000000103';
export const USER_ALEX_ID = '00000000-0000-4000-8000-000000000201';
export const TRIP_HANDLE_ID = '00000000-0000-4000-8000-000000000921';
export const SEARCH_HANDLE_ID = '00000000-0000-4000-8000-000000000922';
export const PLAN_ID = '00000000-0000-4000-8000-000000000923';

// Two albums deliberately share the name "Summer" so the ambiguity arm
// (needs_input on multiple matches) is reachable without an override.
export const DATASET = Object.freeze({
  albums: Object.freeze([
    Object.freeze({ id: ALBUM_JAPAN_ID, albumName: 'Japan', ownerId: OWNER_ID, assetCount: 120 }),
    Object.freeze({ id: ALBUM_SUMMER_A_ID, albumName: 'Summer', ownerId: OWNER_ID, assetCount: 40 }),
    Object.freeze({ id: ALBUM_SUMMER_B_ID, albumName: 'Summer', ownerId: OWNER_ID, assetCount: 12 }),
  ]),
  users: Object.freeze([Object.freeze({ userId: USER_ALEX_ID, name: 'Alex', email: 'alex@example.com' })]),
  duplicateGroups: Object.freeze([
    Object.freeze({ id: 'dup-1', assetCount: 3 }),
    Object.freeze({ id: 'dup-2', assetCount: 2 }),
  ]),
  tripCandidates: Object.freeze([
    Object.freeze({
      dedupeKey: 'trip:japan:tokyo:2026-05-03:2026-05-12',
      label: 'Tokyo, Japan',
      confidence: 'high',
      startDate: '2026-05-03',
      endDate: '2026-05-12',
      selectionHandle: Object.freeze({ id: TRIP_HANDLE_ID, assetCount: 84 }),
      places: Object.freeze([Object.freeze({ city: 'Tokyo', country: 'Japan' })]),
    }),
  ]),
  tripRecommendation: Object.freeze({
    action: 'use_top_candidate',
    candidateDedupeKey: 'trip:japan:tokyo:2026-05-03:2026-05-12',
    reason: 'The only readable trip candidate is high confidence.',
  }),
  searchSelectionHandle: Object.freeze({ id: SEARCH_HANDLE_ID, assetCount: 25 }),
  planId: PLAN_ID,
});
```

- [ ] **Step 5: Write `fake-mcp-client.mjs`**

```js
// Seeded, in-memory stand-in for the Gallery MCP gateway.
//
// Injected into the dispatcher via `buildClient`, so workflows run their real
// `run()` against it with no DB and no Gallery server. Every call is recorded so
// the driver can assert the exact tool sequence a workflow issued.
import { DATASET } from './dataset.mjs';

// Every tool that creates a reviewable plan. The driver's no-raw-asset-IDs
// invariant only inspects these.
export const PLAN_TOOLS = Object.freeze(
  new Set([
    'proposeAlbumOperations',
    'proposeAlbumFromSelection',
    'proposeAssetBatchFromSelection',
    'proposeAddAssetsToSpaceFromSearch',
    'proposeSpaceFromSearch',
  ]),
);

const planOk = (dataset) => ({ status: 'success', plan: { id: dataset.planId } });

const HANDLERS = {
  listAlbums: (dataset) => ({ status: 'success', albums: [...dataset.albums] }),
  readAlbum: (dataset, args) => ({
    status: 'success',
    album: dataset.albums.find((album) => album.id === args?.albumId) ?? null,
  }),
  searchUsers: (dataset) => ({ status: 'success', users: [...dataset.users] }),
  listDuplicateGroups: (dataset) => ({ status: 'success', groups: [...dataset.duplicateGroups] }),
  resolveAssetSearchFilters: () => ({ status: 'success', results: [], resolvedFilters: {} }),
  searchAssets: (dataset) => ({ status: 'success', selectionHandle: { ...dataset.searchSelectionHandle } }),
  findTripCandidates: (dataset) => ({
    status: 'success',
    recommendation: { ...dataset.tripRecommendation },
    candidates: [...dataset.tripCandidates],
  }),
  proposeAlbumOperations: planOk,
  proposeAlbumFromSelection: planOk,
  proposeAssetBatchFromSelection: planOk,
};

/**
 * @param {object} [options]
 * @param {object} [options.dataset] seed data (defaults to DATASET)
 * @param {Record<string, unknown>} [options.overrides] per-tool override. An
 *   Error instance is thrown; a function is called with the args; anything else
 *   is returned verbatim.
 * @returns {{ client: { call: Function }, calls: Array<{name: string, args: unknown, options: unknown}> }}
 */
export const createFakeMcpClient = ({ dataset = DATASET, overrides = {} } = {}) => {
  const calls = [];
  const client = {
    async call(name, args, options) {
      // Record BEFORE dispatching so a throwing tool still appears in the
      // sequence — otherwise a failure scenario would show a misleading history.
      calls.push({ name, args, options });

      if (Object.hasOwn(overrides, name)) {
        const override = overrides[name];
        if (override instanceof Error) {
          throw override;
        }
        return typeof override === 'function' ? override(args) : override;
      }

      const handler = HANDLERS[name];
      if (!handler) {
        throw new Error(`fake MCP client: unexpected tool "${name}"`);
      }
      return handler(dataset, args);
    },
  };
  return { client, calls };
};
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/fixtures/fake-mcp-client.test.mjs'
```

Expected: PASS, 11 tests.

- [ ] **Step 7: Confirm the widened glob did not break the existing suite**

```bash
pnpm --dir /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner test 2>&1 | tail -12
```

Expected: `pass 1793` (1782 existing + 11 new), `fail 0`.

- [ ] **Step 8: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/fixtures agent-runner/package.json
git commit -m "test(agent-runner): seeded fake MCP client for the L2 eval layer

Answers every tool the L2 slice calls from a frozen in-memory dataset and
records every call so the driver can assert exact tool sequences. Unknown tools
throw rather than returning undefined, so a workflow reaching for something
unseeded fails loudly instead of passing silently.

Widens the test glob to '{src,eval}/**/*.test.mjs' — eval/ was not under test
at all."
```

---

### Task 2: `score.mjs` expect keys

**Files:**

- Modify: `agent-runner/eval/score.mjs` (`classificationPass`, currently lines 20-38)
- Test: `agent-runner/eval/score.test.mjs`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `classificationPass` honouring `expect.toolSequence` (exact ordered array), `expect.planOps` (subset by `type`), `expect.noPlan` (boolean). `classificationPass` is exported for testing.

- [ ] **Step 1: Write the failing test**

Create `agent-runner/eval/score.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { classificationPass } from './score.mjs';

const base = { kind: 'rename_or_describe_album', parsedSlots: { albumRef: 'Japan' } };

describe('classificationPass — toolSequence', () => {
  it('passes on an exact ordered match', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      true,
    );
  });

  it('fails when the order differs', () => {
    const decision = { ...base, toolSequence: ['proposeAlbumOperations', 'listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a redundant extra call (length mismatch)', () => {
    const decision = { ...base, toolSequence: ['listAlbums', 'searchAssets', 'proposeAlbumOperations'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('fails on a missing call', () => {
    const decision = { ...base, toolSequence: ['listAlbums'] };
    assert.equal(
      classificationPass(decision, { kind: base.kind, toolSequence: ['listAlbums', 'proposeAlbumOperations'] }),
      false,
    );
  });

  it('supports asserting no tool calls at all', () => {
    const decision = { kind: 'none', toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'none', toolSequence: [] }), true);
  });
});

describe('classificationPass — planOps', () => {
  it('passes when every expected op type is present', () => {
    const decision = { ...base, planOps: [{ type: 'album.updateDetails' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), true);
  });

  it('allows extra ops the scenario does not assert', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }, { type: 'album.addAssets' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create'] }), true);
  });

  it('ignores order', () => {
    const decision = { ...base, planOps: [{ type: 'album.addAssets' }, { type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.create', 'album.addAssets'] }), true);
  });

  it('fails when an expected op type is missing', () => {
    const decision = { ...base, planOps: [{ type: 'album.create' }] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });

  it('fails when no plan ops were recorded at all', () => {
    const decision = { ...base, planOps: [] };
    assert.equal(classificationPass(decision, { kind: base.kind, planOps: ['album.updateDetails'] }), false);
  });
});

describe('classificationPass — noPlan', () => {
  it('passes when nothing was proposed', () => {
    const decision = { ...base, planProposed: false, planId: null };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), true);
  });

  it('fails when a plan was proposed', () => {
    const decision = { ...base, planProposed: true, planId: 'plan-1' };
    assert.equal(classificationPass(decision, { kind: base.kind, noPlan: true }), false);
  });
});

describe('classificationPass — existing keys still work', () => {
  it('ignores the new keys when a scenario does not opt in', () => {
    const decision = { ...base, toolSequence: ['listAlbums'], planOps: [], planProposed: false };
    assert.equal(classificationPass(decision, { kind: base.kind, slotsSurvive: true }), true);
  });

  it('still fails on the wrong kind', () => {
    const decision = { ...base, toolSequence: [] };
    assert.equal(classificationPass(decision, { kind: 'delete_album', toolSequence: [] }), false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/score.test.mjs'
```

Expected: FAIL — `SyntaxError: The requested module './score.mjs' does not provide an export named 'classificationPass'`. That is the correct red.

- [ ] **Step 3: Export `classificationPass` and add the three keys**

In `agent-runner/eval/score.mjs`, change `const classificationPass = (decision, expect) => {` to `export const classificationPass = (decision, expect) => {`, and insert the three checks immediately before the closing `return true;` of that function:

```js
// L2: exact, ordered tool-call sequence. Order-sensitive and length-sensitive
// — this is what catches a redundant read call that a subset check would miss.
if (expect.toolSequence !== undefined) {
  const got = decision.toolSequence ?? [];
  if (got.length !== expect.toolSequence.length) return false;
  if (got.some((name, i) => name !== expect.toolSequence[i])) return false;
}
// L2: subset match on operation `type`. Extra ops do not fail, so a scenario
// asserts only what it cares about.
if (expect.planOps !== undefined) {
  const types = new Set((decision.planOps ?? []).map((op) => op?.type));
  if (expect.planOps.some((type) => !types.has(type))) return false;
}
// L2: assert nothing was proposed (handoff / failed / needs_input arms).
if (expect.noPlan === true && (decision.planProposed === true || decision.planId)) return false;
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/score.test.mjs'
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Confirm L1 is untouched**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test '{src,eval}/**/*.test.mjs' 2>&1 | tail -8
```

Expected: `fail 0`. (The L1 eval itself needs a model and is not run here; criterion 4 of the spec is verified in Task 5.)

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/score.mjs agent-runner/eval/score.test.mjs
git commit -m "test(agent-runner): add L2 expect keys to the eval scorer

toolSequence is an exact ordered match (a subset check would not catch the
redundant-read regression it exists to catch); planOps is a subset match on
operation type; noPlan asserts nothing was proposed. Each is only checked when
a scenario opts in, so L1 and L3 scenarios are unaffected."
```

---

### Task 3: L2 driver — single turn

**Files:**

- Create: `agent-runner/eval/drivers/l2-workflow.mjs`
- Test: `agent-runner/eval/drivers/l2-workflow.test.mjs`

**Interfaces:**

- Consumes: `createFakeMcpClient`, `PLAN_TOOLS`, `DATASET`, `ALBUM_JAPAN_ID`, `PLAN_ID` from Task 1.
- Produces: `createL2Driver({ classifier, dataset, now, copyMode, overrides }) -> { model, baseUrl, classify, converse, polishCopy, templateCopy }`, plus `FIXED_NOW_MS` and `findRawAssetIdLeak(calls)`.

`classify(prompt)` resolves to:

```js
{
  (kind,
    via,
    confidence,
    slots,
    parsedSlots,
    outcomeStatus,
    planProposed,
    planId,
    planOps,
    toolSequence,
    text,
    handled);
}
```

- [ ] **Step 1: Write the failing test**

Create `agent-runner/eval/drivers/l2-workflow.test.mjs`:

```js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PLAN_ID } from '../fixtures/dataset.mjs';
import { createL2Driver, findRawAssetIdLeak } from './l2-workflow.mjs';

// Forces a specific routing decision without a model. The regex classifier
// handles most prompts; this is for the cases it would decline.
const stubClassifier = (kind, slots = {}) => ({
  calls: 0,
  classify(prompt) {
    this.calls += 1;
    return { kind, slots, via: 'stub', confidence: 'high' };
  },
});

describe('L2 driver — planned arm', () => {
  it('routes, calls the real tools in order, and reports the plan', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename Japan to Japan 2026');

    assert.equal(decision.kind, 'rename_or_describe_album');
    assert.deepEqual(decision.toolSequence, ['listAlbums', 'proposeAlbumOperations']);
    assert.equal(decision.outcomeStatus, 'planned');
    assert.equal(decision.planProposed, true);
    assert.equal(decision.planId, PLAN_ID);
    assert.deepEqual(
      decision.planOps.map((op) => op.type),
      ['album.updateDetails'],
    );
    assert.equal(decision.handled, true);
    assert.match(decision.text, /Review the plan/);
  });
});

describe('L2 driver — needs_input arm', () => {
  it('asks instead of guessing when two albums share a name', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename Summer to Summer 2026');

    assert.equal(decision.outcomeStatus, 'needs_input');
    assert.equal(decision.planProposed, false);
    assert.equal(decision.planId, null);
    assert.deepEqual(decision.toolSequence, ['listAlbums']);
    assert.match(decision.text, /Multiple albums/);
  });

  it('asks when no album matches', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('rename Atlantis to Atlantis 2026');

    assert.equal(decision.outcomeStatus, 'needs_input');
    assert.equal(decision.planProposed, false);
  });
});

describe('L2 driver — failed arm', () => {
  it('reports failure with no success language when the plan tool throws', async () => {
    const driver = createL2Driver({ overrides: { proposeAlbumOperations: new Error('planning exploded') } });
    const decision = await driver.classify('rename Japan to Japan 2026');

    assert.equal(decision.outcomeStatus, 'failed');
    assert.equal(decision.planProposed, false);
    assert.doesNotMatch(decision.text, /I prepared a plan/);
  });

  it('treats a plan result with no plan id as failed, not planned', async () => {
    const driver = createL2Driver({ overrides: { proposeAlbumOperations: { status: 'success' } } });
    const decision = await driver.classify('rename Japan to Japan 2026');

    assert.equal(decision.outcomeStatus, 'failed');
    assert.equal(decision.planId, null);
  });
});

describe('L2 driver — handoff_open arm', () => {
  it('declines and proposes nothing when there is nothing to clean up', async () => {
    const driver = createL2Driver({ overrides: { listDuplicateGroups: { status: 'success', groups: [] } } });
    const decision = await driver.classify('clean up duplicates');

    assert.equal(decision.outcomeStatus, 'handoff_open');
    assert.equal(decision.planProposed, false);
    assert.equal(decision.handled, false);
  });
});

describe('L2 driver — negatives', () => {
  it('routes a greeting via the chatter short-circuit WITHOUT calling the classifier', async () => {
    const classifier = stubClassifier('rename_or_describe_album');
    const driver = createL2Driver({ classifier });
    const decision = await driver.classify('thanks!');

    assert.equal(decision.kind, 'none');
    assert.equal(decision.via, 'chatter');
    assert.deepEqual(decision.toolSequence, []);
    assert.equal(classifier.calls, 0, 'chatter must bypass the classifier entirely');
  });

  it('returns kind none and calls no tools for an unsupported request', async () => {
    const driver = createL2Driver();
    const decision = await driver.classify('what is the weather like today?');

    assert.equal(decision.kind, 'none');
    assert.deepEqual(decision.toolSequence, []);
    assert.equal(decision.planProposed, false);
  });

  it('falls through when the classifier proposes a kind but parseSlots rejects it', async () => {
    // rename_or_describe_album's parseSlots returns null with neither a new name
    // nor a description, so the router must decline rather than execute.
    const driver = createL2Driver({ classifier: stubClassifier('rename_or_describe_album', { albumRef: 'Japan' }) });
    const decision = await driver.classify('do something with Japan');

    assert.equal(decision.handled, false);
    assert.equal(decision.planProposed, false);
    assert.deepEqual(decision.toolSequence, []);
  });
});

describe('L2 driver — isolation', () => {
  it('does not leak recorded calls between classify() invocations', async () => {
    const driver = createL2Driver();
    await driver.classify('rename Japan to Japan 2026');
    const second = await driver.classify('rename Japan to Japan 2026');
    assert.deepEqual(second.toolSequence, ['listAlbums', 'proposeAlbumOperations']);
  });
});

describe('findRawAssetIdLeak — the invariant must be able to fail', () => {
  it('detects a raw assetIds array in a plan-tool argument', () => {
    const calls = [{ name: 'proposeAlbumOperations', args: { operations: [{ assetIds: ['a', 'b'] }] } }];
    assert.match(findRawAssetIdLeak(calls) ?? '', /assetIds/);
  });

  it('detects a nested leak', () => {
    const calls = [{ name: 'proposeAlbumFromSelection', args: { deep: { nested: { assetIds: ['a'] } } } }];
    assert.notEqual(findRawAssetIdLeak(calls), null);
  });

  it('ignores an empty assetIds array', () => {
    const calls = [{ name: 'proposeAlbumOperations', args: { assetIds: [] } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });

  it('ignores assetIds passed to a READ tool', () => {
    const calls = [{ name: 'readAssetMetadata', args: { assetIds: ['a'] } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });

  it('passes a compliant selection-handle plan call', () => {
    const calls = [{ name: 'proposeAlbumFromSelection', args: { albumName: 'X', selectionHandleId: 'h-1' } }];
    assert.equal(findRawAssetIdLeak(calls), null);
  });
});

describe('L2 driver — the invariant is wired into every plan scenario', () => {
  it('fails a decision whose plan call leaked raw asset ids', async () => {
    const driver = createL2Driver({
      overrides: {
        // Echo a leaky arg back through the recorded call by having the plan
        // tool succeed while the workflow's args are inspected.
        proposeAlbumOperations: (args) => {
          args.assetIds = ['leaked-1'];
          return { status: 'success', plan: { id: PLAN_ID } };
        },
      },
    });
    const decision = await driver.classify('rename Japan to Japan 2026');
    assert.match(decision.rawAssetIdLeak ?? '', /assetIds/);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails for the right reason**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/drivers/l2-workflow.test.mjs'
```

Expected: FAIL — `Cannot find module .../eval/drivers/l2-workflow.mjs`.

- [ ] **Step 3: Write `l2-workflow.mjs`**

```js
// L2 driver: drives the REAL workflow dispatcher and the REAL workflow run()
// implementations against a seeded fake MCP client. No Gallery server, no DB,
// and — when a classifier is injected or the regex fast-path matches — no model.
//
// Exposes the same driver interface score.mjs already calls for L1/L3, so
// run.mjs needs no special-casing beyond layer selection.
import { createWorkflowDispatcher } from '../../src/strict-workflows/dispatcher.mjs';
import { createWorkflowRegistry } from '../../src/strict-workflows/registry.mjs';
import { renderCopy } from '../../src/strict-workflows/copy.mjs';
import { DATASET } from '../fixtures/dataset.mjs';
import { createFakeMcpClient, PLAN_TOOLS } from '../fixtures/fake-mcp-client.mjs';

// A fixed instant so trip-window arithmetic and any date in the copy are stable.
export const FIXED_NOW_MS = Date.UTC(2026, 4, 20, 12, 0, 0);

const scanForAssetIds = (value, path) => {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const hit = scanForAssetIds(item, `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      const next = path ? `${path}.${key}` : key;
      if (key === 'assetIds' && Array.isArray(item) && item.length > 0) return next;
      const hit = scanForAssetIds(item, next);
      if (hit) return hit;
    }
  }
  return null;
};

/**
 * The no-raw-asset-IDs invariant. Gallery prunes `assetIds` from provider-facing
 * planning schemas so ids are materialised server-side; a workflow must pass a
 * selection handle or source ref instead. Applied to every plan call, so a
 * regression turns every plan scenario red at once.
 *
 * @returns {string|null} the offending path, or null when clean.
 */
export const findRawAssetIdLeak = (calls) => {
  for (const call of calls) {
    if (!PLAN_TOOLS.has(call.name)) continue;
    const hit = scanForAssetIds(call.args, '');
    if (hit) return `${call.name}.${hit}`;
  }
  return null;
};

const textOf = (event) => {
  const block = event?.content?.blocks?.find((b) => b?.type === 'text');
  return typeof block?.text === 'string' ? block.text : undefined;
};

export const createL2Driver = ({
  classifier,
  dataset = DATASET,
  now = () => FIXED_NOW_MS,
  copyMode = 'template',
  overrides = {},
} = {}) => {
  // One session = one fresh fake client and one fresh pending store. State must
  // never leak between scenarios or the suite becomes order-dependent.
  const runSession = async (turns) => {
    const { client, calls } = createFakeMcpClient({ dataset, overrides });
    const registry = createWorkflowRegistry(classifier ? { classifier } : {});
    const observed = [];
    const emitted = [];
    let pending;
    let handled = false;

    const dispatcher = createWorkflowDispatcher({
      registry,
      buildClient: () => client,
      now,
      copyMode,
      observe: (event) => observed.push(event),
    });

    const common = {
      emit: (event) => emitted.push(event),
      appendTranscript: () => {},
      getPending: () => pending,
      setPending: (value) => {
        pending = value;
      },
    };

    for (const turn of turns) {
      if (typeof turn === 'string') {
        ({ handled } = await dispatcher.routeTurn({ prompt: turn, ...common }));
        continue;
      }
      const approvalEvent = emitted.find((event) => event?.type === 'tool-approval-needed');
      ({ handled } = await dispatcher.routeApproval({
        toolCallId: turn.toolCallId ?? approvalEvent?.toolCallId,
        approvalDecision: turn.approve ? 'approved' : 'denied',
        toolResult: turn.toolResult ?? { status: 'success' },
        ...common,
      }));
    }

    const router = observed.find((event) => event.kind === 'strict_router_decision');
    const outcome = observed.filter((event) => event.kind === 'strict_workflow_outcome').at(-1);
    const planCall = calls.find((call) => PLAN_TOOLS.has(call.name));
    const planId = outcome?.status === 'planned' ? (outcome.planId ?? null) : null;

    return {
      kind: router?.workflowKind ?? 'none',
      via: router?.via ?? null,
      confidence: router?.confidence ?? null,
      slots: undefined,
      parsedSlots: undefined,
      outcomeStatus: outcome?.status ?? null,
      planProposed: outcome?.status === 'planned',
      planId,
      // No WorkflowOutcome carries operations — they are an ARGUMENT to the plan
      // tool, and only the proposeAlbumOperations family takes one. Selection-based
      // plan tools legitimately leave this empty.
      planOps: Array.isArray(planCall?.args?.operations) ? planCall.args.operations : [],
      toolSequence: calls.map((call) => call.name),
      rawAssetIdLeak: findRawAssetIdLeak(calls),
      text: emitted.map(textOf).filter(Boolean).at(-1),
      handled,
    };
  };

  return {
    model: 'l2-fake-mcp',
    baseUrl: 'in-memory',
    classify: (prompt) => runSession([prompt]),
    converse: (turns) => runSession(turns),
    polishCopy: (summary) =>
      renderCopy({ outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary }, mode: 'template' }),
    templateCopy: (summary) =>
      renderCopy({ outcome: { status: 'planned', planId: 'eval-plan', successSummary: summary }, mode: 'template' }),
  };
};
```

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/drivers/l2-workflow.test.mjs'
```

Expected: PASS. If the `rename Japan to Japan 2026` prompt does not route via the regex fast-path, read `RENAME_PATTERN` at `src/strict-workflows/workflows/rename-or-describe-album.mjs:22` and adjust the prompt to a canonical form — do **not** loosen the production regex to fit the test.

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/drivers/l2-workflow.mjs agent-runner/eval/drivers/l2-workflow.test.mjs
git commit -m "test(agent-runner): L2 driver for single-turn workflow execution

Drives the real dispatcher and real workflow run() against the seeded fake MCP
client, covering the planned / needs_input / failed / handoff_open arms plus the
two negative routes (chatter, which must bypass the classifier entirely, and a
classifier hit that parseSlots rejects).

The no-raw-asset-IDs invariant runs on every plan call rather than per scenario,
and has its own tests feeding it a deliberate leak — an assertion in test
infrastructure that cannot fail is invisible."
```

---

### Task 4: L2 driver — multi-turn and approval

**Files:**

- Modify: `agent-runner/eval/drivers/l2-workflow.test.mjs` (add cases)
- Modify: `agent-runner/eval/drivers/l2-workflow.mjs` only if a test exposes a gap

**Interfaces:**

- Consumes: `createL2Driver` from Task 3.
- Produces: `converse(turns)` accepting `string | { approve: boolean, toolCallId?, toolResult? }`.

Approval reaches the `approval_required` arm only through `create_recent_trip_album`; every other workflow in the slice routes a non-`success` plan status to `failed` via `gatePlanResult` (`plan-gate.mjs:51`).

- [ ] **Step 1: Write the failing tests**

Append to `agent-runner/eval/drivers/l2-workflow.test.mjs`:

```js
describe('L2 driver — multi-turn', () => {
  it('accumulates the tool sequence across turns', async () => {
    const driver = createL2Driver();
    const decision = await driver.converse(['rename Summer to Summer 2026', 'rename Japan to Japan 2026']);
    assert.deepEqual(decision.toolSequence, ['listAlbums', 'listAlbums', 'proposeAlbumOperations']);
  });

  it('starts each converse() with a clean pending store', async () => {
    const driver = createL2Driver();
    await driver.converse(['rename Summer to Summer 2026']);
    const decision = await driver.converse(['rename Japan to Japan 2026']);
    assert.deepEqual(decision.toolSequence, ['listAlbums', 'proposeAlbumOperations']);
    assert.equal(decision.outcomeStatus, 'planned');
  });
});

describe('L2 driver — approval', () => {
  const approvalOverrides = {
    proposeAlbumFromSelection: { status: 'approval-required', toolCall: { id: 'tool-call-1' } },
  };

  it('reaches the approval_required arm and proposes nothing yet', async () => {
    const driver = createL2Driver({ overrides: approvalOverrides });
    const decision = await driver.classify('create an album for my recent trip to Japan');

    assert.equal(decision.outcomeStatus, 'approval_required');
    assert.equal(decision.planProposed, false);
  });

  it('an approved decision resumes the workflow', async () => {
    const driver = createL2Driver({ overrides: approvalOverrides });
    const decision = await driver.converse(['create an album for my recent trip to Japan', { approve: true }]);

    assert.notEqual(decision.outcomeStatus, 'approval_required');
  });

  it('a denied decision proposes nothing', async () => {
    const driver = createL2Driver({ overrides: approvalOverrides });
    const decision = await driver.converse(['create an album for my recent trip to Japan', { approve: false }]);

    assert.equal(decision.planProposed, false);
    assert.equal(decision.planId, null);
  });

  it('a mismatched toolCallId is not treated as a denial', async () => {
    const driver = createL2Driver({ overrides: approvalOverrides });
    const decision = await driver.converse([
      'create an album for my recent trip to Japan',
      { approve: true, toolCallId: 'not-the-pending-one' },
    ]);

    assert.equal(decision.handled, false, 'a mismatched approval must fall through, not resolve the workflow');
  });

  it('approval-required with no usable toolCallId fails rather than hanging', async () => {
    const driver = createL2Driver({
      overrides: { proposeAlbumFromSelection: { status: 'approval-required' } },
    });
    const decision = await driver.classify('create an album for my recent trip to Japan');

    assert.equal(decision.outcomeStatus, 'failed');
    assert.equal(decision.planProposed, false);
  });
});

describe('L2 driver — continuation expiry', () => {
  // Pending choices expire after 10 minutes:
  // `nowMs - pending.createdAtMs > ttlMs` (candidate-disambiguation.mjs:103).
  // A constant clock can never reach that, so a turn may advance it.
  it('expires a pending continuation once the TTL has passed', async () => {
    const driver = createL2Driver({
      overrides: {
        findTripCandidates: {
          status: 'success',
          recommendation: { action: 'ask_user', reason: 'Two candidate trips are equally likely.' },
          candidates: [
            { dedupeKey: 'trip:a', label: 'Tokyo', confidence: 'medium' },
            { dedupeKey: 'trip:b', label: 'Kyoto', confidence: 'medium' },
          ],
        },
      },
    });

    const decision = await driver.converse([
      'create an album for my recent trip to Japan',
      { advanceMs: 11 * 60 * 1000 },
      'the first one',
    ]);

    assert.equal(decision.planProposed, false);
    assert.match(decision.text ?? '', /expired/i);
  });

  it('resolves the continuation when the follow-up is prompt', async () => {
    const driver = createL2Driver({
      overrides: {
        findTripCandidates: {
          status: 'success',
          recommendation: { action: 'ask_user', reason: 'Two candidate trips are equally likely.' },
          candidates: [
            { dedupeKey: 'trip:a', label: 'Tokyo', confidence: 'medium' },
            { dedupeKey: 'trip:b', label: 'Kyoto', confidence: 'medium' },
          ],
        },
      },
    });

    const decision = await driver.converse(['create an album for my recent trip to Japan', 'the first one']);

    assert.doesNotMatch(decision.text ?? '', /expired/i);
  });
});
```

- [ ] **Step 2: Run and confirm the new cases fail**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node --test 'eval/drivers/l2-workflow.test.mjs'
```

Expected: the multi-turn cases may already pass (`converse` was implemented in Task 3); the approval cases are the real red. Record which fail before changing any code — if **all** pass immediately, verify the overrides are actually taking effect by asserting `decision.toolSequence` contains `proposeAlbumFromSelection`, otherwise the test is not exercising what it claims.

- [ ] **Step 3a: Add the clock-advancing turn to the driver**

Continuation expiry compares `nowMs` against `pending.createdAtMs`, so a constant clock can never
reach it. Add a mutable offset to `runSession` in `agent-runner/eval/drivers/l2-workflow.mjs`.

Replace the `runSession` clock and turn loop. Immediately after `let handled = false;` add:

```js
// Turns may advance the clock so TTL-dependent arms (continuation expiry)
// are reachable. `now` is read more than once per turn by the dispatcher, so
// an auto-incrementing clock would be unpredictable — advance it explicitly.
let clockOffsetMs = 0;
const sessionNow = () => now() + clockOffsetMs;
```

Change the dispatcher construction to use it:

```js
      now: sessionNow,
```

And add this as the first branch inside the `for (const turn of turns)` loop:

```js
      if (turn && typeof turn === 'object' && typeof turn.advanceMs === 'number') {
        clockOffsetMs += turn.advanceMs;
        continue;
      }
```

- [ ] **Step 3b: Make the remaining cases pass**

The `routeApproval` branch is already implemented in Task 3. If a case fails, the likely causes in order:

1. The trip prompt does not route via regex — check `matchStrictWorkflow` at `src/strict-workflows.mjs:83` and use a canonical phrasing such as `create an album for my recent trip to Japan`.
2. `pending` is not visible to the approval turn — confirm `getPending`/`setPending` share the same closure variable across turns in `runSession`.
3. The mismatched-`toolCallId` case returns `handled: true` — confirm the driver passes `turn.toolCallId` through rather than always reading the emitted event.

Fix the driver, not the test, unless the test's expectation contradicts `dispatcher.mjs:283`.

- [ ] **Step 4: Run the full package suite**

```bash
pnpm --dir /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner test 2>&1 | tail -8
```

Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/drivers/l2-workflow.test.mjs agent-runner/eval/drivers/l2-workflow.mjs
git commit -m "test(agent-runner): L2 multi-turn and approval coverage

A turn is a string (routeTurn) or an approval object (routeApproval) — an
approval is not a user message, so the L3 string-only turn shape cannot express
one. Covers approved, denied, a mismatched toolCallId that must fall through
rather than read as a denial, and approval-required arriving with no usable
toolCallId, which fails instead of hanging."
```

---

### Task 5: `run.mjs` and `config.mjs` wiring

**Files:**

- Modify: `agent-runner/eval/run.mjs` (lines 17-20, 30-45, 64-88)
- Modify: `agent-runner/eval/config.mjs`
- Modify: `agent-runner/package.json` (add `eval:l2`)

**Interfaces:**

- Consumes: `createL2Driver` (Task 3), `l2Scenarios` (Task 6 — create the file as an empty array export in this task so the import resolves).
- Produces: `node eval/run.mjs --layer L2` working end to end.

- [ ] **Step 1: Create the scenario file as an empty list so the import resolves**

Create `agent-runner/eval/scenarios/l2-workflow.mjs`:

```js
// L2 scenarios — populated in Task 6.
export default [];
```

- [ ] **Step 2: Add the config block**

In `agent-runner/eval/config.mjs`, add to the default export object (alongside `gallery` and `l3`):

```js
  l2: {
    runs: Number(process.env.EVAL_L2_RUNS ?? 1),
  },
```

And add to the header comment block:

```
//   EVAL_L2_RUNS         repeats per L2 scenario (default 1 — deterministic fake MCP)
```

- [ ] **Step 3: Wire the layer into `run.mjs`**

Add the imports next to the existing driver/scenario imports:

```js
import l2Scenarios from './scenarios/l2-workflow.mjs';
import { createL2Driver } from './drivers/l2-workflow.mjs';
```

Replace the layer guard:

```js
if (layer !== 'L1' && layer !== 'L2' && layer !== 'L3') {
  log(`Unknown --layer "${layer}". Use L1 (default), L2, or L3.`);
  process.exit(2);
}
```

Replace the scenario/runs/baseline selection:

```js
const allScenarios = layer === 'L3' ? l3Scenarios : layer === 'L2' ? l2Scenarios : l1Scenarios;
const selected = filter ? allScenarios.filter((s) => s.id.includes(filter) || s.category === filter) : allScenarios;
const runs = Number(opt('runs', layer === 'L3' ? config.l3.runs : layer === 'L2' ? config.l2.runs : config.runs));
const baselinePath = join(
  here,
  layer === 'L3' ? 'baseline.l3.json' : layer === 'L2' ? 'baseline.l2.json' : 'baseline.json',
);
```

And add the L2 branch inside `buildDriver`, immediately before the `await checkLlamaConnectivity();` line:

```js
if (layer === 'L2') {
  // L2 needs no model: the regex fast-path routes the scenarios and the fake
  // MCP client answers every tool.
  const driver = createL2Driver();
  return { driver, meta: { model: driver.model, baseUrl: driver.baseUrl, routerMode: 'regex', runs, layer: 'L2' } };
}
```

Finally, in the `diff` branch, replace the baseline-missing message so it names the right file:

```js
log(`No ${baselinePath.split('/').pop()} yet; run with --accept to create one.`);
```

- [ ] **Step 4: Add the script**

In `agent-runner/package.json`:

```json
"eval:l2": "node --env-file-if-exists=.env eval/run.mjs --layer L2"
```

- [ ] **Step 5: Verify the layer runs and the others are untouched**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node eval/run.mjs --layer L2                 # expect: 0 scenarios, a scorecard, exit 0
node eval/run.mjs --layer L4 ; echo "exit=$?" # expect: "Unknown --layer" and exit=2
git diff --stat eval/run.mjs                  # expect: only the intended hunks
```

Spec acceptance criterion 4 (L1/L3 unchanged) is satisfied structurally: no L1 or L3 branch was edited. Confirm with `git diff eval/run.mjs` that no line inside an `layer === 'L3'` block changed.

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/run.mjs agent-runner/eval/config.mjs agent-runner/eval/scenarios/l2-workflow.mjs agent-runner/package.json
git commit -m "feat(agent-runner): wire --layer L2 into the eval CLI

L2 needs no model — the regex fast-path routes the scenarios and the fake MCP
client answers every tool — so buildDriver returns before the llama
connectivity check. Baseline lands in baseline.l2.json; L1 and L3 branches are
untouched."
```

---

### Task 6: Scenarios, README, baseline

**Files:**

- Modify: `agent-runner/eval/scenarios/l2-workflow.mjs`
- Modify: `agent-runner/eval/README.md`
- Create: `agent-runner/eval/baseline.l2.json` (generated)

**Interfaces:**

- Consumes: the `expect` keys from Task 2 and the decision object from Tasks 3-4.

- [ ] **Step 1: Write the scenarios**

Replace `agent-runner/eval/scenarios/l2-workflow.mjs`:

```js
// L2 scenarios — workflow EXECUTION against the seeded fake MCP client.
//
// These assert what L1 cannot: the exact tool sequence a workflow issues, the
// shape of the plan it proposes, and which outcome arm it lands in. Every
// scenario is deterministic (fixed clock, frozen dataset, regex routing), so
// `runs` is 1 and the threshold is 1 — any failure is a real regression, never
// model variance.
const strict = { runs: 1, threshold: 1 };

export default [
  {
    id: 'l2.rename.planned',
    category: 'execution',
    prompt: 'rename Japan to Japan 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums', 'proposeAlbumOperations'],
      planOps: ['album.updateDetails'],
      outcomeStatus: 'planned',
    },
    ...strict,
  },
  {
    id: 'l2.rename.ambiguous.needs-input',
    category: 'execution',
    prompt: 'rename Summer to Summer 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums'],
      outcomeStatus: 'needs_input',
      noPlan: true,
    },
    ...strict,
  },
  {
    id: 'l2.rename.missing.needs-input',
    category: 'execution',
    prompt: 'rename Atlantis to Atlantis 2026',
    expect: {
      kind: 'rename_or_describe_album',
      toolSequence: ['listAlbums'],
      outcomeStatus: 'needs_input',
      noPlan: true,
    },
    ...strict,
  },
  {
    id: 'l2.trip.planned',
    category: 'execution',
    prompt: 'create an album for my recent trip to Japan',
    expect: {
      kind: 'create_recent_trip_album',
      outcomeStatus: 'planned',
      // Selection-based plan tool: no operations array, so planOps is not asserted.
    },
    ...strict,
  },
  {
    id: 'l2.negatives.question',
    category: 'negatives',
    prompt: 'what is the weather like today?',
    expect: { kind: 'none', toolSequence: [], noPlan: true },
    ...strict,
  },
  {
    id: 'l2.negatives.chatter',
    category: 'negatives',
    prompt: 'thanks!',
    expect: { kind: 'none', toolSequence: [], noPlan: true },
    ...strict,
  },
];
```

- [ ] **Step 2: Run and confirm every scenario passes**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main/agent-runner
node eval/run.mjs --layer L2
```

Expected: `overall 100%`, `6/6 scenarios passed`, exit 0. Any failure here is a real mismatch between the plan's expectations and the workflows — read the scorecard's `got:` line and fix the scenario, not the workflow.

- [ ] **Step 3: Prove the harness can actually fail (spec acceptance criterion 5)**

Temporarily add a redundant read call to `rename-or-describe-album.mjs`, immediately after the `resolveAlbum` call inside `run()`:

```js
await client.call('listAlbums', {}, { signal }); // TEMPORARY — regression probe
```

Then:

```bash
node eval/run.mjs --layer L2 --filter l2.rename.planned ; echo "exit=$?"
```

Expected: FAIL with `got: ... toolSequence` showing three calls, and `exit=1`.

**Now revert the probe** (`git checkout -- src/strict-workflows/workflows/rename-or-describe-album.mjs`) and re-run to confirm green again. Do not commit the probe.

- [ ] **Step 4: Accept the baseline**

```bash
node eval/run.mjs --layer L2 --accept
node eval/run.mjs --layer L2 --diff     # expect: 0 regressions, 0 improvements
```

- [ ] **Step 5: Update the README**

In `agent-runner/eval/README.md`, change the L2 row of the layer table to drop `_not built yet_`:

```
| **L2** | workflow  | the dispatcher + workflow `run()` with a *fake* MCP client | agent-runner code only — no Gallery, no DB, **no model** |
```

And add a section after the "How scoring works" section:

````markdown
## L2 — workflow execution (fake MCP, no DB, no model)

`--layer L2` drives the real dispatcher and the real workflow `run()` against a
seeded in-memory MCP client (`eval/fixtures/`). It asserts what L1 cannot: the
**exact ordered tool sequence** a workflow issues, the **plan operations** it
proposes, and which **outcome arm** it lands in — plus a global invariant that no
plan call ever carries raw asset ids.

```bash
pnpm eval:l2                       # or: pnpm eval -- --layer L2
pnpm eval -- --layer L2 --diff     # vs eval/baseline.l2.json
```

Scenario keys beyond the L1 set: `toolSequence` (exact, ordered),
`planOps` (subset match on operation `type`), `noPlan`, and `outcomeStatus`.
`planOps` is only populated for the `proposeAlbumOperations` family — the
selection-based plan tools pass a handle and let the server derive operations,
so those scenarios assert `toolSequence` and `outcomeStatus` instead.

L2 is deterministic: a fixed clock, a frozen dataset, and regex routing. Scenarios
run once with a threshold of 1, so any failure is a real regression rather than
model variance.
````

- [ ] **Step 6: Verify docs formatting and the whole suite**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
npx prettier --check "agent-runner/eval/README.md"
pnpm --dir agent-runner test 2>&1 | tail -8
```

Expected: prettier clean; `fail 0`.

- [ ] **Step 7: Commit**

```bash
cd /Users/pierre/dev/gallery-worktrees/pi-agent-main
git add agent-runner/eval/scenarios/l2-workflow.mjs agent-runner/eval/baseline.l2.json agent-runner/eval/README.md
git commit -m "feat(agent-runner): L2 scenarios, baseline, and docs

Six deterministic execution scenarios covering the planned, needs_input and
negative arms across two workflows. Verified the harness can fail by adding a
redundant listAlbums call to rename_or_describe_album and watching
l2.rename.planned go red on the toolSequence assertion.

Removes the '_not built yet_' marker from the README's layer table."
```

---

## Follow-on, explicitly not in this plan

- The remaining 31 workflows. The fixture and driver grow per workflow; add a scenario plus any missing tool handler.
- `delete_album`, `manage_album_access`, `add_photos_to_album`, `archive_assets` scenarios — the design spec lists them in the slice, but they need dataset entries for spaces/assets that Tasks 1-6 do not seed. Add them as a follow-up once the harness is proven.
- Post-handoff open-orchestration scoring, which is what would let a skill body be A/B'd. Out of scope per the design spec.
