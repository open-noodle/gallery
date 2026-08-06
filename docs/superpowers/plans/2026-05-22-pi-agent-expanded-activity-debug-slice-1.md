# Pi Agent Expanded Activity Debug Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Formalize the compact-vs-expanded activity model so expanded activity rows are per-tool-call, deterministic, and stable across tool-call lifecycle changes.

**Architecture:** Keep the existing `AgentActivityModel` split: `items` remains the compact/coalesced row set, while `verboseItems` is the expanded/debug row set. Change individual tool-call activity ids to use source identity only (`tool-${toolCall.id}`), because kind/status can change as a tool call moves from pending approval to running/completed. Keep compact coalesced aggregate ids unchanged for multi-call groups.

**Tech Stack:** Svelte 5, TypeScript, Vitest, `@immich/sdk` generated DTO enums.

---

## Spec Reference

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md`

Slice 1 requirements:

- Compact rows come from coalesced activity.
- Expanded rows come from per-tool-call verbose activity.
- Activity events never remove verbose tool rows.
- Ordering is deterministic for compact and expanded rows.
- A single tool call keeps the same verbose row id across `pendingApproval -> approved -> executing -> completed`.
- Edge cases: same timestamps, unknown tools, mixed statuses, pending approval lifecycle, missing response summaries.

## Files

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

## Task 1: Add Failing View-Model Contract Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [x] **Step 1: Update existing verbose id expectations to the new stable source-id contract**

In the `builds an expanded verbose timeline with ordered plain-language rows` test, change the expected verbose ids:

```ts
expect(model.verboseItems).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      id: 'tool-search-0',
      title: 'Searching photos',
      status: 'completed',
      summary: 'Found matching photos',
      count: 12,
    }),
    expect.objectContaining({
      id: 'tool-metadata-55',
      title: 'Reading photo details',
      status: 'running',
      summary: 'Reading photo details',
      count: 3,
    }),
    expect.objectContaining({ id: 'tool-unknown-14', title: 'Working with Gallery' }),
  ]),
);
expect(model.verboseItems.find((item) => item.id === 'tool-unknown-14')?.technical?.toolName).toBe(
  'futureMcpDebugTool',
);
```

In the `keeps tool-call and current-plan evidence primary over duplicate explicit events` test, change the compact singleton plan tool id expectation:

```ts
expect(model.items.find((item) => item.kind === 'plan')).toMatchObject({
  id: 'tool-plan-tool',
  status: 'completed',
  summary: 'Prepared a plan',
});
```

In the `uses deterministic ordering for same timestamps and malformed timestamps` test, change the expected ids:

```ts
expect(model.items.map((item) => item.id)).toEqual([
  'tool-search-same-time',
  'tool-metadata-same-time',
  'tool-z-unknown-time',
]);
```

- [x] **Step 2: Add a failing lifecycle id stability test**

Add this test after `maps pending tool calls to a blocked permission row without exposing raw tool names`:

```ts
it('keeps a tool call row id stable across permission and execution lifecycle changes', () => {
  const lifecycleToolId = 'lifecycle-tool';
  const baseToolCall = {
    id: lifecycleToolId,
    toolName: AgentToolName.ReadAssetMetadata,
    requestSummary: 'Read 12 photo metadata records',
    responseSummary: null,
    assetCount: 12,
    startedAt: '2026-05-18T10:00:05.000Z',
  } satisfies Partial<AgentToolCallResponseDto>;

  const pending = buildModel({
    toolCalls: [
      makeToolCall({
        ...baseToolCall,
        status: AgentToolCallStatus.PendingApproval,
        completedAt: null,
      }),
    ],
  });
  const approved = buildModel({
    toolCalls: [
      makeToolCall({
        ...baseToolCall,
        status: AgentToolCallStatus.Approved,
        completedAt: null,
      }),
    ],
  });
  const executing = buildModel({
    toolCalls: [
      makeToolCall({
        ...baseToolCall,
        status: AgentToolCallStatus.Executing,
        completedAt: null,
      }),
    ],
  });
  const completed = buildModel({
    toolCalls: [
      makeToolCall({
        ...baseToolCall,
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Read details for photos',
        completedAt: '2026-05-18T10:00:09.000Z',
      }),
    ],
  });

  expect(pending.verboseItems[0]).toMatchObject({
    id: 'tool-lifecycle-tool',
    kind: 'permission',
    status: 'blocked',
    title: 'Waiting for approval',
  });
  expect(approved.verboseItems[0]).toMatchObject({
    id: 'tool-lifecycle-tool',
    kind: 'metadata',
    status: 'running',
    title: 'Reading photo details',
  });
  expect(executing.verboseItems[0]).toMatchObject({
    id: 'tool-lifecycle-tool',
    kind: 'metadata',
    status: 'running',
  });
  expect(completed.verboseItems[0]).toMatchObject({
    id: 'tool-lifecycle-tool',
    kind: 'metadata',
    status: 'completed',
  });
  expect([pending, approved, executing, completed].map((model) => model.verboseItems[0].id)).toEqual([
    'tool-lifecycle-tool',
    'tool-lifecycle-tool',
    'tool-lifecycle-tool',
    'tool-lifecycle-tool',
  ]);
});
```

- [x] **Step 3: Add explicit repeated-tool and event-filter tests**

Add these tests near the existing verbose timeline tests:

```ts
it('keeps every repeated tool call as a separate expanded row while compact rows stay coalesced', () => {
  const repeatedSearches = Array.from({ length: 50 }, (_, index) =>
    makeToolCall({
      id: `repeat-search-${index}`,
      toolName: AgentToolName.SearchAssets,
      assetCount: 1,
      startedAt: `2026-05-18T10:00:${String(index).padStart(2, '0')}.000Z`,
      completedAt: `2026-05-18T10:00:${String(index + 1).padStart(2, '0')}.000Z`,
    }),
  );

  const model = buildModel({ toolCalls: repeatedSearches });

  expect(model.verboseItems).toHaveLength(50);
  expect(model.verboseItems.map((item) => item.id)).toEqual(repeatedSearches.map((toolCall) => `tool-${toolCall.id}`));
  expect(model.items).toHaveLength(1);
  expect(model.items[0]).toMatchObject({
    id: 'tool-search-search-assets',
    kind: 'search',
    status: 'completed',
    count: 50,
  });
});

