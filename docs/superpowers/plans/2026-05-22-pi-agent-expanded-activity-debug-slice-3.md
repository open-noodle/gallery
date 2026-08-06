# Pi Agent Expanded Activity Debug Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Stop expanded activity from flickering into raw tool cards or collapsed starter rows while tool-call polling, websocket events, and message loading refresh in different orders.

**Architecture:** Add a small frontend-only tool-call timeline state helper that merges incoming tool-call refreshes with the last known per-session state and rejects status regressions. Use that stable state in `AgentSessionChatPanel.svelte`, and publish all timeline-relevant tool calls from `AgentSessionActionDock.svelte` so pending, approved, executing, completed, failed, and denied rows can be rendered by the activity block. Keep compact mode coalesced and keep raw fallback cards only for genuinely uncovered tool calls.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library for Svelte, existing Immich SDK DTOs.

---

## Spec Reference

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md`

Slice 3 requirements:

- Harden `AgentSessionChatPanel.svelte` timeline construction so covered tool calls do not briefly render as raw fallback cards while activity turns are rebuilding.
- Preserve expanded activity blocks across message, tool-call, and activity-event load ordering.
- Ensure successful `tool-calls` refreshes update activity rows in place.
- TDD is required: write failing tests first, confirm red, implement the smallest fix, then confirm green.

## Files

- Create: `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-3.md`

## Task 1: Add Stable Tool-Call Timeline State Helper

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.ts`

- [x] **Step 1: Write failing helper tests**

Create `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts`:

```ts
import { AgentToolCallStatus, AgentToolDataClass, AgentToolName, type AgentToolCallResponseDto } from '@immich/sdk';
import {
  areAgentTimelineToolCallListsEquivalent,
  mergeAgentTimelineToolCalls,
} from './agent-session-tool-call-state-ui';

const makeToolCall = (overrides: Partial<AgentToolCallResponseDto> = {}): AgentToolCallResponseDto => ({
  id: overrides.id ?? 'tool-call-1',
  sessionId: overrides.sessionId ?? 'session-1',
  toolName: overrides.toolName ?? AgentToolName.SearchAssets,
  status: overrides.status ?? AgentToolCallStatus.Executing,
  approvalDecision: overrides.approvalDecision ?? null,
  requestSummary: overrides.requestSummary ?? 'Search photos',
  responseSummary: Object.hasOwn(overrides, 'responseSummary') ? overrides.responseSummary! : null,
  dataClass: overrides.dataClass ?? AgentToolDataClass.Metadata,
  assetCount: overrides.assetCount ?? 0,
  albumCount: overrides.albumCount ?? 0,
  startedAt: overrides.startedAt ?? '2026-05-16T10:00:05.000Z',
  completedAt: Object.hasOwn(overrides, 'completedAt') ? overrides.completedAt! : null,
  error: Object.hasOwn(overrides, 'error') ? overrides.error! : null,
  resultSize: overrides.resultSize,
});

describe('agent session tool-call timeline state', () => {
  it('keeps previous session tool calls out of the next session', () => {
    const previous = [
      makeToolCall({ id: 'old-session-tool', sessionId: 'session-1', status: AgentToolCallStatus.Completed }),
    ];
    const incoming = [makeToolCall({ id: 'new-session-tool', sessionId: 'session-2' })];

    expect(mergeAgentTimelineToolCalls(previous, incoming, 'session-2').map((toolCall) => toolCall.id)).toEqual([
      'new-session-tool',
    ]);
  });

  it('preserves terminal state when an older running refresh arrives later', () => {
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      completedAt: '2026-05-16T10:01:00.000Z',
    });
    const staleExecuting = makeToolCall({
      status: AgentToolCallStatus.Executing,
      responseSummary: null,
      completedAt: null,
    });

    expect(mergeAgentTimelineToolCalls([completed], [staleExecuting], 'session-1')).toEqual([completed]);
  });

  it('updates an existing row when status advances', () => {
    const executing = makeToolCall({ status: AgentToolCallStatus.Executing, completedAt: null });
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      completedAt: '2026-05-16T10:01:00.000Z',
    });

    expect(mergeAgentTimelineToolCalls([executing], [completed], 'session-1')).toEqual([completed]);
  });

  it('preserves richer terminal data when a same-time terminal refresh is missing details', () => {
    const completed = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: 'Returned 4 photos',
      assetCount: 4,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: {
        returnedItems: 4,
        hasMore: false,
        nextPage: null,
        estimatedBytes: 4096,
        truncated: false,
        omittedFields: [],
      },
    });
    const staleCompleted = makeToolCall({
      status: AgentToolCallStatus.Completed,
      responseSummary: null,
      assetCount: 0,
      completedAt: '2026-05-16T10:01:00.000Z',
      resultSize: undefined,
    });

    expect(mergeAgentTimelineToolCalls([completed], [staleCompleted], 'session-1')).toEqual([completed]);
  });

  it('keeps known calls when a refresh temporarily omits them', () => {
    const known = [
      makeToolCall({ id: 'tool-a', status: AgentToolCallStatus.Completed, completedAt: '2026-05-16T10:00:10.000Z' }),
      makeToolCall({ id: 'tool-b', status: AgentToolCallStatus.Executing, startedAt: '2026-05-16T10:00:20.000Z' }),
    ];

    expect(mergeAgentTimelineToolCalls(known, [], 'session-1').map((toolCall) => toolCall.id)).toEqual([
      'tool-a',
      'tool-b',
    ]);
  });

  it('sorts merged calls deterministically by started time then id', () => {
    const merged = mergeAgentTimelineToolCalls(
      [makeToolCall({ id: 'tool-b', startedAt: '2026-05-16T10:00:00.000Z' })],
      [makeToolCall({ id: 'tool-a', startedAt: '2026-05-16T10:00:00.000Z' })],
      'session-1',
    );

    expect(merged.map((toolCall) => toolCall.id)).toEqual(['tool-a', 'tool-b']);
  });

  it('detects equivalent tool-call state lists', () => {
    const calls = [makeToolCall({ status: AgentToolCallStatus.Completed, completedAt: '2026-05-16T10:01:00.000Z' })];

    expect(areAgentTimelineToolCallListsEquivalent(calls, [...calls])).toBe(true);
    expect(
      areAgentTimelineToolCallListsEquivalent(calls, [
        makeToolCall({ status: AgentToolCallStatus.Executing, completedAt: null }),
      ]),
    ).toBe(false);
  });
});
```

- [x] **Step 2: Run helper tests and verify red**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts'
```

Expected red result:

- Fails because `agent-session-tool-call-state-ui.ts` does not exist.

- [x] **Step 3: Implement the helper**

Create `web/src/routes/(user)/assistant/agent-session-tool-call-state-ui.ts`:

```ts
import { AgentToolCallStatus, type AgentToolCallResponseDto } from '@immich/sdk';

const statusProgressRank: Record<AgentToolCallStatus, number> = {
  [AgentToolCallStatus.PendingApproval]: 0,
  [AgentToolCallStatus.Approved]: 1,
  [AgentToolCallStatus.Executing]: 2,
  [AgentToolCallStatus.Completed]: 3,
  [AgentToolCallStatus.Failed]: 3,
  [AgentToolCallStatus.Denied]: 3,
};

const getToolCallStateKey = (toolCall: AgentToolCallResponseDto) =>
  [
    toolCall.id,
    toolCall.sessionId,
    toolCall.toolName,
    toolCall.status,
    toolCall.startedAt,
    toolCall.completedAt ?? '',
    toolCall.requestSummary ?? '',
    toolCall.responseSummary ?? '',
    toolCall.error ?? '',
    toolCall.approvalDecision ?? '',
    toolCall.assetCount,
    toolCall.albumCount,
    toolCall.resultSize?.returnedItems ?? '',
    toolCall.resultSize?.hasMore ?? '',
    toolCall.resultSize?.nextPage ?? '',
    toolCall.resultSize?.estimatedBytes ?? '',
    toolCall.resultSize?.truncated ?? '',
    toolCall.resultSize?.omittedFields.join(',') ?? '',
  ].join('|');

