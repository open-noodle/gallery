# Pi Agent Activity Transparency Design

Status: draft design
Date: 2026-05-18
Worktree: `/home/pierre/dev/gallery/.worktrees/pi-agent-brainstorm`
Branch: `explore/pi-agent-brainstorm`

## Context

Pi can now stream assistant responses, request tool permission, propose visual
operation plans, apply plans, and continue the same session afterward. The chat
experience is becoming useful, but users still have little insight while Pi is
working. During long-running requests the UI can look idle or stuck until a
permission card, plan, or final response appears.

The existing system already records useful signals:

- user and assistant messages;
- assistant streaming deltas;
- session statuses such as `Running`, `WaitingForToolApproval`,
  `WaitingForPlanReview`, and `Applying`;
- audited tool calls with pending, approved, denied, completed, and failed
  states;
- operation-plan ready/applied events;
- applied-plan history.

The missing product layer is a user-readable activity preview that explains
what Pi is doing in the moment without turning the chat into raw logs.

## Problem

When Pi is busy, users cannot tell whether it is:

- thinking through the request;
- searching albums or photos;
- reading metadata or previews;
- waiting on a tool approval;
- preparing a plan;
- applying changes;
- stuck on a runner/tool error.

The current fallback is a generic busy indicator. That is not enough for long
photo-library workflows, especially when reading hundreds of assets or building
a plan takes several seconds.

At the same time, showing raw tool names, JSON payloads, prompts, provider
events, or private model reasoning would make the UI too technical and could
leak implementation details. The activity preview must expose observable work,
not hidden chain-of-thought.

## Goals

- Give users opt-in visibility into what Pi is doing while a turn is active.
- Keep the default chat calm and simple.
- Render one live activity block per assistant turn instead of many log cards.
- Use plain-language activity rows by default.
- Keep permission requests, plan reviews, and applied-plan cards as separate
  first-class chat items.
- Persist or reconstruct enough activity that reload does not make the session
  confusing.
- Make technical details available behind an explicit expand control for
  debugging.
- Avoid exposing hidden reasoning, provider internals, secrets, raw tokens, or
  unredacted payloads.
- Use test-driven development for every implementation slice.

## Non-Goals

- Do not expose model chain-of-thought or raw provider reasoning traces.
- Do not show every low-level MCP request as a separate chat message.
- Do not replace the permission approval UI.
- Do not replace operation plan previews or applied-plan cards.
- Do not add direct apply behavior.
- Do not require a real LLM provider in tests.
- Do not require Docker or one-click provisioning for the fast test suite.
- Do not make activity visibility mandatory for all users.

## Recommended Direction

Add an opt-in `Activity preview` layer to the assistant chat. The UI should show
a single live activity block directly after the user message that triggered Pi's
current work.

Default collapsed view:

```text
You
Find my best Portugal photos and make an album.

Pi is working...                                      Show activity
Searching photos
Reading photo details
Preparing a plan
```

Expanded view:

```text
Pi is working...                                      Hide activity

[done] Understood request
  Looking for Portugal photos and quality signals.

[done] Searched photos
  Found 284 matching photos.

[working] Reading photo details
  Checking dates, ratings, albums, and previews.

[pending] Preparing a plan
  Waiting for photo details to finish.
```

Completed collapsed view:

```text
Activity summary
Searched photos, read details for 284 photos, prepared a plan.
```

The activity block should sit in the normal chat timeline:

```text
User message
Live or summary activity block
Permission card, if needed
Assistant response or plan review
Applied plan card, if approved
Next user message
```

## UX Principles

### One Block Per Turn

Activity should update in place. A single assistant turn may involve multiple
tool calls, a permission pause, streaming assistant text, and a plan. Those
events should be grouped into one readable block rather than appended as many
technical log rows.

### Collapsed By Default

Normal users should see only a compact hint. The collapsed block should show:

- current state, for example `Pi is working...`;
- up to three concise current/recent steps;
- a `Show activity` affordance;
- a subtle spinner only while active.

### Expanded On Demand

Expanded mode should show a vertical step list:

- status icon: pending, running, completed, blocked, failed;
- plain-language title;
- one-line summary;
- optional count/progress;
- timestamp or duration only when useful;
- `Technical details` disclosure for raw-ish debugging fields.

### Human Labels First

