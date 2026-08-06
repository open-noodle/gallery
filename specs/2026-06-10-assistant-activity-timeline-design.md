# Assistant Activity Timeline — Design

**Date:** 2026-06-10 (revised same day after code-grounded review)
**Status:** Approved UX (brainstormed with Pierre; layout chosen visually); revised for implementability — pending re-review
**Scope:** Web (`web/src/routes/(user)/assistant/`) + server (`server/src/services/agent-*`). Agent-runner untouched. No DB schema changes, no new REST endpoints, no new websocket events.

## Problem

The current "Activity summary" block renders coarse lifecycle phases ("Understanding request", "Working with Gallery") that are too high-level to explain what the agent actually did, while the genuinely useful per-tool-call data (tool name, request/response summaries, counts, durations, errors — all already persisted in `agent_tool_call` and fetched by the web) is buried in a hidden "technical rows" layer.

Known bug: the `start-processing` activity event is created with status `running` and no terminal event is ever written on a successful turn (`agent-runner.service.ts` writes one only on failure), so the first card shows "Running" forever — even after the turn finishes or the session is cancelled.

Primary audience (per brainstorm): **debugging / power-user**. The view should be off by default and deep when opened.

## Verified codebase facts (the design is built on these)

- `agent_tool_call` has **no message/turn linkage**; turns are derived by timestamp windows anchored on user messages — `buildAgentSessionActivityTurns()` (`agent-session-activity-turns-ui.ts:167`) already does exactly this for tool calls via `toolCallBelongsToTurn` using `startedAt` (non-nullable) / `completedAt` (nullable).
- `AgentToolCallStatus` = `pending_approval | approved | executing | denied | completed | failed`. There is **no cancelled status**; cancelled is a UI derivation.
- Activity events are **append-only** (`agent-session-activity-event.repository.ts` has `create` + `getBySessionId` only). "Closing" an event means **inserting a terminal sibling** of the same kind, never updating a row.
- The websocket `AgentSessionClientEvent` union (`websocket.repository.ts:25`) has **no tool-call event**; the chat panel (`agent-session-chat-panel.svelte:591`) learns about tool calls only from initial load — there is no dedicated tool-call push today; liveness comes from the dock's refetch-on-any-event + 3s polling pipeline (see Server changes B).
- Tool calls are persisted at three service sites: `agent-tool.service.ts`, `agent-operation-plan.service.ts`, `agent-runner.service.ts` (all via `toolCallRepository.create`/`update`).
- `strict_router_decision` events carry `kind/status/source/summary` with `key=value` summaries (e.g. `matched=true via=regex`) — enough for a timeline annotation row.
- Session cancel is `AgentSessionService.cancel()` (controller `POST /agent/sessions/:id/cancel`); it currently has no activity-event involvement.

## Design

### Per-turn, three states (Layout A — inline)

Each assistant turn owns its own activity affordance, rendered inline in the conversation under the triggering user message:

