# Timeline Grouping Bottom Pill — Always-Visible Years/Months/All on Detail Timelines

**Date:** 2026-06-10
**Status:** Design — approved in brainstorm, spec reviewed against source
**Addendum (2026-06-10, on-device review):** two behaviors changed after this spec was written: the pill hosts a `bare` selector variant (the selector no longer paints its own surface/border inside the pill — fixes a double border), and grouping on detail timelines is **route-local via `timelineGroupingProvider`**, opening at "All" instead of following the persisted `Setting.groupAssetsBy` (segment taps inside a detail route no longer write the setting; the main Photos page opts into the persisted behavior with `persistGrouping: true`).
**Related:** [2026-05-22-mobile-timeline-overview-design.md](./2026-05-22-mobile-timeline-overview-design.md) (PR #625), [2026-06-08-timeline-grouping-fixes-design.md](./2026-06-08-timeline-grouping-fixes-design.md) (#670/#674), [2026-06-09-mobile-filter-grouping-fix-design.md](./2026-06-09-mobile-filter-grouping-fix-design.md) (PR #679, merged), [2026-06-09-timeline-overview-flicker-and-roundtrip-design.md](./2026-06-09-timeline-overview-flicker-and-roundtrip-design.md) (PR #680, merged)

## Context

On album and shared-space timelines (and 10 sibling routes), the Years/Months/All grouping picker is a plain scrollable header row (`TimelineGroupingHeaderSliver`, a `SliverToBoxAdapter` passed as `topSliverWidget`) — scroll down and it disappears. The user has no way to change grouping without scrolling all the way back up.

Affected routes (the 12 current users of `TimelineGroupingHeaderSliver`): remote album, shared space, person, partner, favorites, archive, trash, locked folder, videos, recently taken, place detail, and the local-album timeline (`local_timeline.page.dart`). These are **root-level pushed routes** (`router.dart`) — the Photos/Albums/Library bottom-nav pill exists only inside `GalleryTabShellPage`, so there is no persistent bottom UI on these pages today. The bottom edge hosts only the right-edge scrubber, the transient download FAB, and the multiselect bottom sheet (`GeneralBottomSheet` — rendered **only during multiselect**: `isBottomWidgetVisible = bottomSheet != null && (isMultiSelectStatusVisible || persistentBottomBar)`, and `persistentBottomBar` has zero consumers in the codebase).

**This spec supersedes one decision in the 2026-05-22 overview design**, which said _"Do not add another floating bottom control"_ and _"use a lightweight top-of-content row above the timeline, not a bottom floating pill."_ The top-of-content row is exactly what scrolls away — product decision (2026-06-10) is to move it to an always-visible floating bottom pill on detail timelines.

## Decisions (confirmed with product owner)

1. **New floating bottom pill on detail timelines.** Same visual language as the main page's nav pill (`GalleryBottomNav`): rounded, elevated, floating above the bottom safe area. No route restructuring.
2. **All 12 routes, replacing the top header.** `TimelineGroupingHeaderSliver` is deleted; one control, always visible, consistent everywhere.
3. **The pill hosts the full 3-segment selector** (`TimelineGroupingSelector()` — Years | Months | All, ≤218 px wide, 48 px tall): direct one-tap level selection, matching what these pages show today.
4. **Main Photos page is unchanged** (keeps the compact app-bar chip; it already has the nav pill + search blob at the bottom).

## Design

### Mechanism: a `Timeline` flag, not a per-page wrapper

`Timeline` (the shared rendering surface, `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`) gains an opt-in flag:

```dart
const Timeline({ ..., this.withGroupingPill = false });
```

When `withGroupingPill` is true, `Timeline`:

1. **Overlays the pill** inside its own `Scaffold` body (a `Stack` wrapping the existing `_SliverTimeline`, pill bottom-center via `Positioned`). Keeping it inside `Timeline`'s scaffold gives one place to own z-order with the multiselect bottom sheet and the download FAB. Stack order content-then-pill also yields the right semantics order (content first, pill last).
2. **Adds bottom clearance through the existing padding seam.** `_SliverTimeline` already computes `contentBottomPadding = context.padding.bottom + (isMultiSelectEnabled ? 120 : 0)` and derives `scrubberBottomPadding` from it. The flag adds a constant pill clearance (pill height + bottom float) into `contentBottomPadding` — which means the **scrubber's draggable area automatically ends above the pill too** (its bottom bound derives from the same value; intended and tested). The clearance is constant while the flag is on — it does not animate away when the pill temporarily hides, so content never jumps. During multiselect, clearance and the existing 120 px modifier simply add up (slightly more scroll room while the sheet is open; harmless, no jump on exit).

Each of the 12 pages then drops `topSliverWidget: TimelineGroupingHeaderSliver()` (and its `topSliverWidgetHeight`/`timelineOverviewTopSliverHeight` constants, including the values fed into `timelineScrubberSnappingOffset`) and passes `withGroupingPill: true`. **Note:** some pages construct `Timeline` at more than one call site (space detail has 3, partner detail has 4 — different states/branches); the flag must be set at every grouping-relevant call site. **Deleting `TimelineGroupingHeaderSliver` + `kTimelineGroupingHeaderSliverHeight` makes the header migration compiler-enforced** — any straggler page fails to build.

### The pill widget

New `TimelineGroupingBottomPill` (`mobile/lib/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart`):

- **Visual parity with `GalleryBottomNav`'s pill:** stadium-rounded `Material` surface with the same elevation/surface treatment, floating `max(bottom safe-area inset, 26)` px above the screen bottom (the nav pill's `_bottomFloat`), centered horizontally. Content: `TimelineGroupingSelector()` (the full selector; its own `LayoutBuilder` caps width at 218 px — give it `min(218, available − margins)` so very narrow widths shrink it instead of overflowing).
- **Hide rules (animated, 200 ms, parity with the nav pill):**
  - **Multiselect active** → hidden (watch `multiSelectProvider`, exactly as `TimelineGroupingHeaderSliver` does today; the multiselect bottom sheet takes the bottom edge).
  - **Keyboard up** (viewInset > 80 px threshold, nav-pill parity) → hidden.
  - **Reduced motion** (`MediaQuery.disableAnimationsOf`) → state changes apply instantly, no animation (same convention as the selector's tests).
  - Otherwise **always visible** — no scroll-linked show/hide; that is the point of the feature.
- **Landscape:** stays bottom-centered (no side-rail variant; the pill is small).
- **Semantics:** the pill is a passive container — it must add no button semantics of its own; the selector's existing semantics (container + three mode buttons + selected state, already covered by `timeline_grouping_selector_test.dart`) are exposed unchanged.

### Coexistence at the bottom edge (verified against source)

- **Scrubber:** scrubber code untouched, but its draggable area lifts above the pill automatically via the shared `contentBottomPadding` seam (see Mechanism §2). Horizontally there is no overlap either: the pill (≤218 px, centered) leaves ≥50 px side margins even at 320 pt width.
- **Download FAB** (`DownloadStatusFloatingButton`, transient, bottom-end): may sit beside/above the pill's right margin on narrow screens while a download runs. Accepted — it is transient; z-order: FAB above pill.
- **Multiselect bottom sheet:** rendered only during multiselect; the pill hides then, so no contention.
- **`persistentBottomBar`:** currently consumer-less; the pill design ignores it. If a page ever enables it together with the pill, the pill hide rules still apply only to multiselect/keyboard (revisit then).

## Implementation slices (numbered — for /impl-loop)

Each slice is self-contained: TDD RED→GREEN, then verify before moving on. Pinned toolchain: `~/.local/share/mise/installs/flutter/3.41.7/bin/{flutter,dart}`. Per-slice verify = the slice's test files + `dart analyze --fatal-infos lib test` + `dart format --set-exit-if-changed <touched files>`; full `flutter test` in the final slice.

### Slice 1 — `TimelineGroupingBottomPill` widget

**Files:** new `mobile/lib/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart`; new `mobile/test/presentation/widgets/timeline/timeline_grouping_bottom_pill_test.dart`.

Write the tests first; the initial run is a **compile-RED** (widget doesn't exist), then implement:

- Renders the full 3-segment selector (semantics: one container, three mode buttons, selected state announced).
- Tapping a segment writes `Setting.groupAssetsBy` (smoke through the pill — the selector's own tests stay the source of truth for selector behavior).
- Hides when `multiSelectProvider` enables; reappears when it disables.
- Hidden while keyboard inset > threshold.
- Bottom float respects `max(safe-area, 26)` (test with a `MediaQuery` bottom padding larger and smaller than 26).
- Reduced motion: hide/show applies immediately with no animation.
- Adds no button semantics of its own (semantics tree contains exactly the selector's).
- Large text scale: no overflow (the selector's segments already guard label fit).
- RTL: renders and taps correctly.

### Slice 2 — `Timeline.withGroupingPill` flag (overlay + clearance)

**Files:** `mobile/lib/presentation/widgets/timeline/timeline.widget.dart`; tests in a new or existing Timeline-level test file.

TDD (RED first — the flag doesn't exist → compile-RED, then assertion tests):

- `withGroupingPill: true` → the pill is rendered inside the Timeline scaffold.
- Clearance: `contentBottomPadding` grows by the pill clearance constant when the flag is on (assert via scroll extents or the padding widget); the scrubber's bottom bound moves with it.
- `withGroupingPill: false` (default) → no pill, no extra clearance — **explicit regression test** (main Photos and every non-flagged timeline unchanged).
- Multiselect with the flag on: pill hides, the multiselect sheet + selection UI work, pill returns on exit; clearance stays constant (no content jump).

### Slice 3 — migrate three representative pages (album, space, favorites)

**Files:** `drift_remote_album.page.dart`, `space_detail.page.dart` (all 3 `Timeline(` call sites), `drift_favorite.page.dart`; their page tests.

TDD order:

1. **Write the scroll-persistence regression test against the album page FIRST** — scroll far down, assert the grouping selector is still present. **RED today** (the header sliver scrolls away). This is the bug's guard.
2. Migrate the three pages: drop `topSliverWidget: TimelineGroupingHeaderSliver()` + height constants (and `timelineScrubberSnappingOffset` inputs), add `withGroupingPill: true` at every `Timeline(` call site. Test → GREEN.
3. Deep assertions per page: header sliver gone (`timeline-grouping-header-sliver` key finds nothing); pill present; switching grouping from the pill regroups (month → overview cards; All → grid); **last-row reachability** (scroll to `maxScrollExtent` → bottom-most tile fully above the pill's top edge).

### Slice 4 — migrate the remaining 9 pages + delete the header

**Files:** `drift_person.page.dart`, `drift_partner_detail.page.dart` (all 4 call sites), `drift_video.page.dart`, `drift_locked_folder.page.dart`, `drift_trash.page.dart`, `drift_recently_taken.page.dart`, `drift_place_detail.page.dart`, `drift_archive.page.dart`, `local_timeline.page.dart`; **delete** `timeline_grouping_header_sliver.widget.dart` + `kTimelineGroupingHeaderSliverHeight`; migrate/retire its direct widget tests (superseded by Slice 1–3 coverage).

- Mechanical migration identical to Slice 3; the header deletion makes any missed page a compile error.
- All existing page tests stay green after migration; `timeline_grouping_selector_test.dart` and main-Photos app-bar tests untouched and green.

### Slice 5 — final verify + on-device validation

- Full `flutter test` (whole mobile suite), `dart analyze --fatal-infos lib test`, format check.
- On-device (branded sideload): album + space → pill visible at bottom; scroll deep → still there; switch Years/Months/All from the pill → view regroups, position anchors per #674/#680; multiselect → pill yields; scrubber drag ends above the pill.

## Edge cases (each tested in the slices above or explicitly asserted)

| Edge case                                         | Handling                                                                                                |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Empty timeline (0 assets)                         | Pill stays visible and functional; switching grouping on an empty timeline is harmless                  |
| Multiselect entered while scrolled mid-list       | Pill hides; clearance constant (existing +120 multiselect modifier simply adds); pill returns on exit   |
| Keyboard appears                                  | Pill hides while inset > threshold                                                                      |
| Landscape                                         | Bottom-centered, same behavior (test one orientation case)                                              |
| Very narrow width (≤320 pt)                       | Pill width = `min(218, width − margins)`; selector shrinks via its `LayoutBuilder`; no scrubber overlap |
| Large text scale                                  | No overflow (selector guards labels; pill height fits)                                                  |
| RTL locale                                        | Selector handles direction; pill is symmetric                                                           |
| Reduced motion                                    | No animation; immediate state changes                                                                   |
| Scrubber drag while pill visible                  | Track ends above the pill (shared padding seam); no horizontal overlap                                  |
| Download FAB visible                              | Transient overlap accepted; FAB above pill in z-order                                                   |
| Pages with multiple `Timeline(` call sites        | Flag set at every call site (space ×3, partner ×4); page tests cover the visible branch                 |
| Disabled selector contexts (e.g. read-only modes) | Selector's `enabled` flag behavior unchanged; pill passes through                                       |

## Scope

Mobile only:

- New: `timeline_grouping_bottom_pill.widget.dart` (+ its test).
- Modified: `timeline.widget.dart` (`withGroupingPill` flag: overlay + clearance), the 12 detail pages (drop header, add flag, drop height constants).
- Deleted: `timeline_grouping_header_sliver.widget.dart` + `kTimelineGroupingHeaderSliverHeight` (+ its direct tests, replaced by pill/page tests).
- Untouched: `TimelineGroupingSelector` itself, the main Photos page, `GalleryBottomNav`, routing, web, server.

Branch base: rebase onto `main` **after PRs #679/#680 are merged** (both touch `timeline.widget.dart` / overview internals that this work builds on). _Status: both merged 2026-06-10; branch rebased._

## Out of scope

- Main Photos page placement (keeps the compact app-bar chip; revisit separately if desired).
- Route restructuring to extend the real nav pill onto detail pages.
- Scroll-linked hide/show of the pill.
- Making `persistentBottomBar` (currently consumer-less) interact with the pill.

## Rollout / validation

No flag — UX fix. On-device validation per Slice 5.