Default copy should say:

- `Searching photos`
- `Reading details for 42 photos`
- `Checking album membership`
- `Preparing a plan`
- `Waiting for your approval`
- `Applying 12 changes`
- `Added 12 photos to "Family"`

It should not say:

- `mcp_gallery_readAssetMetadata`
- `POST /agent/sessions/:id/tools/:toolCallId/approve`
- raw JSON request bodies
- DTO names
- provider event names

### Permission Requests Stay Separate

Approval cards are action surfaces, not passive activity. If Pi needs access,
the activity block can say `Waiting for your approval`, but the actionable
permission card remains separate and prominent.

### Plan And Apply Stay Structured

Plan review cards and applied-plan cards remain their own structured chat items.
The activity block can summarize `Prepared a plan`, but it should not duplicate
the plan preview UI.

### Technical Details Are Explicit

Each activity row may expose a `Technical details` section for debugging:

- tool name;
- tool call id;
- safe request summary;
- safe response summary;
- redacted error;
- started/completed timestamps.

Technical details should use the same redacted metadata already used for tool
approval and audit cards. They should never include provider API keys, runner
tokens, raw prompts, or hidden reasoning.

## Product Model

### Visibility Modes

Recommended modes:

- `Off`: show only the existing busy indicator and required action cards.
- `Compact`: show the collapsed live activity block with safe step labels and a
  `Show activity` affordance.
- `Expanded`: keep the activity block expanded for this session.

Initial rollout should default to `Compact` while Pi is actively working: users
see a small `Pi is working...` teaser and can opt in to detailed activity from
that block. `Expanded` should be a per-session choice. `Off` can be added as a
user preference or session-menu option, but it must still leave a discoverable
way to re-enable activity from the session menu. A later slice can remember the
user's preferred mode.

### Turn Association

The activity block should be associated with the user turn that triggered it.
For the first implementation, the UI can derive grouping from existing
timestamps:

- start at a user message;
- include following tool calls, plan events, streaming state, and applied-plan
  events until the next user message or terminal assistant output;
- keep stable sorting by timestamp and id.

If timestamp grouping becomes ambiguous, introduce an explicit `turnId` or
`triggerMessageId` on messages, tool calls, plans, and activity events. Do not
block the initial UI on a schema migration if the existing transcript ordering
is sufficient.

### Activity Item Shape

The UI should normalize existing events into an internal view model:

```ts
type AgentActivityItem = {
  id: string;
  sessionId: string;
  turnId?: string;
  kind:
    | 'understanding'
    | 'search'
    | 'metadata'
    | 'preview'
    | 'album'
    | 'space'
    | 'plan'
    | 'permission'
    | 'apply'
    | 'message'
    | 'error'
    | 'unknown';
  status: 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'skipped';
  title: string;
  summary?: string;
  count?: number;
  startedAt: string;
  completedAt?: string;
  technical?: AgentActivityTechnicalDetails;
};
```

This does not need to be a public API shape in the first slice. It can be a
frontend-only model derived from persisted messages, tool calls, plans, and
session state.

### Activity Sources

Use existing durable sources first:

- tool calls from `getToolCalls`;
- message deltas and persisted messages;
- current operation-plan endpoint;
- applied operation-plan history endpoint;
- session status;
- websocket `on_agent_session_event` updates.

Add explicit activity events only for gaps that cannot be inferred cleanly:

- runner started processing a user turn before any tool call exists;
- runner is composing a plan after tool calls finish;
- applying plan progress across many operations;
- runner retry/recovery state after a transient failure.

## Activity Vocabulary

Each known Gallery tool should map to a stable activity label. Examples:

| Tool or source      | Running title          | Completed summary               |
| ------------------- | ---------------------- | ------------------------------- |
| `listAlbums`        | Searching albums       | Found matching albums           |
| `searchAssets`      | Searching photos       | Found matching photos           |
| `readAssetMetadata` | Reading photo details  | Read details for photos         |
| `readAssetPreviews` | Loading photo previews | Loaded photo previews           |
| plan proposal       | Preparing a plan       | Prepared a plan                 |
| permission pending  | Waiting for approval   | Needs your approval to continue |
| plan apply          | Applying changes       | Applied selected changes        |
| assistant delta     | Writing response       | Wrote a response                |
| runner error        | Pi hit a problem       | Could not finish this step      |

