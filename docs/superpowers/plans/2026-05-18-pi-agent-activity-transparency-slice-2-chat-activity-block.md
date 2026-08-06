# Pi Agent Activity Transparency Slice 2 Chat Activity Block Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Render the Slice 1 activity view model as a single collapsed/expanded chat activity block and integrate it into the assistant transcript directly after the user message that triggered the current/latest assistant turn.

**Architecture:** This slice is a frontend UI integration slice. It adds `AgentActivityBlock.svelte` and wires `buildAgentActivityModel()` into `AgentSessionChatPanel`. The chat transcript should show one grouped activity block instead of many standalone handled tool-call cards for covered activity. Permission approval cards, operation plan review cards, applied-plan cards, streaming assistant text, and normal assistant messages remain separate surfaces.

**Tech Stack:** Svelte 5, TypeScript, generated `@immich/sdk` DTO types, Vitest, Testing Library, existing assistant route test patterns, existing `agent-activity-ui.ts` view model.

---

## Source Spec

Implements Slice 2 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on Slice 1:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`

## Scope

In scope:

- Create `web/src/routes/(user)/assistant/agent-activity-block.svelte`.
- Create `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`.
- Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`.
- Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`.
- Add i18n keys in `i18n/en.json` for block-level UI labels if the component uses translated button/aria copy.
- Render one activity block from `AgentActivityModel`.
- Collapsed block:
  - shows current state;
  - shows at most three current/recent safe rows;
  - exposes a `Show activity` toggle;
  - uses a spinner/status indicator only while active.
- Expanded block:
  - shows every grouped row;
  - shows row status, title, summary, and count when present;
  - exposes `Hide activity`;
  - does not show technical details yet.
- Integrate the block after the latest triggering user message.
- Suppress standalone handled tool-call transcript cards when the activity block covers them.
- Keep permission/action dock UI, plan review, applied-plan cards, streaming assistant text, and assistant responses separate.
- Keep one stable activity block across rerenders/websocket-triggered refreshes.

Out of scope:

- Session menu visibility controls (`Off`, `Compact`, `Expanded`).
- Remembering expanded/collapsed preference across reloads.
- Per-row technical details disclosure.
- Explicit backend activity events.
- Full historical turn anchoring across multiple old turns.
- Websocket-specific coalescing beyond avoiding duplicate transcript items from current props/state.
- Server, runner, and OpenAPI changes.

## Product Decisions For This Slice

- Default display mode is `Compact` when there is activity to show.
- Expansion state is local to the rendered block and not persisted.
- The triggering message anchor is the latest user message in the current transcript for this slice.
- If there are no user messages but there is activity, the block can render at the activity timestamp.
- Existing standalone handled tool-call cards should no longer render for the same covered activity rows. This keeps the transcript aligned with the "one block per turn" spec.
- Historical tool calls before the latest triggering user message must remain in the transcript as the existing standalone tool-call cards. Slice 2 should not silently move old activity under the latest user turn.
- Pending approval remains represented in the action dock. The activity block may say `Waiting for approval`, but it must not become the approval control.
- Technical data stays hidden in Slice 2. Slice 5 owns expandable technical details.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner test commands are required for this slice because there are no backend or runner changes.

## Edge Cases Covered In This Slice

| Spec area           | Case                                                  | Slice 2 expectation                                                                                           |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Visibility          | Compact default                                       | Block renders in compact mode with safe row labels and `Show activity`                                        |
| Visibility          | User expands one activity block                       | Block shows all rows and `Hide activity`                                                                      |
| Visibility          | User collapses while active                           | Block returns to compact mode; activity rows remain available                                                 |
| Visibility          | Empty activity rows                                   | No blank block renders                                                                                        |
| Turn placement      | User message triggers activity                        | Activity block renders after that user message                                                                |
| Turn placement      | Older historical tool call before latest user message | Existing standalone tool-call card remains visible and is not moved into the latest block                     |
| Turn placement      | No user message but activity exists                   | Block renders in timestamp order without throwing                                                             |
| Timeline separation | Permission pending                                    | Activity says `Waiting for approval`; approval card/action dock remains separate                              |
| Timeline separation | Plan ready                                            | Activity says `Prepared a plan`; plan review remains separate                                                 |
| Timeline separation | Plan applied                                          | Activity summary can mention applied changes; applied-plan card remains separate                              |
| Duplication         | Tool-call refresh/rerender                            | One activity block remains; no duplicate blocks                                                               |
| Duplication         | Covered handled tool calls                            | Standalone handled tool-call cards do not render in addition to the block                                     |
| Activity states     | Running session with no tool calls                    | Block can show a generic `Writing response` or `Pi is working` row when response is pending                   |
| Activity states     | Terminal session                                      | Completed summary renders without spinner/status animation                                                    |
| Safety              | Technical data                                        | Raw tool names, request summaries, result summaries, JSON, and ids do not render in default or expanded block |
| Accessibility       | Toggle controls                                       | Show/hide button has an accessible name and `aria-expanded`                                                   |
| Accessibility       | Active block                                          | Active status uses a polite status/live region without taking focus                                           |
| Layout              | Long row labels/counts                                | Text wraps and does not overflow compact or expanded block                                                    |

## Edge Cases Deferred To Later Slices

- Persisting `Off`, `Compact`, and `Expanded` visibility preferences.
- Session menu controls for restoring activity when disabled.
- Full historical multi-turn activity blocks with explicit `turnId` or `triggerMessageId`.
- Websocket event ordering/coalescing beyond existing props/state refresh.
- Per-row technical detail expansion.
- Redaction of newly exposed metadata fields beyond Slice 1 technical strings.
- Backend persisted activity history.
- Mobile polish, reduced-motion behavior, and final live-region tuning.

## File Structure

Create:

- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

Modify:

- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `i18n/en.json` if translated labels are used.

Do not modify:

- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`