const getToolCallActivityTime = (toolCall: AgentToolCallResponseDto) => toolCall.completedAt ?? toolCall.startedAt;

const compareToolCalls = (first: AgentToolCallResponseDto, second: AgentToolCallResponseDto) =>
  first.startedAt.localeCompare(second.startedAt) || first.id.localeCompare(second.id);

const getToolCallDetailScore = (toolCall: AgentToolCallResponseDto) =>
  [
    toolCall.requestSummary,
    toolCall.responseSummary,
    toolCall.error,
    toolCall.approvalDecision,
    toolCall.assetCount > 0 ? toolCall.assetCount : null,
    toolCall.albumCount > 0 ? toolCall.albumCount : null,
    toolCall.resultSize,
  ].filter(Boolean).length;

const chooseNewestToolCallState = (
  existing: AgentToolCallResponseDto,
  incoming: AgentToolCallResponseDto,
): AgentToolCallResponseDto => {
  const existingRank = statusProgressRank[existing.status] ?? 0;
  const incomingRank = statusProgressRank[incoming.status] ?? 0;

  if (incomingRank > existingRank) {
    return incoming;
  }

  if (incomingRank < existingRank) {
    return existing;
  }

  const incomingTime = getToolCallActivityTime(incoming);
  const existingTime = getToolCallActivityTime(existing);

  if (incomingTime > existingTime) {
    return incoming;
  }

  if (incomingTime < existingTime) {
    return existing;
  }

  return getToolCallDetailScore(incoming) > getToolCallDetailScore(existing) ? incoming : existing;
};

export const mergeAgentTimelineToolCalls = (
  previousToolCalls: AgentToolCallResponseDto[],
  incomingToolCalls: AgentToolCallResponseDto[],
  sessionId: string,
) => {
  const toolCallsById = new Map<string, AgentToolCallResponseDto>();

  for (const toolCall of previousToolCalls) {
    if (toolCall.sessionId === sessionId) {
      toolCallsById.set(toolCall.id, toolCall);
    }
  }

  for (const toolCall of incomingToolCalls) {
    if (toolCall.sessionId !== sessionId) {
      continue;
    }

    const existing = toolCallsById.get(toolCall.id);
    toolCallsById.set(toolCall.id, existing ? chooseNewestToolCallState(existing, toolCall) : toolCall);
  }

  return [...toolCallsById.values()].sort(compareToolCalls);
};

export const areAgentTimelineToolCallListsEquivalent = (
  firstToolCalls: AgentToolCallResponseDto[],
  secondToolCalls: AgentToolCallResponseDto[],
) =>
  firstToolCalls.length === secondToolCalls.length &&
  firstToolCalls.every(
    (toolCall, index) => getToolCallStateKey(toolCall) === getToolCallStateKey(secondToolCalls[index]),
  );
```

- [x] **Step 4: Run helper tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts'
```

Expected green result:

- Helper tests pass.
- Same-time terminal refreshes without details preserve the richer existing row.

