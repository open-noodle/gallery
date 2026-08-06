# Pi Agent Expanded Activity Debug Design

## Summary

Pi's activity preview currently has two modes:

- `Compact`: a low-noise user-facing summary.
- `Expanded`: an opt-in view intended to show more detail about what Pi is doing.

The expanded view still behaves too much like compact mode. During active sessions,
polling `/tool-calls` can briefly render many individual actions, then collapse
back to the initial summarized rows. This creates visible flicker and removes the
debug value of the expanded mode.

This design makes `Activity preview: Expanded` a stable debug/audit mode:

- compact mode keeps coalescing repeated activity;
- expanded mode shows the full per-tool-call stream for the current turn;
- polling and websocket refreshes update rows in place instead of replacing them
  with compact summaries;
- large sessions remain usable through bounded rendering or progressive loading;
- all implementation work must use TDD with full regression and edge case
  coverage.

## Problem

When Pi runs several MCP/tool calls in the background, the frontend receives
frequent `tool-calls` refreshes. In expanded activity preview, users can see a
list of actions flash for a moment, then disappear back into the two initial
activity rows such as `Understanding request` and `Preparing a plan`.

The user-visible result is:

- the page flickers on successful `200` tool-call refreshes;
- expanded mode does not reliably show what Pi did;
- debugging model/tool behavior becomes difficult because the activity stream is
  not durable in the UI;
- compact and expanded modes are not clearly different.

## Goals

- Make expanded mode a stable per-tool-call activity log for the current turn.
- Keep compact mode low-noise and suitable for normal users.
- Eliminate flicker caused by replacing expanded tool rows with compact summaries
  after polling or websocket refreshes.
- Preserve plain-language labels by default.
- Keep technical details available behind row-level disclosure.
- Keep long sessions performant and inspectable.
- Require TDD for every slice, with tests written before implementation.
- Require full test and edge case coverage for mode behavior, polling races,
  status transitions, large runs, accessibility, and redaction.

## Non-Goals

- Do not expose raw model reasoning, hidden prompts, or unredacted provider/tool
  payloads.
- Do not make compact mode noisy.
- Do not change backend tool-call persistence unless frontend-only fixes cannot
  produce stable behavior.
- Do not change session lifecycle or runner execution semantics.
- Do not add a separate debug page. The existing activity preview modes remain
  the entry point.

## Current Architecture

The current frontend already separates compact and verbose activity data:

- `buildAgentActivityModel()` returns:
  - `items`: coalesced activity rows for compact mode;
  - `verboseItems`: per-tool-call and event rows intended for expanded mode;
  - `activeItem` and `verboseActiveItem`.
- `AgentActivityBlock.svelte` chooses compact rows from `model.items` and
  expanded rows from `model.verboseItems`.
- `AgentSessionChatPanel.svelte` builds turn-anchored activity blocks and passes
  `visibilityMode="expanded"` when the session preference is expanded.
- Raw tool-call fallback cards are suppressed when activity turns cover those
  tool calls.

The remaining issue is that expanded mode is not treated as a strict debug
contract. Filtering/coalescing and refresh timing can still cause the rendered
rows to collapse or disappear between polling states.

## UX Contract

### Compact Mode

Compact mode is for normal use.

- Show at most a small number of current/recent rows.
- Coalesce repeated calls such as many metadata reads into one row.
- Prefer active or most relevant rows.
- Hide technical details unless the block is expanded through the existing
  disclosure controls.
- Keep the `Pi is working` experience calm and readable.

### Expanded Mode

Expanded mode is debug/audit mode.

- Show every tool call represented by the current turn's `toolCalls` data.
- Do not coalesce repeated tools in expanded mode.
- Preserve all statuses:
  - pending;
  - pending approval;
  - approved;
  - executing;
  - completed;
  - failed;
  - denied.
- Show activity events such as start-processing, plan-composing, apply-progress,
  and runner-recovery as additional rows, but never let secondary events hide
  tool-call rows.
- Keep rows in stable timestamp order with deterministic id tie-breakers.
- Preserve row identity across polling and websocket refreshes so rows update in
  place.
- Keep technical details behind each row's disclosure.

Expanded mode can show many rows. That is acceptable because the user explicitly
opted into a debug surface.

### Off Mode

Off mode hides passive activity preview only.

- Pending approval cards remain visible.
- Plan review cards remain visible.
- Applied plan cards remain visible.
- Assistant messages and user messages remain visible.

## Activity Data Contract

Expanded rows must be keyed by stable source identity:

- tool call row id: `tool-${toolCall.id}`;
- activity event row id: `event-${event.id}`;
- plan/apply/message synthetic rows keep their current stable ids.

