# Face Cleanup UX Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the face cleanup console explain itself — a permanent intro on the landing page, self-describing bulk actions, and one shared dock + help modal across both review modes, fully translated into all nine fork locales.

**Architecture:** A pure-data action registry (`face-actions.ts`) becomes the single source of truth for every action's label, tooltip, explanation, glyph, colour and severity. Two presentation components consume it — `FaceReviewDock.svelte` (the whole footer dock, both halves) and `FaceActionsHelpModal.svelte` (one modal rendering whichever subset a mode passes). The guided and manual pages keep their own view-models and summary content but delegate the dock and the modal.

**Tech Stack:** SvelteKit, Svelte 5 runes (`$state`, `$derived`, `$props`), TypeScript strict, Tailwind CSS 4, `@immich/ui`, `svelte-i18n`, Vitest + `@testing-library/svelte` + happy-dom, Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-07-31-face-cleanup-ux-unification-design.md`. Section references below (§3.1, R4, D11, …) point at it.

**Worktree:** `/Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase`, branch `feat/face-review-unified`. All paths below are relative to the repo root; all commands run from `web/` unless stated.

## Global Constraints

- **Run tests with `pnpm exec vitest run <path>`, never `pnpm test -- --run <path>`** — the latter silently drops the path filter and runs the whole suite.
- **Prettier: 120 char line width, single quotes, trailing commas, semicolons.** ESLint runs `--max-warnings 0` — a lint error is a task failure, so run `pnpm exec eslint <paths>` from `web/` before committing, not just the tests.
- **Formatting `web/` files must run from `web/`:** `cd web && pnpm exec prettier --write <paths>`. Running `npx prettier` from the worktree ROOT fails on `web/` sources — the root has no `@trivago/prettier-plugin-sort-imports`, which `web/`'s config requires. Root-level `npx prettier --write` still works for `i18n/` and `docs/`.
- **No relative imports across `lib`/`routes` boundaries** — use the `$lib/` alias.
- **Testids split into two layers, and only the first is renamed.**
  - **Dock chrome** — the shared component's own furniture — is **normalised** to one scheme used by both modes, hardcoded in `FaceReviewDock` (there is no `testIds` prop): `face-dock`, `face-bulk-bar`, `face-bulk-clear`, `face-bulk-help`, `face-bulk-hint`. This replaces guided's `dock`/`face-bulk-bar`/`clear`/`bulk-help` and manual's `manual-review-dock`/`face-bulk-bar`/`manual-review-bulk-clear`.
  - **Action testids are preserved verbatim** — `bulk-stay`, `bulk-lock`, `bulk-other`, `bulk-unknown`, `bulk-detach`, `manual-review-bulk-move`, `-lock`, `-unknown`, `-detach`, `-unmark`. They identify _which action_, not which dock, and are passed per-page. `bulk-owner` is the one addition.
  - Grid-header ids (`manual-review-help-open`, `manual-review-clear-selection`, `banner-help`) are not dock chrome and do not change.
- **The e2e suite changes by exactly one line.** `e2e/src/specs/web/face-cleanup.e2e-spec.ts:528` (`page.locator('[data-testid="dock"]')` → `face-dock`) is the **only** permitted edit to `e2e/`. Every action locator it drives must still pass untouched — that is what proves the dock merge moved nothing. If a second e2e line needs changing, stop and escalate.
- **Test-driven, strictly, in every task including the refactors.** No test is written after the code it covers, and every test is observed failing for the right reason before the implementation lands. Where a refactor's replacement values are identical to the originals (Task 3), the test is proven to have teeth by landing a deliberately wrong implementation first, watching it go red, then correcting it — the wrong version is never committed.
- **Two opposite i18n test harnesses.** Page specs (`page.spec.ts`) mock `$t` to echo the **key** and assert on key names. Component specs register the **real `en.json`** and assert on **English text**. Never mix them within a file.
- **Any spec rendering a bits-ui `Modal` needs the scroll-lock drain:** `afterEach(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });`
- **The web vitest config sets no `clearMocks`** — reset mock call history explicitly in `beforeEach` where a test asserts on call counts.
- **i18n keys live under the `admin` object in `i18n/en.json`, alphabetically sorted.** Prettier enforces formatting; sort order is by hand. `$t` keys are therefore `admin.face_cleanup_…`.
- **The nine fork locales are exactly `de es fr it nl pl ru zh_Hans zh_Hant`** (`web/src/lib/i18n/fork-string-parity.spec.ts:20`). Partial coverage is a red build, not a smaller deliverable.
- **ICU argument names (`{action}`, `{effect}`) are never translated** — translating one renders literal braces to the user.
- **Commit after every task.** No `Co-Authored-By` or `Generated with` trailers.

---

## File Structure

| File                                                                                             | Responsibility                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `web/src/lib/components/face-cleanup/face-actions.ts`                                            | **Create.** Pure registry: id → label/tip/body/effect keys, glyph, swatch, tone. Mode-aware key resolvers. No Svelte, no i18n calls. |
| `web/src/lib/components/face-cleanup/face-actions.spec.ts`                                       | **Create.** Registry unit tests (R1–R11).                                                                                            |
| `web/src/lib/components/face-cleanup/FaceReviewDock.svelte`                                      | **Create.** The footer dock: summary↔selected swap, action buttons, hover popover, hint row.                                         |
| `web/src/lib/components/face-cleanup/FaceReviewDock.spec.ts`                                     | **Create.** Dock component tests (D1–D28).                                                                                           |
| `web/src/lib/components/face-cleanup/FaceActionsHelpModal.svelte`                                | **Create.** One modal, renders a registry subset for a mode.                                                                         |
| `web/src/lib/components/face-cleanup/FaceActionsHelpModal.spec.ts`                               | **Create.** Merged modal tests (H1–H13), carrying over every assertion from both deleted specs.                                      |
| `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts`                                  | **Modify.** `STATE_COLOR`/`STATE_ICON` derived from the registry instead of declared inline.                                         |
| `web/src/routes/admin/face-cleanup/people/[personId]/manual-review.svelte.ts`                    | **Modify.** `MANUAL_STATE_*` derived from the registry.                                                                              |
| `web/src/routes/admin/face-cleanup/[personId]/+page.svelte`                                      | **Modify.** Dock + modal wiring; bulk-bar markup removed.                                                                            |
| `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte`                               | **Modify.** Same, plus a new in-bar help launcher.                                                                                   |
| `web/src/routes/admin/face-cleanup/+page.svelte`                                                 | **Modify.** Always-visible intro block.                                                                                              |
| `web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.svelte` + `.spec.ts`              | **Delete** (Task 6).                                                                                                                 |
| `web/src/routes/admin/face-cleanup/people/[personId]/ManualActionsHelpModal.svelte` + `.spec.ts` | **Delete** (Task 6).                                                                                                                 |
| `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`                                            | **Create.** All-nine presence, leftover-key absence, reworded-label shape (I3b, I6, I7).                                             |
| `i18n/en.json` + nine locale files                                                               | **Modify.** 17 new keys, 3 reworded values, 4 removals.                                                                              |

**Task order is chosen so every commit is green.** New keys land before the code that reads them; the three reworded English values land together with the one existing spec that asserts them; the four dead keys are removed only after their last reference is gone.

---

### Task 1: Add the new i18n keys and reword the three labels

**Files:**

- Modify: `i18n/en.json` (the `admin` object)
- Modify: `web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts:41`

**Interfaces:**

- Consumes: nothing.
- Produces: 17 new `admin.face_cleanup_*` keys, listed below, that Tasks 2–8 reference. Three existing keys change value: `face_cleanup_review_bulk_owner`, `…_lock`, `…_other`.

Only `ActionsHelpModal.spec.ts:41` asserts the old English labels, so it changes here. Page specs echo keys and are unaffected; e2e targets testids and is unaffected.

- [ ] **Step 1: Run the one spec that will break, to see it green first**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts'
```

Expected: PASS (8 tests). This is the baseline — it must be green before you change en.json, so you know the failure in Step 3 is yours.

- [ ] **Step 2: Add the 17 new keys to `i18n/en.json`**

Insert into the `admin` object in alphabetical order. The insertion points, so you don't have to guess:
`face_cleanup_action_*` goes between `face_cleanup` (`:133`) and `face_cleanup_advanced` (`:134`);
`face_cleanup_intro_*` after `face_cleanup_faces`; `face_cleanup_review_bulk_hint_*` between
`face_cleanup_review_bulk_detach` and `face_cleanup_review_bulk_lock`.

```json
    "face_cleanup_action_detach_tip": "Not real faces at all. Irreversible — the crop is retired for good.",
    "face_cleanup_action_keep_tip": "The default. An untouched face is left exactly as it is.",
    "face_cleanup_action_lock_tip": "Pin these here permanently, so no future scan can flag them.",
    "face_cleanup_action_other_tip": "Pick who these belong to — anyone in the library, or a new person.",
    "face_cleanup_action_owner_tip": "Move these to the person the scan thinks they actually are.",
    "face_cleanup_action_stay_tip": "These really are this person — decline the scan's suggestion.",
    "face_cleanup_action_unknown_tip": "Real faces, but not this person, and you can't name them.",
    "face_cleanup_action_unmark_tip": "Undo — return the selection to untouched.",
    "face_cleanup_intro_actions_body": "Send a face to the person it really belongs to (or a brand-new one), park it as an unknown person, keep it where it is, lock it so no future scan questions it again, or drop it if it isn't a real face at all.",
    "face_cleanup_intro_actions_title": "Every face is yours to route",
    "face_cleanup_intro_lead": "Face recognition sorts detected faces into people on its own, and it is deliberately cautious about it: a wrong assignment is far harder to untangle later than one it never made. So it leaves the doubtful calls alone rather than guessing. This page is where you make them.",
    "face_cleanup_intro_manual_body": "Manual review skips the scan entirely: pick any person and go through their faces yourself, with the same actions. Nothing is written until you press Apply.",
    "face_cleanup_intro_manual_title": "Or audit anyone, any time",
    "face_cleanup_intro_scan_body": "Guided cleanup re-checks the library and flags faces that resemble someone else more than the person they're filed under. It changes nothing — it just brings you the shortlist.",
    "face_cleanup_intro_scan_title": "A scan finds the doubtful calls",
    "face_cleanup_review_bulk_hint_default": "Nothing is written until you press Apply. Hover an action to see what it will do.",
    "face_cleanup_review_bulk_hint_effect": "{action} · On apply: {effect}",
```

- [ ] **Step 3: Reword the three labels in `i18n/en.json`**

```json
    "face_cleanup_review_bulk_lock": "Confirm & lock",
    "face_cleanup_review_bulk_other": "Move to person…",
    "face_cleanup_review_bulk_owner": "Move to owner",
```

- [ ] **Step 4: Run the modal spec to verify it now fails**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts'
```

Expected: FAIL — `names all six actions, reusing the bulk-bar labels` cannot find `→ Owner`.

- [ ] **Step 5: Update the expected labels in `ActionsHelpModal.spec.ts:41`**

```ts
for (const name of [
  'Move to owner',
  'Keep here',
  'Confirm & lock',
  'Move to person…',
  'Unknown person',
  'Not a face',
]) {
  expect(screen.getByTestId('help-actions')).toHaveTextContent(name);
}
```

- [ ] **Step 6: Run the full face-cleanup suite to confirm nothing else asserted the old labels**

```bash
cd web && pnpm exec vitest run src/routes/admin/face-cleanup src/lib/i18n
```

Expected: PASS. If anything else fails, it asserted old English — update it the same way.

- [ ] **Step 7: Format and commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
npx prettier --write i18n/en.json 'web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts'
git add i18n/en.json 'web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts'
git commit -m "i18n(face-cleanup): add intro, tooltip and hint strings; harmonise bulk labels"
```

---

### Task 2: The action registry

**Files:**

- Create: `web/src/lib/components/face-cleanup/face-actions.ts`
- Create: `web/src/lib/components/face-cleanup/face-actions.spec.ts`

**Interfaces:**

- Consumes: the keys added in Task 1.
- Produces — every later task imports from `$lib/components/face-cleanup/face-actions`:
  - `type FaceActionId = 'owner' | 'stay' | 'lock' | 'other' | 'unknown' | 'detach' | 'keep' | 'unmark'`
  - `type FaceReviewMode = 'guided' | 'manual'`
  - `interface FaceActionMeta` (fields below)
  - `const FACE_ACTIONS: Readonly<Record<FaceActionId, FaceActionMeta>>`
  - `function bodyKeyFor(id: FaceActionId, mode: FaceReviewMode): string`
  - `function effectKeyFor(id: FaceActionId, mode: FaceReviewMode): string`
  - `const GUIDED_STATE_IDS: readonly ['owner', 'other', 'stay', 'lock', 'detach', 'unknown']`

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/face-cleanup/face-actions.spec.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  bodyKeyFor,
  effectKeyFor,
  FACE_ACTIONS,
  GUIDED_STATE_IDS,
  type FaceActionId,
  type FaceReviewMode,
} from './face-actions';

// The registry is the single source of truth behind the bulk-bar buttons, their hover copy and the help
// modal. These tests pin the two things a merge like this silently breaks: that no action lost its glyph,
// and that the actions whose explanation DIFFERS per mode still resolve to the two different keys they
// used before the merge (spec §3.1 "Mode-dependent copy").

const ALL_IDS: FaceActionId[] = ['owner', 'stay', 'lock', 'other', 'unknown', 'detach', 'keep', 'unmark'];
const MODES: FaceReviewMode[] = ['guided', 'manual'];

const en = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '../i18n/en.json'), 'utf8')) as {
  admin: Record<string, string>;
};

const existsInEn = (dottedKey: string) => Object.hasOwn(en.admin, dottedKey.replace(/^admin\./, ''));

describe('FACE_ACTIONS registry', () => {
  // R1
  it('has an entry for every action id, so a new id cannot be added without its meta', () => {
    expect(Object.keys(FACE_ACTIONS).sort()).toEqual([...ALL_IDS].sort());
  });

  // R2
  it('gives every action its own label, tip, body and effect — no copy-pasted explanations', () => {
    const labels = ALL_IDS.map((id) => FACE_ACTIONS[id].labelKey);
    const tips = ALL_IDS.map((id) => FACE_ACTIONS[id].tipKey);
    expect(new Set(labels).size).toBe(ALL_IDS.length);
    expect(new Set(tips).size).toBe(ALL_IDS.length);

    for (const mode of MODES) {
      const bodies = ALL_IDS.map((id) => bodyKeyFor(id, mode));
      const effects = ALL_IDS.map((id) => effectKeyFor(id, mode));
      expect(new Set(bodies).size).toBe(ALL_IDS.length);
      expect(new Set(effects).size).toBe(ALL_IDS.length);
    }
  });

  // R3 — both arms of every mode-dependent key, not just the one a given mode happens to pick.
  it('names only keys that exist in en.json, in both modes', () => {
    for (const id of ALL_IDS) {
      expect(existsInEn(FACE_ACTIONS[id].labelKey), `${id}.labelKey`).toBe(true);
      expect(existsInEn(FACE_ACTIONS[id].tipKey), `${id}.tipKey`).toBe(true);
      for (const mode of MODES) {
        expect(existsInEn(bodyKeyFor(id, mode)), `${id}.body[${mode}]`).toBe(true);
        expect(existsInEn(effectKeyFor(id, mode)), `${id}.effect[${mode}]`).toBe(true);
      }
    }
  });

  // R4 — the F2 split. A button glyph is not a tile state, and the two absences do not coincide.
  it('gives every bar action a glyph (including unmark) and withholds a swatch only from keep and unmark', () => {
    for (const id of ALL_IDS.filter((candidate) => candidate !== 'keep')) {
      expect(FACE_ACTIONS[id].buttonIcon, `${id} must have a button glyph`).toBeTruthy();
    }
    expect(FACE_ACTIONS.keep.buttonIcon).toBeUndefined();

    const withoutSwatch = ALL_IDS.filter((id) => FACE_ACTIONS[id].swatchColor === undefined);
    expect(withoutSwatch.sort()).toEqual(['keep', 'unmark']);
  });

  // R5
  it('marks only the irreversible action as dangerous', () => {
    const dangerous = ALL_IDS.filter((id) => FACE_ACTIONS[id].tone === 'danger');
    expect(dangerous).toEqual(['detach']);
  });

  // R6 — manual's "Move to…" button IS `other`; there is no separate move id.
  it('has no separate move id, so both modes render one label for moving a face to a chosen person', () => {
    expect(Object.keys(FACE_ACTIONS)).not.toContain('move');
    expect(FACE_ACTIONS.other.labelKey).toBe('admin.face_cleanup_review_bulk_other');
  });

  // R7 — the whole point of ModalKey. Each arm pinned to the key that mode used before the merge.
  it('resolves the mode-specific explanations to the exact keys each mode used before the merge', () => {
    expect(bodyKeyFor('other', 'guided')).toBe('admin.face_cleanup_review_help_other_body');
    expect(bodyKeyFor('other', 'manual')).toBe('admin.face_cleanup_manual_review_help_move_body');

    expect(effectKeyFor('other', 'guided')).toBe('admin.face_cleanup_review_help_other_effect');
    expect(effectKeyFor('other', 'manual')).toBe('admin.face_cleanup_manual_review_help_move_effect');

    expect(bodyKeyFor('lock', 'guided')).toBe('admin.face_cleanup_review_help_lock_body');
    expect(bodyKeyFor('lock', 'manual')).toBe('admin.face_cleanup_manual_review_help_lock_body');
  });

  // R8 — the merge must not split what was already shared.
  it('keeps the shared explanations shared across both modes', () => {
    for (const id of ['unknown', 'detach'] as const) {
      expect(bodyKeyFor(id, 'guided')).toBe(bodyKeyFor(id, 'manual'));
      expect(effectKeyFor(id, 'guided')).toBe(effectKeyFor(id, 'manual'));
    }
    expect(effectKeyFor('lock', 'guided')).toBe(effectKeyFor('lock', 'manual'));
  });

  it('lists exactly the six guided tile states', () => {
    expect([...GUIDED_STATE_IDS].sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);
  });
});
```

R11 (no two actions share a `testId`) is **not** here: the registry holds no testids — they live in each page's
`DockAction` list. It is asserted in Tasks 6 and 7, where those lists exist.

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/face-actions.spec.ts
```

