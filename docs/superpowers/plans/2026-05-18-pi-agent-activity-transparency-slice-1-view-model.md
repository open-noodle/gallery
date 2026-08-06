# Pi Agent Activity Transparency Slice 1 View Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Add the first activity-transparency vertical slice: a pure frontend activity view model that derives plain-language activity rows from existing assistant messages, tool calls, operation plans, applied plans, and session status.

**Architecture:** This slice adds `agent-activity-ui.ts` next to the existing assistant route helpers. It does not render the activity block, persist new activity events, change the backend, or change the runner. Later slices will consume this view model in chat UI and wire live updates.

**Tech Stack:** TypeScript, generated `@immich/sdk` DTO types, Vitest, existing assistant route test patterns.

---

## Source Spec

Implements Slice 1 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

## Scope

In scope:

- Create `web/src/routes/(user)/assistant/agent-activity-ui.ts`.
- Create `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`.
- Define typed activity view-model structures compatible with the spec:
  - `AgentActivityItem`
  - `AgentActivityStatus`
  - `AgentActivityKind`
  - `AgentActivityTechnicalDetails`
  - `AgentActivityModel`
- Derive activity rows from existing durable inputs:
  - `AgentMessageResponseDto[]`
  - `AgentToolCallResponseDto[]`
  - current `AgentOperationPlanResponseDto | null`
  - applied `AgentOperationPlanResponseDto[]`
  - `AgentSessionResponseDto`
  - optional streaming/busy state inputs
- Map known Gallery tool calls to human labels.
- Coalesce repeated read-tool calls by activity kind.
- Derive activity for pending approval, prepared plans, applying state, and applied plans.
- Keep technical metadata separate from default activity titles/summaries.
- Provide deterministic ordering and stable ids.
- Cover malformed/missing timestamps and large metadata inputs.

Out of scope:

- Rendering `AgentActivityBlock.svelte`.
- Adding chat timeline items.
- Adding visibility toggles or session menu controls.
- Websocket refresh behavior.
- Persisting activity events.
- Server DTO/API changes.
- Runner/SSE protocol changes.
- New i18n keys.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner test commands are required for this slice because there are no backend or runner changes.

## Edge Cases Covered In This Slice

| Spec area                | Case                                | Slice 1 expectation                                                                             |
| ------------------------ | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Visibility/model safety  | Compact/default row labels          | View model exposes safe `title` and `summary` only; raw tool names stay in `technical`          |
| Turn grouping foundation | Same timestamp rows                 | Deterministic sort by timestamp, type priority, then id                                         |
| Live update foundation   | Tool call starts after user message | Running row can be derived from active tool-call status                                         |
| Live update foundation   | Tool completes                      | Completed row can be derived from completed tool-call status                                    |
| Live update foundation   | Plan becomes ready                  | Plan row derives `Prepared a plan` from current proposed plan or `WaitingForPlanReview` status  |
| Live update foundation   | Plan apply starts                   | Apply row derives `Applying changes` from `Applying` session status                             |
| Permissions              | Tool needs approval                 | Pending tool call derives a blocked `Waiting for approval` row                                  |
| Errors                   | Tool fails                          | Failed row derives safe failure state and redacted technical error                              |
| Errors                   | Unknown tool name                   | Generic safe copy renders; raw tool name remains technical-only                                 |
| Privacy                  | Provider key appears in error       | Redaction helper removes obvious key/token/secret patterns from technical error text            |
| Privacy                  | Runner token appears in metadata    | Redaction helper removes obvious bearer/token/secret patterns from stringified technical values |
| Performance              | Many repeated metadata calls        | Rows coalesce into one aggregate metadata activity item                                         |
| Performance              | Large asset id arrays               | Activity title/summary do not include raw ids; counts are aggregated                            |

## Edge Cases Deferred To Later Slices

- Rendering collapsed/expanded activity blocks in chat.
- Persisting expanded/collapsed visibility state.
- Session menu controls for `Off`, `Compact`, and `Expanded`.
- Websocket-driven live refresh and in-place UI updates.
- Reload integration in chat after the model is consumed by the transcript.
- Explicit backend activity events for runner-start, plan-composing, apply-progress, and runner-recovery gaps.
- Accessibility behavior for controls, live regions, focus retention, reduced motion, and mobile layout.

## File Structure

Create:

- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

Do not modify in this slice:

- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-action-dock.svelte`
- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`

---

## Task 1: Add Activity View Model Red Tests

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Add test fixtures**

