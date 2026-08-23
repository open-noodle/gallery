# Face cleanup UX unification — design

**Date:** 2026-07-31
**Branch:** `feat/face-review-unified`
**Scope:** web only. No server, SDK, DB or mobile changes.

## 1. Problem

Three reported defects in the face cleanup console, all in the same family — the UI knows things it never
tells the admin.

1. **The landing page (`/admin/face-cleanup`) is blank above the two cards.** It carries an explanatory
   paragraph (`admin.face_cleanup_mode_first_visit_intro`) but renders it **only on a first visit**, gated on
   `firstVisit = !scan` (`web/src/routes/admin/face-cleanup/+page.svelte:80`). Every return visit — which is
   every visit after the first scan, i.e. almost all of them — shows two cards and nothing else. Nowhere does
   the console explain what problem it solves, why recognition needs a human at all, or what an admin can
   actually do to an individual face.

2. **The bulk action bar is not self-describing.** Once faces are selected, six terse buttons appear
   (`→ Owner`, `Keep here`, `Confirm / lock`, `Move → person…`, `Unknown person`, `Not a face`). The full
   explanation exists — `ActionsHelpModal` has a body and an on-apply consequence for every one of them — but
   it is behind an unlabelled `(i)` button that gives no hint it is worth pressing. An admin has to guess, and
   one of the six (`Not a face`) is irreversible.

3. **The two modes' docks are visually different components.** Guided
   (`admin/face-cleanup/[personId]/+page.svelte:942-1009`) uses `rounded-2xl`, `px-4 py-3`, `text-sm` buttons
   with `ring-1 ring-white/15 ring-inset`, a red-tinted destructive button, and an in-bar `(i)`. Manual
   (`admin/face-cleanup/people/[personId]/+page.svelte:660-726`) uses `rounded-xl`, `px-3.5 py-2.5`, `text-xs`
   buttons with `border border-white/15`, no destructive tint, and **no** `(i)` in the bar at all — its help
   launcher lives up in the grid header. The same action is also worded differently per mode (`Move → person…`
   vs `Move to…`; `Confirm / lock` vs `Lock`; `Unknown person` vs `Unknown`).

The 2026-07-23 manual-review design (§6.4) listed "the footer-dock shell" under **Reused**. In implementation
it was re-typed rather than shared, and the two copies drifted. This spec makes the intent real.

## 2. Goals / non-goals

**Goals**

- The landing page states the problem, why recognition is conservative, and what the tools let you do —
  permanently, not just on a first visit.
- Every bulk action explains itself on hover/focus, and the dock always shows what Apply will do to the
  selected faces.
- Both modes render the _same_ dock component with the same styling, and the same wording for the same action.
- One action registry behind the buttons, the tooltips and the help modal, so an explanation can never drift
  from the button it explains.
- Every string ships translated into all nine fork locales in this same change — see §4.5.

**Non-goals**

- No change to what any action _does_. No server calls change; no resolve payload changes.
- No change to the tile grid, the scan pages, the resolutions page, the People browser or `PersonPicker`.
- No new user-facing settings, no persistence of UI state.
- No docs-site page (`docs/docs/`) update — this is an admin console surface with no published guide.

## 3. Architecture

Four units, each independently testable.

```
web/src/lib/components/face-cleanup/
  face-actions.ts               (pure data — no Svelte, no i18n calls)
  FaceReviewDock.svelte         (presentation — the whole footer dock)
  FaceActionsHelpModal.svelte   (presentation — renders a registry subset)

web/src/routes/admin/face-cleanup/
  +page.svelte                            (landing page intro block)
  [personId]/+page.svelte                 (guided: consumes the dock + modal)
  [personId]/review.svelte.ts             (re-exports tokens from the registry)
  people/[personId]/+page.svelte          (manual: consumes the dock + modal)
  people/[personId]/manual-review.svelte.ts (re-exports tokens from the registry)

DELETED
  [personId]/ActionsHelpModal.svelte              + .spec.ts
  people/[personId]/ManualActionsHelpModal.svelte + .spec.ts
```

### 3.1 `face-actions.ts` — the registry

The single source of truth. Pure data, no dependency on Svelte or on either route directory.

```ts
export type FaceActionId = 'owner' | 'stay' | 'lock' | 'other' | 'unknown' | 'detach' | 'keep' | 'unmark';

/** The two review modes. Some explanations are mode-dependent — see "Mode-dependent copy" below. */
export type FaceReviewMode = 'guided' | 'manual';

/** A key that is the same in both modes, or one key per mode. */
type ModalKey = string | Readonly<Record<FaceReviewMode, string>>;

export interface FaceActionMeta {
  readonly id: FaceActionId;
  /** Button label. Also the help modal's heading — one string, so they can never disagree. */
  readonly labelKey: string;
  /** One line, ≤ ~90 chars. Hover/focus popover. Mode-independent for every action. */
  readonly tipKey: string;
  /** Help modal: what it means / when to use it. */
  readonly bodyKey: ModalKey;
  /** Help modal "On apply:" AND the dock's inline hint row. */
  readonly effectKey: ModalKey;
  /**
   * Glyph on the bulk-bar button. Present for every action that IS a button — including `unmark`, which
   * carries `mdiUndo` today. `undefined` only for `keep`, which is the default rather than a button and
   * appears solely in the help modal. Distinct from `swatchColor` below: a button glyph is not a tile state.
   */
  readonly buttonIcon: string | undefined;
  /**
   * The tile-state swatch — badge, ribbon, help-modal rail. `undefined` for `keep` and `unmark`, which
   * correspond to no coloured tile state and are signalled by ABSENCE (2026-07-23 design §6.4).
   */
  readonly swatchColor: string | undefined;
  /** `danger` tints the button red. Only `detach`. Rendered as `data-tone`, so it is assertable. */
  readonly tone: 'default' | 'danger';
}

export const FACE_ACTIONS: Readonly<Record<FaceActionId, FaceActionMeta>>;

/** Resolves a `ModalKey` for a mode. The ONLY way body/effect copy is read. */
export function bodyKeyFor(id: FaceActionId, mode: FaceReviewMode): string;
export function effectKeyFor(id: FaceActionId, mode: FaceReviewMode): string;
```