Expected: FAIL — `Failed to resolve import "./face-actions"`.

- [ ] **Step 3: Write the registry**

Create `web/src/lib/components/face-cleanup/face-actions.ts`:

```ts
import {
  mdiAccountArrowRight,
  mdiAccountQuestion,
  mdiArrowRightBold,
  mdiImageOff,
  mdiLock,
  mdiPin,
  mdiUndo,
} from '@mdi/js';

/**
 * The single source of truth behind every face-cleanup action: its button label, its hover tip, its help-modal
 * explanation, its glyph, its tile colour and its severity. One registry so an explanation can never drift from
 * the button it explains (design docs/superpowers/specs/2026-07-31-face-cleanup-ux-unification-design.md §3.1).
 */
export type FaceActionId = 'owner' | 'stay' | 'lock' | 'other' | 'unknown' | 'detach' | 'keep' | 'unmark';

/** Guided review (scan-driven) and manual review (pick a person, no scan). */
export type FaceReviewMode = 'guided' | 'manual';

/**
 * A key that reads the same in both modes, or one key per mode.
 *
 * Three explanations are genuinely mode-dependent and MUST NOT be collapsed: guided's "move to a chosen
 * person" copy frames the action as overriding the scan and warns the next scan can re-flag the face, which is
 * meaningless in a mode that never scans; and guided's lock copy says "their owner" where manual says "this
 * person". Collapsing either ships copy describing the wrong mode.
 */
type ModalKey = string | Readonly<Record<FaceReviewMode, string>>;

export interface FaceActionMeta {
  readonly id: FaceActionId;
  /** Button label, and the help modal's heading — one key, so the two can never disagree. */
  readonly labelKey: string;
  /** One line for the hover/focus popover. Mode-independent for every action. */
  readonly tipKey: string;
  /** Help modal: what it means / when to use it. */
  readonly bodyKey: ModalKey;
  /** Help modal "On apply:", and the dock's inline hint row. */
  readonly effectKey: ModalKey;
  /**
   * Glyph on the bulk-bar button. Present for everything that IS a button — including `unmark`, whose
   * `mdiUndo` is easy to lose in a merge because it has no tile state. `undefined` only for `keep`, which is
   * the default rather than a button and appears solely in the help modal.
   */
  readonly buttonIcon: string | undefined;
  /**
   * The tile-state swatch — badge, ribbon, help-modal rail. `undefined` for `keep` and `unmark`: neither
   * corresponds to a coloured tile state, and both are signalled by ABSENCE. Deliberately NOT the same
   * absence as `buttonIcon` — `unmark` has a glyph but no swatch.
   */
  readonly swatchColor: string | undefined;
  /** `danger` tints the button red. Only `detach`, the one irreversible action. */
  readonly tone: 'default' | 'danger';
}

// Model B state colours (docs/plans/2026-07-10-face-cleanup-resolution-mockup.html :root vars).
const COLOR = {
  owner: '#4f46e5',
  other: '#d97706',
  stay: '#16a34a',
  lock: '#7c3aed',
  detach: '#475569',
  unknown: '#0d9488',
} as const;

export const FACE_ACTIONS: Readonly<Record<FaceActionId, FaceActionMeta>> = {
  owner: {
    id: 'owner',
    labelKey: 'admin.face_cleanup_review_bulk_owner',
    tipKey: 'admin.face_cleanup_action_owner_tip',
    bodyKey: 'admin.face_cleanup_review_help_owner_body',
    effectKey: 'admin.face_cleanup_review_help_owner_effect',
    buttonIcon: mdiArrowRightBold,
    swatchColor: COLOR.owner,
    tone: 'default',
  },
  stay: {
    id: 'stay',
    labelKey: 'admin.face_cleanup_review_bulk_stay',
    tipKey: 'admin.face_cleanup_action_stay_tip',
    bodyKey: 'admin.face_cleanup_review_help_stay_body',
    effectKey: 'admin.face_cleanup_review_help_stay_effect',
    buttonIcon: mdiPin,
    swatchColor: COLOR.stay,
    tone: 'default',
  },
  lock: {
    id: 'lock',
    labelKey: 'admin.face_cleanup_review_bulk_lock',
    tipKey: 'admin.face_cleanup_action_lock_tip',
    // Guided: "don't resemble their owner". Manual: "don't look like this person".
    bodyKey: {
      guided: 'admin.face_cleanup_review_help_lock_body',
      manual: 'admin.face_cleanup_manual_review_help_lock_body',
    },
    // Shared verbatim before the merge: the lock mechanism is identical in both modes.
    effectKey: 'admin.face_cleanup_review_help_lock_effect',
    buttonIcon: mdiLock,
    swatchColor: COLOR.lock,
    tone: 'default',
  },
  other: {
    id: 'other',
    labelKey: 'admin.face_cleanup_review_bulk_other',
    tipKey: 'admin.face_cleanup_action_other_tip',
    bodyKey: {
      guided: 'admin.face_cleanup_review_help_other_body',
      manual: 'admin.face_cleanup_manual_review_help_move_body',
    },
    effectKey: {
      guided: 'admin.face_cleanup_review_help_other_effect',
      manual: 'admin.face_cleanup_manual_review_help_move_effect',
    },
    buttonIcon: mdiAccountArrowRight,
    swatchColor: COLOR.other,
    tone: 'default',
  },
  unknown: {
    id: 'unknown',
    labelKey: 'admin.face_cleanup_review_bulk_unknown',
    tipKey: 'admin.face_cleanup_action_unknown_tip',
    bodyKey: 'admin.face_cleanup_review_help_unknown_body',
    effectKey: 'admin.face_cleanup_review_help_unknown_effect',
    buttonIcon: mdiAccountQuestion,
    swatchColor: COLOR.unknown,
    tone: 'default',
  },
  detach: {
    id: 'detach',
    labelKey: 'admin.face_cleanup_review_bulk_detach',
    tipKey: 'admin.face_cleanup_action_detach_tip',
    bodyKey: 'admin.face_cleanup_review_help_detach_body',
    effectKey: 'admin.face_cleanup_review_help_detach_effect',
    buttonIcon: mdiImageOff,
    swatchColor: COLOR.detach,
    tone: 'danger',
  },
  keep: {
    id: 'keep',
    labelKey: 'admin.face_cleanup_manual_review_help_keep_name',
    tipKey: 'admin.face_cleanup_action_keep_tip',
    bodyKey: 'admin.face_cleanup_manual_review_help_keep_body',
    effectKey: 'admin.face_cleanup_manual_review_help_keep_effect',
    // Not a button: keep is the default, explained in the modal only.
    buttonIcon: undefined,
    swatchColor: undefined,
    tone: 'default',
  },
  unmark: {
    id: 'unmark',
    labelKey: 'admin.face_cleanup_manual_review_bulk_unmark',
    tipKey: 'admin.face_cleanup_action_unmark_tip',
    bodyKey: 'admin.face_cleanup_manual_review_help_unmark_body',
    effectKey: 'admin.face_cleanup_manual_review_help_unmark_effect',
    // A button WITH a glyph but WITHOUT a swatch — returning a face to `keep` is not a tile state.
    buttonIcon: mdiUndo,
    swatchColor: undefined,
    tone: 'default',
  },
};

const resolve = (key: ModalKey, mode: FaceReviewMode): string => (typeof key === 'string' ? key : key[mode]);

/** The ONLY way body copy is read — never reach into `bodyKey` directly, or a mode-dependent key leaks. */
export const bodyKeyFor = (id: FaceActionId, mode: FaceReviewMode): string => resolve(FACE_ACTIONS[id].bodyKey, mode);

/** The ONLY way effect copy is read. Feeds both the help modal and the dock's hint row. */
export const effectKeyFor = (id: FaceActionId, mode: FaceReviewMode): string =>
  resolve(FACE_ACTIONS[id].effectKey, mode);

/**
 * The six ids that are also guided tile states. `keep`/`unmark` are excluded: they have no tile state, and
 * `STATE_COLOR`/`STATE_ICON` must not widen to include them (review.spec.ts pins their key sets).
 */
export const GUIDED_STATE_IDS = ['owner', 'other', 'stay', 'lock', 'detach', 'unknown'] as const;
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/face-actions.spec.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/lib/components/face-cleanup/ && cd ..
git add web/src/lib/components/face-cleanup/
git commit -m "feat(face-cleanup): add the shared face-action registry"
```

---

### Task 3: Derive the state tokens from the registry

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts:20-40`
- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/manual-review.svelte.ts:35-47`
- Modify: `web/src/lib/components/face-cleanup/face-actions.spec.ts` (add R9, R10)

**Interfaces:**

- Consumes: `FACE_ACTIONS`, `GUIDED_STATE_IDS` from Task 2.
- Produces: `STATE_COLOR`, `STATE_ICON`, `MANUAL_STATE_COLOR`, `MANUAL_STATE_ICON` keep their current names, types and key sets. Every existing importer is untouched.

**Test-first, with a proven-red step.** The registry's values are byte-identical to the literals being replaced, so a test written first would pass first — vacuously. The cure is not to skip the red step but to _earn_ it: land the projection **deliberately wrong**, watch the test fail for the right reason, then correct it. The wrong version is never committed.

Two existing specs are the additional guard rail and must not be edited at any point in this task:

- `review.spec.ts:17-18` — `STATE_ICON` keys === `STATE_COLOR` keys;
- `manual-review.spec.ts:40-41` — `MANUAL_STATE_*` keys are exactly `['detach','lock','move','unknown']`.

The derivation must **narrow**, not widen — `keep` and `unmark` have no tile state and must never appear in either map.

- [ ] **Step 1: Record the guard rail is green before touching anything**

```bash
cd web && pnpm exec vitest run \
  'src/routes/admin/face-cleanup/[personId]/review.spec.ts' \
  'src/routes/admin/face-cleanup/people/[personId]/manual-review.spec.ts'
```

Expected: PASS.

- [ ] **Step 2: Write the characterisation test FIRST — extend the import block at the TOP of `face-actions.spec.ts`**

`prettier-plugin-organize-imports` rewrites the import block on format, so these join the existing imports at the top rather than being appended:

```ts
import { STATE_COLOR, STATE_ICON } from '../../../routes/admin/face-cleanup/[personId]/review.svelte';
import {
  MANUAL_STATE_COLOR,
  MANUAL_STATE_ICON,
} from '../../../routes/admin/face-cleanup/people/[personId]/manual-review.svelte';
```

Then append this block at the end of the file:

```ts
// R9/R10 — the route tokens are PROJECTIONS of the registry. Asserts both halves: the values match, and the
// projection NARROWS (keep/unmark must never leak into a tile-state map).
describe('state tokens derived from the registry', () => {
  it('projects exactly the six guided states, with the registry values', () => {
    expect(Object.keys(STATE_COLOR).sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);
    expect(Object.keys(STATE_ICON).sort()).toEqual(['detach', 'lock', 'other', 'owner', 'stay', 'unknown']);

    for (const id of GUIDED_STATE_IDS) {
      expect(STATE_COLOR[id]).toBe(FACE_ACTIONS[id].swatchColor);
      expect(STATE_ICON[id]).toBe(FACE_ACTIONS[id].buttonIcon);
    }
  });

  it('projects manual’s four states, renaming other → move, and leaks neither keep nor unmark', () => {
    expect(Object.keys(MANUAL_STATE_COLOR).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);
    expect(Object.keys(MANUAL_STATE_ICON).sort()).toEqual(['detach', 'lock', 'move', 'unknown']);

    expect(MANUAL_STATE_COLOR.move).toBe(FACE_ACTIONS.other.swatchColor);
    expect(MANUAL_STATE_ICON.move).toBe(FACE_ACTIONS.other.buttonIcon);
    for (const id of ['lock', 'unknown', 'detach'] as const) {
      expect(MANUAL_STATE_COLOR[id]).toBe(FACE_ACTIONS[id].swatchColor);
      expect(MANUAL_STATE_ICON[id]).toBe(FACE_ACTIONS[id].buttonIcon);
    }
  });
});
```

- [ ] **Step 3: Prove the test has teeth — land a deliberately WRONG projection and watch it go red**

Temporarily replace `STATE_COLOR` in `review.svelte.ts` with a projection that **widens** — the exact defect this test exists to catch:

```ts
import { FACE_ACTIONS } from '$lib/components/face-cleanup/face-actions';

// DELIBERATELY WRONG — widens over all eight ids instead of narrowing to the six tile states.
// This is a throwaway step to prove the test fails for the right reason. DO NOT COMMIT.
export const STATE_COLOR = Object.fromEntries(
  Object.values(FACE_ACTIONS).map((meta) => [meta.id, meta.swatchColor]),
) as Record<FaceState, string>;
```

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/face-actions.spec.ts
```

Expected: **FAIL** on `projects exactly the six guided states` — the received key list contains `keep` and `unmark`. If it passes, the test is vacuous and must be strengthened before you go on. **Do not commit this state.**

- [ ] **Step 4: Correct the projection in `review.svelte.ts`**

Replace the `STATE_COLOR` and `STATE_ICON` object literals (keep the surrounding comments — they explain why one glyph means one thing everywhere):

```ts
import { FACE_ACTIONS, GUIDED_STATE_IDS } from '$lib/components/face-cleanup/face-actions';

// Projected from the shared registry (design §3.1) rather than declared here, so the bulk bar, the tile badge,
// the tally chip and the help modal cannot drift apart. NARROWS to the six tile states: `keep`/`unmark` have no
// tile state and must never appear here (review.spec.ts pins these key sets).
export const STATE_COLOR: Record<FaceState, string> = Object.fromEntries(
  GUIDED_STATE_IDS.map((id) => [id, FACE_ACTIONS[id].swatchColor!]),
) as Record<FaceState, string>;

export const STATE_ICON: Record<FaceState, string> = Object.fromEntries(
  GUIDED_STATE_IDS.map((id) => [id, FACE_ACTIONS[id].buttonIcon!]),
) as Record<FaceState, string>;
```

Remove the now-unused `@mdi/js` imports from this file.

- [ ] **Step 5: Replace the inline declarations in `manual-review.svelte.ts`**

```ts
import { FACE_ACTIONS } from '$lib/components/face-cleanup/face-actions';

// Projected from the registry under manual's `other` → `move` rename (design §3.1). `keep` deliberately has no
// entry: it is signalled by absence, not a 5th swatch.
export const MANUAL_STATE_COLOR: Record<Exclude<ManualFaceState, 'keep'>, string> = {
  move: FACE_ACTIONS.other.swatchColor!,
  lock: FACE_ACTIONS.lock.swatchColor!,
  unknown: FACE_ACTIONS.unknown.swatchColor!,
  detach: FACE_ACTIONS.detach.swatchColor!,
};