---

## Task 1: Add Activity Block Component Red Tests

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`

- [ ] **Step 1: Add test fixture helpers**

Create an `AgentActivityModel` fixture helper:

```ts
const activityItem = (overrides: Partial<AgentActivityItem> = {}): AgentActivityItem => ({
  id: overrides.id ?? 'activity-search',
  sessionId: overrides.sessionId ?? 'session-1',
  kind: overrides.kind ?? 'search',
  status: overrides.status ?? 'completed',
  title: overrides.title ?? 'Searching photos',
  summary: overrides.summary ?? 'Found matching photos',
  count: overrides.count ?? 42,
  startedAt: overrides.startedAt ?? '2026-05-18T10:00:00.000Z',
  completedAt: overrides.completedAt ?? '2026-05-18T10:00:02.000Z',
  technical: overrides.technical,
});

const activityModel = (items: AgentActivityItem[]): AgentActivityModel => ({
  items,
  activeItem: items.find((item) => ['blocked', 'running', 'pending'].includes(item.status)) ?? null,
  summary: items
    .map((item) => item.summary ?? item.title)
    .slice(0, 3)
    .join(', '),
});
```

Mock `svelte-i18n` if using translated labels:

- `assistant_activity_title`: `Pi is working`
- `assistant_activity_summary_title`: `Activity summary`
- `assistant_activity_show`: `Show activity`
- `assistant_activity_hide`: `Hide activity`
- `assistant_activity_status_running`: `Running`
- `assistant_activity_status_blocked`: `Needs attention`
- `assistant_activity_status_completed`: `Done`
- `assistant_activity_status_failed`: `Failed`
- `assistant_activity_status_skipped`: `Skipped`
- `assistant_activity_count`: `{count} items`

- [ ] **Step 2: Write failing collapsed-state test**

Render:

```svelte
<AgentActivityBlock model={activityModel([...four items...])} />
```

Assert:

- region/article has accessible label `Pi is working` when `activeItem` exists;
- collapsed state shows at most three activity titles;
- `Show activity` button is present;
- `aria-expanded="false"`;
- fourth row is not visible;
- no raw `technical.toolName`, `requestSummary`, `responseSummary`, or `error` text is visible.

- [ ] **Step 3: Write failing expanded-state test**

Click `Show activity`.

Assert:

- `Hide activity` button is present;
- `aria-expanded="true"`;
- every row is visible;
- row status labels are visible;
- counts render when present;
- technical fields remain hidden.

- [ ] **Step 4: Write failing collapse-again test**

Click `Show activity`, then `Hide activity`.

Assert:

- block returns to compact row limit;
- active row remains visible if it is outside the first three chronological rows;
- focus stays on the toggle button or a stable toggle control.

- [ ] **Step 5: Write failing empty-model test**

Render with:

```ts
{ items: [], activeItem: null, summary: null }
```

Assert:

- no article/region is rendered.

- [ ] **Step 6: Write failing terminal-summary test**

Render with only terminal rows.

Assert:

- title is `Activity summary`;
- no running spinner/status animation renders;
- `model.summary` or the first rows provide compact text;
- `Show activity` can still expand the history.

- [ ] **Step 7: Run red tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

Expected red failure: missing component.

---

## Task 2: Implement `AgentActivityBlock.svelte`

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Modify: `i18n/en.json` if translated labels are used.

- [ ] **Step 1: Add props and local state**

Props:

```ts
interface Props {
  model: AgentActivityModel;
  compactLimit?: number;
}
```

Local state:

- `expanded = false`

Derived values:

- `hasRows`
- `isActive = model.activeItem !== null`
- `visibleItems = expanded ? model.items : compactRows`
- `heading = isActive ? 'Pi is working' : 'Activity summary'`

- [ ] **Step 2: Compact row selection**

Compact mode should show at most `compactLimit` rows, default `3`.

Rules:

- include `model.activeItem` when present;
- include the most relevant recent/current rows around it;
- do not duplicate rows;
- preserve model order after selection;
- fall back to the first `compactLimit` rows when no row is active.

- [ ] **Step 3: Render safe row UI**

Each row should show:

- status label;
- title;
- optional summary;
- optional count;
- no technical fields.

Use text wrapping classes and stable dimensions so long labels do not overflow.

- [ ] **Step 4: Render toggle UI**

Button behavior:

- hidden when there are no rows;
- label switches between `Show activity` and `Hide activity`;
- `aria-expanded` reflects state;
- `aria-controls` points at the rows container.

- [ ] **Step 5: Accessibility semantics**

Recommended structure:

- `<article data-chat-item aria-label={heading}>`
- active block: `role="status"` or child `role="status"` with `aria-live="polite"`;
- terminal block: normal article without live announcements.

Do not steal focus when rows update.

- [ ] **Step 6: Run focused component tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

Expected: component tests pass.

---

## Task 3: Add Chat Panel Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Add i18n mock keys**

Extend the existing `svelte-i18n` mock messages in `agent-session-chat-panel.spec.ts` for activity block labels:

- `assistant_activity_title`
- `assistant_activity_summary_title`
- `assistant_activity_show`
- `assistant_activity_hide`
- status/count labels used by the component.

- [ ] **Step 2: Add test for activity block after triggering user message**

Arrange:

- persisted user message at `10:00:00`;
- completed tool call at `10:00:05`;
- assistant response at `10:00:20`.

Assert transcript order:

1. user message;
2. activity block containing `Searching albums` or `Searching photos`;
3. assistant response.

Assert the block appears only once.

- [ ] **Step 3: Add test that covered handled tool-call card is not duplicated**

Arrange a completed tool call.

Assert:

- activity block contains the plain-language row;
- old standalone tool-call article label such as `Pi checked your albums: Done` is absent;
- `Details` button from the old tool-call card is absent for that covered call in this slice.

- [ ] **Step 4: Add test that historical tool calls before the latest user turn remain visible**

Arrange:

- user message A at `10:00:00`;
- completed tool call A at `10:00:05`;
- assistant response A at `10:00:20`;
- user message B at `10:01:00`;
- completed tool call B at `10:01:05`.

Assert:

- exactly one activity block renders after user message B;
- activity block contains tool call B's safe row;
- tool call A still renders as the existing standalone historical tool-call card in its original location;
- tool call A is not duplicated inside the activity block.

- [ ] **Step 5: Add test that pending permission remains separate**

Arrange:

- session status `WaitingForToolApproval`;
- pending tool call passed through action dock/recent tool call props as current tests already do.

Assert:

- activity block contains `Waiting for approval`;
- approval card/action dock behavior remains tested in `agent-session-action-dock.spec.ts`;
- chat panel does not create an approval button inside the activity block.

- [ ] **Step 6: Add test for plan/applied-plan separation**

Arrange:

- session status `WaitingForPlanReview` or applied plan history;
- applied plan available through `getAppliedOperationPlans`.

Assert:

- activity block contains `Prepared a plan` or `Applied selected changes`;
- `AgentAppliedPlanTimelineCard` still renders separately for applied plans;
- activity block does not render apply/review controls.

- [ ] **Step 7: Add test for running session with no tool calls**

Arrange:

- a user message;
- `assistantResponsePending={true}` or streaming-active state;
- no tool calls.

Assert:

- activity block renders a generic `Writing response`/`Pi is working` row;
- old ASCII busy indicator does not duplicate the same state once the activity block is present, or remains only if the implementation intentionally keeps it as a fallback when activity model is empty.

- [ ] **Step 8: Run red chat-panel tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected red failure: chat panel does not render activity block yet.

---

## Task 4: Integrate Activity Block Into `AgentSessionChatPanel`

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Import the model and component**

Add:

```ts
import AgentActivityBlock from './agent-activity-block.svelte';
import { buildAgentActivityModel, type AgentActivityModel } from './agent-activity-ui';
```

- [ ] **Step 2: Build the current activity model**

Derive the latest user-message anchor first:

```ts
const latestUserMessage = $derived(findLatestUserMessage(messages));
const currentTurnStartedAt = $derived(latestUserMessage?.createdAt ?? null);
```

Then build the activity model from current-turn inputs only:

```ts
const currentTurnToolCalls = $derived(filterActivityToolCallsForCurrentTurn(toolCalls, currentTurnStartedAt));
const currentTurnAppliedPlans = $derived(filterAppliedPlansForCurrentTurn(appliedPlans, currentTurnStartedAt));