1. **Running:** a single quiet italic one-liner showing the current step as a friendly verb ("Searching photos…", "Proposing album…"), derived from the most recent non-terminal tool call (tool-name→verb map, raw tool name as fallback); before the first tool call it reads "Understanding request…". Clicking it expands the live timeline.
2. **Settled, collapsed (default):** the one-liner is replaced by a subtle summary line: `4 steps · 2.3s` (wall-clock from the first tool call's `startedAt` to the last `completedAt`), with `· 1 failed` appended in red when any step failed, or `· cancelled` when the turn was cancelled. Turns with zero tool calls render no line at all.
3. **Expanded:** a chronological list (sorted by `startedAt`, id as stable tiebreak) of the turn's tool calls. Each row: status dot · raw tool name (`searchAssets`) · human summary (from `requestSummary`/`responseSummary`, clamped to one line; full text in the detail block) · duration. Clicking a row toggles a detail block: request summary, response summary, asset/album counts, result size (`estimatedBytes`, `returnedItems`, `truncated`, `omittedFields`), error text, timestamps. A small annotation row at the top shows the strict router decision (parsed from its `key=value` summary) when present.

**Status → row mapping** (covers every `AgentToolCallStatus` value):

| Tool-call state                                                   | Row rendering            |
| ----------------------------------------------------------------- | ------------------------ |
| `completed`                                                       | green ✓                  |
| `failed`                                                          | red ✗ + error in detail  |
| `denied`                                                          | amber ⊘ "denied"         |
| `pending_approval` / `approved` / `executing`, turn still running | blue pulsing (in-flight) |
| `pending_approval` / `approved` / `executing`, turn settled       | grey ○ "cancelled"       |

Expansion state is per-turn, in-memory only (no persistence). Everything is collapsed by default — this is the "off by default" requirement.

### Removed

- The "Activity summary" block and its phase cards (`agent-activity-block.svelte`, the bulk of `agent-activity-ui.ts`). Replaced by a much smaller `agent-turn-timeline` component pair plus a pure model-builder module.
- The Compact/Expanded/Off visibility modes, their ⋯ menu radio group, and the per-session localStorage persistence (`agent-activity-visibility-ui.ts`).
- The ⋯ "Chat options" menu itself: with the modes gone it would hold only "Details", so the header reverts to a plain Details icon-pill button (info icon, `rounded-full`, aria-label `assistant_details`). This deliberately revisits the 2026-06-09 header rework; Cancel ("Close session") stays as-is.

### Server changes

**A. Close lifecycle events on settle (the bug fix).** New method on the activity-event service, e.g. `closeOpenLifecycleEvents(userId, sessionId, terminalStatus)`: reads the session's events, finds lifecycle kinds (`start-processing`, `plan-composing`, `apply-progress`, `runner-recovery`) whose **latest** event has status `running`, and **inserts** a terminal sibling (same kind; status `completed` on success, `failed` on error, `skipped` on cancel). Idempotent: nothing inserted when nothing is open. Call sites: `agent-runner.service.ts` when the runner stream settles (success — failure already writes a failed event; the helper also covers any other open kinds), and `AgentSessionService.cancel()` with `skipped`. `strict_*` events are never touched (the L3 eval consumes them; they already carry terminal statuses). The web derives a kind's effective status as "latest event of that kind within the turn".

**B. Live data path — no new websocket event (revised during implementation).** Deeper exploration found the live-update problem already solved: `agent-session-action-dock.svelte` refetches the session's tool calls on **every** incoming session websocket event and **polls every 3s** while the session is Running/WaitingForToolApproval; results flow dock → pane (`recentToolCalls`) → chat panel, which merges via `mergeAgentTimelineToolCalls` (`agent-session-tool-call-state-ui.ts` — id-based upsert, status-rank aware, session-guarded, already covered by 7 tests including the spec's E13/E14 cases). Slice 1's closers additionally emit `activity` events at settle, triggering an immediate final refetch. Worst-case timeline staleness is ~3s during a turn — acceptable for a debug view. The originally planned `tool-call` client event (15+ scattered emit sites, some inside repository transactions, in a service without `WebsocketRepository`) is dropped as unjustified complexity; it can be layered on later if 3s lag proves annoying.

### Data flow (web)

A pure builder module, `agent-turn-timeline-ui.ts`: `buildAgentTurnTimeline({ messages, toolCalls, activityEvents, sessionStatus })` reuses the existing turn-anchor logic (`buildStableTurnAnchors` / timestamp-window membership from `agent-session-activity-turns-ui.ts`) and returns per-turn models: `{ state: 'running' | 'settled', oneLiner, summaryLine: { steps, durationMs, failedCount, cancelled }, rows: ToolCallRow[], routerAnnotation? }`. Components render that model; no fetching logic in components.

## Edge cases (each is a named test in its slice)

