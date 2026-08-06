# Pi Agent Activity Transparency Slice 4 Live Updates And Coalescing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Make the activity preview update in place while Pi works by wiring existing websocket events, tool-call refreshes, plan refreshes, applied-plan refreshes, streaming deltas, and polling into the Slice 1-3 activity block without duplicating chat rows or showing technical logs.

**Architecture:** This is a frontend integration and race-hardening slice. It keeps the derived-activity approach from the design spec and does not introduce explicit backend activity events. `AgentSessionChatPanel` should own current-plan and applied-plan refresh state for activity rendering. `AgentSessionActionDock` remains the source of refreshed tool-call state and publishes recent tool calls to `AgentConversationPane`, which passes them into the chat panel. The activity block keeps one stable timeline item for the active turn and re-renders from updated derived inputs.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, fake SDK mocks, websocket mock, generated `@immich/sdk` DTO types, existing assistant route test patterns.

---

## Source Spec

Implements Slice 4 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-2-chat-activity-block.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-3-session-activity-visibility-controls.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`

## Scope

In scope:

- Add failing tests first for live activity updates and coalescing.
- Update `AgentSessionChatPanel` so `operation-plan-ready` loads the current plan and passes it to `buildAgentActivityModel`.
- Keep `operation-plan-applied` loading applied plan history, clearing stale current-plan activity when needed, and deduping repeated applied-plan events.
- Ensure assistant streaming deltas update a single existing activity block with `Writing response` while streamed assistant text still renders normally.
- Ensure assistant message creation clears the live writing row and appends the final assistant message without leaving a stale active row.
- Harden tool-call refresh integration through `AgentSessionActionDock`:
  - websocket events trigger a quiet tool-call refresh;
  - polling changes a running row to completed when the server state changes;
  - duplicate REST/websocket arrivals do not duplicate rows;
  - stale refresh responses after a newer refresh are ignored;
  - late refresh responses after destroy/session switch are ignored.
- Ensure the chat panel continues to suppress current-turn handled tool-call cards while the activity block updates.
- Preserve `off`, `compact`, and `expanded` visibility behavior from Slice 3 during live updates.
- Preserve permission approval cards, plan review cards, applied-plan cards, streaming text, and final messages as separate surfaces.
- Cover refresh failures without making the chat look idle or duplicating technical cards.

Out of scope:

- New persisted `agent_activity_event` model.
- New websocket event types such as `tool-call-updated` or `activity-event`.
- Runner/SSE protocol changes.
- Server/OpenAPI changes.
- Per-row technical details disclosure; Slice 5 owns that.
- Full historical multi-turn anchoring; Slice 6 owns that.
- Final accessibility/performance polish; Slice 8 owns that.

## Product Decisions For This Slice

- Use existing durable state first: messages, tool calls, current plan, applied plans, session status, and websocket signals.
- Treat websocket events as invalidation signals, not as authoritative activity rows.
- Tool-call state remains fetched from `getToolCalls`; the websocket event tells the UI to refresh.
- Plan-ready state should be fetched via `getCurrentOperationPlan` so the activity block can show `Prepared a plan` without waiting for a full page reload.
- Applied-plan state should continue to use `getAppliedOperationPlans` and remain deduped by plan id and revision.
- Activity rows must update inside the same chat timeline item for the current turn. A changing tool status should not append a second activity block.
- If refresh fails, keep the last known activity model and show existing localized errors only where the owning surface already has an error area. Do not replace the activity block with raw error text.
- No raw tool names, JSON, ids, request bodies, or provider text should become visible in default activity UI because of live updates.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner test commands are required because this slice intentionally uses existing websocket events as invalidation signals and does not change backend contracts.

## Edge Cases Covered In This Slice

| Spec area         | Case                                           | Slice 4 expectation                                                                       |
| ----------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Live updates      | Tool-call event arrives                        | Existing activity block updates from refreshed tool-call state                            |
| Live updates      | Polling sees completed tool call               | Running row changes to completed without appending a second block                         |
| Live updates      | Assistant delta starts                         | Activity block adds or updates `Writing response`; streamed text still renders separately |
| Live updates      | Assistant message created                      | `Writing response` clears and final assistant message appears                             |
| Live updates      | Plan becomes ready                             | `operation-plan-ready` refreshes current plan and shows `Prepared a plan`                 |
| Live updates      | Plan applied                                   | `operation-plan-applied` refreshes applied history and shows applied-plan card separately |
| Coalescing        | Repeated metadata/previews refreshes           | One aggregate row remains with updated status/count                                       |
| Coalescing        | Duplicate websocket and poll refreshes         | One activity block and one row per coalesced activity kind                                |
| Visibility        | Mode is `off` during live updates              | Activity block stays hidden; busy fallback and required action cards remain               |
| Visibility        | Mode is `expanded` during live updates         | Newly refreshed rows appear expanded without requiring another click                      |
| Required surfaces | Pending approval                               | Activity says waiting for approval; approval card remains actionable                      |
| Required surfaces | Plan review                                    | Activity says plan prepared; plan review remains actionable                               |
| Required surfaces | Applied plan                                   | Activity summary can mention applied changes; applied-plan card remains a separate item   |
| Races             | Out-of-order tool-call refresh responses       | Older response is ignored and cannot roll the UI backward                                 |
| Races             | Session changes while refresh is in flight     | Old response is ignored and cannot update the new session                                 |
| Races             | Component destroyed while refresh is in flight | Late response is ignored and callbacks reset safely                                       |
| Errors            | Tool-call refresh fails                        | Last known activity remains; no duplicate fallback tool cards appear                      |
| Errors            | Current-plan refresh fails                     | Existing activity remains usable; no raw error text appears in the activity block         |
| Safety            | Unknown/technical tool payloads                | Default activity UI remains human-labeled and technical data stays hidden                 |

## Edge Cases Deferred To Later Slices

- Per-row technical details disclosure and redaction UI.
- Full historical multi-turn anchoring after reload.
- Explicit backend activity events for non-tool gaps.
- Runner-specific progress events for apply/retry/recovery.
- Virtualization or DOM caps for very long historical activity lists.
- Final screen-reader announcement tuning beyond preserving polite live regions.

## File Structure

Modify:

- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

Optional helper extraction if tests show the chat panel is getting too large:

- `web/src/routes/(user)/assistant/agent-session-activity-refresh-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-activity-refresh-ui.spec.ts`

Do not modify:

- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`
- database migrations

