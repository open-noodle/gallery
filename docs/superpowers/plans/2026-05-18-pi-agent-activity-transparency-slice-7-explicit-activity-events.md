# Pi Agent Activity Transparency Slice 7 Explicit Activity Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Add persisted and live explicit activity events for the non-tool gaps that still make Pi look stuck: turn start, plan composing, apply progress, and runner recovery. These events must be compact, safe, reloadable, and merged into the existing per-turn activity block without replacing tool-call, approval, plan-review, or applied-plan surfaces.

**Architecture:** Add a server-owned `agent_session_activity_event` persistence model and an `activity` websocket/SSE event contract. Gallery emits first-party activity events for server-known lifecycle points and accepts validated runner activity events from the first-party runner. The frontend fetches activity-event history and merges live activity events into the existing Slice 6 turn reconstruction helper. Activity events are immutable audit hints, not raw logs, not model reasoning, and not a replacement for persisted messages/tool calls/plans.

**Tech Stack:** NestJS, Kysely, Zod DTOs, Socket.IO websocket repository, runner SSE protocol, Node.js agent runner, generated `@immich/sdk`, Svelte 5, Vitest, Testing Library, existing Slice 1-6 activity UI helpers.

---

## Source Spec

Implements `Slice 7: Optional Explicit Activity Events` from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-2-chat-activity-block.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-3-session-activity-visibility-controls.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-4-live-updates-and-coalescing.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-5-technical-details-and-redaction.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-6-reload-and-turn-anchoring-hardening.md`

Spec anchors:

- Persist/server-send activity events only for non-tool gaps:
  - `start-processing`;
  - `plan-composing`;
  - `apply-progress`;
  - `runner-recovery`.
- Keep event payloads compact and safe.
- Test server turn-begin events, runner validation/redaction, aggregate apply counts, user-scoped history, unknown kinds, terminal-session events, and races with messages/tool calls.

## Product Decisions For This Slice

- Implement Slice 7 now as real persistence, not just transient websocket events, because reload safety is a core requirement of the activity transparency design.
- Store activity events in a new `agent_session_activity_event` table keyed by `sessionId`.
- Keep activity events immutable. If work progresses, append a newer event rather than updating old rows.
- Keep event payloads allowlisted. Do not store raw provider event bodies, MCP arguments, prompts, JSON payloads, asset id lists, or model reasoning.
- Use server timestamps as authoritative `createdAt` values. Runner-supplied timestamps are ignored.
- Use compact event kinds and statuses:
  - `start-processing`;
  - `plan-composing`;
  - `apply-progress`;
  - `runner-recovery`;
  - optional normalized `unknown` only for safe forward compatibility.
- Use compact statuses:
  - `running`;
  - `completed`;
  - `failed`;
  - `skipped`.
- Runner events with unknown activity kind should not break the assistant stream. Normalize unknown kinds to `unknown` with generic user-facing copy when the rest of the event shape is valid.
- Malformed runner activity events are optional hints and must not break an otherwise valid assistant stream. Policy: malformed JSON still fails the stream using existing parser behavior; structurally invalid `activity` frames are ignored and never persisted/websocketed.
- Activity events for terminal sessions should be ignored and not persisted, except events already persisted before the terminal transition. `Applying` is not terminal for this slice; it is an active state and must accept `apply-progress` events.
- Start-processing events are emitted by Gallery when a user turn begins, not by the runner, so the UI has immediate feedback before the runner streams anything.
- Runner activity events are optional hints. Message deltas, tool calls, approval requests, operation plans, and applied plans remain the source of truth.
- Apply progress must use aggregate counts only. It must never include every operation id, asset id, album id, space id, tag id, or payload.
- Frontend copy remains client-owned. The server stores semantic kinds/status/counts and optional safe summary text only.
- Activity events should be attached to turns using the Slice 6 timestamp anchoring rules. If explicit `turnId` is still needed after this slice, capture that as a follow-up backend slice rather than expanding this one.

## Scope

In scope:

- Add activity-event enums, DTOs, table, repository, service, controller endpoint, and generated API artifacts.
- Add a `GET /agent/sessions/:id/activity-events` history endpoint scoped to the current user.
- Add websocket client event type `activity`.
- Extend runner SSE protocol with optional event type `activity`.
- Validate and sanitize runner activity events in Gallery before persistence or websocket fanout.
- Emit a server-owned `start-processing` event when a message turn begins.
- Emit a `runner-recovery` event when Gallery resumes after tool approval or runner recovery continuation begins.
- Emit `plan-composing` around plan proposal/revision/summary lifecycle only where it fills a non-tool visibility gap and does not produce duplicate visible rows.
- Emit `apply-progress` during plan apply with aggregate counts.
- Extend frontend SDK mocks, chat panel loading, websocket handling, and activity turn reconstruction to include persisted/live activity events.
- Preserve existing Slice 1-6 behavior for tool-call cards, activity visibility, current plan, applied plan, approval cards, and turn anchoring.
- Add TDD coverage for backend, runner, generated SDK usage, and frontend integration.

Out of scope:

- Persisting raw provider/runner trace events.
- Displaying chain-of-thought, hidden reasoning, prompts, or raw MCP JSON.
- Public or third-party MCP runner activity-event support.
- Explicit `turnId`/`triggerMessageId` migrations.
- Replacing tool-call audit records.
- Replacing plan-review or applied-plan cards.
- Fine-grained per-asset apply progress.
- Long-session virtualization and final accessibility polish. Slice 8 owns those.

## TDD Commands

Initial red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session-activity-event.dto.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-session-activity-event.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-runner.repository.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-operation-plan.service.spec.ts
pnpm --dir agent-runner exec node --test src/server.test.mjs src/pi-runtime.test.mjs
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

Focused green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session-activity-event.dto.spec.ts src/services/agent-session-activity-event.service.spec.ts src/controllers/agent-session.controller.spec.ts src/repositories/agent-runner.repository.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-operation-plan.service.spec.ts
pnpm --dir agent-runner exec node --test src/server.test.mjs src/pi-runtime.test.mjs
make open-api-typescript
pnpm --filter @immich/sdk build
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session-activity-event.dto.spec.ts src/dtos/agent-session.dto.spec.ts src/dtos/agent-tool.dto.spec.ts src/dtos/agent-operation.dto.spec.ts src/controllers/agent-session.controller.spec.ts src/controllers/agent-runner.controller.spec.ts src/repositories/agent-runner.repository.spec.ts src/services/agent-session-activity-event.service.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-operation-plan.service.spec.ts src/services/agent-runner-flow.integration.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir agent-runner test
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

Generated artifact checks:

```bash
make open-api-typescript
pnpm --filter @immich/sdk build
rg -n "AgentSessionActivityEventResponseDto|getAgentSessionActivityEvents|agent/sessions/\\{id\\}/activity-events" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts mobile/openapi || true
```

## Edge Case Matrix

| Area             | Case                                                | Expected Slice 7 Result                                                                                                                          |
| ---------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Persistence      | Create start-processing event                       | Event is stored with current user's session id, safe kind/status, server timestamp                                                               |
| Persistence      | List history for owned session                      | Returns ordered events by `createdAt`, then `id`                                                                                                 |
| Persistence      | List history for another user's session             | Returns not found/bad request through existing ownership path                                                                                    |
| Persistence      | Session deleted                                     | Activity events cascade-delete with session                                                                                                      |
| Persistence      | Terminal session receives new event                 | Event is ignored and not websocketed                                                                                                             |
| Persistence      | Applying session receives apply-progress            | Event is persisted/websocketed because `Applying` is active for this slice                                                                       |
| DTO safety       | Unknown payload keys                                | Rejected or stripped before persistence                                                                                                          |
| DTO safety       | Negative counts                                     | Rejected                                                                                                                                         |
| DTO safety       | Fractional counts                                   | Rejected                                                                                                                                         |
| DTO safety       | Very large counts                                   | Accepted only within bounded integer range                                                                                                       |
| DTO safety       | Summary with bearer token/API key/provider key      | Redacted before persistence and websocket                                                                                                        |
| DTO safety       | Summary too long                                    | Capped after redaction                                                                                                                           |
| DTO safety       | Raw prompt/reasoning phrase                         | Suppressed to generic safe summary                                                                                                               |
| Runner protocol  | Valid activity SSE                                  | Parsed, validated, persisted, websocketed                                                                                                        |
| Runner protocol  | Unknown activity kind                               | Normalized to safe `unknown` or ignored without killing stream                                                                                   |
| Runner protocol  | Invalid activity payload shape                      | Structurally invalid `activity` frame is ignored as an optional hint; malformed JSON keeps existing stream-error behavior; no unsafe persistence |
| Runner protocol  | Activity for wrong session/runnerSessionId          | Ignored                                                                                                                                          |
| Runner protocol  | Activity arrives after terminal assistant completed | Does not create visible post-terminal row                                                                                                        |
| Runner protocol  | Activity races with assistant delta                 | Both are handled; sequence/order remains deterministic by timestamps                                                                             |
| Server lifecycle | Message dispatch begins                             | Gallery emits `start-processing` before runner deltas/tools/messages                                                                             |
| Server lifecycle | Duplicate dispatch attempt                          | No second start-processing event is persisted for rejected dispatch                                                                              |
| Server lifecycle | Resume after approval starts                        | Gallery emits `runner-recovery` or start/resume activity before resumed runner output                                                            |
| Server lifecycle | Runner error after activity                         | Activity remains safe; runner-error behavior remains unchanged                                                                                   |
| Plan composing   | Plan proposal starts                                | `plan-composing` gives visibility before plan-ready when no better current-plan/tool signal is available                                         |
| Plan composing   | Plan ready event follows                            | UI coalesces/suppresses duplicate plan-composing row rather than showing two plan rows                                                           |
| Apply progress   | Apply starts                                        | Running apply-progress row appears with total selected count only                                                                                |
| Apply progress   | Each operation completes                            | New aggregate event includes applied/skipped/failed counts only                                                                                  |
| Apply progress   | Apply fails mid-way                                 | Failed progress event is persisted; no raw operation/asset ids are exposed                                                                       |
| Apply progress   | Applying selected subset                            | Totals use selected operations, not all proposed operations                                                                                      |
| Frontend history | Reload during long non-tool gap                     | Activity block reconstructs from event history after user message                                                                                |
| Frontend history | Reload after completion                             | Stale running start-processing is completed/suppressed once later terminal evidence exists                                                       |
| Frontend history | Existing tool calls and explicit events             | Tool-call rows remain primary; non-tool events fill gaps only                                                                                    |
| Frontend history | Activity visibility off                             | Activity events are hidden; approval/plan/applied cards still render                                                                             |
| Frontend history | Multiple user turns                                 | Activity events attach to the correct turn with Slice 6 anchoring                                                                                |
| Frontend history | Event before first user message                     | No invented activity block; fallback surfaces remain                                                                                             |
| Frontend live    | Live activity websocket event                       | Merged into current turn without duplicate history rows                                                                                          |
| Frontend live    | History load resolves after websocket event         | Dedupe by event id; no flicker or duplicate activity item                                                                                        |
| Frontend live    | Unknown future event                                | Shows generic safe row or ignores safely                                                                                                         |
| Generated SDK    | New endpoint generated                              | Web imports generated `getAgentSessionActivityEvents` instead of hand-written fetch                                                              |

## File Structure

Create:

- `server/src/dtos/agent-session-activity-event.dto.ts`
- `server/src/dtos/agent-session-activity-event.dto.spec.ts`
- `server/src/schema/tables/agent-session-activity-event.table.ts`
- `server/src/schema/migrations/<timestamp>-AgentSessionActivityEvent.ts`
- `server/src/repositories/agent-session-activity-event.repository.ts`
- `server/src/services/agent-session-activity-event.service.ts`
- `server/src/services/agent-session-activity-event.service.spec.ts`

Likely modify:

- `server/src/database.ts`
- `server/src/enum.ts`
- `server/src/schema/index.ts`
- `server/src/repositories/index.ts`
- `server/src/repositories/websocket.repository.ts`
- `server/src/repositories/agent-runner.repository.ts`
- `server/src/repositories/agent-runner.repository.spec.ts`
- `server/src/services/index.ts`
- `server/src/services/agent-message.service.spec.ts`
- `server/src/services/agent-runner.service.ts`
- `server/src/services/agent-runner.service.spec.ts`
- `server/src/services/agent-operation-plan.service.ts`
- `server/src/services/agent-operation-plan.service.spec.ts`
- `server/src/controllers/agent-session.controller.ts`
- `server/src/controllers/agent-session.controller.spec.ts`
- `server/src/types/agent-runner.types.ts`
- `agent-runner/src/server.mjs`
- `agent-runner/src/server.test.mjs`
- `agent-runner/src/pi-runtime.mjs`
- `agent-runner/src/pi-runtime.test.mjs`
- `web/src/lib/stores/websocket.ts`
- `web/src/lib/__mocks__/sdk.mock.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