For a given tool call id, status transitions must update the existing row:

- `approved` -> `executing` -> `completed`;
- `pendingApproval` -> `approved`;
- `executing` -> `failed`;
- `pendingApproval` -> `denied`.

The same row must not disappear during an equivalent refresh unless the source
tool call is no longer part of the current turn by deterministic turn anchoring.
The row id must not include derived values that can change during the tool call
lifecycle, such as `kind`, title, or status.

Expanded mode should not depend on `model.items`. It should render from
`model.verboseItems` or an equivalent explicitly verbose source. Compact mode
should not depend on `model.verboseItems` except for technical row lookup.

## Flicker Fix Strategy

The implementation should make mode selection explicit at the activity-block
boundary:

- compact path: select from coalesced `items`;
- expanded path: select from non-coalesced `verboseItems`;
- no intermediate render should temporarily expose raw fallback tool-call cards
  for tool calls already represented by the activity turn;
- loaded messages and loaded tool calls should be merged without switching the
  activity block between compact and expanded source lists.

Polling and websocket refreshes may arrive in different orders. The UI must
normalize this into the same activity model:

- dedupe by source id;
- sort by timestamp and id;
- update existing row fields when status or summaries change;
- avoid using transient array order from API responses as render order.

## Large Sessions

Expanded mode must be able to inspect hundreds or thousands of tool calls without
rendering an unbounded DOM list.

Use a bounded latest-window implementation first:

- render the latest expanded rows by default;
- always include the active/running row even if it is outside the latest window;
- show a row count such as `Showing 100 of 500 actions`;
- provide `Show older activity` and `Show newer activity` controls to page
  through the full stream;
- preserve row ids and focus when paging.

This is simpler than introducing virtualization and fits the existing
component-level test surface. Virtualization can be added later if profiling
shows paging is not enough.

The existing `verboseLimit = 100` hard cap is not sufficient if it permanently
hides older rows. It can remain as an initial render window only if the user can
inspect the hidden rows through an explicit control.

## Redaction And Safety

Expanded mode is more detailed, but it is not a raw transport dump.

- Default rows use plain-language labels and summaries.
- Raw tool names, tool call ids, request summaries, response summaries, errors,
  sizes, timestamps, and counts remain inside technical details.
- Existing redaction for API keys, bearer tokens, runner tokens, provider keys,
  unsafe prompt/reasoning text, and long values must still apply.
- Unknown future tool names use generic safe copy by default.
- Expanded mode must never show hidden reasoning, system prompts, provider
  secrets, or original unredacted payloads.

## Testing Requirements

All implementation slices must use TDD:

1. Write failing tests first.
2. Run the focused tests and confirm the expected failures.
3. Implement the smallest change that makes the tests pass.
4. Run the focused tests again and confirm they pass.
5. Run the relevant broader web checks before committing.

Full test and edge case coverage is required. Tests should cover both the view
model and rendered Svelte behavior.

Required regression coverage:

- expanded mode renders every tool call row for repeated tool calls;
- compact mode continues to coalesce and cap rows;
- polling refresh with equivalent data in different order keeps identical row ids
  and ordering;
- status transition updates a row in place without duplicate or disappearance;
- activity events do not hide tool-call rows in expanded mode;
- raw fallback tool-call cards do not flash for covered tool calls while
  activity data is loading or refreshing;
- very large tool-call bursts remain performant and inspectable;
- technical details remain redacted;
- off mode hides passive activity but not approvals/plans;
- accessibility labels and focus behavior are preserved.

## Edge Cases

- Tool calls without valid timestamps.
- Multiple tool calls with identical timestamps.
- Tool call completed before the triggering user message timestamp due to clock
  skew.
- Polling returns old data after websocket already delivered newer data.
- Websocket emits a tool call update before messages are loaded.
- Messages load after tool calls.
- Session changes while a refresh is in flight.
- Current turn has no assistant response yet.
- Terminal assistant response arrives while tool-call polling is still active.
- A tool call has `resultSize` metadata but no response summary.
- Tool call has no asset or album count.
- Unknown future tool names.
- Failed and denied tool calls.
- Pending approval during expanded mode.
- 500, 1,000, and more tool-call rows.
- Narrow mobile viewport.
- Reduced-motion preference.
- Storage contains invalid activity visibility mode.

## Vertical Slices

### Slice 1: Formalize Compact Vs Expanded View Model

Scope:

- Make the activity model contract explicit in code:
  - compact rows come from coalesced activity;
  - expanded rows come from per-tool-call verbose activity.
- Ensure event filtering never removes tool-call rows from expanded mode.
- Preserve deterministic ordering for both compact and expanded rows.

