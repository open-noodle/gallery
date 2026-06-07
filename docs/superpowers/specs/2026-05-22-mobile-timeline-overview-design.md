# Mobile Timeline Overview Design

> Update: The zoom-navigation follow-up spec from 2026-05-25 supersedes this document's original temporal-scope activation model. Bucket card activation now updates grouping and a route-local zoom anchor only; `TimelineTemporalScope` is reserved for explicit temporal filters where a route exposes them.

## Problem

The Flutter app already has the foundation for timeline grouping through `GroupAssetsBy`, including a recently planned `year` grouping mode. That foundation makes the timeline bucketable by year, month, or day, but it does not yet provide the mobile equivalent of the web timeline overview experience from discussion #387.

The native mobile UI needs a photo-first way to skim a large library by year or month without losing screen space to extra controls. The web implementation uses prominent representative cards and a grouping selector; the mobile implementation must keep the same product model while fitting the current mobile shell, bottom navigation, filter sheet, scrubber, and selection UI.

## Goals

- Add a mobile timeline display mode selector with `Years`, `Months`, and `Days`.
- Use compact representative overview cards for `Years` and `Months`.
- Preserve the existing detailed mobile photo timeline for `Days`.
- Make year and month cards zoom through grouping resolution:
  - Tap a year card to switch to `Months` anchored to that year.
  - Tap a month card to switch to `Days` anchored to that month.
- Keep grouping state aligned with the existing `Setting.groupAssetsBy` preference.
- Apply the experience through the shared Flutter `Timeline` surface wherever photos are displayed, with route-specific behavior only where needed.
- Keep active filters/search/person/album/space constraints in effect so overview cards only represent matching assets.

## Non-Goals

- Do not port the large web card layout directly to mobile.
- Do not add another floating bottom control; the bottom edge is already occupied by bottom navigation, search, scrubber, selection, and filter sheet states.
- Do not add a second app-bar search/filter icon next to the grouping selector.
- Do not replace the normal `Days` timeline with card-based day groups.
- Do not change existing asset viewer, multi-select, upload, download, or trash/archive behavior except where grouping controls must be hidden or disabled.
- Do not change `GroupAssetsBy` persisted enum indexes.

## Visual Direction

The mobile design is dense, cropped, labeled, and photo-first.

`Years` and `Months` are overview modes. Each bucket renders as a compact banner card, not a full-screen hero preview. The photo carries the emotional weight; controls stay quiet.

Card requirements:

- Height target: `128-152dp` on portrait phones.
- Width: available timeline content width, respecting existing horizontal page padding and safe areas.
- Image fit: cover crop, never contain-fit letterboxing.
- Overlay: bottom gradient strong enough for white labels in dark and light themes.
- Label: always visible, large, and anchored in the lower-left.
- Count: always visible near the label as a small count badge.
- Radius: modest, consistent with existing mobile photo surfaces.

Examples:

- Year card: `2025` and `12 photos`
- Month card: `Mar 2025` and `4 photos`

The cards must scan as a list of time periods, not as ordinary single photos. Users should immediately understand which year or month each card represents.

## Top Control Placement

Replace the current `FilterIconButton` app-bar action on the main Photos timeline with a compact `Years / Months / Days` segmented control.

The control:

- Lives in the app-bar action slot on mobile Photos.
- Is the only top-right affordance in that slot.
- Is right-aligned and app-bar-height friendly.
- Uses short localized labels.
- Does not add a trailing search/filter icon.
- Collapses only if required by very narrow widths or large text settings.

The existing bottom search affordance remains the primary search entry point. Active filters remain visible and clearable in `PhotosFilterSubheader`. Browsing filter categories must remain reachable through the existing filter/search sheet path after the app-bar icon is removed. If that path is not discoverable enough in the current implementation, improve the sheet flow itself instead of restoring an app-bar icon or adding a second top-right affordance.

For non-Photos routes that use `Timeline`, place the same compact selector in the route's app-bar/header action area when that route has an app bar. If a route has no suitable app-bar slot, use a lightweight top-of-content row above the timeline, not a bottom floating pill.

## Timeline Modes

### Years

`Years` shows one compact overview card per year with matching assets.

The representative card should be selected from assets that are already eligible for the current timeline route and filters. For example, a person timeline only shows years containing that person, and a filtered Photos timeline only shows years matching the active filters.

Tapping a year:

- Switches grouping to `Months`.
- Stores a route-local year zoom anchor.
- Reloads buckets under the existing route constraints and explicit filters.
- Scrolls to the matching year in the month overview while keeping adjacent years reachable.
- Does not create a temporal chip or narrow the route by year.

### Months

`Months` shows one compact overview card per month with matching assets. Month labels include the year to avoid ambiguity after broad filters or route changes.

Tapping a month:

- Switches grouping to `Days`.
- Stores a route-local month zoom anchor.
- Reloads day buckets under the existing route constraints and explicit filters.
- Scrolls to the matching month in the detailed timeline while keeping adjacent months reachable.
- Does not create a temporal chip or narrow the route by month.

### Days

`Days` keeps the current detailed mobile timeline:

- Existing day/month headers.
- Existing thumbnail grid.
- Existing scrubber behavior.
- Existing multi-select and asset viewer navigation.
- Existing scroll-to-date support.

If the user manually switches from `Years` or `Months` back to `Days` without tapping a card, the app should show the detailed timeline for the current route constraints and explicit filters. Manual grouping changes do not create or preserve a bucket-activation date scope.

Overview modes should keep the existing timeline scrubber only when it can use grouping-aware labels and remain clear of overview cards, the bottom navigation, and filter sheet states. If the scrubber would overlap cards or selection affordances in a specific route, hide or disable it for that state rather than adding another control.

## Zoom Anchors And Explicit Filters

Grouping is a display mode. Bucket activation is zoom navigation: it changes grouping and stores a route-local scroll anchor.

The implementation should use a reusable mobile zoom anchor model:

- None
- Year anchor
- Month anchor

Zoom anchors must compose with existing filters, route constraints, and search text. They must not clear people, places, tags, favorites, albums, spaces, archive/trash/locked constraints, ownership constraints, or explicit temporal filters.

Resolving a zoom anchor:

- Scrolls to the matching year or month if present.
- Leaves all route constraints and explicit filters intact.
- Clears only the pending anchor after a successful scroll.

Explicit temporal filters remain separate. On Photos, explicit temporal filters should appear through the same active-filter subheader language used by current filters. On routes without `PhotosFilterSubheader`, use a route-local clearable chip or compact subheader only for explicit temporal filters, never for bucket activation.

## State And Persistence

The selector should update the existing grouping setting immediately:

- `Years` writes `GroupAssetsBy.year`.
- `Months` writes `GroupAssetsBy.month`.
- `Days` writes `GroupAssetsBy.day`.

Card zoom changes the grouping mode too, so it must update the same setting:

- Tapping a year writes `GroupAssetsBy.month`.
- Tapping a month writes `GroupAssetsBy.day`.

The Settings grouping picker, in-timeline selector, and zoom transitions must remain in sync.

Zoom anchors are navigation state, not a global preference. They should not be persisted across cold app launches. Route restoration may preserve grouping where existing behavior already does, but must not restore bucket-activation anchors as filters.

When a route opens in a context where overview modes would break selection semantics, such as choosing a cover photo, the route should force `Days` for that session or hide the selector. This matches the web fix where cover-photo selection must operate on selectable assets, not overview cards.

## Architecture

Build on the existing mobile timeline foundation:

- `GroupAssetsBy` remains the shared grouping enum.
- `TimelineFactory.groupBy` remains the default grouping source.
- `Timeline` stays the shared rendering entry point.
- Drift bucket sources continue to provide bucket counts.

Add a small set of mobile-specific units:

- A reusable `TimelineGroupingSelector` widget.
- A `TimelineOverviewCard` widget for year/month buckets.
- A testable overview segment builder or layout adapter that maps year/month buckets to one-card rows.
- A route-local zoom anchor provider/model that can be overridden by route.
- Explicit temporal filter adapters only where a route exposes real date filters.

The overview-card path should not ask the timeline service to load every asset in a year/month bucket. It needs one representative asset and a count. If the current mobile repository can only provide bucket counts, add a bounded representative-asset lookup per visible bucket or per prefetched viewport window. Avoid unbounded one-query-per-bucket behavior for very large libraries.

Day mode should remain the compatibility baseline. Existing fixed timeline segment rendering can continue to serve day mode.

## Route Adoption

The target is every native Flutter route that displays photos through `Timeline`, including:

- Main Photos
- Albums
- Shared spaces
- People
- Favorites
- Archive
- Trash
- Locked folder
- Videos
- Places/map-related timelines
- Remote assets and other shared `TimelineFactory` origins

Adoption can be sliced:

1. Main Photos first because it exercises filters, search, active chips, and bottom navigation.
2. Person and album/space timelines next because they validate route constraints without the Photos filter sheet.
3. Utility timelines such as favorites, archive, trash, locked, videos, and map-related routes after the shared pieces are stable.

Routes that enter an asset-picking workflow, especially cover-photo selection, should force `Days` or explicitly disable overview modes so individual assets remain selectable.

## Empty, Loading, And Error States

Empty overview modes should use the route's existing empty state where possible. They should not show an unlabeled blank list.

Representative-card loading:

- Reserve stable card height.
- Show a neutral skeleton or low-contrast surface with the date label and count if count is available.
- Avoid layout jumps when thumbnails arrive.

Representative-card failure:

- Keep the date label and count visible.
- Use a neutral fallback background.
- Still allow zoom activation if the bucket count is non-zero.

If a representative asset is removed or no longer matches filters, reload the representative metadata for that bucket. If none is available but the bucket still has assets, keep the fallback card.

## Accessibility

The segmented control must be reachable and announce the selected mode.

Overview cards must expose button semantics:

- Year card label example: `2025, 12 photos, show months`.
- Month card label example: `March 2025, 4 photos, show days`.

Cards must work with large text, reduced motion, dark mode, light mode, and high-contrast settings. Labels and count badges must remain legible over varied photos. Motion during mode switches should be subtle and non-essential.

Slice 6 acceptance criteria:

- Selector semantics identify one container, three reachable mode buttons, and the selected mode. Disabled or hidden selector states must not leave stale actionable semantics behind.
- Overview-card semantics are localized, include the period label, pluralized count, and action, and are exposed only when the card can be activated. Fallback and failed-thumbnail cards still announce the period and count when zoom activation is available.
- Explicit temporal filter chips expose a remove/clear action that is distinguishable from normal filter-chip copy and clears only the explicit date filter.
- Focus traversal reads the selector before any explicit route-local temporal chips and reads overview cards in visual order.
- The selector and cards keep at least Material minimum interactive target sizes where they are actionable.
- RTL locales mirror layout without reversing the persisted grouping model: the visual order follows directional UI expectations, semantics remain understandable, and card labels anchor to the directional start edge.
- Reduced-motion mode disables nonessential selector/card transitions; state changes still happen immediately.
- High-contrast, dark, and light themes keep label and count contrast readable over representative photos and fallback backgrounds.

Slice 6 localization requirements:

- All new screen-reader copy uses generated translation keys rather than hard-coded English strings.
- Count copy uses ICU plural forms.
- Month labels use locale-aware date skeletons, not hand-built English month strings.
- Tests must cover English singular/plural, a non-English month order or month name, a long localized month label, and an RTL locale.
- Regenerate mobile localization loader/key files after adding keys.

## Development Process

Implementation must use test-driven development. Each implementation slice should start with the smallest failing tests for the behavior it introduces, confirm those tests fail on the current implementation, then make the minimal production changes needed to pass.

Recommended slice order:

1. Selector state and setting sync.
2. Zoom anchor model and route/filter composition.
3. Overview bucket/card data path with representative assets.
4. Photos route integration: app-bar replacement, zoom activation, and explicit temporal filter preservation.
5. Shared route adoption and cover-photo/day-mode guardrails.
6. Accessibility, localization, and responsive polish.

Do not rely on screenshots alone. Use widget tests for state and semantics, repository/provider tests for filtering, and integration tests for the Photos zoom flow.

Slice 6 must also follow TDD. Start with failing semantics, localization, and responsive widget tests before changing selector/card APIs. Each responsive rule must be testable: narrow widths and large text keep content inside bounds; landscape/tablet widths do not add extra controls; RTL mirrors alignment without breaking tap behavior.

## Testing

Selector and setting tests:

- `Years`, `Months`, and `Days` render in the mobile app-bar action slot.
- Selecting each mode writes the correct `GroupAssetsBy` value.
- The selector initializes from `Setting.groupAssetsBy`.
- Settings picker changes update the timeline selector.
- Tapping a year writes `GroupAssetsBy.month` because zoom activation switches to `Months`.
- Tapping a month writes `GroupAssetsBy.day` because zoom activation switches to `Days`.
- Existing enum indexes remain unchanged.
- Very narrow width or large text does not overflow the app bar.
- Selection mode and asset viewer overlays hide or disable the selector where needed.
- Selector semantics include a selected-state announcement and no duplicate child labels.
- Reduced-motion media settings remove nonessential selector animation without changing persistence behavior.
- RTL layout preserves tap behavior and presents the three modes in directional visual order.

