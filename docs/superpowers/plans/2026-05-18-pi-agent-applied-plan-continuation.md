# Pi Agent Applied Plan Continuation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run the focused and regression commands.

**Goal:** Applying a Gallery operation plan should not end the assistant session. The session should remain open, the applied plan should appear as a structured read-only chat timeline card, and follow-up messages should continue below it in the same transcript.

**Architecture:** Treat plan application as a first-class Gallery conversation event, not as an assistant text message and not as the terminus of a session. The proposed plan remains in the action dock only while it is current and proposed. Once applied, the backend transitions the session back to `Running`, the current proposed-plan endpoint returns `null`, and a new applied-plan history endpoint lets the chat transcript render applied plans durably after reload. The chat timeline merges messages, tool-call activity, and applied-plan cards in chronological order.

**Tech Stack:** NestJS services/controllers/repositories, Kysely, generated OpenAPI TypeScript SDK, Svelte 5 components, Vitest, Testing Library, existing agent plan review UI components.

---

## Scope

In scope:

- Keep assistant sessions open after successful plan application.
- Preserve `Applying` as a transient status while operations are executing.
- Transition successful apply outcomes back to `Running` and keep `endedAt` unset.
- Continue treating fatal post-claim apply exceptions as session failures for now.
- Add a read endpoint for applied operation plan history for a session.
- Render applied plans in the chat transcript as structured timeline cards.
- Hide the proposed-plan action dock after a plan is applied.
- Keep the composer enabled after apply and allow follow-up messages below the applied plan.
- Refresh applied-plan history on local apply, remote websocket events, and page reload.
- Avoid duplicate applied-plan cards when both REST responses and websocket events arrive.

Out of scope:

- Direct MCP apply tools.
- Asking the runner/LLM to continue automatically after a plan is applied.
- Creating synthetic assistant text messages for applied plans.
- Adding a user-facing "end session" action.
- Changing permission-plan semantics.
- Changing the operation execution implementation beyond lifecycle and history exposure.
- Redesigning the visual plan review model beyond a read-only applied-card wrapper.

## Design Decisions

- **Applied plan card, not assistant message:** Applying a plan is a Gallery-side event. Persist and render it as a structured timeline item so the UI can preserve counts, operation status, thumbnails, and expandable details without pretending the LLM said it.
- **Successful apply returns to `Running`:** `Completed` should not mean "a plan was applied"; it should remain reserved for explicit session completion or legacy sessions.
- **Current plan remains proposed-only:** `getCurrentOperationPlan()` should continue to return only the current proposed plan. Applied plans move to history and should not remain in the dock.
- **Fetch history on event:** The `operation-plan-applied` websocket event should trigger a history refresh instead of carrying a large plan payload. This keeps websocket payloads compact and avoids duplicating DTO mapping logic.
- **Chronological timeline:** Applied plan cards should sort by plan `updatedAt` with `revision` and `id` tie-breakers. Messages, tool calls, and applied plans should share one merged timeline.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-message.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-message.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/services/agent-message.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-session-lifecycle-ui.spec.ts src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
pnpm --dir server run check
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
pnpm --dir server run format
pnpm --dir web run format
git diff --check
```

OpenAPI/SDK commands required after adding the new history endpoint:

```bash
./open-api/bin/generate-open-api.sh typescript
pnpm --dir open-api/typescript-sdk run build
pnpm --dir web run check:typescript
```

If the exact OpenAPI generation command differs in this worktree, inspect `open-api/bin/generate-open-api.sh` and existing repo scripts before running generation.

## File Structure

Likely modify:

- `server/src/services/agent-operation-plan.service.ts`
- `server/src/services/agent-operation-plan.service.spec.ts`
- `server/src/repositories/agent-operation-plan.repository.ts`
- `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`
- `server/src/controllers/agent-operation-plan.controller.ts`
- `server/src/controllers/agent-operation-plan.controller.spec.ts`
- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-operation.dto.spec.ts`
- `server/src/services/agent-message.service.spec.ts`
- `server/src/repositories/agent-session.repository.ts` if a dedicated status transition helper is cleaner than generic `update()`.
- `open-api/immich-openapi-specs.json`
- `open-api/typescript-sdk/src/fetch-client.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts`

Likely add:

- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.svelte`
- `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`

Do not modify unless tests force it:

- `agent-runner/src/pi-runtime.mjs`
- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.ts`
- `server/src/services/agent-tool.service.ts`

If implementation appears to require runner changes, stop and re-evaluate. The desired behavior is user follow-up after apply, not automatic runner continuation.

## Edge Case Matrix

