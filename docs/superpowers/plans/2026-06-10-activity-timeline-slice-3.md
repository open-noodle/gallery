# Activity Timeline — Slice 3: Components, wired into the chat panel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the per-turn timeline (one-liner while running → collapsed summary line → expandable tool-call rows) inline in the chat, replacing the old "Activity summary" block rendering and the ascii busy indicator. Spec: `docs/superpowers/specs/2026-06-10-assistant-activity-timeline-design.md` ("Per-turn, three states", status table, E4, Slice 3).

**Architecture:** Two presentational components consume the Slice-2 models verbatim: `agent-turn-timeline.svelte` (one-liner / summary / expansion shell, per-turn `$state` expansion) and `agent-turn-timeline-row.svelte` (row + detail toggle). The chat panel builds `AgentTurnTimeline[]` with `buildAgentTurnTimelines` and emits one `turn-timeline` chat item per turn. The old `AgentActivityBlock` item type and the ascii busy indicator are no longer rendered (files deleted in Slice 4). The one-liner subsumes the busy indicator: a running turn ALWAYS shows a one-liner (E2 guarantees pre-tool-call coverage), so the separate "pi is working..." article is removed (conscious spec-implied extension — note it in commits).

**Design language:** match the recent onboarding/chat components — quiet one-liner `text-sm italic text-gray-500 dark:text-neutral-400`; summary line same muted style non-italic, `· N failed` in `text-red-600 dark:text-red-400`, `· cancelled` muted; rows `rounded-xl border border-gray-200 dark:border-gray-800` with status dot `h-1.5 w-1.5 rounded-full` (green `bg-green-500`, red `bg-red-500`, amber `bg-amber-500` denied, blue `bg-blue-500 animate-pulse` in-flight, grey `bg-gray-400` cancelled); raw tool name `font-mono text-xs`; summary truncate via `truncate`; detail block `rounded-lg bg-gray-50 dark:bg-neutral-900 px-3 py-2 text-xs` with full (non-truncated) text. All interactive elements are `<button type="button">` with `aria-expanded`.

**Verified wiring facts (do not re-derive):**

- Old block renders in `agent-session-chat-panel.svelte` at lines ~1053-1058 inside the `chatTimelineItems` loop (`{:else if item.type === 'activity'}`); import at line 49.
- `activityTurns` derived at ~202 (`buildAgentSessionActivityTurns`); `chatTimelineItems` derived at ~229 calls `buildChatTimelineItems(messages, timelineToolCalls, appliedPlans, activityTurns, coveredToolCallIds, activityVisibilityMode, …)`; inside it, activity items are produced at ~284-293 gated on visibility mode.
- Busy indicator: `showAssistantBusyIndicator` derived ~220-225; rendered ~1147-1156 (`assistant_busy_ascii`).
- Panel props incl. `activityVisibilityMode` / `onActivityVisibilityModeChange` (~68-69) — KEEP the props this slice (pane/header still pass them; removal is Slice 4) but they stop influencing rendering.
- Panel spec: renders with `{ props: { session } }`; i18n mock = `readable((key, options?) => …interpolation…)`; tests to update: `'renders current-turn tool calls in the activity block without technical details'` (~491) and `'renders one activity block after the triggering user message before the assistant response'` (~552), plus busy-indicator assertions on `assistant_busy_ascii`.

---

### Task 1: Duration formatter (TDD, tiny)

**Files:** Modify `web/src/routes/(user)/assistant/agent-turn-timeline-ui.ts`; extend `agent-turn-timeline-ui.spec.ts`.

- [ ] **Step 1 — failing tests:**

```ts
describe('formatAgentTimelineDuration', () => {
  it('formats sub-minute durations with one decimal', () => {
    expect(formatAgentTimelineDuration(2300)).toBe('2.3s');
    expect(formatAgentTimelineDuration(400)).toBe('0.4s');
  });
  it('formats minute durations', () => {
    expect(formatAgentTimelineDuration(65_000)).toBe('1m 5s');
  });
  it('clamps negatives to zero', () => {
    expect(formatAgentTimelineDuration(-50)).toBe('0.0s');
  });
});
```

- [ ] **Step 2 — red** (function missing). **Step 3 — implement:**

