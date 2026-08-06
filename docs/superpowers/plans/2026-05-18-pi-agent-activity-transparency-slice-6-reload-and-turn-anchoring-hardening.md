# Pi Agent Activity Transparency Slice 6 Reload And Turn Anchoring Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Make assistant activity blocks reconstruct correctly after page reload and keep activity attached to the user turn that caused it, including completed historical turns, pending approval reloads, applied-plan reloads, and multiple user turns in one session.

**Architecture:** This is a frontend timeline and anchoring slice. Keep the derived-activity model from Slices 1-5 and introduce a pure turn-segmentation helper that groups persisted messages, tool calls, current plan, applied plans, streaming state, and session status into one activity model per relevant user turn. `AgentSessionChatPanel` should consume that helper to render historical activity summaries in the transcript instead of only deriving the latest turn. Do not add `turnId`, `triggerMessageId`, backend APIs, migrations, or runner protocol changes in this slice. If timestamp grouping is proven insufficient, stop and write a follow-up Slice 7+ backend design instead of expanding this slice.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, generated `@immich/sdk` DTO types, existing assistant route test patterns, existing activity model/block/visibility controls.

---

## Source Spec

Implements Slice 6 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-2-chat-activity-block.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-3-session-activity-visibility-controls.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-4-live-updates-and-coalescing.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-5-technical-details-and-redaction.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

Spec anchors:

- Activity block should be associated with the user turn that triggered it.
- Derive grouping from existing timestamps first:
  - start at a user message;
  - include following tool calls, plan events, streaming state, and applied-plan events until the next user message or terminal assistant output;
  - keep stable sorting by timestamp and id.
- Do not add explicit `turnId` or `triggerMessageId` in this slice; capture any proven need as a follow-up backend design.
- Reload while running, pending approval, after completion, and after plan applied should reconstruct enough activity context to avoid looking stuck.

## Scope

In scope:

- Add failing tests first for reload reconstruction and multi-turn anchoring.
- Add a pure frontend helper for assistant turn segmentation.
- Build one `AgentActivityModel` per relevant turn instead of a single latest-turn model.
- Anchor each activity block after its triggering user message in the chat transcript.
- Preserve current-turn live behavior from Slice 4:
  - streaming deltas still update only the active/latest turn;
  - `operation-plan-ready` still updates the active/latest turn;
  - `operation-plan-applied` still refreshes applied history and avoids duplicates.
- Reconstruct historical completed activity summaries from persisted tool calls after reload.
- Reconstruct pending approval activity plus approval card/action dock after reload.
- Reconstruct applied-plan activity summary plus applied-plan card after reload.
- Keep multiple turns separated and avoid cross-turn leakage.
- Keep handled tool-call cards suppressed when their tool calls are covered by a reconstructed activity block.
- Keep unanchored legacy tool calls visible as existing fallback tool-call cards if there is no safe user-turn anchor.
- Keep `off`, `compact`, and `expanded` visibility behavior:
  - `off` hides activity blocks but does not hide approval, plan review, applied-plan, messages, or fallback busy UI;
  - `compact` shows compact summaries for all reconstructed blocks;
  - `expanded` expands activity blocks and keeps Slice 5 technical detail controls available.
- Add deterministic handling for missing, invalid, duplicate, or same timestamp values.
- Reconstruct failed, denied, and approved-but-not-yet-continued tool states after reload.

Out of scope:

- New backend `turnId` or `triggerMessageId` fields.
- Database migrations.
- OpenAPI/codegen changes.
- New runner activity protocol events.
- Persisted/server-sent activity events; Slice 7 owns that if needed.
- Virtualization or DOM caps for very long historical activity lists; Slice 8 owns final performance polish.
- Changing permission approval, plan review, or applied-plan card ownership.

## Product Decisions For This Slice