| Area                 | Case                                                      | Expected Result                                                                                                                           |
| -------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Apply lifecycle      | Fully applied selected operations                         | Session transitions `WaitingForPlanReview` -> `Applying` -> `Running`; `endedAt` remains `null`; websocket emits `operation-plan-applied` |
| Apply lifecycle      | Partially applied selected operations                     | Session returns to `Running`; applied card shows applied, skipped, and failed counts                                                      |
| Apply lifecycle      | All selected operations fail without throwing             | Session returns to `Running`; applied card shows failed result; composer remains enabled                                                  |
| Apply lifecycle      | Fatal exception after claim                               | Session remains marked `Failed` with `endedAt`; no composer continuation                                                                  |
| Apply lifecycle      | Apply request for non-waiting session                     | Still rejected with `Agent session is not waiting for plan review`                                                                        |
| Apply lifecycle      | Concurrent double apply of same plan                      | One succeeds; stale/second call gets existing conflict/not-found behavior; no duplicate history card                                      |
| Plan history         | No applied plans                                          | History endpoint returns `[]`; chat renders no applied-plan card                                                                          |
| Plan history         | One applied plan                                          | History endpoint returns mapped plan with operations/results                                                                              |
| Plan history         | Multiple applied plans over one session                   | History endpoint returns all applied revisions in chronological order                                                                     |
| Plan history         | Superseded proposed revisions                             | History endpoint excludes superseded plans                                                                                                |
| Plan history         | Cross-user session                                        | History endpoint rejects or returns not found consistently with existing session ownership                                                |
| Current plan         | Plan applied                                              | `getCurrentOperationPlan()` returns `null`                                                                                                |
| Current plan         | New plan proposed after applied plan                      | Current endpoint returns only the new proposed plan; history still returns prior applied plans                                            |
| Planning after apply | Assistant proposes another plan later in the same session | New proposed revision is accepted while the old applied plan remains applied history                                                      |
| Messaging            | User sends follow-up after apply                          | Message is persisted and runner dispatch is called                                                                                        |
| Messaging            | User sends while apply is still `Applying`                | Append remains rejected                                                                                                                   |
| Chat timeline        | Local apply response plus websocket event                 | Exactly one applied-plan card appears                                                                                                     |
| Chat timeline        | Remote apply event from another tab                       | Current plan dock clears, applied history refreshes, composer remains enabled after session refresh                                       |
| Chat timeline        | Reload after apply                                        | Applied card is restored from history and follow-up messages appear below it                                                              |
| Chat timeline        | Message/tool/apply same timestamp                         | Stable order by timestamp, then timeline type priority, then id/revision; no Svelte keyed-list churn                                      |
| Chat timeline        | Applied plan with many assets                             | Card stays compact by default and reuses virtualized/overflow thumbnail behavior from existing plan UI                                    |
| Chat timeline        | Applied plan with field overrides/item selections         | Card shows final applied operation state and is read-only                                                                                 |
| Chat timeline        | Read-only applied card details                            | Expanded details do not render an apply bar, disabled apply button, checkboxes, or editable controls                                      |
| UI state             | Proposed plan in dock                                     | Review UI remains editable while status is `Proposed`                                                                                     |
| UI state             | Applied plan in dock component after local apply          | Dock hides instead of showing stale applied review controls                                                                               |
| UI state             | Completed legacy session                                  | Existing terminal handling remains unchanged                                                                                              |
| Accessibility        | Applied plan card                                         | Card has an article/region label, status text, keyboard-expandable details, and no unlabeled controls                                     |

---

## Task 1: Server Lifecycle Red Tests

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/services/agent-message.service.spec.ts`

- [ ] **Step 1: Add red tests for apply success returning to Running**

Add tests around `applyApprovedOperations()`:

- Fully successful apply updates the session with:
  - `status: AgentSessionStatus.Running`
  - no `endedAt` value, or `endedAt: null` if using explicit reset
- The service no longer writes `AgentSessionStatus.Completed` on success.
- The websocket `operation-plan-applied` payload remains emitted with counts.
- Response plan status remains `AgentOperationPlanStatus.Applied`.

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts
```

Expected red failure: tests still see `Completed` and `endedAt`.

- [ ] **Step 2: Add red tests for partial and failed non-throwing apply outcomes**

Add tests where `completeApply()` returns:

- Some selected operations `Applied`, some `Failed` or `Skipped`.
- All selected operations `Failed`.

Assert both outcomes return the session to `Running`, emit the same applied event, and do not set `endedAt`.

- [ ] **Step 3: Add current-plan clearing test**

After a plan has been applied:

- `getCurrentPlan(auth, session.id)` returns `null`.
- The applied plan remains retrievable through the new applied history API introduced below.

This protects the split between "current proposed plan" for the dock and "applied plan history" for the chat transcript.

- [ ] **Step 4: Preserve fatal exception behavior**

Add or update a test proving exceptions thrown after `claimCurrentForApply()` still call `tryMarkApplySessionFailed()` and mark:

- `status: AgentSessionStatus.Failed`
- `endedAt: expect.any(Date)`

This prevents real execution failures from leaving an ambiguous `Applying` session.

- [ ] **Step 5: Add follow-up message service test**

In `AgentMessageService` tests:

- Arrange a session that was previously waiting for plan review but is now `Running`.
- Append a user message.
- Assert it persists and calls `agentRunnerService.sendMessage()`.
- Keep the existing rejection for `Applying`, `Completed`, `Cancelled`, and `Failed`.

This test documents the end-user behavior: after apply completes, the same chat accepts follow-ups.

- [ ] **Step 6: Add second-plan-after-apply service test**

Add a service-level test proving the runner can propose another plan later in the same session:

- Session status is `Running`.
- The repository already has an applied plan for the session.
- `proposeAlbumOperations()` creates a new `Proposed` revision.
- The existing applied plan is not superseded or hidden from applied history.
- The session transitions back to `WaitingForPlanReview` for the new proposal.

## Task 2: Server Lifecycle Implementation

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Optionally modify: `server/src/repositories/agent-session.repository.ts`

- [ ] **Step 1: Change apply success transition**

In `applyApprovedOperations()`:

- Replace successful update to `Completed` with `Running`.
- Do not set `endedAt`.
- Prefer a narrow repository helper if it improves readability, for example `markRunningAfterApply(userId, sessionId)`.
- Keep `Applying` as the repository claim state.

Implementation target:

```ts
await this.sessionRepository.update(auth.user.id, session.id, {
  status: AgentSessionStatus.Running,
  endedAt: null,
});
```

If the repository DTO or DB typing makes `endedAt: null` awkward, omit `endedAt` and assert it is not set by the apply path. Do not keep `endedAt: new Date()` on success.

- [ ] **Step 2: Run focused green tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/services/agent-message.service.spec.ts
```

## Task 3: Applied Plan History API Red Tests

**Files:**

- Modify: `server/test/medium/specs/repositories/agent-operation-plan.repository.spec.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`
- Modify: `server/src/controllers/agent-operation-plan.controller.spec.ts`
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`

- [ ] **Step 1: Add repository red tests**

Add a repository test for a method such as:

```ts
listAppliedBySessionId(sessionId: string)
```

Assert it:

- returns only `AgentOperationPlanStatus.Applied`;
- excludes `Proposed`, `Superseded`, and `Cancelled`;
- includes operations for each plan;
- orders by `updatedAt`, then `revision`, then `id` for stable chat rendering.

Add a repository regression test for proposing after apply:

- An existing `Applied` plan remains `Applied`.
- `createReplacementRevision()` creates a new `Proposed` revision.
- Only existing `Proposed` plans are superseded.

- [ ] **Step 2: Add service red tests**

Add `AgentOperationPlanService.listAppliedPlans(auth, sessionId)` tests:

- Returns mapped applied plans for the owned session.
- Returns `[]` when no applied plans exist.
- Rejects missing/cross-user session with existing ownership behavior.
- Does not require an active session; applied history should load for running and legacy completed sessions.
- Keeps applied history available after a newer proposed plan exists.

- [ ] **Step 3: Add controller and DTO red tests**

Add a route under the existing controller, recommended:

```http
GET /agent/sessions/:id/operation-plan/applied
```

Expected service method:

```ts
getAppliedOperationPlans(auth, id): Promise<AgentOperationPlanResponseDto[]>
```

Controller tests should assert:

- permission is `AgentSessionRead`;
- OpenAPI response is an array of `AgentOperationPlanResponseDto`;
- dates serialize through the existing DTO;
- method delegates to the service.

DTO tests should assert an array response can parse if a wrapper DTO is introduced. If the controller returns `AgentOperationPlanResponseDto[]` directly and existing DTO coverage is enough, add no unnecessary wrapper.

- [ ] **Step 4: Run red server history tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/dtos/agent-operation.dto.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
```

Expected red failure: repository/service/controller method does not exist.

## Task 4: Applied Plan History API Implementation

**Files:**

- Modify: `server/src/repositories/agent-operation-plan.repository.ts`
- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/controllers/agent-operation-plan.controller.ts`
- Modify: `open-api/immich-openapi-specs.json`
- Modify generated SDK files as needed.

