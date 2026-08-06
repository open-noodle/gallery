# Pi Agent Expanded Activity Debug Slice 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Finish expanded activity debug mode with focused accessibility, redaction, reduced-motion, large-stream verification, and a manual QA checklist for the original flicker symptom.

**Architecture:** Keep behavior changes narrow. Add component/integration tests around the existing `AgentActivityBlock.svelte` and `AgentSessionChatPanel.svelte` surfaces, implement only the reduced-motion guard needed by those tests, and add a small manual QA document. Do not redesign activity cards or change timeline/session semantics from Slices 1-3.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library for Svelte, existing assistant activity UI modules.

---

## Spec Reference

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-expanded-activity-debug-design.md`

Slice 4 requirements:

- Finalize copy for expanded debug mode if needed.
- Verify large-row behavior in browser-level/component tests.
- Preserve redaction and accessibility.
- Add a focused manual QA checklist for the production symptom.
- TDD is required: write failing tests first, confirm red, implement the smallest fix, then confirm green.

## Files

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Create: `docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md`
- Modify: `docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-4.md`

## Task 1: Add Activity Block Accessibility And Large-Stream Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

- [x] **Step 1: Add an accessibility relationship test**

In `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`, add this test after `renders verbose rows only in expanded mode`:

```ts
it('connects expanded activity controls to live status and technical detail regions', async () => {
  render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel(
        [
          activityItem({
            id: 'metadata',
            title: 'Reading photo details',
            status: 'running',
            technical: {
              toolName: 'readAssetMetadata',
              toolCallIds: ['tool-call-1'],
              requestSummary: 'Read selected metadata',
            },
          }),
        ],
        [
          activityItem({
            id: 'metadata',
            title: 'Reading photo details',
            status: 'running',
            technical: {
              toolName: 'readAssetMetadata',
              toolCallIds: ['tool-call-1'],
              requestSummary: 'Read selected metadata',
            },
          }),
        ],
      ),
    },
  });

  const block = screen.getByRole('article', { name: 'Pi is working' });
  const activityToggle = within(block).getByRole('button', { name: 'Hide activity' });
  const rowsId = activityToggle.getAttribute('aria-controls');
  expect(rowsId).toBeTruthy();
  expect(document.getElementById(rowsId!)).toHaveAttribute('role', 'status');

  const technicalToggle = within(block).getByRole('button', { name: 'Technical details' });
  const technicalDetailsId = technicalToggle.getAttribute('aria-controls');
  expect(technicalToggle).toHaveAttribute('aria-expanded', 'false');
  expect(technicalDetailsId).toBeTruthy();
  expect(document.getElementById(technicalDetailsId!)).not.toBeInTheDocument();

  await fireEvent.click(technicalToggle);

  expect(within(block).getByRole('button', { name: 'Hide technical details' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  expect(document.getElementById(technicalDetailsId!)).toBeInTheDocument();
});
```

- [x] **Step 2: Add a focus-preservation live-update test**

Add this test after the accessibility relationship test:

```ts
it('does not steal focus when active expanded rows update in place', async () => {
  const view = render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel(
        [activityItem({ id: 'metadata', title: 'Reading photo details', status: 'running' })],
        [activityItem({ id: 'metadata', title: 'Reading photo details', status: 'running' })],
      ),
    },
  });

  const hideActivityButton = screen.getByRole('button', { name: 'Hide activity' });
  hideActivityButton.focus();

  await view.rerender({
    visibilityMode: 'expanded',
    model: activityModel(
      [activityItem({ id: 'metadata', title: 'Reading photo details', status: 'completed', summary: 'Read details' })],
      [activityItem({ id: 'metadata', title: 'Reading photo details', status: 'completed', summary: 'Read details' })],
    ),
  });

  expect(screen.getByRole('button', { name: 'Hide activity' })).toHaveFocus();
});
```

- [x] **Step 3: Add a 1,000+ row bounded DOM test**

Add this test after `keeps all-terminal expanded streams bounded and inspectable`:

```ts
it('keeps one-thousand-plus expanded streams bounded while exposing paging controls', async () => {
  const verboseItems = verboseActivityItems(1001);
  const { container } = render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([activityItem({ id: 'compact', title: 'Searching photos' })], verboseItems),
    },
  });

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(100);
  expect(screen.getByText('Showing 100 of 1001 actions')).toBeInTheDocument();
  expect(screen.getByText('Verbose activity 1000')).toBeInTheDocument();
  expect(screen.queryByText('Verbose activity 0')).not.toBeInTheDocument();

  await fireEvent.click(screen.getByRole('button', { name: 'Show older activity' }));

  expect(container.querySelectorAll('[data-activity-row]')).toHaveLength(100);
  expect(screen.getByText('Verbose activity 801')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show older activity' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show newer activity' })).toBeInTheDocument();
});
```

- [x] **Step 4: Add an expanded long-summary safety test**

Add this test near the existing `renders long row labels without exposing technical text` test:

```ts
it('renders expanded long summaries without exposing hidden technical text', async () => {
  const longText =
    'Reading photo details for a very long generated album workflow that should wrap cleanly across narrow viewports';

  render(AgentActivityBlock, {
    props: {
      visibilityMode: 'expanded',
      model: activityModel([
        activityItem({
          id: 'long-expanded',
          title: longText,
          summary: `${longText} summary`,
          technical: {
            error: 'secret raw technical detail',
          },
        }),
      ]),
    },
  });

  const block = screen.getByRole('article', { name: 'Activity summary' });
  expect(block).toHaveTextContent(longText);
  expect(block).not.toHaveTextContent('secret raw technical detail');

  await fireEvent.click(screen.getByRole('button', { name: 'Technical details' }));

  expect(block).toHaveTextContent('secret raw technical detail');
});
```

- [x] **Step 5: Run focused activity block tests and verify expected red/green behavior**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-activity-block.spec.ts'
```