## Task 2: Publish Timeline-Relevant Tool Calls From The Action Dock

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`

- [x] **Step 1: Add failing unit coverage for timeline tool calls**

In `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`, update the import to include `getTimelineToolCalls`, then add this test after the existing `groups handled calls as recent` test:

```ts
it('groups all timeline-relevant calls for activity rendering', () => {
  const calls = [
    toolCall({ id: 'pending', status: AgentToolCallStatus.PendingApproval, startedAt: '2026-05-16T10:00:00.000Z' }),
    toolCall({ id: 'approved', status: AgentToolCallStatus.Approved, startedAt: '2026-05-16T10:00:01.000Z' }),
    toolCall({ id: 'executing', status: AgentToolCallStatus.Executing, startedAt: '2026-05-16T10:00:02.000Z' }),
    toolCall({ id: 'completed', status: AgentToolCallStatus.Completed, startedAt: '2026-05-16T10:00:03.000Z' }),
    toolCall({ id: 'failed', status: AgentToolCallStatus.Failed, startedAt: '2026-05-16T10:00:04.000Z' }),
    toolCall({ id: 'denied', status: AgentToolCallStatus.Denied, startedAt: '2026-05-16T10:00:05.000Z' }),
  ];

  expect(getTimelineToolCalls(calls).map(({ id }) => id)).toEqual([
    'pending',
    'approved',
    'executing',
    'completed',
    'failed',
    'denied',
  ]);
});
```

- [x] **Step 2: Add failing action dock coverage for executing tool publishing**

In `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`, add this test near `publishes completed tool calls after a polling refresh`:

```ts
it('publishes executing tool calls to the chat timeline while polling', async () => {
  const onRecentToolCallsChange = vi.fn();
  sdkMock.getToolCalls.mockResolvedValue([
    toolCall({
      id: 'executing-tool',
      status: AgentToolCallStatus.Executing,
      responseSummary: null,
      completedAt: null,
    }),
  ]);

  render(AgentSessionActionDock, {
    props: { session: makeSession({ status: AgentSessionStatus.Running }), onRecentToolCallsChange },
  });

  await waitFor(() =>
    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'executing-tool', status: AgentToolCallStatus.Executing }),
    ]),
  );
});

it('republishes timeline tool calls when only verbose detail fields change', async () => {
  vi.useFakeTimers();
  const onRecentToolCallsChange = vi.fn();
  sdkMock.getToolCalls
    .mockResolvedValueOnce([
      toolCall({
        id: 'detail-tool',
        status: AgentToolCallStatus.Completed,
        responseSummary: 'Returned photos',
        assetCount: 0,
        completedAt: '2026-05-16T10:01:00.000Z',
      }),
    ])
    .mockResolvedValueOnce([
      toolCall({
        id: 'detail-tool',
        status: AgentToolCallStatus.Completed,
        requestSummary: 'Search photos with South Africa filters',
        responseSummary: 'Returned photos',
        assetCount: 4,
        completedAt: '2026-05-16T10:01:00.000Z',
        resultSize: {
          returnedItems: 4,
          hasMore: false,
          nextPage: null,
          estimatedBytes: 4096,
          truncated: false,
          omittedFields: [],
        },
      }),
    ]);

  render(AgentSessionActionDock, {
    props: { session: makeSession({ status: AgentSessionStatus.Running }), onRecentToolCallsChange },
  });
  await waitFor(() =>
    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'detail-tool', assetCount: 0 }),
    ]),
  );

  await vi.advanceTimersByTimeAsync(3000);

  await waitFor(() =>
    expect(onRecentToolCallsChange).toHaveBeenLastCalledWith([
      expect.objectContaining({
        id: 'detail-tool',
        assetCount: 4,
        resultSize: expect.objectContaining({ returnedItems: 4 }),
      }),
    ]),
  );
  vi.useRealTimers();
});
```

- [x] **Step 3: Run focused tests and verify red**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
```

Expected red result:

- `getTimelineToolCalls` is not exported.
- The action dock does not publish executing tool calls through `onRecentToolCallsChange`.
- The action dock does not republish same-status refreshes when only verbose/detail fields such as request summary, counts, or result size change.

- [x] **Step 4: Implement timeline tool-call publishing**

In `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`, add:

```ts
const timelineStatuses = new Set<AgentToolCallStatus>([
  AgentToolCallStatus.PendingApproval,
  AgentToolCallStatus.Approved,
  AgentToolCallStatus.Executing,
  AgentToolCallStatus.Completed,
  AgentToolCallStatus.Failed,
  AgentToolCallStatus.Denied,
]);
```

Then add:

```ts
export const getTimelineToolCalls = (toolCalls: AgentToolCallResponseDto[]) =>
  toolCalls
    .filter((toolCall) => timelineStatuses.has(toolCall.status))
    .sort((first, second) => first.startedAt.localeCompare(second.startedAt) || first.id.localeCompare(second.id));
```