- [ ] **Step 1: Implement repository method**

Add `listAppliedBySessionId(sessionId)`:

- Query `agent_operation_plan` by `sessionId`.
- Filter `status = AgentOperationPlanStatus.Applied`.
- Order ascending by `updatedAt`, then `revision`, then `id`.
- Hydrate operations using existing `withOperations` helpers.

- [ ] **Step 2: Implement service and controller method**

Add:

```ts
async listAppliedPlans(auth: AuthDto, sessionId: string): Promise<AgentOperationPlanResponseDto[]>
```

Use `getOwnedSession(auth, sessionId, { requireActive: false })`.

Add controller route:

```ts
@Get('applied')
getAppliedOperationPlans(...)
```

- [ ] **Step 3: Generate OpenAPI/SDK**

Run the repo's OpenAPI generation path and verify the SDK exports a function with a clear name, expected to be:

```ts
getAppliedOperationPlans({ id });
```

If generation chooses a poor name, prefer adjusting the controller method name/summary rather than hand-editing generated SDK output.

- [ ] **Step 4: Run focused green tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/dtos/agent-operation.dto.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir open-api/typescript-sdk run build
```

## Task 5: Chat Timeline Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Add: `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.spec.ts`
- Optionally modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Add applied history loading test**

In `AgentSessionChatPanel` tests:

- Mock SDK `getAppliedOperationPlans`.
- Return one applied plan.
- Render chat panel with existing messages.
- Assert an applied plan card appears in the transcript.
- Assert the card appears in chronological order between surrounding messages based on timestamps.

Expected initial failure: component does not call the new SDK method and does not render applied plans.

- [ ] **Step 2: Add follow-up ordering test**

Arrange:

- user message before apply;
- applied plan history item;
- user follow-up after apply.

Assert DOM order:

1. original user message
2. applied plan card
3. follow-up user message

- [ ] **Step 3: Add websocket refresh and dedupe tests**

Add tests for `operation-plan-applied`:

- Same-session event calls `getAppliedOperationPlans()` again.
- Different-session event is ignored.
- Repeated same-plan event does not duplicate the card.
- Local apply response plus websocket refresh still renders one card.

- [ ] **Step 4: Add card component tests**

For `AgentAppliedPlanTimelineCard`:

- Shows compact status: "Applied plan" or localized equivalent.
- Shows summary and applied/skipped/failed counts.
- Is collapsed by default.
- Expanding reveals read-only operation details.
- Does not show apply buttons, disabled apply buttons, checkboxes, editable text inputs, or selection controls.
- Displays partial/failed operation statuses clearly.
- Has accessible `article` or `region` labeling.

- [ ] **Step 5: Run red web tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Expected red failure: no applied-plan timeline support exists.

## Task 6: Chat Timeline Implementation

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Add: `web/src/routes/(user)/assistant/agent-applied-plan-timeline-card.svelte`
- Reuse: `web/src/routes/(user)/assistant/agent-plan-evidence-ledger.svelte`
- Reuse: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts`

- [ ] **Step 1: Add applied plan state and loading**

In `AgentSessionChatPanel`:

- Import generated SDK `getAppliedOperationPlans`.
- Add `appliedPlans` state.
- Load messages and applied plans for the session.
- Treat applied plan load failure like a non-fatal transcript enhancement failure if messages load; show a small alert only if useful and do not block chat.

- [ ] **Step 2: Merge timeline item types**

Extend `ChatTimelineItem`:

```ts
| { type: 'applied-plan'; id: string; occurredAt: string; plan: AgentOperationPlanResponseDto }
```

Use `plan.updatedAt` for `occurredAt`.

Stable sort rules:

1. `occurredAt`
2. type priority: message, tool-call, applied-plan unless tests show a better user ordering
3. id

If tool-call and applied-plan timestamps are identical, prefer showing the tool-call audit before the applied plan.

- [ ] **Step 3: Render applied plan card**

Add a compact card component:

- `article` with accessible label.
- Header: "Applied plan", status/count summary, timestamp if local pattern uses it.
- Body collapsed by default.
- Expanded details reuse the existing plan review model and destination/operation components in a true read-only mode.
- Do not mount `AgentPlanEvidenceLedger` as-is unless it first gets an explicit read-only/no-apply-bar mode, because the current component always renders `AgentPlanApplyBar`.
- If adding a read-only mode to `AgentPlanEvidenceLedger`, cover it with tests proving no apply bar or disabled apply button renders.
- Read-only detail rendering should use:
  - `canChangeSelection={false}`
  - `canApply={false}`
  - `applying={false}`
  - no-op handlers only where existing component APIs require callback props