Unknown tools should fall back safely:

- running: `Working with Gallery`
- completed: `Checked Gallery data`
- failed: `Gallery step failed`

Technical details can still show the raw tool name when expanded.

## Architecture

```text
Runner/SSE events
  -> AgentRunnerService websocket events

Agent tool audit rows
  -> getToolCalls
  -> activity view model

Agent operation plans
  -> current/applied plan endpoints
  -> activity view model

Agent session status
  -> active/blocking/completed state
  -> live activity block state

AgentSessionChatPanel
  -> merges messages, tool calls, applied plans, and activity blocks
```

The first implementation should prefer frontend composition over new backend
storage. Backend changes are justified when activity cannot be reconstructed
after reload or when applying a plan needs granular progress events.

## Persistence Strategy

### Phase 1: Derived Activity

Derive activity from durable records already persisted:

- messages;
- tool calls;
- operation plans;
- applied plans;
- session status.

This covers most useful user-facing states and avoids a new table.

### Phase 2: Explicit Activity Events

If needed, add an `agent_activity_event` persistence model:

- `id`
- `sessionId`
- `turnId` or `triggerMessageId`
- `kind`
- `status`
- `titleKey`
- `summary`
- `count`
- `startedAt`
- `completedAt`
- `redactedTechnicalMetadata`

Events should be append-only except for safe status completion updates. They
should be compact enough to load with the transcript and should not store raw
provider traces.

## UI Components

Likely new components:

- `AgentActivityBlock.svelte`
- `AgentActivityRow.svelte`
- `agent-activity-ui.ts`
- `agent-activity-ui.spec.ts`
- `agent-activity-block.spec.ts`

Likely modified components:

- `agent-session-chat-panel.svelte`
- `agent-session-chat-panel.spec.ts`
- `agent-session-action-dock.svelte`
- `agent-session-action-dock.spec.ts`
- assistant settings or session menu component for the activity visibility
  toggle.

## TDD Requirements

Every implementation slice must be test-first:

1. Write focused failing tests for the slice.
2. Run the focused command and confirm it fails for the expected reason.
3. Implement the smallest change that satisfies the tests.
4. Run focused tests green.
5. Run relevant regression checks.

Tests should use deterministic fake SDK/runner data and must not call a real LLM
provider.

Every implementation plan derived from this spec must list:

- red test commands that fail before implementation;
- focused green test commands for the slice;
- regression commands for affected web/server/runner surfaces;
- the exact edge cases from this spec that the slice covers;
- any edge cases intentionally deferred to a later slice.

## Edge Case Matrix

| Area          | Case                                     | Expected result                                                                         |
| ------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| Visibility    | Activity preview off                     | No activity block renders; required permission/plan cards still render                  |
| Visibility    | Activity preview off, user wants it back | Session menu exposes an activity toggle that can restore compact or expanded mode       |
| Visibility    | Compact default                          | Only safe step labels and `Show activity` render; technical details stay hidden         |
| Visibility    | User expands one activity block          | Block shows rows and remembers expanded state for that session view                     |
| Visibility    | User collapses while running             | Live updates continue without forcing the block open                                    |
| Turn grouping | One user message, one tool, one response | Activity block appears between the user message and response                            |
| Turn grouping | Two user messages close together         | Each turn gets its own activity block; no cross-turn leakage                            |
| Turn grouping | Same timestamp items                     | Deterministic sort by timestamp, type priority, then id                                 |
| Live updates  | Tool call starts after user message      | Block adds a running row without duplicating old rows                                   |
| Live updates  | Tool completes                           | Row changes to completed and summary/count updates                                      |
| Live updates  | Assistant streaming starts               | Block can show `Writing response`; streamed text still renders normally                 |
| Live updates  | Plan becomes ready                       | Activity says `Prepared a plan`; plan review renders separately                         |
| Live updates  | Plan apply starts                        | Activity says `Applying changes`; applied-plan card renders after completion            |
| Permissions   | Tool needs approval                      | Activity says `Waiting for approval`; approval card remains prominent                   |
| Permissions   | Approval accepted                        | Activity updates to approved/continuing; agent continuation can stream below            |
| Permissions   | Approval denied                          | Activity shows denied/not allowed; denial reason appears only if product copy wants it  |
| Reload        | Reload while running                     | Derived activity rehydrates from persisted tool calls/session status                    |
| Reload        | Reload during pending approval           | Activity and approval card both return                                                  |
| Reload        | Reload after completion                  | Completed activity summary remains stable or is reconstructed                           |
| Errors        | Tool fails                               | Row shows safe failed state; technical details include redacted error                   |
| Errors        | Runner fails before first tool call      | Block shows `Pi hit a problem`; composer recovery follows session state                 |
| Errors        | Unknown tool name                        | Generic human copy renders; raw name only in technical details                          |
| Privacy       | Provider key appears in error            | Redacted from activity row and technical details                                        |
| Privacy       | Runner token appears in metadata         | Redacted from all UI and websocket payloads                                             |
| Privacy       | Provider emits reasoning trace           | Not displayed unless it is an explicitly safe summary; raw chain-of-thought never shown |
| Performance   | Long session with many tool calls        | Activity rows are grouped/collapsed; chat stays responsive                              |
| Performance   | Many repeated metadata calls             | Rows are coalesced into one `Reading photo details` group with aggregate counts         |
| Accessibility | Expanded row controls                    | Toggle buttons have labels, keyboard support, and visible focus                         |
| Accessibility | Live updates                             | Use polite live regions; do not repeatedly announce every minor progress tick           |
| Accessibility | Activity expands while focused elsewhere | Focus is not stolen from composer, approval buttons, or plan controls                   |

