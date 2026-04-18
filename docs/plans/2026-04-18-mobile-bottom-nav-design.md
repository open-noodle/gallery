# Mobile Bottom-Nav Redesign — Design

**Status:** Draft · 2026-04-18
**Mockup:** [`docs/plans/mockups/2026-04-18-mobile-bottom-nav.html`](./mockups/2026-04-18-mobile-bottom-nav.html)
**Scope:** Flutter mobile app (`mobile/`). Replaces the bottom navigation for Gallery without touching the upstream `tab_shell.page.dart`.

## 1. Summary

Replace the current four-tab `NavigationBar` (Photos · Search · Spaces · Library) with a floating pill inspired by Google Photos: three destinations (Photos · Albums · Library) inside a rounded-full translucent pill, plus a sibling circular **Search** blob outside the pill on the trailing edge. The current Search tab retires from the nav; Spaces retires from the nav (existing routes remain reachable). Tapping the Search blob routes to the Photos timeline (if the user is elsewhere) and opens the FilterSheet shipped in PR 1.3 with the text-search pill focused.

The new shell ships as a **parallel fork-only widget set** — upstream's `mobile/lib/pages/common/tab_shell.page.dart` stays untouched so upstream rebases remain mechanical.

## 2. Goals

- Match the Google-Photos floating-pill pattern with a Gallery-distinct aesthetic (darkroom warmth, amber accent) theming off `theme.colorScheme.primary`.
- Re-link Immich's existing Albums page to the bottom nav (it was de-linked in PR #116, not deleted).
- Retire the dedicated Search tab; route search intent through the FilterSheet that already covers the web parity surface.
- Preserve fork maintainability by keeping upstream `tab_shell.page.dart` bit-identical to the upstream copy. New widget files are sibling, fork-only.
- Preserve every existing side-effect the current nav already carries: invalidation of memory/album/people/spaces providers on tab switch, multi-select hide, haptic feedback, readonly-mode gating, landscape `NavigationRail` fallback.

## 3. Non-goals