const activityModel = $derived(
  buildAgentActivityModel({
    session,
    messages,
    toolCalls: currentTurnToolCalls,
    currentPlan: null,
    appliedPlans: currentTurnAppliedPlans,
    streamingText,
    isAssistantActive: isResponsePending,
  }),
);
```

If passing `isResponsePending` creates false positives after terminal or idle sessions, narrow it to:

- `isSending`
- `isAssistantActive`
- `assistantResponsePending`
- `isRunningAwaitingAssistant`

Do not create backend calls for current plan in this slice.

Filtering rules:

- when `currentTurnStartedAt` exists, include tool calls whose `startedAt` or `completedAt` is at or after that timestamp;
- include applied plans whose `updatedAt` is at or after that timestamp;
- when there is no user message, include all activity so sessions restored mid-work still show a block;
- missing/invalid timestamps should be excluded from the current-turn block when a user anchor exists, and left as standalone fallback cards.

- [ ] **Step 3: Add activity timeline item type**

Extend `ChatTimelineItem`:

```ts
| { type: 'activity'; id: string; occurredAt: string; model: AgentActivityModel; anchorMessageId: string | null }
```

Build exactly one activity item when `activityModel.items.length > 0`.

Anchor rules:

- find the latest user message by `createdAt`, then id;
- set activity `occurredAt` just after that message by sorting with type priority rather than mutating timestamp;
- if no user message exists, use the first activity row `startedAt`.

- [ ] **Step 4: Replace covered tool-call timeline cards**

Remove standalone `tool-call` entries from `buildChatTimelineItems()` only when they are covered by the current-turn activity block.

Recommended implementation:

- collect covered ids from `activityModel.items[*].technical.toolCallIds`;
- omit standalone `tool-call` timeline items whose id is in that covered set;
- keep historical or unanchored tool calls as standalone fallback cards.

This keeps the transcript to one activity block per turn and avoids duplicate activity.

- [ ] **Step 5: Render activity item**

In the transcript loop:

```svelte
{:else if item.type === 'activity'}
  <AgentActivityBlock model={item.model} />