Create helpers in the spec for:

- `makeSession(overrides)`
- `makeMessage(overrides)`
- `makeToolCall(overrides)`
- `makePlan(overrides)`
- `makeOperation(overrides)`

Use generated SDK enums/types:

- `AgentMessageRole`
- `AgentSessionStatus`
- `AgentToolCallStatus`
- `AgentToolName`
- `AgentToolDataClass`
- `AgentOperationPlanStatus`
- `AgentOperationStatus`
- `AgentOperationType`
- `AgentOperationTargetKind`

Keep fixture ids and timestamps stable.

- [ ] **Step 2: Write failing tests for known tool labels**

Add a table-driven test that calls:

```ts
buildAgentActivityModel({
  session: makeSession(),
  messages: [],
  toolCalls: [makeToolCall({ toolName, status: AgentToolCallStatus.Completed })],
  currentPlan: null,
  appliedPlans: [],
});
```

Assert the safe activity labels:

| Tool                       | Kind                                                 | Title                    | Summary                   |
| -------------------------- | ---------------------------------------------------- | ------------------------ | ------------------------- |
| `SearchAssets`             | `search`                                             | `Searching photos`       | `Found matching photos`   |
| `ReadAssetMetadata`        | `metadata`                                           | `Reading photo details`  | `Read details for photos` |
| `ReadAssetPreviews`        | `preview`                                            | `Loading photo previews` | `Loaded photo previews`   |
| `ReadAssetOriginals`       | `preview` or `unknown` if intentionally conservative | `Opening original files` | `Opened original files`   |
| `ListAlbums`               | `album`                                              | `Searching albums`       | `Found matching albums`   |
| `ReadAlbum`                | `album`                                              | `Reading album details`  | `Read album details`      |
| `ProposeAlbumOperations`   | `plan`                                               | `Preparing a plan`       | `Prepared a plan`         |
| `ReviseProposedOperations` | `plan`                                               | `Revising the plan`      | `Revised the plan`        |
| `SummarizePlan`            | `plan`                                               | `Summarizing the plan`   | `Summarized the plan`     |

Expected red failure: `agent-activity-ui.ts` does not exist.

- [ ] **Step 3: Write failing tests for status mapping**

Assert:

- `PendingApproval` maps to one `permission` row:
  - `status: 'blocked'`
  - `title: 'Waiting for approval'`
  - no raw tool name in default title or summary
- `Approved` and `Executing` map to `running`
- `Completed` maps to `completed`
- `Failed` maps to `failed`
- `Denied` maps to `skipped`

- [ ] **Step 4: Write failing tests for coalescing**

Use several metadata/previews calls:

- two completed `ReadAssetMetadata` calls with different `assetCount`;
- one running `ReadAssetMetadata` call;
- two completed `ReadAssetPreviews` calls.

Assert:

- metadata calls coalesce into one `metadata` row;
- preview calls coalesce into one `preview` row;
- aggregated `count` equals the sum of asset counts where present;
- combined status uses precedence:
  - `failed`
  - `blocked`
  - `running`
  - `completed`
  - `skipped`
  - `pending`
- `startedAt` is the earliest valid start timestamp;
- `completedAt` is omitted while any grouped call is running.

- [ ] **Step 5: Write failing tests for plan/session/apply derivation**

Assert:

- `currentPlan.status === Proposed` derives a completed `plan` row with `Prepared a plan`.
- `session.status === WaitingForPlanReview` derives the same plan row even if the current plan input has already loaded.
- `session.status === Applying` derives a running `apply` row with `Applying changes`.
- non-empty `appliedPlans` derives a completed `apply` row with `Applied selected changes`.
- plan/apply rows do not replace tool rows; ordering remains deterministic.

- [ ] **Step 6: Write failing tests for privacy and malformed data**

Assert:

- unknown future tool name returns generic copy:
  - `title: 'Working with Gallery'`
  - completed summary: `Checked Gallery data`
- raw unknown tool name appears only in `technical.toolName`;
- default titles/summaries never include raw asset ids from `redactedRequestMetadata`, `redactedResponseMetadata`, or large `assetIds`-like arrays;
- technical error strings redact obvious secrets:
  - `sk-...`
  - `Bearer ...`
  - `token=...`
  - `api_key=...`
  - `provider key ...`
- missing/invalid timestamps do not throw and sort deterministically after valid timestamps.

- [ ] **Step 7: Run the red command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected red failure: missing module and exports.

---

