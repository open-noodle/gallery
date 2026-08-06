# Pi Agent Session History And Resume Design

Status: draft design
Date: 2026-05-16
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

Decision: defer durable chat titles for the first implementation. Session rows
derive temporary titles from loaded transcripts and fall back to `New chat`.

## Problem

The Assistant page currently behaves like a setup form that reveals one active
session after creation. That was enough for the first end-to-end album organizer
flow, but it does not yet feel like a durable chat product:

- prior sessions are not visible from the Assistant page;
- refreshing the page loses the selected session context in the UI;
- interrupted or waiting sessions are not easy to resume;
- tool approvals and operation-plan review are rendered as separate page blocks
  instead of a single chat workspace;
- the user cannot scan which sessions need approval, plan review, or follow-up.

The next product step should make Assistant feel closer to Claude's chat
workspace: a left session list and a right conversation pane, with durable
session state recoverable after reload.

## Goals

- Replace the single-session page shape with a two-pane Assistant workspace.
- Show existing agent sessions in a persistent left sidebar.
- Let users select, resume, cancel, and create sessions without leaving the page.
- Keep the right side focused on the selected chat conversation.
- Integrate tool approvals and album operation plans into the selected
  conversation workspace.
- Preserve all existing server authority for access, approval, plan validation,
  and final apply.
- Avoid MCP transport conflicts. This design must work whether tools are called
  through the current internal gateway or the upcoming MCP endpoint.

## Non-Goals

- Do not change the runner-to-Gallery tool transport.
- Do not add new Gallery agent tools.
- Do not add direct apply/write tools to the runner.
- Do not implement automatic model-generated chat titles in the first slice.
- Do not build cross-user/admin session browsing.
- Do not implement long-term archival/search across all transcripts.
- Do not introduce MCP-specific UI concepts.

## Existing Context

Useful browser-facing APIs already exist:

- `getAgentSessions()`
- `getAgentSession()`
- `cancelAgentSession()`
- `getAgentSessionMessages()`
- `appendAgentSessionMessage()`
- `getToolCalls()`
- `approveToolCall()`
- `getCurrentOperationPlan()`
- `applyApprovedOperations()`
- `getAgentProviderCredentials()`
- `getAgentRunnerStatus()`

Existing components already cover parts of the surface:

- `agent-session-setup-panel.svelte`
- `agent-session-chat-panel.svelte`
- `agent-operation-plan-review-panel.svelte`
- `agent-runner-status-panel.svelte`

Current websocket events cover assistant streaming and operation plans:

- `assistant-message-delta`
- `assistant-message-created`
- `runner-error`
- `operation-plan-ready`
- `operation-plan-applied`

There is no browser websocket event for pending or updated tool approvals yet.
The first implementation can poll `getToolCalls()` for the selected session.
Adding tool-call websocket events is a later polish item and should be
coordinated with MCP work if it touches tool service internals.

## Product Shape

The Assistant page becomes a workspace:

```text
+-----------------------------+------------------------------------------+
| session sidebar              | selected conversation                    |
|                              |                                          |
| New chat                     | session header                           |
| Search chats                 | chat transcript                          |
|                              |                                          |
| Needs approval               | pending approval cards / plan review     |
| Portugal trip                | composer                                 |
| Review plan                  |                                          |
| Ski weekend                  |                                          |
| Completed                    |                                          |
+-----------------------------+------------------------------------------+
```

Use "Claude-like" as the interaction pattern, not as a visual clone. The UI
should stay consistent with Gallery: quiet, dense, operational, and optimized for
repeated use.

## Layout

### Desktop

- Left sidebar width: roughly `280px` to `320px`.
- Right pane fills remaining width.
- Sidebar is full-height inside `UserPageLayout`.
- Right pane is a column:
  - session header;
  - scrollable conversation body;
  - action dock for approvals/plan review when needed;
  - composer.
- Avoid nesting page cards inside other cards. Individual session rows,
  approval prompts, and operation groups may use small bordered cards.

### Mobile

- Sidebar becomes a drawer opened from the conversation header.
- Session list remains reachable without navigating away.
- Action dock becomes a bottom sheet above the composer.
- Operation groups should collapse by default if the plan has many operations.

## Session Sidebar

The sidebar should show:

- `New chat` button.
- Search/filter input for local loaded sessions.
- Session rows grouped loosely by recency:
  - Today;
  - Yesterday;
  - Previous 7 days;
  - Older.
- Each row:
  - title;
  - short metadata line;
  - status badge when actionable or terminal.

Status badges:

- `Needs approval` for `waiting_for_tool_approval`.
- `Review plan` for `waiting_for_plan_review`.
- `Running` for `running`.
- `Interrupted` for `interrupted`.
- `Applying` for `applying`.
- `Done` for `completed`.
- `Cancelled` for `cancelled`.
- `Failed` for `failed`.

Session row title rules for the first implementation:

1. If a durable `title` field exists, use it.
2. Otherwise, after a session is selected and messages load, use the first user
   text message as an in-memory title preview.
3. Otherwise, show `New chat`.

Deferred durable title follow-up:

- Add nullable `agent_session.title`.
- Set it from the first user text message, trimmed and truncated to about 60
  characters.
- Do not call a model to generate titles in this slice.

The first implementation must not add the durable title field. The UI should
still be written so it can consume a future title without structural
refactoring.

## Right Pane

### Empty State

When no session is selected:

- Show the session setup panel as the primary content.
- Keep runner status visible, but reduce it to a compact banner or header item.
- If the runner is unavailable or credentials are missing, keep the existing
  disabled-state messaging.

### Selected Session Header

The selected session header should include:

- session title;
- status badge;
- provider credential label;
- model;
- approval mode;
- overflow/details action.

Header actions:

- `Cancel` for active cancellable sessions.
- `New chat`.
- `Open session details` for snapshots and runner capabilities.

The current "Created session" summary card should move into a details popover or
drawer. It should not occupy persistent vertical space in the conversation.

### Conversation Body

The transcript remains the core surface.

Render message blocks:

- text blocks as chat bubbles;
- tool-call blocks as compact references that can scroll to the matching
  approval/audit card;
- plan blocks as compact references that can scroll to the current plan card.

The chat body should load from `getAgentSessionMessages({ id })` when the
selected session changes. Websocket events update only the selected session in
place and refresh the sidebar status for matching sessions.

### Composer

Composer behavior by session status:

- `running`: enabled unless an assistant response is actively streaming.
- `waiting_for_tool_approval`: disabled for free-form send while pending
  approval cards are actionable.
- `waiting_for_plan_review`: enabled with a placeholder that encourages
  revision feedback; applying the plan remains a separate action.
- `interrupted`: enabled; the primary button can read `Resume`.
- `completed`, `cancelled`, `failed`: disabled; show `Start new chat`.
- `applying`: disabled.

Sending a message to an interrupted session should use the existing
`appendAgentSessionMessage()` path. The server already accepts messages in
`interrupted` status.

## Approval Flow

Tool approvals should be part of the selected conversation workspace, not a
separate page section.

### Approval Data

For the selected session, load `getToolCalls({ id })` and derive:

- pending approvals: `status === pending_approval`;
- recent denied/completed/failed tool calls for audit context.

The first implementation can poll while the selected session is active:

- immediately on session selection;
- after every websocket event for that session;
- every few seconds while status is `running` or `waiting_for_tool_approval`;
- after an approve/deny action.

Future polish can add websocket events:

- `tool-call-pending`;
- `tool-call-updated`.

### Approval Card

Each pending tool call renders as an action card above the composer.

Show:

- tool name in user-readable form;
- request summary;
- data class: metadata, previews, originals, or plan;
- asset count and album count;
- model/provider from the session snapshot;
- started time;
- approve button;
- deny button;
- optional denial reason field.

Approval card copy should emphasize the data exposure, not the internal route or
transport.

Example:

```text
Approve preview access
The assistant wants to read previews for 24 assets.
Provider: OpenAI personal / gpt-5.1

[Approve] [Deny]
```

### After Approval

Approving a tool call records a durable approval. It does not directly mutate
albums.

The runner/tool transport owns retrying the approved call. The UI should not
invent transport-specific behavior. For the first UI slice:

- mark the card as approved after `approveToolCall()`;
- refresh session and tool calls;
- if no assistant activity resumes after a short timeout, leave the composer
  enabled so the user can nudge the assistant.

If a later runner protocol supports explicit approval-result delivery, the UI
can change the primary action to `Approve and continue`.