- Avoid nested-card styling inside chat if it clashes with existing chat rows.

- [ ] **Step 4: Refresh on websocket event**

In `handleSessionEvent()`:

- On same-session `operation-plan-applied`, refresh applied plan history.
- Do not clear messages or streaming state.
- Keep ignoring `operation-plan-ready` in the chat panel except for existing behavior.

- [ ] **Step 5: Run focused green web tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts
```

## Task 7: Dock Clearing And Composer Red Tests

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-lifecycle-ui.spec.ts`

- [ ] **Step 1: Add dock clearing tests**

In `AgentOperationPlanReviewPanel` tests:

- Local apply success with `variant="dock"` and `hideEmpty` should stop rendering the plan review region.
- It should not show read-only applied-plan details in the dock.
- Standalone behavior can still show a success message if `hideEmpty` is false.

- [ ] **Step 2: Add action dock session refresh tests**

In `AgentSessionActionDock` tests:

- A same-session `operation-plan-applied` websocket event while the current prop status is `WaitingForPlanReview` calls `getAgentSession({ id })`.
- The returned `Running` session is passed to `onSessionUpdated`.
- The dock reloads current plan state and hides when `getCurrentOperationPlan()` returns `null`.
- A different-session `operation-plan-applied` event does not refresh the selected session.

This is required because the existing polling refresh only runs for `Running` and `WaitingForToolApproval`; a waiting-for-plan-review session must still refresh after apply.

- [ ] **Step 3: Add composer enabled tests**

In `AgentConversationPane` tests:

- Start with `WaitingForPlanReview`.
- Apply succeeds and parent session refresh returns `Running`.
- Composer remains enabled.
- "Start new chat" terminal action is not shown.
- A follow-up message can be submitted after the applied plan card.

- [ ] **Step 4: Keep terminal legacy tests**

In lifecycle UI tests:

- `Completed`, `Cancelled`, and `Failed` remain terminal.
- `Running` remains send-enabled.
- `Applying` remains disabled.

This confirms the feature does not erase legacy terminal behavior.

## Task 8: Dock Clearing And Composer Implementation

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte` if explicit applied callback wiring is cleaner than relying on websocket/history refresh.

- [ ] **Step 1: Clear proposed plan after apply**

After successful apply:

- Set local `plan = null` for the review panel.
- Keep `applyMessage` only when `hideEmpty` is false.
- For `hideEmpty` dock mode, render nothing after apply.
- Do not show `response.plan` as an editable or read-only proposed-plan dock card.

- [ ] **Step 2: Refresh session state after apply**

Ensure a same-session `operation-plan-applied` event triggers `getAgentSession()` even when the current selected-session prop is `WaitingForPlanReview`.

The selected session should become `Running` after the server change.

Keep this refresh scoped to the selected session and avoid continuous polling when the only active state is plan review.

- [ ] **Step 3: Run focused green web tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-session-lifecycle-ui.spec.ts
```

## Task 9: Integration And Regression

- [ ] **Step 1: Run server regression**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-operation-plan.service.spec.ts src/controllers/agent-operation-plan.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/services/agent-message.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.medium.mjs test/medium/specs/repositories/agent-operation-plan.repository.spec.ts
pnpm --dir server run check
```

- [ ] **Step 2: Run web regression**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-applied-plan-timeline-card.spec.ts src/routes/\(user\)/assistant/agent-operation-plan-review-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts src/routes/\(user\)/assistant/agent-session-lifecycle-ui.spec.ts src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
```

- [ ] **Step 3: Format and diff checks**

```bash
pnpm --dir server run format
pnpm --dir web run format
git diff --check
```

- [ ] **Step 4: Manual verification**

With `make dev` or the normal local stack:

1. Open `/assistant`.
2. Ask Pi to create/apply a small album plan.
3. Apply the plan.
4. Verify the dock clears.
5. Verify the session header shows running/active state, not completed.
6. Verify the applied plan appears in chat.
7. Send a follow-up message below the applied plan.
8. Reload the page and confirm the applied plan and follow-up remain in order.
9. In another tab, apply a plan and confirm the first tab refreshes without duplicates.

## Completion Criteria

- Applying a plan no longer ends the session.
- The composer remains enabled after apply.
- Follow-up messages in the same session persist and dispatch to the runner.
- Applied plans render as read-only structured timeline cards.
- Applied cards survive reload through persisted history.
- Proposed plan review disappears from the dock after apply.
- Current proposed-plan behavior remains unchanged before apply.
- Terminal legacy sessions remain read-only.
- Focused and regression tests pass.
