# Web: compact sidebar rail

Design doc for the sidebar half of [discussion #912](https://github.com/open-noodle/gallery/discussions/912).

## Problem

On tablets and medium screens the web app's chrome crowds out the photo grid. #912 raises three
contributors: the sidebar, the Space header banner, and the filter panel. This spec covers **only the
sidebar**. The banner and filter panel get their own specs later, referencing the same discussion.

Today the sidebar is binary:

- `≥ 850px` (`--breakpoint-sidebar`): full 16rem sidebar, always visible.
- `< 850px`: fully hidden; the hamburger floats it over the content.

There is no middle state, so a 900px-wide iPad spends 16rem on navigation. Worse, the threshold is a
fixed width, so rotating an iPad flips the sidebar between "always there" and "always hidden" with no
user control — the specific complaint in the thread.

## Goal

Add a third state: a thin icon rail, modelled on Google Photos. It is reachable by an explicit user
setting and is the automatic default on medium screens. A reply on #912 (LoPeraa) asks specifically
for the Google Photos pattern where the rail expands on hover.

## Decisions

| Question           | Decision                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------ |
| Scope              | Sidebar only. Space header banner and filter panel are out of scope.                             |
| Rail behaviour     | Hover expands the full sidebar as a floating overlay. The photo grid never reflows.              |
| Setting            | Three-value preference, defaulting to width-driven `auto`.                                       |
| Rail contents      | Icons only, text group headers become dividers, sub-trees hidden, storage collapses to one icon. |
| Rendering approach | Fork-local `sidebar-nav-item.svelte` owning its own markup.                                      |
| Constraint         | Keep changes in fork-only files wherever possible to limit rebase conflicts.                     |

### Why a fork-local nav item

`NavbarItem` comes from `@immich/ui` and unconditionally renders
`<span class="truncate text-sm font-medium">{title}</span>`. There is no icon-only variant. Three
options were considered:

1. **Fork-local component owning its markup** — chosen. The label stays mounted and animates to zero
   width, so rail↔expanded is a pure CSS transition rather than a component swap needing a cross-fade.
   No coupling to `@immich/ui` internals. Costs ~40 lines duplicated from `NavbarItem`, which can drift
   cosmetically on a UI bump — a visual divergence, not a breakage.
2. **CSS-only collapse of `NavbarItem`** — rejected. Smallest diff and also smooth, but it targets
   `@immich/ui`'s internal span/chevron structure by selector. A UI bump that rewraps the span silently
   un-collapses the rail.
3. **Extend `patches/@immich__ui@0.83.0.patch`** — rejected. Cleanest call sites, but this fork rebases
   onto upstream regularly and every `@immich/ui` bump would make that hunk a merge conflict. The
   existing patch is deliberately small and behavioural; adding a feature to it is a different
   commitment.

## State model

Three concepts: the user's **mode** preference, the **resolved layout**, and two transient expansion
flags.

```ts
// web/src/lib/stores/sidebar-mode.svelte.ts  (fork-only)
export type SidebarMode = 'auto' | 'expanded' | 'rail';
export type SidebarLayout = 'overlay' | 'rail' | 'expanded';
```

`sidebarMode` is persisted via `persisted()` from `svelte-persisted-store`, defaulting to `'auto'`. The
stored value is validated on read against the three known values; anything else falls back to `'auto'`.

Resolution, evaluated reactively so a resize or rotation re-resolves live:

| Viewport         | `auto`     | `expanded` | `rail`    |
| ---------------- | ---------- | ---------- | --------- |
| `< 850px`        | `overlay`  | `overlay`  | `overlay` |
| `850px – 1279px` | `rail`     | `expanded` | `rail`    |
| `≥ 1280px`       | `expanded` | `expanded` | `rail`    |

`< 850px` is always `overlay` regardless of mode: a rail costs ~4rem, which a phone cannot spare, and
this preserves today's behaviour exactly on phones.

The `≥ 850px` query already exists as `mediaQueryManager.isFullSidebar`. The `≥ 1280px` query is new
and lives in the fork-only store rather than in upstream `media-query-manager.svelte.ts`.

### Why rail expansion does not reuse `sidebarStore.isOpen`

Upstream `sidebarStore` is built on the assumption that `≥ 850px` means "sidebar fully visible". Rail
mode invalidates that assumption in three ways:

- `isOpen` is `$derived.by(() => mediaQueryManager.isFullSidebar)`, so above 850px it is **permanently
  `true`**. Driving rail expansion from it would yield a permanently expanded rail.
- `toggle()` is `this.isOpen = mediaQueryManager.isFullSidebar ? true : !this.isOpen`
  (`stores/sidebar.svelte.ts:17`). Above 850px it **always assigns `true` and never closes**, so a
  hamburger wired to it could open the rail overlay but never dismiss it.
- `isOpen` must stay a settable `$derived` because `AdminPageLayout` does
  `bind:open={sidebarStore.isOpen}`.

Therefore the fork-only store owns two transient flags of its own, and upstream `sidebar.svelte.ts` is
**not modified**:

- `hoverExpanded` — `$state`, set by pointer/focus, meaningful only when `layout === 'rail'`.
- `railOverlayOpen` — `$state`, the touch/keyboard affordance toggled by the hamburger in rail mode. A
  real toggle, so it closes.

The shell derives its rendered width from `layout`, `hoverExpanded` and `railOverlayOpen` only. It
**ignores `isOpen` whenever `layout === 'rail'`**, and uses `isOpen` only in the `overlay` case, where
today's behaviour is preserved unchanged.

`railOverlayOpen` is reset on navigation by a `beforeNavigate` registered **inside the fork-only
shell**, so upstream `+layout.svelte` stays untouched.

## Layout and widths

Two grids currently hardcode the width:

- `UserPageLayout`: `grid-cols-[--spacing(0)_auto] sidebar:grid-cols-[--spacing(64)_auto]`
- `NavigationBar`: `grid-cols-[--spacing(32)_auto] sidebar:grid-cols-[--spacing(64)_auto]`

`UserPageLayout` becomes driven by a custom property set inline from the store:

| `layout`   | `--sidebar-width`       |
| ---------- | ----------------------- |
| `overlay`  | `0`                     |
| `rail`     | `--spacing(16)` = 4rem  |
| `expanded` | `--spacing(64)` = 16rem |

The edit should be a single token with an upstream-equivalent fallback, so an unset variable behaves
exactly as today. The exact Tailwind 4 spelling for a `var()` fallback wrapping `--spacing(64)` must be
verified during implementation; if it does not compile, fall back to an explicit conditional class
string.

### The navbar column is NOT `--sidebar-width`

`NavigationBar`'s first column holds the hamburger **and** the `Logo`, with `mx-4` margins — which is
why its sub-850px value is `--spacing(32)` = 8rem rather than 0. Rail mode requires the hamburger to be
visible (see Interaction), so 4rem cannot fit both. The navbar column therefore resolves separately:

| `layout`   | navbar first column     |
| ---------- | ----------------------- |
| `overlay`  | `--spacing(32)` = 8rem  |
| `rail`     | `--spacing(32)` = 8rem  |
| `expanded` | `--spacing(64)` = 16rem |

`Logo variant` is `icon` for `overlay` and `rail`, `inline` for `expanded`.

### Pages that supply their own sidebar

`UserPageLayout` takes an optional `sidebar` snippet. Two routes use it to render a **tree explorer**
rather than the nav rail, each wrapping upstream `Sidebar.svelte`:

- `routes/(user)/tags/[[photos=photos]]/[[assetId=id]]/+page.svelte:137`
- `routes/(user)/folders/[[photos=photos]]/[[assetId=id]]/+page.svelte:81`

A tag or folder tree has no meaningful icon-only form, and `Sidebar.svelte` renders `sidebar:w-64`
regardless of our custom property. If `UserPageLayout` applied the rail width there, those pages would
put a 16rem sidebar inside a 4rem grid column.

**Therefore: when the `sidebar` snippet is supplied, `UserPageLayout` uses the `expanded` width above
850px and `0` below**, exactly matching today's behaviour. `/tags` and `/folders` are unaffected by this
feature, and upstream `Sidebar.svelte` stays untouched along with its existing spec.

### Hover-expand without reflow

The `<nav>` keeps its grid slot at `--sidebar-width`. The inner scroll container is absolutely
positioned, `z-10`, and transitions its own width from 4rem to 16rem with a shadow. The grid column
never changes, so the justified timeline never re-lays-out.

Transitions are gated on `mediaQueryManager.reducedMotion`.

## Components

### New (fork-only, kebab-case per recent fork convention)

| File                                                                    | Role                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `web/src/lib/stores/sidebar-mode.svelte.ts`                             | `sidebarMode`, `≥1280px` query, `layout`, `hoverExpanded`, `railOverlayOpen` |
| `web/src/lib/components/sidebar/sidebar-shell.svelte`                   | rail/overlay container for the nav sidebar                                   |
| `web/src/lib/components/sidebar/sidebar-nav-item.svelte`                | icon + label row                                                             |
| `web/src/lib/components/shared-components/side-bar/rail-storage.svelte` | compact storage icon                                                         |
| `web/src/routes/(user)/user-settings/sidebar-settings.svelte`           | the setting block                                                            |

### Modified (upstream — four files)

| File                    | Change                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| `UserSidebar.svelte`    | shell swap, 18 `NavbarItem` + 1 `NavbarGroup` swaps, storage branch       |
| `UserPageLayout.svelte` | width variable + custom-sidebar guard                                     |
| `NavigationBar.svelte`  | navbar column, `Logo variant`, hamburger visibility wired to rail overlay |
| `AppSettings.svelte`    | one import + one `<SidebarSettings />` line                               |

### Deliberately untouched

`Sidebar.svelte` (and `Sidebar.spec.ts`), `stores/sidebar.svelte.ts`, `BottomInfo.svelte`,
`StorageSpace.svelte`, `preferences.store.ts`, `media-query-manager.svelte.ts`, `app.css`,
`+layout.svelte`, `AdminPageLayout.svelte`.

Admin pages are unaffected: `AdminPageLayout` uses `@immich/ui`'s `AppShellSidebar`, a different
component, and keeps today's binary behaviour.

### `rail-storage` duplicates quota derivation, guarded by a parity test

The used/available computation lives inside `StorageSpace.svelte:12-21` — `authManager.user.quotaSizeInBytes`
versus `userInteraction.serverInfo`, plus an `onMount` `requestServerInfo()`. `rail-storage.svelte`
must reproduce it, because adding a `compact` prop to `StorageSpace` would mean a fifth upstream file.

Duplication risks silent drift if upstream changes quota semantics. To catch that in CI rather than in
production, a parity test renders both components against the same store state and asserts they report
the same used and available byte values.

## Interaction and accessibility

The hamburger is currently `class="sidebar:hidden"` — hidden at `≥ 850px`, because at that width the
sidebar was always fully visible. **Rail mode breaks that assumption.** Hover does not exist on touch,
so an iPad user at `≥ 850px` in rail mode would have no route to the labels. The hamburger must be
visible whenever `layout === 'rail'`, and in that mode it toggles `railOverlayOpen` rather than calling
`sidebarStore.toggle()`.

- **Pointer:** `pointerenter` / `pointerleave` on the nav toggle `hoverExpanded`. JavaScript state
  rather than CSS `:hover`, because the `items` sub-trees need conditional rendering, not just styling.
- **Touch** (`mediaQueryManager.pointerCoarse`): no hover-expand. Tapping a rail icon navigates. The
  hamburger opens and closes the overlay, the same affordance as below 850px.
- **Keyboard:** `focusin` expands, `focusout` collapses, so labels are visible while tabbing. `Escape`
  collapses without stealing focus.
- **Click outside:** dismisses `railOverlayOpen`. It does not need to dismiss `hoverExpanded`, which
  `pointerleave` already handles.
- **Navigation:** `railOverlayOpen` resets on `beforeNavigate`. `hoverExpanded` does not, because after
  clicking a rail link the pointer is still over the rail.
- **Not modal:** `focusTrap` stays limited to the `< 850px` overlay. A hover-expanded rail does not trap
  focus, and `inert` is never set in rail mode.
- **Accessible name:** the label `<span>` stays mounted and is collapsed with width/opacity, not
  `display: none`, so each link keeps its accessible name. The rail additionally sets a `title` tooltip
  for sighted users.

## Settings and i18n

`sidebar-settings.svelte` renders a three-option control bound to `sidebarMode`, using
`SettingCombobox` for consistency with the existing `AppSettings` controls.

New keys go in `i18n/en.json` only — `sidebar_mode`, `sidebar_mode_description`, `sidebar_mode_auto`,
`sidebar_mode_expanded`, `sidebar_mode_rail`. The `i18n/` directory is shared between web and mobile;
other locales backfill separately.

## Implementation slices

**TDD throughout: for every slice, write the failing test first, watch it fail for the right reason,
then implement.** Each slice ends green with `pnpm test` from `web/`.

| #   | Slice                     | Delivers                                                               |
| --- | ------------------------- | ---------------------------------------------------------------------- |
| 1   | `sidebar-mode.svelte.ts`  | mode preference, `≥1280px` query, `layout` resolution, transient flags |
| 2   | `sidebar-nav-item.svelte` | icon + label row with rail collapse                                    |
| 3   | `sidebar-shell.svelte`    | container, hover/focus/Escape/click-outside, navigation reset          |
| 4   | `rail-storage.svelte`     | compact storage icon plus the parity test                              |
| 5   | `UserSidebar.svelte`      | wiring: shell, 18 rows, group divider, storage branch                  |
| 6   | Layout wiring             | `UserPageLayout` width + custom-sidebar guard, `NavigationBar` column  |
| 7   | Settings                  | `sidebar-settings.svelte`, `AppSettings` hook-up, i18n keys            |
| 8   | E2E                       | viewport-driven Playwright coverage                                    |

## Testing

New fork-only unit specs, extending the `vi.hoisted` +
`vi.mock('$lib/stores/media-query-manager.svelte')` pattern already used in `Sidebar.spec.ts`:
`sidebar-mode.spec.ts`, `sidebar-shell.spec.ts`, `sidebar-nav-item.spec.ts`, `rail-storage.spec.ts`,
`sidebar-settings.spec.ts`.

E2E lives in the viewport-driven `ui` Playwright project (`e2e/playwright.config.ts:43`,
`testDir: ./src/ui/specs`), alongside the existing `setViewportSize` specs under
`e2e/src/ui/specs/timeline/`.

### Assertion trap to design around

Because the label `<span>` deliberately stays in the DOM in rail mode to preserve the accessible name,
any `getByText('Photos')` assertion passes in **both** states and can never fail. Rail assertions must
target the resolved collapse state via a `data-*` attribute on the container, never text presence.

Similarly, do not assert on a class string that appears in more than one state, and do not assert
`toBeVisible()` on an element collapsed by width/opacity — happy-dom does not compute that the way a
browser does.

### Coverage matrix

| #   | Case                                                                                             | Slice |
| --- | ------------------------------------------------------------------------------------------------ | ----- |
| 1   | Full mode × width matrix (3 × 3 from the resolution table) resolves correctly                    | 1     |
| 2   | Resize/rotation across all three bands re-resolves live                                          | 1     |
| 3   | `hoverExpanded` resets when `layout` changes away from `rail`                                    | 1     |
| 4   | Corrupt or unknown persisted `sidebarMode` falls back to `auto`                                  | 1     |
| 5   | `railOverlayOpen` is a real toggle — opens **and** closes                                        | 1     |
| 6   | Hover expand and collapse on `pointerenter` / `pointerleave`                                     | 3     |
| 7   | Grid column stays at rail width while hover-expanded (no reflow)                                 | 3     |
| 8   | `focusin` expands, `focusout` collapses                                                          | 3     |
| 9   | `Escape` collapses a hover-expanded rail                                                         | 3     |
| 10  | Click-outside dismisses `railOverlayOpen`                                                        | 3     |
| 11  | `beforeNavigate` resets `railOverlayOpen` but leaves `hoverExpanded`                             | 3     |
| 12  | Shell ignores `isOpen` when `layout === 'rail'` (no permanently-expanded rail above 850px)       | 3     |
| 13  | `inert` never true in rail; focus trap inactive in rail                                          | 3     |
| 14  | Focus trap still active in the `< 850px` overlay (regression)                                    | 3     |
| 15  | Sub-trees (Recent Spaces / Recent Albums) hidden in rail, present when expanded                  | 2     |
| 16  | Hiding a sub-tree does not clobber the persisted `recentSpacesDropdown` flag                     | 2     |
| 17  | Active-route highlight visible in rail, including the exact-match `isActive` override for Spaces | 2     |
| 18  | Label stays in the accessibility tree in rail; `title` tooltip present                           | 2     |
| 19  | `NavbarGroup` "Library" renders as a divider in rail, as a text header when expanded             | 5     |
| 20  | `rail-storage` tooltip carries the same `storage_usage` string                                   | 4     |
| 21  | Parity: `rail-storage` and `StorageSpace` report identical used/available bytes                  | 4     |
| 22  | Reduced motion disables transitions                                                              | 3     |
| 23  | RTL: rail expands toward the inline-end in `dir="rtl"`                                           | 3     |
| 24  | Long translated labels truncate in the expanded overlay                                          | 2     |
| 25  | Hamburger visible in rail and `overlay`, hidden in `expanded`                                    | 6     |
| 26  | Hamburger closes an open rail overlay                                                            | 6     |
| 27  | Navbar first column is 8rem in rail, not `--sidebar-width`                                       | 6     |
| 28  | `Logo variant` is `icon` in rail, `inline` when expanded                                         | 6     |
| 29  | `/tags` and `/folders` keep the expanded width in rail mode (custom-sidebar guard)               | 6     |
| 30  | Admin pages unaffected — `AdminPageLayout` binary behaviour preserved                            | 6     |
| 31  | Setting control writes `sidebarMode` and the layout re-resolves                                  | 7     |
| 32  | Existing `Sidebar.spec.ts` and `user-sidebar.spec.ts` stay green unmodified                      | all   |
| 33  | E2E: at 1000px the rail is shown; hovering expands it without moving the photo grid              | 8     |
| 34  | E2E: at 1400px the full sidebar is shown; setting `rail` collapses it and survives reload        | 8     |
| 35  | E2E: tapping a rail icon navigates; the hamburger opens and closes the overlay                   | 8     |

## Out of scope

- Space header banner (compact / sticky-shrinking) — separate spec.
- Filter panel as an overlay — separate spec.
- Any mobile (Flutter) change.
- Backfilling non-English translations.