### Denial

Denying a tool call:

- requires a reason only when the user opens the reason field;
- records `denied`;
- keeps the transcript visible;
- re-enables the composer so the user can redirect the assistant.

Denied approvals should remain visible in a collapsed "Recent activity" area for
the selected session.

## Plan Flow

Operation-plan review should be integrated into the right pane as the active
work item for a session.

### Plan Card Placement

When `getCurrentOperationPlan({ id })` returns a proposed plan:

- show a compact plan summary card in the conversation body near the most recent
  assistant message;
- show the full operation review in the action dock above the composer;
- keep the user close to the chat thread so they can ask for revisions.

If the plan has already been applied:

- show the plan as read-only;
- show applied/skipped/failed status for operations;
- keep the composer disabled because the session is completed.

### Plan Review Actions

The full review keeps the existing behavior:

- group operations by target album;
- show operation type, risk, and asset count;
- allow toggling individual operations;
- preserve dependency blocking;
- apply selected operations through `applyApprovedOperations()`.

Design adjustments for the workspace:

- The plan card should be collapsible.
- The apply button should be sticky within the action dock when the plan is long.
- The selected operation count should be visible near the apply button.
- Applied results should replace the primary action area with a status summary.

### Revision Feedback

For `waiting_for_plan_review`, the chat composer remains enabled. User feedback
such as "split this by city instead" should be sent through the normal message
append path. The runner can then propose a revised plan through the existing
planning tool path.

No browser-facing "revise plan" API is required for this UI design.

## Session Resume Behavior

Selecting an existing session should restore:

- session metadata and status;
- transcript;
- pending tool approvals;
- current operation plan;
- streaming state if a matching websocket event arrives after selection.

Refresh behavior:

- If the URL includes a selected session ID, reload that session.
- If no selected ID exists, select the most recent actionable session:
  1. `waiting_for_tool_approval`;
  2. `waiting_for_plan_review`;
  3. `interrupted`;
  4. most recent `running`;
  5. most recent `applying`;
  6. otherwise no selection/new chat.

URL shape:

- Keep `/assistant`.
- Add a query parameter: `/assistant?session=<sessionId>`.
- Creating or selecting a session updates the query parameter with
  `replaceState` for initial selection and `pushState` for user-driven changes.

This avoids introducing a new SvelteKit route and keeps the sidebar state local
to the Assistant workspace.

## Data Loading Strategy

Page load:

```text
authenticate
get runner status
get provider credentials
get sessions
select initial session from URL or actionable-session heuristic
```

On selected session change:

```text
getAgentSession
getAgentSessionMessages
getToolCalls
getCurrentOperationPlan
```

Use independent requests so partial failures can show localized error states:

- transcript load error in the chat body;
- approval load error in the action dock;
- plan load error in the plan card/dock.

Do not block the whole workspace if one selected-session pane fails.

## Component Plan

Create or refactor toward:

- `agent-assistant-workspace.svelte`
  - owns selected session ID, session list, sidebar state, and URL sync.
- `agent-session-sidebar.svelte`
  - renders the left chat list and new-chat action.
- `agent-session-row.svelte`
  - small row component for title, recency, and status badge.
- `agent-conversation-pane.svelte`
  - owns selected session header, transcript, action dock, and composer.
- `agent-session-header.svelte`
  - compact title/status/model/actions.
- `agent-session-action-dock.svelte`
  - decides whether to show approvals, plan review, applied result, or nothing.
- `agent-tool-approval-card.svelte`
  - pending approval action card.
- `agent-session-details-drawer.svelte`
  - moved version of the current created-session summary.

Refactor existing components instead of rewriting behavior:

- reuse `agent-session-setup-panel.svelte` for new chat;
- reuse transcript loading/sending logic from `agent-session-chat-panel.svelte`;
- reuse plan grouping/apply logic from `agent-operation-plan-review-panel.svelte`;
- keep pure helpers in `agent-session-ui.ts` and `agent-operation-plan-ui.ts`.

## Backend/API Considerations

The first implementation can use existing APIs without backend changes.

Recommended later backend improvements:

- nullable `agent_session.title`;
- lightweight session list DTO with title, last activity, status, and action
  counts;
- websocket events for tool-call pending/updated;
- server-side pagination for long session histories.

