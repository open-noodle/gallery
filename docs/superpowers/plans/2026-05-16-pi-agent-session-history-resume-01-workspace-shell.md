# Pi Agent Session History Resume 01 Workspace Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 1 from `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`: turn `/assistant` into a session workspace shell with a Claude-like left chat/session sidebar, right selected-session pane, new-chat state, initial resume from URL, and session selection URL sync.

**Architecture:** UI-only browser slice. The page load fetches runner status, credentials, and owned sessions. The workspace owns selected session state and renders the existing setup, chat, and plan review components inside the new two-pane layout. No backend schema, generated SDK, runner protocol, tool gateway, MCP endpoint, compose, or Docker changes.

**Tech Stack:** Svelte 5, existing generated `@immich/sdk` browser APIs, `@immich/ui`, focused Vitest/Svelte Testing Library tests.

---

## Scope

This slice implements only the workspace shell and session navigation:

- Add `getAgentSessions()` to `/assistant` page load.
- Preserve existing runner status and credential loading.
- Read `?session=<sessionId>` from the page URL and pass it to the workspace.
- Add pure helper coverage for initial selection, sidebar sorting, status labels, and temporary title fallback.
- Add a left sidebar with:
  - `New chat`;
  - local search/filter input;
  - session rows sorted by actionable status and recency;
  - status badges;
  - temporary title fallback to `New chat`.
- Add selected-session URL sync:
  - valid initial query selects that session;
  - invalid/missing query falls back to the actionable-session heuristic;
  - clicking a session updates `?session=...`;
  - `New chat` clears the query parameter.
- Reuse existing right-pane behavior:
  - no selected session renders `AgentSessionSetupPanel`;
  - selected session renders existing session metadata, `AgentSessionChatPanel`, and `AgentOperationPlanReviewPanel` within the right pane;
  - creating a new session inserts/selects it and updates the URL.
- Keep existing setup disabled states for unhealthy runner or no credentials.
- Add desktop two-pane layout and a minimal mobile sidebar drawer.

This slice intentionally does not add:

- Durable chat titles.
- Backend or database changes.
- Generated SDK/OpenAPI changes.
- Approval action cards.
- Tool-call polling.
- The final integrated action dock.
- Plan review relocation beyond placing the existing component in the selected pane.
- Cancel/resume composer lifecycle changes beyond preserving existing chat-panel behavior for selected sessions.
- Runner, MCP, gateway, compose, or Docker changes.

## Design Source

- `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`

Relevant design decisions:

- Durable chat titles are deferred.
- Temporary titles come only from already loaded selected-session transcripts or fall back to `New chat`.
- Because slice 1 reuses the existing chat panel, the implementation may leave the temporary-title cache empty and show `New chat` for all rows. Do not fetch every transcript just to title the sidebar. A later conversation-pane slice can publish the selected session's first user message into the title cache.
- Workspace must avoid MCP conflict surfaces.
- Implementation must use TDD.
- Slice 1 is intentionally narrower than the full design's final workspace: approval cards, action dock behavior, cancel polish, and durable/in-memory transcript-derived sidebar titles remain later slices.

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

Expected write set:

- `web/src/routes/(user)/assistant/+page.ts`
- `web/src/routes/(user)/assistant/+page.svelte`
- `web/src/routes/(user)/assistant/page-load.spec.ts`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-sidebar.svelte`
- `web/src/routes/(user)/assistant/agent-session-sidebar.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-row.svelte`
- `web/src/routes/(user)/assistant/agent-session-workspace-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts`
- possible updates to `agent-session-page-content.svelte` / `.spec.ts` if kept as a wrapper
- `web/src/lib/i18n/en.json`

If a generated SDK artifact changes, stop and investigate. This slice should use only SDK exports already present on the branch.

## UI Contracts

### Initial Selection

Use this priority:

1. If `?session=<id>` matches an owned session from `getAgentSessions()`, select it.
2. Otherwise select the newest `waiting_for_tool_approval` session.
3. Otherwise select the newest `waiting_for_plan_review` session.
4. Otherwise select the newest `interrupted` session.
5. Otherwise select the newest `running` session.
6. Otherwise select the newest `applying` session.
7. Otherwise select no session and show new-chat setup.

Tie-breakers:

- newer `createdAt` first;
- then lexicographically descending `id` for deterministic tests.

### Sidebar Sorting

Rows should be ordered by:

1. actionable status priority:
   - `waiting_for_tool_approval`;
   - `waiting_for_plan_review`;
   - `interrupted`;
   - `running`;
   - `applying`;
   - everything else;
2. newer `createdAt` first;
3. descending `id`.

### Sidebar Row

Each row shows:

- title: temporary transcript title if known for that session, otherwise `New chat`;
- metadata: credential label, model, or created date in compact form;
- status badge for actionable and terminal statuses.

Status label keys should be pure-helper owned so tests can pin all enum values. The sidebar should show text badges for `waiting_for_tool_approval`, `waiting_for_plan_review`, `interrupted`, `running`, `applying`, `completed`, `cancelled`, and `failed`; it may hide badges for `created`.

### URL Sync

Use `/assistant?session=<sessionId>`.

- Initial fallback selection should use `replaceState`-style navigation so a bad or missing query does not add history noise.
- User clicking a session should use normal navigation/push behavior.
- Clicking `New chat` should clear `session`.
- Creating a session should select it and update `session` in the URL.
- Browser back/forward or parent prop updates to a different `requestedSessionId` should update the selected session without leaking stale selected-session state.

Use SvelteKit `goto()` with `keepFocus: true` and `noScroll: true` where practical. Do not force a full page reload.

### Right Pane

When no session is selected:

- render the setup panel;
- keep runner status visible in the workspace;
- do not render chat or plan review.

When a session is selected:

- render a compact selected-session header;
- render the existing metadata summary in a less dominant form than the old full-width card;
- render `AgentSessionChatPanel` keyed by session ID;
- render `AgentOperationPlanReviewPanel` keyed by session ID;
- disable or hide setup until `New chat` is clicked.

The full approval/action dock is out of scope for slice 1.

## Test Commands

Red/green focused commands:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/page-load.spec.ts
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-workspace-ui.spec.ts
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-sidebar.spec.ts
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
```

Regression commands:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant
pnpm --dir web check
```

Do not run broad e2e for this slice unless a later implementation task explicitly adds the reload/resume smoke spec.

## Slice 1 Edge Cases To Cover

Selection and URL state:

- `requestedSessionId` is `null`, empty string, malformed, unknown, or valid.
- Missing/invalid query with an actionable fallback rewrites the query with `replaceState`.
- Missing/invalid query with no actionable fallback leaves the page in new-chat state and does not invent a session query.
- A valid requested session does not trigger a redundant URL rewrite.
- Browser back/forward or prop updates select the newly requested session.
- User-driven sidebar selection uses push-style navigation.
- `New chat` clears the query and selected session.
- Creating a session replaces any older copy of that session ID in local state, selects it, and updates the query.

Session ordering and display:

- Same `createdAt` values sort deterministically by descending ID.
- `created`, `running`, `waiting_for_tool_approval`, `waiting_for_plan_review`, `interrupted`, `applying`, `completed`, `cancelled`, and `failed` have explicit helper coverage.
- Sidebar rows fall back to `New chat` without fetching transcripts for every session.
- Search has no matches.
- Search matches visible title text, model, credential label, visible status text, and raw status value case-insensitively.

Workspace state:

- Switching sessions remounts keyed chat and plan panels.
- Switching sessions clears shell-owned transient UI such as mobile drawer state.
- Existing setup disabled states survive inside the new workspace.
- Late prop updates or rerenders do not reselect a fallback over a user-selected session unless the URL/requested session changes.

Responsive/accessibility:

- Sidebar rows are keyboard-activatable buttons.
- Selected row exposes an accessible selected/current state.
- Mobile drawer opens, closes, and closes after selecting a row.
- Long titles, credential labels, and model names are constrained and wrap/truncate without changing row height unpredictably.

---

## Task 1: Page Load Sessions

**Files:**

- Modify: `web/src/routes/(user)/assistant/page-load.spec.ts`
- Modify: `web/src/routes/(user)/assistant/+page.ts`

- [ ] **Step 1: Write failing page-load tests**

Update `page-load.spec.ts` to expect:

- `getAgentSessions()` is called alongside runner status and credentials.
- load result includes:
  - `runnerStatus`;
  - `credentials`;
  - `sessions`;
  - `requestedSessionId`.
- `requestedSessionId` is `null` when the URL has no `session` query.
- `requestedSessionId` is the raw query value when present.
- auth failure still prevents all agent API calls.
- runner/credential/session API failures are not swallowed.

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/page-load.spec.ts
```

Expected: FAIL because `+page.ts` does not call `getAgentSessions()` or return `requestedSessionId`.

- [ ] **Step 2: Implement page-load sessions**

Update `+page.ts`:

- import `getAgentSessions`;
- after `authenticate(url)` and formatter setup, fetch runner status, credentials, and sessions with `Promise.all`;
- return `requestedSessionId: url.searchParams.get('session')`;
- return `sessions`.

Re-run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/page-load.spec.ts
```

Expected: PASS.

---

## Task 2: Workspace Pure Helpers

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-workspace-ui.ts`

- [ ] **Step 1: Write failing helper tests**

Create helper tests for:

- `getInitialSelectedSessionId(sessions, requestedSessionId)`.
- `sortSessionsForSidebar(sessions)`.
- `getSessionSidebarStatusLabelKey(status)`.
- `shouldShowSessionStatusBadge(status)`.
- `getSessionPreviewTitle(sessionId, titleBySessionId)`.
- `filterSidebarSessions(sessions, query, titleBySessionId)`.

Coverage:

- valid requested session wins.
- unknown requested session falls back.
- fallback priority: approval, plan review, interrupted, running.
- applying is selected after running and before terminal/new-chat fallback.
- no actionable sessions returns `null`.
- sorting uses status priority, created date, then ID.
- every `AgentSessionStatus` has a stable status label behavior.
- empty temporary title falls back to `assistant_new_chat`.
- title cache may be empty for every session without triggering transcript fetches.
- search matches temporary title, model, credential label, translated status label text, raw status value, and is case-insensitive.
- search with no query returns all sorted sessions.

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-workspace-ui.spec.ts
```

Expected: FAIL because helpers do not exist.

- [ ] **Step 2: Implement helpers**

Create `agent-session-workspace-ui.ts`.

Recommended exports:

```ts
export const ASSISTANT_SESSION_QUERY_PARAM = 'session';
export const getInitialSelectedSessionId = (...): string | null => ...
export const sortSessionsForSidebar = (...): AgentSessionResponseDto[] => ...
export const getSessionSidebarStatusLabelKey = (status: AgentSessionStatus): string => ...
export const shouldShowSessionStatusBadge = (status: AgentSessionStatus): boolean => ...
export const getSessionPreviewTitle = (sessionId: string, titleBySessionId: Record<string, string>): string => ...
export const filterSidebarSessions = (...): AgentSessionResponseDto[] => ...
```

Keep helpers pure and independent of Svelte. If `filterSidebarSessions` needs translated labels, pass a plain label lookup or label resolver into the helper rather than importing i18n.

Re-run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-workspace-ui.spec.ts
```

Expected: PASS.

---

## Task 3: Session Sidebar

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-row.svelte`
- Create: `web/src/routes/(user)/assistant/agent-session-sidebar.svelte`
- Create: `web/src/routes/(user)/assistant/agent-session-sidebar.spec.ts`

- [ ] **Step 1: Write failing sidebar component tests**

Mock `svelte-i18n` locally.

Test:

- renders `New chat` button.
- renders a search input with a visible label or accessible name.
- renders sessions in helper-sorted order.
- selected session row has `aria-current="true"` or equivalent accessible selected state.
- clicking a session calls `onSelectSession(session.id)`.
- clicking `New chat` calls `onNewChat()`.
- search filters rows without mutating the input session list.
- status badges render for actionable/terminal statuses.
- rows with no temporary title show `New chat`.
- searching by visible status text filters the matching rows.
- the sidebar does not call any transcript/message APIs.
- long labels remain in bounded row containers through class-level stable sizing where practical.

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-sidebar.spec.ts
```

Expected: FAIL because sidebar components do not exist.

- [ ] **Step 2: Implement row and sidebar**

Implement:

- `agent-session-row.svelte`
- `agent-session-sidebar.svelte`

Use existing Gallery visual language:

- compact rows;
- restrained borders;
- no nested cards;
- visible selected state;
- status badges with readable text, not color-only.

Use `Button`/`Input` from `@immich/ui` where they fit existing local patterns. Keep row click targets accessible as buttons.

