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
| **Unfolded** (default, at the top, after scrolling up) | Grouping row: the `Years · Months · All` control (`TimelineGroupingSelector`, as on the detail-page pill). **Photos tab only.** | Tab bar: the three nav slots (`galleryNavSlotsProvider`) and Search, in one glass pill with a sliding selection highlight. |
| **Folded** (after scrolling down) | none | A circle holding the active tab's icon on the left, the grouping control in the middle, and a search circle on the right. On the other tabs the middle stays empty. |
| **Search** (Photos search mode) | none | Tab circle on the left and the grouping row filling the rest. The field and chips stay in the top header. |

What morphs into what, with all geometry on one spring:

- The tab pill shrinks into the left circle. Inactive tabs scale down and fade, labels fade and blur, and the active icon slides to the circle's centre.
- The search slot detaches from the tab pill and becomes its own glass circle on the right.
- The grouping row drops into the gap between the two circles and narrows.

### Interactions

- **Fold and unfold.** The shell wraps its tab `child` in `GalleryDockScrollListener`, which reads the vertical scroll notifications bubbling up from whichever tab is showing:
  - `ScrollDirection.reverse` (content moving up) after about 24 px of travel folds the dock.
  - `forward`, or reaching the top (offset under 30 px), unfolds it.
  - Rubber-banding at the end of the scroll is ignored.
  - A list that lands at the top without scrolling (Years / Months / All swapping the timeline, a tab page rebuilt by the nav setting) unfolds the dock through its new scroll metrics, and so does a drag that starts at the top, where a clamped list does not move.
  - Horizontal scrollables (the memory lane) are ignored.
  - Switching tab unfolds the dock.
- **Tap the circle while folded:** unfold.
- **Tap a tab while unfolded:** as today. Re-tapping Photos scrolls to the top (`ScrollToTopEvent`), and every tap runs the existing refresh side effects in `_onTabTap`.
- **Tap search:** `openGallerySearch`, as today.
- **In search, tap the circle:** leave search mode, the same as the header's ←.
- **Display options:** a round button at the end of the grouping row, shown while the dock is unfolded and once one of the user's spaces is on their timeline (`libraryViewVisibleProvider`). It opens a menu upwards headed "Assets shown" (videos are in the timeline too) with Everything / Only my photos / Only spaces, each with its icon, and tints like the selected grouping while a view narrows the timeline. The Photos app bar's `PhotosViewMenuButton` is gone (owner, 2026-11-18): the dock holds grouping and the library view, and the app bar adds no actions. In landscape, where there is no dock, neither control is shown.

### Unchanged behaviour carried over

- Hidden while multi-select is on, and while the keyboard is up (`viewInsets.bottom > 80`). The same 200 ms slide and fade as today.
- In read-only mode the collection and library slots are disabled.
- Landscape keeps the `NavigationRail`; the dock is portrait only.
- Labels that don't fit shrink the tabs rather than pushing search off-screen (#909). Search keeps its full slot.
- RTL mirrors the geometry: the tab circle sits on the right.
- Reduced motion (`GalleryMotion.reduced`): no spring and no overshoot, a 150 ms ease.

### Sizes

The tab bar is 64 high, the grouping row 46, with a 10 gap between rows. Each folded circle is 56. The dock sits 20 from the sides, a little in from a plain margin so the pills follow the screen's rounded corners. On an iPhone with a home indicator (safe-area bottom of 20 or more) it sits `max(16, safe-area bottom - 14)` from the bottom, down inside that area as iOS's own tab bar does. Android keeps `max(26, safe-area bottom)`: a swipe up from its bottom edge is the system's home gesture, so a control inside that zone would fight it. `GalleryDockStyle` holds the side and bottom insets, and the detail pages' pill uses the same ones.

`bottomNavHeightProvider` publishes the **unfolded** height for the active tab. That is tab bar plus grouping row on Photos, and the tab bar alone elsewhere. Folding never changes it, so content never jumps: the last row of photos clears the dock at rest, and folding only reveals more photos behind the glass.

## Detail pages