Avoid backend changes that overlap with MCP:

- no runner protocol changes;
- no `toolGateway`/`mcpGateway` changes;
- no internal tool route changes;
- no MCP endpoint assumptions;
- no compose/env/package changes.

## MCP Coordination

The MCP design replaces only the runner-to-Gallery tool transport. This
workspace design consumes browser-facing session, transcript, approval, and plan
APIs. It should remain valid after MCP lands.

Potential conflict areas to avoid while MCP is active:

- `agent-runner/**`;
- `server/src/services/agent-runner.service.ts`;
- `server/src/repositories/agent-runner.repository.ts`;
- `server/src/types/agent-runner.types.ts`;
- `server/src/controllers/agent-runner-tool.controller.ts`;
- env/config fields for tool gateway or MCP gateway;
- `e2e/docker-compose.yml`;
- production Dockerfiles and runner packaging.

Safe areas for this design:

- `web/src/routes/(user)/assistant/**`;
- i18n keys for Assistant UI;
- focused web component tests;
- browser-facing session/tool/plan API usage.

If durable titles are added, coordinate only around generated SDK artifacts and
schema migrations. That work should still be independent of MCP transport work.

## Development Method

Implementation must use test-driven development. Do not start by building the
workspace and then backfilling tests. Each visible behavior should follow this
loop:

1. Write or update the focused failing test for the behavior.
2. Run the focused command and confirm it fails for the expected reason.
3. Implement the smallest UI/helper change that makes the test pass.
4. Refactor while keeping the focused test green.
5. Run the relevant Assistant regression suite before moving to the next
   behavior.

Each implementation plan derived from this design should name the red, green,
and regression commands. Prefer small component/helper tests over one broad
snapshot-style test. Use Playwright only for the reload/resume smoke path and
one high-value end-to-end workflow; keep most coverage in focused web tests.

Suggested TDD order:

1. Page load fetches sessions and resolves initial selection.
2. Sidebar renders and selects sessions.
3. URL query synchronization works for initial load, manual selection, and new
   sessions.
4. Conversation pane loads transcript, tool calls, and current plan for the
   selected session.
5. Switching sessions resets draft, streaming, and action-dock state.
6. Pending approval cards approve and deny through the browser-facing API.
7. Plan review moves into the selected-session action dock without losing
   existing apply/toggle behavior.
8. Composer status rules cover running, waiting, interrupted, applying, and
   terminal sessions.
9. Mobile drawer behavior preserves selected-session state.
10. Targeted e2e verifies reload/resume with a selected session.

## Testing Strategy

Web unit/component tests:

- page load fetches runner status, credentials, and sessions.
- empty workspace shows setup panel.
- initial selection honors a valid `?session=<id>` query.
- invalid, missing, or unauthorized session query falls back to the actionable
  session heuristic without crashing.
- actionable-session heuristic prefers tool approval, then plan review, then
  interrupted, then running, then applying.
- sidebar renders sessions sorted by actionable state and recency.
- sidebar derives a temporary title from the first loaded user message and falls
  back to `New chat` when no title source exists.
- sidebar local search filters by temporary title, model, credential label, and
  status badge.
- selecting a session loads transcript, tool calls, and current plan.
- selecting a different session ignores late responses from the previous
  selection.
- URL query selects the matching session on reload.
- creating a session inserts/selects it and updates the URL.
- switching sessions clears draft text and streaming state.
- pending approval cards approve and deny through `approveToolCall()`.
- approval cards show request summary, data class, counts, provider/model, and
  started time without exposing internal transport paths.
- approval API failures leave the card actionable and show an inline error.
- denying with and without an optional reason records the expected payload.
- plan review remains usable after switching away and back.
- completed/applied sessions render read-only plan state.
- interrupted sessions allow resume message send.
- terminal sessions disable the composer.
- cancelling a cancellable session refreshes the selected session and sidebar.
- cancel failures keep the session selected and show an inline error.
- mobile sidebar drawer opens/closes and preserves selected session.
- setup disabled states for missing credentials and unhealthy runner still work
  inside the new workspace.
- websocket events for non-selected sessions update sidebar state without
  polluting the selected transcript or action dock.
- websocket events for the selected session update transcript, streaming state,
  plan state, and session status.
- transcript, tool-call, and plan load errors are localized to their panes and
  do not blank the whole workspace.

