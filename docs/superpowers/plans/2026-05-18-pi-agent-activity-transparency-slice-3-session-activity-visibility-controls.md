# Pi Agent Activity Transparency Slice 3 Session Activity Visibility Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Use TDD for every task: write the failing test first, run it red, implement the smallest fix, then run focused and regression commands.

**Goal:** Add per-session activity preview controls so users can choose `Off`, `Compact`, or `Expanded` for the assistant activity block without hiding required approval, plan-review, applied-plan, streaming, or message surfaces.

**Architecture:** This is a frontend state/control slice. It introduces a small visibility-mode helper, lifts the activity block expansion state from local component state into `AgentConversationPane`, passes the selected mode into `AgentSessionChatPanel`, and adds a compact session-header menu for changing the mode. The chat panel should still derive activity for current-turn tool coverage even when the block is hidden, so `Off` does not bring back technical tool-call cards.

**Tech Stack:** Svelte 5, TypeScript, Vitest, Testing Library, generated `@immich/sdk` DTO types, existing assistant route test patterns, existing Slice 1/2 activity view model and block.

---

## Source Spec

Implements Slice 3 from:

- `docs/superpowers/specs/2026-05-18-pi-agent-activity-transparency-design.md`

Builds on:

- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-1-view-model.md`
- `docs/superpowers/plans/2026-05-18-pi-agent-activity-transparency-slice-2-chat-activity-block.md`
- `web/src/routes/(user)/assistant/agent-activity-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

## Scope

In scope:

- Add a typed activity visibility mode:
  - `off`
  - `compact`
  - `expanded`
- Default each session to `compact` when no valid persisted value exists.
- Persist the mode per session in localStorage.
- Read the mode when a session is mounted or switched.
- Ignore unsupported stored values and fall back to `compact`.
- Handle localStorage read/write failures without breaking chat.
- Listen for same-key `storage` events so another tab changing the same session mode can update this tab without corrupting state.
- Add a compact session-header activity menu with accessible Off/Compact/Expanded choices.
- Wire `Show activity` and `Hide activity` on the block to the same session visibility mode:
  - `Show activity` sets mode to `expanded`.
  - `Hide activity` sets mode to `compact`.
- Pass the selected mode from `AgentConversationPane` to `AgentSessionHeader` and `AgentSessionChatPanel`.
- Keep permission approval cards/action dock visible when mode is `off`.
- Keep plan review and applied-plan cards visible when mode is `off`.
- Keep streaming assistant text and final assistant messages visible in all modes.
- Keep current-turn handled tool-call cards suppressed in all modes so `off` means less activity UI, not more technical logs.
- Restore a simple busy fallback when mode is `off` and Pi is active with no streaming text.
- Add i18n keys for the activity menu.

Out of scope:

- Per-row technical details disclosure. Slice 5 owns this.
- Full historical multi-turn activity anchoring. Slice 6 owns this.
- Explicit persisted backend activity events. Slice 7 owns this if needed.
- User-wide global default preferences.
- Server, runner, OpenAPI, or database changes.
- Replacing permission, plan review, or applied-plan UI.

## Product Decisions For This Slice

- The selected visibility mode is scoped to a session id and persisted as a small local preference.
- `compact` is the rollout default because it provides a calm teaser and matches the spec recommendation.
- The activity block itself becomes controlled by `visibilityMode` instead of owning long-lived expansion state.
- `Off` hides the activity block only. It must not hide approval controls, plan review, applied plans, messages, streamed text, or terminal actions.
- `Off` should not resurrect current-turn standalone tool-call cards. Those are activity logs and would make the UI more technical.
- If activity is `off` while Pi is active, the existing simple busy fallback can render so the user is not left with an idle-looking chat.
- The session-header affordance should be compact and accessible. A small menu is preferred over always-visible segmented controls to avoid cluttering the chat header.

## TDD Commands

Red command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Focused green command:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

Regression commands:

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

No server or runner test commands are required for this slice because there are no backend or runner changes.

## Edge Cases Covered In This Slice