In `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`, update the import:

```ts
import { areAgentTimelineToolCallListsEquivalent } from './agent-session-tool-call-state-ui';
import { buildToolApprovalPayload, getPendingToolCalls, getTimelineToolCalls } from './agent-tool-approval-ui';
```

Delete the local `toolCallStateKey` and `areToolCallListsEquivalent` helpers. Then update `setToolCalls` to use the shared equivalence helper:

```ts
const setToolCalls = (nextToolCalls: AgentToolCallResponseDto[]) => {
  if (areAgentTimelineToolCallListsEquivalent(toolCalls, nextToolCalls)) {
    return;
  }

  toolCalls = nextToolCalls;
  publishToolCallState(nextToolCalls);
};
```

Keep `publishToolCallState` using timeline calls:

```ts
const publishToolCallState = (nextToolCalls: AgentToolCallResponseDto[]) => {
  onPendingApprovalCountChange?.(getPendingToolCalls(nextToolCalls).length);
  onRecentToolCallsChange?.(getTimelineToolCalls(nextToolCalls));
};
```

Keep `getRecentToolCalls` exported because existing recent-history tests and callers still depend on it.

- [x] **Step 5: Run focused tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
```

Expected green result:

- Tool approval helper tests pass.
- Action dock tests pass.

## Task 3: Keep Chat Timeline Tool Rows Stable Across Refreshes

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [x] **Step 1: Add failing chat-panel refresh stability tests**

In `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`, add these tests near the existing activity refresh tests:

```ts
it('preserves expanded activity rows when a refresh temporarily omits tool calls', async () => {
  const seedMessages = [
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
      createdAt: '2026-05-16T10:59:00.000Z',
    },
  ];
  const initialToolCalls = makeToolBurst(8);
  const view = render(AgentSessionChatPanel, {
    props: {
      session,
      activityVisibilityMode: 'expanded',
      seedMessages,
      toolCalls: initialToolCalls,
    },
  });

  const initialActivity = await screen.findByRole('article', { name: 'Pi is working' });
  expect(initialActivity.querySelectorAll('[data-activity-row]')).toHaveLength(9);

  await view.rerender({
    session: { ...session, updatedAt: '2026-05-16T11:00:01.000Z' },
    activityVisibilityMode: 'expanded',
    seedMessages,
    toolCalls: [],
  });

  const refreshedActivity = screen.getByRole('article', { name: 'Pi is working' });
  expect(refreshedActivity.querySelectorAll('[data-activity-row]')).toHaveLength(9);
  expect(screen.queryByRole('article', { name: /Pi searched your photos/i })).not.toBeInTheDocument();
  expect(screen.queryByRole('article', { name: /Pi read photo details/i })).not.toBeInTheDocument();
});

it('updates an expanded tool row when polling advances its status', async () => {
  const seedMessages = [
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
  ];
  const runningToolCall = makeToolCall({
    id: 'stable-tool',
    status: AgentToolCallStatus.Executing,
    responseSummary: null,
    completedAt: null,
    startedAt: '2026-05-16T10:00:05.000Z',
  });
  const completedToolCall = {
    ...runningToolCall,
    status: AgentToolCallStatus.Completed,
    responseSummary: 'Found matching beach photos',
    completedAt: '2026-05-16T10:00:10.000Z',
  };
  const view = render(AgentSessionChatPanel, {
    props: { session, activityVisibilityMode: 'expanded', seedMessages, toolCalls: [runningToolCall] },
  });

  const runningActivity = await screen.findByRole('article', { name: 'Pi is working' });
  expect(runningActivity).toHaveTextContent('Running');

  await view.rerender({
    session,
    activityVisibilityMode: 'expanded',
    seedMessages,
    toolCalls: [completedToolCall],
  });

  const completedActivity = screen.getByRole('article', { name: 'Pi is working' });
  expect(completedActivity.querySelectorAll('[data-activity-row]')).toHaveLength(2);
  expect(completedActivity).toHaveTextContent('Done');
  expect(completedActivity).toHaveTextContent('Found matching beach photos');
});