- Use timestamp-derived turn anchoring first. Existing session data should be enough for the known reload cases.
- A user message starts a turn. The primary activity window ends at the earlier of:
  - the next user message by sorted timeline order;
  - the terminal assistant response for that turn.
- Tool calls belong to the nearest preceding user turn when their valid `startedAt` or `completedAt` falls inside that turn's interval.
- Tool calls after a terminal assistant response but before the next user message are not folded into that completed turn unless they can be confidently tied to that turn by existing ordering. Prefer fallback tool-call cards over misattribution.
- Applied plans belong to the nearest preceding user turn when their valid `updatedAt` falls inside that turn's interval, including apply results that happen after the assistant presents a plan for that same turn.
- Current plan belongs to the latest user turn only, because the current-plan endpoint represents the active review state.
- Streaming text and active assistant state belong to the latest user turn only.
- If a tool call has missing/invalid timestamps:
  - if there is exactly one user message, attach it to that turn;
  - if there are multiple user messages, leave it unanchored and render the existing fallback tool-call card instead of guessing.
- If there are no user messages, do not invent an activity block. Preserve existing fallback surfaces.
- Same timestamp ordering must be deterministic. Use timestamp, type priority, then stable id. User messages should anchor their own turn before activity at the same timestamp.
- Do not let a newly sent user message absorb late refresh data from the previous turn. In-flight refreshes should remain scoped by session and time anchors.
- `off` mode means activity preview is hidden, not replaced with technical logs. Required action surfaces remain visible, but covered non-required tool-call cards stay suppressed so `off` does not regress to raw activity cards.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner tests are required because this slice should not change backend or runner contracts.

## Edge Cases Covered In This Slice

| Spec area     | Case                                           | Slice 6 expectation                                                                                 |
| ------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Reload        | Completed tool calls reload                    | Completed activity summary reconstructs after the triggering user message                           |
| Reload        | Pending approval reload                        | Activity block says `Waiting for approval`; approval card/action dock remains visible               |
| Reload        | Plan applied reload                            | Activity summary says applied changes; applied-plan card remains separate                           |
| Reload        | Running session reload                         | Persisted running/executing tool calls reconstruct a live `Pi is working` block                     |
| Reload        | Failed tool reload                             | Activity row shows safe failed state and no raw technical error outside details                     |
| Reload        | Denied tool reload                             | Activity row shows skipped/not-allowed state without reopening approval UI                          |
| Reload        | Approved tool reload before continuation       | Activity row shows running/continuing state until assistant response arrives                        |
| Turn grouping | One user, one tool, one assistant response     | Activity block appears between user message and assistant response                                  |
| Turn grouping | Two user messages with separate tools          | Each turn gets its own activity block; no cross-turn leakage                                        |
| Turn grouping | Same timestamp items                           | Stable sort by timestamp, type priority, then id keeps deterministic block placement                |
| Turn grouping | Tool call exactly at next user timestamp       | Belongs to the next turn only if sorted after that user anchor; does not leak backward              |
| Turn grouping | Tool after terminal assistant before next user | Does not mutate the completed turn unless confidently tied to that turn; fallback card is preferred |
| Legacy data   | No user messages                               | No activity block is invented; fallback surfaces remain                                             |
| Legacy data   | One user and missing tool timestamps           | Tool call can attach to the only turn                                                               |
| Legacy data   | Multiple users and missing tool timestamps     | Tool call remains fallback card to avoid wrong attribution                                          |
| Legacy data   | Invalid message/tool timestamps                | Invalid values do not throw; deterministic fallback applies                                         |
| Applied plans | Duplicate applied-plan revisions               | Applied-plan card and apply activity are deduped by plan id and revision                            |
| Applied plans | Applied plan before first user                 | Plan card remains fallback/standalone; no guessed activity block                                    |
| Current plan  | Current plan exists after reload               | Current plan activity attaches to latest user turn and plan review remains owned by action dock     |
| Live updates  | Assistant streaming after reload               | Streaming/writing row attaches to latest active turn only                                           |
| Live updates  | New user message before old refresh resolves   | New turn is created; late old refresh cannot move historical activity into the new turn             |
| Visibility    | Mode `off` after reload                        | Activity blocks hide; approval/plan/applied/message surfaces remain visible                         |
| Visibility    | Mode `compact` after reload                    | Historical summaries render compactly                                                               |
| Visibility    | Mode `expanded` after reload                   | Historical activity rows and Slice 5 technical details remain available                             |
| Safety        | Technical fields on historical rows            | Redaction/disclosure rules from Slice 5 still apply                                                 |
| Errors        | Message/applied-plan load fails                | Existing error handling remains; no partial helper crash                                            |

