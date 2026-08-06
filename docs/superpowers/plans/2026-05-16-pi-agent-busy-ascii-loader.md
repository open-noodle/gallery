# Pi Agent Busy ASCII Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a small ASCII-style assistant busy indicator while the agent is working but has not streamed visible response text yet.

**Architecture:** Keep this as a narrow chat-panel UI state change. `AgentSessionChatPanel` already has the relevant state boundaries: `isSending`, `isAssistantActive`, `streamingText`, websocket deltas, completion, errors, and terminal session status. Add a derived `showAssistantBusyIndicator` state and render one assistant-side status row only when work is active and no streamed text is visible.

**Tech Stack:** Svelte 5, Svelte Testing Library, Vitest, existing Gallery assistant websocket event mocks.

---

## Files

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
  - Add a derived busy indicator state.
  - Render a compact assistant-side monospace ASCII loading row.
  - Keep layout aligned with existing assistant messages and streaming response cards.
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
  - Add failing tests before implementation.
  - Cover send-in-flight, waiting-for-first-delta, delta replacement, completion cleanup, error cleanup, and terminal status cleanup.
- Modify: `i18n/en.json`
  - Add a concise accessible/status string for the busy row, if the component should use translation instead of a literal test-only string.

## UX Decision

Use plain ASCII text, no icon and no card-heavy treatment:

```text
pi is working...
```

Render it in a subtle assistant-side row:

- `role="status"`
- `aria-live="polite"`
- monospace text
- assistant alignment (`mr-auto`)
- no large technical metadata
- visible only while the user is waiting for the first assistant text

Behavior:

- Show immediately after the user submits a non-empty message, including while `appendAgentSessionMessage()` is still pending.
- Keep showing after the user message append resolves and the agent is running but before the first `assistant-message-delta`.
- Hide as soon as `streamingText` has content.
- Hide when `assistant-message-created`, `runner-error`, or a terminal session status clears active streaming.
- Do not show when there is already streamed response text; the text itself is the activity indicator.

## Task 1: Add Tests For The Busy Indicator Lifecycle

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Add the translation test fixture string**

In the `vi.mock('svelte-i18n')` messages map, add:

```ts
assistant_busy_ascii: 'pi is working...',
```

- [ ] **Step 2: Write the failing test for immediate feedback while append is pending**

Add this test near `does not submit duplicate messages while a send is in progress`:

```ts
it('shows an ASCII busy indicator immediately while sending the user message', async () => {
  sdkMock.appendAgentSessionMessage.mockReturnValue(new Promise(() => undefined));

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Organize this album' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByRole('status')).toHaveTextContent('pi is working...');
  expect(input).toBeDisabled();
});
```

- [ ] **Step 3: Run the single test and verify RED**

Run:

```bash
pnpm --dir web test 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' -- --runInBand
```

Expected: FAIL because no `role="status"` busy row exists after submit.

- [ ] **Step 4: Write the failing test for waiting after append resolves**

Add:

```ts
it('keeps the ASCII busy indicator after send succeeds while waiting for the first assistant delta', async () => {
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Organize screenshots'),
  );

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Organize screenshots' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByText('Organize screenshots')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('pi is working...');
});
```

Expected: FAIL until the new indicator uses `isAssistantActive && !streamingText`.

- [ ] **Step 5: Write the failing test for replacing busy state with streamed text**

Add:

```ts
it('replaces the ASCII busy indicator with streamed assistant text on the first delta', async () => {
  let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
  websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
    handler = nextHandler;
    return vi.fn();
  });
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Start organizing'),
  );

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Start organizing' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(await screen.findByRole('status')).toHaveTextContent('pi is working...');

  handler?.({
    type: 'assistant-message-delta',
    sessionId: session.id,
    delta: 'I found',
    sequence: 1,
    createdAt: '2026-05-14T00:00:01.000Z',
  });

  expect(await screen.findByText('I found')).toBeInTheDocument();
  expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
});
```

Expected: FAIL until the indicator is hidden when `streamingText` is non-empty.

- [ ] **Step 6: Write the failing cleanup tests**

Add:

```ts
it('clears the ASCII busy indicator when the assistant message completes before any delta', async () => {
  let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
  websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
    handler = nextHandler;
    return vi.fn();
  });
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Make an album'),
  );

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Make an album' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent('pi is working...');

  handler?.({
    type: 'assistant-message-created',
    sessionId: session.id,
    message: makeMessage('message-assistant-created', AgentMessageRole.Assistant, 'Done.'),
    createdAt: '2026-05-14T00:00:02.000Z',
  });

  expect(await screen.findByText('Done.')).toBeInTheDocument();
  expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
});

it('clears the ASCII busy indicator when the runner reports an error before any delta', async () => {
  let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
  websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
    handler = nextHandler;
    return vi.fn();
  });
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Make an album'),
  );

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Make an album' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent('pi is working...');

  handler?.({
    type: 'runner-error',
    sessionId: session.id,
    message: 'Runner failed',
    createdAt: '2026-05-14T00:00:02.000Z',
  });

  expect(await screen.findByRole('alert')).toHaveTextContent('Runner failed');
  expect(screen.queryByText('pi is working...')).not.toBeInTheDocument();
});
```

