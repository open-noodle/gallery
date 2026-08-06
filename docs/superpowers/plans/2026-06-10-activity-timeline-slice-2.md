# Activity Timeline — Slice 2: Pure timeline builder (`agent-turn-timeline-ui.ts`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure, fully-tested model builder that turns `(session, messages, toolCalls, activityEvents)` into per-turn timeline models (state, one-liner, summary line, rows, router annotation) per the spec `docs/superpowers/specs/2026-06-10-assistant-activity-timeline-design.md` (sections "Per-turn, three states", "Status → row mapping", "Data flow (web)", edge cases E1–E3, E5–E12).

**Architecture:** New module `web/src/routes/(user)/assistant/agent-turn-timeline-ui.ts` with zero component/fetch logic. Turn grouping is NOT reimplemented: the existing anchor/membership helpers in `agent-session-activity-turns-ui.ts` are exported (additive change) and reused. The builder returns i18n KEYS (not translated strings); components translate later (Slice 3).

**Tech Stack:** TypeScript, Vitest (run from `web/`: `export PATH="$HOME/.local/share/mise/shims:$PATH" && pnpm test -- --run "src/routes/(user)/assistant/agent-turn-timeline-ui.spec.ts"`).

**Slice 1 baseline:** server now closes lifecycle events; nothing here depends on it at runtime, but effective-status-per-kind ("latest event of a kind wins") matters for the router annotation only insofar as we take the LATEST `strict_router_decision` in the turn.

---

## Shared contract (used by Tasks 1–2 and by Slice 3)

```ts
// agent-turn-timeline-ui.ts — exported types
import type {
  AgentMessageResponseDto,
  AgentSessionResponseDto,
  AgentToolCallResponseDto,
} from '@immich/sdk';
import { AgentSessionStatus, AgentToolCallStatus } from '@immich/sdk';
import type { AgentActivityEvent } from './agent-session-activity-turns-ui';

export type AgentTurnTimelineRowState = 'completed' | 'failed' | 'denied' | 'in-flight' | 'cancelled';

export type AgentTurnTimelineRow = {
  id: string;
  toolName: string;
  state: AgentTurnTimelineRowState;
  /** responseSummary ?? requestSummary ?? null — full text; one-line clamping is presentation (CSS truncate). */
  summaryText: string | null;
  durationMs: number | null; // completedAt - startedAt; null when completedAt is null (E8)
  detail: {
    requestSummary: string | null;
    responseSummary: string | null;
    assetCount: number | null;
    albumCount: number | null;
    resultSize: AgentToolCallResponseDto['resultSize'] | null;
    error: string | null;
    startedAt: string;
    completedAt: string | null;
  };
};

export type AgentTurnTimeline = {
  anchorMessageId: string;
  state: 'running' | 'settled';
  /** non-null only while state === 'running' */
  oneLiner: { kind: 'key'; key: string } | { kind: 'raw'; toolName: string } | null;
  /** null when rows.length === 0 (E1) */
  summary: { steps: number; durationMs: number | null; failedCount: number; cancelled: boolean } | null;
  /** latest strict_router_decision in the turn, parsed from its key=value summary; null when absent (E11) */
  routerAnnotation: { matched: boolean; workflow: string | null; via: string | null } | null;
  rows: AgentTurnTimelineRow[];
};

export const buildAgentTurnTimelines = (input: {
  session: AgentSessionResponseDto;
  messages: AgentMessageResponseDto[];
  toolCalls: AgentToolCallResponseDto[];
  activityEvents: AgentActivityEvent[];
}): AgentTurnTimeline[] => { ... };
```

**Decision rules (encode exactly):**

