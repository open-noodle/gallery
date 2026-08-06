# Activity Timeline — Slice 4: Remove the old surface + header revert

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the dead activity-block surface (block component, visibility modes/persistence, the ⋯ menu), revert the session header to a plain Details icon-pill, and prune dead i18n keys. Spec: `docs/superpowers/specs/2026-06-10-assistant-activity-timeline-design.md` ("Removed", Slice 4).

**Approach:** Deletion slices live or die by inventory accuracy. Every removal below starts with a grep; if a grep shows a consumer this plan didn't anticipate, STOP and report BLOCKED with the hit (do not silently keep or delete).

**Working dir:** `web/` unless noted. Bash: `export PATH="$HOME/.local/share/mise/shims:$PATH"`, QUOTE parenthesized paths.

---

### Task 1: Header revert — ⋯ menu → Details icon-pill

**Files:** Modify `web/src/routes/(user)/assistant/agent-session-header.svelte` + `agent-session-header.spec.ts`, `web/src/routes/(user)/assistant/agent-conversation-pane.svelte` + `agent-conversation-pane.spec.ts`. Delete `agent-activity-visibility-menu.svelte` + `agent-activity-visibility-menu.spec.ts` + `agent-activity-visibility-ui.ts` (+ its spec if one exists).

- [ ] **Step 1 — failing tests first.** In `agent-session-header.spec.ts`: replace the menu-driven tests (open menu → Details, mode radio tests) with: `'opens details from the header pill'` — `await user.click(screen.getByRole('button', { name: 'Details' }))` → `onOpenDetails` called; `'renders pill-shaped header actions'` — the Details button className contains `rounded-full`. Remove `activityVisibilityMode`/`onActivityVisibilityModeChange` from the spec's render props and i18n mock entries that are now dead (`assistant_session_menu`, `assistant_activity_visibility*`). Run → red (menu still renders; Details button name differs).
- [ ] **Step 2 — implement header:** in `agent-session-header.svelte` remove the `AgentActivityVisibilityMenu` import/usage and the `activityVisibilityMode`/`onActivityVisibilityModeChange` props; render instead:

```svelte
<button
  type="button"
  class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-neutral-300 dark:hover:bg-gray-800"
  aria-label={$t('assistant_details')}
  title={$t('assistant_details')}
  onclick={onOpenDetails}
>
  <Icon icon={mdiInformationOutline} size="18" />
</button>
```

(`Icon` may already be imported; `mdiInformationOutline` from `@mdi/js`.)

- [ ] **Step 3 — pane:** in `agent-conversation-pane.svelte` remove: the `activityVisibilityMode` `$state`, `setActivityVisibilityMode`, the `readAgentActivityVisibilityMode`/`writeAgentActivityVisibilityMode` import/usage, and the two props passed to header and chat panel. Update `agent-conversation-pane.spec.ts` accordingly (its visibility-persistence tests are deleted; Details-forwarding test now goes through the pill).
- [ ] **Step 4 — chat panel:** remove the retained-but-unused `activityVisibilityMode`/`onActivityVisibilityModeChange` props and their `void`/`_` suppressions from `agent-session-chat-panel.svelte`; fix its spec if it passed them.
- [ ] **Step 5 — delete** `agent-activity-visibility-menu.svelte`, its spec, and `agent-activity-visibility-ui.ts` (+spec). Inventory first: `rg -l "agent-activity-visibility" web/src` must list ONLY the files being modified/deleted in this task.
- [ ] **Step 6 — green:** `pnpm test -- --run "src/routes/(user)/assistant"` all pass. Commit: `feat(assistant): header reverts to a Details pill; visibility modes removed`.

### Task 2: Delete the activity block + thin the old model module

**Files:** Delete `web/src/routes/(user)/assistant/agent-activity-block.svelte` (+ spec if exists). Modify/thin `agent-activity-ui.ts` and `agent-session-activity-turns-ui.ts` (+ their specs).

- [ ] **Step 1 — inventory (paste results in report):**
  - `rg -l "agent-activity-block" web/src` → must be empty after Slice 3 except the file itself (+spec).
  - `rg -n "from './agent-activity-ui'" web/src` and `rg -n "agent-activity-ui" web/src` → list every remaining consumer and which exports they use.
  - `rg -n "buildAgentSessionActivityTurns|AgentSessionActivityTurn" web/src` → who still uses the OLD turn builder (Slice 3 removed it from the panel; the details drawer or others may use it — check).
- [ ] **Step 2 — failing state via deletion plan:** based on the inventory: delete `agent-activity-block.svelte` (+spec). For `agent-activity-ui.ts`: keep ONLY exports with remaining consumers (expected: the `AgentActivityEvent` type used by `agent-session-activity-turns-ui.ts` and the Slice-2 builder; possibly `dedupeActivityEvents`); move small survivors into `agent-session-activity-turns-ui.ts` if that empties the file, then delete it + its spec, updating the import in `agent-session-activity-turns-ui.ts` (which re-exports `AgentActivityEvent`) and any other importer. If `buildAgentSessionActivityTurns` itself has NO remaining consumers, delete it and its tests too, keeping only the anchor/membership helpers + types the Slice-2 builder imports. If it HAS consumers (e.g. details drawer), keep it working — thin only what's dead.
- [ ] **Step 3 — green:** full assistant suite passes; `rg -n "agent-activity-block|AgentActivityModel" web/src` returns nothing (or only intentionally-kept code, justified in the report).
- [ ] **Step 4 — commit:** `feat(assistant): delete the legacy activity block and dead activity-model code`.

### Task 3: i18n prune + final gates

**Files:** `i18n/en.json`, any spec i18n mock maps still naming dead keys.

- [ ] **Step 1 — for each candidate key, grep before deleting** (`rg -n "<key>" web/src` — delete from `en.json` ONLY on zero hits): `assistant_activity_visibility`, `assistant_activity_visibility_menu`, `assistant_activity_visibility_compact`, `assistant_activity_visibility_expanded`, `assistant_activity_visibility_off`, `assistant_session_menu`, `assistant_busy_ascii`, plus every `assistant_activity_*` key that belonged to the deleted block (`rg -o "assistant_activity_[a-z_]+" i18n/en.json | sort -u` then grep each against web/src). Report the kept-vs-deleted list.
- [ ] **Step 2:** `pnpm --filter immich-i18n format:fix` — only `en.json` changes.
- [ ] **Step 3 — final gates (whole feature):**
  - `cd web && pnpm test -- --run "src/routes/(user)/assistant"` → green.
  - `cd server && pnpm test -- --run src/services/agent-session-activity-event.service.spec.ts src/services/agent-runner.service.spec.ts src/services/agent-session.service.spec.ts` → green.
  - From repo root: `make check-web` → 0 errors; `cd server && pnpm exec tsc --noEmit` → clean.
  - `pnpm exec prettier --check` on every file touched in this slice; `pnpm exec eslint --max-warnings 0` on every touched ts/svelte file.
- [ ] **Step 4 — commit:** `chore(assistant): prune dead activity i18n keys`.

---

## Self-Review

**Spec coverage:** "Removed" section fully executed (block, modes+persistence, menu→Details pill); header spec asserts pill + Close session; i18n hygiene; full-suite + check-web gates as the slice gate. The grep-before-delete discipline guards the one real risk (hidden consumers of `agent-activity-ui.ts`).
**Placeholders:** Task 2 is inventory-driven by design — the decision table (keep-if-consumed / delete-if-dead / BLOCKED-if-surprising) is explicit rather than pre-resolved, because import graphs drift; everything actionable is specified.
**Type consistency:** no new types; deletions only plus one button.