## Test Matrix

### Web View Model Tests

Use `agent-activity-ui.spec.ts` for pure derivation tests:

- maps known tool names to plain-language labels;
- maps statuses to pending/running/blocked/completed/failed rows;
- coalesces repeated tool calls of the same kind;
- preserves stable ordering;
- redacts or excludes unsafe technical fields;
- derives compact summary text from completed rows;
- handles unknown tool names safely.

### Web Component Tests

Use `agent-activity-block.spec.ts` and chat panel tests:

- collapsed block renders current status and `Show activity`;
- expanded block renders rows with status text and summaries;
- technical details are hidden by default and expand on click;
- no raw tool names appear in default view;
- permission cards remain separate;
- plan review and applied-plan cards remain separate;
- live websocket refresh updates an existing block instead of adding duplicates;
- reload data renders the same activity summary.

### Server Tests

Only add server tests when backend changes are needed:

- activity event DTO validation;
- persisted event ownership and ordering;
- websocket event emission and redaction;
- apply-progress event generation;
- no cross-user access to activity history.

### Runner Tests

Only add runner tests if the runner emits new activity events:

- start-processing event emits before first tool call;
- safe activity summaries are forwarded;
- raw provider reasoning is ignored or dropped;
- runner errors are converted to safe activity error events.

## Vertical Slices

### Slice 1: Frontend Activity View Model From Existing Events

Scope:

- Add `agent-activity-ui.ts`.
- Derive activity rows from existing messages, tool calls, plan state, applied
  plans, and session status.
- No backend changes.

TDD tests:

- Known tool calls map to human labels.
- Repeated metadata/previews calls coalesce by kind.
- Pending approval maps to `Waiting for approval`.
- Plan ready maps to `Prepared a plan`.
- Applying status maps to `Applying changes`.
- Unknown tools use generic safe copy.
- Technical metadata stays separate from default labels.

Edge cases:

- Missing timestamps.
- Same timestamp rows.
- Tool call has no response summary.
- Tool call has large asset id arrays.

### Slice 2: Chat Activity Block UI

Scope:

- Add `AgentActivityBlock.svelte`.
- Render one collapsed/expanded block in the chat transcript.
- Integrate with `AgentSessionChatPanel` without changing backend contracts.

TDD tests:

- Activity block appears after the triggering user message.
- Collapsed block shows at most a small set of current/recent rows.
- Expanded block shows all grouped rows.
- Technical details are hidden by default.
- Permission, plan review, and applied-plan cards remain separate.
- No duplicate blocks appear after websocket refresh.

Edge cases:

- Empty activity rows do not render a blank block.
- Terminal sessions show completed summary, not a spinner.
- Running session with no tool calls shows a generic `Pi is working` row.

### Slice 3: Session Activity Visibility Controls

Scope:

- Add a per-session activity visibility toggle.
- Put `Show activity` on the live block.
- Add menu/settings affordance if needed.