Overview card tests:

- Year cards render label, count, and representative thumbnail.
- Month cards render localized month/year label, count, and representative thumbnail.
- Cards reserve stable height while loading.
- Failed thumbnail load keeps label and count visible.
- One-asset buckets render correctly.
- Video-only buckets render a usable thumbnail or fallback.
- Labels remain legible in dark and light themes.
- Accessibility labels include date, count, and action.
- Accessibility labels use localized month names, ICU plural counts, and the correct zoom action.
- Non-actionable zero-count or no-handler cards do not expose button semantics.
- RTL cards anchor label and count to the directional start edge.
- Long localized month labels and large text remain within the card instead of overflowing.
- High-contrast fallback cards preserve visible label and count contrast.

Zoom activation tests:

- Tapping a year switches to `Months`.
- Tapping a year stores a year zoom anchor without clearing filters or route constraints.
- Tapping a month switches to `Days`.
- Tapping a month stores a month zoom anchor without clearing filters or route constraints.
- Resolving a zoom anchor keeps person, tag, place, favorite, album, space, archive, trash, locked, and text-search constraints.
- Manually switching modes clears pending zoom anchors unless the route explicitly preserves them for a matching target.
- Zoom anchors do not persist across cold app launch.
- Route changes do not leak stale zoom anchors into unrelated timelines.

Photos route tests:

- Main Photos app bar replaces `FilterIconButton` with the grouping selector.
- The bottom search entry still opens the search/filter sheet.
- Browsing filter categories remains reachable after `FilterIconButton` is removed.
- Active filters remain visible in `PhotosFilterSubheader`.
- No temporal chip appears after year zoom activation.
- No temporal chip appears after month zoom activation.
- Clearing an explicit temporal chip reloads broader buckets.
- Active non-time filters reduce the years/months shown.
- Empty filtered results show the existing empty state.
- Full flow coverage: `Years -> tap year -> Months -> tap month -> Days`, plus a separate explicit temporal filter chip clear path.

Route adoption tests:

- Person timelines show only years/months containing that person.
- Album timelines show only years/months containing album assets.
- Shared-space timelines respect space membership and permissions.
- Favorites, archive, trash, locked, and video timelines preserve their route constraints.
- Non-Photos routes render the selector in an app-bar/header slot or top-of-content row without adding a bottom floating control.
- Cover-photo selection opens in `Days` or hides overview modes so assets remain selectable.
- Read-only routes do not expose invalid selection or edit affordances.

Repository/provider tests:

- Year and month overview counts match the assets returned by day mode under the same filters.
- Representative assets respect visibility, permissions, stacks, shared spaces, albums, archive/trash/locked state, and current route filters.
- December 31 and January 1 assets fall into the correct year buckets.
- Leap-day assets appear in the correct month/day scope.
- Assets whose local capture date differs from UTC use existing mobile timeline date semantics.
- In-flight bucket or representative requests are ignored when grouping, filters, route, or auth context changes.
- Very large bucket lists do not issue unbounded representative-asset queries.
- Scrubber labels and scroll targets match the active grouping mode when the scrubber remains visible in overview modes.

## Edge Cases

- No assets for the current route.
- No assets after filters are applied.
- A single year, month, or day bucket.
- A year/month bucket whose representative asset is deleted while visible.
- Active text search plus year/month zoom activation.
- Active person/place/tag filters plus year/month zoom activation.
- Switching from anchored `Months` back to `Years`.
- Clearing scope while scrolled deep in the timeline.
- App relaunch preserves the last grouping mode where existing behavior does but drops pending zoom anchors.
- Large text causing segmented labels to crowd.
- Long localized month labels and singular/plural photo counts.
- Landscape phones and tablets.
- Foldables or unusually narrow app widths.
- RTL locales and mixed-direction month labels.
- Multi-select mode entered from day mode after visiting overview modes.
- Asset viewer opened from day mode after zoom activation and then closed.
- Filter sheet open while grouping changes through Settings.
- Bottom navigation hidden while filter sheet is open.
- Offline or slow thumbnail loading.

## Open Questions Resolved

- The mobile selector replaces the top app-bar filter/search action rather than sitting beside it.
- No additional top-right search/filter icon is added.
- Search remains available through the existing bottom search affordance.
- Years and Months use compact overview cards.
- Days remains the existing detailed timeline.
- Zoom activation matches the web model.
- The design applies through the shared mobile `Timeline`, with cover-photo and picker flows guarded to day mode.
