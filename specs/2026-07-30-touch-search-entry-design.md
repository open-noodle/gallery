# Touch search entry + `/` shortcut

Fixes [#862](https://github.com/open-noodle/gallery/issues/862) — the `Ctrl+K` search hint has no
touch equivalent on iPad/iPhone — and adds `/` as a second way to open the palette.

## Problem

The nav bar search field renders a `<kbd>` chip reading `Ctrl+K` (or `⌘K` on Apple platforms) at
every viewport ≥640px. On a keyboardless iPad the chip advertises a shortcut that cannot be typed,
and the chip itself is decorative — not a button.

The palette is in fact reachable by touch today:

- below 640px a magnify `IconButton` in `NavigationBar.svelte` opens the modal palette;
- at 640px and above, tapping the search field focuses it, and `onfocus` opens the inline dropdown.

So the defect is the affordance, not raw reachability. Two things make the tap path poor on a
tablet: the inline dropdown is cramped, and focusing a real `<input>` raises the iOS soft keyboard,
which covers the dropdown it just opened.

Separately, we want `/` to open search, matching the GitHub/Gmail/Slack convention.

## Decisions

| #   | Decision                                                                                 | Rationale                                                                                 |
| --- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | On touch, tapping the search bar opens the **modal** palette, not the inline dropdown    | Full-height below 640px, large centred card above; no soft-keyboard occlusion             |
| 2   | `/` **replaces** the existing `/` → Explore binding                                      | `/` = search is the near-universal convention; Explore stays reachable from the sidebar   |
| 3   | `/` opens the **same modal palette** `Ctrl+K` opens                                      | One surface, one documented behaviour, works where the nav bar is hidden                  |
| 4   | Touch is detected **per event** via `PointerEvent.pointerType`                           | Exact per-interaction; an iPad user gets the modal by finger and the dropdown by trackpad |
| 5   | The `<kbd>` chip is **hidden** when `pointer: coarse`                                    | Removes the misleading hint; the whole bar becomes the tap target                         |
| 6   | The iPad modal keeps its **current large centred size**                                  | Already comfortable, needs no new CSS; full-bleed styling can follow if it reads cramped  |
| 7   | Chip visibility uses `{#if}` on `mediaQueryManager.pointerCoarse`, not a CSS media query | jsdom does not evaluate CSS media queries, so `{#if}` is the testable form                |

Decision 7 does not cost a flash: `web/src/routes/+layout.ts:9` sets `export const ssr = false`, so
this app never server-renders any route. `MediaQuery` having no SSR value would only matter if there
were an SSR pass to read it during — there isn't, so the chip's first render is already
client-side and already has the real `pointerCoarse` value.

Decision 4 covers `pointerType === 'touch'` only. `'pen'` keeps the dropdown — an Apple Pencil tap
on a tablet arguably wants the modal too, but a Surface pen paired with a keyboard does not, and pen
input on this surface is rare. Pinned by test so the choice is deliberate rather than incidental.

## Behaviour

| Interaction                                   | Before                                           | After                                                                                         |
| --------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Tap nav search bar (finger)                   | focus → inline dropdown, soft keyboard covers it | **modal palette**; its own input autofocuses, so the keyboard opens against the modal instead |
| Click nav search bar (mouse / trackpad / pen) | inline dropdown                                  | unchanged                                                                                     |
| Tab to nav search bar                         | inline dropdown                                  | unchanged                                                                                     |
| `Ctrl+K` / `⌘K`                               | modal palette                                    | unchanged                                                                                     |
| **`/`**                                       | go to Explore                                    | **modal palette**                                                                             |
| **`/` on layouts where `/` needs Shift**      | dead                                             | **modal palette**                                                                             |
| `Ctrl+/`                                      | cycle search mode                                | unchanged                                                                                     |
| `?`                                           | shortcuts modal                                  | unchanged                                                                                     |
| Magnify button below 640px                    | modal palette                                    | unchanged                                                                                     |
| `Ctrl+K` chip shown                           | always ≥640px                                    | only when `pointer: coarse` is false                                                          |

## Implementation

### `web/src/lib/components/global-search/global-search.svelte`

Three edits: two in the `variant === 'dropdown'` markup, one in the script block.

**Route touch taps to the modal.** `Command.Input` (~L631) gains an `onpointerdown` handler: when
`event.pointerType === 'touch'`, call `event.preventDefault()` and `manager.open('modal')`.

The `preventDefault()` is load-bearing for two reasons, and both belong in a code comment:

- it suppresses the focus that would otherwise fire `onfocus={openDropdown}`, which calls
  `manager.open('dropdown')` and clobbers `presentation` straight back to `'dropdown'`;
- it stops iOS raising the soft keyboard against _this inline input_, which the modal is about to
  cover. The modal's own `Command.Input` autofocuses once it opens, so the keyboard still appears —
  just against the modal's input instead of this one.

**Hide the chip on coarse pointers.** Wrap the `<kbd>` block (L652–656) in
`{#if !mediaQueryManager.pointerCoarse}`. `mediaQueryManager` is already imported at L24. The
existing `hidden … sm:inline-block` classes stay, so sub-640px behaviour is unchanged.

**Guard the modal against focus downgrade.** `openDropdown` currently reads
`if (!showDropdownPanel) { manager.open('dropdown') }`. `showDropdownPanel` is false whenever the
palette is open _as a modal_, so any focus landing on the nav input while the modal is open flips
`presentation` back to `'dropdown'`. Tighten it to return early when
`manager.isOpen && manager.presentation === 'modal'`. This is the invariant behind the
`preventDefault()` above — focus must never downgrade an open modal — and holds even if a browser or
assistive technology focuses the input by a path `preventDefault()` does not cover.

### `web/src/lib/utils/search-shortcut.ts` (new)

The `/` binding needs a guard, and `+layout.svelte` has no spec file and no precedent for testing
layout-level shortcuts — it is a large component with many dependencies. Putting the logic in a small
pure module makes all of it directly testable and leaves `+layout.svelte` with nothing but wiring.

The module exports two things:

- `isEditableTarget(element: Element | null): boolean` — true for `input`, `textarea`, `select`, or
  anything matching `[contenteditable]`.
- `searchShortcuts(open: () => void): ShortcutOptions[]` — returns the two descriptors below, each
  wrapping `open` in an `isEditableTarget(document.activeElement)` bail-out.

```js
[
  { shortcut: { key: '/' }, onShortcut: guarded },
  { shortcut: { key: '/', shift: true }, onShortcut: guarded },
];
```

**Why two descriptors.** `matchesShortcut` in `@immich/ui` compares modifiers strictly:
`Boolean(shortcut.shift) === event.shiftKey`. On German QWERTZ, Spanish and Italian layouts `/` is
Shift+7; on AZERTY it is Shift+:. All emit `event.key === '/'` with `shiftKey: true`, so a lone
`{ key: '/' }` never matches and the shortcut is dead for those users. There is no collision with
`?`: on US layouts Shift+/ emits `event.key === '?'`, so the shift descriptor only fires on layouts
where Shift genuinely produces `/`.

**Why the editable guard.** `@immich/ui`'s `shouldIgnoreEvent` skips shortcuts only for `type` in
`textarea, text, date, datetime-local, email, password`. It misses `type="search"` — used by
`space-albums-controls.svelte:108` — so typing `/` in the space album filter would open the palette
instead of inserting the character. `type="number"` (6 uses) is uncovered too. The app has no
`contenteditable` today; including it keeps the guard correct if one appears.

`Command.Input` renders `type="text"`, so `/` typed into the palette itself is already ignored by the
built-in guard; this guard reinforces it rather than changing it.

`matchesShortcut`, `shouldIgnoreEvent` and the `ShortcutOptions` type are all public — `@immich/ui`'s
entry point does `export * from './actions/shortcut.js'` — so tests can drive the real matcher rather
than reimplementing it.

### `web/src/routes/+layout.svelte`

Spread `searchShortcuts(openModalSearch)` into the existing `use:shortcuts` array. Passing
`openModalSearch` inherits its feature-flag guard and `toggle('modal')` semantics unchanged.

### Upstream files — remove `/` → Explore

- `web/src/lib/components/shared-components/gallery-viewer/GalleryViewer.svelte:274` — delete the
  binding. `goto` and `Route` each have another use in the file, so imports stay. One-line diff.
- `web/src/lib/components/timeline/actions/TimelineKeyboardActions.svelte:119` — delete the binding
  **and** the now-unused `goto` (L2) and `Route` (L17) imports, or lint fails. Three-line diff.

Both are upstream files; the diffs are pure deletions, which rebase cleanly.

### `web/src/lib/modals/ShortcutsModal.svelte`

Add `{ key: ['/'], action: $t('shortcut_open_global_search') }` beside the existing `Ctrl+K` row.
Reusing the existing i18n key means no new strings across the locale files. `/` → Explore was never
documented, so nothing is removed.

## Behaviour change worth naming

`/` → Explore was suppressed while the asset viewer was open (`TimelineKeyboardActions` returns an
empty shortcut list when `assetViewerManager.isViewing`). The new `/` binding lives at the layout
level, so it fires over the asset viewer as well. This matches `Ctrl+K`, which is already global, so
the two aliases stay consistent. This follows from where the binding is registered rather than from
any branch in our own code, so it is recorded here and checked by hand, not by a unit test.

## Test plan

TDD throughout: every test below is written first and observed failing for the intended reason
before the corresponding implementation lands. Tests are named as behaviour statements
(`it('opens the modal palette when the search bar is tapped')`).

### `global-search-input-trigger.spec.ts` — pointer routing

Extends the existing suite, which already asserts click → dropdown.

`user.pointer({ keys: '[TouchA]', target: input })` performs a full press **and** release, which
matters here. userEvent models the browser faithfully: `press()` dispatches `pointerdown` and records
`pointer.isPrevented`, skipping `mouse.down` for touch; `release()` then calls
`mouse.down(instance, keyDef, isPrevented)` (`system/pointer/index.js:80`), and `mouse.down` runs
`focusElement(target)` only when `isPrevented` is false (`system/pointer/mouse.js:76-79`).

So focus arrives at **release**, after our `pointerdown` handler has already set
`presentation = 'modal'`. Without `preventDefault()`, that release-time focus fires `openDropdown`
and clobbers the presentation back to `'dropdown'` — which is exactly the RED signal the first test
should produce. `expect(input).not.toHaveFocus()` is therefore a real assertion, not a jsdom artefact.

| Scenario                                             | Expected                                                                         |
| ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| Finger tap, full press+release                       | `open` called with `'modal'`; no `[data-cmdk-dropdown-panel]` in the DOM         |
| Finger tap                                           | input is **not** focused (`preventDefault()` suppressed the release-time focus)  |
| Finger tap                                           | `presentation` is still `'modal'` after release (the clobber regression)         |
| Mouse click                                          | `open` called with `'dropdown'`; panel present (regression guard for decision 4) |
| Pen input (`pointerType: 'pen'`)                     | dropdown, not modal (pins decision 4's scope)                                    |
| `pointerType` absent/empty (synthetic `pointerdown`) | falls through to dropdown                                                        |
| Keyboard focus via Tab, no pointer event             | dropdown, on touch-capable devices too                                           |
| Tap while the dropdown is already open               | ends in `presentation === 'modal'`                                               |
| Tap, close modal, tap again                          | reopens the modal; no stuck presentation state                                   |
| Focus the nav input while the modal is open          | stays `'modal'` (the `openDropdown` guard)                                       |

### `global-search-input-trigger.spec.ts` — chip visibility

`mediaQueryManager.pointerCoarse` is an object-literal getter, so
`vi.spyOn(mediaQueryManager, 'pointerCoarse', 'get')` stubs it per test.

The two label rows need more care: `isApplePlatform` is a **module-scope** `const` in
`global-search.svelte:44`, evaluated once at import. Stubbing `navigator.platform` inside a test has
no effect on an already-imported module, so those two rows require `vi.resetModules()` plus a dynamic
`import()` after the stub is in place. If that proves brittle, drop the two label rows — they cover
pre-existing behaviour this change does not touch — and keep the presence/absence rows, which are
the ones that matter for #862.

| Scenario                                  | Expected                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `pointerCoarse` true                      | no `<kbd>` in the DOM                                                                    |
| `pointerCoarse` false                     | `<kbd>` present                                                                          |
| `pointerCoarse` false, non-Apple platform | reads `Ctrl+K`                                                                           |
| `pointerCoarse` false, Apple platform     | reads `⌘K`                                                                               |
| Either value                              | input keeps `role="combobox"` and its accessible name — the chip is not part of the name |

Aside, not a bug to fix here: iPadOS Safari reports `navigator.platform === 'MacIntel'`, so iPads
already render `⌘K` rather than `Ctrl+K` — consistent with the screenshot in #862. Hiding the chip on
coarse pointers makes the distinction moot on those devices.

### `search-shortcut.spec.ts` — the `/` binding

Tests target the pure module and drive `@immich/ui`'s real `matchesShortcut` against synthetic
`KeyboardEvent`s, so the layout-sensitivity fix is verified against the actual matcher rather than a
reimplementation of it. `open` is a `vi.fn()`.

| Scenario                                                             | Expected                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `searchShortcuts(open)` shape                                        | exactly two descriptors: `{ key: '/' }` and `{ key: '/', shift: true }` |
| `{ key: '/', shiftKey: false }`                                      | matches exactly one descriptor                                          |
| `{ key: '/', shiftKey: true }` (QWERTZ / AZERTY / Spanish / Italian) | matches exactly one descriptor                                          |
| `{ key: '?', shiftKey: true }` (US Shift+/)                          | matches neither — the shortcuts modal keeps `?`                         |
| `{ key: '/', ctrlKey: true }`                                        | matches neither — `Ctrl+/` stays the mode-cycle binding                 |
| `{ key: '/', altKey: true }` / `{ key: '/', metaKey: true }`         | match neither                                                           |
| `onShortcut` with `document.activeElement` unfocused (`body`)        | `open` called once                                                      |
| `onShortcut` with `<input type="text">` focused                      | `open` not called                                                       |
| `onShortcut` with `<input type="search">` focused                    | `open` not called — the gap `shouldIgnoreEvent` misses                  |
| `onShortcut` with `<input type="number">` focused                    | `open` not called                                                       |
| `onShortcut` with `<textarea>` focused                               | `open` not called                                                       |
| `onShortcut` with `<select>` focused                                 | `open` not called                                                       |
| `onShortcut` with a `[contenteditable]` element focused              | `open` not called                                                       |
| `isEditableTarget(null)`                                             | `false`, no throw                                                       |

Two `/` behaviours are wiring, not module logic, and are confirmed by reading the rendered layout
rather than by a unit test: the feature-flag guard and the `toggle('modal')` semantics come from
`openModalSearch`, which this change passes through untouched and which the `Ctrl+K` path already
exercises; and `/` firing over the asset viewer follows from the binding living at layout level,
the same as `Ctrl+K`.

`/` typed into the palette's own input needs no test — `Command.Input` renders `type="text"`, which
`shouldIgnoreEvent` already covers, and the editable guard covers it a second time.

### Regression

- `Ctrl+K` and `⌘K` still open the modal on their respective platforms.
- Explore is no longer reachable by `/` on the timeline or in the gallery viewer. No existing test
  asserts that binding, so the deletions break nothing — the two removals are covered only by the
  behaviour table above.
- `svelte-check` and `tsc --noEmit` clean — catches the unused `goto` / `Route` imports.

Verification runs `pnpm test` in `web/`, plus `make check-web` and `make lint-web`.

No Playwright coverage: `e2e/playwright.config.ts` defines only `Desktop Chrome` projects, and
standing up a touch project for one interaction is not proportionate. The tap path is fully covered
by the unit tests above.

## Out of scope

- Full-bleed modal styling on tablets (decision 6).
- Rewriting `@immich/ui`'s `shouldIgnoreEvent`; the local `isEditableTarget` guard covers the `/`
  binding without patching a dependency.
- Extending the shift-variant fix to other bare-key shortcuts (`f`, `i`, `x`, `g`, …), which have
  the same layout sensitivity. Pre-existing, unrelated to #862.
- The sub-640px magnify button, which already works.

## Risks

| Risk                                                                      | Mitigation                                                                                                                         |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Users relying on `/` → Explore lose it                                    | Sidebar entry unchanged; `/` = search is the stronger convention                                                                   |
| ~~One-frame chip flash on touch after hydration~~ — does not apply        | `web/src/routes/+layout.ts:9` sets `ssr = false`; there is no SSR render pass, so there is nothing for hydration to reconcile away |
| `preventDefault()` on pointerdown blocks focus more broadly than intended | Guarded to `pointerType === 'touch'`; mouse, pen, and keyboard paths each covered by test                                          |
| A browser focuses the nav input by a path `preventDefault()` misses       | The `openDropdown` early-return holds the invariant independently                                                                  |
| Upstream edits conflict on rebase                                         | Pure deletions in two files, three lines total                                                                                     |

## Verified against the codebase

Every anchor and claim below was confirmed in this worktree before the plan was written.

| Claim                                                                                                  | Confirmed                                              |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `mediaQueryManager` imported at `global-search.svelte:24`; `pointerCoarse` is an object-literal getter | yes — spy-able with `vi.spyOn(…, 'get')`               |
| `isApplePlatform` / `hotkeyLabel` at `global-search.svelte:44-45`                                      | yes — module scope, hence the `resetModules` note      |
| `Command.Input` at `global-search.svelte:631`, `<kbd>` at `652-656`                                    | yes                                                    |
| `openModalSearch` at `+layout.svelte:235`, `use:shortcuts` array at `279`                              | yes                                                    |
| `/` → Explore at `GalleryViewer.svelte:274` and `TimelineKeyboardActions.svelte:119`                   | yes                                                    |
| `goto` (L2) and `Route` (L17) unused in `TimelineKeyboardActions` after deletion                       | yes — both have exactly one use, that line             |
| `goto` / `Route` still used elsewhere in `GalleryViewer`                                               | yes — two uses each, imports stay                      |
| `Ctrl+K` row at `ShortcutsModal.svelte:35`; `shortcut_open_global_search` exists                       | yes — `i18n/en.json:2608`, no new strings              |
| `matchesShortcut` compares modifiers strictly                                                          | yes — `Boolean(shortcut.shift) === event.shiftKey`     |
| `shouldIgnoreEvent` allowlist misses `type="search"`                                                   | yes — one use, `space-albums-controls.svelte:108`      |
| No `contenteditable` anywhere in `web/src`                                                             | yes — guard clause is forward-looking only             |
| `Command.Input` renders `type="text"`                                                                  | yes — `bits-ui` `CommandInputState.props`              |
| `matchesShortcut` / `ShortcutOptions` importable from `@immich/ui`                                     | yes — `export * from './actions/shortcut.js'`          |
| Explore still reachable without the shortcut                                                           | yes — `UserSidebar.svelte:67`                          |
| No existing spec covers `+layout.svelte` or the `/` → Explore binding                                  | yes — hence the extracted module                       |
| Playwright defines only `Desktop Chrome` projects                                                      | yes                                                    |
| userEvent honours `preventDefault()` on `pointerdown` for touch                                        | yes — `pointer/index.js:80` → `pointer/mouse.js:76-79` |
