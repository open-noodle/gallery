# Pi Agent Session History Resume 02 Conversation Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement slice 2 from `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`: extract the selected-session right pane into a conversation pane, make the selected session header compact, move the old metadata summary into details UI, and publish temporary in-memory sidebar/header titles from the selected session transcript.

**Architecture:** UI-only browser slice. Reuse existing browser-facing APIs and existing chat/plan components. The workspace keeps session selection and URL ownership; a new conversation pane owns selected-session presentation and forwards title discovery from the loaded transcript. No backend schema, generated SDK, runner protocol, tool gateway, MCP endpoint, compose, or Docker changes.

**Tech Stack:** Svelte 5, existing generated `@immich/sdk` browser APIs, `@immich/ui`, focused Vitest/Svelte Testing Library tests.

---

## Scope

This slice implements the conversation-pane foundation only:

- Add pure helper coverage for deriving a temporary title from loaded messages.
- Add an optional transcript-title callback to the chat panel.
- Add a selected-session conversation pane component that renders:
  - compact selected-session header;
  - status badge, provider credential, model, and approval mode;
  - `New chat` action;
  - session details disclosure/drawer for the old metadata snapshot;
  - existing `AgentSessionChatPanel`;
  - existing `AgentOperationPlanReviewPanel`.
- Remove the persistent selected-session metadata summary card from `AgentAssistantWorkspace`.
- Add shell-owned `titleBySessionId` cache:
  - updates only from the selected session transcript;
  - passes into the sidebar;
  - passes into the conversation header;
  - never fetches every session transcript on page load.
- Preserve existing setup, chat, plan review, and URL-selection behavior from slice 1.

This slice intentionally does not add:

- Durable chat titles.
- Backend or database changes.
- Generated SDK/OpenAPI changes.
- Tool approval cards.
- Tool-call polling or action dock.
- Plan review relocation into the action dock.
- Cancel API wiring.
- Composer status rules for terminal/interrupted/approval states.
- Runner, MCP, gateway, compose, or Docker changes.

## Design Source

- `docs/superpowers/specs/2026-05-16-pi-agent-session-history-resume-design.md`

Relevant design decisions:

- Durable chat titles are deferred.
- Temporary titles come from the first loaded user text message for a selected session.
- Sidebar rows must not trigger transcript fetches for every session.
- The selected session header should be compact and keep the conversation primary.
- The old "Created session" summary should move into a details popover or drawer instead of occupying persistent vertical space.
- Implementation must use TDD.

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

- `web/src/routes/(user)/assistant/agent-session-workspace-ui.ts`
- `web/src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-header.svelte`
- `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-details-drawer.svelte`
- `web/src/routes/(user)/assistant/agent-session-details-drawer.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-sidebar.spec.ts`
- `i18n/en.json`

If a generated SDK artifact changes, stop and investigate. This slice should use only SDK exports already present on the branch.

## UI Contracts

### Temporary Title Derivation

Use loaded messages for the selected session only.

Rules:

1. Find the first user message with at least one non-empty text block.
2. Join text blocks in that message in display order.
3. Trim leading/trailing whitespace.
4. Collapse internal whitespace to single spaces for sidebar/header display.
5. Truncate deterministically to 60 characters after whitespace collapse, using a single trailing ellipsis when truncated.
6. If no valid user text exists, do not update the cache and keep `New chat`.

Do not derive titles from assistant messages, tool-call blocks, asset blocks, plan blocks, provider message IDs, tool call IDs, or raw metadata.

### Title Cache Ownership

`AgentAssistantWorkspace` owns `titleBySessionId`.

- It passes the cache to `AgentSessionSidebar`.
- It passes the selected title to the conversation pane.
- It updates one cache entry when the selected chat panel reports a title.
- It does not clear a cached title when switching away from a session.
- It does not invent a durable title or mutate session DTOs.
- It must not fetch transcripts for unselected sessions.

### Conversation Header

The selected conversation header should show:

- temporary title or `New chat`;
- status badge text;
- provider credential label;
- model;
- approval mode;
- `New chat` action;
- `Details` action.

The header should be dense and should not consume the scrollable conversation body.

### Details UI

Move the old selected-session summary into `AgentSessionDetailsDrawer` or an equivalent accessible disclosure.

It should show:

- provider credential;
- model;
- status;
- permission preset;
- approval mode;
- protocol version and streaming capability if present;
- runner tools/model capability counts if present;
- created/updated/ended timestamps in raw or locally formatted text.

The details UI should be closed by default, keyboard reachable, and dismissible.

### Conversation Body

`AgentConversationPane` should render the existing chat and plan review components keyed by `session.id`.

For this slice:

- chat behavior remains in `AgentSessionChatPanel`;
- plan review behavior remains in `AgentOperationPlanReviewPanel`;
- plan review can remain below chat until the action dock slice;
- setup remains hidden while a session is selected;
- switching selected sessions remounts chat/plan state and clears draft/streaming through the existing keyed boundary.

## Test Commands

Use the correct focused Vitest invocation for this repo. Do not use `pnpm --dir web test -- --run ...` because that passes an extra `--` through the script and can start a broader run.

Red/green focused commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-header.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-details-drawer.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts'
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-sidebar.spec.ts'
```

Regression commands:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant'
pnpm --dir web run check:svelte
pnpm --dir web run check:typescript
```

## Slice 2 Edge Cases To Cover

Temporary titles:

- No messages leaves the row/header as `New chat`.
- Assistant-only transcripts do not produce a title.
- User messages with blank/whitespace-only text do not produce a title.
- The first valid user text wins even if later user messages are clearer.
- Multiple text blocks in the first user message are joined in order.
- Non-text blocks in the first user message are ignored.
- Long user text is truncated deterministically to 60 characters after whitespace collapse.
- Newlines and repeated spaces collapse to single spaces.
- A title discovered from a successful send works even if the initial transcript load is still pending.
- Duplicate transcript/send/websocket merges do not publish duplicate title updates.
- Title cache updates only the matching session ID.
- Sidebar search matches a newly discovered temporary title.
- Page load still does not call `getAgentSessionMessages()` for every session.

Conversation pane:

- Selected-session header renders title, status badge, credential, model, and approval mode.
- Header remains usable with very long title/model/credential text.
- `New chat` action calls back to the workspace and clears selection through existing workspace behavior.
- Details UI is closed by default.
- Details UI opens and closes with stable accessible names.
- Details UI displays snapshot values without exposing bearer tokens, runner/internal gateway URLs, runner session IDs, or raw request metadata.
- Selected session no longer shows a persistent full metadata summary card above the chat.
- Chat and plan components receive the selected session and remount on session ID change.
- Switching sessions clears draft text and streaming text through the keyed remount.
- A late title callback from an old selected session must not replace the current header title.
- Transcript load failure still shows the chat-panel error and does not blank the whole conversation pane.
- Plan load failure remains localized to the plan component and does not blank chat/header.

Workspace integration:

- `titleBySessionId` is passed into sidebar rows.
- Selecting a session and loading its transcript updates its sidebar row title.
- Switching away preserves the previously discovered title in the sidebar.
- Creating a new session selects it and keeps its title as `New chat` until a user message is loaded or sent.
- Existing URL selection, fallback selection, and new-chat tests remain green.
- Existing setup disabled-state tests remain green.

Accessibility/responsive:

- Header actions are keyboard reachable buttons.
- Status is text-readable and not color-only.
- The details drawer/disclosure traps or restores focus if implemented as a modal; if implemented as an inline disclosure, focus remains predictable.
- Long title, model, and credential text truncate/wrap without overlapping controls.

---

## Task 1: Pure Temporary Title Helpers

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-workspace-ui.ts`

- [ ] **Step 1: Write failing helper tests**

Add tests for:

- deriving the first valid user text title;
- ignoring assistant messages;
- ignoring blank text blocks;
- ignoring non-text blocks;
- joining multiple text blocks;
- collapsing whitespace/newlines;
- truncating long text deterministically;
- returning `null` or no title when no valid user text exists.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-workspace-ui.spec.ts'
```

Expected: FAIL because the title derivation helper does not exist.

- [ ] **Step 2: Implement helper**

Add a pure helper such as:

```ts
export const deriveAgentSessionTitleFromMessages = (
  messages: AgentMessageResponseDto[],
  maxLength = 60,
): string | null => { ... };
```

Implementation notes:

- Use SDK enum values for role and text block type.
- Treat all whitespace as a single space.
- Return `null` instead of `New chat` so callers can distinguish "no title discovered" from fallback display.
- Keep the helper independent of Svelte stores and components.

Run the same focused helper test. Expected: PASS.

## Task 2: Chat Panel Title Discovery Callback

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Write failing chat-panel tests**

Extend chat-panel tests to cover:

- calls `onTitleDiscovered(session.id, title)` after transcript load finds a valid first user text message;
- does not call the callback for assistant-only or blank transcripts;
- publishes a title when a user message is sent successfully;
- publishes a title when a websocket user message arrives before transcript load resolves;
- does not call the callback repeatedly for the same title after duplicate transcript/websocket merges.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: FAIL because the callback prop does not exist.

- [ ] **Step 2: Implement callback**

Update `AgentSessionChatPanel`:

- add optional prop `onTitleDiscovered?: (sessionId: string, title: string) => void`;
- call the pure helper after message list changes from transcript load, send, or websocket message creation;
- publish only when the derived title is non-null and different from the last published title for this component instance;
- keep existing transcript, merge, send, streaming, and error behavior unchanged.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-chat-panel.spec.ts'
```

Expected: PASS.

## Task 3: Compact Session Header

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-header.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing header tests**

Test:

- title fallback and discovered title rendering;
- status badge rendering for selected session status;
- provider credential, model, and approval mode rendering;
- long title/model/credential elements include stable truncation/wrapping classes;
- `New chat` callback is fired;
- `Details` callback is fired;
- buttons have stable accessible names.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-header.spec.ts'
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement header**

Create `AgentSessionHeader` with props:

- `session`;
- `title`;
- `onNewChat`;
- `onOpenDetails`.

Use existing helper label functions for status and approval mode. Add only the i18n keys needed for `Details` and any new compact labels.

Run the focused header test. Expected: PASS.

## Task 4: Session Details Drawer Or Disclosure

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-session-details-drawer.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-session-details-drawer.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Write failing details tests**

Test:

- closed state renders no details content;
- opening shows provider, model, status, permission preset, approval mode, runner capability summary, and created/updated/ended timestamps;
- missing nullable fields render gracefully;
- close action hides details;
- accessible label/name is stable;
- does not render runner/internal URLs, runner session IDs, bearer tokens, or raw internal metadata objects.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-session-details-drawer.spec.ts'
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement details component**

Create a small drawer, dialog, or inline disclosure that is closed by default from the conversation pane.

Implementation notes:

- Keep it consistent with existing Gallery styling.
- Do not add a full page card around the conversation.
- Keep the snapshot display read-only.
- Avoid exposing raw JSON unless a later explicit debug/details slice asks for it.

Run the focused details test. Expected: PASS.

## Task 5: Conversation Pane Component

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Create: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`

- [ ] **Step 1: Write failing conversation-pane tests**

Use real child components where practical and SDK/websocket mocks already used by assistant tests.

Test:

- renders compact header instead of persistent metadata summary card;
- renders chat and plan review for the selected session;
- passes title discovery callback through to chat panel;
- opens and closes details UI;
- `New chat` callback flows from header;
- keyed session switch remounts chat and plan state so draft/streaming text from the previous session is cleared;
- transcript load error remains localized to chat while header remains visible;
- plan load error remains localized to plan while chat/header remain visible.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-conversation-pane.spec.ts'
```

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement conversation pane**

Create `AgentConversationPane` with props:

- `session`;
- `title`;
- `onNewChat`;
- `onTitleDiscovered`.

Render:

- `AgentSessionHeader`;
- `AgentSessionDetailsDrawer`;
- keyed `AgentSessionChatPanel`;
- keyed `AgentOperationPlanReviewPanel`.

Run the focused conversation-pane test. Expected: PASS.

## Task 6: Workspace Integration

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-assistant-workspace.svelte`
- Modify: `web/src/routes/(user)/assistant/agent-session-sidebar.spec.ts`

- [ ] **Step 1: Write failing workspace integration tests**

Add/update tests for:

- selected transcript first user message updates the selected header title;
- selected transcript first user message updates the matching sidebar row;
- sidebar search finds the newly discovered title;
- title stays cached after switching away and back;
- no transcript API calls happen for unselected sidebar sessions;
- old selected metadata summary heading/card is not rendered persistently;
- existing URL sync and new-chat behavior still pass.

Run:

```bash
pnpm --dir web test --run 'src/routes/(user)/assistant/agent-assistant-workspace.spec.ts' 'src/routes/(user)/assistant/agent-session-sidebar.spec.ts'
```

Expected: FAIL because workspace does not own or pass the title cache and still renders the inline selected-session summary.

- [ ] **Step 2: Integrate conversation pane**

Update `AgentAssistantWorkspace`:

- add `titleBySessionId` state;
- pass `titleBySessionId` into both desktop and mobile sidebars;
- replace inline selected-session summary/chat/plan markup with `AgentConversationPane`;
- update title cache only when `onTitleDiscovered(sessionId, title)` receives a title for an existing local session ID;
- preserve selected session URL sync and new-chat behavior;
- keep setup panel behavior unchanged for no selected session.

Run the focused workspace/sidebar tests. Expected: PASS.

## Task 7: Regression And Cleanup

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
- only expected web/i18n files changed for implementation.

## Implementation Notes

- Keep tests red before implementation for each task.
- Prefer adding helper tests before component tests when a behavior can be pure.
- Do not fetch all transcripts to improve sidebar titles.
- Do not create a durable title field in this slice.
- Keep the old `AgentSessionPageContent` tests either passing unchanged or remove/refactor the component only with explicit test updates.
- If component tests become noisy because real chat/plan children mount, mock only the child components needed for a narrow parent behavior and keep the child components covered by their own focused specs.
