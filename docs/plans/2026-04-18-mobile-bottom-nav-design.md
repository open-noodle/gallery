# Mobile Bottom-Nav Redesign — Design

**Status:** Draft · 2026-04-18 (rev 2 — review fixes folded in)
**Mockup:** [`docs/plans/mockups/2026-04-18-mobile-bottom-nav.html`](./mockups/2026-04-18-mobile-bottom-nav.html)
**Scope:** Flutter mobile app (`mobile/`). Replaces the bottom navigation for Gallery without touching the upstream `tab_shell.page.dart` or `tab.provider.dart`.

## 1. Summary

Replace the current four-tab `NavigationBar` (Photos · Search · Spaces · Library) with a floating pill inspired by Google Photos: three destinations (Photos · Albums · Library) inside a rounded-full translucent pill, plus a sibling circular **Search** blob outside the pill on the trailing edge. The current Search tab retires from the nav; Spaces retires from the nav (existing routes remain reachable). Tapping the Search blob routes to the Photos timeline (if the user is elsewhere), waits for the tab transition to settle, opens the FilterSheet shipped in PR 1.3, and requests focus on its text-search input.

The new shell ships as a **parallel fork-only widget set** — upstream's `mobile/lib/pages/common/tab_shell.page.dart` and `mobile/lib/providers/tab.provider.dart` both stay untouched so upstream rebases remain mechanical.

## 2. Goals

- Match the Google-Photos floating-pill pattern with a Gallery-distinct aesthetic (darkroom warmth, amber accent) theming off `theme.colorScheme.primary`.
- Re-link Immich's existing Albums page to the bottom nav (it was de-linked in PR #116, not deleted).
- Retire the dedicated Search tab; route search intent through the FilterSheet that already covers the web parity surface.
- Preserve fork maintainability by keeping upstream `tab_shell.page.dart` and `tab.provider.dart` bit-identical to their upstream copies.
- Preserve every existing side-effect the current nav already carries: invalidation of memory/album/people providers on tab switch, multi-select hide, haptic feedback, readonly-mode gating, landscape `NavigationRail` fallback.

## 3. Non-goals

- Surfacing **Spaces** inside Library (follow-up; needs its own design — Spaces currently tab-level, will need card + quick-access placement inside `DriftLibraryPage`).
- Renaming, redesigning, or reshaping the existing Albums page, Library page, or FilterSheet.
- Deep-link redirects for removed tabs (fork-only routes with no external links).
- Mid-session backstack migration shims (auto_route's default-route fallback handles stale routes already, per PR 1.4 in the filter-sheet plan).
- User-configurable nav variants (no toggle between old + new).
- Landscape pill variant — landscape keeps the existing `NavigationRail` exactly as it is today.

## 4. Design decisions (locked)

Captured during brainstorm 2026-04-18 and tightened after review rev 2:

1. **Three visible destinations + one outside affordance.** Photos · Albums · Library in the pill; Search as a peer blob outside. No fourth tab.
2. **Albums is the existing Immich albums page** — it was de-linked from the bottom nav in PR #116 but not deleted. Target route: `DriftAlbumsRoute` (Drift-based, matches the tab shell's other routes). Legacy `AlbumsRoute` (Isar) stays in the repo as a fallback if Drift parity isn't reached at ship time.
3. **Spaces leaves the bottom nav.** `SpacesRoute` and its pages remain reachable via the existing app surfaces (notifications, deep links, in-app navigation). Surfacing Spaces inside Library as a collection card + quick-access list item is explicitly a follow-up, not part of this PR.
4. **Search blob target is deterministic.** Tap always routes to `MainTimelineRoute` (if not already there), waits for the upstream 600 ms `FadeTransition` to complete, then opens the FilterSheet at its Browse snap and requests focus on the text-search input.
5. **`DriftSearchPage` stays in the repo.** It is no longer a bottom-nav tab but remains a reachable route for any in-app deep-links that already point at it.
6. **Upstream `tab_shell.page.dart` and `tab.provider.dart` stay bit-identical.** A new `GalleryTabShellPage` lives at a fork-only path and the router's root is flipped to point at it. The new shell writes a **fork-only** `galleryTabProvider` (distinct from upstream's `tabProvider`) — the two providers coexist, and the fork's code reads `galleryTabProvider` where it needs to branch on active tab.
7. **Aesthetic: Darkroom Warmth.** Amber demo palette in the mockup; the Flutter widget resolves its accent from `theme.colorScheme.primary`, so the user's `ImmichColorPreset` continues to drive the color in production.
8. **Nav label casing follows upstream convention** (sentence case: "Photos", "Albums", "Library") — i18n keys `nav.photos`, `nav.albums`, `nav.library`; search blob semantics key `nav.search_photos_hint` ("Search photos").
9. **Focus plumbing for the FilterSheet search input.** The sheet's current `FilterSheetSearchBar` has no `FocusNode`. A fork-only `FocusNode` is added to its State, and an external request-focus signal travels via a **counter provider** (`photosFilterSearchFocusRequestProvider: StateProvider<int>`) — callers increment, the search bar listens and calls `requestFocus()`. A counter (not a shared `FocusNode`) avoids use-after-dispose crashes when the search bar widget is remounted.

## 5. UX

See the [HTML mockup](./mockups/2026-04-18-mobile-bottom-nav.html) for interactive visual reference. Summary below.

### 5.1 Structure

- A rounded-full **pill** floats 26 pt above the home indicator, with 14 pt horizontal margin from each screen edge and a 10 pt gap to the **search blob** on the trailing side.
- The pill hosts three **segments**. Inactive segments render the label only. The active segment renders the filled-icon + label inside an inner rounded-full fill in the accent color @ 16 % opacity.
- The **search blob** is a 54 × 54 pt circle with the same surface treatment as the pill (translucent ink fill, backdrop blur, hairline border, soft shadow). Its icon is `search` from Material Symbols Rounded at 24 pt.

### 5.2 Interaction

