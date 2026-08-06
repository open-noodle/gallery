# Pi Agent Session History Resume 03 Approval Action Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 3 from `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`: add the selected-session action dock for pending tool approvals, render approval cards in the conversation workspace above the composer, approve or deny through the browser-facing API, and keep transcript/plan/session state localized and recoverable.

**Architecture:** UI-only browser slice. Use existing generated SDK APIs (`getToolCalls()`, `approveToolCall()`, `getAgentSession()`), existing websocket event subscription, and the selected-session conversation pane from slice 2. No backend schema, generated SDK, runner protocol, tool gateway, MCP endpoint, compose, Docker, or e2e runner changes.

**Tech Stack:** Svelte 5, existing generated `@immich/sdk` browser APIs, `@immich/ui`, focused Vitest/Svelte Testing Library tests, fake timers for polling tests.

---

## Scope

This slice implements only pending approval action cards and the approval action dock:

- Add pure approval UI helpers for:
  - pending vs recent tool-call grouping;
  - stable sorting;
  - tool-name labels;
  - data-class labels;
  - approve/deny payload construction.
- Add `AgentToolApprovalCard` for one pending tool call:
  - user-readable tool name;
  - request summary;
  - data class;
  - asset/album counts;
  - provider/model from the selected session snapshot;
  - started time;
  - approve action;
  - deny action;
  - optional denial reason field.
- Add `AgentSessionActionDock` for the selected session:
  - load `getToolCalls({ id })` on mount/session change;
  - derive pending approvals and recent handled tool calls;
  - show pending cards;
  - show denied/completed/failed tool calls in collapsed recent activity;
  - show localized load and approval errors;
  - poll while the selected session is active;
  - refresh after selected-session websocket events;
  - refresh session and tool calls after approval/denial.
- Refactor `AgentSessionChatPanel` only enough to accept an action-dock snippet/slot above the composer and to block free-form sends while approvals are actionable.
- Wire the dock into `AgentConversationPane` and propagate refreshed session DTOs back to `AgentAssistantWorkspace` so the header/sidebar status stays current.

This slice intentionally does not add:

- Durable chat titles.
- Backend or database changes.
- Generated SDK/OpenAPI changes.
- New websocket tool-call events.
- Runner/MCP/gateway behavior.
- Operation-plan relocation into the action dock.
- Full composer lifecycle rules for terminal/interrupted/applying sessions.
- Cancel/resume actions.
- Broad Playwright/e2e coverage.

## Design Source

- `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`

Relevant design decisions:

- Tool approvals belong in the selected conversation workspace, not a separate page section.
- The first implementation may poll `getToolCalls()` because browser websocket events for tool-call updates do not exist yet.
- Approval card copy should emphasize data exposure and never expose internal transport details.
- Approving or denying records a durable approval decision; it does not directly mutate albums.
- The UI must not invent runner transport behavior. It should refresh state and leave the user able to continue the conversation if the runner does not resume immediately.
- Implementation must use TDD.

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