it('keeps expanded activity row order stable when an equivalent polling refresh arrives reordered', async () => {
  const seedMessages = [
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
  ];
  const toolCalls = Array.from({ length: 5 }, (_, index) =>
    makeToolCall({
      id: `stable-tool-${index}`,
      toolName: AgentToolName.SearchAssets,
      responseSummary: `Result ${index}`,
      assetCount: index + 1,
      albumCount: 0,
      startedAt: `2026-05-16T10:00:0${index}.000Z`,
      completedAt: `2026-05-16T10:00:1${index}.000Z`,
    }),
  );
  const view = render(AgentSessionChatPanel, {
    props: { session, activityVisibilityMode: 'expanded', seedMessages, toolCalls },
  });

  const initialActivity = await screen.findByRole('article', { name: 'Pi is working' });
  const initialRows = Array.from(initialActivity.querySelectorAll('[data-activity-row]')).map((row) => row.textContent);

  await view.rerender({
    session,
    activityVisibilityMode: 'expanded',
    seedMessages,
    toolCalls: [...toolCalls].reverse(),
  });

  const refreshedActivity = screen.getByRole('article', { name: 'Pi is working' });
  expect(Array.from(refreshedActivity.querySelectorAll('[data-activity-row]')).map((row) => row.textContent)).toEqual(
    initialRows,
  );
});

it('does not regress a completed expanded tool row when an older polling response arrives later', async () => {
  const seedMessages = [
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find beach photos'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
  ];
  const completedToolCall = makeToolCall({
    id: 'stable-tool',
    status: AgentToolCallStatus.Completed,
    responseSummary: 'Found matching beach photos',
    completedAt: '2026-05-16T10:00:10.000Z',
    startedAt: '2026-05-16T10:00:05.000Z',
  });
  const staleRunningToolCall = {
    ...completedToolCall,
    status: AgentToolCallStatus.Executing,
    responseSummary: null,
    completedAt: null,
  };
  const view = render(AgentSessionChatPanel, {
    props: { session, activityVisibilityMode: 'expanded', seedMessages, toolCalls: [completedToolCall] },
  });

  expect(await screen.findByRole('article', { name: 'Pi is working' })).toHaveTextContent('Done');

  await view.rerender({
    session,
    activityVisibilityMode: 'expanded',
    seedMessages,
    toolCalls: [staleRunningToolCall],
  });

  const activity = screen.getByRole('article', { name: 'Pi is working' });
  expect(activity).toHaveTextContent('Done');
  expect(activity).not.toHaveTextContent('Running');
});

it('keeps current-turn activity after the assistant response arrives while tool calls are temporarily absent', async () => {
  const userMessage = {
    ...makeMessage('message-user', AgentMessageRole.User, 'List my albums'),
    createdAt: '2026-05-16T10:00:00.000Z',
  };
  const assistantMessage = {
    ...makeMessage('message-assistant', AgentMessageRole.Assistant, 'You have one album.'),
    createdAt: '2026-05-16T10:00:20.000Z',
  };
  const view = render(AgentSessionChatPanel, {
    props: {
      session,
      activityVisibilityMode: 'expanded',
      seedMessages: [userMessage],
      toolCalls: [
        makeToolCall({
          id: 'album-tool',
          startedAt: '2026-05-16T10:00:05.000Z',
          completedAt: '2026-05-16T10:00:06.000Z',
        }),
      ],
    },
  });

  expect(await screen.findByRole('article', { name: 'Pi is working' })).toHaveTextContent('Searching albums');

  await view.rerender({
    session: { ...session, status: AgentSessionStatus.Completed },
    activityVisibilityMode: 'expanded',
    seedMessages: [userMessage, assistantMessage],
    toolCalls: [],
  });

  const transcript = screen.getByTestId('agent-session-chat-transcript');
  expect(screen.getByRole('article', { name: 'Activity summary' })).toHaveTextContent('Searching albums');
  expect(screen.queryByRole('article', { name: /Pi checked your albums/i })).not.toBeInTheDocument();
  expect(Array.from(transcript.querySelectorAll('[data-chat-item]')).map((item) => item.textContent)).toEqual([
    expect.stringContaining('List my albums'),
    expect.stringContaining('Searching albums'),
    expect.stringContaining('You have one album.'),
  ]);
});