## Task 2: Implement Activity Types And Public Builder

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Add exported types**

Define:

```ts
export type AgentActivityKind =
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

export type AgentActivityStatus = 'pending' | 'running' | 'blocked' | 'completed' | 'failed' | 'skipped';

export type AgentActivityTechnicalDetails = {
  toolName?: string;
  toolCallIds?: string[];
  requestSummary?: string;
  responseSummary?: string;
  error?: string;
  assetCount?: number;
  albumCount?: number;
  startedAt?: string;
  completedAt?: string;
};

export type AgentActivityItem = {
  id: string;
  sessionId: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  title: string;
  summary?: string;
  count?: number;
  startedAt: string;
  completedAt?: string;
  technical?: AgentActivityTechnicalDetails;
};

export type AgentActivityModel = {
  items: AgentActivityItem[];
  activeItem: AgentActivityItem | null;
  summary: string | null;
};
```

Add input type:

```ts
export type BuildAgentActivityModelInput = {
  session: AgentSessionResponseDto;
  messages: AgentMessageResponseDto[];
  toolCalls: AgentToolCallResponseDto[];
  currentPlan: AgentOperationPlanResponseDto | null;
  appliedPlans: AgentOperationPlanResponseDto[];
  streamingText?: string;
  isAssistantActive?: boolean;
};
```

- [ ] **Step 2: Add builder shell**

Export:

```ts
export const buildAgentActivityModel = (input: BuildAgentActivityModelInput): AgentActivityModel => {
  return {
    items: [],
    activeItem: null,
    summary: null,
  };
};
```

- [ ] **Step 3: Run the focused test**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected: fails on behavior assertions rather than missing exports.

---

## Task 3: Implement Tool Call Activity Mapping

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Add known tool metadata**

Create a private map for known tool activity metadata:

```ts
type ToolActivityDefinition = {
  kind: AgentActivityKind;
  title: string;
  completedSummary: string;
  runningSummary?: string;
  coalesceKey: string;
};
```

Map all current `AgentToolName` values. Use the human labels from the spec and this plan.

- [ ] **Step 2: Add status mapping**

Implement:

- `PendingApproval` -> `blocked`
- `Approved` -> `running`
- `Executing` -> `running`
- `Completed` -> `completed`
- `Failed` -> `failed`
- `Denied` -> `skipped`

Use generic fallback for unknown statuses:

- active-looking status -> `running` if known from future enum value is not possible to infer;
- otherwise `pending`.

- [ ] **Step 3: Add permission override**

When a tool call is `PendingApproval`, the row should be a permission row:

- `kind: 'permission'`
- `title: 'Waiting for approval'`
- `summary: 'Needs your approval to continue'`
- `status: 'blocked'`
- `technical.toolName` still contains the raw tool name.

Do not expose the raw tool name in the default row.

- [ ] **Step 4: Add safe technical details**

For each tool row, fill technical details from existing safe fields:

- `toolName`
- `toolCallIds`
- `requestSummary`
- `responseSummary`
- `error`
- `assetCount`
- `albumCount`
- `startedAt`
- `completedAt`

Do not include raw `redactedRequestMetadata` or `redactedResponseMetadata` in the first implementation. Later UI can decide whether to expose specific safe metadata keys.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected: known-label and status tests pass; coalescing/plan/privacy tests may still fail until later tasks.

---

## Task 4: Implement Coalescing, Ordering, And Summary

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Coalesce repeated tool rows**

Coalesce rows that share:

- `kind`
- `title`
- `coalesceKey`

Recommended coalescing behavior:

- collect all ids into `technical.toolCallIds`;
- aggregate `assetCount` and `albumCount`;
- set `count` to aggregated `assetCount` when it is greater than zero, otherwise aggregated `albumCount` when greater than zero;
- use earliest valid `startedAt`;
- use latest valid `completedAt` only when every grouped item is terminal;
- status precedence:
  - `failed`
  - `blocked`
  - `running`
  - `completed`
  - `skipped`
  - `pending`
- summary comes from the highest-priority non-empty safe summary, falling back to the definition's summary.

- [ ] **Step 2: Add deterministic ordering**

Sort by:

1. normalized `startedAt` timestamp, valid timestamps first;
2. type priority:
   - permission
   - search
   - album
   - metadata
   - preview
   - plan
   - apply
   - message
   - error
   - unknown
3. stable id.

Missing or invalid timestamps must not throw. Use an empty or sentinel timestamp plus id tie-breaker.