## Edge Cases Deferred To Later Slices

- Persisted/server-sent activity events for non-tool gaps.
- Runner start-processing, plan-composing, apply-progress, retry, and recovery events.
- Backend `turnId`/`triggerMessageId` design and migration if real data proves timestamp grouping insufficient.
- Long-session virtualization, DOM caps, and final performance tuning.
- Final screen-reader announcement tuning for many historical blocks.

## File Structure

Create:

- `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`

Modify:

- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

Modify only if helper signatures need a small extension:

- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

Do not modify:

- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`
- database migrations

---

## Task 1: Add Turn Segmentation Helper Red Tests

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`

- [ ] **Step 1: Add fixture builders**

Create local deterministic builders for:

- `AgentSessionResponseDto`;
- user and assistant messages;
- tool calls;
- current operation plan;
- applied operation plans.

Use explicit timestamps and stable ids in every test. Do not use real SDK calls.

- [ ] **Step 2: Add single-turn reload test**

Arrange:

- one user message;
- one completed search tool call after it;
- one assistant response after the tool call.

Assert the helper returns one activity turn:

- anchored to the user message id;
- occurred at the user message timestamp;
- model contains completed search activity;
- covered tool-call ids include the completed tool call;
- the assistant response is not swallowed by the activity model.

Expected red failure: helper does not exist.

- [ ] **Step 3: Add multi-turn separation test**

Arrange:

- user A, tool A, assistant A;
- user B, tool B, assistant B.

Assert:

- helper returns two activity turns;
- tool A appears only in turn A;
- tool B appears only in turn B;
- covered ids are separated per turn and globally dedupeable.

- [ ] **Step 4: Add terminal assistant boundary test**

Arrange:

- user A;
- completed tool A;
- terminal assistant A;
- a later tool call before user B.

Assert:

- tool A remains in turn A;
- the later tool call is not folded into turn A merely because it is before the next user;
- the later tool call is returned as unanchored/fallback unless the helper can confidently tie it to a later user turn.

- [ ] **Step 5: Add pending approval reload test**

Arrange:

- one user message;
- one `PendingApproval` metadata tool call after it.

Assert:

- helper returns one active/blocked activity turn;
- model title includes `Waiting for approval`;
- covered ids include the pending tool call so the chat panel does not render a duplicate handled card;
- required approval card ownership is not modeled here.

- [ ] **Step 6: Add failed, denied, and approved reload tests**

Arrange separate tool calls with:

- `Failed`;
- `Denied`;
- `Approved` with no later assistant response.

Assert:

- failed maps to a safe failed activity row;
- denied maps to skipped/not-allowed activity without approval controls inside chat;
- approved reload remains running/continuing until assistant continuation is visible;
- no raw request, response, or error text appears outside Slice 5 technical details.

- [ ] **Step 7: Add applied-plan reload test**

Arrange:

- one user message;
- applied plan with operations and `updatedAt` after that user.

Assert:

- helper returns an apply activity item for that user turn;
- plan id/revision can still be rendered separately as an applied-plan card;
- repeated copies of the same plan id/revision do not produce duplicate activity turns.

- [ ] **Step 8: Add legacy/missing timestamp tests**

Assert:

- one user + missing/invalid tool timestamps attaches to the only user turn;
- multiple users + missing/invalid tool timestamps leaves the tool unanchored;
- no user messages returns no activity turns;
- invalid timestamps do not throw.

- [ ] **Step 9: Add same timestamp deterministic tests**

Arrange same timestamp user messages/tool calls/plans with different ids.

Assert:

- output order is deterministic;
- tool calls do not randomly move between turns on repeated calls;
- type priority and id tie-breakers match the plan.

- [ ] **Step 10: Run the red helper command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts
```

Expected red failure: helper module does not exist.

## Task 2: Implement Turn Segmentation Helper

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`

- [ ] **Step 1: Define helper input/output types**

Recommended output:

```ts
export type AgentSessionActivityTurn = {
  id: string;
  anchorMessageId: string;
  occurredAt: string;
  model: AgentActivityModel;
  coveredToolCallIds: Set<string>;
  appliedPlanKeys: Set<string>;
};
```

Recommended input:

```ts
export type BuildAgentSessionActivityTurnsInput = {
  session: AgentSessionResponseDto;
  messages: AgentMessageResponseDto[];
  toolCalls: AgentToolCallResponseDto[];
  currentPlan: AgentOperationPlanResponseDto | null;
  appliedPlans: AgentOperationPlanResponseDto[];
  streamingText?: string;
  isAssistantActive?: boolean;
};
```

- [ ] **Step 2: Implement stable event sorting**

Sort by:

1. valid timestamp;
2. type priority:
   - user message;
   - tool call start/completion;
   - current plan;
   - applied plan;
   - assistant message;
3. stable id.

Invalid timestamps sort after valid timestamps for direct ordering, but missing/invalid tool calls use the legacy attachment rules instead of relying on invalid order.

- [ ] **Step 3: Implement user-turn intervals**

Create turns from sorted user messages.

Each turn includes records whose valid timestamp is:

- `>= turn.user.createdAt`;
- `< terminal assistant message for the turn` when one exists, except for plan/apply records that are confidently part of that turn;
- otherwise `< nextTurn.user.createdAt`, unless same-timestamp tie rules place the record after the next user anchor.

Use helper functions so tests can exercise edge cases without mounting Svelte.

- [ ] **Step 4: Track unanchored records**

Return enough information for the chat panel to leave ambiguous tool calls and
plans as fallback timeline items. Do not silently drop unanchored records.

- [ ] **Step 5: Build activity models per turn**

For each turn:

- pass only that turn's tool calls and applied plans into `buildAgentActivityModel`;
- pass `currentPlan`, `streamingText`, and `isAssistantActive` only to the latest user turn;
- use an adjusted session for historical turns so old completed/apply rows do not inherit the current session running status incorrectly;
- drop turns whose model has zero items.

- [ ] **Step 6: Return coverage sets**

Return:

- covered tool-call ids from each activity model;
- applied-plan id/revision keys represented by apply activity.

The tool-call set lets `AgentSessionChatPanel` suppress duplicate fallback
tool-call cards. The applied-plan set is for deterministic dedupe assertions and
must not hide the required applied-plan timeline card.

- [ ] **Step 7: Keep unknown legacy records visible**

Do not force unanchored tool calls or applied plans into an activity block when the helper cannot confidently anchor them. Let the existing chat-panel fallback rendering handle them.