TDD tests:

- Expanded model with 50 repeated `searchAssets` calls has 50 verbose tool rows.
- Compact model for the same input has a small coalesced row set.
- Activity events such as `start-processing` and `plan-composing` do not remove
  verbose tool rows.
- Polling-first and websocket-first inputs produce identical expanded row ids and
  ordering.
- A single tool call keeps the same verbose row id across
  `pendingApproval -> approved -> executing -> completed`.
- Invalid/missing timestamps sort deterministically by stable id.

Edge cases:

- Same timestamp rows.
- Unknown future tool names.
- Mixed completed/running/failed statuses.
- Pending approval rows that later become running or completed rows.
- Tool calls with missing response summaries.

### Slice 2: Render Expanded Mode As Full Activity Stream

Scope:

- Update `AgentActivityBlock.svelte` so expanded mode renders the verbose stream
  as the source of truth.
- Replace the permanent `verboseLimit` cap with bounded latest-window paging:
  `Show older activity`, `Show newer activity`, and a visible row count.
- Keep compact mode unchanged.

TDD tests:

- Expanded block renders every row for a moderate burst such as 50 calls.
- Compact block still renders at most the compact limit for the same burst.
- Expanded block with more than the initial window exposes `Show older activity`
  and `Show newer activity` controls as needed.
- The active/running row is visible even when it is outside the latest bounded
  window.
- Technical details disclosure still works for verbose rows.

Edge cases:

- 500+ rows.
- Running row in the middle of a long history.
- All rows terminal.
- Narrow viewport.
- Keyboard focus remains on the toggle/disclosure that was activated.

### Slice 3: Stop Raw Tool-Call Flicker During Refresh

Scope:

- Harden `AgentSessionChatPanel.svelte` timeline construction so covered tool
  calls do not briefly render as raw fallback cards while activity turns are
  rebuilding.
- Preserve expanded activity blocks across message/tool-call/activity-event load
  ordering.
- Ensure a successful `tool-calls` refresh updates activity rows in place.

TDD tests:

- With expanded activity enabled, loading messages after tool calls never renders
  uncovered raw tool-call cards for covered rows.
- Polling refresh returning the same tool calls does not change the activity
  block count or row ids.
- Polling refresh changing a tool status updates the existing row.
- Websocket update followed by older polling response does not regress the row
  state.
- Completed assistant message does not remove current-turn activity rows until
  turn anchoring says they belong to a completed turn.

Edge cases:

- Messages fail to load but tool calls load.
- Tool calls fail to refresh once and then recover.
- Session id changes while a refresh is in flight.
- Activity visibility changes from compact to expanded while data is refreshing.

### Slice 4: Polish, Accessibility, And Performance Verification

Scope:

- Finalize copy for expanded debug mode if needed.
- Verify large-row behavior in browser-level/component tests.
- Preserve redaction and accessibility.
- Add a focused manual QA checklist for the production symptom.

TDD tests:

- Expanded rows have accessible names/status text.
- Live updates are polite and do not steal focus.
- Redaction still applies to technical rows in expanded mode.
- Reduced-motion preference avoids animated flicker.
- Large activity data does not render an unbounded number of DOM nodes and exposes
  paging controls to inspect hidden rows.

Edge cases:

- Very long summaries.
- Secret-like strings in errors and response summaries.
- High-contrast/dark mode classes remain readable.
- Mobile composer does not overlap the expanded activity block controls.

## Acceptance Criteria

- In `Activity preview: Expanded`, every tool call for the current turn is
  visible or inspectable.
- Expanded mode does not coalesce repeated tool calls.
- Compact mode remains low-noise and coalesced.
- `200` responses from `/tool-calls` no longer cause visible flicker from verbose
  rows to compact rows.
- Tool-call status transitions update existing rows in place.
- Activity events supplement the stream but do not hide tool-call rows in
  expanded mode.
- Large sessions remain performant and navigable.
- Technical details remain redacted.
- Every implementation slice is TDD-driven and includes full test plus edge case
  coverage before it is considered complete.

## Manual Verification Checklist

After implementation, verify with a real or seeded assistant session:

1. Set activity preview to `Expanded`.
2. Send a prompt that causes many tool calls.
3. Keep the browser network tab open and watch repeated `tool-calls` `200`
   responses.
4. Confirm the activity block does not flicker back to only the initial rows.
5. Confirm every tool call row remains visible or inspectable.
6. Confirm compact mode still shows only a small summarized view.
7. Confirm off mode hides passive activity while approvals and plan reviews still
   appear.
8. Confirm technical details redact secrets and unsafe prompt/reasoning text.
