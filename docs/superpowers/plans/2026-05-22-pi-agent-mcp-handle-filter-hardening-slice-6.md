# Pi Agent MCP Activity Preview Stability Slice 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep compact activity preview stable and low-noise during tool-heavy Pi runs, while making expanded activity an intentional verbose timeline with plain-language rows, statuses, counts, and hidden technical details.

**Architecture:** Extend the existing frontend activity view model instead of adding a new backend shape. `buildAgentActivityModel` should keep its compact/coalesced `items` for compact mode and add a separate verbose timeline list for expanded mode. `AgentActivityBlock` should render compact rows from coalesced `items` and expanded rows from verbose rows, with a hard render cap so hundreds of tool calls do not create an unbounded DOM. `AgentSessionChatPanel` should continue hiding raw covered tool cards in all activity modes except explicit off mode behavior already covered by prior tests.

**Tech Stack:** Svelte component tests, TypeScript view-model unit tests, existing assistant activity components.

---

## Spec Context

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-mcp-handle-filter-hardening-design.md`

Slice 6 requires:

- Compact/thinking activity renders one stable active-turn block during high-volume tool execution.
- Expanded/verbose activity renders detailed, plain-language tool timeline rows/cards.
- The user's `off | compact | expanded` choice remains preserved while websocket and polling updates arrive.
- Large verbose timelines stay performant through caps, grouping, or virtualization.
- Technical details remain available on demand, redacted, and collapsed by default.

## Files

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Test: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- Test: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify if needed: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Test: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Optional type-only updates: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`
- Optional tests if type shape requires it: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`

## Baseline

- [ ] **Step 1: Confirm current frontend activity tests pass**

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts
```

Expected: existing tests pass before Slice 6 edits.

---

## Task 1: Add Compact Vs Verbose View-Model Coverage

**Files:**

- Modify tests first: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Modify implementation: `web/src/routes/(user)/assistant/agent-activity-ui.ts`

- [ ] **Step 1: Write failing view-model tests**

Add a `makeToolBurst(count = 60)` helper that creates mixed tool calls with stable timestamps:

- repeated `searchAssets` calls with asset counts;
- repeated `readAssetMetadata` calls with asset counts;
- a `listAlbums` call;
- a `readSpace` call;
- one unknown MCP tool name cast through `as AgentToolName`;
- explicit lifecycle activity events including `start-processing/running` and `plan-composing/completed`.

Add tests:

1. `builds a stable compact model from a burst of tool calls and events`
   - input: at least 60 tool calls plus lifecycle events;
   - expect `model.items` to be coalesced, e.g. search/metadata/album/space/unknown/event rows rather than 60 raw rows;
   - expect coalesced IDs like `tool-search-search-assets` to remain the same when more search pages are appended;
   - expect counts to aggregate, statuses to preserve active/running priority, and no raw tool names in visible `title`/`summary`;
   - expect `model.activeItem?.id` to be stable across polling-first and websocket-first input order.

2. `builds an expanded verbose timeline with ordered plain-language rows`
   - expect a new model field, `verboseItems`, to contain individual tool rows in chronological order;
   - expect `verboseItems.length` to include every tool row plus lifecycle rows that are not hidden by primary plan/apply rows;
   - expect each verbose row to have stable keys based on the underlying tool call or event ID;
   - expect labels/status/counts like `Searching photos`, `Done`, `Reading photo details`, `Running`, `Found matching photos`, `12`;
   - expect unknown tools to use `Working with Gallery`, not raw MCP names, while technical details still keep the raw tool name behind disclosure.

3. `returns identical compact and verbose models for polling-first and websocket-first updates`
   - build two inputs with the same messages/tool calls/activity events in different array order;
   - expect `model.items.map(({ id, status, count }) => ...)` to match;
   - expect `model.verboseItems.map(({ id, status, count }) => ...)` to match.

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected red failure: `verboseItems` does not exist and expanded rows are currently derived from the coalesced compact `items`.