it('keeps preserved tool calls available when switching from compact to expanded during refresh', async () => {
  const seedMessages = [
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Find my South Africa photos'),
      createdAt: '2026-05-16T10:59:00.000Z',
    },
  ];
  const view = render(AgentSessionChatPanel, {
    props: {
      session,
      activityVisibilityMode: 'compact',
      seedMessages,
      toolCalls: makeToolBurst(8),
    },
  });

  const compactActivity = await screen.findByRole('article', { name: 'Pi is working' });
  expect(compactActivity.querySelectorAll('[data-activity-row]').length).toBeLessThan(8);

  await view.rerender({
    session,
    activityVisibilityMode: 'expanded',
    seedMessages,
    toolCalls: [],
  });

  expect(screen.getByRole('article', { name: 'Pi is working' }).querySelectorAll('[data-activity-row]')).toHaveLength(
    9,
  );
});

it('clears preserved tool calls when the selected session changes', async () => {
  const sessionTwo = { ...session, id: '00000000-0000-4000-8000-000000000200' };
  const view = render(AgentSessionChatPanel, {
    props: {
      session,
      activityVisibilityMode: 'expanded',
      seedMessages: [
        {
          ...makeMessage('message-user', AgentMessageRole.User, 'Find photos'),
          createdAt: '2026-05-16T10:00:00.000Z',
        },
      ],
      toolCalls: [
        makeToolCall({
          id: 'old-session-tool',
          responseSummary: 'Old session result',
          completedAt: '2026-05-16T10:00:10.000Z',
        }),
      ],
    },
  });

  expect(await screen.findByRole('article', { name: 'Pi is working' })).toHaveTextContent('Old session result');

  await view.rerender({
    session: sessionTwo,
    activityVisibilityMode: 'expanded',
    seedMessages: [
      {
        ...makeMessage('message-session-two', AgentMessageRole.User, 'Second session request', sessionTwo.id),
        createdAt: '2026-05-16T10:01:00.000Z',
      },
    ],
    toolCalls: [],
  });

  expect(screen.queryByText('Old session result')).not.toBeInTheDocument();
});
```

- [x] **Step 2: Run chat-panel tests and verify red**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected red result:

- Refresh omission tests fail because rows collapse when `toolCalls` becomes empty.
- Stale polling test fails because a completed row can regress to running when an older response is rendered.
- Visibility switch test fails because expanded mode has no preserved verbose rows when the refresh prop is empty.
- Equivalent reordered refresh tests fail if row ordering follows raw API order instead of stable timestamp and id ordering.

- [x] **Step 3: Use stable tool calls in `AgentSessionChatPanel.svelte`**

Add this import:

```ts
import {
  areAgentTimelineToolCallListsEquivalent,
  mergeAgentTimelineToolCalls,
} from './agent-session-tool-call-state-ui';
```

Add state near the existing local state:

```ts
let timelineToolCalls = $state<AgentToolCallResponseDto[]>([]);
let timelineToolCallSessionId = $state(session.id);
```

Replace each read of the raw `toolCalls` prop in derived timeline state with `timelineToolCalls`:

```ts
const latestActivityNeedingAssistantAt = $derived(
  [
    ...messages.filter((message) => message.role === AgentMessageRole.User).map((message) => message.createdAt),
    ...timelineToolCalls
      .filter((toolCall) => assistantContinuationToolStatuses.has(toolCall.status))
      .map((toolCall) => toolCall.completedAt ?? toolCall.startedAt),
  ]
    .sort()
    .at(-1) ?? null,
);
```

In `activityTurns`, pass `timelineToolCalls`:

```ts
toolCalls: timelineToolCalls,
```

In `chatTimelineItems`, pass `timelineToolCalls`:

```ts
buildChatTimelineItems(
  messages,
  timelineToolCalls,
  appliedPlans,
  activityTurns,
  coveredToolCallIds,
  activityVisibilityMode,
  messagesLoaded || messages.length > 0,
),
```

Add this effect before the existing `seedMessages` effect:

```ts
$effect(() => {
  const nextToolCalls = mergeAgentTimelineToolCalls(
    timelineToolCallSessionId === session.id ? timelineToolCalls : [],
    toolCalls,
    session.id,
  );

  timelineToolCallSessionId = session.id;

  if (!areAgentTimelineToolCallListsEquivalent(timelineToolCalls, nextToolCalls)) {
    timelineToolCalls = nextToolCalls;
  }
});
```

This effect keeps previously observed tool calls for the active session, merges status advances, rejects older status regressions, and drops preserved state when `session.id` changes.

- [x] **Step 4: Run chat-panel tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected green result:

- Chat panel tests pass.
- New tests show stable activity rows across omitted/stale refreshes and session changes.

## Task 4: Integration Verification And Commit Slice 3

**Files:**

- Review all Slice 3 files listed above.

- [x] **Step 1: Run affected assistant tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-session-action-dock.spec.ts' \
  'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' \
  'src/routes/(user)/assistant/agent-activity-block.spec.ts' \
  'src/routes/(user)/assistant/agent-activity-ui.spec.ts'
```