- [ ] **Step 8: Run helper tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts
```

## Task 3: Add Chat Panel Reload Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Add reload completed-tool summary test**

Arrange `getAgentSessionMessages` to resolve:

- user message;
- assistant response.

Pass completed tool calls as props, as they would be loaded by the parent after reload.

Assert:

- transcript order is user message, activity summary, assistant response;
- no standalone handled tool-call card appears for the covered tool call;
- summary is compact and human-readable;
- technical details remain hidden by default.

- [ ] **Step 2: Add reload pending approval test**

Arrange:

- user message;
- pending approval tool call.

Assert:

- activity block appears after the user message;
- it says `Waiting for approval`;
- no duplicate fallback tool-call card appears;
- action dock/approval ownership remains outside the chat panel.

- [ ] **Step 3: Add reload applied-plan test**

Arrange:

- user message;
- applied operation plan from `getAppliedOperationPlans`;
- optional assistant response after apply.

Assert:

- activity summary includes `Applied selected changes`;
- applied-plan timeline card renders separately;
- duplicate applied-plan events/reloads do not duplicate cards or activity rows.

- [ ] **Step 4: Add two-turn transcript test**

Arrange:

- two user messages;
- two assistant messages;
- one tool call per turn.

Assert transcript order:

- user A;
- activity A;
- assistant A;
- user B;
- activity B;
- assistant B.

Assert activity A does not contain tool B and activity B does not contain tool A.

- [ ] **Step 5: Add terminal assistant boundary chat test**

Arrange:

- user A;
- activity for user A;
- assistant A;
- an ambiguous later tool call before user B.

Assert:

- activity A remains stable after assistant A;
- ambiguous later tool call renders through existing fallback behavior instead of mutating activity A;
- user B still starts a clean turn when it appears.

- [ ] **Step 6: Add failed, denied, and approved reload chat tests**

Assert:

- failed reload renders safe failed activity copy and hides raw error text by default;
- denied reload renders skipped/not-allowed activity copy and no approval action in chat;
- approved reload renders continuing/running activity until assistant response is present.

- [ ] **Step 7: Add no-user legacy fallback test**

Arrange tool calls with no user messages.

Assert no activity block is invented and existing fallback tool-call card behavior remains.

- [ ] **Step 8: Add invalid/missing timestamp regression**

Use one-user and multi-user variants.

Assert one-user legacy data reconstructs safely, while multi-user ambiguous data keeps fallback tool-call cards rather than misanchoring.

- [ ] **Step 9: Run the red chat-panel command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected red failure: chat panel only renders one latest-turn activity model.

## Task 4: Wire Chat Panel To Activity Turns

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`

- [ ] **Step 1: Replace latest-turn-only activity derivation**

Use `buildAgentSessionActivityTurns()` to derive all relevant turn activity models.

Remove or narrow these latest-turn-only helpers if replaced:

- `findLatestUserMessage`;
- `filterActivityToolCallsForCurrentTurn`;
- `filterAppliedPlansForCurrentTurn`;
- single `activityModel`;
- single `coveredToolCallIds`.

Keep any helper still needed for live current-plan/latest-turn logic.

- [ ] **Step 2: Update timeline item type**

Render multiple `activity` timeline items:

- id: stable turn id;
- occurredAt: triggering user message timestamp;
- model: turn model.

Keep activity type priority immediately after user messages.

- [ ] **Step 3: Suppress covered fallback cards globally**

Build global coverage sets from all turns:

- covered tool-call ids;
- represented applied-plan keys for dedupe/debug assertions if needed.

Use covered tool-call ids to avoid duplicate fallback tool-call cards. Continue
deduping applied-plan timeline cards by plan id/revision, but do not suppress
the required separate applied-plan card merely because an apply activity row
mentions it.

- [ ] **Step 4: Keep `off` behavior correct**

If `activityVisibilityMode === 'off'`:

- do not render activity blocks;
- suppress covered non-required tool-call cards so `off` does not turn activity preview into raw technical logs;
- keep approval, plan review, applied-plan cards, streamed text, final messages, and busy fallback visible.
  Unanchored legacy fallback cards may still render because no activity block is confidently covering them.

- [ ] **Step 5: Preserve live latest-turn behavior**

Ensure:

- streaming text attaches to the latest user turn;
- `isAssistantActive`/pending writing row attaches to latest user turn;
- `currentPlan` attaches to latest user turn;
- applied-plan refresh updates the correct turn after plan apply.

- [ ] **Step 6: Run chat-panel tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

