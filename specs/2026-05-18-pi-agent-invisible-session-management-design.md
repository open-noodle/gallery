# Pi Agent Invisible Session Management Design

Status: draft design
Date: 2026-05-18
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Context

The Assistant page now has a durable chat workspace, visible session list,
streaming messages, approvals, visual plan review, applied-plan history, and an
optional activity preview. The underlying backend still models the feature as
agent sessions with lifecycle states such as `Running`,
`WaitingForToolApproval`, `WaitingForPlanReview`, `Applying`, `Completed`,
`Cancelled`, `Interrupted`, and `Failed`.

That lifecycle is useful for the system, but the current header exposes too much
of it to the user. A selected chat can show a dense row of controls:

- `Cancel`
- `Activity preview: Compact`
- `Details`
- `New chat`

This makes the workspace feel like a technical session manager instead of a
chat product. `Cancel` is ambiguous, `New chat` duplicates the sidebar action,
and the activity/detail controls are secondary preferences that should not
compete with the conversation.

## Problem

Users do not want to manage agent sessions. They want to open a chat, ask Pi to
do something with their gallery, leave, come back, and continue typing.

The current UI creates several product issues:

- header controls draw attention away from the chat;
- `Cancel` can read like deleting or closing the chat rather than stopping the
  current run;
- `New chat` in the selected-chat header makes it unclear whether the user is
  managing the current chat or creating a separate one;
- `Activity preview` is useful, but it is a preference/debug surface and should
  not be persistent header chrome;
- `Details` is useful for diagnostics, provider snapshots, and runner state, but
  normal users should not have to see it;
- terminal or interrupted session states can make a chat feel closed even though
  the desired product behavior is "keep typing to continue";
- polling-based refresh currently leaks implementation activity into the browser
  network panel and can create subtle UI churn if no-op responses republish
  state.

## Goals

- Make the selected Assistant header feel like a chat header, not a session
  management toolbar.
- Hide secondary controls behind a simple overflow menu.
- Remove duplicated `New chat` from the selected-chat header.
- Rename and reposition `Cancel` into a clear `Stop` action that only stops the
  current run.
- Keep chat creation, selection, deletion, and future rename/archive actions in
  the sidebar.
- Let users resume old chats by typing, even when the underlying runner session
  is stale, terminal, interrupted, or missing.
- Keep backend session lifecycle states authoritative while translating them
  into user-facing chat states.
- Reduce unnecessary polling and no-op UI churn without depending on a real LLM
  in tests.
- Use test-driven development for every implementation slice.

## Non-Goals

- Do not remove backend agent sessions.
- Do not change MCP tool contracts or runner permissions.
- Do not remove cancellation/stop capability.
- Do not remove details, activity preview, or diagnostics; move them out of the
  primary header.
- Do not replace the session sidebar with a different navigation model.
- Do not add model-generated chat titles as part of this spec.
- Do not require Docker, a real runner, or a real provider for fast tests.
- Do not solve long-term chat search, archival policy, or retention settings.

## Brainstormed Approaches

### Option A: Minimal Header Cleanup

Keep the same backend lifecycle and most existing components. Replace the
right-side header button row with a small overflow menu, remove `New chat`, and
rename `Cancel` to `Stop`.

Pros:

- fast, low risk;
- immediately reduces visual noise;
- mostly frontend-only;
- preserves current session APIs.

Cons:

- users may still hit terminal-session composer states later;
- session lifecycle remains visible in edge cases;
- polling behavior remains mostly unchanged.

### Option B: Chat Shell With Hidden Session Lifecycle

Treat sessions as an implementation detail in the UI. The selected chat header
shows title, subtle status, and overflow only. The composer always reads like a
chat composer unless an approval or plan review blocks progress. Sending a
message to an old/stale chat automatically creates or reconnects a runner
continuation behind the scenes.

Pros:

- matches the desired ChatGPT/Claude interaction model;
- users can resume chats naturally;
- reduces user-visible lifecycle concepts;
- creates a coherent long-term product model.

Cons:

- needs backend resume/reconnect work;
- requires careful tests for stale, interrupted, terminal, and runner-missing
  states;
- requires a clearer distinction between stopping a run and deleting a chat.

### Option C: Full Chat Product Reset

Redesign the Assistant page around a first-class `Chat` domain and gradually
make `AgentSession` a private implementation record. Add chat deletion,
renaming, archiving, status summaries, auto-reconnect, event-driven refresh, and
eventual retention controls.

Pros:

- cleanest domain model;
- best long-term product foundation;
- reduces future UI/backend mismatch.

Cons:

- too large for the next implementation pass;
- high migration and compatibility risk;
- distracts from the immediate header and resume UX problems.

## Recommended Direction

Use Option B, delivered in vertical slices. Start with the visible header cleanup
from Option A, then make session lifecycle progressively invisible where it
affects normal chat use.

The user-facing mental model should be:

- a sidebar contains chats;
- selecting a chat opens its conversation;
- `New chat` lives in the sidebar;
- old chats can be resumed by typing;
- `Stop` only stops Pi's current work;
- `Delete chat` removes a chat from the sidebar;
- activity preview and details are optional menu items.

The implementation can continue using `AgentSession` records, statuses, runner
session ids, tool calls, and operation plans internally.

## UX Shape

### Header

The selected chat header should be quiet:

```text
+--------------------------------------------------------------+
| Chat title                         Running              ... |
| openapi · gpt-5.1 · Plan review only                        |
+--------------------------------------------------------------+
```

Header requirements:

- left side:
  - discovered or fallback chat title;
  - compact status badge only when useful;
  - provider/model/permission summary as subdued metadata.
- right side:
  - one overflow menu button using a familiar three-dot icon.

Header must not show:

- `New chat`;
- persistent `Details`;
- persistent `Activity preview: Compact`;
- ambiguous `Cancel`;
- persistent `Stop`.

### Overflow Menu

The overflow menu owns secondary actions:

- `Activity preview`
  - `Off`
  - `Compact`
  - `Expanded`
- `Details`
- `Delete chat` once deletion/archive behavior exists
- `Stop current run` when the current chat is actively running and stoppable.

The menu should use concise labels. It should not expose "session" in visible
copy unless the details drawer explicitly needs technical diagnostics.

### Stop Behavior

Use `Stop`, not `Cancel`, for active generation/application work.

`Stop` means:

- stop the current Pi run;
- preserve the chat and transcript;
- keep the composer usable afterward where possible;
- do not delete the chat;
- do not hide already-created messages, plans, approvals, or applied results.

Placement:

- the overflow menu should include `Stop current run` when the current chat is
  stoppable;
- a future high-urgency stop affordance may live near the composer or active
  activity block while Pi is working, but not as permanent selected-header
  chrome.

### Sidebar

The sidebar is where chat-level management belongs:

- `New chat`;
- session/chat list;
- search;
- future row menu for delete/rename/archive.

Selected-chat header actions should not duplicate sidebar actions.

### Composer And Resume

The long-term composer should behave like chat:

- if a chat can accept text, the composer is enabled;
- sending a message to a stale or terminal backend session reconnects or creates
  a continuation automatically;
- users should not need to start a new session just because the old runner
  session ended;
- approval and plan-review blockers may still disable or redirect the composer
  because user action is required before Pi can continue safely.

Backend lifecycle remains authoritative, but the frontend maps it to chat-level
states:

- `Running`: Pi may be working; composer disabled while awaiting response.
- `WaitingForToolApproval`: show approval action surface; composer can remain
  disabled or offer a clear "respond after approval" affordance.
- `WaitingForPlanReview`: show plan review; composer can remain disabled until
  apply/skip is resolved.
- `Interrupted`: composer enabled; next send attempts recovery.
- `Completed`: composer enabled; next send creates/uses continuation.
- `Cancelled`: composer enabled if the chat was only stopped, not deleted.
- `Failed`: composer enabled when failure is recoverable; otherwise show a
  clear retry/new-chat action.

### Details Drawer

The details drawer remains useful, but it should be secondary:

- provider credential snapshot;
- model snapshot;
- permission preset;
- approval mode;
- runner endpoint/session id;
- protocol/capability diagnostics;
- timestamps and terminal error metadata.

It should be opened from the overflow menu, not a persistent header button.

### Activity Preview

Activity preview remains available, but not as permanent chrome.

Rules:

- default selected mode persists per chat as already designed;
- the current mode can be changed from the overflow menu;
- active preview blocks stay in the transcript, not in the header;
- no-op polling or cached responses must not republish state and cause activity
  preview flicker.

## Architecture

### Components

Primary components likely affected:

- `agent-session-header.svelte`
- `agent-session-header.spec.ts`
- `agent-activity-visibility-menu.svelte`
- `agent-conversation-pane.svelte`
- `agent-session-action-dock.svelte`
- `agent-session-chat-panel.svelte`
- session sidebar/list components
- future chat row overflow component

Recommended component boundary:

- `AgentSessionHeader`
  - renders title, metadata, status, and overflow trigger;
  - exposes callbacks for menu actions;
  - does not know how actions are implemented.
- `AgentSessionOverflowMenu`
  - owns menu items and activity visibility controls;
  - shows `Stop current run` only when supplied;
  - shows `Delete chat` once deletion exists.
- `AgentConversationPane`
  - maps session lifecycle into chat affordances;
  - owns higher-level stop/resume/delete callbacks.
- `AgentSessionChatPanel`
  - owns transcript and composer behavior;
  - delegates "send to stale chat" to a session continuation API once available.

### Backend

Initial header cleanup should not require backend changes.

Later invisible-session slices likely need backend support for:

- deleting chats/sessions from the user's sidebar;
- resuming a chat with a missing or stale runner session;
- creating a continuation session from an old session while preserving transcript
  context or linking history;
- distinguishing `stop current run` from `delete chat`;
- event-driven updates that reduce selected-session polling.

Backend APIs should keep the `AgentSession` name internally. Browser-facing copy
and component names may gradually move toward "chat" where user-facing.

## Data Flow

### Current Header Cleanup

1. `AgentConversationPane` receives selected `AgentSessionResponseDto`.
2. It computes whether stop is available from existing cancellable status logic.
3. It passes menu action callbacks to `AgentSessionHeader`.
4. Header renders one overflow trigger.
5. Menu actions call existing callbacks:
   - activity mode update;
   - open details drawer;
   - stop current run.

### Future Resume Flow

1. User opens an old chat.
2. Frontend loads messages, plans, tool calls, applied plans, activity events.
3. Composer is enabled when no approval/plan blocker exists.
4. User sends a message.
5. Backend checks whether the existing runner session can continue.
6. If not, backend creates/reconnects runner state using safe session context.
7. New user message appears in the same chat transcript.
8. Pi continues with normal streaming/tool/plan events.

## Testing Strategy

Every slice must use TDD: write failing tests first, run the focused red test,
make the smallest implementation change, then rerun focused and relevant
regression tests.

Fast tests must not require Docker, a real runner, a real provider, or network
calls outside mocked SDK boundaries.

Implementation plans created from this spec must include:

- the first failing test or test group for the slice;
- the focused command that proves the test is red;
- the smallest implementation target needed to make it green;
- regression commands for nearby assistant UI, session lifecycle, websocket, and
  backend ownership behavior touched by the slice;
- at least one negative/error-path test for each new public action or endpoint;
- accessibility assertions for menu, stop, delete, and resume controls whenever
  a visible control is introduced.

## Test Coverage Matrix

| Area                         | Required Coverage                                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Header cleanup               | Component tests for title/status/metadata truncation, absence of persistent `New chat`, absence of persistent `Details`, absence of persistent activity mode button, and overflow-only secondary actions.                    |
| Overflow menu                | Component tests for keyboard open/close, click-outside/escape behavior if supported by the local menu primitive, focus return, activity mode radio state, details action, conditional stop action, and future delete action. |
| Stop semantics               | Unit/component tests that `Stop current run` only appears for stoppable states, calls the existing cancellation path, preserves transcript/action cards, and does not disable unrelated menu items while pending.            |
| Sidebar ownership            | Component tests that sidebar `New chat` remains the creation path, selected-chat header does not duplicate it, and row-level menus do not disturb selected chat state.                                                       |
| Resume/reconnect             | Service/API tests for completed, cancelled, interrupted, failed, missing-runner-session, stale-runner-session, and runner-reconnect-failure flows; component tests for composer enabled/disabled states.                     |
| Delete/archive               | API ownership tests, confirmation UI tests, selected-chat deletion behavior, deletion of active/blocking chats, deletion failures, and another-user denial.                                                                  |
| Polling reduction            | Tests for inactive-session no polling, active-session minimal polling, websocket-first updates, missed-event fallback, stale/out-of-order responses, HTTP 304/cached responses, and no-op dedupe before parent publication.  |
| Activity preview interaction | Tests that moving activity mode into the overflow menu preserves persisted per-chat visibility and does not flicker when equivalent tool-call/activity state is reloaded.                                                    |
| Accessibility/mobile         | Keyboard navigation, accessible names, screen-reader status labels, focus management, narrow viewport header layout, and touch target sizing for header/menu actions.                                                        |

## Edge Cases

- Active run can be stopped without deleting the chat.
- `Stop` is not shown when the session cannot stop.
- Overflow menu remains keyboard accessible.
- Overflow menu closes predictably on escape, outside click, route/session
  change, and successful action.