```ts
export const formatAgentTimelineDuration = (durationMs: number): string => {
  const clamped = Math.max(0, durationMs);
  if (clamped < 60_000) {
    return `${(clamped / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(clamped / 60_000)}m ${Math.round((clamped % 60_000) / 1000)}s`;
};
```

- [ ] **Step 4 — green**, then commit: `feat(assistant): timeline duration formatter`.

### Task 2: Row component (TDD)

**Files:** Create `web/src/routes/(user)/assistant/agent-turn-timeline-row.svelte` + `agent-turn-timeline-row.spec.ts`.

Props: `{ row: AgentTurnTimelineRow }`. Renders: status dot (class per state, exact colors above) + `toolName` (mono) + `summaryText` (truncated span, `title={row.summaryText}`) + duration (`formatAgentTimelineDuration(row.durationMs)` when non-null) + state word for `denied`/`cancelled` (i18n `assistant_timeline_denied` / `assistant_timeline_cancelled`). The whole row is a `<button type="button" aria-expanded={detailOpen} aria-label={row.toolName}>`; clicking toggles a detail block listing: request summary (label `assistant_timeline_request`), response summary (`assistant_timeline_response`), error in red when present (`assistant_timeline_error`), counts line when present (`{assetCount} assets · {albumCount} albums` raw numbers), result size when present (`{returnedItems} items` + `truncated` badge when `resultSize.truncated`), and `startedAt` → `completedAt` timestamps (`toLocaleTimeString()`).

- [ ] **Step 1 — failing tests** (i18n mocked as `t = readable((key) => key)`):
  1. completed row: green dot class present, toolName + summaryText + `2.3s` rendered, `aria-expanded="false"`.
  2. failed row: red dot; expanding (`await user.click(getByRole('button', {name: toolName}))`) shows `detail.error` text and `aria-expanded="true"`.
  3. denied row: amber dot + text `assistant_timeline_denied`; `durationMs: null` → no duration text.
  4. in-flight row: `animate-pulse` class present.
  5. cancelled row: grey dot + `assistant_timeline_cancelled`.
  6. detail fields: expanded row shows request + response summaries in full (assert the full 300-char string present).
- [ ] **Step 2 red** (component missing) → **Step 3 implement** → **Step 4 green** → commit: `feat(assistant): turn-timeline row component`.

### Task 3: Timeline component (TDD)

**Files:** Create `web/src/routes/(user)/assistant/agent-turn-timeline.svelte` + `agent-turn-timeline.spec.ts`.

Props: `{ timeline: AgentTurnTimeline }`. Behavior:

- `state==='running'`: render the one-liner button — text `$t(oneLiner.key)` for `kind:'key'` or raw `toolName` — italic muted, with a small pulsing dot; `aria-expanded` reflects expansion; clicking toggles the expanded list (live timeline).
- `state==='settled'` and `summary !== null`: render the summary-line button: `[N steps] · [duration]` built from `assistant_timeline_steps_one`/`assistant_timeline_steps` (`{steps}` interpolation) + `formatAgentTimelineDuration(summary.durationMs)` when non-null; append `assistant_timeline_failed_count` (`{count}` interpolation) in red when `failedCount > 0`; append `assistant_timeline_cancelled` when `summary.cancelled`. Clicking toggles expansion.
- `state==='settled'` and `summary === null`: render NOTHING (E1) — `{#if}` around the whole component content.
- Expanded: optional router annotation line (`assistant_timeline_router_matched` with `{workflow}`/`{via}` values when `matched`, else `assistant_timeline_router_none` with `{via}`) then `{#each timeline.rows as row (row.id)}<AgentTurnTimelineRow {row} />{/each}`.
- Expansion is local `$state(false)` — collapsed by default (off-by-default requirement).

- [ ] **Step 1 — failing tests:**
  1. running + key one-liner: shows `assistant_timeline_verb_searching`, collapsed (no rows rendered).
  2. running + raw one-liner: shows raw `someNewTool`.
  3. click one-liner → rows render (use 2-row fixture), `aria-expanded="true"`.
  4. settled summary: `'3'` + steps key rendered, duration `2.3s`, failed count element has red class when failedCount=1, absent when 0.
  5. cancelled summary shows `assistant_timeline_cancelled`.
  6. zero-row settled timeline renders nothing (container queried by `data-testid="agent-turn-timeline"` absent) (E1).
  7. router annotation: expanded shows `assistant_timeline_router_matched` when matched; absent when `routerAnnotation === null` (E11).
- [ ] **Step 2 red → Step 3 implement → Step 4 green** → commit: `feat(assistant): per-turn activity timeline component`.

### Task 4: Panel wiring + i18n + spec updates

**Files:** Modify `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`, its spec, and `i18n/en.json`.

- [ ] **Step 1 — failing/updated panel tests FIRST:**
  - Replace the two old activity-block tests with: `'renders the turn timeline summary after a settled turn'` (settled session + completed tool calls → summary-line button present; old `'Activity summary'` article absent) and `'renders the running one-liner for the active turn'` (Running session, executing searchAssets tool call → `assistant_timeline_verb_searching` text present; `assistant_busy_ascii` ABSENT).
  - Add `'expands the timeline to tool-call rows on click'` — click summary → row with toolName visible (E4-style fixture fine).
  - Update any other test asserting `assistant_busy_ascii` (it should now only appear in… nowhere — remove those assertions; the one-liner covers the pending state; keep/adjust the reduced-motion busy-frame tests by deleting them if they only exercised the removed indicator).
  - Add the i18n keys used by all three components to the spec's i18n mock map (values like the real ones below so interpolation tests are meaningful).
- [ ] **Step 2 — red** on the new/updated tests.
- [ ] **Step 3 — implement panel changes:**
  1. Import `AgentTurnTimeline` component + `buildAgentTurnTimelines`.
  2. New derived: `const turnTimelines = $derived(buildAgentTurnTimelines({ session: activitySession, messages, toolCalls: activityToolCalls, activityEvents }));` (same inputs the old activityTurns derived uses — reuse `activitySession`/`activityToolCalls` exactly).
  3. In `buildChatTimelineItems` (same file): replace the activity-item production (the `timelineActivityVisibilityMode === 'off' ? [] : …` block) with one item per timeline whose `summary !== null || state === 'running'`: `{ type: 'turn-timeline' as const, id: \`turn-timeline-${timeline.anchorMessageId}\`, occurredAt: <the anchor user message's createdAt: look it up in the `messages` argument by `timeline.anchorMessageId`; if the old activity branch used a different occurredAt convention (e.g. a Date vs string), mirror THAT convention so timeline ordering semantics are unchanged>, timeline }`. Drop the `activityVisibilityMode`parameter from the function and its call site; remove now-unused imports/args. KEEP the`activityVisibilityMode`/`onActivityVisibilityModeChange`props on the panel (unused; Slice 4 removes them) — add`// removed in slice 4` is NOT needed; just leave them accepted.
  4. Replace the `{:else if item.type === 'activity'}` template branch with `{:else if item.type === 'turn-timeline'}<AgentTurnTimeline timeline={item.timeline} />`.
  5. Delete the `showAssistantBusyIndicator` derived, the busy-frame animation state tied to it, and the ascii-article template block (the one-liner replaces it). Remove the old `AgentActivityBlock` import + the old activity item type from the items union. Do NOT delete `agent-activity-block.svelte` itself (Slice 4).
  6. `buildAgentSessionActivityTurns`/`activityTurns`: if now unused by the panel, remove the derived + import here (the module itself stays for Slice 2 reuse of its helpers).
- [ ] **Step 4 — i18n:** add to `i18n/en.json` (then `pnpm --filter immich-i18n format:fix`; only en.json may change):

```
assistant_timeline_understanding: "Understanding request…"
assistant_timeline_thinking: "Thinking…"
assistant_timeline_verb_searching: "Searching photos…"
assistant_timeline_verb_filtering: "Interpreting filters…"
assistant_timeline_verb_reading_details: "Reading photo details…"
assistant_timeline_verb_looking: "Looking at thumbnails…"
assistant_timeline_verb_looking_closely: "Inspecting originals…"
assistant_timeline_verb_finding_trips: "Finding trips…"
assistant_timeline_verb_browsing_albums: "Browsing albums…"
assistant_timeline_verb_reading_album: "Reading an album…"
assistant_timeline_verb_browsing_spaces: "Browsing spaces…"
assistant_timeline_verb_reading_space: "Reading a space…"
assistant_timeline_verb_finding_people: "Finding people…"
assistant_timeline_verb_finding_duplicates: "Finding duplicates…"
assistant_timeline_verb_curating: "Curating a selection…"
assistant_timeline_verb_locating: "Looking up a location…"
assistant_timeline_verb_proposing: "Proposing changes…"
assistant_timeline_steps_one: "1 step"
assistant_timeline_steps: "{steps} steps"
assistant_timeline_failed_count: "{count} failed"
assistant_timeline_cancelled: "cancelled"
assistant_timeline_denied: "denied"
assistant_timeline_request: "Request"
assistant_timeline_response: "Response"
assistant_timeline_error: "Error"
assistant_timeline_router_matched: "Matched workflow {workflow} via {via}"
assistant_timeline_router_none: "No workflow matched (via {via})"
```

- [ ] **Step 5 — green + gates:** full assistant suite `pnpm test -- --run "src/routes/(user)/assistant"`; `pnpm exec prettier --write` then `--check` on every touched file (svelte+ts+spec); `pnpm exec eslint --max-warnings 0` on touched files; from repo root `make check-web`.
- [ ] **Step 6 — commit:** `feat(assistant): render per-turn activity timelines in the chat (replaces activity block + busy indicator)`.

---

## Self-Review

**Spec coverage:** three states rendered (Tasks 2-3), off-by-default = collapsed + E1 nothing-rendered, E4 cancelled rendering via row/summary tests, live-update path untouched (panel keeps merging toolCalls; timeline re-derives), router annotation incl. E11, status table colors all five rows, one-liner verbs + raw fallback + understanding/thinking. Old block stops rendering (deletion is Slice 4). Busy-indicator removal documented as the one-liner subsuming it.
**Placeholders:** the one deliberate pass-through is `occurredAt` ("pass it through from the turn anchors the same way the old code did") — the implementer reads the existing `buildChatTimelineItems` activity branch and mirrors its `occurredAt` source; everything else is exact.
**Type consistency:** consumes Slice-2 exports (`AgentTurnTimeline`, `AgentTurnTimelineRow`, `buildAgentTurnTimelines`, `formatAgentTimelineDuration`) with matching names/shapes; new chat item type `turn-timeline` carries `timeline: AgentTurnTimeline`.
