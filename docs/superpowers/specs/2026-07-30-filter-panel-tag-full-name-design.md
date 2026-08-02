# Reveal full tag names in the Filter panel

**Date:** 2026-07-30
**Discussion:** [open-noodle/gallery#881](https://github.com/open-noodle/gallery/discussions/881)
**Scope:** web only — a new `web/src/lib/actions/clamp-overflow.ts`, a new `web/src/lib/components/filter-panel/tag-filter-row.svelte`, and edits to `web/src/lib/components/filter-panel/tags-filter.svelte`, plus their tests.

## Problem

The Filter panel renders the **full hierarchical tag path**, not the leaf. `web/src/lib/utils/map-filter-config.ts:44` maps the server's `tag.value` onto `TagOption.name`:

```ts
tags: response.tags.map((t: { id: string; value: string }) => ({ id: t.id, name: t.value })),
```

`server/src/dtos/tag.dto.ts:66-67` confirms the split — `name` is `value.split('/').at(-1)`, `value` is the full path — and `search.repository.ts:795` selects `tag.value`. The same mapping exists in `recently-added-filter-config.ts:18`, `album-filter-config.ts:29`, `space-search.ts:125`, and both timeline `+page.svelte` files, so every Filter panel shows full paths.

Those labels are rendered single-line with Tailwind's `truncate` (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) at `tags-filter.svelte:107` (orphaned rows) and `tags-filter.svelte:144` (normal rows), inside a fixed `w-64` panel (`filter-panel.svelte:676`).

The result is that end-ellipsis removes the **leaf** — the most specific, distinguishing part of the path. `Events/2024/Italy Summer Trip Rome` and `Events/2024/Iceland Winter Trip` both render as `Events/2024/I…`. This is exactly the reporter's complaint: "their distinguishing detail (dates, locations, event names) is exactly the part that gets cut off."

## Decisions

| Question                    | Decision                                                       |
| --------------------------- | -------------------------------------------------------------- |
| How to reveal the full name | Wrap to two lines (`line-clamp-2`), plus a tooltip for residue |
| Scope                       | Tags only — people/camera/location keep today's `truncate`     |
| When the tooltip appears    | Only on rows actually still clipped after two lines            |

The reporter's open question was that hover does not exist on touch. Wrapping is the answer to that, and the tooltip is a fallback for the residual case — not the primary mechanism.

This split is forced, not stylistic. bits-ui's tooltip trigger begins `#onpointerenter` with `if (e.pointerType === "touch") return;` (`web/node_modules/bits-ui/dist/bits/tooltip/tooltip.svelte.js`), so the tooltip provably does nothing on a touch device. Wrapping is what actually serves phone and tablet users; the tooltip only ever adds to the mouse and keyboard paths.

Two lines rather than unlimited wrapping keeps the list scannable — `INITIAL_SHOW_COUNT` is 10, and unbounded wrapping of deep hierarchies would push the section arbitrarily long.

### Rejected alternatives

- **Tooltip only.** Smallest change and keeps the list dense, but delivers nothing on touch — the reporter's stated concern.
- **Start-truncation** (`…/Italy Summer Trip Rome`). Directly preserves the leaf and works on every input method, but hides the parent context and relies on a CSS direction hack.
- **Unlimited wrapping.** Simplest possible change, but a deep path can occupy three or four rows.

## Behaviour

- A tag label wraps to at most two lines. Most paths become fully visible with **zero interaction**.
- A label still clipped at two lines carries an `@immich/ui` `Tooltip` with the full name, opening on hover **and** on keyboard focus.
- A label that fits carries **no** tooltip.
- Everything else about the section — search, `Show N more`, orphaned-selection rows, selection toggling — is unchanged.

## Architecture

### Conditionality is a prop, not markup

`web/node_modules/@immich/ui/dist/components/Tooltip/Tooltip.svelte` already has the escape hatch:

```svelte
{#if text}
  <Tooltip.Root …><Tooltip.Trigger {child} />…</Tooltip.Root>
{:else}
  {@render child({ props: {} })}
{/if}
```

So "no tooltip when it fits" is expressed as `text={isOverflowing ? name : undefined}`. When the label fits, bits-ui is never instantiated and the button renders bare — which also means no `TooltipProvider` context is required for the fitting case. `TooltipProvider` is mounted app-wide at `web/src/routes/+layout.svelte:310`.

### Units

| Unit                                                                | Responsibility                                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/src/lib/actions/clamp-overflow.ts` _(new)_                     | Pure measurement. Reports `scrollHeight > clientHeight` for a node via callback. Measures on mount, on `ResizeObserver`, and on parameter update. Knows nothing about tags or tooltips. |
| `web/src/lib/components/filter-panel/tag-filter-row.svelte` _(new)_ | One row: checkbox, clamped label, conditional tooltip. Owns its own `isOverflowing` state.                                                                                              |
| `web/src/lib/components/filter-panel/tags-filter.svelte`            | Renders `<TagFilterRow>` for both the orphaned and normal lists.                                                                                                                        |

`web/src/lib/actions/` is the established home for DOM actions in this codebase (`long-press.ts`, `click-outside.ts`, `focus-trap.ts`, …), typed with `ActionReturn` from `svelte/action` as in `click-outside.ts:1`, with tests in `web/src/lib/actions/__test__/`.

Per-row overflow state lives in the row component rather than an id-keyed map in the parent, because such a map's entries outlive the tags they describe (search filtering and `Show N more` continuously change which tags are mounted).

The row component also collapses two near-identical ~20-line blocks that already exist in `tags-filter.svelte`. It takes `{ id, name, checked, dimmed, onToggle }`; the orphaned list passes `checked` and `dimmed` true, the normal list passes `checked={isActive}` and `dimmed` false.

### Action contract

```ts
export interface ClampOverflowParams {
  /** Called only when the overflow verdict changes. */
  onChange: (isOverflowing: boolean) => void;
  /** Re-measure when this changes (e.g. the label text). */
  key?: unknown;
}

export function clampOverflow(node: HTMLElement, params: ClampOverflowParams): ActionReturn<ClampOverflowParams>;
```

- Measures **synchronously on mount**. This is load-bearing: the repo's `getResizeObserverMock()` has a no-op `observe`, so a measurement that only ran from the observer callback would never fire under test — and, in the browser, would leave a frame where a clipped row has no tooltip.
- The remembered previous verdict initialises to `undefined`, **not** `false`. Otherwise the dedup below would swallow a mount-time `onChange(false)` and the component could never distinguish "measured, fits" from "never measured".
- After that first call, `onChange` fires only when the verdict flips, so a resize storm cannot thrash Svelte state.
- `update()` re-measures. The observer watches the node's own box, so a same-size box with different text (same tag id, renamed tag) would otherwise go undetected.
- `destroy()` disconnects the observer.
- Guards a missing `ResizeObserver` rather than throwing, so a test that forgets the global stub fails on its assertion instead of on a constructor.

### Markup detail

- `truncate` and `line-clamp-2` conflict (`white-space: nowrap` vs `display: -webkit-box`), so `truncate` is **replaced**, not supplemented.
- The label also gains `wrap-break-word` (Tailwind v4's `overflow-wrap: break-word`, as used at `DetailPanelDescription.svelte:51` and `ActivityViewer.svelte:142`). This is **required for correctness, not cosmetics** — see the unbreakable-token hazard below. Note that `AlbumDescription.svelte:47` and `Combobox.svelte:415` spell it `wrap-break-words`, which compiles to nothing; do not copy them.
- `data-testid="tags-item-{id}"` **must stay on the clickable button**: `e2e/src/specs/web/album.e2e-spec.ts` and `e2e/src/specs/web/spaces-filter-panel.e2e-spec.ts` click that selector.
- The row keeps `items-center`, so the checkbox centres against a two-line label.
- The label keeps `flex-1` and `text-left`.

#### Class unification

Today `font-medium` sits on the orphaned _label_ (`:107`) while active normal rows carry it on the _button_ (`:123-125`). The row component unifies this onto the button as `checked ? 'font-medium' : 'text-gray-500 dark:text-gray-300'`, plus `opacity-50` when `dimmed`. This is visually identical because `font-medium` cascades to the label, but it means assertions about weight must target the **row element**, not the label span.

#### Hazard: the tooltip trigger sets its own `onclick`

bits-ui's trigger props include `onclick` (`tooltip.svelte.js`, `#onclick` → `root.handleClose()`), alongside `id`, `aria-describedby`, `data-state`, `tabindex`, and the pointer/focus handlers. So neither naive spread order is safe:

- `{...props}` first, then our `onclick` → our handler wins, and bits-ui's own click handling is dropped.
- our `onclick` first, then `{...props}` → **selection breaks entirely**, taking both e2e suites with it.

The handler must therefore be **composed**, spreading everything else so `id`/`aria-describedby` stay wired:

```svelte
<button {...props} onclick={(event) => { props.onclick?.(event); onToggle(id); }} …>
```

#### Hazard: an unbreakable token defeats height-based detection

With `line-clamp-2` and the default `overflow-wrap: normal`, a single long token with no break opportunity does **not** wrap. It renders on one line and overflows **horizontally**; `overflow:hidden` clips it sideways. `scrollHeight` then equals `clientHeight`, the action reports "fits", and no tooltip appears — precisely where one is most needed.

`wrap-break-word` fixes this at the source: the token wraps, the overflow becomes vertical, and height-based detection sees it. The two are coupled — the class is what makes height-only measurement sufficient, so neither may be removed without the other.

Scenario R14 compiles the label's class list through the project's real Tailwind and asserts the result contains an `overflow-wrap` declaration. That is deliberately stronger than asserting the class name is present in the class attribute: Tailwind emits **nothing at all** for a name it does not recognise, so a name-only assertion passes for a utility that generates no CSS. This shipped once — the label carried `wrap-break-words` (v3's spelling is `break-words`; v4's is the singular `wrap-break-word`), so it had no `overflow-wrap` and pure-underscore tag names clipped horizontally while names with a space or hyphen still wrapped, making the breakage look patternless.

What R14 still cannot prove is the resulting _layout_ — that `overflow-wrap: break-word` changes what a real browser measures. happy-dom implements no layout engine, so `scrollHeight`/`clientHeight` are test-supplied numbers regardless of what classes are present (R12, which stubs those numbers directly, would pass unchanged even if the utility were deleted from the component). That half is proven by a real-browser probe, measured against this row's true geometry (200px wide, font-size 0.875rem, line-height 1.25rem):

| Content                                                   | `scrollHeight` | `clientHeight` | Overflowing?                                  |
| --------------------------------------------------------- | -------------: | -------------: | --------------------------------------------- |
| Natural text, 1 line                                      |             20 |             20 | No                                            |
| Natural text, 2 lines (the boundary)                      |             40 |             40 | No — correctly no tooltip                     |
| Natural text, 3 lines                                     |             60 |             40 | Yes — tooltip                                 |
| 120-char unbreakable token, **with** `wrap-break-word`    |            120 |             40 | Yes — tooltip                                 |
| 120-char unbreakable token, **without** `wrap-break-word` |             20 |             20 | **No** — false "fits"; the load-bearing proof |

The last row is the evidence that `wrap-break-word` is load-bearing rather than cosmetic: removing it collapses the unbreakable-token case from "overflowing, tooltip shown" to "not overflowing, false fits." R14 catches the regression if the utility is deleted or misspelt; it cannot catch a regression that leaves a valid `overflow-wrap` in place but breaks the layout some other way — that remains manual.

## Test plan

Written test-first: each scenario below is committed as a failing test, confirmed red for the intended reason, then made green. Behaviour is described in Given/When/Then; test names mirror the scenario names.

### Test-harness facts these tests depend on

- happy-dom reports `0` for `scrollHeight` and `clientHeight`, so overflow is simulated by defining those properties on the element under test.
- `getResizeObserverMock()` from `$lib/__mocks__/resize-observer.mock` has a **no-op** `observe`, so its callback never fires by itself; tests that need a resize invoke the captured callback directly.
- The tooltip trigger carries `data-tooltip-trigger` (`tooltipAttrs` in `tooltip.svelte.js` × the `data-{component}-{part}` scheme in `internal/attrs.js`). Presence or absence of this attribute is the deterministic, timer-free assertion for conditionality.
- Hover is **delayed by 700 ms** (`tooltip-provider.svelte:8`, `delayDuration = 700`, via `#handleDelayedOpen`), so any test asserting visible hover content must use fake timers.
- **`@immich/ui`'s `TooltipProvider` overrides two bits-ui defaults app-wide**, and both matter here:

  ```svelte
  <Tooltip.Provider disableCloseOnTriggerClick ignoreNonKeyboardFocus {delayDuration}>
  ```

  - `ignoreNonKeyboardFocus` makes `#onfocus` bail unless `:focus-visible` matches. happy-dom cannot produce that through `fireEvent.focus`, so **focus-opens-the-tooltip is not testable here** and moves to manual verification.
  - `disableCloseOnTriggerClick` makes `#onclick` return early **without** closing. Clicking a trigger therefore leaves the tooltip open by deliberate app-wide policy — an assertion that it closes would be asserting a behaviour this app disables.

  Neither weakens the composed-`onclick` requirement below: bits-ui's handler is inert here only because of provider configuration this component does not own and must not depend on.

- `Tooltip.Content` renders through a portal into `document.body`; Testing Library queries bind to `baseElement`, so portalled content is still reachable.
- Only tests that simulate overflow need `TestWrapper.svelte` for `TooltipProvider` scope. Rows that fit never instantiate `Tooltip.Root`, so the existing suite does not need rewrapping.

### `web/src/lib/actions/__test__/clamp-overflow.spec.ts`

Measurement is tested against a stub node with `scrollHeight`/`clientHeight` defined directly, so no layout engine is required.

| #   | Scenario                      | Given / When / Then                                                                                                                                               |
| --- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | reports overflow on mount     | Given a node whose `scrollHeight` (100) exceeds its `clientHeight` (40), when the action is applied, then `onChange(true)` is called.                             |
| A2  | reports fit on mount          | Given a node whose `scrollHeight` equals its `clientHeight`, when the action is applied, then `onChange(false)` is called — the mount call is never deduped away. |
| A3  | measures synchronously        | Given a node that overflows, when the action is applied, then `onChange` has already been called before any observer callback runs.                               |
| A4  | treats shorter content as fit | Given a node whose `scrollHeight` is **less than** its `clientHeight`, when the action is applied, then `onChange(false)` — defensive against sub-pixel rounding. |
| A5  | observes the node             | Given the action is applied, then `ResizeObserver.observe` was called with that same node.                                                                        |
| A6  | re-measures on resize         | Given a fitting node, when its `scrollHeight` grows past `clientHeight` and the observer callback fires, then `onChange(true)`.                                   |
| A7  | suppresses unchanged verdicts | Given an overflowing node, when the observer fires twice with no change in metrics, then `onChange` is called exactly once in total (the mount call).             |
| A8  | re-measures on update         | Given a fitting node, when `scrollHeight` grows and `update()` is called with a new `key`, then `onChange(true)`.                                                 |
| A9  | disconnects on destroy        | Given the action is applied, when `destroy()` is called, then `ResizeObserver.disconnect` was called.                                                             |
| A10 | tolerates a missing observer  | Given `ResizeObserver` is undefined on `globalThis`, when the action is applied, then it does not throw and still reports the mount-time verdict.                 |

### `web/src/lib/components/filter-panel/__tests__/tag-filter-row.spec.ts`

Rendered through `TestWrapper.svelte` so `TooltipProvider` is in scope, with `getResizeObserverMock()` stubbed.

| #      | Scenario                                       | Given / When / Then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1     | renders the full name in the DOM               | Given a long hierarchical name, when the row renders, then the label's text content is the complete path — clipping is visual only, so screen readers already read the whole name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| R2     | clamps rather than truncates                   | Given any row, when it renders, then the label carries `line-clamp-2` and **not** `truncate`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R3     | keeps the e2e handle                           | Given a tag with id `t1`, when the row renders, then `data-testid="tags-item-t1"` is on the element that receives the click.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R4     | tooltip when clipped                           | Given a label whose `scrollHeight` exceeds its `clientHeight`, when the row renders, then the button carries `data-tooltip-trigger`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R5     | no tooltip when it fits                        | Given a label whose `scrollHeight` equals its `clientHeight`, when the row renders, then the button carries no `data-tooltip-trigger`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| R6     | tooltip content on hover                       | Given a clipped row, when a non-touch `pointerenter` fires and 700 ms elapse on fake timers, then the full name appears in tooltip content.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ~~R7~~ | ~~tooltip content on focus~~                   | **Removed — not testable.** `ignoreNonKeyboardFocus` requires `:focus-visible`, which happy-dom cannot produce. Moved to manual verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R8     | toggling still works when clipped              | Given a clipped row, when it is clicked, then `onToggle` is called with the tag id **and** the tooltip stays open (`disableCloseOnTriggerClick`) — pins that the `{...props}` spread has not broken selection on a tooltip-bearing row.                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R9     | toggling works when not clipped                | Given a fitting row rendering no tooltip at all, when it is clicked, then `onToggle` is called with the tag id — the `props.onclick?.()` optional call must tolerate the empty-props branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R10    | checked state                                  | Given `checked` is true, then the checkmark renders and `aria-pressed` is `"true"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R11    | unchecked state                                | Given `checked` is false, then no checkmark renders and `aria-pressed` is `"false"`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R12    | tooltip on overflow, regardless of name shape  | Given the height stub forces an overflow verdict (`stubHeights(100, 40)`) for a 120-char unbreakable-token name, then the tooltip is present — pins that an overflowing row always gets a tooltip. It does **not** prove `wrap-break-word` causes that overflow in the first place (the name is inert here); see the Hazard section above for the real-browser proof of that.                                                                                                                                                                                                                                                                                                        |
| R13    | dimmed variant                                 | Given `dimmed` is true, then the row element carries `opacity-50` and `font-medium`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| R14    | label allows mid-word breaks                   | Given any row, then compiling the label's actual class list through the project's Tailwind produces an `overflow-wrap` declaration — pins that the utility exists and generates CSS, not merely that its name appears in the class attribute (Tailwind emits nothing for an unrecognised name). Does not pin the resulting layout; see the Hazard section above.                                                                                                                                                                                                                                                                                                                     |
| R15    | tooltip content shows the full name            | Given a clipped row, when hover opens the tooltip, then `[data-tooltip-content]` (bits-ui's stable marker for the portalled content, queried directly rather than via `aria-describedby`, which happy-dom never populates here) contains the complete name.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R16    | composed `onclick` under a live-close provider | Rendered under `tag-filter-row-non-default-provider.test-wrapper.svelte` — bits-ui's own `Tooltip.Provider` with **default** options, deliberately not the app's `@immich/ui` `TooltipProvider` (which hard-codes `disableCloseOnTriggerClick`, making bits-ui's own `onclick` a permanent no-op). Under the default provider, bits-ui's `onclick` genuinely closes the tooltip, so this is the one scenario that can tell "`handleClick` composes `triggerProps.onclick`" apart from "`handleClick` drops it" — every other scenario is indistinguishable between the two because that handler is inert under the real app provider.                                                |
| R17    | re-measures when `checked` flips               | Given a row rendered via `tag-filter-row-toggle-checked.test-wrapper.svelte` (which holds `checked` as its own local state, flipped by a click it handles itself — not by `rerender()`, which would replace the whole props object as one shallow reactive box and mask the exact per-prop gap this pins), when the height stub is changed to overflowing and `checked` flips from false to true, then the tooltip appears — selecting a row changes its font weight (400→500 via `font-medium`), which can push a borderline label past two lines without changing its border box, so neither `ResizeObserver` nor an unchanged `key` would catch it; `key` must include `checked`. |

### `web/src/lib/components/filter-panel/__tests__/tags-filter.spec.ts`

The 18 existing tests must keep passing; they are the regression suite for search, `Show N more`, orphaned rows, and the empty states. They gain the `ResizeObserver` stub but do not need `TooltipProvider`, since nothing overflows in happy-dom.

| #   | Scenario                         | Given / When / Then                                                                                                  |
| --- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| T1  | normal rows clamp                | Given tags are listed, then each label carries `line-clamp-2` and no label carries `truncate`.                       |
| T2  | orphaned rows clamp              | Given a selected tag absent from the current results, then its orphaned row's label also carries `line-clamp-2`.     |
| T3  | orphaned rows keep their styling | Given an orphaned row, then the **row element** still carries `opacity-50` and `font-medium` and renders as checked. |
| T4  | selection survives the refactor  | Given a tag row, when it is clicked, then `onSelectionChange` receives the id — through the new row component.       |
| T5  | search survives the refactor     | Given a search query matching a subset, then only matching rows render, each still clamped.                          |

### Edge cases explicitly covered

- Label shorter than one line — no tooltip (R5).
- Label wrapping to exactly two lines — no tooltip; the case wrapping is meant to fix (A2/R5).
- Label exceeding two lines — tooltip (R4).
- Single unbreakable token — R14 pins that the label's classes compile to a real `overflow-wrap` declaration; that this actually converts horizontal overflow into detectable vertical overflow is proven only by the real-browser probe above, never by a unit test (happy-dom has no layout).
- Click path with a tooltip attached and with none (R8/R9).
- Orphaned rows, whose name falls back to `selectedNames` → `tagNameCache` → the raw id (`tags-filter.svelte:45`) and so is never empty (T2/T3).
- Tag renamed while its id is unchanged — `update()` re-measures (A8).
- Panel or viewport resize changing the verdict (A6).
- Repeated resize events not thrashing state (A7).
- Mount-time verdict not deduped away by the initial state (A2).
- Observer teardown on unmount (A9).
- Sub-pixel `scrollHeight < clientHeight` (A4).
- Missing `ResizeObserver` global (A10).

### Out of scope for automated tests

`scrollHeight > clientHeight` against `-webkit-line-clamp` is the standard detection technique, but happy-dom implements no layout, so **no automated test proves a real browser reports overflow for a clamped element**. The measurements backing items 1, 3, and 4 below (natural 1/2/3-line text, and the unbreakable-token with/without `wrap-break-word`) are recorded in the "Hazard: an unbreakable token defeats height-based detection" section above. Manual verification, recorded rather than assumed:

1. A tag path long enough to exceed two lines shows a tooltip on hover.
2. **The same row shows the tooltip when reached by keyboard `Tab`** — this is ex-scenario R7, which no automated test covers because `ignoreNonKeyboardFocus` needs a real `:focus-visible` that happy-dom cannot produce. It is the only accessibility path with no automated coverage, so it must be checked by hand.
3. A short tag shows no tooltip.
4. A tag that wraps to exactly two lines shows no tooltip.
5. On a touch device, wrapped names are readable with no interaction.
6. Clicking a tag with a tooltip attached still toggles the filter.

## Not included

- No i18n strings — the tooltip content is the tag name itself.
- No server, SDK, OpenAPI, or mobile changes.
- People, camera, and location labels keep today's single-line `truncate`.