**Mode-dependent copy — why `ModalKey` is not just `string`.** Three of the shared actions already carry
deliberately different explanations per mode, and collapsing them would ship copy that describes the wrong
mode:

| Action             | Guided                                                                                                                   | Manual                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `other` **body**   | `…review_help_other_body` — "instead of the one **the scan suggested**"                                                  | `…manual_review_help_move_body` — "anyone in this library, or a brand-new person" |
| `other` **effect** | `…review_help_other_effect` — "when you're deliberately **overriding the scan** … the next scan can flag the face again" | `…manual_review_help_move_effect` — no scan mentioned; manual has none            |
| `lock` **body**    | `…review_help_lock_body` — "don't resemble **their owner**"                                                              | `…manual_review_help_lock_body` — "don't look like **this person**"               |

`lock`'s **effect**, and `unknown`/`detach`'s body and effect, are already shared verbatim between the two
modes today and stay a plain `string`. `owner`/`stay` are guided-only and `keep`/`unmark` manual-only, so
their keys are unambiguous. No copy is rewritten by this change — the registry simply records which key each
mode already uses.

This matters beyond the modal: §3.2's hint row renders `effectKey`, so a collapsed key would put guided's
"the next scan can flag the face again" warning into a mode that never scans.

**Token derivation.** `swatchColor` and `buttonIcon` carry the values that live in `review.svelte.ts` today.
That file and `manual-review.svelte.ts` keep exporting `STATE_COLOR` / `STATE_ICON` / `MANUAL_STATE_COLOR` /
`MANUAL_STATE_ICON`, now **derived from** `FACE_ACTIONS` rather than declared inline. Their existing importers
(both pages, `ActionsHelpModal` until it is deleted, and both view-model specs) are untouched.

The derivation must **narrow**, not widen: two existing specs assert the exact key sets, and they stay
unmodified as the pin —

- `review.spec.ts:17-18` — `STATE_ICON` and `STATE_COLOR` cover identical key sets (the six guided states);
- `manual-review.spec.ts:40-41` — `MANUAL_STATE_COLOR`/`MANUAL_STATE_ICON` keys are exactly
  `['detach','lock','move','unknown']`.

So `STATE_*` projects the six guided ids out of the eight, and `MANUAL_STATE_*` projects four while renaming
`other` → `move`. Neither may leak `keep`/`unmark`.

Direction of dependency is `lib/ ← routes/`, never the reverse.

### 3.2 `FaceReviewDock.svelte` — one dock, both halves

Owns the footer shell (`shrink-0 border-t … py-3.5`), the `max-w-screen-xl` inner row, and the
summary ↔ selected swap. Rendered through `AdminPageLayout`'s `footer` snippet by both pages, exactly as
today.

**The page keeps the visibility gate.** Guided renders its dock on `!loading && flaggedFaces.length > 0`
(`[personId]/+page.svelte:878`), manual on `!loading && vm.loadedCount > 0`
(`people/[personId]/+page.svelte:623`). These are genuinely different conditions over different models, so the
`{#if}` stays in each page's `footer` snippet and `FaceReviewDock` is only ever rendered when it should be
visible. The component has no "hidden" state.

```ts
interface DockAction {
  id: FaceActionId;
  /** e2e targets these, not labels — see the testid table below. */
  testId: string;
}

interface Props {
  mode: FaceReviewMode; // resolves mode-dependent effect copy for the hint row
  selectedCount: number;
  actions: DockAction[];
  onAction: (id: FaceActionId) => void;
  onHelp: () => void;
  onClear: () => void;
  testIds: { dock: string; bar: string; clear: string; help: string; hint: string };
  summary: Snippet; // everything left of Apply — page-specific
  apply: Snippet; // the Apply button itself — page-specific
}
```

The summary half stays page-owned via snippets because the two genuinely differ: guided adds a
rest-of-cluster chip, an apply-blocked reason and an "all set" marker that manual has no concept of. It is one
snippet (`summary`), not a `tally`/`apply` pair, because guided renders its `apply-blocked-reason` **between**
the tally and the button (`[personId]/+page.svelte:930-932`) — a two-snippet split has nowhere to put it.

**Testids.** Every id in use today is preserved so `face-cleanup.e2e-spec.ts` passes unmodified:

| Page   | dock                 | bar                      | clear                      | help        | actions                                                               |
| ------ | -------------------- | ------------------------ | -------------------------- | ----------- | --------------------------------------------------------------------- |
| Guided | `dock`               | `bulk-bar`               | `clear`                    | `bulk-help` | `bulk-stay`, `bulk-lock`, `bulk-other`, `bulk-unknown`, `bulk-detach` |
| Manual | `manual-review-dock` | `manual-review-bulk-bar` | `manual-review-bulk-clear` | _new_       | `manual-review-bulk-move`, `-lock`, `-unknown`, `-detach`, `-unmark`  |

Two additions, both new surface rather than renames: guided's `owner` button carries **no** testid today
(`[personId]/+page.svelte:957`) and gains `bulk-owner`; manual's bar has no help button at all and gains one
with `manual-review-bulk-help`. `testId` is therefore required on every `DockAction`, with nothing optional.

**Hover behaviour.** One `let hoveredId: FaceActionId | null = $state(null)`, set by `onmouseenter` /
`onfocusin` on each button and cleared by `onmouseleave` / `onfocusout`. It drives two renderings:

- a popover positioned above the hovered button showing `$t(FACE_ACTIONS[hoveredId].tipKey)`;
- the **hint row** at the foot of the bar: `<Label> · On apply: <effect>` resolved via
  `effectKeyFor(hoveredId, mode)`, or a neutral default when nothing is hovered.

`hoveredId` resets to `null` whenever `selectedCount` returns to 0. Applying an action clears the selection,
so the bar swaps to the summary while the pointer is still over where a button was; only the inner branch
unmounts, not the component, so without an explicit reset a stale effect line greets the next selection.

**Accessibility.** The popover is `aria-hidden` — it is a visual echo of text that already exists in the
accessibility tree. Each action button carries `aria-describedby` pointing at the hint row's stable id, so a
screen-reader user focusing a button hears its label followed by that action's effect. Without the
association, tabbing the bar would announce six labels and no consequences, which is precisely the defect this
change exists to fix.

The popover is ~15 lines of local markup, not `@immich/ui`'s `Tooltip`. Both pages already document why they
avoid that component: it styles for the page background rather than this dark bar, and it needs a
`TooltipProvider` from the app root that isolated component specs do not have
(`people/[personId]/+page.svelte:530-532`). A local popover also shares `hoveredId` with the hint row for free.

The hint row reserves two lines (`min-h`, `line-clamp-2`) so swapping between a short and a long effect string
cannot shift the dock's height and move the buttons out from under the pointer.

### 3.3 `FaceActionsHelpModal.svelte` — one modal

```ts
interface Props {
  mode: FaceReviewMode; // resolves mode-dependent body/effect copy
  actions: FaceActionId[];
  introKey: string;
  footerKey: string;
  /** Renders a "(default)" badge next to this action. Manual passes `keep`; guided passes nothing. */
  defaultActionId?: FaceActionId;
  onClose: () => void;
}
```

Renders one row per id: a `swatchColor` rail + `buttonIcon` glyph + `labelKey` heading + `bodyKeyFor(id, mode)`

- an `On apply:` block carrying `effectKeyFor(id, mode)`. Rows whose meta has no `swatchColor` (`keep`,
  `unmark`) render the no-swatch treatment the manual modal has today — signalled by absence, mirroring the
  untouched tile — and, matching that modal, no glyph in the heading either.

Guided passes `mode: 'guided'`, `['owner','stay','lock','other','unknown','detach']`, its intro/footer keys.
Manual passes `mode: 'manual'`, `['keep','other','lock','unknown','detach','unmark']`,
`defaultActionId: 'keep'`, and its own intro/footer keys.

Both pages open it through `modalManager.show(...)`, as they do today
(`[personId]/+page.svelte:266`, `people/[personId]/+page.svelte:296`) — but the merged modal takes required
props, so both call sites change from `show(Modal, {})` to `show(FaceActionsHelpModal, { mode, actions, … })`.
Manual has **two** launchers (the grid-header `(i)` at `:533` and the new in-bar one) and both must pass the
same props; the page keeps a single `handleOpenHelp` so there is one place for them to agree.

### 3.4 Landing page intro

Replaces the `{#if firstVisit}` paragraph with an always-rendered block between the page heading and the card
grid: a lead paragraph plus three icon rows. The last-scan chip on the right is unchanged.

## 4. Copy

### 4.1 Landing page (new keys)

| Key                                | English                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `face_cleanup_intro_lead`          | Face recognition sorts detected faces into people on its own, and it is deliberately cautious about it: a wrong assignment is far harder to untangle later than one it never made. So it leaves the doubtful calls alone rather than guessing. This page is where you make them. |
| `face_cleanup_intro_scan_title`    | A scan finds the doubtful calls                                                                                                                                                                                                                                                  |
| `face_cleanup_intro_scan_body`     | Guided cleanup re-checks the library and flags faces that resemble someone else more than the person they're filed under. It changes nothing — it just brings you the shortlist.                                                                                                 |
| `face_cleanup_intro_actions_title` | Every face is yours to route                                                                                                                                                                                                                                                     |
| `face_cleanup_intro_actions_body`  | Send a face to the person it really belongs to (or a brand-new one), park it as an unknown person, keep it where it is, lock it so no future scan questions it again, or drop it if it isn't a real face at all.                                                                 |
| `face_cleanup_intro_manual_title`  | Or audit anyone, any time                                                                                                                                                                                                                                                        |
| `face_cleanup_intro_manual_body`   | Manual review skips the scan entirely: pick any person and go through their faces yourself, with the same actions. Nothing is written until you press Apply.                                                                                                                     |

