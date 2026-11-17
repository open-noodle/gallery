# Mobile nav dock: the tab bar folds on scroll

Prototype: `specs/mockups/mobile-nav-dock.html` (interactive; open in a browser, "Jump to" covers every case below).

## Why

On the tab shell, `GalleryBottomNav` shows a content-sized tab pill plus a round search blob. Photos' grouping (Years / Months / All) sits in an app-bar menu (`PhotosViewMenuButton`) at the top of the screen, away from the thumb. While you browse a long timeline, nothing at the bottom moves out of the way.

The owner wants the shell's bottom chrome modelled on the iOS 26 tab bar with its accessory row (Apple Music's now-playing bar):

- On Photos, the grouping row sits above the tabs.
- Scrolling down folds both rows into one; scrolling up unfolds them.
- The change is one spring motion rather than a show/hide.

## Decisions (owner, 2026-11-17)

1. **Two rows, folding to one.** On Photos the dock has the grouping row **above** the tab bar. Scrolling down folds both into one row; scrolling up unfolds it. The motion is a spring with a small overshoot (the prototype's "springy").
2. **The search field and filter chips stay at the top.** The search header from `specs/2026-10-23-mobile-search-redesign-design.md` is unchanged. In Photos search mode the dock shows the folded tab circle and the grouping row, pinned to the bottom of the screen.
3. **Detail pages keep working as they do now.** A space, album, person or any other page pushed over the shell keeps today's `TimelineGroupingBottomPill` (grouping plus a search button) and shows no tab bar. The dock is a tab-shell thing only.
4. **Keep fork code separate.** New code lives in `mobile/lib/gallery/dock/`. Upstream files get no new hunks; existing fork hunks may only be replaced in place or removed.

## The dock

### States

| State | Row 1 (top) | Row 2 (bottom) |
| --- | --- | --- |
| **Unfolded** (default, at the top, after scrolling up) | Grouping row: `Years · Months · All` segmented control plus a display-options button. **Photos tab only.** | Tab bar: the three nav slots (`galleryNavSlotsProvider`) and Search, in one glass pill with a sliding selection highlight. |
| **Folded** (after scrolling down) | none | A circle holding the active tab's icon on the left, the grouping control in the middle (display-options button hidden), and a search circle on the right. On the other tabs the middle stays empty. |
| **Search** (Photos search mode) | none | Tab circle on the left and the grouping row filling the rest. The field and chips stay in the top header. |

What morphs into what, with all geometry on one spring:

- The tab pill shrinks into the left circle. Inactive tabs scale down and fade, labels fade and blur, and the active icon slides to the circle's centre.
- The search slot detaches from the tab pill and becomes its own glass circle on the right.
- The grouping row drops into the gap between the two circles and narrows. Its display-options button collapses to zero width.

### Interactions

- **Fold and unfold.** The shell wraps its tab `child` in a listener for vertical `UserScrollNotification`s; they bubble up from whichever tab is showing:
  - `ScrollDirection.reverse` (content moving up) after about 24 px of travel folds the dock.
  - `forward`, or reaching the top (offset under 30 px), unfolds it.
  - Rubber-banding at the end of the scroll is ignored.
  - Horizontal scrollables (the memory lane) are ignored, and so are scrollables nested inside a scrollable (`notification.depth > 0`).
  - Switching tab unfolds the dock.
- **Tap the circle while folded:** unfold.
- **Tap a tab while unfolded:** as today. Re-tapping Photos scrolls to the top (`ScrollToTopEvent`), and every tap runs the existing refresh side effects in `_onTabTap`.
- **Tap search:** `openGallerySearch`, as today.
- **In search, tap the circle:** leave search mode, the same as the header's ←.
- **Display options:** the button opens the existing library-view menu (`_PhotosViewMenu`: Everything / Personal / Spaces). The grouping control in the row replaces the grouping section of that menu, so the menu keeps only the library view.

### Unchanged behaviour carried over

- Hidden while multi-select is on, and while the keyboard is up (`viewInsets.bottom > 80`). The same 200 ms slide and fade as today.
- In read-only mode the collection and library slots are disabled.
- Landscape keeps the `NavigationRail`; the dock is portrait only. In landscape the grouping stays in the Photos app bar, as today.
- Labels that don't fit shrink the tabs rather than pushing search off-screen (#909). Search keeps its full slot.
- RTL mirrors the geometry: the tab circle sits on the right.
- Reduced motion (`GalleryMotion.reduced`): no spring and no overshoot, a 150 ms ease.

### Sizes

The tab bar is 64 high, the grouping row 52, with a 10 gap between rows. Each folded circle is 56. The dock sits 14 from the sides and floats `max(26, safe-area bottom)` from the bottom.

`bottomNavHeightProvider` publishes the **unfolded** height for the active tab. That is tab bar plus grouping row on Photos, and the tab bar alone elsewhere. Folding never changes it, so content never jumps: the last row of photos clears the dock at rest, and folding only reveals more photos behind the glass.

## Detail pages

Unchanged. Pages pushed over the shell cover the dock as they cover the nav today, and keep `TimelineGroupingBottomPill` from the existing `timeline.widget.dart` hunk. The same goes for the map's bottom-sheet timeline, the asset viewer, editors, slideshow and memories.

The owner reported the grouping pill showing in the middle of the screen during search. The cause has not been found from reading the code (`resizeToAvoidBottomInset` is false on both the shell and the timeline scaffold). A screenshot is owed:

- If it is the Photos search, this change fixes it, because the dock lays the row out against the bottom edge itself.
- If it is a detail page, it is a separate fix in `TimelineGroupingBottomPill`.

## Search mode on Photos

- `PhotosSearchFrame` stops adding its own `TimelineGroupingBottomPill`.
- `GalleryBottomNav` no longer hides when `searchModeProvider` is on. It switches the dock to its search state instead.
- The reserved bottom padding `PhotosSearchFrame` adds in search mode becomes the dock's single-row height.
- The chip sheets (People, Places, Dates, Filters) open over the dock as they open over the pill today.

## Layering

Everything new is in `mobile/lib/gallery/dock/`:

| File | Holds |
| --- | --- |
| `gallery_dock.widget.dart` | The dock: geometry for the three states, spring, glass surface |
| `gallery_dock_fold.dart` | The fold state notifier, and the scroll-direction listener the shell wraps around its child |
| `gallery_dock_accessory.dart` | The grouping row, wrapping `TimelineGroupingSelector(bare: true)` and the display-options button |

`TimelineGroupingSelector` reads only `timelineOverviewModeProvider`. Photos uses `sharedGrouping: true`, so that provider is not overridden there, and the shell's dock drives the Photos grouping directly.

Fork files that change:

- `gallery_bottom_nav.widget.dart` renders the dock instead of the pill and blob.
- `gallery_tab_shell.page.dart` wraps `child` in the scroll listener.
- `search_frame.widget.dart` changes as described under Search mode.
- `photos_view_menu.widget.dart`: the menu loses its grouping section, and the button moves into the dock.

`gallery_nav_pill.widget.dart` and `gallery_search_blob.widget.dart` are deleted once nothing uses them.

Upstream files: `main_timeline.page.dart` keeps the `PhotosViewMenuButton` hunk only for landscape, or loses it if landscape gets the menu elsewhere. Either way its diff against `refs/upstream/v3.4.1` does not grow. No other upstream file is touched.

No new i18n keys: the tab labels, `display_options`, and the grouping labels (`timeline_grouping_*`) already exist.

## Compatibility

Client-only. No endpoint, DTO or sync change, so every pairing in CLAUDE.md rule 6 sees the same API as before. Old app on a new server and new app on an old server are both unaffected. A stock Immich app is unaffected.

## Testing

Widget tests in `mobile/test/gallery/dock/`:

- **State matrix.** For each state (unfolded, folded, search) × Photos or another tab × LTR/RTL: the pill rectangles match the table above, and the circle shows the active slot's icon.
- **Scroll.** Reverse past the threshold folds the dock. Forward unfolds it. Horizontal and nested notifications are ignored. Offset under 30 px always unfolds. A tab switch unfolds.
- **Taps.** Folded circle → unfolds. Re-tap Photos → `ScrollToTopEvent`. Search → `openGallerySearch`. Circle in search → leaves search.
- **Reserved height.** It equals the unfolded height on Photos and on the other tabs, and it does not change when the dock folds.
- **Carried over** from `gallery_bottom_nav_test.dart`: multi-select hide, keyboard hide, read-only disabled slots, #909 narrow-screen labels, landscape rail, reduced motion.

Existing tests that reference the old widgets or keys get updated: `gallery_tab_shell_test`, `gallery_bottom_nav_test`, `photos_view_menu_test`, `photos_search_mode_test`, `main_timeline_page_test`. The detail-page and pill tests (`timeline_grouping_bottom_pill_test`, `timeline_with_grouping_pill_test`, `scoped_search_test`, `map_bottom_sheet_timeline_test`, the page tests) must pass unchanged.

On device, iOS and Android:

- Folding feels right on a long Photos timeline.
- The grouping row sits at the bottom in Photos search, with the keyboard open and closed.
- Detail pages look as they do today.
