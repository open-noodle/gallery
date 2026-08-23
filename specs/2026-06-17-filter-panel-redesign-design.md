# Filter Panel Redesign — Motion & Polish

**Date:** 2026-06-17
**Status:** Design approved, open questions resolved — ready for implementation planning
**Scope:** Fork-only feature (`web/src/lib/components/filter-panel/`)
**Interactive prototype:** `specs/mockups/filter-panel-redesign.html` (open in a browser)

## Problem

The filter panel works but feels stiff:

- **Collapsing is a hard swap.** `filter-panel.svelte` flips between an 8px icon strip and a 256px panel via `{#if collapsed}` with no transition — it snaps.
- **Section expand/collapse is instant.** `filter-section.svelte` shows/hides body content via `{#if expanded}` with zero height animation; only the chevron rotates. This is inconsistent with the rest of the app — `setting-accordion.svelte` already uses `transition:slide`.
- **It looks flat and rigid.** Every section is separated by a hard full-width `border-b border-gray-200 dark:border-gray-700`, producing a ladder of rules. The year grid is a dense set of bordered boxes. The section toggle row is a row of square buttons.

The panel is a **shared component** rendered in 5+ hosts (photos, map, spaces, smart-search results, timeline grouping bar), so changes land everywhere. It is fork-only code, so there is no upstream-rebase conflict risk.

## Goals

1. Smooth, **settle-feeling** collapse/expand of the whole panel.
2. Smooth height-slide for individual section expand/collapse, consistent with the app's existing `transition:slide` convention.
3. Light visual polish: hairline dividers, soft tonal surfaces for the active section, a year grid that breathes, softened toggle pills.
4. Honor `prefers-reduced-motion`.
5. **No behavior changes, no feature changes**, and minimal test churn.

## Non-Goals (YAGNI)

- No restructuring to a chip/popover filter paradigm (explicitly rejected during brainstorming).
- No changes to filter data flow, providers, suggestion re-fetch logic, section visibility/persistence, or favorites/albums logic.
- No new filters, no font change (the prototype's Hanken Grotesk is mockup-only; production keeps Gallery's app font).
- The "slide-off drawer" collapse style (Option B in the prototype) is **not** being built.

## Decisions (locked during brainstorming)

| Decision       | Choice                                | Why                                                                                                                                  |
| -------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scope          | Motion + light polish                 | Lowest risk; keep today's structure and behavior.                                                                                    |
| Collapse style | **Option A — width-eased rail**       | Keeps the always-visible icon rail (filters one click away); minimal behavior change; preserves the E2E tests that click rail icons. |
| Visual polish  | Approved                              | Surfaces over hard rules, hairline dividers, breathing year grid, settle easing.                                                     |
| Test impact    | Preserve mutual-exclusivity semantics | The collapse implementation keeps the `{#if}` content swap so existing unit/E2E presence assertions stay valid.                      |

## Motion language

Shared tokens, defined once and reused so the feel is consistent.

- **Easing:** decelerating "settle" curve `cubic-bezier(0.22, 1, 0.36, 1)` for CSS transitions. For Svelte JS transitions (`slide`), use `quintOut` from `svelte/easing` — it is the closest stock match to that curve and is already the convention in this codebase (`people-merge-selector.svelte`, `setting-input-field.svelte`).
- **Durations:** panel width `380ms`; section slide `240ms`; hover/micro `150ms`.
- **Reduced motion** uses two mechanisms, both already available in the codebase:
  - **CSS transitions** (panel width, hovers, year chips) → Tailwind `motion-reduce:transition-none` variant (used elsewhere, e.g. `global-search.svelte`, `crop-area.svelte`).
  - **Svelte `slide` transition** (section body) → set `duration` to `0` when `mediaQueryManager.reducedMotion` is true (the existing reactive getter in `stores/media-query-manager.svelte.ts`).

A small new module `web/src/lib/components/filter-panel/motion.ts` exports the easing/duration constants and a `slideMotion(reducedMotion: boolean)` helper returning `{ duration, easing }`. Keeps values in one place; used by `filter-section.svelte` and `filter-panel.svelte`.

## Architecture & component changes