- **Turn grouping:** reuse `buildStableTurnAnchors(messages)`, `toolCallBelongsToTurn(toolCall, anchor, anchorCount)`, `activityEventBelongsToTurn(event, anchor)` exported from `agent-session-activity-turns-ui.ts` (Task 1 exports them — match their existing internal signatures EXACTLY; do not change their logic).
- **Active session statuses:** `ACTIVE_SESSION_STATUSES = new Set([AgentSessionStatus.Running, AgentSessionStatus.WaitingForToolApproval, AgentSessionStatus.WaitingForPlanReview, AgentSessionStatus.Applying])` (verify exact enum member names against the SDK before using; if a member doesn't exist, report BLOCKED).
- **Turn state:** `'running'` iff the turn is the LAST anchor AND the session status is in `ACTIVE_SESSION_STATUSES`; every other turn is `'settled'`.
- **Row state:** `completed`→`'completed'`; `failed`→`'failed'`; `denied`→`'denied'`; `pending_approval|approved|executing` → `'in-flight'` if the turn is `'running'`, else `'cancelled'` (E4/E5 — covers cancel AND runner death, both leave the session non-active).
- **Row sort:** `startedAt` ascending, then `id` ascending (E12).
- **Row duration:** `Date.parse(completedAt) - Date.parse(startedAt)`; `null` if `completedAt` null (E8). (`startedAt`/`completedAt` are ISO strings on the web DTO — confirm against the SDK type; if they're `Date`, use `.getTime()` instead and say so in the report.)
- **One-liner (only when turn running):** newest row (by sort) with state `'in-flight'` → `TOOL_VERB_KEYS[toolName]` as `{kind:'key', key}` or `{kind:'raw', toolName}` when unmapped (E3); no in-flight row but rows exist → `{kind:'key', key: 'assistant_timeline_thinking'}`; zero rows → `{kind:'key', key: 'assistant_timeline_understanding'}` (E2).
- **Summary (only when rows.length > 0, else null — E1):** `steps = rows.length`; `failedCount` counts state `'failed'` ONLY (denied excluded — E6); `durationMs` = wall-clock from first row's `startedAt` to the LAST non-null `completedAt` (null when no row has `completedAt` — E8); `cancelled = true` iff the turn contains ≥1 `'cancelled'` row (this is precisely "turn didn't run to completion" — E4/E5).
- **Router annotation:** among the turn's activity events, take the LAST with `kind === 'strict_router_decision'`; parse its `summary` by splitting on whitespace and `=` (mirror: `part.indexOf('=')`); `matched = kv.matched === 'true'`, `workflow = kv.workflow ?? null`, `via = kv.via ?? null`. Null when no such event (E11) or summary null.
- **Verb map (exact initial contents):**

```ts
const TOOL_VERB_KEYS: Record<string, string> = {
  searchAssets: 'assistant_timeline_verb_searching',
  resolveAssetSearchFilters: 'assistant_timeline_verb_filtering',
  readAssetMetadata: 'assistant_timeline_verb_reading_details',
  readAssetPreviews: 'assistant_timeline_verb_looking',
  readAssetOriginals: 'assistant_timeline_verb_looking_closely',
  findTripCandidates: 'assistant_timeline_verb_finding_trips',
  listAlbums: 'assistant_timeline_verb_browsing_albums',
  readAlbum: 'assistant_timeline_verb_reading_album',
  listSpaces: 'assistant_timeline_verb_browsing_spaces',
  readSpace: 'assistant_timeline_verb_reading_space',
  searchPeople: 'assistant_timeline_verb_finding_people',
  searchUsers: 'assistant_timeline_verb_finding_people',
  listDuplicateGroups: 'assistant_timeline_verb_finding_duplicates',
  curateSelection: 'assistant_timeline_verb_curating',
  resolveLocation: 'assistant_timeline_verb_locating',
  proposeAlbumFromSelection: 'assistant_timeline_verb_proposing',
  proposeAlbumOperations: 'assistant_timeline_verb_proposing',
  proposeAssetBatchFromSelection: 'assistant_timeline_verb_proposing',
  proposeSpaceFromSearch: 'assistant_timeline_verb_proposing',
  proposeAddAssetsToSpaceFromSearch: 'assistant_timeline_verb_proposing',
};
```

(i18n VALUES are added in Slice 3 — the builder only deals in keys.)

---

### Task 1: Export the grouping helpers from `agent-session-activity-turns-ui.ts`

**Files:** Modify `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`; Test: its existing spec keeps passing.

- [ ] **Step 1:** Read the file; add `export` to `buildStableTurnAnchors`, `toolCallBelongsToTurn`, `activityEventBelongsToTurn` and the anchor type they use (export it as `UserTurnAnchor` if unnamed/internal). NO logic changes.
- [ ] **Step 2:** Run its spec + the panel spec to prove no behavior change:
      `pnpm test -- --run "src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts"` → PASS.
- [ ] **Step 3:** Commit: `git add <file> && git commit -m "refactor(assistant): export turn-anchor helpers for the timeline builder"`.

### Task 2: The builder, TDD

**Files:** Create `web/src/routes/(user)/assistant/agent-turn-timeline-ui.ts` and `web/src/routes/(user)/assistant/agent-turn-timeline-ui.spec.ts`.

- [ ] **Step 1: Write the failing spec.** Local factories (`makeSession(status)`, `makeUserMessage(id, createdAt)`, `makeAssistantMessage`, `makeToolCall({...})`, `makeActivityEvent({...})`) modeled on the shapes used in `agent-session-activity-turns-ui.spec.ts` (read it; reuse its fixture idioms so anchors behave). Then table-driven tests — every named case below is REQUIRED:

| Test                                | Arrange                                                                                                      | Assert                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| E1 zero tool calls                  | 1 user msg, session Completed, no tool calls                                                                 | one timeline, `summary === null`, `rows: []`, `oneLiner === null`                                      |
| E2 running, no tool call yet        | 1 user msg, session Running                                                                                  | `state:'running'`, `oneLiner = {kind:'key', key:'assistant_timeline_understanding'}`                   |
| E3 running, in-flight known tool    | + toolCall executing `searchAssets`                                                                          | `oneLiner = {kind:'key', key:'assistant_timeline_verb_searching'}`                                     |
| E3b running, in-flight unknown tool | toolCall executing `someNewTool`                                                                             | `oneLiner = {kind:'raw', toolName:'someNewTool'}`                                                      |
| E3c running, between calls          | one completed call only                                                                                      | `oneLiner = {kind:'key', key:'assistant_timeline_thinking'}`                                           |
| mapping: completed                  | completed call w/ completedAt                                                                                | row `state:'completed'`, durationMs computed                                                           |
| mapping: failed + E7                | failed call w/ error 'boom'                                                                                  | row `'failed'`, `detail.error:'boom'`, `summary.failedCount:1`                                         |
| mapping: denied + E6                | denied call                                                                                                  | row `'denied'`, `summary.failedCount:0`                                                                |
| mapping: in-flight                  | executing call, session Running, last turn                                                                   | row `'in-flight'`                                                                                      |
| E4/E5 cancelled                     | executing call, session Cancelled                                                                            | row `'cancelled'`, `summary.cancelled:true`, `state:'settled'`                                         |
| E5b interrupted                     | same but session Interrupted (skip with note if enum lacks it)                                               | same as E4                                                                                             |
| E8 null completedAt anomaly         | 2 completed calls, second completedAt null                                                                   | second row `durationMs:null`; `summary.durationMs` = first call's span                                 |
| E9-adjacent: multi-turn split       | 2 user msgs, calls timestamped in each window                                                                | two timelines, rows grouped correctly; earlier turn `'settled'` even while session Running             |
| E10 long summaries pass through     | 600-char responseSummary                                                                                     | `summaryText` full string; `detail.responseSummary` identical                                          |
| E11 no router event                 | no activity events                                                                                           | `routerAnnotation === null`                                                                            |
| router annotation parse             | strict_router_decision event in window, summary `'matched=true workflow=create_recent_trip_album via=regex'` | `{matched:true, workflow:'create_recent_trip_album', via:'regex'}`; with two such events the LAST wins |
| E12 sort                            | two calls, second has earlier startedAt                                                                      | rows sorted by startedAt then id                                                                       |
| summary line numbers                | 3 calls (2 completed 1 failed), known timestamps                                                             | `steps:3`, `durationMs` = last completedAt − first startedAt, `failedCount:1`, `cancelled:false`       |

- [ ] **Step 2: Red** — `pnpm test -- --run "src/routes/(user)/assistant/agent-turn-timeline-ui.spec.ts"` → FAIL (module not found).
- [ ] **Step 3: Implement** the contract + decision rules above, importing the Task-1 exports. Pure functions only — no svelte, no fetch, no Date.now().
- [ ] **Step 4: Green** — same command, all cases pass. Also re-run the turns-ui spec (no regressions).
- [ ] **Step 5: Gates + commit** — `pnpm exec eslint --max-warnings 0` on both new files + the modified turns-ui; `pnpm exec tsc -p . --noEmit` is covered by `make check-web` later, but run `pnpm check:typescript` if quick. Commit: `feat(assistant): pure per-turn activity timeline builder`.

---

## Self-Review

**Spec coverage:** E1–E3, E5–E12 + full status table + summary variants + router annotation + grouping reuse — all present as named tests (E4 and E5 share the cancelled-derivation test; both arranged). E13/E14 are out of slice (existing merge tests). One-liner "thinking" fallback is an interpretation the spec's three-state model implies (documented in rules).
**Placeholders:** none — every rule and the verb map are spelled out; fixtures explicitly modeled on the existing turns-ui spec.
**Type consistency:** the exported contract is what Slice 3 components will consume; row/turn type names match the spec's "Data flow (web)" section (`buildAgentTurnTimelines` plural — components map over turns).