Expected result:

- These tests may already pass because Slices 1-3 built most of the behavior.
- If a new test fails, implement the smallest accessibility or class/attribute fix in `AgentActivityBlock.svelte`, then rerun the same command.

Execution evidence:

- 2026-05-22: Passed before additional component changes; prior slices already satisfied the added accessibility, focus, large-stream, and long-summary tests. Command output: 1 file passed, 26 tests passed.

## Task 2: Add Rendered Redaction And Reduced-Motion Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [x] **Step 1: Add missing mocked translation labels**

In the `svelte-i18n` mock `messages` object in `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`, add these keys near the existing `assistant_activity_technical_*` keys:

```ts
assistant_activity_show_newer: 'Show newer activity',
assistant_activity_show_older: 'Show older activity',
assistant_activity_technical_albums: 'Albums',
assistant_activity_technical_assets: 'Assets',
assistant_activity_technical_completed: 'Completed at',
assistant_activity_technical_error: 'Error',
assistant_activity_technical_request: 'Request summary',
assistant_activity_technical_response: 'Response summary',
assistant_activity_technical_started: 'Started at',
assistant_activity_technical_tool: 'Tool name',
assistant_activity_technical_tool_call: 'Tool call ID',
assistant_activity_technical_tool_calls: 'Tool call IDs',
assistant_activity_window_summary: 'Showing {visible} of {total} actions',
```

Replace the mock `t` helper with a generic interpolation helper so `{visible}` and `{total}` work:

```ts
t: readable((key: string, options?: { values?: Record<string, string | number> }) => {
  let message = messages[key] ?? key;

  for (const [name, value] of Object.entries(options?.values ?? {})) {
    message = message.replaceAll(`{${name}}`, String(value));
  }

  return message;
}),
```

- [x] **Step 2: Add a rendered expanded redaction test**

Add this test near the existing activity/redaction tests:

```ts
it('renders expanded technical details with secrets redacted', async () => {
  sdkMock.getAgentSessionMessages.mockResolvedValue([
    {
      ...makeMessage('message-user', AgentMessageRole.User, 'Inspect private metadata'),
      createdAt: '2026-05-16T10:00:00.000Z',
    },
  ]);

  render(AgentSessionChatPanel, {
    props: {
      session: { ...session, status: AgentSessionStatus.Completed },
      activityVisibilityMode: 'expanded',
      toolCalls: [
        makeToolCall({
          id: 'secret-tool',
          toolName: AgentToolName.ReadAssetMetadata,
          status: AgentToolCallStatus.Failed,
          requestSummary: 'Read metadata with api_key=abc123 and Bearer bearer-secret',
          responseSummary: null,
          error: 'Provider failed with token=plain-token and sk-proj-provider-secret',
          completedAt: '2026-05-16T10:00:06.000Z',
        }),
      ],
    },
  });

  const activity = await screen.findByRole('article', { name: 'Activity summary' });
  await fireEvent.click(within(activity).getByRole('button', { name: 'Technical details' }));

  expect(activity).toHaveTextContent('Request summary');
  expect(activity).toHaveTextContent('Read metadata with api_key=[redacted] and Bearer [redacted]');
  expect(activity).toHaveTextContent('Provider failed with token=[redacted] and [redacted]');
  expect(activity).not.toHaveTextContent('abc123');
  expect(activity).not.toHaveTextContent('bearer-secret');
  expect(activity).not.toHaveTextContent('plain-token');
  expect(activity).not.toHaveTextContent('sk-proj-provider-secret');
});
```