- [ ] **Step 2: Implement compact and verbose model fields**

In `agent-activity-ui.ts`:

- Extend `AgentActivityModel`:

```ts
export type AgentActivityModel = {
  items: AgentActivityItem[];
  verboseItems: AgentActivityItem[];
  activeItem: AgentActivityItem | null;
  verboseActiveItem: AgentActivityItem | null;
  summary: string | null;
};
```

- Keep `items` as the compact/coalesced list by continuing to use `coalesceToolActivities(...)`.
- Build `verboseItems` from sorted raw `ToolActivityCandidate` rows plus current plan/apply/event/message rows.
- Set `activeItem` from compact/coalesced `items` and `verboseActiveItem` from `verboseItems`. Do not force the compact coalesced active item into expanded mode, because that would mix compact summary rows with verbose rows.
- Use existing `compareActivityItems`, `buildEventActivityItem`, `buildCurrentPlanItem`, `buildApplyItem`, `buildMessageItem`, and `filterSecondaryEventItems` so compact and verbose derive from the same safe copy and redaction rules.
- Preserve stable IDs:
  - compact coalesced rows keep stable coalesced IDs;
  - verbose tool rows keep `tool-${kind}-${toolCall.id}`;
  - event rows keep `event-${event.id}`.
- Preserve existing `items` semantics so current covered-tool-call behavior remains compatible.
- Update test helpers that construct `AgentActivityModel` directly so they include `verboseItems` and `verboseActiveItem`.