```

Keep applied-plan rendering separate.

- [ ] **Step 6: Busy indicator fallback**

Avoid showing both:

- activity block with active `Writing response`; and
- ASCII busy indicator for the same state.

Recommended:

```ts
const showAssistantBusyIndicator = $derived(
  isResponsePending && streamingText.length === 0 && !composerDisabled && activityModel.items.length === 0,
);
```

Make sure terminal sessions do not show a spinner.

- [ ] **Step 7: Run focused chat-panel tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected: new chat-panel tests pass and existing chat panel behavior is updated intentionally.

---

## Task 5: Duplicate, Empty, And Ordering Hardening

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`

- [ ] **Step 1: Add duplicate rerender test**

In chat panel tests:

- render with one completed tool call;
- rerender or emit a websocket event that causes applied/tool data refresh without changing ids;
- assert only one activity block exists.

If rerender support is awkward, use prop update via Testing Library's `rerender`.

- [ ] **Step 2: Add empty-model chat test**

Arrange:

- no messages;
- no tool calls;
- no applied plans;
- no pending response.

Assert:

- no activity block renders;
- existing empty chat UI remains unchanged.

- [ ] **Step 3: Add terminal no-spinner test**

Arrange:

- completed session;
- completed tool call or applied plan.

Assert:

- activity block uses summary title;
- no ASCII busy indicator appears;
- no live active status is announced.

- [ ] **Step 4: Add long-label wrapping test**

In the component test, use a long title/summary/count and assert:

- row renders text;
- toggle remains visible;
- no raw technical text is visible.

This is a component-level test; visual overlap will be handled in the polish slice.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected: duplicate, empty, terminal, and long-label tests pass.

---

## Task 6: Regression And Final Checks

**Files:**

- Modify only if tests expose necessary fixture or i18n updates:
  - `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
  - `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
  - `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`

- [ ] **Step 1: Run focused green tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

- [ ] **Step 2: Run assistant regression tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 3: Run type and Svelte checks**

```bash
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

- [ ] **Step 4: Confirm no out-of-scope files changed**

Run:

```bash
git status --short
```

Expected implementation changes:

- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `i18n/en.json` if translated labels are used.

The spec and plan docs may also be present if this planning work is included in the commit.

## Acceptance Criteria

- `AgentActivityBlock.svelte` renders a compact activity preview from `AgentActivityModel`.
- Users can expand the block to see all grouped safe activity rows.
- Empty models render no blank UI.
- Active models show a working/attention state; terminal models show summary state.
- Activity appears after the latest triggering user message in the transcript.
- Covered handled tool calls do not also render as standalone chat cards.
- Permission approval UI, plan review UI, applied-plan cards, assistant streaming text, and assistant messages remain separate.
- No raw tool names, technical request/result strings, JSON payloads, or ids render in default or expanded activity block UI.
- Duplicate props/websocket-style refreshes do not create duplicate activity blocks.
- Focused and regression tests pass, plus TypeScript, Svelte, and `git diff --check`.