---

## Task 1: Add Chat Panel Live-Update Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Add websocket handler capture helpers**

Use the existing `websocketMock.websocketEvents.on` pattern:

```ts
let handler: Parameters<typeof websocketMock.websocketEvents.on>[1] | undefined;
websocketMock.websocketEvents.on.mockImplementation((_eventName, nextHandler) => {
  handler = nextHandler;
  return vi.fn();
});
```

Keep deterministic timestamps so the transcript order can be asserted.

- [ ] **Step 2: Write a failing assistant-delta in-place update test**

Arrange:

- one user message in `getAgentSessionMessages`;
- no tool calls;
- `activityVisibilityMode: 'compact'`.

Act:

- emit two `assistant-message-delta` events for the selected session.

Assert:

- one activity block exists;
- it contains `Writing response`;
- there is only one `[data-chat-item]` activity block after the user message;
- streamed assistant text still renders as normal streamed content;
- duplicate deltas append to streamed text but do not append duplicate activity blocks.

- [ ] **Step 3: Write a failing assistant-message-created cleanup test**

Arrange:

- start from the delta test state.

Act:

- emit `assistant-message-created` with a final assistant message.

Assert:

- the streamed text disappears;
- the final assistant message renders once;
- the active `Writing response` row is gone unless another active input still requires it;
- transcript order is user message, optional terminal activity summary, assistant message.

- [ ] **Step 4: Write a failing operation-plan-ready refresh test**

Arrange:

- mock `getCurrentOperationPlan` to resolve a proposed plan with two operations.
- seed a triggering user message.

Act:

- emit `operation-plan-ready` for the selected session.

Assert:

- `getCurrentOperationPlan` is called with the selected session id;
- the existing activity block updates to show `Preparing a plan` / `Prepared a plan`;
- the plan row includes the operation count when the view model supports it;
- no standalone technical tool-call card is created;
- plan review remains owned by the action dock, not duplicated inside the activity block.

Expected red failure before implementation: chat panel currently ignores `operation-plan-ready` for activity state.

- [ ] **Step 5: Write a failing current-plan refresh failure test**

Arrange:

- `getCurrentOperationPlan` rejects.
- seed an existing activity block from a user message or streaming state.

Act:

- emit `operation-plan-ready`.

Assert:

- no unhandled rejection;
- activity block remains in its previous safe state;
- no raw error text or stack trace appears in the activity block;
- chat composer remains usable if session lifecycle allows it.

- [ ] **Step 6: Write a failing operation-plan-applied dedupe test**

Arrange:

- mock `getAppliedOperationPlans` to resolve one applied plan.
- seed a user message and current plan if needed.

Act:

- emit the same `operation-plan-applied` event twice.

Assert:

- applied-plan history is loaded safely;
- one applied-plan timeline card renders;
- the activity model shows an applied/apply summary once;
- duplicate events do not duplicate activity rows or cards.

