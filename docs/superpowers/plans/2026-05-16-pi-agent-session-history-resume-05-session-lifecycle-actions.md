# Pi Agent Session History Resume 05 Session Lifecycle Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the next slice from `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`: add status-aware composer lifecycle behavior, interrupted-session resume, terminal/applying disabled states, cancellable-session header actions, and selected-session/sidebar refresh after lifecycle actions.

**Architecture:** UI-only browser slice. Use existing generated SDK APIs (`appendAgentSessionMessage()`, `cancelAgentSession()`, `getAgentSession()`), existing selected-session workspace state, and the slice 3/4 chat plus action-dock layout. No backend, generated SDK, runner, MCP, compose, Docker, or broad e2e changes.

**Tech Stack:** Svelte 5, existing generated `@immich/sdk` browser APIs, `@immich/ui`, focused Vitest/Svelte Testing Library tests.

---

## Scope

This slice implements lifecycle actions and composer rules:

- Add pure lifecycle UI helpers for:
  - cancellable statuses;
  - composer enabled/disabled state by `AgentSessionStatus`;
  - composer placeholder label keys;
  - submit/action button label keys;
  - localized disabled reason keys.
- Update `AgentSessionChatPanel` to support:
  - status-specific placeholder text;
  - status-specific submit button text (`Resume` for interrupted sessions);
  - terminal `Start new chat` action without sending a message;
  - `onMessageSent` callback so the selected session can be refreshed after sends/resumes;
  - clearing active streaming UI when the selected session becomes terminal/cancelled.
- Add `Cancel` to `AgentSessionHeader` for cancellable sessions.
- Wire `cancelAgentSession()` in `AgentConversationPane`:
  - show loading/disabled state while cancelling;
  - show localized inline error on failure;
  - call `onSessionUpdated` with the returned session on success;
  - ignore stale cancel responses after session switch/unmount.
- Update `AgentAssistantWorkspace` tests/behavior as needed so refreshed sessions update the selected header and matching sidebar row.

This slice intentionally does not add:

- Backend or SDK changes.
- New websocket event types.
- Durable titles.
- MCP/runner transport changes.
- Mobile drawer redesign.
- Targeted Playwright reload/resume smoke. Keep that for a final verification slice.

## Design Source

- `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`

Relevant design decisions:

- Header actions include `Cancel`, `New chat`, and `Open session details`.
- `running`: composer enabled unless an assistant response is actively streaming.
- `waiting_for_tool_approval`: composer disabled only while pending approval cards are actionable.
- `waiting_for_plan_review`: composer enabled with revision-feedback placeholder.
- `interrupted`: composer enabled and primary button can read `Resume`.
- `completed`, `cancelled`, `failed`: composer disabled and shows `Start new chat`.
- `applying`: composer disabled.
- Sending a message to an interrupted session uses the existing `appendAgentSessionMessage()` path.
- Cancelling a cancellable session refreshes selected session and sidebar; cancel failures stay localized.
- Implementation must use TDD.

## Slice 4 Baseline

Slice 4 has moved plan review into `AgentSessionActionDock` above the composer and removed the separate plan panel below chat. Slice 5 should preserve that layout:

```text
Chat card
  transcript
  action dock: approvals, plan review, recent activity
  lifecycle-aware composer
```

Composer state should be derived in `AgentConversationPane` by combining:

- lifecycle status from `session.status`;
- `pendingApprovalCount` reported by `AgentSessionActionDock`;
- internal chat-panel state such as `isSending` and active assistant streaming.

Do not move composer ownership out of `AgentSessionChatPanel` in this slice.

## Conflict Boundaries

Do not edit these MCP-active areas in this slice:

- `agent-runner/**`
- `server/src/services/agent-runner.service.ts`
- `server/src/repositories/agent-runner.repository.ts`
- `server/src/types/agent-runner.types.ts`
- `server/src/controllers/agent-runner-tool.controller.ts`
- config/env fields for tool gateway or MCP gateway
- `e2e/docker-compose.yml`
- production Dockerfiles or runner packaging
- `open-api/**`
- generated SDK artifacts

Expected write set:

- `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-header.svelte`
- `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- `i18n/en.json`

If helper reuse is cleaner in `agent-session-workspace-ui.ts`, use that instead of creating a new helper file, but write the helper tests first.

## UI Contracts

### Cancellable Statuses

Use the server's existing cancellable status set:

- `created`;
- `running`;
- `waiting_for_tool_approval`;
- `waiting_for_plan_review`;
- `interrupted`.

Do not show `Cancel` for:

- `applying`;
- `completed`;
- `cancelled`;
- `failed`.

The UI should guard non-cancellable statuses even if a stale click/event path invokes cancel.

### Composer State

Lifecycle helper output should cover external composer state only. `AgentSessionChatPanel` still owns internal disabled states for:

- empty draft;
- in-flight send;
- active assistant streaming.

External composer behavior:

- `created`: enabled; submit label `Send`.
- `running`: enabled; submit label `Send`.
- `waiting_for_tool_approval`: enabled unless `pendingApprovalCount > 0`; if blocked, show approval-review reason.
- `waiting_for_plan_review`: enabled; placeholder should encourage revision feedback.
- `interrupted`: enabled; submit label `Resume`.
- `applying`: disabled with applying reason.
- `completed`, `cancelled`, `failed`: disabled with terminal reason and visible `Start new chat` action.

The terminal `Start new chat` action should call the same new-chat path as the header/sidebar action and must not call `appendAgentSessionMessage()`.

### Sending And Resuming

For normal sends and interrupted-session resumes:

- use the existing `appendAgentSessionMessage()` API;
- preserve existing text-block request shape;
- clear the draft only after a successful send;
- keep the draft after failure;
- set assistant-active/streaming state exactly as current successful sends do;
- call `onMessageSent?.(session.id)` after successful append so the selected session can be refreshed with `getAgentSession()`.

After `onMessageSent` refresh:

- update the selected session in `localSessions`;
- update selected header/sidebar status;
- ignore stale refreshes if the user switched sessions.
- keep append success durable in the UI even if the follow-up refresh fails; do not restore the draft, remove the sent message, or leave the send/resume control busy because `getAgentSession()` failed.

### Cancel Action

`AgentConversationPane` owns cancel side effects.

Implementation contract:

- pass `onCancel` into `AgentSessionHeader` only when `isAgentSessionCancellable(session.status)` is true;
- call `cancelAgentSession({ id: session.id })`;
- disable cancel button while cancelling;
- on success, call `onSessionUpdated(cancelledSession)`;
- on failure, show a localized inline alert near the header and keep the selected session unchanged;
- do not navigate away on cancel success;
- `New chat` remains a separate explicit action.

Stale response handling:

- guard stale/non-cancellable cancel invocations before calling the SDK;
- ignore cancel success/failure after the pane unmounts or the selected session changes;
- ignore returned sessions whose ID does not match the current selected session.
- if the SDK returns a matching already-cancelled session, treat it as a normal successful refresh.

### Streaming Cleanup

When a selected session becomes `cancelled`, `completed`, `failed`, or `applying`:

- clear active streaming text;
- mark assistant activity inactive;
- preserve draft text unless the session switched.

Cancel while streaming should therefore leave no stale streaming bubble and no permanently disabled composer state beyond the lifecycle rule.

### Workspace State

`AgentAssistantWorkspace` should continue to own `localSessions`.

Implementation contract:

- selected-session refresh from send/resume/cancel replaces the matching `localSessions` entry;
- unknown session updates are ignored;
- stale selected-session updates after switching sessions are ignored;
- title cache is preserved;
- URL selection behavior and setup panel/new-session behavior remain unchanged.

## Test Commands

Use focused Vitest commands without an extra `--`.

Red/green focused commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-header.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts'
```