- [ ] **Step 3: Verify view-model tests green**

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-ui.spec.ts
```

Expected green result for compact stability, verbose timeline, order equivalence, and existing tests.

---

## Task 2: Render Expanded Verbose Timeline Without Compact Flicker

**Files:**

- Modify tests first: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify implementation: `web/src/routes/(user)/assistant/agent-activity-block.svelte`

- [ ] **Step 1: Write failing component tests**

Add tests:

1. `uses compact coalesced rows until the user expands activity`
   - model has `items` with 3 coalesced rows and `verboseItems` with 60 rows;
   - render compact mode;
   - expect only compact coalesced labels to render;
   - expect raw repeated verbose row labels/counts beyond the compact selection not to render;
   - expect technical detail buttons to be absent in compact mode.

2. `renders verbose rows only in expanded mode`
   - render with `visibilityMode="expanded"`;
   - expect individual verbose rows to render with safe labels and statuses;
   - expect technical details buttons to exist but technical values remain hidden until clicked;
   - click one technical details button and assert redacted safe rows render for that row only.

3. `caps expanded verbose rows to a bounded DOM count`
   - model has `verboseItems` with 250 rows;
   - render expanded mode;
   - expect no more than the configured cap, default `100`, activity row cards are in the DOM;
   - expect latest running row is included in the capped set so users can see current work.

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

Expected red failure: the component uses `model.items` for expanded mode and has no large-timeline cap.

- [ ] **Step 2: Implement explicit expanded rendering**

In `agent-activity-block.svelte`:

- Add a `verboseLimit` prop defaulting to `100`.
- Add a neutral `data-activity-row` attribute to each rendered activity row so DOM-cap tests can count rows without depending on styling classes.
- Use compact/coalesced `model.items` for compact mode:

```ts
const compactItems = $derived(selectCompactItems(model.items, model.activeItem, compactLimit));
```

- Use `model.verboseItems` for expanded mode:

```ts
const expandedItems = $derived(selectVerboseItems(model.verboseItems, model.verboseActiveItem, verboseLimit));
const visibleItems = $derived(isExpanded ? expandedItems : compactItems);
```

- `selectVerboseItems` should:
  - return all verbose rows if `verboseItems.length <= verboseLimit`;
  - keep the latest `verboseLimit` rows in chronological order when over the cap;
  - force-include the active/running item if present, dropping the oldest non-active row if needed.
- Keep technical details collapsed by default and only visible when the row disclosure is opened.
- Continue deriving `technicalRowsByItemId` from both `model.items` and `model.verboseItems` so expanded rows can reveal their own technical rows.

- [ ] **Step 3: Verify activity block tests green**

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

Expected green result.

---

## Task 3: Preserve Chat Panel Mode Behavior During Updates

**Files:**

- Modify tests first: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify implementation if needed: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Write failing or strengthening chat-panel tests**

Add tests:

1. `compact mode keeps one activity block when polling returns many completed tools`
   - seed one user message;
   - pass 50 completed tool calls that belong to that turn;
   - `activityVisibilityMode="compact"`;
   - expect exactly one `article[aria-label="Pi is working"]` or `Activity summary` block;
   - expect no raw handled tool-call cards such as `Pi checked your albums: Done`;
   - expect repeated raw request/response summaries hidden.

2. `expanded mode renders verbose rows only after user opt-in`
   - same 50 tool calls with `activityVisibilityMode="expanded"`;
   - expect one activity block with many row statuses but no separate raw tool cards;
   - expect more verbose rows than compact mode but not more than the block cap.

3. `off mode hides passive activity while permission and plan surfaces stay visible`
   - keep existing off-mode tests and add a case with a pending approval action dock snippet or pending tool-call card source if not already covered;
   - expect passive activity hidden and action/permission UI still rendered outside the activity block.

4. `activity summarization updates the existing block without a transient raw-card state`
   - render compact with a running tool burst;
   - rerender with completed tool calls plus a summarizing `plan-composing/completed` activity event;
   - expect the same single activity block remains and raw tool cards are still suppressed.

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected red failure if the panel still exposes expanded data through coalesced rows only or leaks raw cards during activity updates.

- [ ] **Step 2: Patch chat panel only if required**

Expected minimal changes:

- Continue passing `visibilityMode={activityVisibilityMode === 'expanded' ? 'expanded' : 'compact'}` to `AgentActivityBlock`.
- Keep `coveredToolCallIds` derived from activity turns, and verify it still uses compact `items` technical tool-call IDs so raw tool cards remain suppressed in compact and expanded modes.
- Do not change the persisted `off | compact | expanded` storage contract.

- [ ] **Step 3: Verify chat panel tests green**

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Expected green result.

---

## Task 4: Broader Verification And Commit

- [ ] **Step 1: Run relevant frontend suites**

Run:

```bash
pnpm --dir web test src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts
pnpm --dir web format
pnpm --dir web lint
pnpm --dir web check:svelte
pnpm --dir web check:typescript
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Manual review before commit**

Review:

- compact mode renders one stable activity block for bursts and does not show raw tool cards;
- expanded mode uses verbose rows with plain-language labels, statuses, counts, and stable keys;
- off mode hides passive activity only;
- technical details stay collapsed and redacted by default;
- 50+ and 250+ tool-call cases do not render unbounded DOM;
- websocket-first and polling-first order produce the same view model.

- [ ] **Step 3: Commit and push**

Commit:

```bash
git add web/src/routes/\(user\)/assistant/agent-activity-ui.ts web/src/routes/\(user\)/assistant/agent-activity-ui.spec.ts web/src/routes/\(user\)/assistant/agent-activity-block.svelte web/src/routes/\(user\)/assistant/agent-activity-block.spec.ts web/src/routes/\(user\)/assistant/agent-session-chat-panel.svelte web/src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts web/src/routes/\(user\)/assistant/agent-session-activity-turns-ui.ts web/src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts docs/superpowers/plans/2026-05-22-pi-agent-mcp-handle-filter-hardening-slice-6.md
git commit -m "fix: stabilize Pi activity preview modes"
git push
```

Expected: branch `explore/pi-agent-brainstorm` is pushed after Slice 6.