`face_cleanup_mode_first_visit_intro` becomes unreferenced and is **removed** from `en.json` and from the nine
translated locales.

### 4.2 Harmonised labels (existing keys, changed values)

| Key                                      | Was              | Now                          |
| ---------------------------------------- | ---------------- | ---------------------------- |
| `face_cleanup_review_bulk_owner`         | `→ Owner`        | `Move to owner`              |
| `face_cleanup_review_bulk_stay`          | `Keep here`      | `Keep here` (unchanged)      |
| `face_cleanup_review_bulk_lock`          | `Confirm / lock` | `Confirm & lock`             |
| `face_cleanup_review_bulk_other`         | `Move → person…` | `Move to person…`            |
| `face_cleanup_review_bulk_unknown`       | `Unknown person` | `Unknown person` (unchanged) |
| `face_cleanup_review_bulk_detach`        | `Not a face`     | `Not a face` (unchanged)     |
| `face_cleanup_manual_review_bulk_unmark` | `Unmark`         | `Unmark` (unchanged)         |

Manual's three duplicate keys collapse onto guided's and are **removed** from `en.json` and the nine locales:
`face_cleanup_manual_review_bulk_move`, `face_cleanup_manual_review_bulk_lock`,
`face_cleanup_manual_review_bulk_unknown`.

Because the changed keys already carry translations in the nine fork locales, those values are updated in the
same change — a translation of the old wording left in place would be wrong, not merely untranslated.

### 4.3 Tooltips (new keys, one per action)

`face_cleanup_action_<id>_tip` for all eight ids, one line each, e.g.

| Key                               | English                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `face_cleanup_action_owner_tip`   | Move these to the person the scan thinks they actually are.         |
| `face_cleanup_action_stay_tip`    | These really are this person — decline the scan's suggestion.       |
| `face_cleanup_action_lock_tip`    | Pin these here permanently, so no future scan can flag them.        |
| `face_cleanup_action_other_tip`   | Pick who these belong to — anyone in the library, or a new person.  |
| `face_cleanup_action_unknown_tip` | Real faces, but not this person, and you can't name them.           |
| `face_cleanup_action_detach_tip`  | Not real faces at all. Irreversible — the crop is retired for good. |
| `face_cleanup_action_keep_tip`    | The default. An untouched face is left exactly as it is.            |
| `face_cleanup_action_unmark_tip`  | Undo — return the selection to untouched.                           |

### 4.4 Dock hint row (new keys)

| Key                                     | English                                                                           |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `face_cleanup_review_bulk_hint_default` | Nothing is written until you press Apply. Hover an action to see what it will do. |
| `face_cleanup_review_bulk_hint_effect`  | `{action} · On apply: {effect}`                                                   |

### 4.5 Locale coverage — all nine, in this change

Every string this feature introduces or rewords ships translated in the **same change** as the code. There is
no en-only intermediate state and no follow-up translation pass.

The set is the nine fork-maintained locales, exactly as `web/src/lib/i18n/fork-string-parity.spec.ts:20`
defines them:

```
de  es  fr  it  nl  pl  ru  zh_Hans  zh_Hant
```

**Spanish is not optional, and Chinese means both scripts.** The parity test derives a "fork string" as any
`en.json` key that at least one translated locale carries and no upstream-Weblate locale does, then asserts
`it.each(TRANSLATED)('%s carries every fork string')`. Translating a new key into eight of the nine therefore
does not leave the ninth merely untranslated — it promotes the key to a fork string and turns that locale's
parity test red. Partial coverage is a CI failure, not a smaller deliverable.

This applies to three groups:

1. **New keys** — §4.1 (7 landing-page keys), §4.3 (8 tip keys), §4.4 (2 hint keys). 17 keys × 9 locales.
2. **Reworded keys** — §4.2's three changed English values. Their existing nine translations render the _old_
   wording and are rewritten, not left alone: a stale translation is wrong, not just untranslated, and no
   automated guard can see it (`placeholders.spec.ts` only inspects interpolation arguments).
3. **Removed keys** — the four keys §4.1/§4.2 delete come out of all nine locale files as well as `en.json`.

`face_cleanup_review_bulk_hint_effect` carries interpolation (`{action}`, `{effect}`). Every locale must keep
both argument names verbatim and untranslated — translating an ICU argument name is the exact defect
`placeholders.spec.ts` was written for, and it renders literal braces to the user.

Note that this deliberately departs from the "new keys land in `en.json` alone and get translated in a later
pass" convention that `fork-string-parity.spec.ts` documents in its own comments. That convention is a floor,
not a ceiling; it exists so a feature is never _blocked_ on translation. Shipping the translations up front is
strictly stronger and leaves nothing owed.

## 5. Testing