- **Tap a segment** → `tabsRouter.setActiveIndex(i)`. The active-pill underlay animates between segments over 280 ms (`cubic-bezier(0.3, 0.6, 0.2, 1)`), the icon fades in over 220 ms with a 60 ms delay, and a `selectionClick` haptic fires.
- **Tap the search blob** → if current tab ≠ Photos, switch to Photos first, wait for the 600 ms `FadeTransition` to complete (plus a ~20 ms buffer for the target page's first build pass), then set the FilterSheet snap to `browse` and increment the focus-request counter. On Photos already, skip the wait. Haptic `selectionClick` fires on tap.
- **Drag / swipe** inside the pill has no effect — only taps change tabs. (Avoids gesture collisions with the drag-to-dismiss FilterSheet peek when present.)
- **System back** from a non-Photos tab returns to Photos (inherits upstream's `canPop` contract).

### 5.3 State visibility

The nav is not always on-screen. It hides when:

- **Multi-select is active.** Listens to `MultiSelectToggleEvent` on `EventStream.shared`. `EventStream` broadcasts globally — the event lands regardless of which tab (Photos, Albums, or Library) invoked multi-select. Identical contract to the upstream `_BottomNavigationBar`. A fade + 12 pt slide is used.
- **Keyboard is up.** When `MediaQuery.of(context).viewInsets.bottom > 80` (absolute, device-independent), the nav fades + slides out. Returns on keyboard dismiss. This is a new behaviour not in the upstream nav (upstream uses `resizeToAvoidBottomInset: false` and lets the nav get covered). The absolute 80 pt threshold keeps the test stimulus and production threshold aligned.
- **Landscape.** The whole bottom-nav structure disappears and a `NavigationRail` takes its place on the leading edge with the same three destinations plus the search entry as a rail item. Identical to the upstream landscape path — the rail stays on upstream visuals, no amber styling.
- **Readonly mode** (`readonlyModeProvider == true`). Only Photos is enabled; Albums, Library, and Search dim to 30 % opacity and refuse taps. Identical contract to the upstream `.enabled` handling.

Active-tab changes are announced to screen readers. The implementation wraps the **active segment** with `Semantics(liveRegion: true, label: <destination label>)` so every time activity moves the segment tree position, TalkBack/VoiceOver receives a label change on a live region and announces it (e.g. "Albums, selected" → "Library, selected"). No debounce — taps produce discrete state changes (§5.2 disables drag) so there is no chatter source.

### 5.4 Labels and icons

| Destination | Label                                                 | Icon (Material Symbols Rounded)     | Route                     |
| ----------- | ----------------------------------------------------- | ----------------------------------- | ------------------------- |
| Photos      | `Photos` (`nav.photos`)                               | `photo_library` (outlined / filled) | `MainTimelineRoute`       |
| Albums      | `Albums` (`nav.albums`)                               | `photo_album` (outlined / filled)   | `DriftAlbumsRoute`        |
| Library     | `Library` (`nav.library`)                             | `space_dashboard`                   | `DriftLibraryRoute`       |
| Search blob | Semantics: `Search photos` (`nav.search_photos_hint`) | `search`                            | (action — see §6.4 below) |

Icons use `font-variation-settings: "wght" 400, "FILL" 0` when inactive and `"wght" 500, "FILL" 1` when active. Sentence-case labels.

### 5.5 Aesthetic tokens

The mockup's amber palette is illustrative. The Flutter widget reads:

- **Pill surface:** `theme.colorScheme.surfaceContainerHighest.withOpacity(0.68)` + `BackdropFilter(blur: 28)`.
- **Inner-warmth highlight.** A subtle top-down linear gradient layered inside the pill (`LinearGradient(begin: topCenter, end: center, colors: [onSurface @ 0.04, transparent])`) sells the "glass" read — mirrors the `.pill::before` highlight in the mockup that would otherwise be lost in the Flutter port. Implemented as a `Positioned.fill` child on the pill's internal `Stack`, behind the segments and above the backdrop blur.
- **Pill border:** 1 pt `theme.colorScheme.outlineVariant.withOpacity(0.55)`.
- **Pill shadow:** elevation-6-equivalent (`0 20 44 -14 shadow @ 0.7` + `0 4 8 shadow @ 0.4`).
- **Idle label / icon:** `theme.colorScheme.onSurface.withOpacity(0.55)`.
- **Active fill:** `theme.colorScheme.primary.withOpacity(0.16)`.
- **Active label / icon:** `theme.colorScheme.primary`.
- **Search blob:** same surface treatment as pill; idle icon `onSurface @ 0.85`, **pressed** icon `primary @ 1.0` (mobile has no hover state; pressed via `Listener.onPointerDown`/`onPointerUp` toggling an `AnimatedDefaultTextStyle`-equivalent for the icon color).

In light themes the same roles resolve to lighter surface + higher-contrast fill (`primary.withOpacity(0.22)`).

### 5.6 Peek-rail coexistence

When the FilterSheet is at the `peek` snap (filters applied on Photos), its chip rail sits at the bottom of the screen — in direct conflict with the pill's placement. The design resolves this by **stacking** rather than hiding either surface:

- The pill keeps its fixed float offset (26 pt above the home indicator).
- The peek rail's bottom is re-anchored to **above the pill**: `peek_content.widget.dart` reads a new `bottomNavHeightProvider` (fork-only) and adds that height + an 8 pt visual gap to its own bottom padding. The pill publishes its measured height to the provider via a `LayoutBuilder` post-frame callback.
- **Equality-guarded write.** The publish call gates on `if (ref.read(bottomNavHeightProvider) != measured) ref.read(bottomNavHeightProvider.notifier).state = measured`. Riverpod's `StateProvider` notifies listeners on every `state = …` set regardless of value equality; without this guard, `PeekContent` would rebuild on every `LayoutBuilder` pass.
- **Hide/show animation sync.** When the nav hides (multi-select, keyboard-up), the height publishes as 0 at the **end** of the fade/slide animation, not at frame 1 — so the peek rail doesn't jump down before the pill has visually disappeared. `AnimatedSlide`/`AnimatedOpacity` expose a `onEnd` callback that triggers the `state = 0` write. On show, the write fires in the first frame after mount (post-frame callback) so the peek rail lifts as the pill appears.
- On tabs where the pill never renders (landscape), `bottomNavHeightProvider` reads 0 and the peek rail falls back to its original placement. The landscape shell writes 0 directly in its own layout pass.
- No-filters state: peek is hidden (`SearchFilter.isEmpty` collapses it per PR 1.2); pill floats alone. Unchanged from the mockup.

## 6. Architecture

### 6.1 File layout

**New (fork-only):**

- `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart` — `@RoutePage()` parallel to `TabShellPage`, hosts the new bottom nav. Registers a `tabsRouter.addListener` that mirrors `tabsRouter.activeIndex` into `galleryTabProvider` on every active-index change — this keeps the provider in sync regardless of whether the change came from a segment tap, `openGallerySearch`, `PopScope` back-navigation, or any other caller of `setActiveIndex`. Disposes the listener in `dispose`.
- `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart` — the composite widget: pill + blob + landscape rail fallback. Takes `TabsRouter` as a constructor argument (sourced from `AutoTabsRouter`'s `builder` callback — the upstream form that `tab_shell.page.dart` already uses; avoids `AutoTabsRouter.of(context)` lookups from outside the router subtree — see §6.4.1).
- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart` — the rounded-full pill with the 3 segments + animated active underlay.
- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart` — a single segment (active / idle rendering).
- `mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart` — the circular search affordance. Also takes `TabsRouter` as a constructor argument.
- `mobile/lib/providers/gallery_nav/gallery_tab_enum.dart` — fork-only `enum GalleryTabEnum { photos, albums, library }` and `galleryTabProvider: StateProvider<GalleryTabEnum>((_) => GalleryTabEnum.photos)`. Distinct from upstream's `TabEnum` / `tabProvider` — no shared state.
- `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart` — mapping helpers: label i18n key, icon, selected icon, target route per `GalleryTabEnum` value.
- `mobile/lib/providers/gallery_nav/gallery_search_action.dart` — `Future<void> openGallerySearch(TabsRouter, WidgetRef)` helper that encodes the "switch to Photos if needed, wait for transition, open sheet, bump focus counter" sequence.
- `mobile/lib/providers/gallery_nav/bottom_nav_height.provider.dart` — `bottomNavHeightProvider: StateProvider<double>((_) => 0)` consumed by the FilterSheet peek rail to stack above the pill (§5.6).
- `mobile/lib/providers/photos_filter/search_focus.provider.dart` — `photosFilterSearchFocusRequestProvider: StateProvider<int>((_) => 0)`. External callers increment; `FilterSheetSearchBar` uses **`ref.watch` + a `_lastProcessedFocusRequest` field in its State** and compares in `build` — if `counter > _lastProcessedFocusRequest`, call `focusNode.requestFocus()` and update `_lastProcessedFocusRequest` in a post-frame callback (avoids calling `setState` during build). This survives remounts correctly: a widget that mounts AFTER the increment sees `counter > 0 > _lastProcessedFocusRequest` on its first build and requests focus. `ref.listen` is intentionally NOT used — it does not fire on registration, so a just-mounted widget would miss an already-sent increment.
- `mobile/test/presentation/widgets/gallery_nav/*_test.dart` + `mobile/test/providers/gallery_nav/*_test.dart` — mirror tests per widget / provider.

**Touched (fork-only lines within upstream-aligned files):**

- `mobile/lib/routing/router.dart` — add `AutoRoute(page: GalleryTabShellRoute.page, children: [MainTimelineRoute, DriftAlbumsRoute, DriftLibraryRoute])` to the route list and flip the root's initial route. Approximately 8 lines of fork-only addition, enclosed in a `// >>> fork-only gallery-bottom-nav` / `// <<< fork-only` comment fence to flag the diff on rebases. Verify that inheriting the `[_authGuard, _duplicateGuard]` guards from the top-level `DriftAlbumsRoute` still applies when it's used as a tab child; re-declare on the child if auto_route doesn't propagate.
- `mobile/lib/presentation/widgets/filter_sheet/search_bar.widget.dart` — add a `FocusNode` owned by `_FilterSheetSearchBarState` (init in `initState`, dispose in `dispose`); add an `int _lastProcessedFocusRequest = 0` State field; in `build` do `final req = ref.watch(photosFilterSearchFocusRequestProvider); if (req > _lastProcessedFocusRequest) { WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) { _focusNode.requestFocus(); setState(() => _lastProcessedFocusRequest = req); } }); }`. Pass the node to the underlying `TextField(focusNode: _focusNode, …)`. ~12 lines of fork-only addition; if upstream rewrites the search bar the fork re-applies mechanically.
- `mobile/lib/presentation/widgets/filter_sheet/peek_content.widget.dart` — read `bottomNavHeightProvider` and pad its bottom by (height + 8 pt) when the pill is active (§5.6). ~5 lines.
- `i18n/en.json` — add `nav.photos`, `nav.albums`, `nav.library`, `nav.search_photos_hint`. Keys sorted via `pnpm --filter=immich-i18n format:fix` (memory `feedback_i18n_key_sorting.md`).

**Untouched (critical — upstream rebase surface):**

- `mobile/lib/pages/common/tab_shell.page.dart` — upstream copy stays bit-identical.
- `mobile/lib/providers/tab.provider.dart` — upstream `TabEnum` and `tabProvider` remain unchanged (the new shell writes `galleryTabProvider` instead).
- `mobile/lib/constants/constants.dart` — existing `kPhotoTabIndex` / `kSearchTabIndex` / `kSpacesTabIndex` / `kLibraryTabIndex` constants remain (they're referenced by upstream + fork code paths). The new shell uses its own index scheme.

### 6.2 Widget hierarchy

```
GalleryTabShellPage (fork-only, @RoutePage)
├── AutoTabsRouter (default constructor, builder param — same form as upstream tab_shell.page.dart:82)
│   ├── routes: [MainTimelineRoute, DriftAlbumsRoute, DriftLibraryRoute]
│   └── transitionBuilder: FadeTransition (same as upstream — 600ms)
└── Scaffold
    ├── body: AutoTabsRouter child
    │   (landscape: Row(rail, body); portrait: body only)
    └── bottomNavigationBar: GalleryBottomNav(tabsRouter: <from builder callback>)
        ├── (portrait, multi-select off, keyboard down, !readonly)
        │   ├── GalleryNavPill(tabsRouter, destinations)
        │   │   ├── AnimatedPositioned (amber underlay)
        │   │   ├── GalleryNavSegment(photos)
        │   │   ├── GalleryNavSegment(albums)
        │   │   └── GalleryNavSegment(library)
        │   └── GallerySearchBlob(tabsRouter)
        │       → onTap → openGallerySearch(tabsRouter, ref)
        ├── (portrait, multi-select on) → SizedBox.shrink()
        ├── (portrait, keyboard up)     → AnimatedSlide/AnimatedOpacity hidden
        ├── (landscape)                 → NavigationRail (upstream-style)
        └── (readonly) → segments rendered with .enabled = false except photos
```

`GalleryBottomNav` publishes its measured portrait height to `bottomNavHeightProvider` in a `LayoutBuilder` post-frame callback, gated on inequality (§5.6). Publishes 0 at the end of the hide animation (`AnimatedSlide.onEnd`), and the measured height on the first frame after the show animation completes. The FilterSheet's peek content reads it and re-pads (§5.6).

### 6.3 Active-pill animation

A single `AnimatedPositioned` underlay slides behind the active segment; the active segment's icon uses `AnimatedSize` + `AnimatedOpacity` to fade + slide in from the left edge of the segment.

**Segments use organic widths, not `Expanded`.** The mockup's active pill hugs icon + label while idle segments hug label only — giving the pill an elastic, variable-width character. `Expanded` would flatten every segment to 1/3 uniform width and destroy that read. Instead, each `GalleryNavSegment` sizes to its intrinsic content via a `Row` of natural-width `Padding` children; the parent pill wraps them in a constrained `Row` that distributes any spare pill-width as a leading/trailing `Flexible(child: SizedBox.shrink())` so the segment trio is centred inside the pill.

```dart
Stack(
  children: [
    // Inner-warmth highlight — §5.5
    Positioned.fill(
      child: DecoratedBox(
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(28),
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.center,
            colors: [
              theme.colorScheme.onSurface.withOpacity(0.04),
              Colors.transparent,
            ],
          ),
        ),
      ),
    ),
    // Amber underlay — slides between segments
    AnimatedPositioned(
      duration: const Duration(milliseconds: 280),
      curve: const Cubic(0.3, 0.6, 0.2, 1), // matches mockup's emphasised decelerate — not Curves.easeOutCubic
      left: _leftFor(activeIndex),
      width: _widthFor(activeIndex),
      top: 6,
      height: 46,
      child: _ActiveUnderlay(color: theme.colorScheme.primary.withOpacity(0.16)),
    ),
    // Segments — organic widths, not Expanded
    Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        for (final destination in GalleryTabEnum.values)
          GalleryNavSegment(destination: destination, active: activeIndex == destination.index),
      ],
    ),
  ],
);
```

Segment widths are computed per layout and stored in a `_widthForIndex: Map<int, double>` primed by a post-frame measurement pass: idle segment = label width + 28 pt horizontal padding; active segment = label width + icon (22 pt) + 6 pt gap + 32 pt horizontal padding. A `GlobalKey` per segment exposes its rendered size to the measurement pass; the map rebuilds on font-scale change (`MediaQueryData.textScaleFactor` listener) and on locale change (label widths differ in non-English). The first frame is rendered with the map seeded to the default-active (Photos) geometry so the underlay lands correctly under Photos on mount — tested (§8.2 M1).

The distinction between stock `Curves.easeOutCubic` `(0.215, 0.61, 0.355, 1)` and the chosen custom `Cubic(0.3, 0.6, 0.2, 1)` is intentional — the custom curve has a sharper start and a lingering decelerate, which matches the mockup's "snap-and-settle" feel rather than Flutter's default "soft-and-even" read. This is the motion-signature detail of the nav.

`MediaQuery.of(context).disableAnimations` short-circuits the animation — the underlay jumps in one frame, the icon appears without the fade.

### 6.4 Search action — `openGallerySearch`

```dart
Future<void> openGallerySearch(TabsRouter tabsRouter, WidgetRef ref) async {
  ref.read(hapticFeedbackProvider.notifier).selectionClick();
  final onPhotos = tabsRouter.activeIndex == GalleryTabEnum.photos.index;

  if (!onPhotos) {
    tabsRouter.setActiveIndex(GalleryTabEnum.photos.index);
    // Upstream AutoTabsRouter uses a 600 ms FadeTransition (tab_shell.page.dart:83).
    // Wait for the transition plus ~20 ms buffer so MainTimelinePage has completed
    // its first-build pass — required because FilterSheetSearchBar must be mounted
    // before its FocusNode can accept a focus request.
    await Future<void>.delayed(const Duration(milliseconds: 620));
  }

  ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
  ref.read(photosFilterSearchFocusRequestProvider.notifier).state++;
}
```

- Caller must pass `tabsRouter` explicitly — `AutoTabsRouter.of(context)` does not work from inside `Scaffold.bottomNavigationBar` because that subtree sits OUTSIDE the router's descendants. `AutoTabsRouter`'s `builder` callback (the same form upstream already uses at `tab_shell.page.dart:82`) exposes the router; `GalleryBottomNav` captures it there and forwards to `GallerySearchBlob`.
- The 620 ms delay is coupled to upstream's 600 ms `FadeTransition`. If upstream shortens or lengthens that duration during a rebase, update the constant in a single place (`gallery_search_action.dart`). Document in a `// coupled to AutoTabsRouter transition — see tab_shell.page.dart` comment for the rebase heads-up.
- `photosFilterSheetProvider` setting is idempotent — re-setting to `browse` when already at `browse` is a no-op in Riverpod `StateProvider` for equal values only. Here it's a meaningful state transition on every call-from-hidden, and a no-op when already browse.
- `photosFilterSearchFocusRequestProvider` is a `StateProvider<int>` counter — callers do `state++`. `FilterSheetSearchBar` reads with `ref.watch` (NOT `ref.listen`) and tracks `_lastProcessedFocusRequest` in its State: in `build`, if `counter > _lastProcessedFocusRequest` it schedules a post-frame `requestFocus()` and advances the marker. Using `ref.listen` would silently drop requests when the search bar widget mounts AFTER the increment (common when `openGallerySearch` is invoked from Albums/Library — the sheet state triggers the mount, but `ref.listen` doesn't fire on registration). Counter + `ref.watch` + `_lastProcessedFocusRequest` survives this race.
- `galleryTabProvider` is NOT written directly by `openGallerySearch`. The `GalleryTabShellPage`-level `tabsRouter.addListener` (§6.1) mirrors `activeIndex` → `galleryTabProvider`, so the `setActiveIndex(photos)` call here flows through that listener. This keeps `galleryTabProvider` in sync with the router regardless of who invokes the change.

#### 6.4.1 Passing `TabsRouter` through `AutoTabsRouter`'s builder callback

The new shell uses the same `AutoTabsRouter(...)` default constructor as upstream (`tab_shell.page.dart:82`), passing a `builder:` callback so the `TabsRouter` instance is accessible from the `bottomNavigationBar` subtree (which is NOT a descendant of the router and therefore can't use `AutoTabsRouter.of(context)`):

```dart
AutoTabsRouter(
  routes: const [MainTimelineRoute(), DriftAlbumsRoute(), DriftLibraryRoute()],
  duration: const Duration(milliseconds: 600),
  transitionBuilder: (context, child, animation) =>
      FadeTransition(opacity: animation, child: child),
  builder: (context, child) {
    final tabsRouter = AutoTabsRouter.of(context);
    return PopScope(
      canPop: tabsRouter.activeIndex == 0,
      onPopInvokedWithResult: (didPop, _) =>
          didPop ? null : tabsRouter.setActiveIndex(0),
      child: Scaffold(
        body: child,
        bottomNavigationBar: GalleryBottomNav(tabsRouter: tabsRouter),
      ),
    );
  },
);
```

This matches the upstream shell's pattern line-for-line (only the `routes` list and the `bottomNavigationBar` widget differ), which simplifies rebase review and avoids any reliance on `AutoTabsRouter.builder` named constructors that may or may not be in the installed auto_route version.

### 6.5 State & side effects

The new shell preserves every side effect the upstream nav triggers on tab switch. The switch-callback moves from the upstream `_onNavigationSelected` to a fork-only equivalent keyed on `GalleryTabEnum`:

| Destination | Provider invalidations / actions (on tap)                                                |
| ----------- | ---------------------------------------------------------------------------------------- |
| Photos      | `driftMemoryFutureProvider` invalidate; `ScrollToTopEvent` emitted if already on Photos  |
| Albums      | `albumProvider` invalidate (Drift); view-mode state stays stable                         |
| Library     | `localAlbumProvider`, `driftGetAllPeopleProvider` invalidate                             |
| Search blob | nothing invalidated by the tap itself; the FilterSheet and focus counter own their state |

`galleryTabProvider` (fork-only, §4 decision 6) is synced automatically by the shell's `tabsRouter.addListener` (§6.1) — every `activeIndex` change writes the matching `GalleryTabEnum` value, whether the change came from a segment tap, `openGallerySearch`, or `PopScope`'s back-navigation. `hapticFeedbackProvider.selectionClick()` still fires directly from the segment tap-callback (it's an input acknowledgement, not a state mirror).

**Explicitly NOT fired** by the new shell (verified in negative test assertions — §8.2):

- `tabProvider` (upstream) — untouched; remains at whatever upstream code sets it to elsewhere.
- `sharedSpacesProvider.invalidate` — Spaces-tab entry no longer exists.
- `searchPreFilterProvider.clear()` — Search-tab entry no longer exists.
- `searchInputFocusProvider.requestFocus()` — Search-tab re-tap no longer exists.

### 6.6 Tab index numbering

The new shell uses a fork-only index scheme via `GalleryTabEnum`:

```dart
enum GalleryTabEnum { photos, albums, library }
// photos=0, albums=1, library=2
```

The upstream `TabEnum` (`home`, `search`, `spaces`, `library`) and the upstream constants (`kPhotoTabIndex = 0`, `kSearchTabIndex = 1`, `kSpacesTabIndex = 2`, `kLibraryTabIndex = 3`) are **kept untouched**. They're referenced by upstream code paths that the fork still consumes; renaming or reindexing them would blow rebase scope. The new shell defines its own `kGalleryPhotosIndex = 0`, `kGalleryAlbumsIndex = 1`, `kGalleryLibraryIndex = 2` constants in `gallery_tab_enum.dart`.

## 7. Error handling & edge cases

- **FilterSheet is mid-animation when Search blob is tapped.** `openGallerySearch` always sets the sheet to `browse`. If the sheet was already opening from another source, this is idempotent — setting the state to the same value is a no-op. The focus-counter increment still fires, which is safe: `FilterSheetSearchBar`'s `ref.watch` + `_lastProcessedFocusRequest` pattern catches the increment on the next build regardless of sheet transition progress, even if the widget had not yet mounted at increment time.
- **FilterSheet is open at Deep when Search blob is tapped.** `openGallerySearch` sets the sheet to `browse`; the sheet's own snap controller animates back to Browse. Focus goes to the text pill.
- **User taps Search blob from Albums/Library tab while sheet was previously open on Photos with chips applied.** The chips remain (the sheet's state is preserved across tab switches per PR 1.2 decisions). The sheet opens at Browse with the existing chips visible and the text pill focused.
- **Readonly mode and Search blob.** Search blob is disabled in readonly mode; it dims with the nav and refuses taps. `openGallerySearch` is therefore never invoked in readonly mode — no in-function readonly check needed. Consistent with how the upstream Search tab behaved.
- **Landscape with readonly mode.** Only the Photos rail entry is enabled; Albums / Library / Search disabled with the rail's built-in disabled style.
- **App lifecycle — foregrounding with keyboard was open.** The keyboard-hide detection runs off `MediaQuery.viewInsets.bottom`; when the app foregrounds with no keyboard, the nav re-renders at full opacity.
- **Accessibility-font-scale 200 %.** Segment widths reflow; if the active segment no longer fits, labels truncate with ellipsis and the full label is exposed via `Semantics`. The idle segment's label-only render truncates with ellipsis too; tooltip shows on long-press.
- **User taps Search blob, then rapidly taps a tab before the 620 ms delay completes.** `openGallerySearch` returns a `Future` but the tab-tap handler doesn't await it. The in-flight delay still resolves and writes the sheet state to `browse` + increments the focus counter — even though the user is now on Albums/Library. Result: on return to Photos (later), sheet is at Browse. Acceptable; the mockup doesn't promise otherwise. A future refinement could cancel the pending write via a `Completer` and a "latest-cancel" flag, but YAGNI until a QA signal demands it.
- **Multi-select toggled on while the FilterSheet text input is focused.** `MultiSelectToggleEvent` hides the nav; the sheet stays up (independent of the nav). The keyboard stays up as long as the text input retains focus. When multi-select concludes, the nav returns — no additional state to reconcile.
- **Navigation into / out of `SpacesRoute` from the shell.** `SpacesRoute` is not a tab under `GalleryTabShellRoute` — it is a top-level route reached via deep links, notifications, or in-app buttons. Pushing `SpacesRoute` from inside the shell uses the standard `context.pushRoute(const SpacesRoute())` pattern; the shell stays mounted under it. `Navigator.pop` returns to the shell with `galleryTabProvider` and `AutoTabsRouter.activeIndex` unchanged from when the user left. No special handling required for these transitions in the new shell — the existing fork routes already behave correctly.

## 8. Testing

Patrol-based e2e is out-of-scope (memory `project_play_store_publishing.md`). Coverage is unit + widget tests (`flutter_test` + `ProviderScope` overrides).

### 8.1 Unit tests

**`GalleryTabEnum` / `galleryTabProvider`**

- Default value is `GalleryTabEnum.photos`.
- Setter persists across reads.
- `.index` matches the fork-only `kGalleryPhotosIndex` / `kGalleryAlbumsIndex` / `kGalleryLibraryIndex` constants.

**`GalleryNavDestination` mapping helpers**

- Exhaustive: each `GalleryTabEnum` value returns the expected label i18n key / idle icon / active icon / target route.

**`openGallerySearch` — behaviour matrix**

All tests use a fake `TabsRouter` (records `setActiveIndex` calls and driven-by-test `activeIndex`) and a `ProviderContainer` with overrides for `hapticFeedbackProvider`, `photosFilterSheetProvider`, `photosFilterSearchFocusRequestProvider`.

- Already on Photos → no `setActiveIndex` call; no delay awaited; sheet → `browse`; focus counter += 1.
- From Albums → `setActiveIndex(0)` called; 620 ms delay elapses (use `fakeAsync`); sheet → `browse`; focus counter += 1 in that order.
- From Library → same as Albums.
- Sheet already at `browse` → state write is a no-op on the provider (same value); focus counter still += 1.
- Sheet at `deep` → state write to `browse`; focus counter += 1.
- **Rapid second `openGallerySearch` call mid-delay** (both target Photos) → two haptics, one effective `setActiveIndex` (second is a no-op since already transitioning to Photos), both delays elapse independently, sheet ends up at `browse`, focus counter += 2 total. Assert final state matches; assert no crash.
- **User taps a tab segment mid-delay (Library) after tapping Search from Albums** — the §7 acknowledged behavior. The in-flight `Future.delayed` continues; at T+620 ms it writes sheet → `browse` and increments focus counter, but `activeIndex` is now `library` (2). Assert: no crash, no exception; sheet state is `browse` (user sees it on return to Photos later); `galleryTabProvider == library` (via the activeIndex mirror listener). Covers the §7 "acceptable deferred-open" behavior explicitly.
- Haptic fires once per call regardless of the sheet's prior state.

**`photosFilterSearchFocusRequestProvider` plumbing (ref.watch + `_lastProcessedFocusRequest` pattern)**

- **Mounted-before-increment** — mount `FilterSheetSearchBar` under `ProviderScope`, then increment; pump one frame; `FocusNode.hasFocus == true`.
- **Mounted-after-increment (race coverage)** — increment the counter FIRST, then mount `FilterSheetSearchBar`, pump one frame; `FocusNode.hasFocus == true`. This is the race the pattern is designed to defeat (`ref.listen` would fail this test; `ref.watch` + last-processed passes it).
- **Duplicate increments in one frame** — increment twice synchronously; pump one frame; focus is requested exactly once (post-frame callback coalesces; verify no double-request exception).
- **Unmount then increment** — mount, unmount, increment the counter; no exception thrown. No lingering State references the (disposed) `FocusNode`.
- **Re-increment** after handled → re-requests focus (blur/focus cycle asserted via widget tester focus tracker).
- `_lastProcessedFocusRequest` advances only after the post-frame `requestFocus` actually runs (proven by a mid-frame-cancel variant: schedule increment, start pumping, cancel via unmount before the post-frame fires → `_lastProcessedFocusRequest` stays at old value; remounting a fresh widget picks up the new counter and requests focus).

**`GalleryTabShellPage` `tabsRouter.addListener` sync**

- Call `tabsRouter.setActiveIndex(1)` directly (simulating `openGallerySearch` or a programmatic tab change) → `galleryTabProvider` reads `GalleryTabEnum.albums` on the next microtask.
- Call `tabsRouter.setActiveIndex(0)` → `galleryTabProvider == photos`.
- Unmount the shell → the listener is removed (assert via `tabsRouter.hasListeners == false` if the API exposes it, otherwise by asserting no crash after a post-unmount programmatic `setActiveIndex`).

### 8.2 Widget tests

**`GalleryNavPill`**

- Three segments rendered in order (Photos · Albums · Library).
- Tapping each segment flips the active state; underlay animates to the tapped segment.
- Only the active segment renders its icon (inactive shows label only).
- Respects `MediaQuery.disableAnimations` (animation skipped in one frame).
- Dark-theme variant test: active fill color = `primary @ 0.16`.
- Light-theme variant test: active fill color = `primary @ 0.22`.
- **First-paint correctness (M1):** after first `pump()`, the `AnimatedPositioned` underlay's rect is within 0.5 pt of the Photos segment's rect (no off-by-measurement flicker). Same test at font-scale 1.5 and 2.0.
- **Organic segment widths.** Under a constrained pill of 320 pt, active Photos segment width > idle Albums segment width by the expected icon-plus-gap delta (~28 pt). Active Albums width > idle Photos width. Confirms `Expanded` was NOT used (`Expanded` would give equal 1/3 widths).
- **Custom easing curve.** Drive a tap from Photos → Albums; sample the `AnimatedPositioned.left` at 40 %, 70 %, and 100 % of the 280 ms duration. The shape must match `Cubic(0.3, 0.6, 0.2, 1)` within 1 pt — distinguishably different from `Curves.easeOutCubic` at the same sample points. Regression against an accidental stock-curve substitution.
- **Inner-warmth highlight.** Dark theme: the gradient's top color token resolves to `onSurface @ 0.04`. Light theme: same token resolves correctly (lighter). Verify the gradient's `DecoratedBox` is rendered behind the segments (widget order in the `Stack`), not above.
- Semantics: active segment has `liveRegion: true`; switching active announces the new tab's label (via `semanticsOwner.performAction` or equivalent tester harness).

**`GallerySearchBlob`**

- Renders the search icon at 24 pt.
- Tapping calls `openGallerySearch` with the injected `TabsRouter` (constructor arg, not `AutoTabsRouter.of`).
- Pressed state (pointer-down → pointer-up) swaps the icon color from `onSurface @ 0.85` to `primary @ 1.0` and back; no hover state (mobile).
- Disabled state (readonly) dims to 30 % opacity and is non-tappable (`ignorePointer: true` + reduced opacity).
- Semantics label resolves from `nav.search_photos_hint` ("Search photos").

**`GalleryBottomNav` composite**

- Hides entirely on `MultiSelectToggleEvent(enabled: true)` — three variants, one per originating tab (Photos, Albums, Library) to confirm global broadcast.
- Hides on keyboard-up: `MediaQuery(viewInsets: EdgeInsets.only(bottom: 81))` → hidden; `= 79` → visible (boundary test for the 80 pt threshold).
- Publishes height to `bottomNavHeightProvider` when shown; resets to 0 when hidden (pair of asserts per state transition).
- Falls back to `NavigationRail` in landscape with the four entries (Photos · Albums · Library · Search).
- Readonly: only Photos is enabled (tap-target blocked on others).

**`GalleryTabShellPage`** — side-effect matrix (§6.5 per row + negatives)

Each tap is driven by `tester.tap(find.byKey(...))`; assertions use `ProviderContainer.read` + `Listener` spy providers where necessary.

- Tap on Photos (from a non-Photos tab) → invalidates `driftMemoryFutureProvider`; writes `galleryTabProvider = photos`; fires `hapticFeedbackProvider.selectionClick()`.
- Re-tap on Photos (already active) → emits `ScrollToTopEvent` on `EventStream.shared`; invalidates `driftMemoryFutureProvider`.
- Tap on Albums → switches `tabsRouter.activeIndex` to 1; invalidates `albumProvider`; writes `galleryTabProvider = albums`; fires haptic.
- Tap on Library → invalidates `localAlbumProvider` AND `driftGetAllPeopleProvider`; writes `galleryTabProvider = library`; fires haptic.
- **Negative assertions (H1 coverage):** across all three tab taps, none of `sharedSpacesProvider`, `searchPreFilterProvider`, `searchInputFocusProvider`, or upstream `tabProvider` are touched. (Spy providers record invocations; assertion checks the invocation list is empty for these.)

**`FilterSheetSearchBar` focus plumbing (touched file)**

- Mount the widget; increment `photosFilterSearchFocusRequestProvider`; pump one frame; `FocusNode.hasFocus` is `true`.
- Increment BEFORE mount (race coverage, mirrors §8.1) → on first build, focus is requested.
- Re-increment → focus re-requested (asserted via a second blur/focus cycle).
- Unmount then increment — no exception.

**`PeekContent` layering**

- With `bottomNavHeightProvider` set to 64, the peek rail's bottom padding is 64 + 8 = 72.
- With the provider at 0 (nav hidden), the peek rail's bottom padding is 0.
- **No-op write guard (R2-4):** set `bottomNavHeightProvider = 64`, pump, count `PeekContent` rebuilds; re-write the same 64 via the gated publish; assert rebuild count does not increase (the equality-guard suppresses the write). A direct `state = 64` write without the guard would fail this.
- **Animation-synced write:** drive the nav through a hide animation; assert `bottomNavHeightProvider` reads the pre-hide height until `AnimatedSlide.onEnd` fires, then reads 0 on the next frame. Peek rail position doesn't jump down during the slide.

### 8.3 Integration / golden

Goldens of the nav at each active state (dark + light):

- Portrait, Photos active, no filters (2 goldens — dark + light).
- Portrait, Albums active (2).
- Portrait, Library active (2).
- Portrait, Photos active, filters applied, peek rail visible, nav stacked above (2) — the M6 coverage for §5.6 layering.
- Landscape rail with all three destinations + Search entry (2).

Total: 10 goldens. Opt-in per project convention (`project_flaky_e2e_fix_pr152.md` documents flake policy).

### 8.4 Manual QA

- Gesture smoothness on older (iOS 15 / Android 11) and newer devices.
- Font-scale 120–200 % renders nav without clipping.
- Contrast AA in both themes on active + idle labels.
- Keyboard-hide smoothness (no jump when keyboard opens during FilterSheet focus).
- Tap targets ≥ 44 × 44 pt verified on smallest supported phone (~360 pt viewport).
- Reduced-motion setting respected.
- RTL: pill segment order flips; search blob stays on the trailing edge per platform norm.
- **Search blob from Albums/Library** — confirm no visible stutter; sheet opens cleanly after the transition; keyboard rises reliably.
- **Peek rail + pill** — with filters applied, peek rail and pill stack without overlap at multiple viewport sizes.

## 9. Migration

### 9.1 Release sequencing

Single PR. The bottom-nav change is reviewable as one unit: ~9 new fork-only files, ~3 upstream-aligned files touched with fork-only comment fences (router, FilterSheetSearchBar, PeekContent), i18n keys added. Widget tests cover the new surfaces; the existing `TabShellPage` stays compilable in case of rollback.

### 9.2 Rollback

If the new shell misbehaves in production, flip the router root back to `TabShellRoute` — one-line revert (the comment-fenced router addition keeps the old entry alive). The upstream `TabShellPage` and `tab.provider.dart` remain fully functional (they're untouched).

### 9.3 Upstream rebase exposure

- `tab_shell.page.dart` — bit-identical to upstream, zero rebase friction.
- `tab.provider.dart` — bit-identical to upstream, zero rebase friction (the fork uses `galleryTabProvider`, not `tabProvider`).
- `router.dart` — ~8 lines of fork-only addition inside a comment fence. Mechanical re-add if upstream reshapes the root.
- `search_bar.widget.dart` — ~10 lines of fork-only FocusNode + listener. Mechanical re-apply if upstream rewrites the search bar.
- `peek_content.widget.dart` — ~5 lines of fork-only `bottomNavHeightProvider` padding. Mechanical re-apply.

All other fork files have zero upstream exposure.

## 10. Risks & open questions

### 10.1 Risks

- **Keyboard-hide detection UX.** Fading the nav on keyboard-up is new behaviour (upstream lets the nav be covered). If QA finds users scrolling past the nav when typing in the FilterSheet, we simplify to "no hide; rely on `resizeToAvoidBottomInset: false` + visual overlap" — same as upstream.
- **Active-pill animation layout measurement.** `AnimatedPositioned` needs accurate segment widths before first paint. Seeding the measurement map with Photos geometry pre-first-frame (§6.3) plus the §8.2 M1 test should catch flicker in CI. Font-scale changes trigger a re-measure; the test covers 1.5× and 2.0×.
- **Landscape rail parity.** The new shell uses the upstream `NavigationRail` visuals in landscape; ensure the rail's destination list is updated to the new 3 + search shape. Regression test: rail destinations match the pill destinations.
- **620 ms delay coupling.** `openGallerySearch` hardcodes a 620 ms delay tied to upstream's 600 ms `FadeTransition`. A single-line constant, documented with a coupling comment; rebase cost is checking that `tab_shell.page.dart:83` still reads 600 ms.
- **auto_route guard inheritance.** `DriftAlbumsRoute` declares `[_authGuard, _duplicateGuard]` at the top-level route. When used as a child of `GalleryTabShellRoute`, auto_route's guard inheritance must preserve this. Verify during implementation; if not propagated, redeclare on the child inside the fork-only router edit.

### 10.2 Open questions

- **Spaces surfacing inside Library** is a follow-up — not scoped here. Before that design lands, Spaces remains reachable via existing in-app surfaces (notifications, deep links, cross-page navigation). A separate design doc will cover its placement inside `DriftLibraryPage`.
- **Drift vs. Isar albums page target.** Default is `DriftAlbumsRoute`. If Drift albums show regressions at ship time (missing sort options, empty state bugs), fall back to `AlbumsRoute` — both are reachable.
- **Search-blob icon variant.** The mockup uses the Material Symbols `search` glyph. If Gallery's branding wants a custom glyph, the widget accepts an `Icon` override — no design change needed.

## 11. Appendix

### 11.1 Related prior art

- **Mobile filter sheet** (`docs/plans/2026-04-17-mobile-filter-sheet-design.md`) — the FilterSheet the search blob opens.
- **PR #116** — introduced the current Spaces-in-nav layout; this design undoes its tab swap (Albums returns to nav, Spaces steps out).
- **Google Photos bottom nav (2025+ redesign)** — the Photos · Collections · Create + circular Search layout is the visual reference (screenshots attached in the brainstorm session).

### 11.2 Mockup

See [`docs/plans/mockups/2026-04-18-mobile-bottom-nav.html`](./mockups/2026-04-18-mobile-bottom-nav.html). Interactive: tap or press `P` / `A` / `L` to switch active. Demonstrates dark + light themes, per-destination active state, edge states (multi-select, keyboard, landscape, readonly).

### 11.3 Follow-ups (not in scope)

- **Spaces-inside-Library** design — separate topic, separate PR. Expected shape: add a Spaces action button + quick-access list item to `DriftLibraryPage`, matching the pre-PR-#116 surface.
- **Focus plumbing reuse.** The `photosFilterSearchFocusRequestProvider` counter pattern is a template for any future "request focus on a specific input from elsewhere" plumbing — e.g., tag-picker search, person-picker search — without leaking `FocusNode` references into providers.
- **Peek-rail → pill merge** (further-out). A more elegant endgame is moving the peek rail's active-filter chips INTO the pill (a fourth visual state of the nav), eliminating the stack entirely. Significant scope; parked until Phase 2.

### 11.4 Review log

- **rev 1 (2026-04-18 initial):** first pass, two open questions resolved during brainstorm.
- **rev 2 (2026-04-18 after `/review`):** folded in 3 blockers, 4 high, 6 medium, 3 low from review. Substantive changes: fork-only `galleryTabProvider` (was conflating with upstream `TabEnum`); new counter-based focus plumbing (was vaporware); 620 ms delay tied to upstream transition (was one-frame wait); peek-rail coexistence pulled into scope (was follow-up); side-effect matrix now exhaustively tested including negative assertions; keyboard threshold unified to 80 pt absolute; live-region a11y covered; auto_route guard inheritance flagged.
- **rev 3 (2026-04-18 after second `/review`):** folded in 2 high, 4 medium, 4 low. Substantive changes: focus plumbing switched from `ref.listen` to `ref.watch + _lastProcessedFocusRequest` (catches the mount-after-increment race that `ref.listen` silently drops); `galleryTabProvider` now auto-synced via `tabsRouter.addListener` at shell level (was hand-written per-tap, out of sync with `openGallerySearch`); `AutoTabsRouter` constructor form aligned with upstream's default+builder-param pattern (was `.builder` named constructor — not known to exist); `bottomNavHeightProvider` writes gated on inequality + hide/show animation-synced; live-region debounce removed (contradicted §5.2 "drags do nothing"); SpacesRoute cross-navigation clarified in §7; new tests: mount-after-increment focus race, user-tap mid-delay, no-op height write rebuild, shell listener sync, live-region on active segment.
- **rev 4 (2026-04-18 after `/frontend-design:frontend-design` review):** folded in 4 aesthetic gaps mockup ↔ Flutter. Substantive changes: easing curve changed from `Curves.easeOutCubic` to `const Cubic(0.3, 0.6, 0.2, 1)` (stock-curve would have erased the motion signature); segments sized organically rather than with `Expanded` (preserves the mockup's elastic active-vs-idle widths); added inner-warmth top-gradient `DecoratedBox` to sell the glass read; search blob's "hover" state renamed to "pressed" (mobile has no hover). New tests cover organic widths, custom-curve shape sampling, gradient layer order, and pressed-state icon color swap.