Re-run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-sidebar.spec.ts
```

Expected: PASS.

---

## Task 4: Workspace Shell And URL Selection

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- Create: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- Modify: `web/src/routes/(user)/assistant/+page.svelte`
- Modify or replace: `web/src/routes/(user)/assistant/agent-session-page-content.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-page-content.spec.ts` if the component remains public

- [ ] **Step 1: Write failing workspace tests**

Mock:

- `AgentRunnerStatusPanel` if needed;
- `AgentSessionSetupPanel`;
- `AgentSessionChatPanel`;
- `AgentOperationPlanReviewPanel`;
- SvelteKit navigation `goto`.

Test:

- no selected session renders setup and no chat/plan panels.
- valid requested session selects that session on mount.
- invalid requested session falls back to heuristic.
- missing requested session with an actionable fallback selects the fallback and uses replace-style navigation.
- missing requested session with no actionable fallback stays in new-chat state.
- changing `requestedSessionId` through prop/rerender selects the newly requested session to cover back/forward behavior.
- session click updates selected session and calls `goto()` with `?session=<id>`.
- `New chat` clears selection and calls `goto()` without `session`.
- session creation inserts/replaces the session in sidebar state, selects it, and updates URL.
- switching selected sessions keys the chat/plan panels by session ID.
- fallback initial selection uses replace-style navigation if it rewrites the query.
- existing runner unavailable/no credential setup disabled states still render through the setup panel.
- mobile sidebar toggle opens and closes the sidebar drawer.
- selecting a session from the mobile drawer closes the drawer.
- no transcript APIs are called solely to populate sidebar titles.

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
```

Expected: FAIL because workspace does not exist.

- [ ] **Step 2: Implement workspace shell**

Create `agent-assistant-workspace.svelte` with props:

```ts
runnerStatus: AgentRunnerStatusDto;
credentials: AgentProviderCredentialResponseDto[];
sessions: AgentSessionResponseDto[];
requestedSessionId: string | null;
```

Responsibilities:

- own mutable `sessions`;
- own `selectedSessionId`;
- compute selected session via helper;
- render sidebar;
- render right pane;
- handle `New chat`;
- handle selection;
- handle session creation from setup panel;
- update URL through a small local navigation helper.

Right pane may reuse existing `AgentSessionPageContent` internals or replace that component. Prefer the smallest refactor that avoids duplicate session state.

Update `+page.svelte` to render `AgentAssistantWorkspace`.

Re-run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Update or retire old page-content tests**

If `agent-session-page-content.svelte` remains as a wrapper, update its tests to pass the new required props and assert wrapper wiring only.

If it is removed, delete its focused test and move relevant coverage to `agent-assistant-workspace.spec.ts`.

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant/agent-session-page-content.spec.ts src/routes/\(user\)/assistant/agent-assistant-workspace.spec.ts
```

Expected: PASS, or only the workspace spec remains if page-content is removed.

---

## Task 5: i18n Copy

**Files:**

- Modify: `web/src/lib/i18n/en.json`

- [ ] **Step 1: Add required English keys**

Candidate keys:

```json
{
  "assistant_new_chat": "New chat",
  "assistant_search_chats": "Search chats",
  "assistant_sessions": "Sessions",
  "assistant_session_status_needs_approval": "Needs approval",
  "assistant_session_status_review_plan": "Review plan",
  "assistant_session_status_running": "Running",
  "assistant_session_status_interrupted": "Interrupted",
  "assistant_session_status_applying": "Applying",
  "assistant_session_status_done": "Done",
  "assistant_session_status_cancelled": "Cancelled",
  "assistant_session_status_failed": "Failed",
  "assistant_session_sidebar_open": "Open sessions",
  "assistant_session_sidebar_close": "Close sessions",
  "assistant_selected_session": "Selected session"
}
```

Keep copy short and operational.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant
```

Expected: PASS.

---

## Task 6: Final Verification

- [ ] **Step 1: Run focused Assistant suite**

```bash
pnpm --dir web test -- --run src/routes/\(user\)/assistant
```

- [ ] **Step 2: Run web type checks**

```bash
pnpm --dir web check
```

- [ ] **Step 3: Review MCP boundary**

Run:

```bash
git diff --name-only
```

Expected touched files are limited to:

- `web/src/routes/(user)/assistant/**`
- `web/src/lib/i18n/en.json`
- this plan file

No `agent-runner`, server runner, MCP, env, compose, Docker, generated SDK, or migration files should change.

- [ ] **Step 4: Review final behavior**

Manually inspect the diff for:

- no durable title assumptions;
- no transcript fetch for every sidebar row at page load;
- no transport-specific approval/tool logic;
- no visible text explaining implementation details;
- selected session URL sync is deterministic and tested.

## Handoff To Later Slices

Later slices should own:

- pending approval action dock and tool-call polling;
- integrated plan action dock and read-only applied plan state;
- details drawer and cancel polish if slice 1 keeps cancellation minimal;
- targeted Playwright reload/resume smoke;
- durable titles as a separate backend/API slice after MCP conflict risk is lower.