Pages pushed over the shell cover the dock as they cover the nav today, and keep `TimelineGroupingBottomPill` from the existing `timeline.widget.dart` hunk. The same goes for the map's bottom-sheet timeline, the asset viewer, editors, slideshow and memories.

The pill is built from the dock's own pieces, so there is one Years / Months / All control (owner, 2026-11-18):

- `TimelineGroupingSelector` fills its row, with a highlight that slides on the dock's spring in the tab bar's colours. The dock and the pill both render it.
- `GalleryGroupingRow` puts the selector and an optional round end button (`GalleryDockRowButton`) on the dock's `GalleryGlass`. The dock's end button is display options; the pill's is search.
- `GalleryDockStyle` (`gallery_dock_style.dart`) holds the spring, the highlight and the label colours. The tab bar reads them too.
- The pill spans the width less the dock's side insets, at the dock row's 46 height. `pillHeight` follows `GalleryDock.groupingHeight`.

The highlight's spring runs on the selected slot's index, not on pixels: the row narrows while the dock folds, and a pixel target would restart every frame and leave the highlight trailing.

## Library tab

With Spaces in the middle nav slot, the Albums card leads the Library tab's collection cards and the Spaces card takes the fifth place Albums had (Albums, People, Places, On this device, Spaces, Memories). With Albums in the nav, Spaces leads and Albums is fifth, as before. `libraryCollectionOrderProvider` in `library_collection_cards.dart` decides; the library page's existing cards hunk reads it.

The owner reported the grouping pill showing in the middle of the screen during search. The cause has not been found from reading the code (`resizeToAvoidBottomInset` is false on both the shell and the timeline scaffold). A screenshot is owed:

- If it is the Photos search, this change fixes it, because the dock lays the row out against the bottom edge itself.
- If it is a detail page, it is a separate fix in `TimelineGroupingBottomPill`.

## Search mode on Photos

- `PhotosSearchFrame` stops adding its own `TimelineGroupingBottomPill`.
- `GalleryBottomNav` no longer hides when `searchModeProvider` is on. It switches the dock to its search state instead.
- `PhotosSearchFrame` stops adding the pill's height to the bottom padding: the dock stays in search mode and the scaffold already reserves its height (`extendBody`).
- The chip sheets (People, Places, Dates, Filters) open over the dock as they open over the pill today.

## Layering

Everything new is in `mobile/lib/gallery/dock/`:

| File | Holds |
| --- | --- |
| `gallery_dock.widget.dart` | The dock: geometry for the three states, the spring (`GallerySpringCurve`, stiffness 240, damping 21), the glass surface, the grouping row wrapping `TimelineGroupingSelector(bare: true)` |
| `gallery_dock_fold.dart` | The fold state provider, and the scroll-direction listener the shell wraps around its child |

`TimelineGroupingSelector` reads only `timelineOverviewModeProvider`. Photos uses `sharedGrouping: true`, so that provider is not overridden there, and the shell's dock drives the Photos grouping directly.

Fork files that change:

- `gallery_bottom_nav.widget.dart` renders the dock instead of the pill and blob.
- `gallery_tab_shell.page.dart` wraps `child` in the scroll listener.
- `search_frame.widget.dart` changes as described under Search mode.

`gallery_nav_pill`, `gallery_search_blob`, `gallery_nav_segment` and `animated_nav_icon` are deleted with their tests; nothing else used them.

Upstream files: one comment inside the existing fork hunk of `main_timeline.page.dart` renames the search button it points at. Its diff against `refs/upstream/v3.4.1` does not grow, and no other upstream file is touched.

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

Existing tests that referenced the old widgets or keys are updated: `gallery_bottom_nav_test`, `photos_search_mode_test`, `spaces_page_test`. The detail-page and pill tests (`timeline_grouping_bottom_pill_test`, `timeline_with_grouping_pill_test`, `scoped_search_test`, `map_bottom_sheet_timeline_test`, the page tests) must pass unchanged.

On device, iOS and Android:

- Folding feels right on a long Photos timeline.
- The grouping row sits at the bottom in Photos search, with the keyboard open and closed.
- Detail pages look as they do today.