TDD tests:

- Recommended rollout defaults to `Compact` and renders the compact teaser while
  Pi is active.
- `Show activity` expands the block.
- `Hide activity` collapses it.
- Session menu can switch activity `Off` and back to `Compact` or `Expanded`.
- Preference does not hide approval cards or plan cards.
- Reload behavior follows the chosen persistence level.

Edge cases:

- Switching sessions does not leak expanded state.
- Multiple browser tabs do not corrupt stored preference.
- Unsupported stored value falls back safely.

### Slice 4: Live Updates And Coalescing

Scope:

- Wire websocket events and tool-call refresh into the activity block.
- Update rows in place while Pi works.
- Coalesce repeated read calls and progress-like updates.

TDD tests:

- Tool-call event updates an existing row.
- Completed tool-call refresh changes status from running to completed.
- Assistant delta can add/update `Writing response`.
- Operation-plan-ready updates `Preparing a plan` to completed.
- Operation-plan-applied updates `Applying changes` to completed.
- Duplicate REST/websocket arrivals do not duplicate rows.

Edge cases:

- Out-of-order websocket events.
- Tool-call refresh failure.
- Session changes while a refresh is in flight.
- Destroyed component ignores late updates.

### Slice 5: Technical Details And Redaction

Scope:

- Add expandable technical details per activity row.
- Reuse existing redacted tool-call metadata and labels.
- Add explicit tests for unsafe fields.

TDD tests:

- Default row does not show raw tool name or JSON.
- Expanded details show tool name, safe counts, timestamps, and redacted error.
- API keys, bearer tokens, runner tokens, and provider secrets are redacted.
- Unknown future metadata renders as safe key/value only when allowed.

Edge cases:

- Circular or invalid metadata shape.
- Very large metadata payload.
- Error messages containing URLs with tokens.

### Slice 6: Reload And Turn Anchoring Hardening

Scope:

- Ensure activity blocks reconstruct correctly after page reload.
- Tighten turn grouping. Add `turnId` or `triggerMessageId` only if timestamp
  grouping fails real scenarios.

TDD tests:

- Reload after completed tool calls shows completed activity summary.
- Reload during pending approval shows activity plus approval card.
- Reload after plan applied shows activity summary plus applied-plan card.
- Multiple turns remain separated.

Edge cases:

- Legacy sessions without turn identifiers.
- Imported/old sessions with missing tool timestamps.
- New user message sent before prior activity refresh finishes.

### Slice 7: Optional Explicit Activity Events

Scope:

- Add persisted/server-sent activity events only for non-tool gaps:
  start-processing, plan-composing, apply-progress, runner-recovery.
- Keep event payloads compact and safe.

TDD tests:

- Server emits activity event when a turn begins.
- Runner activity event is validated and redacted.
- Apply progress emits aggregate counts, not every item id.
- Activity history endpoint returns only the current user's session events.

Edge cases:

- Runner emits unknown activity kind.
- Activity event arrives after session is terminal.
- Activity events race with persisted messages/tool calls.

### Slice 8: Accessibility, Performance, And Polish

Scope:

- Finalize copy, animations, keyboard behavior, live-region behavior, and
  responsive layout.
- Ensure long sessions stay usable.

TDD tests:

- Toggle controls have accessible names.
- Live updates use polite announcements.
- Focus is not stolen when rows update.
- Large grouped activity data does not render thousands of DOM nodes.
- Mobile layout avoids overlap with composer and action dock.

Edge cases:

- Reduced-motion preference.
- Narrow mobile view.
- High-contrast/dark mode.
- Very long labels or localized strings.

## Acceptance Criteria

- Users can opt in to see a live, plain-language activity preview while Pi is
  working.
- The activity preview updates in place and does not spam the chat transcript.
- Default activity copy is understandable without knowing MCP, DTOs, or runner
  internals.
- Permission cards, plan reviews, applied-plan cards, and assistant messages
  remain distinct chat items.
- Reloaded sessions retain enough activity context to avoid looking stuck.
- Technical details are available for debugging but hidden by default.
- Hidden model reasoning, secrets, raw tokens, and unredacted provider/tool
  payloads are never shown.
- Each implementation slice has failing tests first, focused green tests, and
  regression coverage for edge cases.