- Surfacing **Spaces** inside Library (follow-up; needs its own design — Spaces currently tab-level, will need card + quick-access placement inside `DriftLibraryPage`).
- Renaming, redesigning, or reshaping the existing Albums page, Library page, or FilterSheet.
- Deep-link redirects for removed tabs (fork-only routes with no external links).
- Mid-session backstack migration shims (auto_route's default-route fallback handles stale routes already, per PR 1.4 in the filter-sheet plan).
- User-configurable nav variants (no toggle between old + new).
- Landscape pill variant — landscape keeps the existing `NavigationRail` exactly as it is today.

## 4. Design decisions (locked)

Captured during brainstorm 2026-04-18:

1. **Three visible destinations + one outside affordance.** Photos · Albums · Library in the pill; Search as a peer blob outside. No fourth tab.
2. **Albums is the existing Immich albums page** — it was de-linked from the bottom nav in PR #116 but not deleted. Target route: `DriftAlbumsRoute` (Drift-based, matches the tab shell's other routes). Legacy `AlbumsRoute` (Isar) stays in the repo as a fallback if Drift parity isn't reached at ship time.
3. **Spaces leaves the bottom nav.** `SpacesRoute` and its pages remain reachable via the existing app surfaces (notifications, deep links, in-app navigation). Surfacing Spaces inside Library as a collection card + quick-access list item is explicitly a follow-up, not part of this PR.
4. **Search blob target is deterministic.** Tap always routes to `MainTimelineRoute` (if not already there) then opens the FilterSheet at its Browse snap with the text-search pill focused and keyboard requested.
5. **`DriftSearchPage` stays in the repo.** It is no longer a bottom-nav tab but remains a reachable route for any in-app deep-links that already point at it.
6. **Upstream `tab_shell.page.dart` stays bit-identical.** A new `GalleryTabShellPage` lives at a fork-only path and the router's root is flipped to point at it. One-line edit in `router.dart` is the only touched upstream-aligned file.
7. **Aesthetic: Darkroom Warmth.** Amber demo palette in the mockup; the Flutter widget resolves its accent from `theme.colorScheme.primary`, so the user's `ImmichColorPreset` continues to drive the color in production.
8. **Nav label casing follows upstream convention** (sentence case: "Photos", "Albums", "Library") — i18n keys `nav.photos`, `nav.albums`, `nav.library`.

## 5. UX

See the [HTML mockup](./mockups/2026-04-18-mobile-bottom-nav.html) for interactive visual reference. Summary below.

### 5.1 Structure

- A rounded-full **pill** floats 26 pt above the home indicator, with 14 pt horizontal margin from each screen edge and a 10 pt gap to the **search blob** on the trailing side.
- The pill hosts three **segments**. Inactive segments render the label only. The active segment renders the filled-icon + label inside an inner rounded-full fill in the accent color @ 16 % opacity.
- The **search blob** is a 54 × 54 pt circle with the same surface treatment as the pill (translucent ink fill, backdrop blur, hairline border, soft shadow). Its icon is `search` from Material Symbols Rounded at 24 pt.

### 5.2 Interaction

- **Tap a segment** → `tabsRouter.setActiveIndex(i)`. The active-pill underlay animates between segments over 280 ms (`cubic-bezier(0.3, 0.6, 0.2, 1)`), the icon fades in over 220 ms with a 60 ms delay, and a `selectionClick` haptic fires.
- **Tap the search blob** → if current tab ≠ Photos, switch to Photos first, then open the FilterSheet. The FilterSheet opens at the Browse snap; the text-search pill inside the sheet requests focus (keyboard opens). Haptic `selectionClick` fires on tap.
- **Drag / swipe** inside the pill has no effect — only taps change tabs. (Avoids gesture collisions with the drag-to-dismiss FilterSheet peek when present.)
- **System back** from a non-Photos tab returns to Photos (inherits upstream's `canPop` contract).

### 5.3 State visibility

The nav is not always on-screen. It hides when:

- **Multi-select is active.** Listens to `MultiSelectToggleEvent` on `EventStream.shared`. Identical contract to the upstream `_BottomNavigationBar`. A fade + 12 pt slide is used.
- **Keyboard is up.** When the soft keyboard covers ≥ 20 % of the viewport height, the nav fades + slides out. Returns on keyboard dismiss. This is a new behaviour not in the upstream nav (upstream uses `resizeToAvoidBottomInset: false` and lets the nav get covered).
- **Landscape.** The whole bottom-nav structure disappears and a `NavigationRail` takes its place on the leading edge with the same three destinations plus the search entry as a rail item. Identical to the upstream landscape path — the rail stays on upstream visuals, no amber styling.
- **Readonly mode** (`readonlyModeProvider == true`). Only Photos is enabled; Albums, Library, and Search dim to 30 % opacity and refuse taps. Identical contract to the upstream `.enabled` handling.

### 5.4 Labels and icons

| Destination | Label     | Icon (Material Symbols Rounded)     | Route                     |
| ----------- | --------- | ----------------------------------- | ------------------------- |
| Photos      | `Photos`  | `photo_library` (outlined / filled) | `MainTimelineRoute`       |
| Albums      | `Albums`  | `photo_album` (outlined / filled)   | `DriftAlbumsRoute`        |
| Library     | `Library` | `space_dashboard`                   | `DriftLibraryRoute`       |
| Search blob | (aria)    | `search`                            | (action — see §6.4 below) |

Icons use `font-variation-settings: "wght" 400, "FILL" 0` when inactive and `"wght" 500, "FILL" 1` when active. Sentence-case labels.

### 5.5 Aesthetic tokens

The mockup's amber palette is illustrative. The Flutter widget reads:

- **Pill surface:** `theme.colorScheme.surfaceContainerHighest.withOpacity(0.68)` + `BackdropFilter(blur: 28)`.
- **Pill border:** 1 pt `theme.colorScheme.outlineVariant.withOpacity(0.55)`.
- **Pill shadow:** elevation-6-equivalent (`0 20 44 -14 shadow @ 0.7` + `0 4 8 shadow @ 0.4`).
- **Idle label / icon:** `theme.colorScheme.onSurface.withOpacity(0.55)`.
- **Active fill:** `theme.colorScheme.primary.withOpacity(0.16)`.
- **Active label / icon:** `theme.colorScheme.primary`.
- **Search blob:** same surface treatment as pill; idle icon `onSurface @ 0.85`, hover `primary @ 1.0`.

In light themes the same roles resolve to lighter surface + higher-contrast fill (`primary.withOpacity(0.22)`).

## 6. Architecture

### 6.1 File layout

**New (fork-only):**

- `mobile/lib/presentation/pages/common/gallery_tab_shell.page.dart` — `@RoutePage()` parallel to `TabShellPage`, hosts the new bottom nav.
- `mobile/lib/presentation/widgets/gallery_nav/gallery_bottom_nav.widget.dart` — the composite widget: pill + blob + landscape rail fallback.
- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_pill.widget.dart` — the rounded-full pill with the 3 segments + animated active underlay.
- `mobile/lib/presentation/widgets/gallery_nav/gallery_nav_segment.widget.dart` — a single segment (active / idle rendering).
- `mobile/lib/presentation/widgets/gallery_nav/gallery_search_blob.widget.dart` — the circular search affordance.
- `mobile/lib/providers/gallery_nav/gallery_nav_destination.dart` — `enum GalleryNavDestination { photos, albums, library }` with `label`, `icon`, `selectedIcon`, `route` mappers.
- `mobile/lib/providers/gallery_nav/gallery_search_action.dart` — `Future<void> openGallerySearch(BuildContext, WidgetRef)` helper that encodes the "switch to Photos, open sheet, focus text pill" sequence.
- `mobile/test/presentation/widgets/gallery_nav/*_test.dart` — one mirror test file per widget.

**Touched (fork-only lines within upstream-aligned files):**

- `mobile/lib/routing/router.dart` — add the new `GalleryTabShellRoute` to the route list, flip the root to point at it. Two lines of change, enclosed in a fork-only comment to simplify rebases.
- `i18n/en.json` — add `nav.photos`, `nav.albums`, `nav.library` keys (Photos + Library already exist under different keys; reuse where possible).
- `mobile/lib/providers/tab.provider.dart` — extend `TabEnum` enum to accommodate the 3-tab shape. (Current `TabEnum` has 4 values; after the redesign it needs values for `photos`, `albums`, `library` — if upstream, this is upstream-aligned code we audit.)

**Untouched (critical — upstream rebase surface):**

- `mobile/lib/pages/common/tab_shell.page.dart` — upstream copy stays bit-identical.
- `mobile/lib/constants/constants.dart` — existing `kPhotoTabIndex` / `kSearchTabIndex` / `kSpacesTabIndex` / `kLibraryTabIndex` constants remain (they're referenced by upstream + fork code paths). The new shell uses its own indexes.

### 6.2 Widget hierarchy

```
GalleryTabShellPage (fork-only, @RoutePage)
├── AutoTabsRouter
│   ├── routes: [MainTimelineRoute, DriftAlbumsRoute, DriftLibraryRoute]
│   └── transitionBuilder: FadeTransition (same as upstream)
└── Scaffold
    ├── body: AutoTabsRouter child
    │   (landscape: Row(rail, body); portrait: body only)
    └── bottomNavigationBar: GalleryBottomNav(tabsRouter)
        ├── (portrait, multi-select off, keyboard down, !readonly)
        │   ├── GalleryNavPill
        │   │   ├── AnimatedPositioned (amber underlay)
        │   │   ├── GalleryNavSegment.photos
        │   │   ├── GalleryNavSegment.albums
        │   │   └── GalleryNavSegment.library
        │   └── GallerySearchBlob
        │       → onTap → openGallerySearch(context, ref)
        ├── (portrait, multi-select on) → SizedBox.shrink()
        ├── (portrait, keyboard up)     → AnimatedSlide/AnimatedOpacity hidden
        ├── (landscape)                 → NavigationRail (upstream-style)
        └── (readonly) → segments rendered with .enabled = false except photos
```

### 6.3 Active-pill animation

A single `AnimatedPositioned` underlay slides behind the active segment; the active segment's icon uses `AnimatedSize` + `AnimatedOpacity` to fade + slide in from the left edge of the segment.

```dart
Stack(
  children: [
    AnimatedPositioned(
      duration: const Duration(milliseconds: 280),
      curve: Curves.easeOutCubic,
      left: _leftFor(activeIndex),
      width: _widthFor(activeIndex),
      top: 6,
      height: 46,
      child: _ActiveUnderlay(color: theme.colorScheme.primary.withOpacity(0.16)),
    ),
    Row(
      children: [
        for (final destination in GalleryNavDestination.values)
          Expanded(child: GalleryNavSegment(destination: destination, active: ...)),
      ],
    ),
  ],
);
```

Segment widths are computed once per layout: idle segments = label width + 28 pt horizontal padding; active segment = label width + icon (22 pt) + 6 pt gap + 32 pt horizontal padding. A `GlobalKey`-based post-frame size measurement primes the `_leftFor` / `_widthFor` lookup map; rebuilds on font-scale change.

`MediaQuery.of(context).disableAnimations` short-circuits the animation — the underlay jumps in one frame, the icon appears without the fade.

### 6.4 Search action — `openGallerySearch`

```dart
Future<void> openGallerySearch(BuildContext context, WidgetRef ref) async {
  final tabsRouter = AutoTabsRouter.of(context);
  if (tabsRouter.activeIndex != GalleryNavDestination.photos.index) {
    ref.read(hapticFeedbackProvider.notifier).selectionClick();
    tabsRouter.setActiveIndex(GalleryNavDestination.photos.index);
    await WidgetsBinding.instance.endOfFrame;
  }
  ref.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
  ref.read(photosFilterSearchFocusProvider.notifier).requestFocus();
}
```

- The existing `photosFilterSheetProvider` already drives the FilterSheet snap. Setting it to `browse` triggers its mount + slide-in animation.
- `photosFilterSearchFocusProvider` is a **new** provider wired for this action — PR 1.3's sheet already has a `FocusNode` for the text pill; expose it via a provider so external actors (the search blob) can request focus without tight coupling.
- The `endOfFrame` await lets the tab transition settle before the sheet animation kicks off, avoiding a visible stutter.

### 6.5 State & side effects

The new shell preserves every side effect the upstream nav triggers on tab switch. The switch-callback moves from the upstream `_onNavigationSelected` to a fork-only equivalent keyed on `GalleryNavDestination`:

| Destination | Provider invalidations / actions (on tap)                                   |
| ----------- | --------------------------------------------------------------------------- |
| Photos      | `driftMemoryFutureProvider` invalidate; `ScrollToTopEvent` if already there |
| Albums      | `albumProvider` invalidate (Drift); view-mode state stays stable            |
| Library     | `localAlbumProvider`, `driftGetAllPeopleProvider` invalidate                |
| Search blob | nothing invalidated; the FilterSheet owns its own state                     |

Every tap also writes `tabProvider` with the corresponding `TabEnum` value and fires `hapticFeedbackProvider.selectionClick()`.

Removed (because the destination is gone):

- `sharedSpacesProvider` invalidation on Spaces-tab entry — the tap no longer exists.
- `searchPreFilterProvider.clear()` on Search-tab entry — the tap no longer exists.
- `searchInputFocusProvider.requestFocus()` on Search-tab re-tap — the tap no longer exists.

### 6.6 Tab index numbering

The new shell uses a fork-only index scheme:

```dart
enum GalleryNavDestination { photos, albums, library }
// photos=0, albums=1, library=2
```

The upstream constants (`kPhotoTabIndex = 0`, `kSearchTabIndex = 1`, `kSpacesTabIndex = 2`, `kLibraryTabIndex = 3`) are **kept untouched**. They're referenced by upstream code paths that the fork still consumes; renaming or reindexing them would blow rebase scope. The new shell defines its own `kGalleryPhotoIndex = 0`, `kGalleryAlbumsIndex = 1`, `kGalleryLibraryIndex = 2` constants in a fork-only file.

## 7. Error handling & edge cases

- **FilterSheet is mid-animation when Search blob is tapped.** `openGallerySearch` always sets the sheet to `browse`. If the sheet was already opening from another source, this is idempotent — setting the state to the same value is a no-op. Focus request is queued.
- **FilterSheet is open at Deep when Search blob is tapped.** `openGallerySearch` sets the sheet to `browse`; the sheet's own snap controller animates back to Browse. Focus goes to the text pill.
- **User taps Search blob from Albums/Library tab while sheet was previously open on Photos with chips applied.** The chips remain (the sheet's state is preserved across tab switches per PR 1.2 decisions). The sheet opens at Browse with the existing chips visible and the text pill focused.
- **Readonly mode and Search blob.** Search blob is disabled in readonly mode. It dims with the nav and refuses taps. Consistent with how the upstream Search tab behaved.
- **No FilterSheet (degraded).** If `photosFilterSheetProvider` is unreachable (shouldn't happen — it's top-level), the search blob falls back to pushing `DriftSearchRoute` as a full-screen route. This is defensive code, not a common path.
- **Landscape with readonly mode.** Only the Photos rail entry is enabled; Albums / Library / Search disabled with the rail's built-in disabled style.
- **App lifecycle — foregrounding with keyboard was open.** The keyboard-hide detection runs off `MediaQuery.viewInsets.bottom`; when the app foregrounds with no keyboard, the nav re-renders at full opacity.
- **Accessibility-font-scale 200 %.** Segment widths reflow; if the active segment no longer fits, labels truncate with ellipsis and the full label is exposed via `Semantics`. The idle segment's label-only render truncates with ellipsis too; tooltip shows on long-press.

## 8. Testing

Patrol-based e2e is out-of-scope (memory `project_play_store_publishing.md`). Coverage is unit + widget tests (`flutter_test` + `ProviderScope` overrides).

### 8.1 Unit tests

- `GalleryNavDestination` — exhaustive mapping test: each enum value returns the expected label / icon / selectedIcon / route.
- `openGallerySearch` — behaviour matrix:
  - Already on Photos → no tab switch, sheet → browse, focus requested.
  - On Albums → tab switch to Photos, sheet → browse, focus requested (order checked via fake clock / mockito).
  - Sheet already at browse → no redundant state write; focus requested.
  - Sheet at deep → state write to browse; focus requested.
  - Readonly mode → action is a no-op (covered by widget test).

### 8.2 Widget tests

**`GalleryNavPill`**

- Three segments rendered in order (Photos · Albums · Library).
- Tapping each segment flips the active state; underlay animates to the tapped segment.
- Only the active segment renders its icon (inactive shows label only).
- Respects `MediaQuery.disableAnimations` (animation skipped in one frame).
- Dark-theme variant test: active fill color = `primary @ 0.16`.
- Light-theme variant test: active fill color = `primary @ 0.22`.

**`GallerySearchBlob`**

- Renders the search icon at 24 pt.
- Tapping calls `openGallerySearch`.
- Disabled state (readonly) dims to 30 % opacity and is non-tappable.
- Semantics label is "Search photos" (i18n key `nav.search_photos_hint`).

**`GalleryBottomNav` composite**

- Hides entirely on `MultiSelectToggleEvent(enabled: true)`.
- Hides on keyboard-up (simulated via `MediaQuery(viewInsets: EdgeInsets.only(bottom: 400))`).
- Falls back to `NavigationRail` in landscape with the four entries (Photos · Albums · Library · Search).
- Readonly: only Photos is enabled (tap-target blocked on others).

**`GalleryTabShellPage`**

- Three routes mounted under `AutoTabsRouter`; default active = Photos.
- Tap on Albums switches `tabsRouter.activeIndex` to 1.
- `hapticFeedbackProvider.selectionClick` fires on every tap.
- `tabProvider` written on every tap.
- Tap on Photos twice invokes `ScrollToTopEvent`.

### 8.3 Integration / golden

Portrait + landscape goldens of the nav at each active state (dark + light) — 6 goldens total. Opt-in per project convention (`project_flaky_e2e_fix_pr152.md` documents flake policy).

### 8.4 Manual QA

- Gesture smoothness on older (iOS 15 / Android 11) and newer devices.
- Font-scale 120–200 % renders nav without clipping.
- Contrast AA in both themes on active + idle labels.
- Keyboard hide smoothness (no jump when keyboard opens during FilterSheet focus).
- Tap targets ≥ 44 × 44 pt verified on smallest supported phone (~360 pt viewport).
- Reduced-motion setting respected.
- RTL: pill segment order flips; search blob stays on the trailing edge per platform norm.

## 9. Migration

### 9.1 Release sequencing

Single PR. The bottom-nav change is small and reviewable as one unit: ~7 new files, 1 upstream-aligned file touched (router), i18n keys added. Widget tests cover the new surfaces; the existing `TabShellPage` stays compilable in case of rollback.

### 9.2 Rollback

If the new shell misbehaves in production, flip the router root back to `TabShellRoute` — one-line revert. The upstream `TabShellPage` remains fully functional (it's untouched).

### 9.3 Upstream rebase exposure

- `tab_shell.page.dart` is bit-identical to upstream — zero rebase friction.
- `router.dart` has a 2-line fork-only edit enclosed in a fork-only comment; conflicts here are mechanical (one-liner re-add if upstream reshapes the root).
- `tab.provider.dart` — if upstream evolves `TabEnum`, resolve by picking upstream's shape and mapping the fork's 3-tab layout onto it.

The new fork-only files have zero upstream exposure.

## 10. Risks & open questions

### 10.1 Risks

- **Keyboard-hide detection UX.** Fading the nav on keyboard-up is new behaviour (upstream lets the nav be covered). If QA finds users scrolling past the nav when typing in the FilterSheet, we simplify to "no hide; rely on `resizeToAvoidBottomInset: false` + visual overlap" — same as upstream.
- **Active-pill animation layout measurement.** `AnimatedPositioned` needs accurate segment widths before first paint. If the first paint misplaces the underlay, add a one-frame post-frame re-measure. The mockup demonstrates the intent; the real Flutter implementation is where layout reality bites.
- **Landscape rail parity.** The new shell uses the upstream `NavigationRail` visuals in landscape; ensure the rail's destination list is updated to the new 3 + search shape. Regression test: rail destinations match the pill destinations.

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
- **FilterSheet text-search-pill focus plumbing** — exposing the text pill's focus node via a provider is a small enabler; may ship in the same PR or as a prerequisite.
- **Photos-tab peek rail + new nav coexistence** — FilterSheet peek rail renders above the nav when filters are active (PR 1.2 design §5.1). Sanity-check its visual layering with the new floating pill (they should stack cleanly; peek rail uses the same safe-area-aware offset).
