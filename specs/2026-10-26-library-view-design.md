# Photos library view: Both / Personal / Spaces

## Problem

A space shown on the timeline mixes the other members' photos into Photos, next to your own. #1038 asks
how to see only the photos that are in no space (Q2); a comment there proposes a switch like the library
view of Apple Photos.

## Behaviour

A three-way choice on the Photos timeline:

- **Both** (default): the timeline as it is today.
- **Personal**: your own photos that reach none of your spaces, by any path: added to a space, in an
  album linked to a space, or in a library linked to a space. On mobile, photos that only exist on the
  device count as personal.
- **Spaces**: the photos that reach you through a space shown on your timeline, your own included.

Photos that only a partner shares with you are in Both alone.

The choice is only offered while one of your spaces is on your timeline; until then the view counts as Both,
whatever was remembered, so a user who leaves their last space cannot be stuck in a narrowed view.

The view is a mode of the Photos timeline, not a filter. It is remembered (per browser on web, per
device on mobile), and filters narrow within it. A text search, and the mobile similar-photo search,
spans every photo: the choice is hidden while one runs and the view is not sent. It is also hidden while
photos are selected. An empty view shows "no results", never the
invitation to upload or back up. "View in timeline" goes back to Both, as it already clears the filters,
so the photo is there. Memories are not narrowed by the view.

A stack shows where its cover is: a stack whose cover is in a space is under Spaces, even if another
photo of the stack is personal.

Wording: the group label is "Photos shown", and the third option says "Spaces", the product's own name,
rather than "Shared": the Sharing page, the shared-album badge and partner sharing all say "shared", and
none of them is in that view. "All" is avoided because the grouping control next to it already has an
"All". Personal and Spaces carry a one-line description (tooltip) saying which photos they hold, since a
one-word label cannot say that your own photos in a space are under Spaces.

## Server

- `libraryView` (`personal` | `spaces`, optional) on `TimeBucketDto` (`src/gallery/dtos/time-bucket.dto.ts`)
  and on the flat search fields (`GallerySearchFilterExtension`). Without it nothing changes, so stock
  clients are unaffected.
- `withLibraryView` (`src/gallery/utils/library-view.ts`) narrows the asset query and never widens it.
  `personal` reuses `spaceAssetPathBranches` over every space of the caller, whatever its timeline
  setting; `spaces` reuses `sharedWithViewer` over the timeline spaces. The timeline filters
  (`asset.repository.ts`) and `searchAssetBuilderWithLocalTaken` (`asset-filter.ts`) each call it once.
- `checkLibraryView`, called from `resolveViewerScope`, which every timeline and search request goes
  through, answers 400 for a shared link, for a timeline other than the caller's own (`userId`: the
  album and space pages send none), and for `spaces` without `withSharedSpaces`. The album filter of
  the Photos page sends the caller's `userId`, so the view narrows it. The structured (V3) search
  rejects the field like the other flat-only fields.
- Spaces repeats the space predicate the timeline already ORs in, so Postgres builds those hashed
  subplans twice; skipping the OR would add logic to the upstream timeline filters.
- No schema change, no migration.

## Web

`PillGroup` (`web/src/lib/gallery/pill-group/`) is the pill the grouping control already drew, arrow keys
included, and both controls now use it. `LibraryViewControl` sits in the Photos filter toolbar next to the
grouping control. The choice is a persisted store (`gallery-library-view`, unknown values read as Both)
that `photosTimelineConfig` spreads into the timeline options, and into the terms "add all to
collection" replays when there is no text query. Whether a space is on the timeline comes from the
spaces list the sidebar also uses, which the Photos page loads; the control waits for it, and meanwhile
the remembered view applies, so the timeline does not load twice. Showing or hiding a space on the
timeline, leaving one or creating one clears that list, so it is fetched again.

## Mobile

The Photos app bar holds a display menu (`mobile/lib/gallery/photos_view_menu.widget.dart`) in the grouping
chip's slot, no wider, so the logo keeps its size (#1030). The button is neutral: it shows "⋯", or the view
that narrows the timeline (a person, a group). The menu holds two sections, with a check on each current
choice:

- **Photos shown**: Both / Personal / Spaces with their descriptions, only while a space is on the
  timeline. Like the app bar, the menu is out of reach while photos are selected, and in search mode.
- **Timeline grouping**: Years / Months / All.

Filters live in search mode (#1238), whose Filters sheet has Favorites and Not in album.

The menu stays open while choices apply and closes on a tap outside. Every choice reloads the timeline,
which rebuilds the app bar, so the menu is a route of its own rather than an overlay anchored to the
button; it reads app-wide providers only (the Photos route shares its grouping). It sits under the button,
slides over the actions beside it on a narrow screen, and follows the text direction. The view is a store value (`photosLibraryView`, by name).
Whether a space is on the timeline is read from the synced `shared_space_member` rows.

The Photos timeline reads the local database, so the merged timeline queries
(`shared_space_timeline.drift`, and the scoped SQL used with a date scope) take the view as a nullable
`:library_view`: `personal` drops the partner and space arms, and the own photos found in a space, in an
album linked to a space or in a library linked to a space; `spaces` drops the partner, own and
local-only arms. Browsing in search mode applies the view too: the Photos search scope (`searchScopeProvider`'s default,
`PhotosSearchScope`) carries it, and the
browse requests send `libraryView` (`/timeline/buckets`, the metadata search, and `/search/options`, so the
counts match the results); a text or similar-photo search (`/search/smart`) does not. "Archived only" drops the
view with the shared spaces and partners, since archived photos are not on the timeline.

## Known limits

- On web, the filter panel's suggestions (people, places, tags, cameras) span the whole timeline: under
  Personal it can offer a person who is only in space photos, and picking them finds nothing. The year and
  month picker follows the view. Mobile search mode's options follow the view.
- The web choice is per browser, not per account.
- On web, photos added to an album linked to a space stay under Personal until the timeline reloads;
  photos added to a space leave it at once.
- The app may be updated before the server. A server without the field ignores it in search (it strips
  unknown fields), so a filtered search under a view is not narrowed until the server is updated; the
  timeline itself is local and follows the view.

## Upstream files

`server/src/dtos/time-bucket.dto.ts` (one `.extend`), `server/src/repositories/asset.repository.ts` (the
options type and one call), `search.repository.ts` (the options type), `web/src/lib/services/asset.service.ts`
(one call in "View in timeline"), the photos page (the empty state reads `isNarrowed`),
`mobile/lib/domain/models/store.model.dart` (one key, `photosLibraryView`, 90007 in the fork block),
`mobile/lib/infrastructure/repositories/timeline.repository.dart` (one import),
`presentation/pages/dev/main_timeline.page.dart` (the app-bar action), the
parameter threaded through `timeline.service.dart`, and the empty state and "View in timeline".

## Tests

- Server (medium): `timeline-library-view.medium.spec.ts` and `search-library-view.medium.spec.ts`
  share one seeded world (`test/medium/fixtures/library-view.ts`): each view, bucket counts, statistics,
  the album filter of the Photos page, a stack split across views, and the refusals with their messages.
- Web: `PillGroup` through both controls, the persisted store and its parsing, the timeline-space rule,
  the Photos config, the toolbar, the controller (hidden during a text search, an empty view as no
  results, a reload on a space add under a view), "View in timeline".
- Server (medium): `/search/options` counts what `/timeline/buckets` shows under each view, each view
  cached on its own (`gallery-search-options.service.spec.ts`).
- Mobile: every path of every view, unscoped and with a date scope, with bucket counts
  (`timeline_temporal_scope_repository_test.dart`); the Photos search scope under each view, on the options,
  timeline and smart-search requests (`search_scope_params_test.dart`), and the Photos page's search under a
  remembered view, browsing and then a text query, plus the warm-up of that view's options
  (`photos_search_library_view_test.dart`, `search_providers_test.dart`); the remembered choice; the timeline-space rule; the menu (its button and what it announces, a menu that stays open
  while each choice applies and survives the button being rebuilt, no view without a space, no filters,
  360-dp and right-to-left layouts, the selected choice for screen readers); the empty state;
  "View in timeline".
