# Mobile nav dock: one bottom dock that folds on scroll

Prototype: `specs/mockups/mobile-nav-dock.html` (interactive; open in a browser, "Jump to" covers every case below).

## Why

The mobile app has two separate pieces of bottom chrome that never agree:

- On the tab shell, `GalleryBottomNav` shows a content-sized tab pill plus a round search blob. Photos' grouping (Years / Months / All) lives in an app-bar menu (`PhotosViewMenuButton`), not at the bottom.
- On every timeline page pushed over the shell (space, album, person, favorites, ...), there is no tab bar. `TimelineGroupingBottomPill` shows the grouping selector with a search button.
- In Photos search mode the nav hides and the grouping pill appears instead.

So the bottom of the screen looks different on Photos, on a space, on an album, and in search. Nothing moves out of the way while you browse a long timeline.

The owner wants one dock, modelled on the iOS 26 tab bar with its accessory row (Apple Music's now-playing bar). It should look and behave the same on every screen that shows photos.

## Decisions (owner, 2026-11-17)

1. **Two rows, folding to one.** On a timeline the dock has the grouping row **above** the tab bar. Scrolling down folds both into one row; scrolling up unfolds it. The motion is a spring with a small overshoot (the prototype's "springy").
2. **The search field and filter chips stay at the top.** The search header from `specs/2026-10-23-mobile-search-redesign-design.md` is unchanged. In search mode the dock shows the folded tab circle and the grouping row, pinned to the bottom of the screen.
3. **The tab bar shows on detail pages too.** A space, album or person page has the same dock as Photos, with the tab it was opened from still highlighted.
4. **Keep fork code separate.** New code lives in `mobile/lib/gallery/dock/`. Upstream files get no new hunks; existing fork hunks may only be replaced in place or removed.

## The dock

### States

| State | Row 1 (top) | Row 2 (bottom) |
| --- | --- | --- |
| **Unfolded** (default, at the top, after scrolling up) | Grouping row: `Years · Months · All` segmented control plus a display-options button. Only on screens with a timeline. | Tab bar: the three nav slots (`galleryNavSlotsProvider`) and Search, in one glass pill with a sliding selection highlight. |
| **Folded** (after scrolling down) | none | A circle holding the active tab's icon on the left, the grouping control in the middle (display-options button hidden), and a search circle on the right. Without a timeline the middle stays empty. |
| **Search** (search mode open) | none | Tab circle on the left and the grouping row filling the rest. The field and chips stay in the top header. |

What morphs into what, with all geometry on one spring:

- The tab pill shrinks into the left circle. Inactive tabs scale down and fade, labels fade and blur, and the active icon slides to the circle's centre.
- The search slot detaches from the tab pill and becomes its own glass circle on the right.
- The grouping row drops into the gap between the two circles and narrows. Its display-options button collapses to zero width.

### Interactions

- **Fold and unfold.** The dock listens for vertical `UserScrollNotification`s from the screen's main scrollable:
  - `ScrollDirection.reverse` (content moving up) after about 24 px of travel folds it.
  - `forward`, or reaching the top (offset under 30 px), unfolds it.
  - Rubber-banding at the end of the scroll is ignored.
  - Horizontal scrollables (the memory lane, the albums row on a space) are ignored.
- **Tap the circle while folded:** unfold.
- **Tap a tab while unfolded:**
  - The same tab with nothing pushed scrolls to the top (today's `ScrollToTopEvent`).
  - The same tab from a detail page pops back to the shell.
  - Another tab pops back to the shell and switches tab (see Detail pages).
- **Tap search:** on the shell it calls `openGallerySearch`, as today. On a detail page it enters that page's scoped search, as the pill's search button does today.
- **In search, tap the circle:** leave search mode, the same as the header's ←.
- **Display options:** on Photos the button opens the existing library-view menu (`_PhotosViewMenu`: Everything / Personal / Spaces). On other timelines it is hidden, because those pages have no library view. The grouping control stays.

### Unchanged behaviour carried over

- Hidden while multi-select is on, and while the keyboard is up (`viewInsets.bottom > 80`). The same 200 ms slide and fade as today.
- In read-only mode the collection and library slots are disabled.
- Landscape keeps the `NavigationRail`; the dock is portrait only.
- Labels that don't fit shrink the tabs rather than pushing search off-screen (#909). Search keeps its full slot.
- RTL mirrors the geometry: the tab circle sits on the right.
- Reduced motion (`GalleryMotion.reduced`): no spring and no overshoot, a 150 ms ease.

### Sizes

The tab bar is 64 high, the grouping row 52, with a 10 gap between rows. Each folded circle is 56. The dock sits 14 from the sides and floats `max(26, safe-area bottom)` from the bottom.

The reserved bottom height (`bottomNavHeightProvider`, and the timeline's bottom clearance that `timeline.widget.dart` reads from `TimelineGroupingBottomPill.pillHeight + bottomFloat`) is the unfolded height. Folding never moves content. The last row of photos clears the dock at rest, and folding only reveals more photos behind the glass.

## Detail pages: how the tab bar gets there without touching the router

The literal iOS model gives each tab its own nested navigator. That would move every detail route under the tab routes in upstream's `router.dart`, and change every page that opens a detail page. Decision 4 rules that out.

Instead, each screen that shows a dock renders its own instance of the same `GalleryDock`, and a `Hero` keeps the dock still across page changes:

- **The tab shell** renders the dock in `GalleryBottomNav` (fork file), replacing today's pill and blob. The Photos grouping row there reads `timelineOverviewModeProvider` directly, because Photos uses `sharedGrouping: true` and the provider is not overridden. `TimelineGroupingSelector` reads nothing else.
- **A timeline page pushed over the shell** renders the dock through the existing fork hunk in `timeline.widget.dart`:
  - Today that line is `Stack(children: [sliverTimeline, const TimelineGroupingBottomPill()])`.
  - It becomes `GalleryTimelineDock(child: sliverTimeline)`, the same single line.
  - The dock is built inside the page's `TimelineRouteScope`, so its grouping row drives that page's own grouping. Because it wraps the timeline, it can hear the scroll notifications.
- **Both instances use the same `Hero` tag.** On a push or pop, including the iOS edge swipe (`transitionOnUserGestures: true`), the dock stays in place while the page slides. Its shuttle animates the grouping row in or out when only one side has a timeline, for example the Spaces list opening a space.
- **Which tab is highlighted.** The shell publishes its `TabsRouter` and active slot through a fork provider (`galleryTabsRouterProvider`). A detail dock highlights that slot, so a space opened from Spaces shows Spaces and an album opened from Library shows Library.
- **Tab taps on a detail page** pop to `GalleryTabShellRoute` (`router.popUntilRouteWithName`), then call `setActiveIndex` on the published router.

**What this gives up compared with real nested stacks:** a tab does not remember its pushed pages. If you open a space, switch to Photos, then tap Spaces, you get the Spaces list rather than the space. This matches the app today, where switching tabs already means leaving the pushed page. Per-tab history would need the router change that decision 4 rules out.

**Excluded screens:**

- The map's bottom-sheet timeline also passes `withGroupingPill`. `GalleryTimelineDock` keeps the plain grouping pill there: no tabs, no fold. It detects this by `context.routeData.name == MapRoute.name`, so no new parameter is added to the upstream call.
- Non-timeline pages pushed over the shell (the albums list opened from Library, People, Places, space members, settings) get no dock in this change. Each would need a one-line hook in an upstream page. Left for a follow-up, listed under Follow-ups.
- The asset viewer, editors, slideshow and memories are full-screen routes pushed over everything, so they cover the dock as they cover the nav today.

## Search mode

- **Photos.** `PhotosSearchFrame` stops adding its own `TimelineGroupingBottomPill`; the shell's dock switches to its search state instead. `GalleryBottomNav` no longer hides when `searchModeProvider` is on.
- **Detail pages.** The page's `GalleryTimelineDock` reads `searchModeProvider` and switches to the search state the same way.
- **Where the grouping row sits.** In both cases it is laid out against the bottom edge by the dock, never by the page's `Stack` alignment. The owner reported seeing it mid-screen during search, and the cause has not been found yet. The fix belongs here and is verified on a device (see Testing). A screenshot of the bad state is owed.
- The chip sheets (People, Places, Dates, Filters) open over the dock as they open over the pill today.

## Layering

Everything new is in `mobile/lib/gallery/dock/`:

| File | Holds |
| --- | --- |
| `gallery_dock.widget.dart` | The dock: geometry for the three states, spring, glass surface |
| `gallery_dock_state.dart` | Fold state notifier, and the scroll-direction listener |
| `gallery_dock_tabs.dart` | The tab pill content, folded circle, search slot |
| `gallery_dock_accessory.dart` | The grouping row, wrapping `TimelineGroupingSelector(bare: true)` |
| `gallery_timeline_dock.widget.dart` | The per-page host used by the `timeline.widget.dart` hunk |
| `gallery_tabs_router.provider.dart` | The shell's published `TabsRouter` and active slot |

Fork files that change: `gallery_bottom_nav.widget.dart`, `gallery_tab_shell.page.dart` (publish the router, wrap `child` in the scroll listener), `search_frame.widget.dart`, `timeline_grouping_bottom_pill.widget.dart` (kept for the map; its constants become the dock's reserved height). `gallery_nav_pill.widget.dart` and `gallery_search_blob.widget.dart` are deleted once nothing uses them.

Upstream files:

- `timeline.widget.dart`: the existing one-line fork hunk is replaced in place. The diff against `refs/upstream/v3.4.1` stays the same size.
- `main_timeline.page.dart`: the `PhotosViewMenuButton` app-bar hunk is removed, because its contents move into the dock. That diff shrinks.
- No other upstream file is touched. `router.dart`, `main.dart` and the timeline pages stay as they are.

No new i18n keys: the tab labels, `display_options`, and the grouping labels (`timeline_grouping_*`) already exist.

## Compatibility

Client-only. No endpoint, DTO or sync change, so every pairing in CLAUDE.md rule 6 sees the same API as before. Old app on a new server and new app on an old server are both unaffected. A stock Immich app is unaffected.

## Testing

Widget tests in `mobile/test/gallery/dock/`:

- **State matrix.** For each state (unfolded, folded, search) × timeline or not × LTR/RTL: the pill rectangles match the table above, and the tab circle shows the active slot's icon.
- **Scroll.** A `UserScrollNotification` reverse past the threshold folds the dock. Forward unfolds it. Horizontal notifications are ignored. Offset under 30 px always unfolds.
- **Taps.** Folded circle → unfolds. Same tab on the shell → `ScrollToTopEvent`. Tab from a detail page → pops to the shell and sets the index. Search on the shell → `openGallerySearch`. Search on a detail page → scoped search mode. Circle in search → leaves search.
- **Carried over** from `gallery_bottom_nav_test.dart` and `timeline_grouping_bottom_pill_test.dart`: multi-select hide, keyboard hide, read-only disabled slots, #909 narrow-screen labels, landscape rail, reduced motion.
- **Map.** The map bottom sheet still shows the plain pill (`map_bottom_sheet_timeline_test.dart` unchanged).

Existing tests that reference the old widgets or keys get updated: `gallery_tab_shell_test`, `gallery_bottom_nav_test`, `timeline_grouping_bottom_pill_test`, `timeline_with_grouping_pill_test`, `photos_view_menu_test`, `photos_search_mode_test`, `scoped_search_test` and its harness, `main_timeline_page_test`, `spaces_page_test`, `drift_remote_album_page_test`, `drift_favorite_page_test`, `timeline_route_adoption_test`.

On device, iOS and Android:

- The Hero holds the dock still on push, pop and the edge swipe.
- The grouping row sits at the bottom in search on Photos and on a space, with the keyboard open and closed.
- Folding feels right on a long timeline.

## Follow-ups (not in this change)

- A dock on non-timeline pushed pages (albums list, People, Places, space members), one upstream line each.
- Per-tab navigation history, if it is ever worth the router change.
