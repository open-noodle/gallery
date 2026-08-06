# Pi Agent Session History Resume 04 Plan Review Action Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the next slice from `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`: move operation-plan review into the selected-session action dock above the composer, preserve existing plan review/apply behavior, and remove the separate plan review block that currently renders below chat.

**Architecture:** UI-only browser slice. Reuse the slice 3 `AgentSessionActionDock` as the single selected-session work area for approvals and plan review. Refactor `AgentOperationPlanReviewPanel` so it can render as a dock card without rewriting its existing loader, websocket refresh, selection, dependency, or apply behavior. No backend, generated SDK, runner, MCP, compose, Docker, or e2e runner changes.

**Tech Stack:** Svelte 5, existing generated `@immich/sdk` browser APIs, `@immich/ui`, focused Vitest/Svelte Testing Library tests.

---

## Scope

This slice implements plan review inside the action dock created in slice 3:

- Refactor `AgentOperationPlanReviewPanel` to support an embedded action-dock presentation:
  - no outer page-width section or duplicate page padding in dock mode;
  - no "No proposed album plan yet" empty text in dock mode;
  - localized plan load/apply errors remain inside the dock;
  - existing standalone behavior remains test-covered until removed from `AgentConversationPane`.
- Make the plan review card collapsible while preserving selection state.
- Treat the collapsible plan card summary row as the design's compact plan summary near the latest chat content; do not inject a synthetic transcript message in this slice.
- Add a sticky apply area inside the dock card for long plans.
- Keep selected-operation count visible near the apply action.
- Show applied/failed/skipped operation state in read-only plans.
- Render the dock's active work item in priority order:
  - pending tool approvals first;
  - plan review when there are no pending approval cards and a plan exists;
  - collapsed recent approval activity can remain below active work.
- Remove the old separate `<AgentOperationPlanReviewPanel />` rendering below chat in `AgentConversationPane`.
- Preserve composer behavior from slice 3:
  - pending approvals still disable free-form send;
  - `waiting_for_plan_review` keeps the composer enabled so the user can send revision feedback.

This slice intentionally does not add:

- Backend/session lifecycle changes.
- New plan revision APIs.
- New websocket event types.
- Durable chat titles.
- Cancel/resume actions.
- Full terminal/completed composer lifecycle rules.
- Broad Playwright/e2e coverage.

## Design Source

- `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`

Relevant design decisions:

- Operation-plan review belongs in the selected conversation workspace.
- The full operation review belongs in the action dock above the composer.
- The user should stay close to the chat thread so they can ask for revisions.
- Plan review keeps existing grouping, operation toggles, dependency blocking, and `applyApprovedOperations()` behavior.
- `waiting_for_plan_review` keeps the chat composer enabled.
- Implementation must use TDD.

## Slice 3 Baseline

Slice 3 already provides:

- `AgentSessionActionDock` rendered inside `AgentSessionChatPanel` between transcript messages and composer.
- `AgentConversationPane` tracks pending approval count and disables the composer only while approvals are actionable.
- `AgentOperationPlanReviewPanel` still renders as a separate block below chat.

This slice must use that current shape. Do not add another page section for plan review. The dock slot is now the conversation-body anchor for the plan card/review.

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

- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- `i18n/en.json`

Only touch `agent-operation-plan-ui.ts` / `.spec.ts` if a pure helper is needed for applied-status display. If that happens, write helper tests first.

## UI Contracts

### Action Dock Ownership

`AgentSessionActionDock` becomes the selected-session work dock for both approvals and operation plans.

Implementation contract:

- load tool calls exactly as slice 3 does;
- render pending approval cards first when pending approvals exist;
- render `AgentOperationPlanReviewPanel` in dock mode when no pending approvals are actionable;
- leave recent approval activity collapsed and available;
- keep approval load errors localized to the approval part of the dock;
- keep plan load errors localized to the plan part of the dock;
- do not blank transcript/header/sidebar when either dock request fails.