- [ ] **Step 7: Run the red chat-panel command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected red failures should point to missing current-plan refresh handling and any missing dedupe/race behavior.

---

## Task 2: Add Tool-Call Refresh And Race Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Add an action-dock websocket refresh test**

Arrange:

- initial `getToolCalls` resolves an executing or approved tool call.
- second `getToolCalls` resolves the same tool call as completed with a response summary and count.
- capture the action-dock websocket handler.

Act:

- render `AgentSessionActionDock`;
- emit an existing selected-session event such as `assistant-message-delta` or `tool-approval-needed` as an invalidation signal.

Assert:

- `onRecentToolCallsChange` receives the running call first and completed call after the event;
- the completed tool call replaces by id, not append as a duplicate;
- `onPendingApprovalCountChange` is accurate after each refresh.

- [ ] **Step 2: Add an action-dock polling refresh test**

Use fake timers.

Arrange:

- session status is `Running`;
- initial tool-call state is running;
- subsequent poll returns completed.

Act:

- advance timers past the polling interval.

Assert:

- `getToolCalls` is called again;
- published recent tool calls move from running to completed;
- polling does not publish duplicate copies of the same id.

- [ ] **Step 3: Add an out-of-order refresh test**

Arrange:

- first refresh promise is intentionally held;
- second refresh resolves first with a newer completed tool call;
- first refresh resolves later with stale running state.

Act:

- trigger two quiet refreshes through websocket events.

Assert:

- stale first response is ignored;
- the final published state remains completed.

- [ ] **Step 4: Add session-switch and destroyed-component tests**

Assert:

- after rerendering `AgentSessionActionDock` or `AgentConversationPane` with a different session, late tool-call refresh responses for the old session do not publish into the new session;
- after unmount, late refresh responses do not call `onRecentToolCallsChange` except for the expected cleanup empty array.

- [ ] **Step 5: Add a refresh-failure test**

Arrange:

- existing tool calls are already published;
- a quiet refresh rejects.

Assert:

- no unhandled rejection;
- existing published tool calls are not replaced with an empty list;
- chat-visible activity can remain based on the last known state;
- `loadErrorMessage` is not shown for quiet refresh failure unless the product intentionally wants a localized dock error.

- [ ] **Step 6: Add a conversation-pane in-place activity update test**

Arrange:

- `AgentConversationPane` loads a user message and one running/current tool call via the action dock;
- later `getToolCalls` returns the same call completed.

Act:

- trigger the action-dock refresh via websocket or polling.

Assert:

- chat transcript still contains one activity block;
- the row changes from running copy to completed copy;
- no current-turn standalone tool-call card appears;
- approval/plan action surfaces remain unaffected.

- [ ] **Step 7: Run the red tool-refresh command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Expected red failures should identify missing race guards, missing tests around quiet refresh failures, or missing in-place chat assertions.

---

## Task 3: Implement Current Plan And Applied Plan Live State In Chat Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify only if needed: optional helper file `agent-session-activity-refresh-ui.ts`

- [ ] **Step 1: Add current-plan state**

Import `getCurrentOperationPlan` from `@immich/sdk`.

Add state:

- `currentPlan: AgentOperationPlanResponseDto | null`
- `currentPlanLoadSequence`

Pass `currentPlan` into `buildAgentActivityModel` instead of `null`.

- [ ] **Step 2: Add safe current-plan loader**

Implement:

```ts
const loadCurrentPlan = async (sessionId: string) => {
  const sequence = ++currentPlanLoadSequence;
  try {
    const nextPlan = await getCurrentOperationPlan({ id: sessionId });
    if (sequence !== currentPlanLoadSequence || session.id !== sessionId) return;
    currentPlan = nextPlan;
  } catch (error) {
    if (sequence !== currentPlanLoadSequence || session.id !== sessionId) return;
    handleError(error, $t('assistant_operation_plan_error'));
  }
};
```

Do not set a chat-level raw error solely because the activity refresh missed. The operation-plan review panel owns actionable plan-load errors.

- [ ] **Step 3: Handle websocket plan events**

Update `handleSessionEvent`:

- `operation-plan-ready`: call `loadCurrentPlan(session.id)` and keep streamed text state untouched unless product tests require clearing it.
- `operation-plan-applied`: call `loadAppliedPlans()`, clear `currentPlan` if it matches the applied plan id, and keep applied plan cards separate.

- [ ] **Step 4: Reset plan load sequences on destroy/session key**

In `onDestroy`, increment both current-plan and applied-plan sequences.

Because the chat panel is keyed by `session.id` in `AgentConversationPane`, component remount should clear stale state. Keep explicit sequence guards for tests and standalone use.

- [ ] **Step 5: Preserve visibility behavior**