Test-first throughout: for each unit below, the listed specs are written and observed failing before the
implementation exists, and the assertions describe behaviour (what an admin sees or can do), never internal
structure. Existing suites are treated as a regression contract — no assertion is deleted to make a new
implementation pass; where a test encodes behaviour this change deliberately alters, it is rewritten to assert
the new behaviour, and that rewrite is called out per test below.

Three harness facts constrain how these are written. **The two suites use opposite i18n strategies** — get
this wrong and every assertion in a file is vacuous:

- **Page specs** (`page.spec.ts` × 3) mock `$t` to return the **key**, so they assert on key names, never
  English (`admin/face-cleanup/page.spec.ts:24-35`). Interpolated strings render as the bare key, so a page
  spec can assert a key's presence but never an interpolated value.
- **Component specs** (`ActionsHelpModal.spec.ts:18-22`, `ManualActionsHelpModal.spec.ts:25`) register the
  **real `en.json`** (`register` + `init` + `waitLocale`) and assert English text, so a missing or renamed key
  fails the test instead of silently rendering the key. `FaceActionsHelpModal.spec.ts` and
  `FaceReviewDock.spec.ts` follow this convention — it is what makes R3's key-existence guarantee observable at
  the component level.
- Anything rendering a bits-ui `Modal` needs the deferred body-scroll-lock drain in `afterEach`
  (`await new Promise((r) => setTimeout(r, 500))`) before happy-dom tears `document` down.
- `Icon` is stubbed to a no-op in page specs, so icon identity is not observable there; it is asserted in the
  registry and dock specs instead.

### 5.1 `face-actions.spec.ts` (new — pure unit)