| Spec area         | Case                                       | Slice 3 expectation                                                                                  |
| ----------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Visibility        | No stored preference                       | Mode defaults to `compact` and renders compact teaser while activity exists                          |
| Visibility        | User clicks `Show activity`                | Mode changes to `expanded`; all rows render                                                          |
| Visibility        | User clicks `Hide activity`                | Mode changes to `compact`; compact rows render                                                       |
| Visibility        | Session menu selects `Off`                 | Activity block does not render                                                                       |
| Visibility        | Session menu selects `Compact`             | Activity block renders compact rows                                                                  |
| Visibility        | Session menu selects `Expanded`            | Activity block renders all rows                                                                      |
| Visibility        | Off while Pi is active                     | Activity block is hidden and simple busy fallback can render                                         |
| Required surfaces | Off during pending approval                | Approval card/action dock remains visible and actionable                                             |
| Required surfaces | Off during plan review                     | Plan review remains visible and actionable                                                           |
| Required surfaces | Off after applied plan                     | Applied-plan timeline card remains visible                                                           |
| Duplication       | Off with completed current-turn tool calls | Current-turn standalone tool-call cards remain suppressed                                            |
| Persistence       | Switch sessions                            | Each session loads its own stored mode; no expanded-state leakage                                    |
| Persistence       | Unsupported stored value                   | Falls back to `compact` and does not throw                                                           |
| Persistence       | localStorage throws                        | Falls back to `compact`; UI stays usable                                                             |
| Persistence       | Multiple tabs update same session key      | Storage event can update mode; malformed values cannot corrupt state                                 |
| Accessibility     | Menu control                               | Button has name, popup state, keyboard/click support, and menuitemradio checked state                |
| Accessibility     | Activity toggle focus                      | Show/hide control remains keyboard reachable and does not steal focus from approval or plan controls |

## Edge Cases Deferred To Later Slices

- Per-row `Technical details` expansion and redaction UI.
- Full historical turn anchoring for every old turn.
- Backend activity event persistence and ownership checks.
- Runner explicit activity events for non-tool gaps.
- Final performance/mobile polish across very long transcripts.
- User-wide default mode preference beyond per-session local preference.

## File Structure

Create:

- `web/src/routes/(user)/assistant/agent-activity-visibility-ui.ts`
- `web/src/routes/(user)/assistant/agent-activity-visibility-ui.spec.ts`
- `web/src/routes/(user)/assistant/agent-activity-visibility-menu.svelte`
- `web/src/routes/(user)/assistant/agent-activity-visibility-menu.spec.ts`

Modify:

- `web/src/routes/(user)/assistant/agent-activity-block.svelte`
- `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-header.svelte`
- `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`
- `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`
- `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- `i18n/en.json`

Do not modify:

- `server/src/**`
- `agent-runner/src/**`
- `open-api/**`

---

## Task 1: Add Visibility Helper Red Tests

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-visibility-ui.spec.ts`

- [ ] **Step 1: Write mode parser tests**

Assert:

- `parseAgentActivityVisibilityMode('off') === 'off'`
- `parseAgentActivityVisibilityMode('compact') === 'compact'`
- `parseAgentActivityVisibilityMode('expanded') === 'expanded'`
- `parseAgentActivityVisibilityMode(null) === 'compact'`
- unsupported strings, empty strings, JSON-looking strings, and numbers coerced to strings all fall back to `compact`.

Expected red failure: missing helper module.

- [ ] **Step 2: Write per-session storage-key tests**

Assert:

- `getAgentActivityVisibilityStorageKey('session-a')` and `getAgentActivityVisibilityStorageKey('session-b')` differ.
- key includes a stable assistant namespace such as `gallery.assistant.activityVisibility`.
- raw mode values are not embedded in the key.

- [ ] **Step 3: Write storage read/write tests**

Use a small fake storage object with `getItem`, `setItem`, and `removeItem`.

Assert:

- read returns `compact` when no value exists.
- write persists the selected valid mode under the session-specific key.
- read returns the stored valid mode for that session.
- writing session A does not change session B.
- invalid stored values read as `compact`.

- [ ] **Step 4: Write storage failure tests**

Use a fake storage object whose `getItem`/`setItem` throws.

Assert:

- read returns `compact`.
- write does not throw and returns `false`.
- failures do not mutate caller state.

- [ ] **Step 5: Run the red helper command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts
```

Expected red failure: missing helper module and exports.

---

## Task 2: Implement Visibility Helper

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-visibility-ui.ts`

- [ ] **Step 1: Add public types and constants**

Implement:

```ts
export type AgentActivityVisibilityMode = 'off' | 'compact' | 'expanded';
export const defaultAgentActivityVisibilityMode: AgentActivityVisibilityMode = 'compact';
```

- [ ] **Step 2: Add parser and storage key helpers**

Implement:

```ts
export const parseAgentActivityVisibilityMode = (value: unknown): AgentActivityVisibilityMode => ...
export const getAgentActivityVisibilityStorageKey = (sessionId: string) => ...
```

Use an ASCII localStorage key namespace, for example:

```ts
gallery.assistant.activityVisibility.${sessionId}
```

- [ ] **Step 3: Add safe read/write helpers**

Implement:

```ts
export const readAgentActivityVisibilityMode = (
  sessionId: string,
  storage: Pick<Storage, 'getItem'> | null | undefined = globalThis.localStorage,
) => ...

export const writeAgentActivityVisibilityMode = (
  sessionId: string,
  mode: AgentActivityVisibilityMode,
  storage: Pick<Storage, 'setItem'> | null | undefined = globalThis.localStorage,
) => ...
```

Implementation notes:

- wrap storage access in `try/catch`;
- use parser on read;
- return `true` when a write succeeds and `false` when storage is unavailable or throws;
- no-op safely when storage is unavailable;
- do not import Svelte stores or browser-only modules.

- [ ] **Step 4: Run focused helper tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts
```

---

## Task 3: Add Activity Visibility Menu Red Tests

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-visibility-menu.spec.ts`

- [ ] **Step 1: Add i18n mock keys**

Mock:

- `assistant_activity_visibility`: `Activity preview`
- `assistant_activity_visibility_off`: `Off`
- `assistant_activity_visibility_compact`: `Compact`
- `assistant_activity_visibility_expanded`: `Expanded`
- `assistant_activity_visibility_menu`: `Activity preview options`

- [ ] **Step 2: Write render/accessibility tests**

Render:

```svelte
<AgentActivityVisibilityMenu mode="compact" onModeChange={onModeChange} />
```

Assert:

- trigger is reachable by role `button` with an accessible name containing `Activity preview`.
- button exposes `aria-haspopup="menu"`.
- button exposes `aria-expanded="false"` initially.
- current mode label `Compact` is visible in or near the control.
- menu options are not visible until opened.

- [ ] **Step 3: Write menu option tests**

Open the menu.

Assert:

- menu has accessible label `Activity preview options`.
- each option is a `menuitemradio`.
- current mode has `aria-checked="true"`.
- selecting `Off`, `Compact`, or `Expanded` calls `onModeChange(mode)`.
- selecting an option closes the menu and returns focus to the trigger.

- [ ] **Step 4: Write keyboard tests**

Assert:

- `Escape` closes the menu without changing mode.
- `Enter`/click on the trigger opens the menu.
- `ArrowDown`/`ArrowUp` moves focus between menu items while the menu is open.
- focus remains inside a stable control after selection.

- [ ] **Step 5: Run red menu tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts
```

Expected red failure: missing component.

---

## Task 4: Implement Activity Visibility Menu

**Files:**

- Create: `web/src/routes/(user)/assistant/agent-activity-visibility-menu.svelte`
- Modify: `i18n/en.json`

- [ ] **Step 1: Add component props**

Props:

```ts
interface Props {
  mode: AgentActivityVisibilityMode;
  onModeChange: (mode: AgentActivityVisibilityMode) => void;
}
```

- [ ] **Step 2: Render compact header control**

Use a small button/dropdown menu:

- trigger button:
  - accessible name `Activity preview`;
  - shows current mode label;
  - `aria-haspopup="menu"`;
  - `aria-expanded`.
- menu:
  - `role="menu"`;
  - labelled `Activity preview options`;
  - three `role="menuitemradio"` controls.

Keep styling consistent with the existing assistant header buttons. Do not add a large panel or explanatory text.

- [ ] **Step 3: Implement interactions**

Behavior:

- trigger toggles the menu;
- selecting an option calls `onModeChange(mode)`;
- selecting closes the menu;
- `Escape` closes the menu;
- focus returns to the trigger after selection/close.

- [ ] **Step 4: Add i18n keys**

Add to `i18n/en.json`:

```json
"assistant_activity_visibility": "Activity preview",
"assistant_activity_visibility_compact": "Compact",
"assistant_activity_visibility_expanded": "Expanded",
"assistant_activity_visibility_menu": "Activity preview options",
"assistant_activity_visibility_off": "Off"
```

- [ ] **Step 5: Run menu tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts
```

---

## Task 5: Make `AgentActivityBlock` Controlled By Visibility Mode

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-activity-block.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-activity-block.svelte`

- [ ] **Step 1: Add red tests for controlled compact/expanded mode**

Extend `agent-activity-block.spec.ts`:

- render with `visibilityMode="compact"`;
- assert compact limit applies and `Show activity` is visible;
- render with `visibilityMode="expanded"`;
- assert all rows render and `Hide activity` is visible;
- rerender from `compact` to `expanded` and assert the component follows the prop.

- [ ] **Step 2: Add red tests for show/hide callbacks**

Assert:

- clicking `Show activity` calls `onVisibilityModeChange('expanded')`;
- clicking `Hide activity` calls `onVisibilityModeChange('compact')`;
- component does not mutate hidden local expansion state that can disagree with parent props.

- [ ] **Step 3: Preserve existing behavior through defaults**

Keep existing tests useful by defaulting to `compact` when no prop is passed.

Proposed props:

```ts
interface Props {
  model: AgentActivityModel;
  compactLimit?: number;
  visibilityMode?: Extract<AgentActivityVisibilityMode, 'compact' | 'expanded'>;
  onVisibilityModeChange?: (mode: Extract<AgentActivityVisibilityMode, 'compact' | 'expanded'>) => void;
}
```

The block should not accept/render `off`; parents omit the block when mode is off.

- [ ] **Step 4: Run block tests red**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

- [ ] **Step 5: Implement controlled mode**

Implementation notes:

- replace local `expanded = $state(false)` with derived `isExpanded = visibilityMode === 'expanded'`;
- toggle callback maps to `expanded`/`compact`;
- keep focus behavior on the toggle;
- keep empty model behavior unchanged;
- keep technical details hidden.

- [ ] **Step 6: Run block tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-block.spec.ts
```

---

## Task 6: Wire Visibility Through Chat Panel

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-chat-panel.svelte`

- [ ] **Step 1: Add red chat-panel tests for mode rendering**

Extend the i18n mock with menu keys only if needed by child components.

Add tests:

- default/`compact` mode renders one compact activity block;
- `expanded` mode renders all activity rows and `Hide activity`;
- clicking `Show activity` calls `onActivityVisibilityModeChange('expanded')`;
- clicking `Hide activity` calls `onActivityVisibilityModeChange('compact')`;
- `off` mode renders no activity block.

- [ ] **Step 2: Add red chat-panel tests for required surfaces in `off` mode**

Assert:

- pending approval action dock still renders when mode is `off`;
- plan review surface stays separate by rendering an `actionDock` snippet with a `Plan review` stand-in while mode is `off`;
- applied-plan card still renders when mode is `off`;
- streaming assistant text still renders when mode is `off`;
- final assistant response still renders when mode is `off`.

Use the existing `actionDock` snippet prop for approval-card visibility tests rather than changing action-dock internals.

- [ ] **Step 3: Add red chat-panel tests for covered tool-call suppression in `off` mode**

Use current-turn completed tool calls and mode `off`.

Assert:

- no `Activity summary`/`Pi is working` article renders;
- current-turn standalone handled tool-call card does not render;
- historical tool calls before the latest user message still render as legacy standalone cards until Slice 6 hardens historical anchoring.

- [ ] **Step 4: Add red busy-fallback tests for `off` mode**

Assert:

- when mode is `off`, `isResponsePending` is true, and no streaming text exists, the simple busy fallback appears;
- when mode is `compact` or `expanded`, the activity block covers pending work and the busy fallback does not duplicate.

- [ ] **Step 5: Run chat-panel red tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

- [ ] **Step 6: Implement chat-panel props and rendering**

Add props:

```ts
activityVisibilityMode?: AgentActivityVisibilityMode;
onActivityVisibilityModeChange?: (mode: AgentActivityVisibilityMode) => void;
```

Default:

```ts
activityVisibilityMode = 'compact';
```

Implementation notes:

- always build `activityModel` for current-turn coverage;
- always compute `coveredToolCallIds` from the model;
- include the timeline activity item only when `activityVisibilityMode !== 'off'`;
- keep filtering covered current-turn tool calls regardless of visibility mode;
- pass `visibilityMode={activityVisibilityMode === 'expanded' ? 'expanded' : 'compact'}` into `AgentActivityBlock`;
- map block callback back to `onActivityVisibilityModeChange`;
- update `showAssistantBusyIndicator` so mode `off` can show the simple fallback while compact/expanded use the block.

- [ ] **Step 7: Run chat-panel tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts
```

---

## Task 7: Wire Visibility Menu Into Session Header

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-session-header.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-session-header.svelte`

- [ ] **Step 1: Add header red tests**

Extend i18n mock with:

- `assistant_activity_visibility`
- `assistant_activity_visibility_off`
- `assistant_activity_visibility_compact`
- `assistant_activity_visibility_expanded`
- `assistant_activity_visibility_menu`

Add tests:

- header renders the activity visibility control when mode and callback props are provided;
- header does not render the control when callback props are omitted, preserving compatibility;
- selecting `Off`/`Compact`/`Expanded` forwards the selected mode;
- control remains bounded and does not displace title/action buttons.

- [ ] **Step 2: Run header red tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-header.spec.ts
```

- [ ] **Step 3: Implement header props and component**

Add optional props:

```ts
activityVisibilityMode?: AgentActivityVisibilityMode;
onActivityVisibilityModeChange?: (mode: AgentActivityVisibilityMode) => void;
```

Render `<AgentActivityVisibilityMenu />` in the header actions before `Details` when both props are present.

Keep layout rules:

- title/meta stay `min-w-0` and truncate;
- header actions stay compact;
- no explanatory paragraph in the header.

- [ ] **Step 4: Run header tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-session-header.spec.ts
```

---

## Task 8: Persist And Pass Mode From Conversation Pane

**Files:**

- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.spec.ts`
- Modify: `web/src/routes/(user)/assistant/agent-conversation-pane.svelte`

- [ ] **Step 1: Add conversation-pane red tests for default mode**

Assert:

- with no localStorage value, a running session with activity renders compact activity;
- header menu shows `Compact`;
- localStorage is not written just by reading the default.

- [ ] **Step 2: Add red tests for menu changes**

Assert:

- selecting `Expanded` from the header menu writes `expanded` under the current session key;
- chat panel expands the block after selection;
- selecting `Off` writes `off`;
- chat panel hides the activity block but keeps required surfaces;
- header menu remains visible while mode is `Off`;
- selecting `Compact` after `Off` writes `compact` and restores the compact activity block.

- [ ] **Step 3: Add red tests for session switching**

Render session A with stored `expanded`, then rerender session B with no stored value.

Assert:

- session A shows expanded mode;
- session B falls back to compact;
- switching back to A restores expanded;
- no state leaks between sessions.

- [ ] **Step 4: Add red tests for malformed storage and storage events**

Assert:

- unsupported stored value falls back to compact;
- localStorage throwing on read does not break render;
- localStorage throwing on write still updates in-memory mode for the current tab so the UI responds, but does not throw;
- dispatching a `storage` event for the current session key updates the visible mode;
- dispatching a `storage` event for another session key is ignored;
- dispatching a malformed storage value falls back to compact.

- [ ] **Step 5: Run conversation-pane red tests**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 6: Implement conversation-pane state**

Implementation notes:

- import helper methods from `agent-activity-visibility-ui.ts`;
- use `$state<AgentActivityVisibilityMode>('compact')`;
- on session id changes, read the stored mode for that session;
- when user changes mode, update state and attempt to persist;
- pass mode/callback to `AgentSessionHeader`;
- pass mode/callback to `AgentSessionChatPanel`;
- register a `storage` listener on mount/effect and clean it up on destroy;
- ignore events whose key is not the selected session's visibility key;
- parse event `newValue` with the safe parser.

- [ ] **Step 7: Run conversation-pane tests green**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

---

## Task 9: Focused Regression

- [ ] **Step 1: Run focused Slice 3 command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 2: Run assistant regression command**

```bash
pnpm --dir web exec vitest run src/routes/\(user\)/assistant/agent-activity-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-block.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-ui.spec.ts src/routes/\(user\)/assistant/agent-activity-visibility-menu.spec.ts src/routes/\(user\)/assistant/agent-tool-approval-ui.spec.ts src/routes/\(user\)/assistant/agent-session-header.spec.ts src/routes/\(user\)/assistant/agent-session-chat-panel.spec.ts src/routes/\(user\)/assistant/agent-session-action-dock.spec.ts src/routes/\(user\)/assistant/agent-conversation-pane.spec.ts
```

- [ ] **Step 3: Run static checks**

```bash
pnpm --dir web run check:typescript
pnpm --dir web run check:svelte
git diff --check
```

- [ ] **Step 4: Manual sanity check**

If a dev server is already running or cheap to start, manually verify:

- default session shows compact activity;
- header menu can set Expanded and Off;
- Off hides activity but not approval/plan UI;
- switching sessions restores per-session choices.

Do not require Docker, a real LLM provider, or one-click provisioning for automated validation.