- [x] **Step 3: Add reduced-motion tests for the fallback busy indicator**

Add these helpers near the top-level test helpers in `agent-session-chat-panel.spec.ts`:

```ts
const mockReducedMotion = (matches: boolean) => {
  const originalMatchMedia = globalThis.matchMedia;
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

  Object.defineProperty(globalThis, 'matchMedia', {
    configurable: true,
    value: matchMedia,
  });

  return () => {
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: originalMatchMedia,
    });
  };
};
```

Add these tests near the existing ASCII busy indicator tests:

```ts
it('keeps the fallback busy indicator static when reduced motion is preferred', async () => {
  vi.useFakeTimers();
  const restoreReducedMotion = mockReducedMotion(true);

  try {
    render(AgentSessionChatPanel, {
      props: {
        session,
        assistantResponsePending: true,
        activityVisibilityMode: 'off',
      },
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('pi is working... -');

    vi.advanceTimersByTime(160);
    await tick();

    expect(status).toHaveTextContent('pi is working... -');
  } finally {
    restoreReducedMotion();
    vi.useRealTimers();
  }
});

it('animates the fallback busy indicator when reduced motion is not preferred', async () => {
  vi.useFakeTimers();
  const restoreReducedMotion = mockReducedMotion(false);

  try {
    render(AgentSessionChatPanel, {
      props: {
        session,
        assistantResponsePending: true,
        activityVisibilityMode: 'off',
      },
    });

    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent('pi is working... -');

    vi.advanceTimersByTime(160);
    await tick();

    expect(status).not.toHaveTextContent('pi is working... -');
  } finally {
    restoreReducedMotion();
    vi.useRealTimers();
  }
});
```

- [x] **Step 4: Run chat-panel tests and verify expected red failure**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected red result:

- The reduced-motion static test fails because the busy indicator currently advances frames even when `prefers-reduced-motion: reduce` matches.
- The redaction test should pass if existing activity redaction is correctly wired through rendered expanded technical details.

Execution evidence:

- 2026-05-22: Initial `640ms` assertion passed before implementation because it completed a full four-frame animation cycle. The test was corrected to advance one `160ms` frame.
- 2026-05-22: With the reduced-motion guard temporarily removed, the corrected test failed as expected: received `pi is working... \` instead of `pi is working... -`.

- [x] **Step 5: Implement reduced-motion guard**

In `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`, add this helper near `const busyFrame`:

```ts
const prefersReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
```

Then update the busy-frame effect:

```ts
$effect(() => {
  if (!showAssistantBusyIndicator || prefersReducedMotion()) {
    busyFrameIndex = 0;
    return;
  }

  const interval = globalThis.setInterval(() => {
    busyFrameIndex = (busyFrameIndex + 1) % busyFrames.length;
  }, 160);

  return () => globalThis.clearInterval(interval);
});
```

- [x] **Step 6: Run chat-panel tests and verify green**

Run:

```bash
pnpm --filter immich-web exec vitest run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected green result:

- Chat panel tests pass.
- Reduced-motion busy indicator stays static.
- Non-reduced-motion busy indicator still animates.
- Rendered expanded technical details redact secret-like strings.

Execution evidence:

- 2026-05-22: Passed after reduced-motion guard; 1 file passed, 88 tests passed.

## Task 3: Add Manual QA Checklist

**Files:**

- Create: `docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md`

- [x] **Step 1: Create the manual QA document**

Create `docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md`:

```md
# Pi Expanded Activity Debug Manual QA

## Purpose

Verify that `Activity preview: Expanded` behaves as a stable debug/audit mode while Pi runs many tool calls.

## Setup

- Run Gallery with the Pi runner enabled.
- Open a session that can make several MCP/tool calls.
- Open the browser network tab and filter for `tool-calls`.

## Checklist

1. Set `Activity preview` to `Expanded`.
2. Send a prompt that causes many tool calls, such as finding photos across people, dates, locations, and album changes.
3. Watch repeated `200` responses from `/tool-calls`.
4. Confirm activity rows do not flicker back to only `Understanding request` or `Preparing a plan`.
5. Confirm repeated tool calls remain visible as individual rows or are inspectable through `Show older activity` and `Show newer activity`.
6. Expand `Technical details` on a few rows and confirm tool names, ids, counts, result sizes, and timestamps are present.
7. Confirm API keys, bearer tokens, runner tokens, provider keys, hidden prompts, and reasoning-like text are redacted.
8. Switch to `Compact` and confirm the same turn becomes a low-noise summarized view.
9. Switch to `Off` and confirm passive activity hides while approval requests, plan reviews, applied plans, user messages, and assistant messages remain visible.
10. With browser reduced-motion emulation enabled, confirm the fallback `pi is working...` indicator does not animate.
11. On a narrow/mobile viewport, confirm paging controls and technical detail buttons remain reachable and do not overlap the composer.

## Expected Result

Expanded mode remains stable and inspectable for the full run. Compact mode stays calm. Off mode hides only passive activity. No raw fallback tool cards flash for tool calls already represented by activity rows.
```

- [x] **Step 2: Verify the QA document is present**

Run:

```bash
test -f docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md
```

Expected green result:

- Command exits 0.

Execution evidence:

- 2026-05-22: `test -f docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md` exited 0.

## Task 4: Integration Verification And Commit Slice 4

**Files:**

- Review: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Review: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Review: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Review: `docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md`
- Review: `docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-4.md`

- [x] **Step 1: Run affected assistant tests**

Run:

```bash
pnpm --filter immich-web exec vitest run \
  'src/routes/(user)/assistant/agent-activity-block.spec.ts' \
  'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' \
  'src/routes/(user)/assistant/agent-activity-ui.spec.ts' \
  'src/routes/(user)/assistant/agent-session-tool-call-state-ui.spec.ts'
```

Expected green result:

- Activity block tests pass.
- Chat panel tests pass.
- Activity redaction/model tests pass.
- Tool-call state tests pass.

Execution evidence:

- 2026-05-22: Combined affected assistant Vitest command passed; 4 files passed, 164 tests passed.

- [x] **Step 2: Run web checks**

Run:

```bash
pnpm --filter immich-web run check:svelte
pnpm --filter immich-web run check:typescript
```

Expected green result:

- Svelte check passes with 0 errors and 0 warnings.
- TypeScript check passes.

Execution evidence:

- 2026-05-22: `check:svelte` passed with 0 errors and 0 warnings.
- 2026-05-22: `check:typescript` completed successfully.

- [x] **Step 3: Check diff scope**

Run:

```bash
git diff -- web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-4.md
git diff --check
```

Expected:

- Only Slice 4 files are changed.
- No whitespace errors.
- No session lifecycle, MCP server, or runner backend changes are included.

Execution evidence:

- 2026-05-22: Scoped diff/status showed only the Slice 4 files from this plan, including the new QA document and plan file.
- 2026-05-22: `git diff --check` exited 0.

- [x] **Step 4: Commit**

Run:

```bash
git add web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte \
  web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts \
  docs/superpowers/qa/2026-05-22-pi-agent-expanded-activity-debug.md \
  docs/superpowers/plans/2026-05-22-pi-agent-expanded-activity-debug-slice-4.md
git commit -m "test: verify Pi expanded activity polish"
```

Expected:

- Commit succeeds.
- Working tree is clean after commit.

Execution evidence:

- 2026-05-22: Commit succeeded with message `test: verify Pi expanded activity polish`; use `git rev-parse --short HEAD` after commit/amend for the final hash.

## Plan Review Checklist

- TDD is explicit:
  - activity block tests are added before any component fix;
  - chat-panel redaction and reduced-motion tests are added before the reduced-motion guard;
  - manual QA doc is verified with a command.
- Every Slice 4 spec test is represented:
  - accessible names/status text and aria relationships;
  - live updates do not steal focus;
  - redaction applies to rendered expanded technical rows;
  - reduced-motion preference stops fallback busy animation;
  - large activity data stays bounded and inspectable through paging.
- Every Slice 4 edge case is represented:
  - 1,000+ rows;
  - very long summaries;
  - secret-like strings in request/error details;
  - dark/high-contrast readable classes remain covered by existing class usage and no styling changes;
  - narrow/mobile viewport overlap is covered by the manual QA checklist because jsdom cannot reliably validate responsive layout.
- Scope does not alter session lifecycle, runner execution, MCP behavior, or Slice 3 timeline semantics.