- [ ] **Step 3: Add compact activity summary**

Build `model.summary` from completed/skipped/failed rows:

- Use at most three row summaries or titles.
- Join with commas.
- Return `null` if there are no rows.

This is for later collapsed UI; no component consumes it yet.

- [ ] **Step 4: Add `activeItem`**

Set `activeItem` to the first item whose status is:

- `blocked`
- `running`
- `pending`

Use the sorted item order. Return `null` if all rows are terminal.

- [ ] **Step 5: Run focused tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected: coalescing and ordering tests pass.

---

## Task 5: Implement Plan, Apply, And Message-Derived Rows

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Derive current-plan activity**

If `currentPlan?.status` is `Proposed`, derive:

- `kind: 'plan'`
- `status: 'completed'`
- `title: 'Preparing a plan'`
- `summary: 'Prepared a plan'`
- `count: currentPlan.operations.length`
- `startedAt: currentPlan.createdAt`
- `completedAt: currentPlan.updatedAt`

If `session.status === WaitingForPlanReview`, derive the same row even if the current plan is null. Use `session.updatedAt` or `session.createdAt` as a fallback timestamp and omit the count when unavailable.

- [ ] **Step 2: Derive apply activity**

If `session.status === Applying`, derive:

- `kind: 'apply'`
- `status: 'running'`
- `title: 'Applying changes'`
- `summary: 'Applying selected changes'`
- `startedAt: session.updatedAt`

For non-empty `appliedPlans`, derive a completed apply row:

- `kind: 'apply'`
- `status: 'completed'`
- `title: 'Applying changes'`
- `summary: 'Applied selected changes'`
- aggregate `count` from applied plan operations;
- use earliest plan `createdAt` and latest plan `updatedAt`.

The running apply row should take precedence over completed applied-plan rows while the session is actively applying.

- [ ] **Step 3: Derive optional assistant message activity**

If `streamingText` is non-empty or `isAssistantActive` is true and there are no blocking permission/plan/apply rows, derive:

- `kind: 'message'`
- `status: 'running'`
- `title: 'Writing response'`
- `summary: 'Writing a response'`
- `startedAt: session.updatedAt`

Do not create a duplicate message row just because persisted assistant messages exist.

- [ ] **Step 4: Run focused tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected: plan/session/apply/message tests pass.

---

## Task 6: Implement Redaction And Defensive Handling

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

- [ ] **Step 1: Add local redaction helper**

Create a small local helper:

```ts
const redactActivityText = (value: string) => string;
```

It should redact obvious secret patterns:

- `Bearer <token>`
- `token=<value>`
- `api_key=<value>`
- `provider key <value>`
- OpenAI-like `sk-...` tokens

Use conservative replacement text like `[redacted]`.

- [ ] **Step 2: Apply redaction only to technical strings**

Apply redaction to:

- `technical.requestSummary`
- `technical.responseSummary`
- `technical.error`

Do not run redaction on titles from static definitions because they should never contain dynamic values.

- [ ] **Step 3: Exclude raw arrays/metadata from default rows**

Do not stringify raw metadata into `title`, `summary`, or `technical` in this slice.

The only count fields should be numeric aggregates:

- `count`
- `technical.assetCount`
- `technical.albumCount`

- [ ] **Step 4: Run focused tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected: privacy and malformed data tests pass.

---

## Task 7: Regression And Final Checks

**Files:**

- Modify as needed only if tests reveal type drift:
  - `web/src/routes/(user)/assistant/agent-tool-approval-ui.ts`
  - `web/src/routes/(user)/assistant/agent-tool-approval-ui.spec.ts`

- [ ] **Step 1: Run focused green tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

- [ ] **Step 2: Run assistant regression tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
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

Expected changed files for implementation:

- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`

The plan file itself may also be present if this planning commit is included.

## Acceptance Criteria

- `buildAgentActivityModel()` exists and returns deterministic activity rows from existing session data.
- Known tool calls use plain-language labels from the spec.
- Pending approvals, prepared plans, applying state, applied plans, and assistant writing state are represented in the view model.
- Repeated read-tool calls coalesce into aggregate activity rows.
- Unknown tools use safe generic copy.
- Default activity titles and summaries never expose raw tool names, raw ids, JSON payloads, or obvious secrets.
- Technical details are structured separately and redacted.
- Missing timestamps, same timestamps, absent response summaries, and large asset-count inputs are tested.
- No backend, runner, OpenAPI, or Svelte component changes are made in this slice.