Ensure:

- `off` still hides activity block but not streamed text, plan review, or applied-plan card.
- `expanded` still renders new plan/apply rows expanded after a websocket refresh.
- compact row selection still favors active/recent rows.

- [ ] **Step 6: Run focused chat-panel tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

---

## Task 4: Harden Tool-Call Refresh Publishing

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- Modify only if needed: optional helper file `agent-session-activity-refresh-ui.ts`

- [ ] **Step 1: Keep quiet refresh failures non-destructive**

Review `loadToolCalls({ quiet: true })` behavior.

Ensure:

- a quiet refresh rejection does not clear existing `toolCalls`;
- existing `onRecentToolCallsChange` published state remains valid;
- no noisy chat-level error appears;
- initial non-quiet load still shows localized load error when it fails.

- [ ] **Step 2: Preserve sequence guards**

Ensure every async tool-call load captures:

- the session id at request time;
- the load sequence at request time.

Ignore responses when:

- component is destroyed;
- request sequence is stale;
- returned state belongs to a stale session.

- [ ] **Step 3: Publish replacement state by id**

When refresh returns the full tool-call list, publish the returned canonical list.

When a decision endpoint returns one updated tool call and full refresh fails, `replaceToolCall` should replace the matching id and keep the rest of the latest local list.

- [ ] **Step 4: Keep websocket events as invalidation signals**

For any `on_agent_session_event` with the selected session id:

- call `loadToolCalls({ quiet: true })`;
- call `refreshSession()` only where currently needed for operation apply or when tests prove plan-ready/approval transitions require it;
- ignore events for other sessions.

Do not add new event types in this slice.

- [ ] **Step 5: Run focused action-dock tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts
```

---

## Task 5: Verify Conversation Integration

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify implementation files only if integration tests expose gaps.

- [ ] **Step 1: Test tool-call lifecycle in chat**

Assert a running/current tool-call state updates the existing activity block to completed after action-dock refresh, while preserving:

- one chat activity block;
- no current-turn standalone handled tool-card duplicate;
- no focus-stealing or composer disable regression beyond existing lifecycle rules.

- [ ] **Step 2: Test pending approval lifecycle in chat**

Assert:

- `tool-approval-needed` refreshes tool calls;
- activity says `Waiting for approval`;
- approval card remains separate;
- approving still triggers resume behavior from earlier slices;
- subsequent refresh updates the same activity block instead of adding a second one.

- [ ] **Step 3: Test visibility modes with live updates**

For the same refreshed tool-call or plan-ready scenario:

- `off`: no activity block; busy fallback or required card remains;
- `compact`: one compact block;
- `expanded`: all rows visible after refresh.

Use `localStorage` stubs already introduced in Slice 3 tests.

- [ ] **Step 4: Test session-switch race**

Render first session, start a held refresh, rerender to second session, resolve first refresh.

Assert:

- first-session activity does not appear in second session;
- second session still loads its own messages/tool calls;
- cleanup publishes empty recent tool calls for the old keyed action dock without clearing the new keyed dock state.

- [ ] **Step 5: Run focused conversation tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

---

## Task 6: Regression And Cleanup

**Files:**

- Any files touched above.

- [ ] **Step 1: Run the full focused slice command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 2: Run assistant activity regression tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
```

- [ ] **Step 3: Run type and Svelte checks**

```bash
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
```

- [ ] **Step 4: Run diff hygiene**

```bash
git diff --check
git status --short
```

- [ ] **Step 5: Manual smoke check if dev server is available**

Only if a dev stack is already running:

- open an assistant session;
- send a message that triggers a tool call;
- verify one activity block updates while Pi works;
- approve a tool call and confirm the same activity block continues updating;
- verify streamed assistant text appears below the activity block;
- verify plan-ready and applied-plan cards remain separate;
- switch Activity preview between `Off`, `Compact`, and `Expanded`.

Do not require Docker or a real LLM provider for automated tests in this slice.

---

## Implementation Notes

- Prefer the smallest implementation that satisfies the tests. If `AgentSessionChatPanel` becomes harder to reason about, extract pure helpers for refresh sequencing or timeline assembly and test them directly.
- Use websocket events only as invalidation signals. The authoritative data still comes from SDK calls and existing component props.
- Keep activity ids stable enough that Testing Library assertions show one block updating in place instead of duplicates.
- Avoid replacing the action dock with a second independent tool-call loader inside the chat panel. The action dock already owns approval state and recent-tool publication.
- Do not show new error text inside the activity block unless it is derived from the safe activity view model.
- Do not expose raw provider reasoning, raw prompts, raw JSON payloads, API keys, bearer tokens, runner tokens, or unredacted errors.