Generated:

- `open-api/immich-openapi-specs.json`
- `open-api/typescript-sdk/src/fetch-client.ts`
- `open-api/typescript-sdk/build/fetch-client.d.ts`
- `mobile/openapi/**` if `make open-api-typescript` updates it
- `server/src/queries/agent.session.activity.event.repository.sql` if SQL generation writes it

Do not modify unless a red test proves it is necessary:

- Existing tool-call DTO semantics.
- MCP tool registry/contracts.
- Operation plan review model selection behavior.
- Approval UI ownership.
- Public third-party MCP behavior.

---

## Task 1: Add Activity Event DTO Contract With Red Tests

**Files:**

- Create: `server/src/dtos/agent-session-activity-event.dto.spec.ts`
- Create: `server/src/dtos/agent-session-activity-event.dto.ts`
- Modify: `server/src/enum.ts`

- [ ] **Step 1: Add failing DTO tests**

Add tests for:

- response DTO accepts `start-processing`, `plan-composing`, `apply-progress`, `runner-recovery`, and `unknown`;
- response DTO accepts statuses `running`, `completed`, `failed`, and `skipped`;
- payload/details object is compact and strict;
- apply progress accepts only aggregate counts:
  - `appliedCount`;
  - `skippedCount`;
  - `failedCount`;
  - `totalCount`;