If both pending approvals and a proposed plan exist, tool approvals take priority in the active dock area. Once pending approvals disappear after refresh, the plan review can appear.

While the initial approval load is still unresolved, do not briefly show the full plan review as the active work item. After approval loading finishes with no pending calls, render the plan review. If approval loading fails, render the localized approval error and still allow the plan review to render so one partial failure does not blank the other dock work.

### Plan Review Dock Mode

`AgentOperationPlanReviewPanel` should accept props similar to:

```ts
variant?: 'standalone' | 'dock';
hideEmpty?: boolean;
```

Dock mode:

- uses compact card styling suitable inside `AgentSessionActionDock`;
- does not wrap itself in the old page-section max-width shell;
- hides the no-plan empty message when `hideEmpty` is true;
- still shows localized loading for `waiting_for_plan_review` or when a plan load is in flight and no previous plan exists;
- still shows localized plan load errors;
- preserves all existing operation group, selection, dependency, apply, websocket refresh, stale-load, and cleanup behavior.

Standalone mode should keep current tests passing until `AgentConversationPane` stops using it.

### Collapsible Plan Card

The plan card should be collapsible without losing local state.

Implementation contract:

- default expanded when a proposed plan is loaded;
- summary row shows plan summary and selected operation count;
- collapsing hides operation groups and the sticky apply area;
- expanding restores the same local selection state;
- plan load and apply errors remain visible even when the card is collapsed, or the card reopens automatically on error.

Prefer native `<details>`/`<summary>` unless existing component patterns make a controlled button clearer.

### Sticky Apply Area

For long plans:

- the apply action area stays reachable at the bottom of the dock card;
- selected-operation count remains visible near the apply button;
- apply button still disables when zero operations are selected, while applying, or when plan status is not proposed;
- apply success replaces the primary action area with a localized status summary.

Component tests can assert stable semantic text and a `data-testid`/class marker for the sticky area. Do not rely on fragile screenshots.

### Read-Only Applied Plans

When the current plan is already applied, cancelled, superseded, or otherwise not proposed:

- operation toggles are disabled;
- apply button is not the primary action;
- applied/skipped/failed operation statuses are visible and text-readable;
- operation errors are shown when available;
- operation result details are not dumped as raw JSON; show only safe, concise result text if the existing DTO value is already displayable;
- the user can still read the plan in the dock.

Only use statuses exposed by the generated SDK. Do not add SDK enum values.

### Composer Behavior

This slice must not add broad lifecycle rules.

- pending approval cards still disable composer through `pendingApprovalCount > 0`;
- plan review does not disable composer;
- `waiting_for_plan_review` with a proposed plan keeps free-form send enabled for revision feedback;
- completed/applying/terminal composer rules remain a later lifecycle slice, but this slice must not make applied/read-only plan state depend on the composer being enabled;
- existing send, streaming, draft preservation, and title-discovery behavior stay unchanged.

## Test Commands

Use focused Vitest commands without an extra `--`.

Red/green focused commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
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

No broad e2e is required in this slice. The targeted reload/resume smoke can remain for the later final workflow slice.

## Slice 4 Edge Cases To Cover

Plan review dock mode:

- no plan plus `hideEmpty` renders nothing, not `No proposed album plan yet`;
- no plan in standalone mode still renders existing empty text;
- initial plan loading renders a localized status in dock mode when appropriate;
- initial plan load failure renders a localized dock alert;
- refresh failure after a loaded plan keeps the old plan visible and shows an alert;
- stale in-flight plan load after unmount/session switch does not publish selection or replace state;
- websocket `operation-plan-ready` for selected session refreshes plan;
- websocket `operation-plan-applied` for selected session refreshes plan or preserves local apply success;
- websocket events for other sessions do not refresh plan.

Collapsible card:

- proposed plan renders expanded by default;
- collapse hides operation groups and sticky apply area;
- expand restores the previous selected/unselected operations;
- selected count updates while expanded and is still reflected in the summary row;
- apply/load errors are visible after collapse or force the card open.

Sticky apply area:

- selected count appears near the apply button;
- long plan has a stable sticky action container;
- apply button disables for zero selected operations;
- apply button disables while applying;
- failed apply leaves selected operations and plan visible;
- same-plan applied websocket event during local apply is handled exactly as existing tests expect.

Read-only/applied plans:

- non-proposed plan disables all operation and group toggles;
- non-proposed plan does not present an enabled apply action;
- applied operation statuses are visible;
- failed operation errors are visible;
- skipped/blocked statuses are text-readable and not color-only;
- partial apply summary includes applied and failed counts.

Action dock integration:

- pending approval cards render before plan review;
- pending approvals suppress the full plan review active area until approvals refresh away;
- unresolved initial approval loading does not briefly show plan review before approval priority is known;
- approval load failure still allows plan review to render with its own load state;
- with no pending approvals and a current plan, plan review renders inside the dock above composer;
- approval load error does not blank plan review;
- plan load error does not blank approval recent activity or chat;
- recent approval activity remains collapsed below active work;
- switching sessions clears plan and approval dock state;
- no unselected session plan requests are made from sidebar rows.

Conversation/workspace:

- `AgentConversationPane` no longer renders a separate plan review panel below chat;
- chat, action dock, and composer remain in the same card flow;
- `waiting_for_plan_review` leaves textarea and send button enabled when there are no pending approvals;
- pending approvals still disable textarea and send button;
- transcript load failure does not blank the plan dock;
- plan load failure does not blank transcript/header/sidebar;
- selected session title discovery behavior remains unchanged.

Accessibility/responsive:

- plan review region has a stable accessible name;
- collapse/expand control has a stable accessible name;
- apply button has a stable accessible name with selected count;
- status and risk information are text-readable;
- applied/failed/skipped status is not color-only;
- long plan summary, album titles, operation summaries, and error text wrap within the dock;
- sticky action area does not overlap operation rows on mobile widths.

---

## Task 1: Plan Review Dock Mode

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `i18n/en.json` if new labels are needed

- [ ] **Step 1: Write failing dock-mode tests**

Add tests for:

- `variant="dock"` removes the standalone page-section shell and renders a compact card;
- `hideEmpty` suppresses no-plan empty text;
- standalone no-plan behavior still renders `No proposed album plan yet`;
- dock mode plan load error renders localized `role="alert"`;
- dock mode refresh error keeps an already loaded plan visible;
- existing group/selection/apply/websocket/stale-load tests still pass.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: FAIL because dock-mode props/markup do not exist.

- [ ] **Step 2: Implement dock mode**

Add props similar to:

```ts
variant?: 'standalone' | 'dock';
hideEmpty?: boolean;
```

Implementation notes:

- preserve existing default standalone markup;
- use compact card classes in dock mode;
- return no visible empty state when `hideEmpty && !loading && !errorMessage && !model && !applyMessage`;
- keep all existing async guards and websocket cleanup.

Run the focused test. Expected: PASS.

## Task 2: Collapsible Plan Card And Sticky Apply Area

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `i18n/en.json` if new labels are needed

- [ ] **Step 1: Write failing card behavior tests**

Add tests for:

- proposed plan is expanded by default;
- collapse hides operation groups and sticky action area;
- expand restores previous local operation selection;
- summary row shows plan summary and selected-operation count;
- sticky action area has a stable test id/class and contains selected count plus apply button;
- apply error remains visible or reopens card after collapse.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: FAIL because the card is not collapsible and the apply area is not sticky.

- [ ] **Step 2: Implement collapsible/sticky behavior**

Implementation notes:

- prefer native `<details open>` for collapse state;
- keep operation selection state outside the collapsed DOM branch if needed so it survives collapse;
- add `data-testid="agent-operation-plan-sticky-actions"` to the sticky action area;
- keep the selected count near the apply button;
- keep existing apply semantics unchanged.