| #   | Edge case                                                     | Expected behavior                                                                                                       |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| E1  | Turn with zero tool calls (pure chat)                         | No summary line, no timeline, no one-liner artifacts after settle                                                       |
| E2  | Turn running, no tool call yet                                | One-liner "Understanding request…"                                                                                      |
| E3  | Turn running, tool call in flight                             | One-liner = friendly verb for that tool; unknown tool → raw name                                                        |
| E4  | Cancel mid-turn                                               | In-flight rows grey "cancelled"; summary `N steps · cancelled`; server inserts `skipped` closers                        |
| E5  | Runner death (session terminal, tool call stuck non-terminal) | Same rendering as E4 (derived from session terminal state)                                                              |
| E6  | Denied tool call                                              | Amber "denied" row; not counted as failed in summary line                                                               |
| E7  | Failed tool call                                              | `· 1 failed` in summary; error text in row detail                                                                       |
| E8  | `completedAt` null on a completed-state anomaly               | Duration omitted for that row; turn duration uses last available `completedAt`                                          |
| E9  | Multiple lifecycle events of the same kind in one turn        | Effective status = latest by `createdAt`; no duplicate closers inserted (idempotency)                                   |
| E10 | Long `requestSummary`/`responseSummary` (≤1000 chars)         | Row summary clamped to one line (CSS); detail text redacted + safety-capped at 500 chars (parity with the old redactor) |
| E11 | Router decision absent (open orchestration)                   | No annotation row                                                                                                       |
| E12 | Out-of-order timestamps                                       | Rows sorted `startedAt` then id; grouping unchanged (existing window logic)                                             |
| E13 | Tool-call refresh for an unknown/other session                | Ignored — covered by the existing `mergeAgentTimelineToolCalls` session guard + its tests                               |
| E14 | Refresh arrives for an already-known tool call                | Upsert by id, stale states never regress — covered by the existing merge tests                                          |

## Implementation slices (impl-loop format — each slice is independently shippable, strict TDD)

Every slice follows red → green → refactor: write the named failing tests first, run them to capture the expected failure, implement minimally, re-run green, then commit. Gates per slice: relevant vitest suite green, `eslint --max-warnings 0` on touched files, `make check-server`/`check-web` as applicable.

### Slice 1 — Server: close lifecycle events on settle and cancel

- `closeOpenLifecycleEvents` on the activity-event service + call sites (runner stream success path; `AgentSessionService.cancel` with `skipped`).
- Tests (`agent-session-activity-event.service.spec.ts`, `agent-runner.service.spec.ts`, `agent-session.service.spec.ts`): success inserts `completed` closer for open `start-processing`; failure path unchanged (still exactly one `failed` event); cancel inserts `skipped` closers; idempotent when nothing open (E9); `strict_*` kinds never closed; closers are inserts, never updates.
- Red expectation: new specs fail with "closeOpenLifecycleEvents is not a function" / missing emit assertions.

### ~~Slice 2 — live `tool-call` websocket event~~ (dropped)

Dropped during implementation: the existing dock-driven refetch/poll pipeline plus `mergeAgentTimelineToolCalls` already provides live tool-call data with ≤3s staleness and existing tests cover E13/E14 (see Server changes B). The remaining slices are renumbered.

### Slice 2 — Web: pure timeline builder (`agent-turn-timeline-ui.ts`)

- `buildAgentTurnTimeline` + tool-verb map + router-summary parser. Table-driven tests covering E1–E3, E5–E12 and the status→row mapping table above (one test per mapping row), summary-line text variants (steps/duration/failed/cancelled), turn grouping reuse.
- Red expectation: module not found.

### Slice 3 — Web: timeline components, wired in

- `agent-turn-timeline.svelte` (one-liner / summary line / expanded list) + `agent-turn-timeline-row.svelte` (row + detail toggle), replacing the activity-block rendering in the chat panel. New i18n keys (`assistant_timeline_*`) for one-liner verbs and labels, added + `format:fix`.
- Component tests: expand/collapse per turn, row detail toggle, failed badge, live update when a `tool-call` event lands mid-turn (drives state 1→3), cancelled rendering (E4).
- The panel renders the new timeline **instead of** the old activity block in this slice; panel/old-block spec assertions are updated here. Deleting the now-dead files is Slice 4.
- Red expectation: components not found.

### Slice 4 — Web: remove the old surface + header revert

- Delete `agent-activity-block.svelte`, `agent-activity-visibility-ui.ts`, the visibility-mode portions of `agent-activity-ui.ts` (fold any still-needed helpers into the new builder), the ⋯ menu modes; revert header to a Details icon-pill (update `agent-session-header.spec.ts`, `agent-activity-visibility-menu` removed). Remove dead i18n keys (`assistant_activity_visibility*`, `assistant_session_menu` if unused).
- Tests: header spec asserts Details pill + Close session only; workspace/pane suites green; full assistant suite + `make check-web` + lint as the slice gate.

## Out of scope

- New REST endpoints or DB schema changes.
- Exposing `redactedRequestMetadata`/`redactedResponseMetadata` raw JSON in the UI.
- Session-wide debug drawer (Layout B) — can layer on later if inline proves insufficient.
- Persisting expansion preferences.