- `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-tool-approval-card.svelte`
- `web/src/routes/(user)/assistant/agent-tool-approval-card.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- `i18n/en.json`

If a generated SDK artifact changes, stop and investigate. The APIs and DTOs needed for this slice are already present.

## Current Baseline

Slice 2 already provides:

- `AgentConversationPane` as the selected-session right pane.
- `AgentSessionChatPanel` as transcript plus composer.
- `AgentOperationPlanReviewPanel` below chat.
- `AgentSessionHeader` and `AgentSessionDetailsDrawer`.
- workspace-owned `titleBySessionId` cache.

Slice 3 should preserve those behaviors and insert approvals into the conversation flow without rewriting chat or plan review logic.

## UI Contracts

### Approval Data

For the selected session:

- load `getToolCalls({ id: session.id })` immediately;
- pending approvals are calls with `status === AgentToolCallStatus.PendingApproval`;
- recent activity is handled calls with `denied`, `completed`, or `failed` status;
- approved/executing calls may remain hidden unless needed for a pending transition state;
- pending cards sort by `startedAt` ascending, then `id` ascending;
- recent activity sorts by `completedAt ?? startedAt` descending, then `id` descending.

The dock must ignore late loads from a previously selected session after the component unmounts or the session changes.

### Polling And Refresh

The first implementation uses polling because tool-call websocket events do not exist.

Refresh tool calls:

- immediately on mount/session selection;
- after every `on_agent_session_event` for the selected session;
- every few seconds while the selected session status is `running` or `waiting_for_tool_approval`;
- after approve/deny actions.

Do not poll terminal sessions unless a selected-session websocket event arrives.

After approve/deny:

- submit `approveToolCall({ id, toolCallId, agentToolApprovalDto })`;
- refresh `getAgentSession({ id })` and pass the refreshed session to the workspace;
- refresh `getToolCalls({ id })`;
- if approval succeeds but the follow-up refresh fails, use the returned tool-call DTO as the committed state for that one call, clear busy state, show a localized refresh error, and rely on the next poll/websocket refresh;
- leave the card actionable with an inline error when the approval API fails;
- if the approval API fails because the call was already handled in another tab, leave the card actionable with an inline error and allow the next refresh to reconcile it;
- do not optimistically approve or hide unrelated pending cards.

### Approval Card

Each pending card shows:

- tool name using a user-readable label;
- request summary from the DTO;
- data class label;
- asset count and album count, including zero values;
- provider credential label and model from the selected session snapshot;
- started time;
- approve button;
- deny button;
- optional denial reason control.

Denial behavior:

- default deny action sends `{ decision: denied }`;
- if the user opens the reason field and enters non-blank text, send `{ decision: denied, reason: trimmedReason }`;
- if the reason field is open but blank, omit `reason`;
- after successful denial, refresh session/tool calls and keep the composer usable for redirection.

Security/display constraints:

- render only DTO summary/count/status fields and session snapshot labels;
- never render `session.runnerEndpoint`, `session.runnerSessionId`, raw metadata, bearer tokens, internal gateway URLs, or MCP endpoint URLs;
- if a summary string contains suspicious internal URLs, do not add additional raw request metadata around it. Server redaction remains the authority.

### Action Dock Placement

Approvals should appear above the composer, not as a separate page section.

Implementation contract:

- update `AgentSessionChatPanel` to accept a small action-dock snippet or equivalent prop rendered between the transcript list and composer form;
- `AgentConversationPane` renders `AgentSessionActionDock` into that slot;
- the dock reports whether pending approvals are actionable;
- chat composer input and send button are disabled while pending approvals are actionable;
- when no pending approvals remain, free-form send returns to existing behavior.

This slice only adds approval-based composer blocking. Full status-based composer lifecycle rules remain a later slice.

### Recent Activity

Recent denied/completed/failed tool calls should be available without dominating the workspace.

Implementation contract:

- render recent activity collapsed by default;
- show count in the disclosure label;
- expanding shows tool name, status, response/error summary when available, and completed/started time;
- no recent activity disclosure is needed when there are no recent calls.

## Test Commands

Use the correct focused Vitest invocation for this repo. Do not use `pnpm --dir web test -- --run ...` because that passes an extra `--` through the script and can start a broader run.

Red/green focused commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-tool-approval-card.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
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

No broad e2e is required in this slice. The deterministic runner/e2e approval path should be covered in the later reload/resume or end-to-end slice after the MCP transport work settles.

## Slice 3 Edge Cases To Cover

Approval helpers:

- every `AgentToolName` maps to a label key;
- every `AgentToolDataClass` maps to a label key;
- unknown future enum values fall back to the raw value safely;
- pending/recent grouping excludes approved/executing calls from recent activity;
- pending sort is stable when `startedAt` ties;
- recent sort is stable when timestamps tie;
- approve payload has only `decision: approved`;
- deny payload trims non-empty reasons;
- deny payload omits blank reasons.

Approval card:

- metadata, previews, originals, and plan data classes render distinct labels;
- zero asset and album counts render intentionally, not as missing data;
- plural/singular count labels work for 0, 1, and many;
- approve calls the callback once and disables duplicate clicks while pending;
- deny without opening the reason sends no reason;
- deny with whitespace-only reason sends no reason;
- deny with text sends the trimmed reason;
- API failure shows inline error and leaves approve/deny controls usable;
- long request summaries wrap without overlapping actions;
- long provider/model labels are constrained;
- no runner endpoint, runner session ID, bearer token, raw request metadata, gateway URL, or MCP URL appears in the card.

Action dock:

- initial load calls `getToolCalls({ id })` for only the selected session;
- load error renders an action-dock alert while chat and plan remain visible;
- no pending calls renders no pending card area;
- multiple pending calls render in stable order;
- recent denied/completed/failed calls render only inside collapsed recent activity by default;
- expanding recent activity shows status and summaries;
- approving one pending call does not hide or approve other pending calls before refresh;
- approval success refreshes tool calls and session;
- approval success updates workspace/sidebar/header via `onSessionUpdated`;
- approval success followed by session/tool-call refresh failure clears busy state, shows a localized refresh error, uses the returned tool-call DTO for that one call, and does not resubmit the approval;
- approval failure leaves local cards unchanged and actionable;
- approval failure because the call was already handled in another tab leaves local cards actionable, shows an inline error, and can be reconciled by the next successful refresh;
- denial success refreshes tool calls and session;
- denial success followed by session/tool-call refresh failure clears busy state, shows a localized refresh error, uses the returned tool-call DTO for that one call, and does not resubmit the denial;
- denial failure leaves reason text intact;
- in-flight load from an old selected session is ignored after session switch;
- websocket events for the selected session trigger refresh;
- websocket events for another session do not trigger refresh;
- polling starts for `running` and `waiting_for_tool_approval`;
- polling does not start for completed/cancelled/failed sessions;
- polling is cleaned up on unmount/session switch;
- fake timers do not leave pending timers after tests.

Chat/composer integration:

- dock content renders between transcript and composer;
- composer is disabled while pending approvals are actionable;
- composer remains enabled when session is `waiting_for_tool_approval` but no pending approvals are returned;
- composer remains disabled during existing send/assistant-active states;
- draft text is preserved while approvals are pending;
- failed send behavior remains unchanged;
- title discovery behavior from slice 2 remains unchanged.

Conversation/workspace integration:

- selected conversation renders header, chat, action dock, and plan review;
- approval load failure does not blank header/chat/plan;
- plan load failure does not blank approval dock;
- transcript load failure does not blank approval dock;
- refreshed selected session replaces the matching entry in `localSessions`;
- refreshed selected session updates the selected header status;
- refreshed non-selected or stale session update is ignored;
- switching sessions remounts dock state and clears approval errors/reason fields;
- no transcript requests are made for unselected sidebar sessions.

Accessibility/responsive:

- approval and deny buttons have stable accessible names;
- reason field has a label;
- recent activity disclosure has a stable accessible name and count;
- action dock status/error messages use `role="status"` or `role="alert"` as appropriate;
- status/data-class information is text-readable and not color-only;
- long summaries and labels wrap/truncate within bounded containers;
- mobile width keeps approval actions reachable without overlapping composer controls.

---

## Task 1: Approval UI Helpers

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests for:

- tool name label keys for all current `AgentToolName` values;
- data class label keys for all current `AgentToolDataClass` values;
- pending and recent grouping;
- stable pending sort by `startedAt`, then `id`;
- stable recent sort by `completedAt ?? startedAt`, then `id`;
- approved/executing calls excluded from recent activity;
- approve payload construction;
- deny payload with trimmed reason;
- deny payload with omitted blank reason.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts'
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 2: Implement helper**

Create helpers such as:

```ts
export const getAgentToolNameLabelKey = (toolName: AgentToolName) => ...;
export const getAgentToolDataClassLabelKey = (dataClass: AgentToolDataClass) => ...;
export const getPendingToolCalls = (toolCalls: AgentToolCallResponseDto[]) => ...;
export const getRecentToolCalls = (toolCalls: AgentToolCallResponseDto[]) => ...;
export const buildToolApprovalPayload = (decision, reason?) => ...;
```

Run the focused helper test. Expected: PASS.

## Task 2: Approval Card

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-tool-approval-card.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-tool-approval-card.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing card tests**

Test:

- renders user-readable tool name, request summary, data class, asset/album counts, provider/model, and started time;
- renders zero counts intentionally;
- approve button calls `onApprove(toolCall.id)` once and disables duplicate clicks while pending;
- deny button calls `onDeny(toolCall.id, undefined)` when reason UI is closed;
- optional reason UI opens, keeps focusable input, trims non-empty reason, and omits blank reason;
- inline error is rendered with `role="alert"`;
- long summary and labels use stable wrapping/truncation classes;
- runner endpoint/session ID/internal URL/token fixtures are not rendered.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-tool-approval-card.spec.ts'
```