Regression commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant'
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
git diff --check
```

No broad e2e is required in this slice. The targeted reload/resume smoke should be planned as the final slice after lifecycle behavior is component-tested.

## Slice 5 Edge Cases To Cover

Lifecycle helpers:

- every `AgentSessionStatus` has deterministic composer state;
- cancellable statuses match server cancellable statuses;
- terminal statuses are not cancellable;
- `waiting_for_tool_approval` blocks only when pending approval count is greater than zero;
- `waiting_for_plan_review` remains enabled even with an operation plan in the dock;
- `interrupted` uses `Resume` label;
- applying disables with applying reason;
- terminal statuses return `Start new chat` action metadata;
- unknown future status values fall back to disabled with safe copy.

Chat/composer:

- `running` sends with `appendAgentSessionMessage()`;
- `waiting_for_plan_review` uses revision-feedback placeholder and sends through normal append path;
- `interrupted` uses `Resume` button text and sends through normal append path;
- terminal `Start new chat` button calls `onNewChat` and does not append;
- terminal textarea is disabled;
- applying textarea is disabled and does not show terminal start action unless the design helper says so;
- pending approvals still disable textarea/send and preserve draft;
- assistant-active streaming still blocks duplicate sends;
- failed send keeps draft and shows existing send error;
- successful send clears draft and calls `onMessageSent(session.id)`;
- successful send followed by refresh failure leaves the sent message visible, keeps the draft cleared, exits send/resume busy state, and surfaces only a localized non-blocking refresh error;
- switching sessions clears draft and streaming state as existing keying expects;
- status changing to cancelled/completed/failed/applying clears streaming text but preserves draft.

Header/cancel:

- cancel button appears for created/running/waiting-tool/waiting-plan/interrupted;
- cancel button does not appear for applying/completed/cancelled/failed;
- cancel button has stable accessible name;
- cancel button disables or shows loading while cancellation is in flight;
- details and new-chat actions remain available as appropriate;
- long title/provider/model still stay bounded with cancel present.

Conversation pane:

- cancel success calls `cancelAgentSession({ id })`;
- cancel success calls `onSessionUpdated` with returned session;
- cancel success updates selected header/sidebar via workspace;
- cancel invoked after the session is already non-cancellable does not call `cancelAgentSession`;
- cancel success returning a matching already-cancelled session is handled as a normal successful update;
- cancel failure shows localized `role="alert"` and leaves selected session unchanged;
- cancel failure keeps cancel button available again;
- cancel invoked on a stale/unmounted pane does not update local state;
- returned session ID mismatch is ignored;
- pending approvals still override lifecycle composer enabled state;
- `waiting_for_plan_review` composer remains enabled while plan review card is present;
- interrupted resume success refreshes selected session through `getAgentSession()`;
- resume refresh failure shows localized non-blocking error or leaves append success visible without clearing the message.

Workspace:

- refreshed selected session replaces matching `localSessions` entry;
- refreshed unknown session is ignored;
- stale refresh after selecting another session is ignored;
- title cache remains intact after status refresh;
- URL query remains selected after cancel success;
- New chat from terminal composer clears selection and query like existing header/sidebar new chat;
- no transcript/tool/plan requests are made for unselected sidebar sessions.

Accessibility/responsive:

- cancel/start/resume/send buttons have stable accessible names;
- disabled reason uses text, not color only;
- terminal start action is keyboard reachable;
- inline cancel/refresh errors use `role="alert"`;
- long disabled reason and placeholder text do not overlap controls;
- header action row remains usable on narrow widths.

---

## Task 1: Lifecycle UI Helpers

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.ts`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing helper tests**

Add tests for:

- cancellable status set;
- composer state for every `AgentSessionStatus`;
- pending approval count behavior for `waiting_for_tool_approval`;
- revision placeholder for `waiting_for_plan_review`;
- resume label for `interrupted`;
- disabled/applying/terminal reason keys;
- terminal `Start new chat` metadata;
- unknown future status fallback.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts'
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 2: Implement helper**

Create helpers such as:

```ts
export const isAgentSessionCancellable = (status: AgentSessionStatus) => ...;
export const getAgentSessionComposerState = (
  status: AgentSessionStatus,
  options: { pendingApprovalCount: number },
) => ...;
```

Suggested composer state shape:

```ts
type AgentSessionComposerState = {
  disabled: boolean;
  disabledReasonKey?: Translations;
  placeholderKey: Translations;
  submitLabelKey: Translations;
  terminalActionLabelKey?: Translations;
};
```

Run the focused helper test. Expected: PASS.

## Task 2: Chat Panel Composer Lifecycle

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `i18n/en.json` if additional labels are needed

- [ ] **Step 1: Write failing chat-panel tests**

Add tests for:

- custom placeholder is applied;
- custom submit label is applied;
- interrupted session resume label still calls `appendAgentSessionMessage()`;
- terminal action calls `onNewChat` and never calls append;
- terminal/applying disabled state prevents submit;
- successful append calls `onMessageSent(session.id)`;
- failed append keeps draft and does not call `onMessageSent`;
- status change to cancelled/completed/failed/applying clears streaming text and assistant-active state while preserving draft.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: FAIL because the props and lifecycle behavior do not exist.

- [ ] **Step 2: Implement chat-panel props and behavior**

Add props similar to:

- `composerPlaceholder?: string`;
- `submitLabel?: string`;
- `terminalActionLabel?: string | null`;
- `onTerminalAction?: () => void`;
- `onMessageSent?: (sessionId: string) => void | Promise<void>`.

Implementation notes:

- keep existing `appendAgentSessionMessage()` request shape;
- keep existing draft clearing/failure behavior;
- call `onMessageSent` after `appendIfNew(message)` and draft clear;
- render a terminal `Start new chat` button only when terminal action props are present;
- do not call append from the terminal action;
- add an effect that clears streaming UI when `session.status` becomes applying or terminal.

Run the focused chat-panel test. Expected: PASS.

## Task 3: Header Cancel Action

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-header.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing header tests**

Add tests for:

- cancel renders for every cancellable status;
- cancel is absent for applying/completed/cancelled/failed;
- cancel click calls `onCancel`;
- cancel button is disabled/loading while `cancelBusy` is true;
- details and new-chat callbacks still work;
- long text remains bounded when cancel is present.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-header.spec.ts'
```

Expected: FAIL because header cancel props do not exist.

- [ ] **Step 2: Implement header cancel action**

Add props such as:

- `onCancel?: () => void | Promise<void>`;
- `cancelBusy?: boolean`.

Render cancel before `Details` or after details with a stable accessible name. Use helper `isAgentSessionCancellable(session.status)` so visibility remains testable.

Run the focused header test. Expected: PASS.

## Task 4: Conversation Pane Lifecycle Integration

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing conversation tests**

Add tests for:

- `waiting_for_plan_review` passes revision placeholder and leaves composer enabled when no approvals are pending;
- `waiting_for_tool_approval` disables composer only while pending approvals exist;
- `interrupted` shows `Resume` and append success refreshes session via `getAgentSession()`;
- completed/cancelled/failed show `Start new chat` and disable textarea;
- applying disables textarea with applying reason;
- cancel success calls `cancelAgentSession`, updates session through `onSessionUpdated`, and clears cancel busy state;
- cancel failure shows localized alert and keeps session selected;
- stale cancel result after rerender/session switch is ignored;
- cancel is not attempted for non-cancellable statuses.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts'
```

Expected: FAIL because lifecycle integration and cancel wiring do not exist.

- [ ] **Step 2: Implement conversation lifecycle wiring**

Implementation notes:

- derive composer state with `getAgentSessionComposerState(session.status, { pendingApprovalCount })`;
- continue passing approval-based disabled reason when pending approvals are actionable;
- pass placeholder/submit/terminal action props into `AgentSessionChatPanel`;
- implement `refreshSelectedSession` using `getAgentSession({ id: session.id })`;
- pass `onMessageSent` from chat to refresh selected session;
- implement `cancelSelectedSession` using `cancelAgentSession({ id: session.id })`;
- protect cancel and refresh with a sequence/destroyed guard;
- show cancel/refresh errors with localized `role="alert"` near the header.

Run the focused conversation test. Expected: PASS.

## Task 5: Workspace Session State Integration

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`

- [ ] **Step 1: Write failing workspace tests**

Add tests for:

- cancel success replaces the selected session in `localSessions` and updates header/sidebar status;
- resume/send refresh replaces selected session status;
- unknown refreshed sessions are ignored;
- stale refresh after selecting another session is ignored;
- title cache persists after status refresh;
- terminal composer `Start new chat` clears selected session and URL query;
- no unselected sidebar transcript/tool/plan requests are introduced.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts'
```

Expected: FAIL for any behavior not already covered.

- [ ] **Step 2: Implement workspace state updates**

Implementation notes:

- existing `handleSessionUpdated` likely covers selected-session replacements; tighten tests before changing it;
- keep ignoring updates where `session.id !== selectedSessionId`;
- keep title cache unchanged;
- keep URL update behavior from existing `startNewChat` and `selectSession`.

Run the focused workspace test. Expected: PASS.

## Task 6: Regression And Cleanup

**Files:**

- Any touched files from tasks above.

- [ ] **Step 1: Assistant route regression**

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant'
```

Expected: PASS.

- [ ] **Step 2: Type and Svelte checks**

Run:

```bash
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
```

Expected: PASS.

- [ ] **Step 3: Diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- no whitespace errors;
- no generated SDK, backend, runner, MCP, compose, Docker, or e2e changes;
- only expected web/i18n/doc files changed.

## Implementation Notes

- Use TDD for each behavior: write the focused failing test, verify the expected failure, implement the smallest change, and rerun the focused test.
- Prefer pure helper tests for lifecycle rules before component tests.
- Do not duplicate lifecycle logic across chat/header/conversation; centralize status rules.
- Keep cancel and refresh errors localized. Do not blank transcript, action dock, or sidebar.
- Avoid snapshots. Assert roles, labels, disabled states, callbacks, SDK calls, and visible localized text.