- counts must be integers, non-negative, and reasonably bounded;
- runner recovery reason is allowlisted;
- unknown extra payload keys fail;
- encoded `createdAt` is ISO string.

Expected red failure: DTO and enums do not exist.

- [ ] **Step 2: Add minimal DTO/enums**

Add:

- `AgentSessionActivityEventKind`;
- `AgentSessionActivityEventStatus`;
- `AgentSessionActivityEventResponseDto`;
- `AgentSessionActivityEventPayloadDto` or a strict discriminated union equivalent.

Do not expose raw metadata, raw summaries beyond the safe `summary` field, or arbitrary JSON.

- [ ] **Step 3: Run focused DTO test green**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session-activity-event.dto.spec.ts
```

## Task 2: Add Persistence Contract And Repository

**Files:**

- Create: `server/src/schema/tables/agent-session-activity-event.table.ts`
- Create: `server/src/schema/migrations/<timestamp>-AgentSessionActivityEvent.ts`
- Create: `server/src/repositories/agent-session-activity-event.repository.ts`
- Modify: `server/src/database.ts`
- Modify: `server/src/schema/index.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Add repository/service red tests through service boundary**

Prefer service-level tests over direct DB tests unless this repo already has a local repository test pattern for this feature area.

Assert the service can:

- persist an event for an owned non-terminal session;
- return events ordered by `createdAt`, then `id`;
- return an empty array when a session has no events;
- reject or ignore events for terminal sessions;
- not expose another user's session events.