- Focus returns to a stable element after menu actions.
- Header title truncates without pushing overflow off screen.
- Activity mode can be changed from the overflow menu.
- Removing `New chat` from header does not remove sidebar new-chat behavior.
- Details drawer still opens from the menu.
- Pending approval still remains prominent and actionable.
- Plan review remains prominent and actionable.
- Applied-plan cards remain in transcript after apply.
- Opening an old completed chat does not imply it is closed forever.
- Sending to a stale runner session recovers or creates continuation.
- Sending to an interrupted session retries/reconnects without duplicating the
  prior user message.
- Sending to a completed/cancelled session preserves permission/model snapshots
  or fails before persisting a new user message.
- Sending while a reconnect is already in flight is deduped or rejected with a
  recoverable error.
- Sending to a deleted chat is blocked with a clear error.
- Another user's chat cannot be opened, resumed, stopped, deleted, or listed.
- Stop/delete/resume requests for stale selected-session ids do not mutate the
  newly selected chat.
- Deleting a chat with pending approval or plan review has explicit behavior and
  cannot leave orphaned action cards in the visible sidebar.
- Runner unavailable, credential missing, provider model missing, or MCP gateway
  unavailable states show recoverable user copy without exposing secrets.
- No-op polling responses do not republish identical tool-call/activity state.
- Out-of-order polling responses do not roll the visible state backward.
- Cached HTTP 304 responses do not trigger activity-preview flicker.
- Websocket events for non-selected sessions do not update the selected chat.
- Multi-tab activity visibility changes stay scoped to the intended chat.
- Unsaved composer draft survives opening/closing the overflow menu and details
  drawer.
- Mobile header does not overflow or create cramped button rows.
- Screen readers get clear labels for overflow, stop, and status.

## Slices

### Slice 1: Quiet Header And Overflow Menu

Goal: remove the noisy button row and make the selected chat header feel like a
chat header.

Scope:

- remove persistent `New chat` from selected-chat header;
- move `Activity preview` and `Details` into a three-dot overflow menu;
- rename `Cancel` copy to `Stop` in menu/callback surfaces;
- show only title, subtle status, metadata, and overflow in normal state;
- preserve existing callbacks and behavior.

Tests:

- header renders no `New chat` button;
- header renders no standalone `Details` or `Activity preview` buttons;
- overflow menu opens from an accessible three-dot button;
- activity visibility options work from the menu;
- details callback works from the menu;
- stop action appears only when supplied;
- menu action callbacks do not fire for disabled/unavailable actions;
- long title and metadata remain bounded;
- mobile/narrow layout does not overflow action controls.

### Slice 2: Contextual Stop Semantics

Goal: make stopping Pi's current work clear and safe.

Scope:

- replace user-facing `Cancel` labels with `Stop`;
- ensure stop copy describes stopping current work, not deleting/closing chat;
- move stop into the overflow menu for the selected-chat header;
- leave room for a future composer/activity-adjacent stop affordance during
  active work;
- keep transcript, approvals, plans, and applied-plan history after stop.

Tests:

- stoppable active chats show `Stop`;
- non-stoppable chats do not show stop action;
- clicking `Stop` calls existing cancel endpoint/callback;
- stopped chat remains visible in sidebar and transcript;
- stopped chat keeps user, assistant, approval, plan, and applied-plan timeline
  items visible;
- stop failure leaves the chat usable and shows a recoverable error;
- concurrent stop clicks are deduped while the first stop is pending;
- stop-disabled state does not disable unrelated menu actions.

### Slice 3: Sidebar Owns Chat Management

Goal: put chat-level actions where users expect them.

Scope:

- keep `New chat` in the sidebar as the primary creation action;
- add or prepare a row overflow menu for future chat actions;
- add `Delete chat` design surface if backend support exists, otherwise include
  disabled/follow-up state in the spec plan;
- avoid selected-header duplication of sidebar controls.

Tests:

- sidebar new-chat remains accessible;
- selected header has no new-chat action;
- row menu actions are keyboard accessible;
- delete action is not shown until implementation is safe;
- row menu open/close does not steal composer draft or scroll position;
- selecting another chat while a row menu is open closes the stale menu;
- selected chat state is preserved when opening row menus.

### Slice 4: Invisible Resume For Old Chats

Goal: old chats should be resumable by typing instead of requiring users to
understand terminal sessions.

Scope:

- define frontend composer state for completed/cancelled/interrupted/failed
  sessions;