## Task 5: Add Owner-Surface Reload Regressions

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Add pending approval reload owner test**

Render the conversation/action-dock path with a pending approval tool call after reload.

Assert:

- chat activity reconstructs `Waiting for approval`;
- action dock approval controls remain visible and actionable;
- approving still refreshes/continues as previous slices require.

- [ ] **Step 2: Add plan review reload owner test**

Render a session with `WaitingForPlanReview` or a current plan after reload.

Assert:

- chat activity can say `Prepared a plan`;
- plan review/action surface remains visible and actionable;
- no duplicate plan-preview UI is rendered inside the activity block.

- [ ] **Step 3: Add visibility `off` owner test**

Set activity visibility to `off`.

Assert:

- activity blocks are hidden;
- approval/plan/apply owner surfaces are still present;
- covered non-required tool-call cards do not reappear as technical logs;
- unanchored legacy fallback cards may remain visible.

- [ ] **Step 4: Run owner tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

## Task 6: Race And Refresh Regression Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify only if needed: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`

- [ ] **Step 1: Add new-user-before-refresh test**

Arrange:

- user A with a running tool call;
- user B is sent or appears before a delayed tool refresh/applied-plan refresh resolves.

Assert:

- user B gets a new turn;
- late refresh for tool A stays in turn A based on timestamps;
- tool A does not move into user B activity.

- [ ] **Step 2: Add stale current-plan test**

Arrange a delayed `getCurrentOperationPlan` response while a newer user turn is created.

Assert:

- current plan appears only for the latest turn if it still represents the active session state;
- stale current-plan refresh does not duplicate historical plan rows.

- [ ] **Step 3: Add duplicate reload/event test**

Arrange duplicate websocket and reload data for the same applied plan/tool call.

Assert:

- one activity row per coalesced kind;
- one applied-plan card per plan id/revision;
- no duplicate activity blocks for the same user turn.

- [ ] **Step 4: Run race tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts
```

## Task 7: Regression, Static Checks, And Manual QA Notes

**Files:**

- No additional production files expected.

- [ ] **Step 1: Run focused Slice 6 command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 2: Run assistant activity regression**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts
```

- [ ] **Step 3: Run static checks**

```bash
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

- [ ] **Step 4: Manual QA in the assistant UI**

Use a local assistant session with at least two turns:

- send a request that triggers a tool call and final assistant response;
- reload the page and verify activity summary remains after the first user message;
- send a second request and verify the first activity block does not move;
- trigger a permission request, reload, and verify activity plus approval controls return;
- apply a plan, reload, and verify activity summary plus applied-plan card return;
- toggle activity `off`, `compact`, and `expanded` to verify each mode still behaves as expected.

## Acceptance Checklist

- [ ] Tests were written before implementation and failed for the expected reason.
- [ ] Reload after completed tool calls reconstructs completed activity summary.
- [ ] Reload during pending approval reconstructs activity and keeps approval controls visible.
- [ ] Reload after applied plan reconstructs apply activity and keeps applied-plan card separate.
- [ ] Reload after failed, denied, and approved tool states reconstructs safe activity rows.
- [ ] Multiple user turns each get their own activity block with no cross-turn leakage.
- [ ] Terminal assistant responses bound completed turns so later ambiguous tool calls do not mutate them.
- [ ] Legacy missing/invalid timestamp cases are deterministic and do not crash.
- [ ] Ambiguous multi-user legacy tool calls remain fallback cards instead of being misattributed.
- [ ] Same timestamp records are sorted deterministically.
- [ ] New user messages do not absorb late refresh data from prior turns.
- [ ] Activity visibility `off`, `compact`, and `expanded` remain consistent with Slice 3.
- [ ] Slice 5 technical-details disclosure/redaction remains available on expanded reconstructed activity rows.
- [ ] Focused tests, assistant regression tests, TypeScript, Svelte, and `git diff --check` pass.