it('does not let secondary activity events remove expanded tool-call rows', () => {
  const model = buildModel({
    toolCalls: [
      makeToolCall({
        id: 'plan-tool',
        toolName: AgentToolName.ProposeAlbumOperations,
        startedAt: '2026-05-18T10:00:02.000Z',
        completedAt: '2026-05-18T10:00:04.000Z',
      }),
      makeToolCall({
        id: 'search-after-plan',
        toolName: AgentToolName.SearchAssets,
        assetCount: 3,
        responseSummary: null,
        startedAt: '2026-05-18T10:00:05.000Z',
        completedAt: '2026-05-18T10:00:07.000Z',
      }),
    ],
    currentPlan: makePlan({
      createdAt: '2026-05-18T10:00:08.000Z',
      updatedAt: '2026-05-18T10:00:09.000Z',
    }),
    activityEvents: [
      makeActivityEvent({
        id: 'start',
        kind: 'start-processing',
        status: 'running',
        createdAt: '2026-05-18T10:00:01.000Z',
      }),
      makeActivityEvent({
        id: 'plan-composing',
        kind: 'plan-composing',
        status: 'completed',
        createdAt: '2026-05-18T10:00:03.000Z',
      }),
    ],
  });

  expect(model.verboseItems.map((item) => item.id)).toEqual(
    expect.arrayContaining(['tool-plan-tool', 'tool-search-after-plan']),
  );
  expect(model.verboseItems.filter((item) => item.id.startsWith('tool-'))).toHaveLength(2);
  expect(model.items.filter((item) => item.kind === 'plan')).toHaveLength(1);
});
```

- [x] **Step 4: Run focused tests and verify they fail for the expected reason**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected red result:

- Failures mention old ids such as `tool-search-search-0`, `tool-metadata-metadata-55`, `tool-permission-lifecycle-tool`, or `tool-metadata-lifecycle-tool`.
- The repeated-tool compact assertions may still pass; the lifecycle id stability test must fail before implementation.

## Task 2: Implement Stable Tool-Call Row Ids

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`