Expected: FAIL until `assistant-message-created` and `runner-error` clear the indicator through existing `isAssistantActive` cleanup.

## Task 2: Implement The Minimal Busy Indicator

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add a derived state**

In `agent-session-chat-panel.svelte`, next to `canSend`, add:

```ts
const showAssistantBusyIndicator = $derived((isSending || isAssistantActive) && streamingText.length === 0);
```

- [ ] **Step 2: Set assistant active immediately on submit**

In `sendMessage`, after `isSending = true;` and `errorMessage = null;`, add:

```ts
isAssistantActive = true;
```

Keep the existing catch cleanup:

```ts
isAssistantActive = false;
```

This makes the indicator visible while the append request is pending. It also preserves the current disabled-composer behavior while the agent is active.

- [ ] **Step 3: Render the ASCII indicator before streamed text**

In the transcript area, before the `{#if streamingText}` block, add:

```svelte
{#if showAssistantBusyIndicator}
  <article
    class="mr-auto max-w-[80%] px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400"
    role="status"
    aria-live="polite"
  >
    {$t('assistant_busy_ascii')}
  </article>
{/if}
```

- [ ] **Step 4: Add English copy**

In `i18n/en.json`, add:

```json
"assistant_busy_ascii": "pi is working..."
```

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
pnpm --dir web test 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' -- --runInBand
```

Expected: PASS, including all new busy indicator lifecycle tests.

## Task 3: Edge Case Coverage And Polish

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Add terminal-status cleanup test for busy-without-delta**

Add a variant of the existing terminal cleanup test that starts from a sent message rather than a delta:

```ts
it('clears the ASCII busy indicator when the session becomes terminal before any assistant text streams', async () => {
  sdkMock.appendAgentSessionMessage.mockResolvedValue(
    makeMessage('message-created', AgentMessageRole.User, 'Start task'),
  );

  const { rerender } = render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Start task' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByRole('status')).toHaveTextContent('pi is working...');

  await rerender({ session: { ...session, status: AgentSessionStatus.Cancelled } });

  await waitFor(() => expect(screen.queryByText('pi is working...')).not.toBeInTheDocument());
  expect(input).not.toBeDisabled();
});
```

- [ ] **Step 2: Verify no duplicate status rows when `isSending` and `isAssistantActive` overlap**

Add:

```ts
it('renders only one ASCII busy indicator while send and assistant activity overlap', async () => {
  let resolveSend: (message: AgentMessageResponseDto) => void;
  sdkMock.appendAgentSessionMessage.mockReturnValue(
    new Promise<AgentMessageResponseDto>((resolve) => {
      resolveSend = resolve;
    }),
  );

  render(AgentSessionChatPanel, { props: { session } });

  const input = await screen.findByRole('textbox', { name: 'Message' });
  await fireEvent.input(input, { target: { value: 'Start task' } });
  await fireEvent.click(screen.getByRole('button', { name: 'Send' }));

  expect(screen.getAllByText('pi is working...')).toHaveLength(1);

  resolveSend!(makeMessage('message-created', AgentMessageRole.User, 'Start task'));
  await tick();

  expect(screen.getAllByText('pi is working...')).toHaveLength(1);
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
pnpm --dir web test 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Run the workspace assistant tests if the chat panel is embedded there**

Run:

```bash
pnpm --dir web test 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts' 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts' -- --runInBand
```

Expected: PASS.

## Task 4: Final Verification

**Files:**

- No new files.

- [ ] **Step 1: Run web typecheck or existing web check command**

Run the repo’s established web verification command. If the command is not obvious, inspect `web/package.json` scripts first:

```bash
cat web/package.json | rg '"(check|lint|test)"'
```

Then run the appropriate check, likely:

```bash
pnpm --dir web check
```

Expected: PASS.

- [ ] **Step 2: Manual visual sanity check**

Start the dev server if needed and open Assistant:

```bash
make dev
```

Manual checks:

- Empty chat: no busy row before sending.
- Click Send: `pi is working...` appears in the conversation area, aligned like an assistant response.
- First streamed text: ASCII row disappears and streamed text appears.
- Completion: final assistant message remains, ASCII row is gone.
- Error: error alert appears, ASCII row is gone.

## Self-Review

- TDD coverage is explicit: every behavior starts with a failing test and expected RED/GREEN commands.
- Edge cases covered: send pending, append resolved/no delta yet, first delta replacement, completion before delta, error before delta, terminal status before delta, duplicate prevention.
- Scope is narrow: no runner/server changes, no model/provider settings changes, no broader assistant layout refactor.
- Design is consistent with the current ChatGPT-like UI direction: quiet, text-first, not technical, no extra setup card.