Expected red failure: repository/service/table do not exist.

- [ ] **Step 2: Add table and migration**

Create table:

- `id uuid primary key default uuid_generate_v4()`;
- `sessionId uuid not null references agent_session(id) on update cascade on delete cascade`;
- `kind varchar not null`;
- `status varchar not null`;
- `summary varchar/text nullable`;
- `payload jsonb not null default '{}'::jsonb`;
- `createdAt timestamp with time zone not null default now()`.

Indexes:

- `agent_session_activity_event_sessionId_createdAt_id_idx` on `sessionId`, `createdAt`, `id`.

Add schema table, database type, column list, and repository provider registration.

- [ ] **Step 3: Add repository methods**

Add:

- `create(dto)`;
- `getBySessionId(sessionId)`;
- optional `getBySessionIds` only if frontend/session list needs it later. Do not add now unless a test requires it.

Use `@GenerateSql` for query drift coverage if consistent with the local repository style.

- [ ] **Step 4: Run focused persistence tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-session-activity-event.service.spec.ts
```

## Task 3: Add Activity Event Service Safety Layer

**Files:**

- Create: `server/src/services/agent-session-activity-event.service.ts`
- Create/modify: `server/src/services/agent-session-activity-event.service.spec.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Add red tests for sanitization and terminal handling**

Assert:

- `createForSession()` checks the session belongs to the user;
- terminal sessions do not persist or websocket activity;
- `Applying` sessions persist and websocket `apply-progress` activity because apply progress is active work;
- active sessions persist and websocket activity;
- summaries redact:
  - `Bearer ...`;
  - `Basic ...`;
  - `api_key=...`;
  - `token=...`;
  - `access_token=...`;
  - `refresh_token=...`;
  - `runner_token=...`;
  - `sk-...` provider-looking keys;
  - token query params in URLs;
- raw prompt/reasoning phrases are replaced by generic safe copy;
- summaries are capped after redaction;
- apply progress never stores operation ids or asset ids even if callers pass them by mistake;
- unknown runner kinds normalize to `unknown` with generic copy.

Expected red failure: safety service does not exist.

- [ ] **Step 2: Implement service**

Recommended public methods:

- `listForSession(auth, sessionId): Promise<AgentSessionActivityEventResponseDto[]>`;
- `createForSession(auth, sessionId, event): Promise<AgentSessionActivityEventResponseDto | null>`;
- `createSystemEvent(userId, sessionId, event): Promise<AgentSessionActivityEventResponseDto | null>`;
- `normalizeRunnerEvent(event): SafeAgentSessionActivityEventCreate | null`.

Keep websocket fanout in the service so every persisted live event uses the same sanitization path.