export const MANUAL_STATE_ICON: Record<Exclude<ManualFaceState, 'keep'>, string> = {
  move: FACE_ACTIONS.other.buttonIcon!,
  lock: FACE_ACTIONS.lock.buttonIcon!,
  unknown: FACE_ACTIONS.unknown.buttonIcon!,
  detach: FACE_ACTIONS.detach.buttonIcon!,
};
```

Keep the existing `STATE_COLOR`/`STATE_ICON` import from `../../[personId]/review.svelte` only if still referenced; otherwise remove it.

- [ ] **Step 6: Run the registry spec plus both existing view-model specs**

```bash
cd web && pnpm exec vitest run \
  src/lib/components/face-cleanup/face-actions.spec.ts \
  'src/routes/admin/face-cleanup/[personId]/review.spec.ts' \
  'src/routes/admin/face-cleanup/people/[personId]/manual-review.spec.ts'
```

Expected: PASS, all three. `review.spec.ts` and `manual-review.spec.ts` must be **unmodified** — if either needed an edit, the projection is wrong, not the spec.

- [ ] **Step 7: Typecheck, then commit**

```bash
cd web && pnpm run check:typescript
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/ && cd ..
git add web/src/
git commit -m "refactor(face-cleanup): derive the state colour and icon tokens from the registry"
```

---

### Task 4: `FaceReviewDock` — the shared dock

**Files:**

- Create: `web/src/lib/components/face-cleanup/FaceReviewDock.svelte`
- Create: `web/src/lib/components/face-cleanup/FaceReviewDock.spec.ts`

**Interfaces:**

- Consumes: `FACE_ACTIONS`, `effectKeyFor`, `FaceActionId`, `FaceReviewMode` from Task 2.
- Produces:
  ```ts
  interface DockAction {
    id: FaceActionId;
    testId: string;
  }
  interface DockTestIds {
    dock: string;
    bar: string;
    clear: string;
    help: string;
    hint: string;
  }
  interface Props {
    mode: FaceReviewMode;
    selectedCount: number;
    actions: DockAction[];
    onAction: (id: FaceActionId) => void;
    onHelp: () => void;
    onClear: () => void;
    summary: Snippet;
    apply: Snippet;
  }
  ```
  Tasks 6 and 7 render `<FaceReviewDock … />` with exactly these props.

The **page** keeps the `{#if}` visibility gate; this component has no hidden state.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/face-cleanup/FaceReviewDock.spec.ts`:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import Harness from './face-review-dock.test-wrapper.svelte';
import { FACE_ACTIONS } from './face-actions';

// Rendered against the REAL en.json (the convention every face-cleanup COMPONENT spec uses, as opposed to the
// key-echoing mock the PAGE specs use), so a missing or renamed key fails here instead of silently rendering
// the key. The wrapper supplies the `summary` and `apply` snippets, which cannot be passed from a plain object.

beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const GUIDED_ACTIONS = [
  { id: 'owner', testId: 'bulk-owner' },
  { id: 'stay', testId: 'bulk-stay' },
  { id: 'lock', testId: 'bulk-lock' },
  { id: 'other', testId: 'bulk-other' },
  { id: 'unknown', testId: 'bulk-unknown' },
  { id: 'detach', testId: 'bulk-detach' },
] as const;

const renderDock = (over: Record<string, unknown> = {}) =>
  render(Harness, {
    props: {
      mode: 'guided',
      selectedCount: 2,
      actions: [...GUIDED_ACTIONS],
      onAction: vi.fn(),
      onHelp: vi.fn(),
      onClear: vi.fn(),
      ...over,
    },
  });

describe('FaceReviewDock — summary and actions', () => {
  // D1
  it('shows the page-supplied summary and apply content while nothing is selected', () => {
    renderDock({ selectedCount: 0 });

    expect(screen.getByTestId('harness-summary')).toBeInTheDocument();
    expect(screen.getByTestId('harness-apply')).toBeInTheDocument();
    expect(screen.queryByTestId('face-bulk-bar')).not.toBeInTheDocument();
  });

  // D2
  it('swaps to the action bar once a face is selected', () => {
    renderDock({ selectedCount: 1 });

    expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument();
    expect(screen.queryByTestId('harness-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('harness-apply')).not.toBeInTheDocument();
  });

  // D3
  it('reports how many faces the actions will apply to', () => {
    renderDock({ selectedCount: 7 });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('7 selected');
  });

  // D4
  it('renders one button per action, in the order given, under its own testid', () => {
    renderDock();

    for (const action of GUIDED_ACTIONS) {
      expect(screen.getByTestId(action.testId)).toBeInTheDocument();
    }
    const rendered = screen.getAllByRole('button').map((button) => button.dataset.testid);
    expect(rendered.filter((id) => id?.startsWith('bulk-') && id !== 'face-bulk-help')).toEqual(
      GUIDED_ACTIONS.map((action) => action.testId),
    );
  });

  // D5
  it('labels each button with the harmonised action name', () => {
    renderDock();

    expect(screen.getByTestId('bulk-owner')).toHaveTextContent('Move to owner');
    expect(screen.getByTestId('bulk-stay')).toHaveTextContent('Keep here');
    expect(screen.getByTestId('bulk-lock')).toHaveTextContent('Confirm & lock');
    expect(screen.getByTestId('bulk-other')).toHaveTextContent('Move to person…');
    expect(screen.getByTestId('bulk-unknown')).toHaveTextContent('Unknown person');
    expect(screen.getByTestId('bulk-detach')).toHaveTextContent('Not a face');
  });

  // D6
  it('routes a click to exactly one action', async () => {
    const onAction = vi.fn();
    renderDock({ onAction });

    await fireEvent.click(screen.getByTestId('bulk-lock'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith('lock');
  });

  // D7 — the destructive button's distinctness as an assertable attribute, not a class-list match.
  it('marks only the irreversible action as dangerous', () => {
    renderDock();

    expect(screen.getByTestId('bulk-detach')).toHaveAttribute('data-tone', 'danger');
    expect(screen.getByTestId('bulk-lock')).toHaveAttribute('data-tone', 'default');
  });

  // D8
  it('routes clear and help to their own handlers', async () => {
    const onClear = vi.fn();
    const onHelp = vi.fn();
    renderDock({ onClear, onHelp });

    await fireEvent.click(screen.getByTestId('face-bulk-clear'));
    await fireEvent.click(screen.getByTestId('face-bulk-help'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  // D9 — the manual-mode gap being closed: help is never conditional on which subset was passed.
  it('offers clear and help whatever subset of actions it was given', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    expect(screen.getByTestId('face-bulk-clear')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
  });

  // D10 — F2's regression guard. Icon identity is observable here because this spec does not stub Icon.
  it('gives every action button its glyph, including unmark, which has no tile colour', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    const path = screen.getByTestId('manual-review-bulk-unmark').querySelector('path');
    expect(path).toHaveAttribute('d', FACE_ACTIONS.unmark.buttonIcon);
  });
});

describe('FaceReviewDock — hover, focus and the swap', () => {
  // D11
  it('given nothing hovered, shows the neutral hint and no popover', () => {
    renderDock();

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D12 + D13
  it('given the pointer enters an action, shows its tip in a popover and its effect in the hint row', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent(
      'Pin these here permanently, so no future scan can flag them.',
    );
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Confirm & lock');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('the face is pinned to this person');
  });

  // D13 (mode arm) — guided resolves the scan-referencing effect copy.
  it('given guided mode, the hint row for a chosen-person move warns about the next scan', async () => {
    renderDock({ mode: 'guided' });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-other'));

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('the next scan can flag the face again');
  });

  // D13 (mode arm) — manual resolves the scan-free copy for the SAME action id.
  it('given manual mode, the same action’s hint row never mentions a scan', async () => {
    renderDock({ mode: 'manual', actions: [{ id: 'other', testId: 'manual-review-bulk-move' }] });

    await fireEvent.mouseEnter(screen.getByTestId('manual-review-bulk-move'));

    const hint = screen.getByTestId('face-bulk-hint');
    expect(hint).toHaveTextContent('so recognition never routes the face back here later');
    expect(hint).not.toHaveTextContent('the next scan can flag the face again');
  });

  // D14
  it('given the pointer leaves, restores the neutral hint and removes the popover', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await fireEvent.mouseLeave(screen.getByTestId('bulk-lock'));

    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D15 — keyboard parity.
  it('given a keyboard user focuses an action, shows the same popover and hint as hovering', async () => {
    renderDock();

    await fireEvent.focusIn(screen.getByTestId('bulk-detach'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('Irreversible');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Not a face');
  });

  // D16
  it('given focus leaves the action, restores the neutral hint', async () => {
    renderDock();

    await fireEvent.focusIn(screen.getByTestId('bulk-detach'));
    await fireEvent.focusOut(screen.getByTestId('bulk-detach'));

    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D17 — sliding along the bar with no intervening leave.
  it('given the pointer moves straight from one action to another, describes the second', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await fireEvent.mouseEnter(screen.getByTestId('bulk-unknown'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('Real faces, but not this person');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Unknown person');
    expect(screen.getByTestId('face-bulk-hint')).not.toHaveTextContent('Pin these here permanently');
  });

  // D18
  it('given an action is hovered, exactly one popover exists', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getAllByTestId('face-bulk-popover')).toHaveLength(1);
  });

  // D19 — one announcement, and focus reaches the effect text.
  it('given an action is hovered, the popover is hidden from screen readers and the button describes itself', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveAttribute('aria-hidden', 'true');
    const describedBy = screen.getByTestId('bulk-lock').getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toBe(screen.getByTestId('face-bulk-hint'));
  });

  // D20
  it('given the pointer enters clear or help, leaves the hint row alone', async () => {
    renderDock();

    await fireEvent.mouseEnter(screen.getByTestId('face-bulk-clear'));
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');

    await fireEvent.mouseEnter(screen.getByTestId('face-bulk-help'));
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
  });

  // D21 + D22 — applying an action clears the selection, so the bar unmounts while still hovered.
  it('given the selection is emptied while an action is hovered, the next selection opens with no stale effect', async () => {
    const { rerender } = renderDock({ selectedCount: 2 });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await rerender({ selectedCount: 0 });

    expect(screen.getByTestId('harness-summary')).toBeInTheDocument();

    await rerender({ selectedCount: 3 });

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Nothing is written until you press Apply.');
    expect(screen.queryByTestId('face-bulk-popover')).not.toBeInTheDocument();
  });

  // D23 — growing the selection must not clear a live hover.
  it('given the selection grows while an action is hovered, keeps describing that action', async () => {
    const { rerender } = renderDock({ selectedCount: 2 });

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));
    await rerender({ selectedCount: 5 });

    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('Confirm & lock');
  });
});

describe('FaceReviewDock — edge cases', () => {
  // D24
  it('renders the bar shell with no actions at all', () => {
    renderDock({ actions: [] });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('2 selected');
    expect(screen.getByTestId('face-bulk-clear')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
    expect(screen.getByTestId('face-bulk-hint')).toBeInTheDocument();
  });

  // D25
  it('renders a single action', () => {
    renderDock({ actions: [{ id: 'detach', testId: 'bulk-detach' }] });

    expect(screen.getByTestId('bulk-detach')).toBeInTheDocument();
  });

  // D26
  it('renders a selection of one as readily as many', () => {
    renderDock({ selectedCount: 1 });

    expect(screen.getByTestId('face-bulk-bar')).toHaveTextContent('1 selected');
  });

  // D27 — the other half of the F2 split: no swatch must not suppress the glyph.
  it('renders the glyph of an action that has no tile colour', () => {
    renderDock({ actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    expect(FACE_ACTIONS.unmark.swatchColor).toBeUndefined();
    expect(screen.getByTestId('manual-review-bulk-unmark').querySelector('path')).toHaveAttribute(
      'd',
      FACE_ACTIONS.unmark.buttonIcon,
    );
  });

  // D28 — no module-level state leaks between instances (the suite sets no clearMocks). Every testid in the
  // second dock is distinct, INCLUDING `dock`: two elements sharing one testid would make a later
  // `getByTestId('face-dock')` throw "found multiple elements" from an unrelated test.
  it('keeps two docks independent', async () => {
    renderDock({ actions: [{ id: 'lock', testId: 'bulk-lock' }] });
    renderDock({ mode: 'manual', actions: [{ id: 'unmark', testId: 'manual-review-bulk-unmark' }] });

    // Both docks render the same normalised chrome testids, so index the pair rather than aliasing them.
    const hints = screen.getAllByTestId('face-bulk-hint');
    expect(hints).toHaveLength(2);

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    // The first dock describes what was hovered; the second is untouched by it — no module-level state leak.
    expect(hints[0]).toHaveTextContent('Confirm & lock');
    expect(hints[1]).toHaveTextContent('Nothing is written until you press Apply.');
  });
});
```

- [ ] **Step 2: Write the test wrapper (snippets cannot be passed as plain props)**

Create `web/src/lib/components/face-cleanup/face-review-dock.test-wrapper.svelte`:

```svelte
<script lang="ts">
  // Snippet props can't be supplied from a plain props object in @testing-library/svelte, so this wrapper
  // supplies `summary` and `apply` and forwards everything else verbatim. Same convention as
  // src/lib/components/people/person-tile.test-wrapper.svelte.
  import FaceReviewDock from './FaceReviewDock.svelte';

  const props: Record<string, unknown> = $props();
</script>

<FaceReviewDock {...props}>
  {#snippet summary()}
    <div data-testid="harness-summary">summary</div>
  {/snippet}
  {#snippet apply()}
    <div data-testid="harness-apply">apply</div>
  {/snippet}
</FaceReviewDock>
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/FaceReviewDock.spec.ts
```

Expected: FAIL — `Failed to resolve import "./FaceReviewDock.svelte"`.

- [ ] **Step 4: Write the component**

Create `web/src/lib/components/face-cleanup/FaceReviewDock.svelte`:

```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';
  import { effectKeyFor, FACE_ACTIONS, type FaceActionId, type FaceReviewMode } from './face-actions';

  // The ONE footer dock for both review modes. It used to be two near-identical copies that drifted (different
  // radii, paddings, text sizes, and an (i) button in guided only) — see design §1.3.
  //
  // The page keeps the {#if} visibility gate: guided shows the dock on `flaggedFaces.length > 0`, manual on
  // `vm.loadedCount > 0`. Those are genuinely different conditions over different models, so this component is
  // only ever rendered when it should be visible and has no hidden state of its own.

  interface DockAction {
    id: FaceActionId;
    /** Preserved verbatim per page — the e2e suite targets these, not labels. */
    testId: string;
  }

  interface Props {
    mode: FaceReviewMode;
    selectedCount: number;
    actions: DockAction[];
    onAction: (id: FaceActionId) => void;
    onHelp: () => void;
    onClear: () => void;
    /** Everything left of Apply while nothing is selected. Guided renders a tally, a rest-of-cluster chip and a
     *  blocked reason; manual renders four tally chips. One snippet, not a tally/apply pair, because guided's
     *  blocked reason sits BETWEEN the tally and the button and would have nowhere to live in a two-way split. */
    summary: Snippet;
    apply: Snippet;
  }

  const { mode, selectedCount, actions, onAction, onHelp, onClear, summary, apply }: Props = $props();

  // Drives BOTH the popover and the hint row, so the two can never describe different actions.
  let hoveredId: FaceActionId | null = $state(null);

  // Applying an action clears the selection, so the bar unmounts while the pointer is still over where a button
  // was. Only the inner branch unmounts, not this component, so without the reset a stale effect line greets the
  // next selection.
  $effect(() => {
    if (selectedCount === 0) {
      hoveredId = null;
    }
  });

  // `$props.id()` (Svelte 5.20+; this repo is on 5.56.5) — a per-instance id that is STABLE across SSR and
  // hydration. `Math.random()` or a module counter would generate different ids on the server and the client
  // and produce a hydration mismatch on an SSR'd admin route.
  const hintId = `face-review-dock-hint-${$props.id()}`;

  const hintText = $derived(
    hoveredId
      ? $t('admin.face_cleanup_review_bulk_hint_effect', {
          values: { action: $t(FACE_ACTIONS[hoveredId].labelKey), effect: $t(effectKeyFor(hoveredId, mode)) },
        })
      : $t('admin.face_cleanup_review_bulk_hint_default'),
  );

  const actionBtn =
    'relative inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold ring-1 ring-inset transition-colors';
  const toneClass = (tone: 'default' | 'danger') =>
    tone === 'danger'
      ? 'bg-red-500/15 text-red-100 ring-red-400/30 hover:bg-red-500/25'
      : 'bg-white/10 text-white ring-white/15 hover:bg-white/20';
</script>

<div
  class="shrink-0 border-t border-gray-200 bg-white py-3.5 dark:border-gray-700 dark:bg-gray-900"
  data-testid="face-dock"
>
  <div class="mx-auto flex max-w-screen-xl flex-wrap items-center gap-3.5 px-6">
    {#if selectedCount === 0}
      {@render summary()}
      {@render apply()}
    {:else}
      <div
        class="flex flex-1 flex-col gap-2 rounded-2xl bg-gray-900 px-4 py-3 text-white dark:bg-gray-950"
        data-testid="face-bulk-bar"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span class="mr-1 text-base font-bold whitespace-nowrap">
            {selectedCount}
            {$t('admin.face_cleanup_review_bulk_selected_suffix')}
          </span>
          <span class="h-6 w-px bg-white/15"></span>

          {#each actions as action (action.id)}
            {@const meta = FACE_ACTIONS[action.id]}
            <button
              type="button"
              class={`${actionBtn} ${toneClass(meta.tone)}`}
              data-testid={action.testId}
              data-tone={meta.tone}
              aria-describedby={hintId}
              onclick={() => onAction(action.id)}
              onmouseenter={() => (hoveredId = action.id)}
              onmouseleave={() => (hoveredId = null)}
              onfocusin={() => (hoveredId = action.id)}
              onfocusout={() => (hoveredId = null)}
            >
              {#if meta.buttonIcon}
                <Icon icon={meta.buttonIcon} size="16" />
              {/if}
              {$t(meta.labelKey)}

              {#if hoveredId === action.id}
                <!-- A local popover rather than @immich/ui's Tooltip: that component styles for the page
                     background rather than this dark bar, and needs a TooltipProvider these pages' isolated
                     specs don't have. aria-hidden because the hint row below already carries the text into the
                     accessibility tree via aria-describedby — announcing both would say it twice. -->
                <span
                  class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-56 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-xs/relaxed font-normal text-gray-100 shadow-lg ring-1 ring-white/10"
                  data-testid="face-bulk-popover"
                  aria-hidden="true"
                >
                  {$t(meta.tipKey)}
                </span>
              {/if}
            </button>
          {/each}

          <button
            type="button"
            onclick={onHelp}
            aria-label={$t('admin.face_cleanup_review_help_open')}
            class="inline-flex items-center rounded-lg bg-white/10 p-2 ring-1 ring-white/15 ring-inset hover:bg-white/20"
            data-testid="face-bulk-help"
          >
            <Icon icon={mdiInformationOutline} size="16" />
          </button>

          <button
            type="button"
            onclick={onClear}
            class="ml-auto text-sm font-bold text-gray-300 hover:text-white"
            data-testid="face-bulk-clear"
          >
            {$t('admin.face_cleanup_review_bulk_clear')}
          </button>
        </div>

        <!-- Two reserved lines so swapping between the shortest and the longest effect string cannot change the
             dock's height and move the buttons out from under the pointer. -->
        <p
          id={hintId}
          class="line-clamp-2 min-h-8 text-xs/relaxed text-gray-300"
          data-testid="face-bulk-hint"
        >
          {hintText}
        </p>
      </div>
    {/if}
  </div>
</div>
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/FaceReviewDock.spec.ts
```

Expected: PASS (24 tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/lib/components/face-cleanup/ && cd ..
git add web/src/lib/components/face-cleanup/
git commit -m "feat(face-cleanup): add the shared review dock with hover explanations"
```

---

### Task 5: `FaceActionsHelpModal` — one modal for both modes

**Files:**

- Create: `web/src/lib/components/face-cleanup/FaceActionsHelpModal.svelte`
- Create: `web/src/lib/components/face-cleanup/FaceActionsHelpModal.spec.ts`

**Interfaces:**

- Consumes: `FACE_ACTIONS`, `bodyKeyFor`, `effectKeyFor` from Task 2.
- Produces:
  ```ts
  interface Props {
    mode: FaceReviewMode;
    actions: FaceActionId[];
    introKey: string;
    footerKey: string;
    defaultActionId?: FaceActionId;
    onClose: () => void;
  }
  ```
  Tasks 7 and 8 pass these through `modalManager.show(FaceActionsHelpModal, { … })`.

The old modals still exist after this task; Task 6 deletes them. That keeps this task's deliverable independently reviewable.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/face-cleanup/FaceActionsHelpModal.spec.ts`. Every assertion from
`ActionsHelpModal.spec.ts` and `ManualActionsHelpModal.spec.ts` is carried over, re-aimed at the merged
component under the mode that owned it:

```ts
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import FaceActionsHelpModal from './FaceActionsHelpModal.svelte';
import { FACE_ACTIONS } from './face-actions';

// Rendered against the real en.json, like the two modals it replaces.

// Drain bits-ui Modal's deferred body-scroll-lock cleanup before happy-dom tears down `document`.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 500));
});

beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const GUIDED = {
  mode: 'guided',
  actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
  introKey: 'admin.face_cleanup_review_help_intro',
  footerKey: 'admin.face_cleanup_review_help_footer',
} as const;

const MANUAL = {
  mode: 'manual',
  actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
  introKey: 'admin.face_cleanup_manual_review_help_intro',
  footerKey: 'admin.face_cleanup_manual_review_help_footer',
  defaultActionId: 'keep',
} as const;

const renderModal = (preset: object, over: object = {}) =>
  render(FaceActionsHelpModal, { props: { ...preset, onClose: vi.fn(), ...over } });

describe('FaceActionsHelpModal — guided', () => {
  // H1 + H7 (from ActionsHelpModal.spec.ts)
  it('titles the modal and frames apply as the point of no return', () => {
    renderModal(GUIDED);

    expect(screen.getByText('What do these actions do?')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Nothing changes until you press Apply. Every flagged face has to end in one of these six states — then this person leaves the cleanup queue for good.',
      ),
    ).toBeInTheDocument();
  });

  it('names all six actions, reusing the bulk-bar labels', () => {
    renderModal(GUIDED);

    for (const name of [
      'Move to owner',
      'Keep here',
      'Confirm & lock',
      'Move to person…',
      'Unknown person',
      'Not a face',
    ]) {
      expect(screen.getByTestId('help-actions')).toHaveTextContent(name);
    }
  });

  // H3
  it('explains what each action means', () => {
    renderModal(GUIDED);

    expect(screen.getByText(/the default for every flagged face/)).toBeInTheDocument();
    expect(screen.getByText(/the scan got it wrong/)).toBeInTheDocument();
    expect(screen.getByText(/permanent and owner-agnostic/)).toBeInTheDocument();
    expect(screen.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    expect(screen.getByText(/a poster, a statue, a reflection/)).toBeInTheDocument();
    expect(screen.getByText(/you don't know whose it is/)).toBeInTheDocument();
  });

  it('explains what each action does on apply, including the stay-vs-lock durability difference', () => {
    renderModal(GUIDED);

    const effects = screen.getAllByTestId('help-effect');
    expect(effects).toHaveLength(6);
    for (const effect of effects) {
      expect(effect).toHaveTextContent('On apply:');
    }

    expect(screen.getByText(/joins the suspected owner/)).toBeInTheDocument();
    expect(
      screen.getByText(/If a later scan suspects a different person, the face can be flagged again/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no future scan can flag it again, no matter who it comes to resemble/),
    ).toBeInTheDocument();
    expect(screen.getByText(/the next scan can flag the face again/)).toBeInTheDocument();
    expect(screen.getByText(/its identity link is stripped/)).toBeInTheDocument();
    expect(screen.getByText(/move into a new unnamed cluster of their own/)).toBeInTheDocument();
  });

  // H6
  it('warns that Not a face retires the crop rather than returning it to the pool, and points at Unknown person', () => {
    renderModal(GUIDED);

    expect(screen.getByText(/Use Unknown person instead if it IS a real face/)).toBeInTheDocument();
    expect(screen.getByText(/gone from face recognition, not returned to the pool/)).toBeInTheDocument();
  });

  it('tells the admin the resolutions are undoable and that an emptied unnamed person is removed', () => {
    renderModal(GUIDED);

    expect(screen.getByTestId('help-footer')).toHaveTextContent(
      'Declines and locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
    );
  });

  // H4 — guided passes no defaultActionId, so no badge anywhere.
  it('marks no action as the default', () => {
    renderModal(GUIDED);

    expect(screen.queryByTestId('help-default-badge')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — manual', () => {
  // H2 (from ManualActionsHelpModal.spec.ts)
  it('titles the modal the same question guided asks', () => {
    renderModal(MANUAL);

    expect(screen.getByText('What do these actions do?')).toBeInTheDocument();
  });

  it('names exactly this mode’s six actions: Keep (default), Move to person…, Confirm & lock, Unknown person, Not a face, Unmark', () => {
    renderModal(MANUAL);

    for (const name of ['Keep', 'Move to person…', 'Confirm & lock', 'Unknown person', 'Not a face', 'Unmark']) {
      expect(screen.getByTestId('help-actions')).toHaveTextContent(name);
    }
    expect(screen.getByTestId('help-actions')).not.toHaveTextContent('Move to owner');
  });

  it('explains that Keep writes nothing, unlike guided where every face is always stamped', () => {
    renderModal(MANUAL);

    expect(screen.getByText(/there's no button for it, because you never have to select it/)).toBeInTheDocument();
    expect(screen.getByText(/A kept face is never included in the Apply request/)).toBeInTheDocument();
  });

  it('warns Not a face is irreversible and points at Unknown as the opposite case', () => {
    renderModal(MANUAL);

    expect(screen.getByText(/Use Unknown person instead if it IS a real face/)).toBeInTheDocument();
  });

  it('every action explains its effect on apply', () => {
    renderModal(MANUAL);

    const effects = screen.getAllByTestId('help-effect');
    expect(effects).toHaveLength(6);
    for (const effect of effects) {
      expect(effect).toHaveTextContent('On apply:');
    }
  });

  it('tells the admin locks are undoable and an emptied unnamed person is removed', () => {
    renderModal(MANUAL);

    expect(screen.getByTestId('help-footer')).toHaveTextContent(
      'Locks can be undone from the Resolutions page. If moving or detaching leaves an unnamed person with no faces at all, that empty person is removed.',
    );
  });

  // H4
  it('badges Keep as the default, and nothing else', () => {
    renderModal(MANUAL);

    const badges = screen.getAllByTestId('help-default-badge');
    expect(badges).toHaveLength(1);
    expect(screen.getByTestId('help-row-keep')).toContainElement(badges[0]);
  });

  // H5 — signalled by absence, mirroring the untouched tile.
  it('gives a colour rail to the tile states and none to keep or unmark', () => {
    renderModal(MANUAL);

    for (const id of ['other', 'lock', 'unknown', 'detach'] as const) {
      // `toHaveAttribute('style', stringContaining(hex))`, NOT `toHaveStyle({ background: hex })` — happy-dom
      // does not normalise an inline hex the way toHaveStyle expects, so the latter fails on a correct render.
      // Same assertion the spec this replaces used (ManualActionsHelpModal.spec.ts:95).
      expect(screen.getByTestId(`help-swatch-${id}`)).toHaveAttribute(
        'style',
        expect.stringContaining(FACE_ACTIONS[id].swatchColor!),
      );
    }
    expect(screen.queryByTestId('help-swatch-keep')).not.toBeInTheDocument();
    expect(screen.queryByTestId('help-swatch-unmark')).not.toBeInTheDocument();
  });
});

describe('FaceActionsHelpModal — mode-dependent copy', () => {
  // H11 — the F1 guard. A collapse to one variant fails loudly here.
  it('gives the chosen-person move its guided wording under guided and its manual wording under manual', () => {
    const guided = renderModal(GUIDED);
    expect(screen.getByText(/instead of the one the scan suggested/)).toBeInTheDocument();
    expect(screen.getByText(/when you're deliberately overriding the scan/)).toBeInTheDocument();
    guided.unmount();

    renderModal(MANUAL);
    expect(
      screen.getByText(/anyone in this library, or a brand-new person you create on the spot/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/instead of the one the scan suggested/)).not.toBeInTheDocument();
  });

  it('says “their owner” for lock under guided and “this person” under manual', () => {
    const guided = renderModal(GUIDED);
    expect(screen.getByText(/genuinely don't resemble their owner/)).toBeInTheDocument();
    guided.unmount();

    renderModal(MANUAL);
    expect(screen.getByText(/genuinely don't look like this person/)).toBeInTheDocument();
  });

  // H12
  it('keeps the shared explanations identical across both modes', () => {
    const guided = renderModal(GUIDED);
    const guidedUnknown = screen.getByText(/you don't know whose it is/).textContent;
    guided.unmount();

    renderModal(MANUAL);
    expect(screen.getByText(/you don't know whose it is/).textContent).toBe(guidedUnknown);
  });

  // H13 — a guard against `mode` being accepted and ignored.
  it('renders differently for the two modes given the same action subset', () => {
    const shared = ['other', 'lock'] as const;

    const guided = renderModal(GUIDED, { actions: [...shared] });
    const guidedText = screen.getByTestId('help-actions').textContent;
    guided.unmount();

    renderModal(MANUAL, { actions: [...shared] });
    expect(screen.getByTestId('help-actions').textContent).not.toBe(guidedText);
  });
});

describe('FaceActionsHelpModal — structure and edges', () => {
  // H9
  it('orders rows by the actions array, not by the registry’s own order', () => {
    renderModal(GUIDED, { actions: ['detach', 'owner'] });

    const rows = screen.getAllByTestId(/^help-row-/).map((row) => row.dataset.testid);
    expect(rows).toEqual(['help-row-detach', 'help-row-owner']);
  });

  // H10
  it('renders intro and footer with no actions at all', () => {
    renderModal(GUIDED, { actions: [] });

    expect(screen.getByTestId('help-actions')).toBeEmptyDOMElement();
    expect(screen.getByTestId('help-footer')).toBeInTheDocument();
  });

  // H8
  it('closes on the close button', async () => {
    const onClose = vi.fn();
    renderModal(GUIDED, { onClose });

    await fireEvent.click(screen.getByTestId('help-close'));

    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/FaceActionsHelpModal.spec.ts
```

Expected: FAIL — `Failed to resolve import "./FaceActionsHelpModal.svelte"`.

- [ ] **Step 3: Write the component**

Create `web/src/lib/components/face-cleanup/FaceActionsHelpModal.svelte`:

```svelte
<script lang="ts">
  import { Button, Icon, Modal, ModalBody, ModalFooter } from '@immich/ui';
  import { mdiInformationOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';
  import { bodyKeyFor, effectKeyFor, FACE_ACTIONS, type FaceActionId, type FaceReviewMode } from './face-actions';

  // ONE modal for both modes (design §3.3), replacing guided's ActionsHelpModal and manual's
  // ManualActionsHelpModal. The two used to be a deliberate fork because their action SETS differ — but the
  // sets are just a prop, and forking the component meant forking every future fix to it as well.
  //
  // What genuinely does differ is three explanations (see face-actions.ts `ModalKey`), and those are resolved
  // per mode rather than collapsed. The action NAME is never re-declared here: each row reuses the button's own
  // label key, so a translated heading can never drift from its translated button.

  interface Props {
    mode: FaceReviewMode;
    actions: FaceActionId[];
    introKey: string;
    footerKey: string;
    /** Renders a "(default)" badge on this action. Manual passes `keep`; guided passes nothing. */
    defaultActionId?: FaceActionId;
    onClose: () => void;
  }

  const { mode, actions, introKey, footerKey, defaultActionId, onClose }: Props = $props();
</script>

<Modal title={$t('admin.face_cleanup_review_help_title')} icon={mdiInformationOutline} {onClose} size="medium">
  <ModalBody>
    <p class="text-sm/relaxed text-gray-600 dark:text-gray-300">{$t(introKey)}</p>

    <div class="mt-2 flex flex-col" data-testid="help-actions">
      {#each actions as id (id)}
        {@const meta = FACE_ACTIONS[id]}
        <div
          class="flex gap-3.5 border-b border-gray-200 py-4 last:border-b-0 dark:border-gray-700"
          data-testid={`help-row-${id}`}
        >
          {#if meta.swatchColor}
            <span
              class="w-[3px] flex-none rounded-full"
              style={`background: ${meta.swatchColor}`}
              data-testid={`help-swatch-${id}`}
            ></span>
          {:else}
            <!-- No rail: `keep` and `unmark` correspond to no coloured tile state, and are signalled by
                 absence exactly as an untouched tile carries no badge or ribbon. -->
            <span class="w-[3px] flex-none rounded-full"></span>
          {/if}

          <div>
            <h3 class="flex items-center gap-2 text-sm font-bold">
              {#if meta.swatchColor && meta.buttonIcon}
                <Icon icon={meta.buttonIcon} size="15" color={meta.swatchColor} />
              {/if}
              {$t(meta.labelKey)}
              {#if id === defaultActionId}
                <span class="text-xs font-normal text-gray-400 dark:text-gray-500" data-testid="help-default-badge">
                  ({$t('admin.face_cleanup_manual_review_help_default_badge')})
                </span>
              {/if}
            </h3>

            <p class="mt-1.5 text-sm/relaxed">{$t(bodyKeyFor(id, mode))}</p>

            <p
              class="mt-2 border-l-2 border-gray-200 pl-3 text-sm/relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400"
              data-testid="help-effect"
            >
              <b class="font-bold text-gray-700 dark:text-gray-200">
                {$t('admin.face_cleanup_review_help_effect_label')}
              </b>
              {$t(effectKeyFor(id, mode))}
            </p>
          </div>
        </div>
      {/each}
    </div>

    <p class="mt-4 text-xs/relaxed text-gray-500 dark:text-gray-400" data-testid="help-footer">{$t(footerKey)}</p>
  </ModalBody>

  <ModalFooter>
    <Button shape="round" fullWidth onclick={onClose} data-testid="help-close">{$t('close')}</Button>
  </ModalFooter>
</Modal>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm exec vitest run src/lib/components/face-cleanup/FaceActionsHelpModal.spec.ts
```

Expected: PASS (20 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/lib/components/face-cleanup/ && cd ..
git add web/src/lib/components/face-cleanup/
git commit -m "feat(face-cleanup): merge the two action-help modals into one mode-aware modal"
```

---

### Task 6: Wire the guided page to the shared dock and modal

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (imports, `handleOpenHelp` at `:265`, footer snippet at `:877-1014`)
- Modify: `web/src/routes/admin/face-cleanup/[personId]/page.spec.ts` — **two existing tests change** (see Step 1), plus G1–G5 appended
- Delete: `web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.svelte`
- Delete: `web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts`

**Interfaces:**

- Consumes: `FaceReviewDock`, `FaceActionsHelpModal`, `FaceActionId` from Tasks 2/4/5.
- Produces: **action** testids unchanged (`bulk-stay`, `bulk-lock`, `bulk-other`, `bulk-unknown`, `bulk-detach`), plus the new `bulk-owner`. Page-owned ids `apply-btn`, `tally`, `tally-added`, `apply-blocked-reason`, `banner-help` unchanged. **Chrome** testids move to the normalised scheme: `dock`→`face-dock`, `bulk-bar`→`face-bulk-bar`, `clear`→`face-bulk-clear`, `bulk-help`→`face-bulk-help`.

> **Mostly a refactor.** Moving the bulk bar into the shared component has no red step of its own — the existing suite (selection, bulk actions, apply, destructive confirm, destinations, rest-of-cluster) is its guard rail and must keep passing untouched. Only the five new assertions below are written test-first.

**Test-harness facts this file already establishes — use them, do not invent helpers:**

- There is **no** `renderPage`/`tile`/`FACE_A` helper. Tests call `render(Page, { props: { data: makePageData() } })`, then `await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3))`, then index into `screen.getAllByTestId('face-tile')`.
- Assert modal calls through **`showModal`** (`page.spec.ts:203`), never `vi.mocked(modalManager.show)` — the file documents at `:199-202` that `vi.mocked` cannot infer a signature for that overloaded generic.
- `$t` is mocked to echo keys, so assert key names, not English.
- The `banner-help` testid is at `[personId]/+page.svelte:610`.

- [ ] **Step 1: Rename the chrome testids this page's spec and the e2e suite reference**

Mechanical, and it must happen before the new tests so they query the right ids. In
`[personId]/page.spec.ts`: `getByTestId('bulk-bar')` → `'face-bulk-bar'` (18 sites), `getByTestId('dock')` →
`'face-dock'` (1), `getByTestId('clear')` → `'face-bulk-clear'` (2), `getByTestId('bulk-help')` →
`'face-bulk-help'` (2). Action ids (`bulk-stay`, `bulk-lock`, `bulk-other`, `bulk-unknown`, `bulk-detach`) and
page ids (`apply-btn`, `tally`, `banner-help`) are **not** touched.

Then the single permitted e2e edit — `e2e/src/specs/web/face-cleanup.e2e-spec.ts:528`:

```ts
const dock = page.locator('[data-testid="face-dock"]');
```

That is the **only** line in `e2e/` this whole plan may change. Every action locator in that file must still
pass untouched.

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: FAIL — the renamed queries find nothing yet, because the page still renders the old ids. That failure
is the red step for the rename; Step 4 makes it green.

- [ ] **Step 2: Rewrite the two existing help-modal assertions**

`page.spec.ts:1222` and `:1234` both assert `expect(showModal).toHaveBeenCalledWith(ActionsHelpModal, {})`. The merged modal takes real props, so both must change — this is the one place in this task where an existing assertion is deliberately rewritten rather than preserved:

```ts
expect(showModal).toHaveBeenCalledWith(FaceActionsHelpModal, expect.objectContaining({ mode: 'guided' }));
```

Swap the file's `import ActionsHelpModal from './ActionsHelpModal.svelte';` for
`import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';`.

- [ ] **Step 3: Append the new tests**

```ts
describe('shared dock', () => {
  const renderAndLoad = async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
  };

  const selectFirstTile = async () => {
    await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
    await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
  };

  // G5 — the one button in either bar that had no testid before this change.
  it('routes the owner action from its own testid', async () => {
    await renderAndLoad();
    await selectFirstTile();

    await fireEvent.click(screen.getByTestId('bulk-owner'));

    expect(screen.getAllByTestId('face-tile')[0]).toHaveAttribute('data-state', 'owner');
  });

  // G1
  it('explains an action on hover, in the bar itself', async () => {
    await renderAndLoad();
    await selectFirstTile();

    await fireEvent.mouseEnter(screen.getByTestId('bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('admin.face_cleanup_action_lock_tip');
    expect(screen.getByTestId('face-bulk-hint')).toHaveTextContent('admin.face_cleanup_review_bulk_hint_effect');
  });

  // G4 — the page passes guided mode. Paired with the manual page's M5, this is what proves the two pages
  // diverge; the component spec alone would pass even if both pages hard-coded one mode.
  it('opens the help modal in guided mode, with guided’s six actions', async () => {
    await renderAndLoad();

    await fireEvent.click(screen.getByTestId('banner-help'));

    expect(showModal).toHaveBeenCalledWith(
      FaceActionsHelpModal,
      expect.objectContaining({
        mode: 'guided',
        actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
      }),
    );
  });

  // G2 + G3
  it('opens the same modal from the bulk bar as from the banner', async () => {
    await renderAndLoad();

    await fireEvent.click(screen.getByTestId('banner-help'));
    const fromBanner = showModal.mock.calls.at(-1);

    await selectFirstTile();
    await fireEvent.click(screen.getByTestId('face-bulk-help'));
    const fromBar = showModal.mock.calls.at(-1);

    expect(fromBar).toEqual(fromBanner);
  });

  // R11 at the level where testids actually live — the registry has none.
  it('gives every dock action a distinct testid', async () => {
    await renderAndLoad();
    await selectFirstTile();

    const ids = ['bulk-owner', 'bulk-stay', 'bulk-lock', 'bulk-other', 'bulk-unknown', 'bulk-detach'];
    for (const id of ids) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/[personId]/page.spec.ts'
```

Expected: FAIL — no `bulk-owner`, no `bulk-popover`, and `modalManager.show` is called with `ActionsHelpModal, {}`.

- [ ] **Step 5: Replace the footer snippet's bulk-bar branch**

In `[personId]/+page.svelte`, replace the whole `{#snippet footer()}` body (`:877-1014`) with:

```svelte
  {#snippet footer()}
    {#if !loading && flaggedFaces.length > 0}
      <FaceReviewDock
        mode="guided"
        selectedCount={vm.selectedCount}
        actions={GUIDED_DOCK_ACTIONS}
        onAction={handleDockAction}
        onHelp={handleOpenHelp}
        onClear={() => vm.clearSelection()}
      >
        {#snippet summary()}
          <div class="flex flex-1 flex-wrap items-center gap-3.5" data-testid="tally">
            {#each ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'] as FaceState[] as state (state)}
              {@const count = vm.tally[state]}
              <span
                class={[
                  'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold dark:border-gray-700 dark:bg-gray-800',
                  count === 0 ? 'opacity-40' : '',
                ].join(' ')}
              >
                <Icon icon={STATE_ICON[state]} size="13" color={STATE_COLOR[state]} />
                <span>{count}</span>
                <span class="font-normal text-gray-500 dark:text-gray-400">
                  {state === 'owner'
                    ? destinations.length > 1
                      ? $t('admin.face_cleanup_review_tally_owner_multi')
                      : $t('admin.face_cleanup_review_tally_owner', { values: { name: ownerName } })
                    : $t(`admin.face_cleanup_review_tally_${state}`)}
                </span>
              </span>
            {/each}
            {#if restSelected.size > 0}
              <!-- Rest-of-cluster faces the admin added: part of the same Apply, so the dock must account for
                   them too — otherwise the count lies about what the button is going to do. -->
              <span
                class="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-bold text-primary"
                data-testid="tally-added"
              >
                <span>+{restSelected.size}</span>
                <span class="font-normal">
                  {canBulkMove
                    ? $t('admin.face_cleanup_review_tally_added', { values: { name: destinationName } })
                    : $t('admin.face_cleanup_review_tally_added_pending')}
                </span>
              </span>
            {/if}
            <span class="inline-flex items-center gap-1.5 text-xs font-bold text-green-600">
              <Icon icon={mdiCheckBold} size="13" />
              {$t('admin.face_cleanup_review_tally_all_set')}
            </span>
          </div>
          {#if restBlocked}
            <!-- The disabled button explains itself right next to it, rather than leaving the admin to guess
                 why Apply won't go. -->
            <span class="text-xs font-semibold text-red-600 dark:text-red-400" data-testid="apply-blocked-reason">
              {$t('admin.face_cleanup_review_apply_blocked_reason')}
            </span>
          {/if}
        {/snippet}

        {#snippet apply()}
          <Button color="primary" disabled={applying || restBlocked} onclick={handleApply} data-testid="apply-btn">
            <Icon icon={mdiArrowRight} size="16" />
            {restSelected.size > 0
              ? $t('admin.face_cleanup_review_apply_label_added', {
                  values: { count: vm.total, added: restSelected.size },
                })
              : $t('admin.face_cleanup_review_apply_label', { values: { count: vm.total } })}
          </Button>
        {/snippet}
      </FaceReviewDock>
    {/if}
  {/snippet}
```

That markup is the current `:886-941` moved verbatim — same testids (`tally`, `tally-added`,
`apply-blocked-reason`, `apply-btn`), same conditions, same strings. Nothing about the summary half changes;
it simply moves inside the snippet.

- [ ] **Step 6: Add the action list and the dispatcher to the `<script>` block**

```ts
import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
import FaceReviewDock from '$lib/components/face-cleanup/FaceReviewDock.svelte';
import type { FaceActionId } from '$lib/components/face-cleanup/face-actions';

// The six guided routes, in bar order. `owner` gains a testid it never had — every other id is preserved
// exactly, because e2e targets these rather than the labels.
const GUIDED_DOCK_ACTIONS = [
  { id: 'owner', testId: 'bulk-owner' },
  { id: 'stay', testId: 'bulk-stay' },
  { id: 'lock', testId: 'bulk-lock' },
  { id: 'other', testId: 'bulk-other' },
  { id: 'unknown', testId: 'bulk-unknown' },
  { id: 'detach', testId: 'bulk-detach' },
] as const satisfies readonly { id: FaceActionId; testId: string }[];

// `other` is the only route that opens a picker first; the rest stamp the selection straight away.
const handleDockAction = (id: FaceActionId) => {
  if (id === 'other') {
    void handleBulkOther();
    return;
  }
  vm.applyToSelection(id as Exclude<FaceActionId, 'other' | 'keep' | 'unmark'>);
};

const handleOpenHelp = () => {
  void modalManager.show(FaceActionsHelpModal, {
    mode: 'guided',
    actions: ['owner', 'stay', 'lock', 'other', 'unknown', 'detach'],
    introKey: 'admin.face_cleanup_review_help_intro',
    footerKey: 'admin.face_cleanup_review_help_footer',
  });
};
```

Delete the now-unused `handleBulkOwner`, `handleBulkStay`, `handleBulkLock`, `handleBulkUnknown`,
`handleBulkDetach` and the `ActionsHelpModal` import.

- [ ] **Step 7: Delete the old modal and its spec**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
git rm 'web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.svelte' \
       'web/src/routes/admin/face-cleanup/[personId]/ActionsHelpModal.spec.ts'
```

- [ ] **Step 8: Run the guided page spec and the e2e locator contract**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/[personId]/'
```

Expected: PASS. Exactly **two** pre-existing assertions were rewritten (Step 1's help-modal props); every other
test in the file — selection, apply, destructive confirm, destinations, rest-of-cluster — must still pass with
no edit at all. If you found yourself changing a third, stop: the dock moved something it shouldn't have.

- [ ] **Step 9: Typecheck and commit**

```bash
cd web && pnpm run check:typescript
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/ && cd ..
git add -A web/src/
git commit -m "refactor(face-cleanup): move the guided review page onto the shared dock and modal"
```

---

### Task 7: Wire the manual page to the shared dock and modal

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/+page.svelte` (imports, `handleOpenHelp` at `:295`, footer snippet at `:622-731`)
- Modify: `web/src/routes/admin/face-cleanup/people/[personId]/page.spec.ts` — **one existing test changes** (see Step 1), plus M1–M7 appended
- Delete: `web/src/routes/admin/face-cleanup/people/[personId]/ManualActionsHelpModal.svelte`
- Delete: `web/src/routes/admin/face-cleanup/people/[personId]/ManualActionsHelpModal.spec.ts`

**Interfaces:**

- Consumes: `FaceReviewDock`, `FaceActionsHelpModal` from Tasks 4/5.
- Produces: **action** testids unchanged (`manual-review-bulk-move`, `-lock`, `-unknown`, `-detach`, `-unmark`). Page-owned ids `manual-review-apply-btn`, `manual-review-tally-*`, `manual-review-help-open`, `manual-review-clear-selection` unchanged. **Chrome** testids move to the normalised scheme: `manual-review-dock`→`face-dock`, `manual-review-bulk-bar`→`face-bulk-bar`, `manual-review-bulk-clear`→`face-bulk-clear`, and the bar's new help button is `face-bulk-help`.

> **Mostly a refactor**, same as Task 6 — the existing suite is the guard rail; only the new assertions are written first.

**Test-harness facts this file already establishes:**

- No `renderPage`/`tile`/`FACE_A`. Tests call `render(Page, { props: { data: makePageData() } })` then `await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3))`. There is a `tileFor(id)` helper at `:172` that queries `[data-testid="face-tile"][data-faceid="…"]`, but indexing `getAllByTestId('face-tile')` is what most tests use.
- Assert modal calls through **`showModal`** (`page.spec.ts:182`), never `vi.mocked(modalManager.show)`.
- This file stubs `Icon` to a no-op, so glyph **identity** is not observable here — M7 asserts only that an element renders. Identity is covered by `FaceReviewDock.spec.ts` D10/D27, which does not stub `Icon`.

- [ ] **Step 1: Rename the chrome testids this page's spec references**

In `people/[personId]/page.spec.ts`: `getByTestId('manual-review-bulk-bar')` → `'face-bulk-bar'` (6 sites),
`getByTestId('manual-review-dock')` → `'face-dock'` (1). Action ids (`manual-review-bulk-move`, `-lock`,
`-unknown`, `-detach`, `-unmark`) and grid-header ids (`manual-review-help-open`,
`manual-review-clear-selection`, `manual-review-apply-btn`, `manual-review-tally-*`) are **not** touched. No
e2e change belongs to this task — Task 6 already made the one permitted edit.

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts'
```

Expected: FAIL — the renamed queries find nothing yet. Step 5 makes it green.

- [ ] **Step 2: Rewrite the existing help-launcher assertion**

`page.spec.ts:1123` asserts `expect(showModal).toHaveBeenCalledWith(ManualActionsHelpModal, {})`. Replace with:

```ts
expect(showModal).toHaveBeenCalledWith(FaceActionsHelpModal, expect.objectContaining({ mode: 'manual' }));
```

Swap the file's `import ManualActionsHelpModal from './ManualActionsHelpModal.svelte';` for
`import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';`.

- [ ] **Step 3: Append the new tests**

```ts
describe('shared dock', () => {
  const renderAndLoad = async () => {
    render(Page, { props: { data: makePageData() } });
    await waitFor(() => expect(screen.getAllByTestId('face-tile')).toHaveLength(3));
  };

  const selectFirstTile = async () => {
    await fireEvent.click(screen.getAllByTestId('face-tile')[0]);
    await waitFor(() => expect(screen.getByTestId('face-bulk-bar')).toBeInTheDocument());
  };

  // M1 — the gap this change closes: manual's bar had no help affordance at all.
  it('offers help from inside the bulk bar, which it never used to', async () => {
    await renderAndLoad();
    await selectFirstTile();

    expect(screen.getByTestId('face-bulk-help')).toBeInTheDocument();
  });

  // M5 — the counterpart to guided's G4.
  it('opens the help modal in manual mode, with manual’s six actions', async () => {
    await renderAndLoad();

    await fireEvent.click(screen.getByTestId('manual-review-help-open'));

    expect(showModal).toHaveBeenCalledWith(
      FaceActionsHelpModal,
      expect.objectContaining({
        mode: 'manual',
        actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
        defaultActionId: 'keep',
      }),
    );
  });

  // M6 — the two modes provably receive different subsets.
  it('asks for neither owner nor stay, and asks for keep and unmark', async () => {
    await renderAndLoad();

    await fireEvent.click(screen.getByTestId('manual-review-help-open'));
    const props = showModal.mock.calls.at(-1)?.[1] as { actions: string[] };

    expect(props.actions).toContain('keep');
    expect(props.actions).toContain('unmark');
    expect(props.actions).not.toContain('owner');
    expect(props.actions).not.toContain('stay');
  });

  // M2
  it('opens the same modal from the grid header as from the bulk bar', async () => {
    await renderAndLoad();

    await fireEvent.click(screen.getByTestId('manual-review-help-open'));
    const fromHeader = showModal.mock.calls.at(-1);

    await selectFirstTile();
    await fireEvent.click(screen.getByTestId('face-bulk-help'));
    const fromBar = showModal.mock.calls.at(-1);

    expect(fromBar).toEqual(fromHeader);
  });

  // M3
  it('explains an action on hover', async () => {
    await renderAndLoad();
    await selectFirstTile();

    await fireEvent.mouseEnter(screen.getByTestId('manual-review-bulk-lock'));

    expect(screen.getByTestId('face-bulk-popover')).toHaveTextContent('admin.face_cleanup_action_lock_tip');
  });

  // M4 — the harmonisation, asserted rather than assumed.
  it('labels its move button with the same key guided uses', async () => {
    await renderAndLoad();
    await selectFirstTile();

    expect(screen.getByTestId('manual-review-bulk-move')).toHaveTextContent('admin.face_cleanup_review_bulk_other');
  });

  // M7 — F2 at the page level. Icon is stubbed here, so this asserts presence, not identity.
  it('keeps a glyph on Unmark after the dock swap', async () => {
    await renderAndLoad();
    await selectFirstTile();

    expect(screen.getByTestId('manual-review-bulk-unmark').firstElementChild).not.toBeNull();
  });

  // R11 at the level where testids actually live.
  it('gives every dock action a distinct testid', async () => {
    await renderAndLoad();
    await selectFirstTile();

    for (const id of [
      'manual-review-bulk-move',
      'manual-review-bulk-lock',
      'manual-review-bulk-unknown',
      'manual-review-bulk-detach',
      'manual-review-bulk-unmark',
    ]) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/people/[personId]/page.spec.ts'
```

Expected: FAIL — no `manual-review-bulk-help`, and `modalManager.show` receives `ManualActionsHelpModal, {}`.

- [ ] **Step 5: Replace the footer snippet's bulk-bar branch**

```svelte
  {#snippet footer()}
    {#if !loading && vm.loadedCount > 0}
      <FaceReviewDock
        mode="manual"
        selectedCount={vm.selectedCount}
        actions={MANUAL_DOCK_ACTIONS}
        onAction={handleDockAction}
        onHelp={handleOpenHelp}
        onClear={() => vm.clearSelection()}
      >
        {#snippet summary()}
          <div class="flex flex-1 flex-wrap items-center gap-3.5" data-testid="manual-review-tally">
            {#each ['move', 'lock', 'unknown', 'detach'] as const as state (state)}
              {@const count = vm.tally[state]}
              <span
                class={[
                  'inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-bold dark:border-gray-700 dark:bg-gray-800',
                  count === 0 ? 'opacity-40' : '',
                ].join(' ')}
                data-testid={`manual-review-tally-${state}`}
              >
                <Icon icon={MANUAL_STATE_ICON[state]} size="13" color={MANUAL_STATE_COLOR[state]} />
                <span>{count}</span>
                <span class="font-normal text-gray-500 dark:text-gray-400"
                  >{$t(`admin.face_cleanup_review_tally_${TALLY_KEY_SUFFIX[state]}`)}</span
                >
              </span>
            {/each}
          </div>
        {/snippet}

        {#snippet apply()}
          <!-- Apply is disabled while everything is `keep`: buildResolveRequest() returns null, and an
               all-keep POST would be an empty resolve the server 400s. -->
          <Button
            color="primary"
            disabled={applying || !vm.hasStagedWork}
            onclick={handleApply}
            data-testid="manual-review-apply-btn"
          >
            <Icon icon={mdiArrowRight} size="16" />
            {$t('admin.face_cleanup_review_apply_label', { values: { count: stagedCount } })}
          </Button>
        {/snippet}
      </FaceReviewDock>
    {/if}
  {/snippet}
```

- [ ] **Step 6: Add the action list, dispatcher and help handler to the `<script>` block**

```ts
import FaceActionsHelpModal from '$lib/components/face-cleanup/FaceActionsHelpModal.svelte';
import FaceReviewDock from '$lib/components/face-cleanup/FaceReviewDock.svelte';
import type { FaceActionId } from '$lib/components/face-cleanup/face-actions';

// Manual's five routes, in bar order. `other` is the registry id behind the button manual calls "Move to
// person…"; its testid stays `manual-review-bulk-move` because e2e targets it.
const MANUAL_DOCK_ACTIONS = [
  { id: 'other', testId: 'manual-review-bulk-move' },
  { id: 'lock', testId: 'manual-review-bulk-lock' },
  { id: 'unknown', testId: 'manual-review-bulk-unknown' },
  { id: 'detach', testId: 'manual-review-bulk-detach' },
  { id: 'unmark', testId: 'manual-review-bulk-unmark' },
] as const satisfies readonly { id: FaceActionId; testId: string }[];

const handleDockAction = (id: FaceActionId) => {
  switch (id) {
    case 'other': {
      void handleBulkMove();
      return;
    }
    case 'unmark': {
      handleBulkUnmark();
      return;
    }
    default: {
      vm.applyToSelection(id as 'lock' | 'unknown' | 'detach');
    }
  }
};

// One handler for BOTH launchers — the grid header's (i) and the new in-bar one — so the two can never
// disagree about which subset the modal shows.
const handleOpenHelp = () => {
  void modalManager.show(FaceActionsHelpModal, {
    mode: 'manual',
    actions: ['keep', 'other', 'lock', 'unknown', 'detach', 'unmark'],
    introKey: 'admin.face_cleanup_manual_review_help_intro',
    footerKey: 'admin.face_cleanup_manual_review_help_footer',
    defaultActionId: 'keep',
  });
};
```

Delete the now-unused `handleBulkLock`, `handleBulkUnknown`, `handleBulkDetach`, the `ManualActionsHelpModal`
import, and the `mdiUndo` import if it is no longer referenced.

- [ ] **Step 7: Delete the old modal and its spec**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
git rm 'web/src/routes/admin/face-cleanup/people/[personId]/ManualActionsHelpModal.svelte' \
       'web/src/routes/admin/face-cleanup/people/[personId]/ManualActionsHelpModal.spec.ts'
```

- [ ] **Step 8: Run the manual page spec**

```bash
cd web && pnpm exec vitest run 'src/routes/admin/face-cleanup/people/[personId]/'
```

Expected: PASS. Exactly **one** pre-existing assertion was rewritten (Step 1's help-launcher props); everything
else in the file must pass with no edit. A third edit means the dock moved something it shouldn't have.

- [ ] **Step 9: Typecheck and commit**

```bash
cd web && pnpm run check:typescript
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/ && cd ..
git add -A web/src/
git commit -m "refactor(face-cleanup): move the manual review page onto the shared dock and modal"
```

---

### Task 8: The always-visible landing page intro

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/+page.svelte:77-94`
- Modify: `web/src/routes/admin/face-cleanup/page.spec.ts:113-152`

**Interfaces:**

- Consumes: the seven `face_cleanup_intro_*` keys from Task 1.
- Produces: nothing other tasks depend on. Removes the last reference to `admin.face_cleanup_mode_first_visit_intro`, which Task 9 then deletes from every locale.

- [ ] **Step 1: Write the failing tests in `page.spec.ts`**

Replace the existing `renders the explanatory header` test and the `does not render the first-visit header`
test with:

```ts
// L1–L3, L7. The intro used to render only on a first visit, so every return visit — which is every visit
// after the first scan — showed two cards and no explanation at all. It is now unconditional.
describe('the explainer', () => {
  const SCAN_STATES = [
    ['no scan yet', null],
    ['pending', makeScan({ status: 'pending' })],
    ['running', makeScan({ status: 'running' })],
    ['failed', makeScan({ status: 'failed' })],
    ['completed', makeScan()],
  ] as const;

  it.each(SCAN_STATES)('explains what the page is for — %s', (_label, scan) => {
    render(Page, { props: { data: makePageData({ scan }) } });

    expect(screen.getByText('admin.face_cleanup_intro_lead')).toBeInTheDocument();
  });

  // L4
  it('covers the scan, the per-face actions, and the scan-free manual route', () => {
    render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    for (const key of [
      'admin.face_cleanup_intro_scan_title',
      'admin.face_cleanup_intro_scan_body',
      'admin.face_cleanup_intro_actions_title',
      'admin.face_cleanup_intro_actions_body',
      'admin.face_cleanup_intro_manual_title',
      'admin.face_cleanup_intro_manual_body',
    ]) {
      expect(screen.getByText(key)).toBeInTheDocument();
    }
  });

  // L5 — read before the choice it informs.
  it('is read before the two cards', () => {
    render(Page, { props: { data: makePageData({ scan: makeScan() }) } });

    const intro = screen.getByTestId('face-cleanup-intro');
    const guided = screen.getByTestId('chooser-card-guided');

    expect(intro.compareDocumentPosition(guided) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // L7 — the replaced string is gone, not merely hidden.
  it.each(SCAN_STATES)('no longer renders the retired first-visit copy — %s', (_label, scan) => {
    render(Page, { props: { data: makePageData({ scan }) } });

    expect(screen.queryByText('admin.face_cleanup_mode_first_visit_intro')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd web && pnpm exec vitest run src/routes/admin/face-cleanup/page.spec.ts
```

Expected: FAIL — `admin.face_cleanup_intro_lead` is not in the document.

- [ ] **Step 3: Replace the header block**

In `+page.svelte`, replace lines 77–94 with:

```svelte
    <!-- Header. The last-scan chip stays on the right; the explainer below is unconditional (design §3.4) —
         it used to be gated on `firstVisit`, which hid it from every visit after the first scan. -->
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <h1 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-white">{$t('admin.face_cleanup')}</h1>
      {#if !firstVisit && scan?.finishedAt}
        <span
          class="inline-flex flex-none items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400"
        >
          <span class="size-1.5 rounded-full bg-gray-400"></span>
          {$t('admin.face_cleanup_last_scan')} · {formatDate(scan.finishedAt)}
        </span>
      {/if}
    </div>

    <div class="mb-8 max-w-4xl" data-testid="face-cleanup-intro">
      <p class="text-sm/relaxed text-gray-500 dark:text-gray-400">{$t('admin.face_cleanup_intro_lead')}</p>

      <div class="mt-5 grid gap-4 sm:grid-cols-3">
        {@render introPoint(mdiRadar, 'scan')}
        {@render introPoint(mdiSwapHorizontal, 'actions')}
        {@render introPoint(mdiAccountSearch, 'manual')}
      </div>
    </div>
```

`admin.face_cleanup_last_scan` is the key the file uses today (`+page.svelte:91`); it is unchanged by this
task. The `firstVisit` derivation stays in the `<script>` block — it still gates the last-scan chip, it just no
longer gates the explainer.

- [ ] **Step 4: Add the `introPoint` snippet and the icon import**

Above the `<AdminPageLayout>` element, next to the existing `statusChip` snippet:

```svelte
{#snippet introPoint(icon: string, slug: 'scan' | 'actions' | 'manual')}
  <div class="flex gap-3">
    <div
      class="flex size-8 flex-none items-center justify-center rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
    >
      <Icon {icon} size="16" />
    </div>
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-gray-900 dark:text-white">
        {$t(`admin.face_cleanup_intro_${slug}_title`)}
      </h3>
      <p class="mt-1 text-xs/relaxed text-gray-500 dark:text-gray-400">
        {$t(`admin.face_cleanup_intro_${slug}_body`)}
      </p>
    </div>
  </div>
{/snippet}
```

Add `mdiSwapHorizontal` to the `@mdi/js` import (`mdiAccountSearch` and `mdiRadar` are already imported).

The ``$t(`…${slug}…`)`` template form is deliberate and already used elsewhere in this feature — `slug` is a
string-literal union, so `$t` still receives its generated key union rather than a widened `string`.

- [ ] **Step 5: Run to verify it passes**

```bash
cd web && pnpm exec vitest run src/routes/admin/face-cleanup/page.spec.ts
```

Expected: PASS, including every pre-existing card and CTA test (L6).

- [ ] **Step 6: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
cd web && pnpm exec prettier --write src/routes/admin/face-cleanup/ && cd ..
git add web/src/routes/admin/face-cleanup/
git commit -m "feat(face-cleanup): explain the console permanently on the landing page"
```

---

### Task 9: Translations for all nine locales, plus the i18n guards

**Files:**

- Modify: `i18n/en.json` (remove 4 dead keys)
- Modify: `i18n/{de,es,fr,it,nl,pl,ru,zh_Hans,zh_Hant}.json` (17 new keys, 3 reworded values, 4 removals each)
- Create: `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`

**Interfaces:**

- Consumes: the key set from Tasks 1–8.
- Produces: nothing code-facing.

Removals happen here because Task 8 removed the last `first_visit_intro` reference and Task 7 the last
`manual_review_bulk_*` reference. Removing earlier would have rendered raw keys at a user.

- [ ] **Step 1: Write the failing guard**

Create `web/src/lib/i18n/face-cleanup-i18n-coverage.spec.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Three things the existing i18n guards cannot see, all of which this feature can get wrong:
//
// I6  fork-string-parity derives its key set from "at least one of the nine has it", so a key translated into
//     NONE of the nine is simply not a fork string and passes silently. This asserts presence directly.
// I3b parity only detects a key MISSING from a locale that others still have — never a LEFTOVER. A stale
//     `face_cleanup_manual_review_bulk_move` in one locale is invisible to every existing test.
// I7  no guard can see that a reworded English value left its nine translations describing the old wording.
//     A test cannot diff against a value the file no longer holds, so this checks the old shape instead.

const I18N_DIR = path.resolve(process.cwd(), '../i18n');
const TRANSLATED = ['de', 'es', 'fr', 'it', 'nl', 'pl', 'ru', 'zh_Hans', 'zh_Hant'];

const admin = (code: string): Record<string, string> =>
  (JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8')) as { admin: Record<string, string> }).admin;

const NEW_KEYS = [
  'face_cleanup_action_detach_tip',
  'face_cleanup_action_keep_tip',
  'face_cleanup_action_lock_tip',
  'face_cleanup_action_other_tip',
  'face_cleanup_action_owner_tip',
  'face_cleanup_action_stay_tip',
  'face_cleanup_action_unknown_tip',
  'face_cleanup_action_unmark_tip',
  'face_cleanup_intro_actions_body',
  'face_cleanup_intro_actions_title',
  'face_cleanup_intro_lead',
  'face_cleanup_intro_manual_body',
  'face_cleanup_intro_manual_title',
  'face_cleanup_intro_scan_body',
  'face_cleanup_intro_scan_title',
  'face_cleanup_review_bulk_hint_default',
  'face_cleanup_review_bulk_hint_effect',
];

const REMOVED_KEYS = [
  'face_cleanup_mode_first_visit_intro',
  'face_cleanup_manual_review_bulk_move',
  'face_cleanup_manual_review_bulk_lock',
  'face_cleanup_manual_review_bulk_unknown',
];

describe('face cleanup i18n coverage', () => {
  // I6
  it.each(['en', ...TRANSLATED])('%s carries every new face-cleanup string', (code) => {
    const messages = admin(code);
    const missing = NEW_KEYS.filter((key) => !Object.hasOwn(messages, key));

    expect(missing, `${code}.json is missing: ${missing.join(', ')}`).toEqual([]);
  });

  // I3b
  it.each(['en', ...TRANSLATED])('%s has dropped every retired face-cleanup string', (code) => {
    const messages = admin(code);
    const leftover = REMOVED_KEYS.filter((key) => Object.hasOwn(messages, key));

    expect(leftover, `${code}.json still carries: ${leftover.join(', ')}`).toEqual([]);
  });

  // I7 — the reworded labels dropped their arrow/slash shape in every locale, not just English.
  it.each(['en', ...TRANSLATED])('%s rewords the harmonised bulk labels rather than keeping the old shape', (code) => {
    const messages = admin(code);

    expect(messages.face_cleanup_review_bulk_owner).not.toContain('→');
    expect(messages.face_cleanup_review_bulk_other).not.toContain('→');
    expect(messages.face_cleanup_review_bulk_lock).not.toContain('/');
  });

  // The ICU argument names must survive translation verbatim, or svelte-i18n prints literal braces.
  it.each(['en', ...TRANSLATED])('%s keeps the hint row’s ICU argument names untranslated', (code) => {
    const hint = admin(code).face_cleanup_review_bulk_hint_effect;

    expect(hint).toContain('{action}');
    expect(hint).toContain('{effect}');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd web && pnpm exec vitest run src/lib/i18n/face-cleanup-i18n-coverage.spec.ts
```

Expected: FAIL on all four groups for the nine locales, and on the removal/rewording groups for `en`.

- [ ] **Step 3: Remove the four retired keys from `en.json` and all nine locale files**

Delete these lines wherever they appear in `i18n/en.json` and each of the nine:

```
"face_cleanup_mode_first_visit_intro"
"face_cleanup_manual_review_bulk_move"
"face_cleanup_manual_review_bulk_lock"
"face_cleanup_manual_review_bulk_unknown"
```

- [ ] **Step 4: Reword the three harmonised labels in the nine locales**

| Locale  | `…_bulk_owner`                  | `…_bulk_lock`                | `…_bulk_other`                |
| ------- | ------------------------------- | ---------------------------- | ----------------------------- |
| de      | `Zum Eigentümer verschieben`    | `Bestätigen & sperren`       | `Zu Person verschieben…`      |
| es      | `Mover al propietario`          | `Confirmar y bloquear`       | `Mover a persona…`            |
| fr      | `Déplacer vers le propriétaire` | `Confirmer et verrouiller`   | `Déplacer vers une personne…` |
| it      | `Sposta al proprietario`        | `Conferma e blocca`          | `Sposta a persona…`           |
| nl      | `Naar eigenaar verplaatsen`     | `Bevestigen en vergrendelen` | `Naar persoon verplaatsen…`   |
| pl      | `Przenieś do właściciela`       | `Potwierdź i zablokuj`       | `Przenieś do osoby…`          |
| ru      | `Переместить владельцу`         | `Подтвердить и закрепить`    | `Переместить человеку…`       |
| zh_Hans | `移动到所有者`                  | `确认并锁定`                 | `移动到人物…`                 |
| zh_Hant | `移動到擁有者`                  | `確認並鎖定`                 | `移動到人物…`                 |

- [ ] **Step 5: Add the eight tooltip strings to each locale**

```json
// de
"face_cleanup_action_detach_tip": "Überhaupt keine Gesichter. Unwiderruflich — der Ausschnitt wird endgültig stillgelegt.",
"face_cleanup_action_keep_tip": "Die Voreinstellung. Ein unberührtes Gesicht bleibt genau so, wie es ist.",
"face_cleanup_action_lock_tip": "Dauerhaft hier verankern, damit kein künftiger Scan sie noch markieren kann.",
"face_cleanup_action_other_tip": "Wähle, zu wem sie gehören — jede Person der Bibliothek oder eine neue.",
"face_cleanup_action_owner_tip": "Zu der Person verschieben, für die der Scan sie tatsächlich hält.",
"face_cleanup_action_stay_tip": "Sie gehören wirklich zu dieser Person — den Vorschlag des Scans ablehnen.",
"face_cleanup_action_unknown_tip": "Echte Gesichter, aber nicht diese Person — und du kennst den Namen nicht.",
"face_cleanup_action_unmark_tip": "Rückgängig — die Auswahl auf unberührt zurücksetzen.",

// es
"face_cleanup_action_detach_tip": "No son caras en absoluto. Irreversible: el recorte se retira definitivamente.",
"face_cleanup_action_keep_tip": "La opción por defecto. Una cara sin tocar se deja exactamente como está.",
"face_cleanup_action_lock_tip": "Fíjalas aquí de forma permanente, para que ningún análisis futuro las marque.",
"face_cleanup_action_other_tip": "Elige a quién pertenecen: cualquiera de la biblioteca o una persona nueva.",
"face_cleanup_action_owner_tip": "Muévelas a la persona que el análisis cree que son en realidad.",
"face_cleanup_action_stay_tip": "Sí son esta persona: rechaza la sugerencia del análisis.",
"face_cleanup_action_unknown_tip": "Caras reales, pero no de esta persona, y no sabes de quién son.",
"face_cleanup_action_unmark_tip": "Deshacer: devuelve la selección a sin tocar.",

// fr
"face_cleanup_action_detach_tip": "Pas des visages du tout. Irréversible : le recadrage est retiré définitivement.",
"face_cleanup_action_keep_tip": "Le comportement par défaut. Un visage non touché reste exactement tel quel.",
"face_cleanup_action_lock_tip": "Fixez-les ici définitivement, pour qu'aucune analyse future ne les signale.",
"face_cleanup_action_other_tip": "Choisissez à qui ils appartiennent : n'importe qui dans la bibliothèque, ou une nouvelle personne.",
"face_cleanup_action_owner_tip": "Déplacez-les vers la personne que l'analyse croit reconnaître.",
"face_cleanup_action_stay_tip": "Il s'agit bien de cette personne — refusez la suggestion de l'analyse.",
"face_cleanup_action_unknown_tip": "De vrais visages, mais pas cette personne, et vous ignorez de qui il s'agit.",
"face_cleanup_action_unmark_tip": "Annuler — ramène la sélection à l'état non touché.",

// it
"face_cleanup_action_detach_tip": "Non sono affatto volti. Irreversibile: il ritaglio viene ritirato per sempre.",
"face_cleanup_action_keep_tip": "L'impostazione predefinita. Un volto non toccato resta esattamente com'è.",
"face_cleanup_action_lock_tip": "Fissali qui in modo permanente, così nessuna scansione futura potrà segnalarli.",
"face_cleanup_action_other_tip": "Scegli a chi appartengono: chiunque nella libreria, o una persona nuova.",
"face_cleanup_action_owner_tip": "Spostali alla persona che la scansione ritiene siano davvero.",
"face_cleanup_action_stay_tip": "Sono davvero questa persona — rifiuta il suggerimento della scansione.",
"face_cleanup_action_unknown_tip": "Volti veri, ma non questa persona, e non sai di chi siano.",
"face_cleanup_action_unmark_tip": "Annulla — riporta la selezione allo stato non toccato.",

// nl
"face_cleanup_action_detach_tip": "Helemaal geen gezichten. Onomkeerbaar — de uitsnede wordt definitief ingetrokken.",
"face_cleanup_action_keep_tip": "De standaard. Een onaangeroerd gezicht blijft precies zoals het is.",
"face_cleanup_action_lock_tip": "Zet ze hier permanent vast, zodat geen enkele volgende scan ze nog markeert.",
"face_cleanup_action_other_tip": "Kies bij wie ze horen — iedereen in de bibliotheek, of een nieuw persoon.",
"face_cleanup_action_owner_tip": "Verplaats ze naar de persoon die de scan denkt te herkennen.",
"face_cleanup_action_stay_tip": "Ze zijn wel degelijk deze persoon — wijs de suggestie van de scan af.",
"face_cleanup_action_unknown_tip": "Echte gezichten, maar niet deze persoon, en je kent de naam niet.",
"face_cleanup_action_unmark_tip": "Ongedaan maken — zet de selectie terug op onaangeroerd.",

// pl
"face_cleanup_action_detach_tip": "To wcale nie twarze. Nieodwracalne — kadr zostaje wycofany na stałe.",
"face_cleanup_action_keep_tip": "Domyślne zachowanie. Nietknięta twarz zostaje dokładnie taka, jaka jest.",
"face_cleanup_action_lock_tip": "Przypnij je tutaj na stałe, aby żaden przyszły skan ich nie oznaczył.",
"face_cleanup_action_other_tip": "Wybierz, do kogo należą — dowolnej osoby w bibliotece albo nowej.",
"face_cleanup_action_owner_tip": "Przenieś je do osoby, za którą skan naprawdę je uważa.",
"face_cleanup_action_stay_tip": "To naprawdę ta osoba — odrzuć sugestię skanu.",
"face_cleanup_action_unknown_tip": "Prawdziwe twarze, ale nie ta osoba, i nie wiesz, czyje są.",
"face_cleanup_action_unmark_tip": "Cofnij — przywróć zaznaczenie do stanu nietkniętego.",

// ru
"face_cleanup_action_detach_tip": "Это вообще не лица. Необратимо — фрагмент выводится из обращения навсегда.",
"face_cleanup_action_keep_tip": "Поведение по умолчанию. Нетронутое лицо остаётся ровно таким, как есть.",
"face_cleanup_action_lock_tip": "Закрепить их здесь навсегда, чтобы ни один будущий скан их не пометил.",
"face_cleanup_action_other_tip": "Выберите, кому они принадлежат — любому в библиотеке или новому человеку.",
"face_cleanup_action_owner_tip": "Переместить их человеку, которым скан их и считает.",
"face_cleanup_action_stay_tip": "Это действительно этот человек — отклонить предложение скана.",
"face_cleanup_action_unknown_tip": "Настоящие лица, но не этот человек, и вы не знаете, чьи они.",
"face_cleanup_action_unmark_tip": "Отменить — вернуть выделение в нетронутое состояние.",

// zh_Hans
"face_cleanup_action_detach_tip": "根本不是人脸。不可撤销——该裁剪将被永久停用。",
"face_cleanup_action_keep_tip": "默认行为。未处理的人脸将原样保留。",
"face_cleanup_action_lock_tip": "将它们永久固定在此，任何后续扫描都无法再标记。",
"face_cleanup_action_other_tip": "选择它们属于谁——媒体库中的任何人，或新建一个人物。",
"face_cleanup_action_owner_tip": "移动到扫描认为它们实际所属的人物。",
"face_cleanup_action_stay_tip": "它们确实是此人——拒绝扫描的建议。",
"face_cleanup_action_unknown_tip": "是真实人脸，但不是此人，而你也叫不出名字。",
"face_cleanup_action_unmark_tip": "撤销——将所选恢复为未处理。",

// zh_Hant
"face_cleanup_action_detach_tip": "根本不是臉孔。不可復原——該裁切將被永久停用。",
"face_cleanup_action_keep_tip": "預設行為。未處理的臉孔會原樣保留。",
"face_cleanup_action_lock_tip": "將它們永久固定於此，任何後續掃描都無法再標記。",
"face_cleanup_action_other_tip": "選擇它們屬於誰——媒體庫中的任何人，或新建一個人物。",
"face_cleanup_action_owner_tip": "移動到掃描認為它們實際所屬的人物。",
"face_cleanup_action_stay_tip": "它們確實是此人——拒絕掃描的建議。",
"face_cleanup_action_unknown_tip": "是真實臉孔，但不是此人，而你也叫不出名字。",
"face_cleanup_action_unmark_tip": "復原——將所選恢復為未處理。",
```

- [ ] **Step 6: Add the seven intro strings and two hint strings to each locale**

`{action}` and `{effect}` stay verbatim in every locale.

```json
// de
"face_cleanup_intro_actions_body": "Schicke ein Gesicht zu der Person, zu der es wirklich gehört (oder zu einer ganz neuen), parke es als unbekannte Person, lass es, wo es ist, sperre es, damit kein künftiger Scan es erneut infrage stellt, oder verwirf es, wenn es gar kein echtes Gesicht ist.",
"face_cleanup_intro_actions_title": "Jedes Gesicht liegt in deiner Hand",
"face_cleanup_intro_lead": "Die Gesichtserkennung ordnet erkannte Gesichter eigenständig Personen zu und geht dabei bewusst vorsichtig vor: eine falsche Zuordnung ist später weit schwerer zu entwirren als eine, die nie getroffen wurde. Deshalb lässt sie die Zweifelsfälle lieber stehen, statt zu raten. Auf dieser Seite entscheidest du sie.",
"face_cleanup_intro_manual_body": "Die manuelle Prüfung überspringt den Scan vollständig: Wähle eine beliebige Person und gehe ihre Gesichter selbst durch — mit denselben Aktionen. Nichts wird geschrieben, bis du auf Anwenden klickst.",
"face_cleanup_intro_manual_title": "Oder prüfe jederzeit jede Person",
"face_cleanup_intro_scan_body": "Die geführte Bereinigung prüft die Bibliothek erneut und markiert Gesichter, die jemand anderem ähnlicher sehen als der Person, unter der sie abgelegt sind. Sie ändert nichts — sie bringt dir nur die Auswahlliste.",
"face_cleanup_intro_scan_title": "Ein Scan findet die Zweifelsfälle",
"face_cleanup_review_bulk_hint_default": "Nichts wird geschrieben, bis du auf Anwenden klickst. Fahre über eine Aktion, um zu sehen, was sie bewirkt.",
"face_cleanup_review_bulk_hint_effect": "{action} · Beim Anwenden: {effect}",

// es
"face_cleanup_intro_actions_body": "Envía una cara a la persona a la que realmente pertenece (o a una nueva), apárcala como persona desconocida, déjala donde está, bloquéala para que ningún análisis futuro vuelva a cuestionarla, o descártala si no es una cara real.",
"face_cleanup_intro_actions_title": "Cada cara está en tus manos",
"face_cleanup_intro_lead": "El reconocimiento facial agrupa por su cuenta las caras detectadas en personas, y lo hace con deliberada cautela: deshacer una asignación equivocada cuesta mucho más que no haberla hecho nunca. Por eso deja en paz los casos dudosos en lugar de adivinar. Esta página es donde tú los resuelves.",
"face_cleanup_intro_manual_body": "La revisión manual se salta el análisis por completo: elige cualquier persona y repasa sus caras tú mismo, con las mismas acciones. No se escribe nada hasta que pulsas Aplicar.",
"face_cleanup_intro_manual_title": "O revisa a quien quieras, cuando quieras",
"face_cleanup_intro_scan_body": "La limpieza guiada vuelve a revisar la biblioteca y marca las caras que se parecen más a otra persona que a aquella bajo la que están archivadas. No cambia nada: solo te trae la lista.",
"face_cleanup_intro_scan_title": "Un análisis encuentra los casos dudosos",
"face_cleanup_review_bulk_hint_default": "No se escribe nada hasta que pulsas Aplicar. Pasa el cursor sobre una acción para ver qué hará.",
"face_cleanup_review_bulk_hint_effect": "{action} · Al aplicar: {effect}",

// fr
"face_cleanup_intro_actions_body": "Envoyez un visage vers la personne à qui il appartient vraiment (ou vers une toute nouvelle), garez-le comme personne inconnue, laissez-le où il est, verrouillez-le pour qu'aucune analyse future ne le remette en cause, ou écartez-le si ce n'est pas un vrai visage.",
"face_cleanup_intro_actions_title": "Chaque visage vous revient",
"face_cleanup_intro_lead": "La reconnaissance faciale regroupe d'elle-même les visages détectés en personnes, et elle le fait avec une prudence délibérée : une attribution erronée est bien plus difficile à démêler ensuite qu'une attribution jamais faite. Elle laisse donc les cas douteux de côté plutôt que de deviner. C'est ici que vous les tranchez.",
"face_cleanup_intro_manual_body": "La révision manuelle se passe totalement d'analyse : choisissez n'importe quelle personne et parcourez ses visages vous-même, avec les mêmes actions. Rien n'est écrit tant que vous n'avez pas appuyé sur Appliquer.",
"face_cleanup_intro_manual_title": "Ou auditez qui vous voulez, quand vous voulez",
"face_cleanup_intro_scan_body": "Le nettoyage guidé réexamine la bibliothèque et signale les visages qui ressemblent davantage à quelqu'un d'autre qu'à la personne sous laquelle ils sont classés. Il ne change rien : il vous apporte simplement la liste.",
"face_cleanup_intro_scan_title": "Une analyse trouve les cas douteux",
"face_cleanup_review_bulk_hint_default": "Rien n'est écrit tant que vous n'avez pas appuyé sur Appliquer. Survolez une action pour voir ce qu'elle fera.",
"face_cleanup_review_bulk_hint_effect": "{action} · À l'application : {effect}",

// it
"face_cleanup_intro_actions_body": "Manda un volto alla persona a cui appartiene davvero (o a una del tutto nuova), parcheggialo come persona sconosciuta, lascialo dov'è, bloccalo perché nessuna scansione futura lo rimetta in discussione, oppure scartalo se non è affatto un volto.",
"face_cleanup_intro_actions_title": "Ogni volto è nelle tue mani",
"face_cleanup_intro_lead": "Il riconoscimento facciale raggruppa da solo i volti rilevati in persone, e lo fa con deliberata prudenza: un'assegnazione sbagliata è molto più difficile da districare in seguito di una mai fatta. Perciò lascia stare i casi dubbi invece di tirare a indovinare. Questa pagina è dove li decidi tu.",
"face_cleanup_intro_manual_body": "La revisione manuale salta del tutto la scansione: scegli una persona qualsiasi e passa in rassegna i suoi volti tu stesso, con le stesse azioni. Nulla viene scritto finché non premi Applica.",
"face_cleanup_intro_manual_title": "Oppure controlla chiunque, quando vuoi",
"face_cleanup_intro_scan_body": "La pulizia guidata ricontrolla la libreria e segnala i volti che somigliano a qualcun altro più che alla persona sotto cui sono archiviati. Non cambia nulla: ti porta soltanto l'elenco.",
"face_cleanup_intro_scan_title": "Una scansione trova i casi dubbi",
"face_cleanup_review_bulk_hint_default": "Nulla viene scritto finché non premi Applica. Passa sopra un'azione per vedere cosa farà.",
"face_cleanup_review_bulk_hint_effect": "{action} · All'applicazione: {effect}",

// nl
"face_cleanup_intro_actions_body": "Stuur een gezicht naar de persoon bij wie het echt hoort (of naar een gloednieuwe), parkeer het als onbekend persoon, laat het staan waar het staat, vergrendel het zodat geen enkele volgende scan het opnieuw ter discussie stelt, of gooi het weg als het helemaal geen gezicht is.",
"face_cleanup_intro_actions_title": "Elk gezicht ligt in jouw handen",
"face_cleanup_intro_lead": "Gezichtsherkenning deelt gedetecteerde gezichten zelf in bij personen, en doet dat bewust voorzichtig: een verkeerde toewijzing is later veel lastiger te ontwarren dan een die nooit is gemaakt. Twijfelgevallen laat ze daarom liever met rust dan te gokken. Op deze pagina beslis jij ze.",
"face_cleanup_intro_manual_body": "Handmatige controle slaat de scan volledig over: kies een willekeurige persoon en loop zelf door hun gezichten, met dezelfde acties. Er wordt niets weggeschreven tot je op Toepassen drukt.",
"face_cleanup_intro_manual_title": "Of controleer iedereen, wanneer je wilt",
"face_cleanup_intro_scan_body": "Begeleide opschoning controleert de bibliotheek opnieuw en markeert gezichten die meer op iemand anders lijken dan op de persoon onder wie ze zijn opgeslagen. Er verandert niets — je krijgt alleen de shortlist.",
"face_cleanup_intro_scan_title": "Een scan vindt de twijfelgevallen",
"face_cleanup_review_bulk_hint_default": "Er wordt niets weggeschreven tot je op Toepassen drukt. Beweeg over een actie om te zien wat die doet.",
"face_cleanup_review_bulk_hint_effect": "{action} · Bij toepassen: {effect}",

// pl
"face_cleanup_intro_actions_body": "Wyślij twarz do osoby, do której naprawdę należy (albo do zupełnie nowej), odłóż ją jako nieznaną osobę, zostaw tam, gdzie jest, zablokuj, by żaden przyszły skan już jej nie podważał, albo odrzuć, jeśli to wcale nie twarz.",
"face_cleanup_intro_actions_title": "Każda twarz należy do ciebie",
"face_cleanup_intro_lead": "Rozpoznawanie twarzy samo grupuje wykryte twarze w osoby i robi to rozmyślnie ostrożnie: błędne przypisanie jest później znacznie trudniej rozplątać niż takie, którego nigdy nie dokonano. Dlatego przypadki wątpliwe zostawia w spokoju, zamiast zgadywać. Na tej stronie rozstrzygasz je ty.",
"face_cleanup_intro_manual_body": "Przegląd ręczny całkowicie pomija skanowanie: wybierz dowolną osobę i przejrzyj jej twarze samodzielnie, tymi samymi akcjami. Nic nie zostaje zapisane, dopóki nie naciśniesz Zastosuj.",
"face_cleanup_intro_manual_title": "Albo sprawdź kogokolwiek, kiedy chcesz",
"face_cleanup_intro_scan_body": "Przewodnik po czyszczeniu ponownie sprawdza bibliotekę i oznacza twarze, które bardziej przypominają kogoś innego niż osobę, pod którą je zapisano. Niczego nie zmienia — po prostu przynosi ci listę.",
"face_cleanup_intro_scan_title": "Skan znajduje przypadki wątpliwe",
"face_cleanup_review_bulk_hint_default": "Nic nie zostaje zapisane, dopóki nie naciśniesz Zastosuj. Najedź na akcję, aby zobaczyć, co zrobi.",
"face_cleanup_review_bulk_hint_effect": "{action} · Po zastosowaniu: {effect}",

// ru
"face_cleanup_intro_actions_body": "Отправьте лицо человеку, которому оно действительно принадлежит (или совершенно новому), отложите его как неизвестного человека, оставьте на месте, закрепите, чтобы будущие сканы его больше не оспаривали, или отбросьте, если это вовсе не лицо.",
"face_cleanup_intro_actions_title": "Каждое лицо — за вами",
"face_cleanup_intro_lead": "Распознавание лиц само собирает найденные лица в людей и делает это намеренно осторожно: ошибочную привязку потом распутать намного труднее, чем ту, которой никогда не было. Поэтому спорные случаи оно оставляет в покое, а не гадает. На этой странице их решаете вы.",
"face_cleanup_intro_manual_body": "Ручная проверка полностью обходится без скана: выберите любого человека и просмотрите его лица сами, теми же действиями. Ничего не записывается, пока вы не нажмёте «Применить».",
"face_cleanup_intro_manual_title": "Или проверьте кого угодно и когда угодно",
"face_cleanup_intro_scan_body": "Пошаговая очистка заново проверяет библиотеку и помечает лица, которые больше похожи на кого-то другого, чем на человека, за которым они числятся. Она ничего не меняет — только приносит вам список.",
"face_cleanup_intro_scan_title": "Скан находит спорные случаи",
"face_cleanup_review_bulk_hint_default": "Ничего не записывается, пока вы не нажмёте «Применить». Наведите курсор на действие, чтобы увидеть, что оно сделает.",
"face_cleanup_review_bulk_hint_effect": "{action} · При применении: {effect}",

// zh_Hans
"face_cleanup_intro_actions_body": "把一张人脸移到它真正所属的人物（或新建一个），将它暂存为未知人物，保留原样，锁定它以免日后的扫描再度质疑，或者在它根本不是人脸时将其丢弃。",
"face_cleanup_intro_actions_title": "每一张人脸都由你决定",
"face_cleanup_intro_lead": "人脸识别会自行把检测到的人脸归入各个人物，并且刻意保持谨慎：错误的归属日后远比从未归属更难理清。因此对拿不准的情况，它宁可放着不动，也不去猜。这个页面就是让你来定夺的地方。",
"face_cleanup_intro_manual_body": "手动复核完全跳过扫描：挑选任意人物，用同样的操作亲自逐张过一遍。在你按下「应用」之前，不会写入任何内容。",
"face_cleanup_intro_manual_title": "或者随时复核任何人",
"face_cleanup_intro_scan_body": "引导式清理会重新检查媒体库，标记出那些与他人更相像、而非与其归属人物更相像的人脸。它不做任何更改——只是把候选清单交给你。",
"face_cleanup_intro_scan_title": "扫描找出拿不准的情况",
"face_cleanup_review_bulk_hint_default": "在你按下「应用」之前，不会写入任何内容。将指针悬停在某个操作上即可查看它的作用。",
"face_cleanup_review_bulk_hint_effect": "{action} · 应用后：{effect}",

// zh_Hant
"face_cleanup_intro_actions_body": "把一張臉孔移到它真正所屬的人物（或新建一個），將它暫存為未知人物，保留原樣，鎖定它以免日後的掃描再度質疑，或者在它根本不是臉孔時將其捨棄。",
"face_cleanup_intro_actions_title": "每一張臉孔都由你決定",
"face_cleanup_intro_lead": "臉部辨識會自行把偵測到的臉孔歸入各個人物，並且刻意保持謹慎：錯誤的歸屬日後遠比從未歸屬更難理清。因此對拿不準的情況，它寧可放著不動，也不去猜。這個頁面就是讓你來定奪的地方。",
"face_cleanup_intro_manual_body": "手動複查完全跳過掃描：挑選任意人物，用同樣的操作親自逐張看過一遍。在你按下「套用」之前，不會寫入任何內容。",
"face_cleanup_intro_manual_title": "或者隨時複查任何人",
"face_cleanup_intro_scan_body": "引導式清理會重新檢查媒體庫，標記出那些與他人更相像、而非與其歸屬人物更相像的臉孔。它不做任何變更——只是把候選清單交給你。",
"face_cleanup_intro_scan_title": "掃描找出拿不準的情況",
"face_cleanup_review_bulk_hint_default": "在你按下「套用」之前，不會寫入任何內容。將指標懸停在某個操作上即可查看它的作用。",
"face_cleanup_review_bulk_hint_effect": "{action} · 套用後：{effect}",
```

Insert each block into that locale's `admin` object in alphabetical order.

- [ ] **Step 7: Run the new guard and every existing i18n guard**

```bash
cd web && pnpm exec vitest run src/lib/i18n/
```

Expected: PASS — all five green, each covering a distinct spec requirement:
`face-cleanup-i18n-coverage` (I3b, I6, I7), `fork-string-parity` (I3), `placeholders` (I4),
`face-cleanup-plurals` (I5), and `slice-12-key-audit` (**I1** — both review pages still reference at least one
`$t` key directly after the dock move, and every key they reference exists in `en.json`).

- [ ] **Step 8: Commit**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
npx prettier --write i18n/ && cd web && pnpm exec prettier --write src/lib/i18n/ && cd ..
git add i18n/ web/src/lib/i18n/
git commit -m "i18n(face-cleanup): translate the new console strings into all nine fork locales"
```

---

### Task 10: Full gate

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run the whole web unit suite**

```bash
cd web && pnpm exec vitest run
```

Expected: PASS. Investigate any failure outside face-cleanup — it means a shared token or key leaked.

- [ ] **Step 2: Typecheck and lint**

```bash
cd web && pnpm run check:typescript && pnpm run lint && pnpm run format
```

Expected: all clean. `check:svelte` is a push-only gate — it scans 0 files locally, so do not treat a local
pass as evidence.

- [ ] **Step 3: Run the e2e face-cleanup suite unmodified**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
git diff --stat e8cf0381168 -- e2e/
```

Expected: **exactly one file, one changed line** — `face-cleanup.e2e-spec.ts:528`, the `dock` → `face-dock`
locator. Anything more means an action locator moved, which is the one thing this refactor must not do. Verify
with `git diff e8cf0381168 -- e2e/` before continuing. Then, against a running `make e2e` stack:

```bash
make e2e-web-dev
```

Expected: PASS. This is the acceptance signal for the dock merge.

- [ ] **Step 4: Manual verification on the dev stack** (spec §5.9)

Start `make dev`, sign in as an admin, and check by hand:

- Popover placement on the first and last button in the bar, and on a bar wrapped to two rows at a narrow width — it must not clip at the viewport edge.
- Light and dark theme on both docks and on the intro block.
- The hint row does not change the dock's height when swapping between the shortest and the longest effect string.
- Touch (or devtools device mode): with no hover available, the hint row and the `(i)` modal still carry the whole explanation.
- Tab the whole bar with a screen reader on: each button announces its label then its effect, and the popover is never announced twice.
- Locale spot-check in the running app: `de` for the longest compounds against the six-button bar, `zh_Hans` for the shortest, `ru` for the intro block's line lengths.

- [ ] **Step 5: Commit any fixes and push**

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/pr834-rebase
git push origin feat/face-review-unified
```

---

## Self-Review

**Spec coverage.** §3.1 → Task 2; §3.2 → Task 4; §3.3 → Task 5; §3.4 → Task 8; §4.1/4.3/4.4 → Task 1 (en) + Task 9 (nine locales); §4.2 → Task 1 (en) + Task 9 (nine locales); §4.5 → Task 9; §5.1 R1–R8, R11 → Task 2, R9–R10 → Task 3; §5.2 D1–D28 → Task 4; §5.3 H1–H13 → Task 5; §5.4 L1–L7 → Task 8; §5.5 G1–G5 → Task 6; §5.6 M1–M7 → Task 7; §5.7 I1–I7 → Task 9 (I1/I4/I5 are existing suites re-run there); §5.8 → Task 10 Step 3; §5.9 → Task 10 Step 4.

**R11** is asserted in Tasks 6 and 7, where the `DockAction` lists actually carry testids — not in Task 2, whose registry has none.

**Two existing assertions are deliberately rewritten**, and only these two: `[personId]/page.spec.ts:1222` and `:1234`, plus `people/[personId]/page.spec.ts:1123`, all of which assert `showModal` was called with the old modal component and an empty props object. Every other pre-existing assertion in both files must survive untouched — that is the refactor's contract.

**Every task is strictly test-first**, per the pre-flight ruling. Tasks 3, 6 and 7 are largely code motion, so each earns its red step explicitly: Task 3 lands a deliberately widening projection to prove the characterisation test has teeth (never committed); Tasks 6 and 7 rename the chrome testids in their specs first, which goes red against the un-migrated page, then migrate the page to green.

**Dock chrome testids are normalised** (`face-dock`, `face-bulk-bar`, `face-bulk-clear`, `face-bulk-help`, `face-bulk-hint`), per the pre-flight ruling, which removes the `testIds` prop entirely. Action testids stay per-page, so `e2e/` changes by exactly one line — Task 6 Step 1.

**Type consistency.** `FaceActionId`, `FaceReviewMode`, `FaceActionMeta`, `FACE_ACTIONS`, `bodyKeyFor`, `effectKeyFor`, `GUIDED_STATE_IDS` are defined in Task 2 and used under exactly those names in Tasks 3–7. `DockAction`/`Props` in Task 4 match the `<FaceReviewDock>` invocations in Tasks 6 and 7 field for field. `FaceActionsHelpModal`'s five props in Task 5 match both `modalManager.show` calls. `buttonIcon`/`swatchColor` (not `icon`/`color`) are used consistently from Task 2 onward.