Run the focused test. Expected: PASS.

## Task 3: Read-Only Applied/Partial Plan State

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-review-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.ts` only if a pure helper is needed
- Modify: `web/src/routes/(user)/assistant/agent-operation-plan-ui.spec.ts` only if a pure helper is added
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing read-only tests**

Add tests for:

- applied plan disables all toggles;
- non-proposed plan does not show an enabled apply primary action;
- operation statuses render for applied, skipped, failed, and proposed operations;
- failed operation error text renders;
- raw operation result JSON is not rendered;
- partial apply summary shows applied and failed counts.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-operation-plan-review-panel.spec.ts'
```

Expected: FAIL because statuses/results are not displayed yet.

- [ ] **Step 2: Implement read-only status display**

Implementation notes:

- map existing generated `AgentOperationStatus` values to i18n label keys;
- show status text beside operation metadata;
- show `operation.error` when present;
- avoid rendering raw `operation.result` objects unless a specific safe display string already exists;
- replace the primary apply area with apply/result status when the plan is not proposed;
- do not invent statuses not present in the SDK.

Run the focused test. Expected: PASS.

## Task 4: Compose Plans Into The Action Dock

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`

- [ ] **Step 1: Write failing action-dock integration tests**

Add tests for:

- with no pending approvals and a current plan, plan review renders inside the action dock;
- pending approvals render before/suppress the active full plan review;
- initial approval loading suppresses the active full plan review until approval priority is known;
- when approvals refresh away, plan review can render;
- approval load error does not blank plan review;
- plan load error does not blank recent approval activity;
- recent approval activity remains collapsed below active work;
- `getCurrentOperationPlan({ id })` is requested only for the selected session.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-action-dock.spec.ts'
```

Expected: FAIL because the action dock currently only renders approvals/recent activity.

- [ ] **Step 2: Render plan review inside dock**

Implementation notes:

- import `AgentOperationPlanReviewPanel`;
- render it in `variant="dock"` with `hideEmpty`;
- render it only when `pendingToolCalls.length === 0` so approvals remain the active priority;
- keep recent approval activity below the active area;
- ensure plan and approval failures stay visually independent.

Run the focused action-dock test. Expected: PASS.

## Task 5: Remove Separate Plan Block From Conversation Pane

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`

- [ ] **Step 1: Write failing conversation/workspace tests**

Add/update tests for:

- conversation pane no longer renders `AgentOperationPlanReviewPanel` below chat;
- plan review appears above composer through the action dock;
- `waiting_for_plan_review` leaves composer enabled when no pending approvals exist;
- pending approvals still disable composer;
- transcript load failure does not blank plan dock;
- plan load failure does not blank transcript/header/sidebar;
- selected title discovery and no-unselected-transcript-fetch tests remain green.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts' 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts'
```

Expected: FAIL because the pane still renders the separate plan panel.

- [ ] **Step 2: Remove standalone plan rendering**

Implementation notes:

- remove the `AgentOperationPlanReviewPanel` import/render from `AgentConversationPane`;
- keep `AgentSessionActionDock` inside the chat panel dock snippet;
- keep `pendingApprovalCount` composer blocking unchanged;
- update mocks in existing tests so the dock's plan load is explicit.

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
- only expected web/i18n/doc files changed.

## Implementation Notes

- Use TDD for each behavior: write the failing focused test, verify the expected failure, implement the smallest change, then rerun the focused test.
- Prefer preserving the existing `AgentOperationPlanReviewPanel` logic over rewriting apply/selection behavior.
- Keep plan and approval state independent. A failure in one part of the dock must not blank the other part.
- Keep `waiting_for_plan_review` composer-enabled. This is the main lifecycle rule covered by this slice.
- Avoid snapshots. Assert roles, accessible names, visible text, disabled states, callback payloads, and SDK calls.
