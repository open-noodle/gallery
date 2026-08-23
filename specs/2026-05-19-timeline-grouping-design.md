# Timeline Grouping Design

> Update: The zoom-navigation follow-up spec from 2026-05-25 supersedes this document's original date-filter activation model. Bucket card activation now changes display grouping and scroll anchor only; explicit date filters remain the only source of temporal narrowing and temporal chips.

## Problem

Large photo timelines are hard to scan when every surface starts near the detailed thumbnail level. A person, tag, album, space, or filtered library can contain tens of thousands of assets, forcing users to scroll through dense day groups to reach an older year or month.

Discussion #387 proposes a Photos-style compressed timeline with `Years`, `Months`, and detailed photos. The key requirement is that this works across timeline-style photo surfaces, not only the main `/photos` page.

## Goals

Add a shared timeline grouping mode:

- `year` shows one representative photo card per matching year.
- `month` shows one representative photo card per matching month.
- `day` shows the current detailed thumbnail timeline with day headers.

The grouping mode is a display density. It is not itself a filter. Clicking a specific year or month card is zoom navigation: it changes grouping resolution and requests a scroll anchor without changing temporal filter state.

The first implementation slice covers web `Timeline`-based surfaces:

- Photos
- Spaces
- Albums
- People detail
- Space person detail
- Tags
- Archive
- Favorites
- Trash
- Locked
- Map timeline panel

`GalleryViewer`-based surfaces are later slices: legacy Search, smart-search result grids, Folders, Memories gallery, individual shared views, and any other flat asset grid that does not use `TimelineManager`.

Mobile parity is a later slice. The design should still align with the existing mobile `GroupAssetsBy` concept so web and mobile can converge on the same vocabulary.

## User Experience

The timeline has a grouping control with `Years`, `Months`, and `Days`.

On desktop, the control lives in the page toolbar/header area, near active filter chips and other view controls. On mobile or coarse-pointer layouts, it floats near the bottom of the timeline, above navigation and selection affordances.

Year and month modes render representative photo cards:

- Large date label, such as `2015` or `Aug. 2015`.
- One representative asset image per card.
- Secondary count badge, such as `438 photos`.
- The cards are photo-forward and visually strong, while surrounding controls stay quiet and utilitarian.

Day mode preserves the current detailed thumbnail timeline behavior: day headers, justified thumbnails, scrubber behavior, selection, asset viewer navigation, and keyboard navigation should continue to work.

Card clicks move the user to the next grouping density without updating temporal filter state:

- Clicking `2015` in `Years` switches grouping to `Months` and anchors to that year.
- Clicking `Aug. 2015` in `Months` switches grouping to `Days` and anchors to that month.
- No temporal chip is created. Clearing explicit temporal filters remains available only for date filters the user set through filter UI.

In day mode, day headers keep their current selection behavior. Clicking a day does not introduce another detail mode.

## FilterPanel Behavior

Filters and grouping are separate axes:

- FilterPanel state determines which assets are eligible.
- Grouping determines how eligible assets are displayed.

Filter changes flow into timeline bucket requests. For example, selecting a person changes the bucket request to include `personIds`, so the timeline only shows years, months, or days containing that person.

Timeline card clicks leave temporal filter state untouched. On pages with a FilterPanel, the selected year/month fields remain unchanged after bucket activation. On pages without a full FilterPanel, bucket activation still must not surface a clearable temporal chip.

The FilterPanel remains the visible source of truth for explicit temporal narrowing. The grouping control does not replace the temporal filter UI; it provides a faster visual way to change display resolution and scroll position.

## Server API

Add a bucket granularity parameter to timeline endpoints:

- `GET /timeline/buckets?bucketSize=year|month|day`
- `GET /timeline/bucket?bucketSize=year|month|day&timeBucket=...`

`bucketSize` defaults to the current month behavior for compatibility.

`/timeline/buckets` returns bucket metadata for the selected granularity:

- `timeBucket`: start date of the bucket as an ISO-compatible date string.
- `count`: number of matching assets in the bucket.
- `representativeAssetId`: asset id used for the card thumbnail in year/month modes.
- `representativeThumbhash`: optional placeholder data when available.
- `representativeRatio`: optional aspect ratio when available.

Representative assets must respect the same visibility, permission, ownership, stack, shared-space, partner, tag, person, location, favorite, trash, rating, media type, and temporal filters as the count query. If a bucket contains only videos, the representative asset can be a video thumbnail.

`/timeline/bucket` returns assets for one selected bucket at the requested granularity. It uses the same filter contract as `/timeline/buckets`. Day mode can load day-sized buckets; the web client may still prefetch adjacent buckets to avoid excessive request churn while scrolling.

Server date grouping must use the existing local timeline semantics. The current month grouping is based on `localDateTime` truncated in UTC-compatible form; year and day grouping should use the same source and time-zone assumptions so bucket counts match the assets returned for those buckets.