- [ ] **Step 3: Run focused service tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-session-activity-event.service.spec.ts
```

## Task 4: Add History Endpoint And Generated API

**Files:**

- Modify: `server/src/controllers/agent-session.controller.ts`
- Modify: `server/src/controllers/agent-session.controller.spec.ts`
- Generated: `open-api/**`, `mobile/openapi/**`

- [ ] **Step 1: Add controller red tests**

Add tests for:

- route is authenticated with `Permission.AgentSessionRead`;
- `GET /agent/sessions/:id/activity-events` delegates to service with current auth and session id;
- response serializes ISO timestamps and safe payload;
- invalid UUID is rejected by existing param validation;
- service not-found/ownership failure propagates consistently with other session endpoints.

Expected red failure: route does not exist.

- [ ] **Step 2: Add route**

Add endpoint under `AgentSessionController`:

```text
GET /agent/sessions/:id/activity-events
```

Use existing `UUIDParamDto`, `@Authenticated({ permission: Permission.AgentSessionRead })`, and `Endpoint` metadata.

- [ ] **Step 3: Regenerate client artifacts**

```bash
make open-api-typescript
pnpm --filter @immich/sdk build
```

Verify:

```bash
rg -n "AgentSessionActivityEventResponseDto|getAgentSessionActivityEvents|activity-events" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
```

## Task 5: Extend Websocket And Runner Event Protocols

**Files:**

- Modify: `server/src/repositories/websocket.repository.ts`
- Modify: `server/src/types/agent-runner.types.ts`
- Modify: `server/src/repositories/agent-runner.repository.ts`
- Modify: `server/src/repositories/agent-runner.repository.spec.ts`
- Modify: `agent-runner/src/server.mjs`
- Modify: `agent-runner/src/server.test.mjs`
- Modify only if needed: `agent-runner/src/e2e-runtime.mjs`, `agent-runner/src/e2e-runtime.test.mjs`

- [ ] **Step 1: Add server parser red tests**

In `agent-runner.repository.spec.ts`, assert:

- valid SSE `event: activity` frame parses to `AgentRunnerStreamEvent`;
- missing `sessionId`/`runnerSessionId` is rejected or ignored consistently;
- structurally invalid `activity` frames are ignored without terminating the stream and do not persist unsafe data;
- unknown activity kind is normalized/ignored without terminating an otherwise valid stream;
- malformed JSON still throws existing invalid stream event error.

Expected red failure: parser does not know `activity`.

- [ ] **Step 2: Extend server-side runner event type**

Add `AgentRunnerStreamEvent` union variant:

```ts
{
  type: 'activity';
  sessionId: string;
  runnerSessionId: string;
  kind: string;
  status?: string;
  summary?: string;
  payload?: Record<string, unknown>;
}
```

Keep the repository parser strict enough to reject non-object payloads and missing ids, but tolerant enough that optional activity hints cannot bring down a session solely because a future kind appears. If `status` is omitted by the runner, Gallery must normalize it to `running` before persistence/websocket fanout; add a test for omitted status.

- [ ] **Step 3: Add runner server red tests**

In `agent-runner/src/server.test.mjs`, assert:

- runtime `activity` events stream as SSE `event: activity`;
- activity frame body includes only the safe event fields;
- streaming order preserves activity before later deltas when runtime yields it first;
- runtime invalid non-activity event still fails according to existing server policy;
- runtime invalid `activity` event is skipped as an optional hint and later valid deltas/completion still stream.

- [ ] **Step 4: Implement runner SSE passthrough**

Add `activity` to the runner server SSE bridge.

Do not emit provider internals or session object dumps.

- [ ] **Step 5: Run focused protocol tests**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/repositories/agent-runner.repository.spec.ts
pnpm --dir agent-runner exec node --test src/server.test.mjs
```

## Task 6: Emit Server-Owned Lifecycle Activity

**Files:**

- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`
- Modify: `server/src/services/agent-runner-flow.integration.spec.ts`

- [ ] **Step 1: Add red tests for turn start and resume**

Assert:

- `AgentMessageService.appendUserMessage()` persists the user message and triggers exactly one `start-processing` event for the new turn;
- rejected message append does not emit `start-processing`;
- `AgentRunnerService.sendMessage()` emits/persists `start-processing` before the first runner delta when called directly by tests or future call sites;
- rejected duplicate dispatch does not emit a second event;
- `resumeAfterToolApproval()` emits/persists `runner-recovery` before resumed runner output;
- runner activity events from SSE are passed through `AgentSessionActivityEventService`;
- mismatched `sessionId` or `runnerSessionId` activity events are ignored;
- activity event service failure does not corrupt message persistence, but logs/handles failure according to local error policy;
- runner-error behavior remains unchanged.

Expected red failure: message/runner services do not emit activity events.

- [ ] **Step 2: Inject activity service**

Inject `AgentSessionActivityEventService` into `AgentRunnerService`.

Emit:

- `start-processing` when a new user message dispatch begins;
- `runner-recovery` when resume-after-approval dispatch begins;
- validated runner `activity` events inside `processRunnerStream()`.

Use the same `userId`, `sessionId`, and server timestamp path as other websocket events.

Also add `AgentMessageService` tests so the user-facing append path is covered. The implementation may keep the actual emission inside `AgentRunnerService.sendMessage()`, but tests must prove the public append path emits exactly once.

- [ ] **Step 3: Add integration coverage**

Update `agent-runner-flow.integration.spec.ts` to assert that live websocket events include activity without changing the existing order-sensitive behavior for:

- tool approval pause;
- approval resume continuation;
- runner error;
- assistant message completion.

## Task 7: Emit Plan And Apply Progress Activity

**Files:**

- Modify: `server/src/services/agent-operation-plan.service.ts`
- Modify: `server/src/services/agent-operation-plan.service.spec.ts`

- [ ] **Step 1: Add red tests for `plan-composing`**

Assert:

- plan proposal/revision/summary paths can emit `plan-composing` while work is underway;
- plan-ready websocket still fires as before;
- errors during plan creation create safe failed activity if appropriate;
- `plan-composing` is emitted only when it fills a non-tool visibility gap before tool-call/current-plan evidence is available;
- no duplicate visible activity is required when a plan tool call already covers the same work. Prefer suppressing the redundant event at the service boundary; frontend coalescing is still required as a defense.

- [ ] **Step 2: Add red tests for `apply-progress`**

Assert:

- apply start emits aggregate counts with `appliedCount: 0`, `skippedCount: 0`, `failedCount: 0`, `totalCount`;
- apply start persists while the session is `Applying`;
- each completed operation appends a new aggregate progress event;
- selected subset total uses selected operations only;
- skipped/disabled operations are counted as skipped, not leaked as operation ids;
- failed operation emits failed aggregate event and preserves existing failure behavior;
- websocket `operation-plan-applied` completion event still fires exactly once;
- activity event payload never contains `operationIds`, `assetIds`, `albumIds`, `spaceIds`, `tagIds`, or raw operation payloads.

Expected red failure: no activity progress integration.

- [ ] **Step 3: Implement aggregate progress helpers**

Add small private helpers in `AgentOperationPlanService`:

- `emitPlanComposingActivity(...)`;
- `emitApplyProgressActivity(...)`;
- `buildApplyProgressPayload(...)`.

Keep implementation side-effect-only and tolerant of activity persistence failure only if local service policy supports that. Do not let optional activity events cause duplicate mutations.

## Task 8: Add Runner-Side Activity Hints

**Files:**

- Modify: `agent-runner/src/pi-runtime.mjs`
- Modify: `agent-runner/src/pi-runtime.test.mjs`

- [ ] **Step 1: Add red tests for first-party runner activity**

Assert:

- `sendMessage()` yields `activity/start-processing` or an equivalent runner hint only when the runtime has a meaningful gap not already covered by Gallery's server-owned event;
- `resumeSession()` yields `activity/runner-recovery` before the resume prompt output;
- activity events never include prompt text, provider messages, tool arguments, secrets, or raw session state;
- if the Pi runtime throws, existing `runner-error` sanitization remains unchanged.

Expected red failure: runtime does not yield activity.

- [ ] **Step 2: Implement minimal runner hints**

Prefer the smallest runner change:

- emit `runner-recovery` on resume if Gallery cannot infer enough from server-side resume;
- avoid duplicating `start-processing` if Gallery already emits it immediately;
- do not inspect private provider state to fabricate detailed progress.

If server-owned lifecycle events fully cover this task, document that runner runtime emits no additional start event and keep tests focused on SSE passthrough with a fake runtime. Do not leave both requirements active; choose one path before implementation and update this task's tests accordingly.

## Task 9: Frontend Activity Event View Model

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-activity-turns-ui.spec.ts`

- [ ] **Step 1: Add red tests for event-to-row mapping**

In `agent-activity-ui.spec.ts`, assert:

- `start-processing` maps to safe plain-language row such as `Understanding request`;
- `plan-composing` maps to plan row such as `Preparing a plan`;
- `apply-progress` maps to apply row with aggregate count/progress copy;
- `runner-recovery` maps to safe row such as `Continuing after approval`;
- `unknown` maps to generic safe row or is ignored;
- technical details do not expose event payload keys beyond allowlisted counts/reason/timestamps;
- unsafe summary text is not shown by default and remains redacted in technical details.

Expected red failure: activity model does not accept explicit events.

- [ ] **Step 2: Extend model input**

Add optional `activityEvents` to `BuildAgentActivityModelInput` or to the Slice 6 turn helper input.

Recommended shape should use generated SDK type:

```ts
activityEvents?: AgentSessionActivityEventResponseDto[];
```

Map events into `AgentActivityItem`s with deterministic ids:

```text
event-${event.kind}-${event.id}
```

Use event `createdAt` as `startedAt`.

- [ ] **Step 3: Add red tests for turn anchoring**

In `agent-session-activity-turns-ui.spec.ts`, assert:

- event after user and before assistant attaches to that user turn;
- event before first user is ignored/fallback, not invented;
- event after terminal assistant but before next user follows Slice 6 terminal-boundary rules;
- multiple user turns keep events separated;
- history plus websocket event dedupe by id;
- stale running start-processing becomes completed/suppressed once later tool/assistant evidence exists;
- plan-composing coalesces with current plan/tool plan row to avoid duplicate plan rows;
- apply-progress coalesces with applying/applied plan rows without hiding applied-plan card.

- [ ] **Step 4: Implement helper integration**

Extend `buildAgentSessionActivityTurns()` to accept activity events and group them by timestamp.

Keep the existing covered tool-call id and applied-plan key logic unchanged.

## Task 10: Frontend History Loading And Live Updates

**Files:**

- Modify: `web/src/lib/stores/websocket.ts`
- Modify: `web/src/lib/__mocks__/sdk.mock.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`

- [ ] **Step 1: Add chat panel red tests**

Assert:

- on mount, chat panel calls `getAgentSessionActivityEvents({ id: session.id })`;
- reload with only user message plus `start-processing` history shows activity block;
- live websocket `activity` event appears in the current activity block;
- live event and later history load dedupe by event id;
- `activityVisibilityMode: 'off'` hides explicit activity rows without showing raw fallback cards;
- unknown future activity event shows safe generic copy or is ignored;
- activity event does not steal focus from composer;
- action dock still renders approval/plan review independently;
- existing tool-call activity remains primary when both event and tool call represent the same work.

Expected red failure: chat panel does not load or handle activity events.

- [ ] **Step 2: Add websocket type**

Add client-side event union:

```ts
{
  type: 'activity';
  sessionId: string;
  event: AgentSessionActivityEventResponseDto;
  createdAt: string;
}
```

- [ ] **Step 3: Load history**

In `AgentSessionChatPanel`:

- add `activityEvents` state;
- load history on mount, with sequence guard like applied/current plan loading;
- merge/dedupe by event id;
- pass activity events into `buildAgentSessionActivityTurns()`;
- handle websocket `activity` events for the current session.

- [ ] **Step 4: Update SDK mock**

Add `getAgentSessionActivityEvents` to `web/src/lib/__mocks__/sdk.mock.ts` and test setup defaults.

## Task 11: Generated Artifacts And Drift Checks

**Files:**

- Generated OpenAPI/SDK files.
- Generated SQL query files if repository query generation updates them.

- [ ] **Step 1: Regenerate OpenAPI and SDK**

```bash
make open-api-typescript
pnpm --filter @immich/sdk build
```

- [ ] **Step 2: Verify generated API**

```bash
rg -n "AgentSessionActivityEventResponseDto|getAgentSessionActivityEvents|activity-events" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts open-api/typescript-sdk/build/fetch-client.d.ts
```

- [ ] **Step 3: Review generated mobile artifacts**

If `mobile/openapi/**` changes, confirm the endpoint and DTO are present and no secret-bearing fields are generated.

## Task 12: Final Verification

- [ ] **Step 1: Run backend focused suite**

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-session-activity-event.dto.spec.ts src/services/agent-session-activity-event.service.spec.ts src/controllers/agent-session.controller.spec.ts src/repositories/agent-runner.repository.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-operation-plan.service.spec.ts
```

- [ ] **Step 2: Run runner suite**

```bash
pnpm --dir agent-runner test
```

- [ ] **Step 3: Run frontend focused suite**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-activity-turns-ui.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 4: Run type and lint checks**

```bash
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

- [ ] **Step 5: Manual smoke check**

With `make dev` running:

1. Open `/assistant`.
2. Send a message.
3. Confirm an immediate activity row appears before any model text.
4. Trigger a permission request and approve it.
5. Confirm the resume activity appears and Pi continues.
6. Apply a plan with multiple operations.
7. Confirm apply progress shows aggregate counts and the session stays open.
8. Reload the page and confirm the same activity summary reconstructs.

## Acceptance Checklist

- [ ] Slice uses TDD: red tests are added before implementation for DTO, service, runner protocol, apply progress, and web integration.
- [ ] New history endpoint returns only the current user's session activity events.
- [ ] Event payloads are compact and allowlisted.
- [ ] Secrets, tokens, raw prompts, and reasoning text are redacted or suppressed before persistence.
- [ ] Runner `activity` events are optional and cannot break a session just because a future kind appears.
- [ ] Structurally invalid runner `activity` events are ignored, while malformed JSON keeps existing parser failure behavior.
- [ ] Runner activity events without `status` normalize to `running`.
- [ ] Start-processing appears immediately for a new user turn.
- [ ] Resume/recovery appears after approving a permission request.
- [ ] Apply progress uses aggregate counts only.
- [ ] `Applying` sessions accept `apply-progress`; terminal `Completed`, `Cancelled`, and `Failed` sessions reject/ignore new activity events.
- [ ] Events after terminal sessions are ignored.
- [ ] Activity events race safely with messages, tool calls, plans, and websocket refreshes.
- [ ] Activity events merge into existing Slice 6 turn anchoring.
- [ ] Existing approval cards, plan review, applied-plan cards, messages, and tool-call suppression behavior remain intact.
- [ ] Generated OpenAPI and TypeScript SDK expose `getAgentSessionActivityEvents`.
- [ ] Focused and regression commands pass.

## Notes For Implementation Agents

- Keep server event copy semantic. The frontend should decide the final user-facing labels.
- Do not add arbitrary `metadata` or `details` JSON just because it is convenient. If a field is not explicitly tested as safe, do not persist it.
- Prefer a small helper in `AgentSessionActivityEventService` for redaction so runner events, server lifecycle events, and apply progress all share one path.
- Do not change the Slice 6 timestamp anchoring rules unless a red test proves they are insufficient. If that happens, stop and propose an explicit turn-id follow-up slice.
- Keep commits logically separate from existing dirty Slice 1-6 work if committing later.