Expected green result:

- Stable tool-call helper tests pass.
- Tool approval helper tests pass.
- Action dock tests pass.
- Chat panel tests pass.
- Activity block and activity model tests still pass.

- [x] **Step 2: Run web checks**

Run:

```bash
pnpm --filter immich-web run check:svelte
pnpm --filter immich-web run check:typescript
```

Expected green result:

- Svelte check passes with 0 errors and 0 warnings.
- TypeScript check passes.

- [x] **Step 3: Check diff scope**

Run:

```bash
git diff -- web/src/routes/\(user\)/assistant/agent-session-tool-call-state-ui.ts \
  web/src/routes/\(user\)/assistant/agent-session-tool-call-state-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-tool-approval-ui.ts \
  web/src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-action-dock.svelte \
  web/src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-3.md
git diff --check
```

Expected:

- Only Slice 3 files are changed.
- No whitespace errors.
- No Slice 4 polish, browser-level QA checklist, or styling-only work is included.

- [x] **Step 4: Commit**

Run:

```bash
git add web/src/routes/\(user\)/assistant/agent-session-tool-call-state-ui.ts \
  web/src/routes/\(user\)/assistant/agent-session-tool-call-state-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-tool-approval-ui.ts \
  web/src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-action-dock.svelte \
  web/src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-3.md
git commit -m "fix: stabilize Pi activity during tool refreshes"
```

Expected:

- Commit succeeds.
- Working tree is clean after commit.

## Plan Review Checklist

- TDD is explicit for each behavior:
  - helper tests are written before creating the helper;
  - action dock publishing tests are written before changing publishing;
  - chat panel refresh stability tests are written before using preserved timeline state.
- Every Slice 3 spec test is represented:
  - messages after tool calls do not flash raw fallback cards;
  - equivalent refreshes keep the activity block stable;
  - status changes update the existing row;
  - stale older responses do not regress completed rows;
  - assistant completion does not remove current-turn activity while tool calls are temporarily absent.
- Every Slice 3 edge case is represented:
  - messages fail or are not loaded while tool calls exist through existing loading suppression tests;
  - a refresh temporarily omits tool calls;
  - session id changes while preserved state exists;
  - activity visibility changes from compact to expanded while the latest refresh prop is empty.
- Scope is limited to refresh stability and timeline publication. Slice 4 polish, redaction QA, reduced-motion checks, and manual browser checklist work stay out of this slice.