## Web Architecture

Introduce a shared web type:

```ts
type TimelineGrouping = 'year' | 'month' | 'day';
```

`TimelineManagerOptions` should include the selected grouping and the current temporal filter bounds. Timeline options continue to carry person, tag, location, rating, favorite, archive, trash, stack, space, album, partner, and shared-space filters.

`TimelineManager` should stop exposing month-specific concepts as the primary public model. Today it assumes:

- outer segments are months
- inner groups are days
- scrubber segments are months

The grouping-aware model should represent timeline buckets generically. A bucket has a granularity, date key, count, height, top position, representative asset metadata, and loaded state. Day mode can preserve existing `TimelineMonth` and `TimelineDay` internals during the first refactor if the public surface is moving toward generic buckets.

Year and month modes render card buckets instead of justified thumbnail groups. They should not load every asset in the bucket to show the card. They only need bucket metadata plus representative image information.

Day mode keeps the existing detailed behavior and is the compatibility baseline. Existing asset update, websocket, stack, delete, archive, favorite, and selection flows must continue to update or remove assets from the active timeline.

## UI Components

Add a reusable timeline grouping control component with three states: `Years`, `Months`, and `Days`.

Desktop placement:

- Render in the page toolbar/header area.
- Place near active filter chips when the page has filters.
- Avoid overlaying timeline content or the scrubber.

Mobile/touch placement:

- Render as a floating segmented control near the bottom of the timeline.
- Keep it above bottom navigation and below content whenever possible.
- Hide, disable, or move it when selection mode or asset viewer overlays would conflict.

Add a representative timeline card component for year and month buckets:

- Stable dimensions so card labels and thumbnails do not shift layout.
- One large date label.
- Optional photo count badge.
- Uses existing thumbnail delivery paths for the representative asset.
- Accessible button semantics and keyboard activation.
- Loading and error states that degrade to a neutral card with date and count.

The visual direction is quiet photo-native utility: restrained controls, strong photo cards, large readable date typography, and visible filter chips. The card imagery carries the emotional weight; the surrounding interface should remain dense enough for repeated use.

## Route Adoption

The first slice should wire grouping into the existing `Timeline` component and then adopt it wherever `Timeline` is already used.

Pages that already share `TimelineManager` should not each invent their own grouping logic. Route-specific work should be limited to:

- passing grouping-aware options
- placing the desktop control in the local toolbar/header
- preserving explicit temporal chips where the page does not have a FilterPanel
- handling route-specific empty states and selection bars

Photos and Spaces must keep the existing FilterPanel synchronized for explicit date filters. Albums, People, Tags, Archive, Favorites, Trash, Locked, and Map timeline panel should use explicit temporal filter state only when the user sets a date filter; bucket activation remains grouping-and-anchor navigation.

## Performance

The first slice must use server-side bucket granularity. Client-side merging of month buckets into years is not enough because it keeps large timelines coupled to month-level data and weakens representative card selection.

Year and month views should request bucket metadata only, not all assets. Switching from year to month or month to day should issue new bucket requests at the new grouping resolution while preserving the same explicit filters and route constraints.

Representative asset lookup should be included in the bucket query or resolved in a bounded follow-up path. It must not issue one unbounded asset query per bucket.

The current month index supports month bucketing. Year and day grouping may need query tuning or indexes after measuring generated SQL. The first implementation should include repository-level tests and SQL review for the new grouping modes.

## Development Process

Implementation must use test-driven development. For each slice, add the smallest failing tests that define the expected behavior before changing production code. Confirm the new tests fail on the current implementation, then implement the smallest change that makes them pass.

The implementation plan should keep test ownership close to each slice:

- Server/API slice starts with DTO, service, repository, and controller tests for `bucketSize` and representative metadata.
- Web timeline model slice starts with manager tests for grouping transitions, bucket loading, stale request handling, and day-mode compatibility.
- Filter integration slice starts with FilterPanel and active-chip synchronization tests.
- UI slice starts with component tests for card rendering, keyboard activation, responsive placement, and overlay/selection conflicts.
- Route adoption slice starts with route-level smoke tests for the first set of `Timeline` surfaces.

Do not rely on manual screenshots as the only verification for visual behavior. Use component tests for state and accessibility, and use Playwright or route-level browser tests for the main Photos and Spaces flows where the interaction crosses the FilterPanel, timeline cards, routing, and scroll anchoring.

## Testing

Server tests:

- `bucketSize` defaults to month.
- Invalid `bucketSize` is rejected.
- Invalid or mismatched `timeBucket` values are rejected or normalized consistently for the requested bucket size.
- Empty result sets return an empty bucket list and do not throw.
- Year, month, and day bucket counts match filtered assets.
- Bucket boundaries include assets at the start of the bucket and exclude assets at the start of the next bucket.
- Year, month, day, leap-day, and year-boundary assets use the same local timeline semantics as current month bucketing.
- Representative asset metadata respects permissions and filters.
- Representative asset metadata is omitted or falls back cleanly when no representative thumbnail data is available.
- Buckets containing only videos still provide a usable representative thumbnail asset.
- `personIds`, `tagIds`, `spaceId`, `withSharedSpaces`, `withPartners`, `isFavorite`, `isTrashed`, `visibility`, `takenAfter`, and `takenBefore` pass through for all bucket sizes.
- Album buckets preserve album access control and asset ordering semantics.
- Shared-space buckets count assets reachable through direct asset membership and linked libraries without double-counting.
- Partner/shared-space restrictions that currently reject unsupported combinations still reject them for all bucket sizes.
- Stack filtering returns primary stack assets consistently in buckets and bucket asset responses.
- Archive, locked, trash, hidden, and timeline visibility boundaries remain enforced.
- `/timeline/bucket` returns only assets inside the requested bucket granularity.
- `/timeline/bucket` and `/timeline/buckets` agree: every returned asset belongs to one of the counted buckets under the same filters.

Web manager tests:

- Updating grouping requests the correct bucket size.
- Selecting a person/tag/filter reloads only matching buckets.
- Clicking a year card switches to month grouping and anchors without writing temporal filter state.
- Clicking a month card switches to day grouping and anchors without writing temporal filter state.
- Clearing explicit temporal filters reloads broader buckets without losing non-time filters.
- Rapid grouping/filter changes cancel or ignore stale bucket responses.
- Grouping preference initializes consistently on first load and after component remount.
- Browser navigation or route changes do not restore stale temporal anchors as filters.
- Empty bucket lists show the route's existing empty state instead of a blank timeline.
- Representative bucket cards do not load all bucket assets.
- Day mode preserves current detailed timeline behavior.
- Existing websocket, asset update, delete, archive, favorite, stack, and trash flows still update the active day timeline.
- Day-mode range selection and group selection still work after visiting year/month modes.

Component and route tests:

- Grouping control renders in desktop toolbar placement.
- Grouping control renders as floating mobile/touch placement.
- Selection mode and asset viewer overlays do not leave the floating control in an unusable position.
- Representative card renders date, count, thumbnail, loading state, and fallback state.
- Representative card is keyboard reachable, screen-reader named, and activates with Enter/Space.
- Representative card labels and counts fit on narrow mobile widths and large desktop widths.
- Missing thumbhash, missing representative ratio, failed thumbnail load, and video thumbnails degrade gracefully.
- The grouping control remains usable with reduced motion, coarse pointer, and keyboard-only navigation.
- Photos and Spaces FilterPanel stay synchronized for explicit date filter changes and remain unchanged after timeline card clicks.
- Active temporal chips appear and clear correctly only for explicit temporal filters on pages without a full FilterPanel.
- Timeline-based routes can mount with each grouping mode.
- Main Photos and Spaces flows have browser-level coverage for `Years -> click year -> Months -> click month -> Days` with no activation-created temporal chip, plus separate explicit temporal filter clearing coverage.

## Edge Cases

The implementation plan should explicitly account for these edge cases:

- No matching assets for the current filters.
- A single bucket with one asset.
- Very large libraries with thousands of year/month/day buckets.
- Assets on December 31 / January 1 boundaries.
- Leap-day assets.
- Assets with local capture dates that differ from UTC dates.
- Inclusive `takenAfter` and `takenBefore` boundaries.
- Active non-time filters when a year or month card is clicked.
- Clearing temporal filters while keeping person, tag, location, media type, rating, favorite, space, album, and visibility filters intact.
- Applying a new person/tag/location filter after a year/month filter is active.
- Removing or changing the representative asset after buckets have loaded.
- Representative asset belongs to a stack, shared space, partner asset, album, archived asset, locked asset, or trashed asset under the current route's permissions.
- Selection mode active when the grouping control or representative cards would otherwise be clickable.
- Asset viewer open while grouping state changes elsewhere.
- In-flight bucket requests resolving after the user changes grouping, filters, route, or auth context.
- Routes without a full FilterPanel still exposing clearable explicit temporal filter state.
- Mobile floating control overlapping bottom navigation, safe-area insets, scrubber, upload banners, or selection bars.
- Desktop control coexisting with long filter-chip rows and narrow sidebars.
- Localized month names and long labels fitting in cards and controls.
- Dark mode, light mode, and high-contrast accessibility settings.
- Reduced-motion users not receiving essential state changes only through animation.

## Implementation Slices

Slice 1: Server/API bucket granularity

- Add `bucketSize` DTO validation.
- Update repository grouping SQL.
- Add representative asset metadata.
- Regenerate OpenAPI and TypeScript SDK.
- Cover server tests.