| #   | Behaviour                                                                                                                                                                                                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Every `FaceActionId` has an entry — the record is total, so a new id cannot be added without meta.                                                                                                                                                                                                                                        |
| R2  | `labelKey`, `tipKey` and every resolved body/effect key are non-empty and distinct across actions (no accidental copy-paste of one action's explanation onto another).                                                                                                                                                                    |
| R3  | Every key the registry names — including **both** arms of every mode-dependent `ModalKey` — exists in `en.json` (reads the file, same technique as `slice-12-key-audit.spec.ts`).                                                                                                                                                         |
| R4  | Every action that can appear in a bar has a `buttonIcon` — all seven ids except `keep`, and notably including `unmark`. Only `keep` and `unmark` lack a `swatchColor`. This is the F2 split: a button glyph is not a tile state, and the two absences deliberately do not coincide.                                                       |
| R5  | `detach` is the only `tone: 'danger'` action.                                                                                                                                                                                                                                                                                             |
| R6  | The registry has no `move` id — manual's move button is `other`, so both modes render one label key. (Its page-level wiring is asserted in §5.6 M4.)                                                                                                                                                                                      |
| R7  | **Mode-dependent resolution, per shared action:** `bodyKeyFor('other','guided')` → `…review_help_other_body` and `('other','manual')` → `…manual_review_help_move_body`; likewise `effectKeyFor` for `other`, and `bodyKeyFor` for `lock`. Each asserted against the exact key that mode uses today, so the merge provably loses no copy. |
| R8  | For a mode-**independent** key (`unknown`, `detach` body and effect; `lock` effect) both modes resolve to the same key — pins that the shared ones stayed shared.                                                                                                                                                                         |
| R9  | `STATE_COLOR` / `STATE_ICON` re-exported from `review.svelte.ts` equal the registry's values for all six guided states, **and their key sets are exactly those six** — `keep`/`unmark` must not leak in. `review.spec.ts:17-18` already asserts the two cover identical key sets and stays unmodified as the second pin.                  |
| R10 | `MANUAL_STATE_COLOR` / `MANUAL_STATE_ICON` equal the registry values for `other`/`lock`/`unknown`/`detach` under the `move` → `other` rename, **and their key sets are exactly `['detach','lock','move','unknown']`** — `manual-review.spec.ts:40-41` already asserts this and stays unmodified as the second pin.                        |
| R11 | No two actions share a `testId` in either page's list (guards the copy-paste that would make one e2e locator match two buttons).                                                                                                                                                                                                          |

### 5.2 `FaceReviewDock.spec.ts` (new — component)

Rendered directly with props, no page. Covers both halves and every hover path.

**Swap and actions** — flat assertions, table form.

| #   | Behaviour                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `selectedCount === 0` renders the `summary` and `apply` snippets and no action bar.                                                                                                                     |
| D2  | `selectedCount > 0` renders the action bar and neither snippet.                                                                                                                                         |
| D3  | The selected count is rendered next to the `…_selected_suffix` label.                                                                                                                                   |
| D4  | One button per entry in `actions`, in the order given, each carrying its supplied `testId`.                                                                                                             |
| D5  | Each button renders its registry `labelKey`.                                                                                                                                                            |
| D6  | Clicking a button calls `onAction` once with that id, and with no other id.                                                                                                                             |
| D7  | A `tone: 'danger'` action renders `data-tone="danger"` and every other renders `data-tone="default"` — the destructive button's distinctness as an assertable attribute rather than a class-list match. |
| D8  | `onClear` fires from the clear button; `onHelp` fires from the help button.                                                                                                                             |
| D9  | Clear and help are present regardless of which action subset is passed — this is the manual-mode gap being closed.                                                                                      |
| D10 | Every action button renders its `buttonIcon`, **including `unmark`** (`mdiUndo` today) — F2's regression guard. Icon identity is asserted here, not in a page spec, because pages stub `Icon`.          |

**Hover, focus and the swap interaction** — stateful and order-dependent, so specified Given/When/Then.

| #   | Given                                                      | When                                                    | Then                                                                                                                                             |
| --- | ---------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| D11 | a bar with a selection and the pointer nowhere             | the dock first renders                                  | the hint row shows `…_hint_default` and no popover exists                                                                                        |
| D12 | the pointer nowhere                                        | it enters an action button                              | a popover appears carrying that action's `tipKey`                                                                                                |
| D13 | the pointer nowhere                                        | it enters an action button                              | the hint row swaps to `…_hint_effect` for that action, resolved for the dock's `mode`                                                            |
| D14 | the pointer on an action                                   | it leaves                                               | the popover is gone and the hint row is back to `…_hint_default`                                                                                 |
| D15 | keyboard focus nowhere in the bar                          | an action button receives focus                         | the same popover and hint appear as for `mouseenter` — keyboard parity                                                                           |
| D16 | keyboard focus on an action                                | focus leaves that button                                | the popover is gone and the default hint is restored                                                                                             |
| D17 | the pointer on action A                                    | it moves straight to action B with no intervening leave | B's tip and B's effect are shown, never a stale A                                                                                                |
| D18 | the pointer on an action                                   | the popover is inspected                                | exactly one popover exists in the document                                                                                                       |
| D19 | the pointer on an action                                   | the accessibility tree is inspected                     | the popover is `aria-hidden`, and the button's `aria-describedby` resolves to the hint row — one announcement, and focus reaches the effect text |
| D20 | the pointer nowhere                                        | it enters the clear or the help button                  | the hint row is unchanged — neither is a routing action with effect copy                                                                         |
| D21 | a selection of 2 with the pointer on an action             | the selection drops to 0 (an action was applied)        | the dock shows the summary, and the hint state is reset                                                                                          |
| D22 | the selection has just dropped to 0 while hovered (as D21) | a new selection is made                                 | the hint row shows `…_hint_default`, not the previously hovered action's effect                                                                  |
| D23 | a selection of 2 with the pointer on an action             | `selectedCount` rises to 5 without the pointer moving   | the popover and hint still describe the hovered action                                                                                           |

**Edge cases**

| #   | Behaviour                                                                                                                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D24 | An empty `actions` array still renders the bar shell, the count, clear and help without throwing.                                                                                                           |
| D25 | A single action renders without the divider collapsing the layout.                                                                                                                                          |
| D26 | `selectedCount` of 1 vs many both render (no plural-only string that breaks at 1).                                                                                                                          |
| D27 | An action with no `swatchColor` (`unmark`) still renders its button glyph — the swatch's absence never suppresses the icon. Pairs with D10 as the two halves of the F2 split.                               |
| D28 | Passing the same `mode` twice with different `actions` renders different bars — no module-level state leaks between instances (the web suite sets no `clearMocks`, so cross-test leakage is a live hazard). |

### 5.3 `FaceActionsHelpModal.spec.ts` (new — replaces two deleted specs)

Every assertion from `ActionsHelpModal.spec.ts` and `ManualActionsHelpModal.spec.ts` is carried over, re-aimed
at the merged component under the mode that used to own it. Both modes are exercised in the same file.

| #   | Behaviour                                                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | Guided subset names exactly its six actions, reusing the bulk-bar label keys (from `ActionsHelpModal.spec.ts`).                                                                                                                                                                                                                                                   |
| H2  | Manual subset names exactly its six: Keep (default), Move to person…, Confirm & lock, Unknown person, Not a face, Unmark (from `ManualActionsHelpModal.spec.ts`).                                                                                                                                                                                                 |
| H3  | Every rendered action explains its meaning (`bodyKey`) and its consequence (`effectKey`) — asserted for both subsets.                                                                                                                                                                                                                                             |
| H4  | `defaultActionId` renders the "(default)" badge on exactly that action, and no badge at all when the prop is omitted.                                                                                                                                                                                                                                             |
| H5  | Actions with a colour render a swatch; `keep` and `unmark` render the no-swatch element.                                                                                                                                                                                                                                                                          |
| H6  | The destructive action's body warns it is irreversible and points at `unknown` as the opposite case.                                                                                                                                                                                                                                                              |
| H7  | Intro and footer render from the passed keys, so the two modes' different framing survives the merge.                                                                                                                                                                                                                                                             |
| H8  | Closes via the close button.                                                                                                                                                                                                                                                                                                                                      |
| H9  | Row order follows the `actions` array, not the registry's declaration order.                                                                                                                                                                                                                                                                                      |
| H10 | Passing an empty subset renders intro and footer without throwing.                                                                                                                                                                                                                                                                                                |
| H11 | **Mode-dependent copy (F1):** rendered under `mode: 'guided'`, the `other` row carries `…review_help_other_body`/`_effect` and the `lock` row `…review_help_lock_body`; under `mode: 'manual'`, the same three become `…manual_review_help_move_body`/`_effect` and `…manual_review_help_lock_body`. Asserted per key, so a collapse to one variant fails loudly. |
| H12 | The mode-**independent** rows (`unknown`, `detach`) render identical keys under both modes — the merge neither splits what was shared nor shares what was split.                                                                                                                                                                                                  |
| H13 | Rendering the same subset under the two modes produces different documents. A guard against `mode` being accepted and ignored, which H11 alone would not catch if both arms happened to be wired to the same key.                                                                                                                                                 |

### 5.4 Landing page — `page.spec.ts` (amended)

| #   | Behaviour                                                                                                                      | Status                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| L1  | The intro lead renders on a first visit.                                                                                       | **rewritten** — was asserting `…_first_visit_intro`; now asserts `face_cleanup_intro_lead`.                                        |
| L2  | The intro lead **also** renders on a return visit with a completed scan.                                                       | **inverted** — `page.spec.ts:151` currently asserts the intro is _absent_ here. That assertion encodes the defect and is replaced. |
| L3  | The intro renders in all five scan states (none / pending / running / failed / completed) — it is unconditional.               | new                                                                                                                                |
| L4  | All three point rows render, each with its title and body.                                                                     | new                                                                                                                                |
| L5  | The intro sits before the card grid in DOM order, so it is read first.                                                         | new                                                                                                                                |
| L6  | Every existing card/CTA assertion still passes untouched.                                                                      | regression                                                                                                                         |
| L7  | `face_cleanup_mode_first_visit_intro` is rendered nowhere, in any scan state — the replaced string is gone, not merely hidden. | new                                                                                                                                |

### 5.5 Guided page — `[personId]/page.spec.ts` (amended)

All existing bulk-action, apply, destructive-confirm, destination and rest-of-cluster tests stay as they are:
they target `data-testid`s (`bulk-stay`, `bulk-lock`, `bulk-other`, `bulk-unknown`, `bulk-detach`, `clear`,
`bulk-help`, `bulk-bar`, `dock`, `apply-btn`, `tally`), every one of which the dock preserves. Added:

| #   | Behaviour                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | Hovering a bulk action shows its tip and its on-apply effect, wired through the real page.                                                                                                                                                                               |
| G2  | The help modal opened from the bulk bar names all six guided actions (proves the page passes the right subset).                                                                                                                                                          |
| G3  | The help modal opened from the review banner and the one opened from the bulk bar are the same modal with the same subset.                                                                                                                                               |
| G4  | The page passes `mode: 'guided'`, so the `other` row shows the scan-referencing copy and **not** manual's. Paired with M5 below, this is what proves the two pages diverge — H11 tests the component in isolation and would pass even if both pages hard-coded one mode. |
| G5  | The `owner` button carries the new `bulk-owner` testid and routes `onAction('owner')` — the one button in either bar that had no testid before.                                                                                                                          |

### 5.6 Manual page — `people/[personId]/page.spec.ts` (amended)

Existing tests keep their testids (`manual-review-bulk-move`, `-lock`, `-unknown`, `-detach`, `-unmark`,
`-clear`, `-bar`, `manual-review-dock`, `manual-review-apply-btn`, `manual-review-tally-*`). Added:

| #   | Behaviour                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M1  | The bulk bar now carries a help button, and it opens the merged modal with manual's subset.                                              |
| M2  | The header help launcher and the new in-bar help open the same modal with the same subset.                                               |
| M3  | Hovering a bulk action shows its tip and effect.                                                                                         |
| M4  | Manual's move button renders the same label key as guided's `other` button — the harmonisation, asserted rather than assumed.            |
| M5  | The page passes `mode: 'manual'`, so the `other`/move row shows the scan-free copy and **not** guided's. The counterpart to G4.          |
| M6  | Manual's subset contains `keep` and `unmark` and contains neither `owner` nor `stay` — the two modes provably receive different subsets. |
| M7  | The `unmark` button still renders its `mdiUndo` glyph after the dock swap (F2 at the page level).                                        |

### 5.7 i18n guards

| #   | Behaviour                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| I1  | `slice-12-key-audit.spec.ts` passes unchanged: both pages still reference at least one `$t` key directly, and every key they reference exists in `en.json`.                                                                                                                                                                                                                                |
| I2  | No web or mobile source references the four removed keys (`…_first_visit_intro`, `…_manual_review_bulk_move`, `…_manual_review_bulk_lock`, `…_manual_review_bulk_unknown`). Extend `slice-12-key-audit.spec.ts`'s removed-key scan, or add the equivalent guard alongside it.                                                                                                              |
| I3  | `fork-string-parity.spec.ts` passes: every new key is present in **all nine** locales.                                                                                                                                                                                                                                                                                                     |
| I3b | **Leftover-key guard (new).** Each of the four removed keys is absent from all nine locale files _and_ `en.json`. This needs its own assertion: parity only detects a key **missing** from a locale that others still have, so a stale `face_cleanup_manual_review_bulk_move` left behind in one locale is invisible to every existing guard — the opposite direction from what I3 checks. |
| I4  | `placeholders.spec.ts` passes: `…_hint_effect` carries the literal argument names `{action}` and `{effect}` in all nine translations. Because the translations ship in this change rather than later, this guard is live immediately — a locale that translated an argument name fails here.                                                                                               |
| I5  | `face-cleanup-plurals.spec.ts` passes — no new plural forms are introduced.                                                                                                                                                                                                                                                                                                                |
| I6  | **Coverage assertion (new, in `face-actions.spec.ts` or alongside the parity spec):** every key the registry names, plus the intro and hint keys, resolves in all nine locale files. This states the §4.5 requirement directly rather than relying on parity's transitive "at least one locale has it" derivation.                                                                         |
| I7  | No locale's value for the three reworded keys (§4.2) still carries the old wording's arrow-and-slash shape — `face_cleanup_review_bulk_owner` and `…_other` contain no `→`, `…_lock` no `/`. A cheap, checkable proxy for "the nine were updated, not just `en.json`"; a test cannot diff against a value it no longer has.                                                                |

### 5.8 E2E

`e2e/src/specs/web/face-cleanup.e2e-spec.ts` is the testid contract and must pass **unmodified**. It drives
both bars through the DOM — guided's `bulk-stay`/`-lock`/`-other`/`-unknown`/`-detach` (X1, `:426-442`) and
manual's `manual-review-bulk-move`/`-lock`/`-detach` (`:937-952`) — through to an asserted resolve payload.
That is the acceptance signal for the dock merge: if any testid moved, it fails.

`face-review-cross-engine.e2e-spec.ts` is **not** part of that contract — it contains no `data-testid` at all.
It is an API-boundary suite (S14.4, S14.5) driving `page.request.post/get` against `/api/…`, so it is
untouched by a presentational change for a different reason and must not be cited as evidence the dock is
correct.

No new e2e is added: the change is presentational, and X1 already exercises every guided action end to end.

### 5.9 Manual verification

Not automatable, checked by hand on the dev stack before the branch is called done:

- Popover placement at the start and end of the bar (does not clip at the viewport edge), and on a wrapped
  two-row bar at a narrow width.
- Light and dark theme on both docks and the intro block.
- Hint row does not shift the dock height when swapping between the shortest and longest effect string.
- Touch: with no hover available, the hint row and the `(i)` modal still carry the full explanation.
- Tab the whole bar with a screen reader on, confirming each button announces its label followed by its
  effect via `aria-describedby`, and that the popover is never announced twice (D19 asserts the wiring; only a
  real screen reader confirms it reads well).
- **Locale spot-check in the running app, not just in the JSON.** `de` for the longest compounds (does a
  six-button bar still fit, or wrap acceptably), `zh_Hans` for the shortest (buttons should not collapse to
  cramped two-character stubs), and `ru` for the intro block's line lengths. The dock is the tightest surface
  in the feature and English is its shortest rendering — it is the one place a translation can look correct in
  the file and wrong on screen.

## 6. Risks

| Risk                                                                                      | Mitigation                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A moved `data-testid` breaks e2e silently in a suite that isn't run locally.              | Testids are props on the dock, enumerated per page; §5.8 requires the e2e specs to pass unmodified.                                                                                                                       |
| Merging two help modals loses an assertion one of them made.                              | §5.3 carries over every case from both deleted specs by name; the deletions happen in the same commit as the merged spec.                                                                                                 |
| Merging collapses mode-specific copy, so one mode describes a scan it does not have.      | The registry models it explicitly (§3.1 `ModalKey`); R7/R8, H11–H13 and G4/M5 assert it at three levels — resolver, component, page.                                                                                      |
| `unmark` silently loses its `mdiUndo` glyph because its swatch is absent.                 | `buttonIcon` and `swatchColor` are separate fields (§3.1); D10, D27 and M7 assert the button keeps its glyph while the modal keeps its no-swatch row.                                                                     |
| A stale removed key survives in one locale, invisible to every existing guard.            | I3b asserts absence directly — parity only detects the opposite direction.                                                                                                                                                |
| Changing English label values leaves stale translations in nine locales.                  | §4.2 updates them in the same change; I7 guards the three reworded keys against keeping the old arrow/slash shape.                                                                                                        |
| Translating into eight locales and forgetting `es` (or shipping only one Chinese script). | Not a partial success but a red build: §4.5 explains the parity test's promotion rule, and I3/I6 assert presence across all nine explicitly.                                                                              |
| Longer translations (`de`, `ru`) overflow the six-button bar or the two-line hint clamp.  | The bar already wraps (`flex-wrap`); the hint row clamps at two lines. Verified by eye per §5.9 rather than asserted — a spec cannot see rendered width in happy-dom.                                                     |
| The popover reimplements a tooltip.                                                       | Deliberate and scoped: ~15 lines, dark-surface styling, no `TooltipProvider` dependency, shares `hoveredId` with the hint row. Recorded here so a later reader does not "fix" it by swapping in `@immich/ui`'s `Tooltip`. |
| The hint row makes the dock taller and pushes grid content up.                            | Two reserved lines with `line-clamp-2`; the dock is a layout footer, not overlaid on the grid.                                                                                                                            |

## 7. Out of scope / follow-ups

- Unifying the two view-models (`review.svelte.ts` / `manual-review.svelte.ts`). The 2026-07-23 design §6.5
  argues they are genuinely different state machines; nothing here changes that assessment.
- Unifying the summary halves of the two docks. Guided's rest-of-cluster chip, blocked reason and "all set"
  marker have no manual equivalent, so they stay page-owned snippets.