### 1. Panel collapse — width-eased rail (`filter-panel.svelte`)

**Approach:** introduce a **persistent outer shell** whose width animates, and keep the existing `{#if collapsed}` content swap _inside_ it.

- The shell is always rendered (when not `hidden`): `overflow-hidden`, `transition-[width] duration-[380ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none`, with width driven by a class — expanded `w-64` (256px, **unchanged from today**) vs rail `w-14` (56px, up from today's `w-8`/32px for breathing room — see open question below).
- Inside the shell, the current `{#if collapsed}` branches are preserved: the collapsed branch keeps `data-testid="collapsed-icon-strip"` (with `expand-panel-btn` and the per-section rail icons + active dot), and the expanded branch keeps `data-testid="discovery-panel"`.
- The inner `discovery-panel` already carries a fixed `w-64`; because the shell width animates while the inner content stays a fixed `w-64` under `overflow-hidden`, **expanding** produces a **clip-reveal** (the full content is revealed left-to-right as the shell widens, with no text reflow). **Collapsing** unmounts `discovery-panel`, mounts the rail, and the shell narrows down to it. Only one content branch is ever in the DOM, so the existing presence-based unit/E2E assertions stay valid. The shell + inner expanded width must remain equal (`w-64`).

**Why not a both-mounted cross-fade:** keeping both the rail and full content mounted simultaneously (to cross-fade) would require rewriting ~10 unit assertions that encode "collapsed ⟺ `discovery-panel` absent" and risks Playwright visibility flakiness. Option A was chosen specifically for low churn, so we keep the single-branch swap. (If a cross-fade is wanted later, it is a follow-up with explicit test updates — out of scope here.)

**Rail/toggle-row polish:** rounded-`[10px]` toggle pills (active = `bg-primary/10 text-primary`, already present), add `active:scale-90 transition-transform motion-reduce:transition-none` for a tactile press, keep the animated "has active filter" dot and all `section-toggle-*` testids.

### 2. Section expand/collapse — height slide (`filter-section.svelte`)

- Keep `{#if expanded && !isEmpty}` for the body, but wrap the reveal with `transition:slide={slideMotion(mediaQueryManager.reducedMotion)}` (import `slide` from `svelte/transition`, `quintOut` from `svelte/easing`, `mediaQueryManager` from `stores/media-query-manager.svelte`, and the helper from `motion.ts`). `mediaQueryManager.reducedMotion` is a Svelte 5 reactive getter, accessed directly (no `$` store prefix). This matches `setting-accordion.svelte`.
- Replace the wrapper's hard `border-b border-gray-200 dark:border-gray-700` with **surfaces over rules**: each section becomes a `rounded-xl mx-1.5` block; the expanded/active section gets a soft `bg-subtle` tonal background; spacing (not full-width borders) separates sections. A hairline divider may remain only where needed (`border-white/5` / `border-gray-200/60`).
- Keep the chevron rotate (already `transition-transform`); add `motion-reduce:transition-none`.
- Keep `data-testid="filter-section-{testId}"` and the empty `(0)` behavior.

### 3. Year/month grid polish (`temporal-picker.svelte`)

- Year grid: switch from the 4-column `flex flex-wrap basis-[calc(25%-5px)]` to a clean `grid grid-cols-3 gap-1.5` (3 columns, matching the screenshot and prototype), chips `rounded-xl`, refined hover (`hover:-translate-y-0.5 motion-reduce:hover:translate-y-0`), keep the selected primary fill, keep tabular-figure counts.
- Volume bars keep the existing `transition-[width]`; add a one-time load grow (keyframe `scaleX(0)→1`, `motion-reduce` safe).
- Month grid: apply the same chip styling for consistency.
- Date-range inputs: already rounded with a focus ring — keep; only align spacing/tokens.
- Preserve all testids: `temporal-picker`, `year-grid`, `year-btn-{year}`, `month-grid`, `month-btn-{month}`, `custom-date-from-input`, etc.

## Theming

Stay entirely within the existing `@immich/ui` / Tailwind theme tokens already used in these files (`bg-light`, `bg-subtle`, `text-primary`, `immich-primary` / `immich-dark-primary`, gray scale). Hairlines are expressed as low-opacity variants of the existing border grays. No new color system. Works in both light and dark themes (verified visually in the prototype).

## Testing & TDD approach

This is mostly a CSS/animation change, so be deliberate about the boundary between what is test-drivable and what is not. The implementation plan follows **TDD (red → green → refactor)** for every behavioral/structural item below: write or extend the failing assertion first, watch it fail, then implement to green. Aesthetic feel is verified separately — do not fake-test it.

**Test-drive these (write the test first):**

1. **`motion.ts` pure helper** — `motion.spec.ts` is the cleanest TDD unit and should be written first: `slideMotion(true)` returns `{ duration: 0 }`; `slideMotion(false)` returns `{ duration: 240, easing: quintOut }` (the section-slide duration from the Motion language section). This isolates the reduced-motion branch (the trickiest correctness bit) into a pure function.
2. **Reduced-motion gating in the DOM** — extend `filter-panel.spec.ts` to assert the width-animating shell carries `motion-reduce:transition-none`, mirroring the existing pattern in `global-search.spec.ts` (which asserts `motion-reduce:` class presence on an element). For the section body, drive it through `motion.ts` (item 1) rather than asserting the JS transition directly.
3. **Panel shell width toggle** — assert the persistent shell exposes the width-transition class and that toggling `collapsed` flips the expanded (`w-64`) ↔ rail (`w-14`) width class, **without** changing which content testid is present. The existing mutual-exclusivity assertions (`collapsed-icon-strip` ⟺ `discovery-panel`) are the regression guard for this — they must stay green and must not be weakened.
4. **Year grid structure** — assert the year container renders a 3-column grid (`grid-cols-3`) and that all `year-btn-{year}` testids and the selected-state class are preserved. Extend `temporal-picker`'s spec first.

**Cannot be meaningfully unit-tested — verify by other means (and say so honestly):** the easing/settle feel, hairline-vs-ruled surfaces, the clip-reveal smoothness, hover lifts. Verify via (a) the committed prototype, (b) manual exercise under `make dev` across the photos / map / spaces hosts, and (c) the OS "Reduce motion" setting toggled on. None of these get a green checkmark in CI; they are listed as a manual verification checklist in the plan.

**Regression — must stay green, untouched:**

- `filter-panel.spec.ts` collapse/expand presence assertions (preserved by keeping the `{#if}` swap).
- E2E `photos-filter-panel`, `map-filter-panel`, `spaces-filter-panel` specs — testids and element visibility preserved; Playwright auto-waiting absorbs the transition.

**Known async touch-point:** `transition:slide` makes the section body's _removal_ async. `filter-sections.spec.ts` exercises the row components (e.g. `PeopleFilter`), not `FilterSection` expand/collapse, so it is unaffected. Any assertion elsewhere that checks section-body **absence immediately after collapse** must move to `waitFor`/`tick`; identify these during the red phase (expected to be few or none).

## Risks

- **Async outro vs. synchronous test assertions.** Adding `transition:slide` to section bodies can make happy-dom-based tests see a lingering node on collapse. Mitigation: the `reducedMotion`-aware duration and `waitFor` in the few affected tests.
- **Rail width change (32px → 56px).** Purely internal to the component's collapsed footprint; hosts are unaffected, but visually confirm in each host during implementation.
- **Section surface restyle** touches the most-rendered component path; keep diffs tight and rely on existing testids to catch regressions.

## Resolved decisions (sign-off complete)

1. **Rail width** — ✅ bump the collapsed rail from `w-8` (32px) to `w-14` (56px). Roomier icons + tap target, matches the prototype, still reclaims nearly all the panel width.
2. **Section dividers** — ✅ drop the hard full-width `border-b` ladder entirely; use soft `bg-subtle` surface on the active section + spacing. (The ruled ladder is the biggest source of the "stiff" feel.)
3. **Prototype file** — ✅ keep `specs/mockups/filter-panel-redesign.html` in the branch as a design record.

## Prototype artifact

`specs/mockups/filter-panel-redesign.html` is a self-contained design reference committed to this branch. It is not wired into any build and is not shipped. Whether it stays as a design record or is removed before merge is Open Question #3.