- [x] **Step 1: Change individual tool-call activity ids to source-only ids**

In `buildToolActivityCandidate`, change:

```ts
id: `tool-${definition.kind}-${toolCall.id}`,
```

to:

```ts
id: `tool-${toolCall.id}`,
```

Leave `coalesceKey` unchanged:

```ts
coalesceKey: `${definition.kind}:${definition.coalesceKey}`,
```

Do not change the aggregate id for multi-call coalesced compact rows in `coalesceToolActivities`. Multi-call compact ids such as `tool-search-search-assets` are still useful stable aggregate ids.

- [x] **Step 2: Run focused tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected green result:

- `agent-activity-ui.spec.ts` passes.
- The total test count increases from the baseline by the new tests added in Task 1.

- [x] **Step 3: Run type/lint-sensitive web check for the touched area**

Note: `pnpm --filter immich-web check` failed because `immich-web` has no `check` script in this worktree. Ran the available equivalents instead: `pnpm --filter immich-web run check:svelte` and `pnpm --filter immich-web run check:typescript`.

Run:

```bash
pnpm --filter immich-web check
```

Expected green result:

- Svelte/TypeScript checks pass.

## Task 3: Self-Review And Commit Slice 1

**Files:**

- Review: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Review: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Review: `docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md`
- Review: `docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-1.md`

- [x] **Step 1: Verify spec coverage**

Check:

- Expanded repeated `searchAssets` calls stay as 50 verbose rows.
- Compact repeated `searchAssets` calls stay one coalesced row.
- Activity events do not remove verbose tool-call rows.
- Polling-first and websocket-first ordering tests still pass.
- Missing/same timestamp deterministic ordering test passes with source-only ids.
- Pending approval lifecycle keeps one stable row id.
- Unknown tool default copy still hides raw tool names.
- Mixed status precedence tests still pass.
- Missing response summary still uses safe fallback copy.

- [x] **Step 2: Check the diff**

Run:

```bash
git diff -- web/src/routes/\(user\)/assistant/agent-activity-ui.ts web/src/routes/\(user\)/assistant/agent-activity-ui.spec.ts docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-1.md
git diff --check
```

Expected:

- Only Slice 1 files and docs are changed.
- No whitespace errors.

- [x] **Step 3: Commit**

Run:

```bash
git add web/src/routes/\(user\)/assistant/agent-activity-ui.ts \
  web/src/routes/\(user\)/assistant/agent-activity-ui.spec.ts \
  docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-1.md
git commit -m "fix: stabilize Pi expanded activity row ids"
```

Expected:

- Commit succeeds.
- Working tree is clean after commit.

## Plan Review Checklist

- TDD is explicit: Task 1 writes failing tests and requires red verification before Task 2 implementation.
- Every Slice 1 spec test is represented:
  - repeated expanded rows;
  - compact coalescing;
  - event filtering;
  - polling/websocket deterministic ids;
  - invalid/missing timestamp ordering;
  - pending approval lifecycle id stability.
- Every Slice 1 edge case is represented:
  - same timestamps;
  - unknown future tools;
  - mixed completed/running/failed statuses;
  - pending approval to running/completed transitions;
  - missing response summaries.
- Scope does not implement Slice 2 paging/rendering or Slice 3 refresh flicker handling.