Expected: FAIL because the card does not exist.

- [ ] **Step 2: Implement card**

Create `AgentToolApprovalCard` props:

- `session: AgentSessionResponseDto`;
- `toolCall: AgentToolCallResponseDto`;
- `busy?: boolean`;
- `errorMessage?: string | null`;
- `onApprove: (toolCallId: string) => void | Promise<void>`;
- `onDeny: (toolCallId: string, reason?: string) => void | Promise<void>`.

Use helper label keys. Add only required i18n keys.

Run the focused card test. Expected: PASS.

## Task 3: Action Dock Loading, Polling, And Approval Actions

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing dock tests**

Use fake timers where polling is involved.

Test:

- initial load calls `getToolCalls({ id: session.id })`;
- pending cards render in helper order;
- no pending approvals renders no pending card area;
- load error is localized with `role="alert"`;
- recent activity is collapsed by default and expands to show denied/completed/failed calls;
- approve action posts approved payload, refreshes tool calls, refreshes session via `getAgentSession`, and calls `onSessionUpdated`;
- deny action posts denied payload with optional reason and refreshes state;
- approval failure leaves card actionable and shows inline error;
- approval API conflict/already-handled failures leave the card actionable, show inline error, and do not clear other pending calls;
- refresh failure after a successful approve/deny clears busy state, shows a localized refresh error, uses the returned tool-call DTO for that one call, and does not resubmit the decision;
- denial failure leaves reason text intact;
- selected-session websocket events trigger refresh;
- non-selected websocket events do not trigger refresh;
- polling starts for `running` and `waiting_for_tool_approval`;
- polling does not start for terminal sessions;
- in-flight old-session responses are ignored after rerender/unmount.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
```

Expected: FAIL because the dock does not exist.

- [ ] **Step 2: Implement dock**

Create `AgentSessionActionDock` props:

- `session: AgentSessionResponseDto`;
- `onSessionUpdated?: (session: AgentSessionResponseDto) => void`;
- `onPendingApprovalCountChange?: (count: number) => void`.

Implementation notes:

- subscribe to `websocketEvents.on('on_agent_session_event', ...)`;
- use a load sequence counter and `destroyed` flag to ignore stale async results;
- call `onPendingApprovalCountChange(pendingCalls.length)` after each successful load and `0` on unmount;
- after approve/deny, call `approveToolCall`, then `getAgentSession`, then `getToolCalls`;
- keep per-tool-call busy and error state keyed by tool call ID;
- clear per-tool-call error after successful refresh;
- use `setInterval` only while session status is active and clean it up.

Run the focused dock test. Expected: PASS.

## Task 4: Chat Panel Dock Slot And Composer Blocking

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Write failing chat integration tests**

Add tests for:

- action dock snippet/slot renders between transcript list and composer;
- composer textarea and send button are disabled when `composerDisabled` is true;
- disabled reason/status text is visible when provided;
- pending approval disabled state preserves draft text;
- existing send, send failure, streaming, transcript load, title discovery, and duplicate-send tests still pass.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: FAIL because the slot/disabled props do not exist.

- [ ] **Step 2: Implement chat panel support**

Add props such as:

- `actionDock?: Snippet`;
- `composerDisabled?: boolean`;
- `composerDisabledReasonKey?: Translations`.

Render the dock after transcript/streaming messages and before the form. Update `canSend` and textarea disabled state to include `composerDisabled`. Do not change existing send semantics otherwise.

Run the focused chat-panel test. Expected: PASS.

## Task 5: Conversation Pane And Workspace Integration

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`