- add backend continuation or reconnect behavior for stale runner sessions;
- keep transcript continuity in the same chat;
- recover runner session id when safe;
- surface clear errors only when continuation is impossible.

Tests:

- completed chat enables composer;
- cancelled chat caused by stopping current work enables composer;
- interrupted chat enables composer and sends recovery request;
- failed chat enables composer only when the failure is marked recoverable;
- missing runner session creates/reconnects runner state before dispatch;
- stale runner session id is replaced before sending to the runner;
- waiting-for-approval and waiting-for-plan-review still block appropriately;
- continuation preserves provider/model/permission snapshots or fails with a
  clear recoverable error;
- continuation failure does not leak provider secrets, runner tokens, MCP tokens,
  prompts, or raw tool payloads;
- overlapping sends during reconnect do not create duplicate messages or runner
  requests;
- no duplicate user messages are persisted on reconnect failure.

### Slice 5: Delete Chat And Lifecycle Copy

Goal: make destructive chat management explicit while keeping lifecycle details
out of the main flow.

Scope:

- add safe delete/archive behavior if product chooses deletion;
- use `Delete chat`, not session terminology;
- confirm destructive action;
- remove deleted chat from sidebar and clear selection;
- keep server ownership checks authoritative.

Tests:

- delete requires confirmation;
- deleted chat disappears from sidebar;
- deleting selected chat returns to empty/new-chat state;
- another user's chat cannot be deleted;
- failed delete keeps the chat visible and shows recoverable copy;
- pending approval/plan review deletion behavior is explicit and tested;
- active-running delete either stops first or is blocked with explicit copy;
- delete/archive behavior cascades or hides messages, tool calls, plans, applied
  plans, and activity events according to the chosen backend model.

### Slice 6: Reduce Polling And No-Op UI Churn

Goal: stop browser network spam and prevent cached/no-op refreshes from
perturbing visible chat state.

Scope:

- keep polling only while truly needed;
- avoid polling selected session status every tool-call poll unless necessary;
- prefer websocket events for session, tool-call, activity, and plan updates;
- preserve a low-frequency fallback for missed events;
- dedupe state before publishing to parent components.

Tests:

- inactive chats do not poll;
- active chats poll at most the minimal required endpoint set;
- selected session status is not polled every tool-call interval unless a test
  proves the fallback is required;
- cached/unchanged responses do not republish equivalent state;
- HTTP 304/cached tool-call and session responses do not alter visible activity
  state;
- websocket events update selected chat without waiting for poll;
- missed websocket fallback eventually refreshes;
- out-of-order fallback responses are ignored;
- polling stops when switching sessions and does not update the new selection
  with old responses;
- polling stops after terminal or blocked states where it is no longer useful.

### Slice 7: Mobile And Accessibility Polish

Goal: ensure the simplified header works on small screens and assistive tech.

Scope:

- validate touch targets;
- ensure overflow menu is reachable by keyboard and screen readers;
- avoid cramped metadata or clipped status text;
- keep activity/details/stop reachable without persistent button noise.

Tests:

- menu trigger has accessible name;
- menu supports keyboard open/close/selection;
- narrow viewport keeps title and overflow visible;
- status is announced without excessive repetition;
- destructive and stop actions have distinguishable accessible names;
- activity visibility radio/menu state is announced correctly;
- focus returns predictably after menu actions.

## Open Decisions

Recommended defaults:

- Use `Stop` as the visible action name.
- Remove `New chat` from selected-chat header immediately.
- Put `Activity preview` and `Details` in the overflow menu immediately.
- Put selected-chat `Stop` in the overflow menu rather than the persistent
  header row.
- Keep a subtle status badge in the header for now.
- Treat "chat" as user-facing language and "session" as implementation
  language.
- Defer delete/resume backend work until after header cleanup.

Decisions to make during implementation planning:

- Whether a later active-run stop affordance should appear near the composer,
  the activity block, or remain menu-only.
- Whether completed/cancelled chats reuse the same `AgentSession` id on next
  message or create a linked continuation record.
- Whether delete means hard delete, soft delete, or archive/hide.
- How low the fallback polling frequency can be after websocket coverage is
  improved.

## Spec Self-Review Notes

- No placeholders or TBDs remain.
- Header cleanup is intentionally separated from backend continuation work.
- The spec keeps backend sessions while changing user-facing language to chats.
- Testing requirements are listed per slice and do not depend on real providers.
- The largest backend uncertainty is continuation semantics; that is isolated in
  Slice 4 rather than blocking the immediate UX fix.