Server tests only if backend title/list improvements are included:

- title is derived from the first user message and is user-owned.
- title derivation truncates long messages and ignores empty text.
- session list ordering uses last activity without leaking other users' data.

E2E smoke:

- create a session;
- send a prompt;
- reload `/assistant?session=<id>`;
- transcript and plan/approval state are restored.

Focused regression commands should include:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant
pnpm --dir web check
```

Run the targeted Playwright smoke only after the focused web suite is green.

## Edge Cases

Selection and URL state:

- `?session=` is missing, empty, malformed, unknown, or points to another user's
  session.
- The selected session is deleted or becomes inaccessible while the page is open.
- Browser back/forward changes the query parameter while loads are in flight.
- A new session is created while another selected-session load is still pending.
- The user opens `/assistant` with no sessions and no credentials.
- The user opens `/assistant` with only terminal sessions.
- The user opens `/assistant` with only an `applying` non-terminal session.

Session list and titles:

- Sessions have identical `createdAt` values.
- A loaded transcript has no user messages.
- The first user message has multiple text blocks, only non-text blocks, or very
  long text.
- Temporary titles must not require fetching every transcript on initial page
  load.
- Local search has no matches.

Conversation loading:

- Transcript load fails, but tool calls and plan load succeed.
- Tool-call load fails, but transcript and plan load succeed.
- Plan load fails, but transcript and tool calls load succeed.
- Late responses from an old selected session arrive after the user selects a
  new session.
- Websocket events arrive before the initial transcript load resolves.
- Websocket events arrive for another session.
- The same assistant message arrives from both transcript load and websocket and
  must not duplicate.

Composer and lifecycle:

- Draft text is cleared on session switch but not after a failed send.
- Sending while an assistant response is active is blocked.
- `waiting_for_tool_approval` blocks free-form send only while pending approvals
  are present.
- `waiting_for_plan_review` allows revision feedback while preserving the apply
  action.
- `interrupted` sessions can send a resume message through the normal append
  path.
- `completed`, `cancelled`, `failed`, and `applying` sessions disable sending.
- Cancelling an already-cancelled session is harmless.
- Cancelling while a runner response is streaming clears streaming UI.

Approvals:

- Multiple pending tool calls are shown in stable order.
- Approving one pending call does not approve or hide other pending calls.
- Approval fails because the call was already handled in another tab.
- Approval succeeds but the runner does not immediately continue.
- Denial with an empty optional reason omits the reason or uses the server
  default.
- Denied/completed/failed tool calls remain available as collapsed recent
  activity.
- The UI never exposes internal gateway/MCP URLs, bearer tokens, or raw request
  metadata.

Operation plans:

- No current plan.
- Proposed plan with zero selectable operations after dependency blocking.
- Long plan requiring scroll with sticky apply action.
- Plan is superseded while the user is reviewing it.
- Apply succeeds from another tab while local apply is in progress.
- Apply partially succeeds and leaves failed/skipped operation statuses visible.
- Applied, cancelled, or superseded plans are read-only.
- Switching sessions preserves each session's loaded plan state independently.

Responsive/accessibility:

- Mobile drawer closes on selection and preserves selected session after reopen.
- Keyboard focus moves predictably when opening/closing the sidebar drawer or
  details drawer.
- Approval and apply buttons have stable accessible names.
- Status badges are text-readable and not color-only.
- Long model names, credential labels, session titles, and operation summaries
  wrap without overlapping controls.

## Implementation Slice Recommendation

This design can be implemented as one UI-focused slice if backend title work is
deferred:

1. Add failing page-load and initial-selection tests, then add sessions to page
   load and workspace state.
2. Add failing sidebar tests, then build the left sidebar and selected-session
   URL sync.
3. Add failing conversation-pane tests, then refactor chat into the selected
   conversation pane.
4. Add failing action-dock tests, then add pending approval cards.
5. Add failing plan-workspace tests, then move plan review into the selected
   conversation workspace.
6. Add failing lifecycle tests, then add resume/cancel/new-chat interactions.
7. Run focused Assistant web tests, web type checks, and a targeted e2e
   reload/resume smoke test.

Durable chat titles remain a separate future server/API slice. The first
implementation should stay UI-only and avoid generated-artifact churn during MCP
work.