- [ ] **Step 1: Write failing integration tests**

Test:

- conversation pane renders action dock between chat transcript and composer;
- pending approvals disable composer;
- no pending approvals leaves composer enabled even when session status is `waiting_for_tool_approval`;
- approval load failure keeps header/chat/plan visible;
- plan load failure keeps approval dock visible;
- transcript load failure keeps approval dock visible;
- refreshed session from dock updates selected header status;
- refreshed session replaces the matching sidebar/local session entry;
- stale session updates are ignored after switching sessions;
- switching sessions remounts dock state and clears approval errors/reason fields.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts' 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts'
```

Expected: FAIL because the dock is not wired into the conversation/workspace.

- [ ] **Step 2: Wire dock into conversation and workspace**

Update `AgentConversationPane`:

- render `AgentSessionActionDock` in the chat panel dock slot;
- keep `pendingApprovalCount` state;
- disable composer while `pendingApprovalCount > 0`;
- pass refreshed sessions through `onSessionUpdated`.

Update `AgentAssistantWorkspace`:

- add `handleSessionUpdated`;
- replace the matching session in `localSessions`;
- ignore updates for unknown sessions;
- keep existing title cache and URL behavior.

Run the focused integration tests. Expected: PASS.

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
- no generated SDK, backend, runner, MCP, compose, or Docker changes;
- only expected web/i18n files changed for implementation.

## Implementation Notes

- Keep tests red before implementation for each task.
- Prefer helper tests for grouping/sorting/payload behavior before component tests.
- Use existing generated SDK exports. Do not add or regenerate SDK code.
- Use existing websocket events only; do not add tool-call websocket events in this slice.
- Polling tests must use fake timers and must restore real timers.
- Avoid component-level snapshots. Assert roles, labels, visible text, callback payloads, and API calls.
- If Svelte snippet typing becomes cumbersome, use the simplest established Svelte 5 pattern that keeps the dock physically above the composer and keeps tests focused on behavior.