Slice 2: Web timeline model

- Add `TimelineGrouping`.
- Generalize timeline bucket state.
- Preserve day-mode behavior.
- Add representative bucket loading.
- Cover manager tests.

Slice 3: Filter and navigation integration

- Wire year/month card clicks to grouping changes and scroll anchors only.
- Keep FilterPanel and active chips synchronized for explicit temporal filters.
- Keep explicit temporal clear behavior separate from bucket activation.

Slice 4: UI controls and cards

- Add grouping control.
- Add representative card component.
- Implement desktop and mobile placements.
- Verify layout states.

Slice 5: Route adoption

- Adopt across web `Timeline` surfaces.
- Add route smoke coverage for Photos, Spaces, Albums, People, Tags, Archive, Favorites, Trash, Locked, and Map timeline panel.

Slice 6: Later grid parity

- Bring flat grid surfaces into the grouping model where appropriate.
- The first Slice 6 implementation targets web `GalleryViewer` consumers:
  - legacy Search results at `/search`
  - Folders asset grids
  - Memory viewer gallery grids
  - individual shared-link gallery views
- `GalleryViewer` grouping is a client-side display density over the assets already supplied to the component. This keeps it compatible with flat grids that do not use `TimelineManager` or server bucket APIs yet.
- `year` and `month` modes render representative cards derived from the loaded assets. The representative card uses the first asset in that bucket and must not fetch all additional assets or call route pagination callbacks by itself.
- Clicking a year card switches GalleryViewer grouping to `month` and anchors to the first matching local month bucket without hiding assets outside that year. Clicking a month card switches grouping to `day` and anchors to the first matching local asset or group without hiding assets outside that month.
- Clearing explicit temporal chips remains route-owned behavior and is not created by GalleryViewer bucket activation.
- Manual grouping changes do not create temporal chips and do not mutate route state.
- Selection mode hides the desktop grouping control and disables representative card activation.
- Empty or single-asset grids keep their route-specific empty/asset viewer behavior; grouping controls must not render as orphaned UI when there are no grid assets.
- Smart-search result grids that do not use `GalleryViewer` can be adopted after the shared `GalleryViewer` behavior lands, unless the implementation can reuse the same helper without changing result pagination semantics.

Slice 7: Mobile parity

- Extend the mobile grouping vocabulary to include a persisted-index-safe `year` mode. Existing stored values for `day`, `month`, `auto`, and `none` must keep their current enum indexes.
- Add a `Year` option to the mobile asset-list grouping settings, keep `Month`, `Month + day`, and `Automatic`, and fix the setting write path so selecting any option persists the newly selected value rather than the stale previous value.
- Add year bucket support to all existing mobile timeline bucket query paths:
  - shared main timeline `mergedBucket` custom Drift SQL for remote and local assets
  - generic remote bucket builders
  - local album, remote album, shared-space, video, place, person, and map buckets
  - date formatting and bucket-date parsing helpers
- Preserve existing mobile behavior for `day`, `month`, `auto`, and `none`. `auto` still falls back to day until mobile automatic grouping is redesigned, and `none` remains a flat chunking mode for search-like timelines.
- Add mobile year headers and scrubber behavior that align with the selected bucket size:
  - `year` buckets render year-only headers and keep bulk-selection semantics for that bucket.
  - `month` buckets keep month headers.
  - `day` buckets keep the current month-and-day/day header behavior.
  - the scrubber uses year-only labels and year matching for `year` grouping, while preserving month labels and month matching for `day` and `month`.
  - programmatic scroll-to-date falls back from exact day, to month, to year so year buckets can be targeted.
- Cover the mobile slice with TDD:
  - repository tests for year grouping, year boundaries, local-date fallback, and preserved month/day/none behavior
  - Drift custom SQL tests proving `mergedBucket` supports the appended `year` enum index without changing existing indexes
  - settings widget tests for the new `Year` option and the stale-value persistence regression
  - segment/header tests for `HeaderType.year`, month/day compatibility, empty buckets, and `none`
  - scrubber tests for year labels, year matching, empty/non-time segments, and unchanged month snapping

Mobile Slice 7 does not introduce web-style representative cards or card-driven temporal filtering. The current mobile `Timeline` renders detailed asset grids per bucket. A later mobile interaction slice can add compressed representative cards and zoom anchors across main timeline, spaces, albums, people, tags, search, and route-specific timelines without turning bucket activation into temporal filtering.

## Out of Scope

This design does not change asset sort order semantics beyond existing timeline order.

This design does not replace the FilterPanel.

This design does not add mosaic year/month cards in the first version. A multi-thumbnail mosaic can be a later enhancement after representative single-image cards ship.

This design does not require GalleryViewer or mobile parity in the first implementation slice.
