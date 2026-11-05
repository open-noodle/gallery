# Mobile search redesign: results first, filter chips, search on every timeline

**Date:** 2026-10-23
**Status:** Approved design, reviewed against the code 2026-10-23. Ready for `/impl-loop`: the slices are under "Slices", starting at Slice 1.
**Area:** mobile (Flutter), one new fork server endpoint
**Interactive prototype:** [`mockups/2026-10-23-mobile-search-c2.html`](./mockups/2026-10-23-mobile-search-c2.html). Open it in a browser; the right-hand phone (**C2**) is the chosen design. The left-hand phone (C1) was the rejected alternative and is kept for contrast. The prototype uses fake data, and it greys an empty media option, which this design forbids (see Anti-goals).
**Supersedes:** the search and filter UI of [`2026-04-17-mobile-filter-sheet-design.md`](./2026-04-17-mobile-filter-sheet-design.md) and [`2026-07-07-mobile-filter-parity-design.md`](./2026-07-07-mobile-filter-parity-design.md). [`2026-08-04-interdependent-filter-sections-910-design.md`](./2026-08-04-interdependent-filter-sections-910-design.md) still holds and is restated below.

## Why

People who want to find a photo leave the mobile app and use the web filter panel instead, because mobile search feels clumsy and slow. The owner's description of a typical attempt:

- Opening search shows the field and then only People and Places, because the keyboard takes the rest of the screen.
- Places is a flat list of countries that is hard to scan.
- Expanding a section loads the whole list (every person) before anything shows.
- Picking a country shows a spinner and a flicker, then that country's cities.

The causes, in today's code (paths under `mobile/lib/`):

- **Search is a 95%-height sheet over the timeline** (`presentation/widgets/filter_sheet/filter_sheet.widget.dart:28`). Results change in the timeline behind it 800 ms after the last change (`providers/photos_filter/filter_debounce.provider.dart:20`), so you never see results while choosing filters. Filter suggestions re-fetch 250 ms after every change.
- **Pickers download full lists.**
  - The people picker pages through `GET /people?size=1000` before showing anything (`data/server/person.dart:25-50`).
  - Each country tap fetches its cities from `/search/suggestions?type=city` behind a progress bar (`city_suggestions.provider.dart`, `places_picker_country_accordion.widget.dart:169`).
- **Place search only matches countries**, plus the cities of a country already expanded (`places_picker.provider.dart:11-22`).
- **The count is not a count:** it is the number of results loaded so far (`photos_filter_search.provider.dart:86`).
- **Web has more:**
  - `@` people and `#` tags type-ahead (`web/src/lib/managers/cmdk-prefix.ts`).
  - Filename, description and in-photo text search.
  - An exact total.
  - The filter panel inside albums, spaces, space albums and Recently added (`web/src/lib/gallery/filtered-timeline/`).

Success means a user who knows roughly what they want (a person, a time, a tag, a place) finds it on the phone in a few taps, sees results the whole time, and never waits on a spinner to see options.

## Goals

1. Search on mobile shows results while you filter. The photo grid is always on screen, apart from a sheet you opened yourself.
2. People, When, Places and Tags are one tap away. Every other filter is two taps away.
3. Filters react to each other. Each option offered is still possible given the other active filters and the screen's scope, and shows how many photos it would leave.
4. Typing `@` in the field suggests people and `#` suggests tags, as on web. Plain typing suggests people, tags, places and dates together, plus a smart-search line.
5. No filter mobile has today is lost, and every filter in the web filter panel is reachable. The parity tables below are the checklist.
6. The same search works on every screen that shows a timeline of server photos, limited to that screen (see "Search on every timeline").
7. Nothing the user waits on loads a full list.

## Non-goals

- `/` for albums and spaces, `>` for commands, and typed tokens such as `city:` or `from:`. The owner deferred them.
- Web-only extras: lens, owner/contributor and specific-album filters, which web exposes only through the asset viewer's "filter by X" actions and URLs. Also the asset viewer's "filter by X" actions themselves, and filter state in URLs. Deferred, and listed in the parity table so the gap is visible.
- Recent or saved searches.
- Search inside the asset picker (choosing photos to add to an album). Web has it (`asset-picker-filters.svelte.ts`); it is a separate surface.
- Search on device-only albums, trash, the locked folder, the backup and cleanup screens.
- **Search on a partner's page** (`partner_detail.page.dart`). The server searches the caller plus every partner shown in their timeline (`getUserIdsToSearch`, `server/src/services/search.service.ts:738-749`), so a partner's photos are searchable only when that partner is shown in the timeline. The owner accepted that limitation: those photos are searchable from Photos search, and the partner page gets no search of its own.
- **The folder view** (`pages/library/folder/folder.page.dart`) **and the map's bottom-sheet timeline** (`widgets/bottom_sheet/map_bottom_sheet.widget.dart`):
  - Searching a folder needs a folder-path filter.
  - The map sheet's timeline is "photos in the visible map area", which no search endpoint can express.

  Each needs its own server work, so both are excluded from this project.
- Reordering filter sections. (Collapsing and hiding Filters-sheet sections came back after testing; see "The Filters sheet". The old sheet's stored settings are still removed, and the new ones use new store ids.)
- Any change to the web app.

## Anti-goals (fails even if it works)

- **Options that vanish while you pick.** Follow the #910 rule: hide a filter that is empty for the whole scope; grey out one that is empty only because of the current filters.
- **Hiding or greying individual rating stars or photo/video buttons.** That standing decision is in #910 §2.4 and cites the PR #261 bug where stars changed meaning. All five stars and all three media options show whenever those sections show at all.
- **Spinners or flicker when moving between filter levels.** Country → city, year → month and make → model expand at once, from data already loaded.
- **Results and options that disagree.** Results and the options/counts beside them must use the same scope and filters. With a filter the options can't honour, the result count and the option counts would contradict each other on screen.
- **Scope widened or broken by accident.** A space person must never reach the owner-only person endpoints. A request must never combine parameters the server rejects (see "Scope parameters").
- **Breaking stock Immich clients, stock servers or older Gallery servers.** See Constraints.

## The design

The prototype is the visual reference. Where this text and the prototype disagree, this text wins.

### Entering and leaving search mode

- **Photos tab:** the round search button in the bottom nav (`GallerySearchBlob`, `openGallerySearch` in `providers/gallery_nav/gallery_search_action.dart`) switches the Photos screen into **search mode** in place. There is no sheet and no new route.
- **Other timeline screens:** a search button in the timeline's bottom grouping pill (`TimelineGroupingBottomPill`, fork code) enters the same mode on that screen. The pill already shows on every in-scope screen except Recently added, which gains it with its new hunk (see "Layering"); the screen's app bar is not touched. *(Builder's call, made to keep upstream app bars unchanged; see "Layering". An app-bar icon would edit two upstream app-bar files that are identical to upstream today.)*
- **In search mode:**
  - The screen's top app bar and, on Photos, the bottom nav are hidden.
  - In their place, at the top: a back arrow, the search field, and the chip row under them.
  - The grouping pill stays, so Years/Months zoom works on results as it does today.
  - The memory lane is hidden for as long as search mode is open, filters or not (owner's feedback after testing: the grid starts right under the search header).
- **Keyboard:** entering search mode does **not** open the keyboard. Filters and photos show first; tapping the field starts typing. *(Builder's call, matching the prototype.)*
- **Leaving:** ← (and Android back) leaves search mode, clears every filter and the query, and restores the screen and its scroll position. *(Builder's call.)*
- **"View in timeline"** on a search result leaves search mode and jumps to that photo in the screen's normal timeline, as `view_in_timeline_action.dart` does today.

### The search field

- **Plain typing** shows one dropdown under the field, grouped into People, Tags, Places and When. Each group shows the top 3 matches with counts. A last row reads "Photos that look like '…'" and runs a smart search.
- **`@`** narrows the dropdown to people (up to 8) and **`#`** to tags.
- **Picking a suggestion** applies that filter, so its chip fills in, and clears the field.
- **Enter** on plain text runs a smart search. The query shows as a removable token in the field, and sort switches to Relevance (today's rule, `photos_filter.provider.dart:21-35`).
- **Backspace in an empty field** removes the query token.
- **Matching is local:** suggestions are matched on the device against the narrowed option lists already loaded for the chips (see "Where the data comes from"). So with Kyoto active, `@a` only offers people who appear in Kyoto, and there is no request per keystroke.
- **Places** match by city or country name, across all countries ("lis" → Lisbon).
- **Dates:**
  - Digits match years that have photos.
  - "2020s" and "20s" match a decade, as the When picker does today (`when_picker.provider.dart:61-90`).
  - A month name (2+ letters) offers that month in the most recent years that have photos in that month.

### The chip row

Order: **People, When, Places, Tags**, then any active extra filters, then **⚙ Filters**.

- **Labels:**
  - An empty chip shows its name and ▾.
  - An active chip fills in and shows its value: "Anna, Ben", "Jun 2024", "Kyoto", "#beach #food".
- **Active extra filters** (favorites, photo/video, rating, camera, albums, text, date range, archive, untagged) appear between Tags and ⚙ Filters as filled chips with ✕. Tapping ✕ removes that filter.
- **⚙ Filters** shows a badge with the number of active extra filters.
- **Clear all:** while two or more filters are active, a "Clear all" chip ends the row. It clears every filter and the query but stays in search mode.
- **Sections and #910:** each main chip is a section under #910. It is hidden if its dimension is empty for the whole scope, and greyed out (not tappable) if it is empty only because of the current filters.

### The chip sheets

Each main chip opens a bottom sheet over the results, about two thirds of the screen high.

**Live updates.** Selections apply immediately. The results behind the sheet update, and the sheet's button reads "Show N photos" and closes it. Tapping outside also closes the sheet. "Clear" in the sheet header clears that one filter.

**Keyboard.** The sheet's search box doesn't open the keyboard until tapped. When it opens, the sheet grows to stay above it.

- **People:**
  - Selected people on top, with a note that results show photos with all of them.
  - Then a short "Recent" row of the 7 most recently updated people, which replaces today's recent-people strip (`people_picker.provider.dart:75-81`).
  - Then a 4-column grid of compact avatar tiles with names and counts: everyone with nothing typed, otherwise the matches. A sort selector above it orders them by most photographed (the default, the server's order) or A–Z (on the device, unnamed last). The choice is kept on the device (`StoreKey.searchPeopleSort` 90003), so the sheet opens with the one chosen last time.
  - Multi-select means AND.
  - Pets appear like people, as today. An All / People / Pets toggle above the grid, as on the People page, narrows the list on the device; All is the default and the choice is kept (`StoreKey.searchPeopleType` 90005). Each person in `POST /search/options` carries `isPet` (personal people through `person_pet`, space people through `shared_space_person.type`, identity people through their primary profile). The field is optional: an older server sends none, and the app then shows no toggle and everyone. The toggle also hides while the list holds no pet and All is chosen.
  - The alphabet scrubber is dropped; the search box replaces it.
- **When:**
  - A quick-range row on top: Today, This week, This month, This year (today's `quick_ranges_row.widget.dart`).
  - Then years that have matching photos, newest first, each with a count.
  - "▾ months" opens a 12-month grid at once. Months with no photos are greyed.
  - Tapping a year selects the year; tapping a month selects the month. One period at a time, and a custom range (Filters sheet) replaces it.
  - This sheet opens taller than the others.
- **Places:**
  - Countries with counts, folded. Each has a "Cities" caret beside it, like When's "months", that opens its cities from the options already loaded; the row itself selects the whole country. One large country no longer pushes the rest out of reach (owner's feedback after testing).
  - A search that matches cities opens their countries at those cities; one that matches only a country leaves it folded. A selected city's country opens with the sheet.
  - A sort selector, as on People: most photos first (the default, the server's order) or A–Z, applied to the countries and to the cities in each. Kept on the device (`StoreKey.searchPlacesSort` 90004).
  - The search box matches city or country names.
  - Tapping a country selects the whole country; tapping a city selects that city. One place at a time.
  - State is optional.
- **Tags:**
  - Selected tags on top, then a wrap of tag chips with counts and a search box.
  - Multi-select means **any of** the tags while browsing, and **all of** them with a smart query. This is what the two results calls do (`withAnyTagId` in `server/src/repositories/asset.repository.ts` for `/timeline/buckets`, `hasTags` for smart search), and web behaves the same. The sheet's hint says which applies.
  - Choosing a tag turns Untagged off, and the reverse (`photos_filter.provider.dart:58,83-88`).

### The Filters sheet (⚙)

One tall sheet (about 88% high). Sections, top to bottom, with live counts where the data exists:

1. **Favorites only:** a switch.
2. **Photo or video:** All / Photos / Videos.
3. **Rating:** five stars meaning "at least N". All five always show.
4. **Camera:** makes with counts, the first five, then "Show N more" (a selected make past five still shows). Tapping a make opens its models at once, plus "Any <make>".
5. **Albums:** Any / In an album / Not in one.
6. **Text:** three inputs that can all be filled at once, as on web (`text-filter.svelte`): In the photo (OCR), File name, Description. The top field's free text stays smart search.
7. **Date range:** from and to dates (web's custom range in `temporal-picker.svelte`). The builder lays it out in the same style.
8. **Archived only** and **Untagged only:** switches, as mobile has today.

Each section follows #910: it is hidden when empty for the scope and greyed when empty only because of the current filters. A section that is fixed by the screen's scope is hidden (see the scope table).

Tapping a titled section's title collapses or expands it; collapsed with a filter set, the title shows a dot. A cog in the sheet's title row opens a checklist that hides sections; a hidden section still shows while it holds a filter, so it can be changed. Both choices are kept on the device (`StoreKey.searchFiltersCollapsedSections` 90001 and `searchFiltersHiddenSections` 90002, read by `lib/gallery/search/search_filter_prefs.dart`; 143-145 stay retired, and new fork ids go in the 90000 block, far from upstream's numbering).

### Results

- **Header row:** the exact total ("1,204 match") and the sort: Newest, Oldest, plus Relevance while a smart query or similar-photo search is active.
- **Busy state:** until the answer for the current filters arrives, the grid keeps the previous answer (or the screen's own timeline). Meanwhile the header shows a thin progress line and "Searching…" in place of the total, and the grid below the header is dimmed (`searchResultsPendingProvider`). A failed request is not busy: its error shows instead.
- **Grid:** grouped like the screen's normal timeline, honouring the grouping pill, and using the screen's own grid and asset viewer, so selection, opening a photo and multi-select actions work as they do outside search.
- **No matches:** the filtered empty state (`timeline_empty_state.widget.dart`, rewired to the new state) says nothing matches all the filters, and to remove one.

**Known limitations (Favorites).**
- With a smart query, Favorites search keeps smart search's default visibility (everything but locked). A partner's or another space member's archived photo you favourited can therefore appear there. Partner archived favourites already did before this project. Closing it means adding `withOwnArchiveOnly` to smart search, a few lines in each of four upstream search files; deferred.
- The Favorites page's own on-device query still shows another member's archived space photo you favourited. Search leaves it out, following the owner's rule that archive stays the owner's private state.

### Motion

Search uses the app's motion language (`specs/2026-10-23-mobile-motion-language-design.md`, #1236): the same tokens, reduced motion as plain fades, and nothing that blocks a touch. The pieces are generic and live in `lib/gallery/motion/` (`entrance.dart`, `animated_row.dart`, `swap.dart`, `pop.dart`, `fold.dart`); search only places them.

| Moment | Motion |
| --- | --- |
| Opening search mode | The field row fades in while settling down from 6px above. The chips cascade in from the left, 35ms apart, and the results row follows at 120ms. Plays once per opening: `SearchModeNotifier.claimEntrance()`, so a header rebuilt while search stays open does not replay it. Leaving swaps the app bar back at once. |
| A chip comes or goes (an extra filter, Clear all, a #910 chip) | It grows in (width, fade, 85%→100% scale) or shrinks out while the chips beside it slide over (`GalleryAnimatedRow`, matched by key). A leaving chip ignores taps. |
| A chip's label changes ("People" → "Anna") | Cross-fades with a 6px rise, and the chip eases to its new width. |
| The Filters badge count changes | Pops on the bouncy spring. |
| Pressing a chip, a person tile | Squish (94%, 93%) with the 70ms scrolling delay (`GalleryPressable.scrollingDelay`). |
| A search on its way | The dim over the old photos fades in, with a slow diagonal sheen like the timeline skeleton's; the busy line fades in and out. |
| The answer lands | The dim wipes away in the skeleton's diagonal wave from the top-left (520ms), so the new photos ripple in; the total rolls ("Searching…" rises out, the count rises in). Leaving search mode while waiting just drops the dim. |
| Submitting a query, removing it | The token pops into the field on the bouncy spring; removed, it shrinks back into the search icon. |
| Suggestions | The dropdown fades in while dropping 6px from the field; it stays put while the suggestions change. |
| Filters sections, the camera models, When's months, Places' cities | Open down from their title and fold back up (`GalleryFold`); the arrow turns half a turn. "Show more" cameras ease the list longer. |
| Selecting a person | The ring fades in and a tick pops onto the face. |

Reduced motion: no movement or scaling (fades stay), no sheen, the wipe becomes a fade, and sizes change at once. Tests: `test/gallery/search/search_motion_test.dart` looks at a frame mid-movement and at the settled frame for each moment.

**Known limitation (Slice 5).** Some results are not synced to the device, for example a timeline space's photo before its sync lands. Opening one fetches `GET /assets/{id}`, so viewing, sharing and downloading work. But the favourite heart does not refresh after tapping (the write succeeds), and the info sheet has no EXIF. Fixing either needs a hook in the upstream asset viewer, left for a follow-up.

### Similar photos

The existing "View similar photos" action (`presentation/actions/similar_photos.action.dart`) keeps working:

- It opens Photos search mode with a fixed **"Similar to this photo"** token in the field, holding a small thumbnail of the reference photo.
- Photo/video is set to Photos, as `setSimilarTo` does today (`photos_filter.provider.dart:39-40`).
- Results are sorted by relevance. The token is removable, and chips narrow it like any other query.

The search state holds either a text query or a reference photo, never both. *(Builder's call: this keeps the feature without a second results screen.)*

### Search on every timeline

The same search mode, with the same field, chips and sheets, is available on each screen below. Each is limited to its own scope. The scope is fixed by the screen and is not shown as a removable chip. The field's placeholder says where you are ("Search in Japan 2023", "Search in Family", "Search Anna's photos"); on Photos it reads "Search, @person, #tag, place".

| Screen (mobile page) | Today's timeline | Scope |
|---|---|---|
| Photos (`presentation/pages/dev/main_timeline.page.dart`) | own + timeline partners + spaces shown in the timeline | `withSharedSpaces: true`, visibility timeline; browsing also sends the library view, if any (`libraryView`, #1038) |
| Album (`remote_album.page.dart`) | the album | the album |
| Space (`pages/library/spaces/space_detail.page.dart`) | the space | the space; people are space people |
| Space album (`pages/library/spaces/space_album_detail.page.dart`) | the album's space-linked assets, timeline + archive | the album only, never the space too (web `album-timeline.ts`) |
| Person (`person.page.dart`), personal person | that person's faces, owner only | that person, owner only |
| Person, space person (`person_timeline.provider.dart`) | that space person's assets | the space + that space person |
| Place (`place_detail.page.dart`) | city name match, timeline | city |
| Favorites (`favorite.page.dart`) | your favorites: your own (timeline + archive), and those among timeline partners' and every member space's photos (timeline only) | the same: `isFavorite` + `withSharedSpaces` (+ `withPartners` in browse), visibility unset. On a server without `searchFavoritesAcrossSpaces`: your own favorites only, timeline + archive |
| Archive (`archive.page.dart`) | own archived assets | archive visibility, owner only |
| Videos (`video.page.dart`) | videos, timeline | type video, Photos scope |
| Recently added (`recently_added.page.dart`) | own, timeline + archive, by upload date | same as today: own, timeline + archive. Sort Newest/Oldest by upload date; Relevance with a smart query. |
| Recently taken (`recently_taken.page.dart`) | own, timeline | own, timeline |

In every scope:
- A filter the screen fixes is hidden from the chip row and the Filters sheet: Albums on album screens, Favorites on Favorites, Archived only on Archive, Photo or video on Videos, Places on Place.
- On a person page, People shows that person as selected and fixed, and still allows adding more people.

The folder view and the map's bottom-sheet timeline are excluded (see Non-goals).

### Scope parameters (what each request sends)

These rules come from the server's validation and from web's `filtered-timeline/` configs. Web has configs only for Photos, album, space, space album and Recently added; the other rows are new.

- **`withSharedSpaces` and `visibility` are part of the scope, never hardcoded.** Today `SearchApiRepository` always sends `withSharedSpaces: true` and visibility timeline (`infrastructure/repositories/search_api.repository.dart:54,67,91,104`). The server rejects `spaceId` and `albumId` together with `withSharedSpaces` (400, `server/src/services/search.service.ts:174,447-453`), and a hardcoded visibility drops archived assets from Favorites, Space album and Recently added.
- **Album and space album:** `albumIds: [id]` on search and timeline buckets; `albumId` on suggestion endpoints. No `spaceId`, no `withSharedSpaces`.
- **Space:** `spaceId`. Space people are **bare `shared_space_person` ids**, sent as `spacePersonIds` on search and timeline buckets, and as `personIds` (with `spaceId`) on suggestion endpoints. This matches web's `space-timeline.ts:39-44` and `utils/map-filter-config.ts:39`. They are not `space-person:` tokens.
- **Photos:** people are the tokenized `person:<id>` / `space-person:<id>` ids `FilterPerson` already carries, built from the response's `filterId` / `primaryProfile`, never its `id`. The same applies to album scopes, where the response `id` is an identity id (`web/src/lib/utils/album-filter-config.ts:30-31`).
- **Personal person page:** a bare `personIds: [id]` with no `withSharedSpaces`. A `person:` token or `withSharedSpaces` would widen it to every face of that identity (`server/src/gallery/repositories/face-identity.repository.ts:305-338`).
- **Space person page:** `spaceId` + `spacePersonIds: [id]`.
- **Owner-only scopes** (Archive, Recently added, Recently taken): `ownerId` set to the current user.
- **Favorites:** `isFavorite: true` + `withSharedSpaces: true` (+ `withPartners: true` in browse; smart search always searches timeline partners), visibility unset. `withPartners` / `withSharedSpaces` with visibility unset is otherwise a 400 on `/timeline/*` and `/search/options` browse; the server accepts it only with `isFavorite: true` (`server/src/gallery/utils/favorites-scope.ts` `isFavoritesAcrossScope`). The result is my own favourites in timeline + archive, and my favourites (`asset_favorite` rows, never `asset.isFavorite`) among partners' and every member space's photos in timeline visibility only: `withOwnArchiveOnly` admits an archived photo only when the caller owns it, so another owner's archive never comes in. Every member space counts, including ones hidden from the timeline, as on the page. The server declares this with `searchFavoritesAcrossSpaces` in `/server/features`; without it the app sends `isFavorite: true` alone (my own favourites, timeline + archive). Query mode has no such gate: `/search/smart` with visibility unset keeps upstream's `not-locked` default, so a partner's or another member's archived favourite can come in there.
- **Edits and thumbnails** for space people follow the existing mobile rules in `CLAUDE.md`.

### Where the data comes from

Three kinds of data, each from one place:

1. **Results.** Two modes, as on web (`filtered-timeline-controller.svelte.ts:512-580`):
   - In browse mode (no query): `/timeline/buckets` + `/timeline/bucket` with the filters (`server/src/dtos/time-bucket.dto.ts` accepts the full filter set), as web does. **Decided in Slice 1:** `/search/metadata` is not used. It matches ratings exactly, where every fork filter surface treats rating as a minimum (`server/src/utils/asset-filter.ts`).
   - In query mode (text query or reference photo): `/search/smart`.
2. **Year and month counts** (When sheet, grouping):
   - Browse: `/timeline/buckets` already returns a `count` per month for the full filter set.
   - Query: `/search/smart/facets` returns `timeBuckets`.
   - The browse total is the sum of the bucket counts.
3. **Options and counts for People, Places, Tags and Camera.** No existing endpoint is enough:
   - `GET /search/suggestions/filters` returns option lists without counts or cities. It does not accept `visibility`, the text filters, `spacePersonIds` or a smart query. It also resolves Favorites against timeline spaces only, while results use all member spaces.
   - `POST /search/smart/facets` needs a query (400 without one, `search.service.ts:622`) and lacks `visibility`, `ownerId` and the text filters.

   So the design adds **one new fork endpoint** (see "Server addition").

### Server addition

One new fork endpoint returns the narrowed options **with per-option counts**. The path and name are the builder's.

**Accepts:**
- exactly the filter and scope set the results call accepts: people tokens, `spacePersonIds`, tags, untagged, place, camera, rating, type, favorite, in/not-in album, `visibility`, OCR/description/filename text, date range, `albumId(s)`, `spaceId`, `withSharedSpaces`, `ownerId`;
- plus an optional `query` / `queryAssetId` for query mode.

**Returns:**
- people (with their filter tokens and thumbnail profile), tags, countries with their cities, camera makes with their models, each with a count;
- the total;
- the flags #910 uses (has favorites, has rated, has photos/videos, has in-album and not-in-album).

**Performance shape** (decided after the 500k benchmark, `specs/research/2026-10-23-search-options-500k-benchmark.md`). One request that counted every dimension was about 2× slower than today's suggestions request with no filters (2.2–3.1 s against 1.1 s at 500,000 photos). So:
- **Availability first.** A cheap availability request returns the total, the #910 flags and whether each dimension has any options. The chip row renders from it. Budget: under 100 ms at the 95th percentile.
- **Per-dimension requests.** The app asks for each dimension's options and counts (people, tags, places, cameras) separately, in parallel and in the background, as soon as search mode opens. A sheet is usually ready before it is tapped. If one isn't, the sheet shows its options as soon as they arrive, with a skeleton and no spinner.
- **Cached unfiltered state.** The no-filter answer is cached on the server per user and scope, and invalidated when a photo, face or tag changes. Budget: under 100 ms warm. Cold, it is no slower than today's request.
- **Filtered states:** each dimension under 300 ms at the 95th percentile at 500,000 photos.

**Rules:**
- **Scope:** resolved exactly as the results call resolves it, through the existing helpers (`searchScopeV3` / `viewer-scope.ts`, `shared-space-album-scope.ts`), never hand-written unions. Results and counts must agree.
- **Narrowing:** each dimension's options are computed with every other filter applied. Single-choice dimensions (place, camera, rating, type, date) exclude their own filter, so you can switch value. Multi-choice AND dimensions (people, tags) include it, so the list shows who else is in those photos. This is how `smart-facet.repository.ts` already treats cities.
- **Where the code goes:** a new `GallerySearchController` / service in `server/src/gallery/`, registered in `gallery/index.ts`, reusing `filter-suggestion.repository.ts` and `smart-facet.repository.ts`. DTOs go in `gallery/dtos/search.dto.ts`, which stays a leaf module. Nothing grows in the upstream `search.controller.ts`, `search.service.ts` or `dtos/search.dto.ts`.
- **Gates:**
  - `@GenerateSql` on the new repository methods, then `mise sql`.
  - A new viewer-scoped read in `test/medium/specs/utils/rbac-oracle.medium.spec.ts`, which already covers search suggestions and filter facets.
  - Medium tests per scope: Photos, album, space album without `spaceId`, space with space people, archive, owner-only, favorites across member spaces.
  - The OpenAPI workflow in `CLAUDE.md` (TypeScript SDK and Dart client).

## Parity

### Mobile today → after

| Mobile today | After |
|---|---|
| Smart search, similar photos | field; Similar photos token |
| People multi AND, pets, recent people strip | People sheet (Recent row) |
| Alphabet scrubber | dropped, replaced by search |
| Year/month accordion, decade strip and "2020s" parsing, quick ranges | When sheet; decades in the field |
| Country → city cascade | Places sheet |
| Camera make → model | Filters → Camera |
| Tags, Untagged (mutually exclusive) | Tags sheet; Filters → Untagged only |
| Rating, Media type, Favorites, Not in album, Archive | Filters sheet |
| Sort Relevance / Newest / Oldest, Relevance reset on new query | results header |
| Active-filter chips with clear all (`filter_subheader.widget.dart`) | chip row + Clear all |
| Hide/collapse sections | kept: collapse by title, hide with the cog, both remembered on the device |
| Years/Months zoom on results | kept (grouping pill stays) |
| Memories hidden while filtering | kept |
| View in timeline from results | kept (leaves search mode) |

### Web → mobile after

| Web | Mobile after |
|---|---|
| Smart search; filename, description and OCR inputs | field; Filters → Text (all three) |
| `@` people, `#` tags | field |
| People, timeline year/month, custom range, country/city, camera, tags, rating, media, favorites, has/no album | chips and Filters sheet |
| Exact total, sort | results header |
| Filtered timelines on album, space, space album, Recently added | yes, plus person, place, favorites, archive, videos, recently taken |
| Map filter panel | not this round (see Non-goals) |
| Lens, owner/contributor, specific album, asset-viewer "filter by X", filter URLs | deferred (Non-goals) |
| `/`, `>`, typed `key:value` | deferred (Non-goals) |

## Constraints

### Layering (CLAUDE.md "Gallery sits on top of Immich")

New mobile code goes in `mobile/lib/gallery/search/` (the namespace `docs/fork/ownership.yml` declares). Upstream mobile files get hooks only. The fork has already deleted upstream's own mobile search page (`presentation/pages/search/`), so there is no Immich search code to reuse on mobile (rule 4). Upstream files carry these seams:

- **Data swap:** `TimelineRouteScope` (`presentation/widgets/timeline/timeline_route_scope.dart`, fork-only) already wraps every in-scope page except Recently added, and already overrides `timelineServiceProvider`.
  - Give it one optional search-scope argument. When search is active it returns the search-backed service; this generalises today's `buildPhotosTimelineRouteService`.
  - Search state is overridden per route inside that scope, so each screen has its own.
  - Upstream cost: one named argument per page, inside hunks that already differ from upstream.
- **UI swap:** one `else if (searchActive)` arm in `presentation/widgets/timeline/timeline.widget.dart`, beside the existing `SelectionSliverAppBar` arm (around line 806 and the two other `widget.appBar` sites, ideally through one helper). This replaces the page's app bar with the search header in search mode, so no upstream app-bar class is edited.
- **Entry:** the fork grouping pill and the fork Photos search blob. No upstream app bar is touched.
- **Recently added:** `recently_added.page.dart` is identical to upstream today and uses a plain `ProviderScope`. It needs a new hunk of about 15 lines to wrap it in `TimelineRouteScope`. Record it as a deliberate divergence.
- **Similar photos:** `similar_photos.action.dart` (upstream, already diverged) changes its import and call. Net size about the same.
- **`main_timeline.page.dart`** (upstream, +111/−6 today) gets **smaller**: the filter sheet, subheader and load-more footer move into `mobile/lib/gallery/search/`.
- **`routing/router.dart`** gets smaller: the five picker routes go. Regenerate `router.gr.dart`.
- **`providers/infrastructure/timeline.provider.dart`:** its `dependencies:` entry `photosTimelineFilterProvider` is replaced by the new fork provider. Net zero.
- **Do not grow** `models/search/search_filter.model.dart` or `infrastructure/repositories/search_api.repository.dart`, both upstream. New state and calls live in fork files. If the old model is no longer needed, shrink its fork hunk back.

The PR reports each upstream file's diff against the upstream tag, before and after. Expected: smaller in `main_timeline.page.dart` and `router.dart`; a few lines larger in `timeline.widget.dart`; one argument per page; one new hunk in `recently_added.page.dart`.

### Removing the old filter sheet

`presentation/widgets/filter_sheet/**`, `presentation/pages/photos_filter/**` and `providers/photos_filter/**` (68 files, all fork-only) are replaced. These users outside those folders must be moved to the new search state, not left dangling:

- `main_timeline.page.dart`: sheet, subheader and paging
- `memory_lane.provider.dart`: hide memories while filtering
- `timeline.provider.dart`: `dependencies`
- `timeline_empty_state.widget.dart`
- `widgets/photos_filter/filter_subheader.widget.dart`
- `view_in_timeline_action.dart`
- `gallery_search_action.dart` and `gallery_bottom_nav.widget.dart`
- `similar_photos.action.dart`
- `timeline_temporal_filter.provider.dart`: Years/Months zoom of live results

Check `time_buckets`, `timeline_temporal_filter` and `temporal_utils` before deleting: they may be grouping code, not filter-sheet code.

Also:
- Remove the `StoreKey.filterSheetHiddenSections` and `filterSheetCollapsedSections` keys and their stored values.
- Update `docs/fork/ownership.yml` for the deleted and new paths.
- Tests that cover only removed UI go with it.

### Compatibility

The mobile app and server release independently.

- **New app, older Gallery server** (no new endpoint): detect it through `/server/features`, the way `localTakenRange` is detected today, read again each time search mode opens (an app that moves from an older server to a newer one, or whose server is upgraded, must not keep the older answer). Fall back to `/search/suggestions/filters` for options, with no counts, and countries then cities fetched without blocking the sheet. The suggestion lists have no months, so When's months come from `/timeline/buckets` with the same filters. Never error.
- **New app, stock Immich server:** keep today's `serverSupportsSpacesProvider` behaviour (`filter_suggestions.provider.dart:18-22`), which hides the facet sections, and today's `localTakenRange` date encoding (`search_filter.model.dart:34-48`).
- **Stock Immich clients** are unaffected: the server addition is a new fork-only endpoint.

### Strings, performance, tests

- **Strings:** every new string goes in `i18n/gallery/en.json` and the nine maintained locales in the same commit. Run `node i18n/gallery/merge.mjs --check` and `npx prettier --write i18n/`. Remove overlay keys only the old sheet used, after grepping web too.
- **Performance:**
  - A chip sheet opens instantly from data already loaded for the chip row.
  - Field suggestions are local (no request per keystroke).
  - One options request per filter change, debounced. Results are debounced separately. A newer response is never overwritten by an older one.
- **Mobile tests:** run `flutter test`, not just `dart analyze` (generated code: freezed, `router.gr.dart`, the OpenAPI client). Widget tests cover:
  - every scope row's parameters
  - #910 hide/grey
  - stars and media always complete
  - `@`/`#`/place/date suggestions
  - Similar photos
  - leaving search mode
  - the older-server fallback

## Left to the builder

- The new endpoint's path, name and response shape, within the rules above.
- Caching and debounce values.
- Animations for entering and leaving search mode.
- Tablet / NavigationRail layout: same mode, with the rail's search button as the entry.

## Testing approach

Every escaped bug in this area has been a seam: mobile sending a parameter combination the server rejects, or results and options disagreeing. So the end-to-end tests are built around the mobile ↔ server seam, using the real server where CI can run it, and recorded real-server traffic where it can't.

**Search contract fixtures.** `mobile/test/fixtures/search_contract/*.json`. Each file is one request (method, path, query/body) and the real server's response (status and body) for one scope and filter combination. They include the rejected combinations with their real 400 responses.

- **Server side** (`e2e/src/specs/server/api/gallery-search-contract.e2e-spec.ts`):
  - Seeds one library: two users, a partner, a space with space people, albums (one linked into the space), people, pets, tags, places in several countries, two camera makes, ratings, favorites, archived photos, videos, and OCR text. Reuse the seeding helpers in `search.e2e-spec.ts`, `filter-suggestions.e2e-spec.ts` and `search-album-scope.e2e-spec.ts`.
  - Sends every fixture's request to the real server and asserts the response matches the fixture. Ids and timestamps are normalised by fixture-local names.
  - With `SEARCH_CONTRACT_RECORD=1` it rewrites the fixtures instead.
  - A fixture that no longer matches the server fails CI.
- **Mobile side:** a strict loopback HTTP server (`mobile/test/gallery/search/search_contract_server.dart`; the pattern is in `integration_test/test_utils/fake_immich_server.dart`) serves only the fixtures.
  - **Any request that matches no fixture fails the test.** So the stand-in is never more permissive than the server: it accepts exactly what the server was recorded accepting, and rejects the rest.
  - Mobile end-to-end tests run on the host with `flutter test`. They drive real pages, real providers and the real generated OpenAPI Dart client against this server, inside `tester.runAsync`.
  - **No device and no running server are needed, so CI runs them.**

**Why not a live server from mobile tests:** mobile integration tests need a device and are not in CI (`.github/workflows/test.yml`). The contract fixtures give the same guarantee: each pair is proven against the real server in CI, and mobile is proven to send exactly those requests.

**Manual check** (optional, noted in the PR): run the slice on the iOS Simulator or Android Emulator against `mise dev` with the `mobile-emulator` skill.

## Gate

The repo's full gate is CI on the PR, read by head SHA. Locally, before opening the PR, run only the parts that apply to what the slice touched.

**Server:**

```bash
cd server
pnpm test
pnpm test:medium -- <touched specs>
mise //server:check
mise //server:lint-fix
mise //server:format-fix
```

Then:
- `mise sql`; the diff must be committed.
- The OpenAPI workflow in `CLAUDE.md`; the generated SDK and spec diff must be committed.
- The upstream diff report:

  ```bash
  git diff --stat refs/upstream/v3.3.5 -- <upstream files touched>
  ```

**E2E API:** `make e2e-api-dev` against a running `mise dev`, scoped to the touched specs during the inner loop.

**Mobile:** in a worktree, run the codegen steps directly, not through `mise //mobile:codegen`, which resolves to the main checkout. With the Flutter version from `mobile/mise.toml` first on `PATH`:

```bash
dart analyze --fatal-infos lib test
dart format --set-exit-if-changed <lib files>
flutter test <touched dirs>
```

Before the PR, run the full `flutter test`.

**Always:**

```bash
node i18n/gallery/merge.mjs --check
npx prettier --check i18n/
make spec-citation-check
make commit-autolink-check
```

## Slices

Each slice merges to `main` on its own. `main` must keep working between slices: the new search mode stays behind a temporary preview setting until Slice 5 switches it on and removes the old filter sheet. Earlier slices are the baseline for later ones.

### Slice 1 — Server: search options with counts

**Goal:** the new fork endpoint from "Server addition", plus a `/server/features` flag mobile can detect.

**Touches:**
- New: `server/src/gallery/controllers/gallery-search.controller.ts`, `server/src/gallery/services/gallery-search.service.ts`, DTOs in `server/src/gallery/dtos/search.dto.ts`.
- Reused, extended where needed: `server/src/gallery/repositories/filter-suggestion.repository.ts` and `smart-facet.repository.ts`.
- Registration in `server/src/gallery/index.ts`.
- One flag line in the existing fork hunk of `server/src/dtos/server.dto.ts` and its service, next to `localTakenRange` (line 163).
- `test/medium/specs/utils/rbac-oracle.medium.spec.ts`.
- Generated SQL docs, the OpenAPI spec and the SDKs.

**Behaviours:**
- **Places exclude their own filter.** Given Anna has 40 photos in Kyoto and 60 in Berlin, when options are requested with `city=Kyoto`, then the cities include Kyoto (40) and Berlin (60), each with its country, and the total is 40.
- **People include their own filter.** Given `personIds=[Anna]`, then the people options list who else appears in Anna's photos. Each count is the number of photos with Anna **and** that person. Anna appears as selected.
- **Counts match results.** For every scope in the scope table (as far as the server sees it: Photos, album, space album, space, personal person, space person, place, favorites, archive, videos, owner-only), the total equals the number of assets the matching results call returns with the same filters and scope.
- **Archive.** Given `visibility=archive` and `ownerId=me`, options and counts cover only my archived photos.
- **Favorites.** Given `isFavorite=true` with Photos scope, counts include favorites from every space I'm a member of, matching what the results call returns.
- **Text.** Given `ocr=menu`, options and counts cover only photos whose OCR text matches. The same holds for description and filename, and for all three together.
- **Space people.** Given `spaceId` and `spacePersonIds=[p]`, people options are space people (bare ids) and counts are within the space.
- **Space album.** Given `albumId` of an album linked into a space, and no `spaceId`, counts cover exactly that album's assets.
- **Query mode.** Given `query="beach"`, counts are over the smart-search result set. Given neither `query` nor `queryAssetId`, the request is browse mode, not a 400.
- **Rejected combinations.** `albumId` + `withSharedSpaces`, `spaceId` + `withSharedSpaces`, and `spacePersonIds` without `spaceId` each return 400, with the same messages as the existing endpoints.
- **Access.**
  - A non-member's `spaceId` is refused, as on the existing endpoints.
  - An album the caller can't read is refused.
  - A `queryAssetId` the caller can't read is refused, with the same 400 "Not found or no … access" the existing endpoints return.
- **Feature flag.** `GET /server/features` reports the new flag as `true`. Stock clients see no other change.
- **Empty library.** A new user gets empty option lists, total 0 and all #910 flags false, not an error.

**End-to-end test:** `e2e/src/specs/server/api/gallery-search-contract.e2e-spec.ts` (see "Testing approach"):
- seeds the shared library;
- asserts "counts match results" over the whole scope matrix against the real search and timeline endpoints;
- records and verifies the first set of contract fixtures, covering the new endpoint, `/timeline/buckets`, `/search/metadata`, `/search/smart` and the rejected combinations.

**Done when:**
- Unit, medium and e2e tests pass.
- The rbac oracle has the new read and its snapshot was reviewed.
- The upstream diff of `search.controller.ts`, `search.service.ts` and `dtos/search.dto.ts` is unchanged.
- `server.dto.ts` grew by the flag only.

### Slice 2 — Mobile: search core (no UI)

**Goal:** everything the UI needs, in `mobile/lib/gallery/search/`, with no screen changes:

- **The search state**, freezed:
  - filters;
  - a text query **or** a reference photo;
  - the sort.
- **The scope:** a sealed type with one case per row of the scope table. Each case builds the exact parameters in "Scope parameters".
- **A repository** for options, results and buckets. It uses the new endpoint when the flag is present, otherwise the fallback in "Compatibility".
- **A local suggestion matcher** for the field.
- **Providers**, overridable per route.

**Touches:** new files only, plus the generated Dart client. Not `search_filter.model.dart` or `search_api.repository.dart`.

**Behaviours:**
- **Scope parameters.** Each scope sends exactly its parameters and nothing else. For example:
  - Album sends `albumIds: [id]` to results and `albumId` to options, with no `withSharedSpaces` and no `spaceId`.
  - Space sends `spaceId`, with space people as `spacePersonIds` (results) and `personIds` (options).
  - Personal person sends a bare `personIds` without `withSharedSpaces`.
  - Archive sends `visibility: archive` and `ownerId: me`.
  - Favorites, space album and Recently added leave visibility unset, so archived photos are included (Favorites: only my own archived ones).
- **People ids.** In Photos and album scopes, people are sent as the token from `filterId` / `primaryProfile`, never the response `id`.
- **Matcher.** Given options loaded for Kyoto:
  - `@a` returns only matching people from those options.
  - `#` alone returns the top tags.
  - `lis` returns Lisbon with Portugal.
  - `20` returns years starting with 20.
  - `2020s` and `20s` return the 2020s decade.
  - `jun` returns June in the recent years that have June photos.
  - Plain text always ends with the smart-search entry; `@`/`#` text never does.
- **Rules carried over:**
  - A new text query switches sort to Relevance.
  - Choosing a tag clears Untagged, and the reverse.
  - A reference photo sets Photos only and Relevance.
  - Query and reference photo replace each other.
- **Warm-up.** Given the server reports `searchOptions`, when the Photos tab first shows, the app requests the unfiltered availability and every dimension for the Photos scope once, in the background. This fills the server's unfiltered cache, whose cold cost at 500k photos is about 5.8 s (`specs/research/2026-10-23-search-options-500k-benchmark.md`), before search opens. No warm-up is sent to an older or stock server, and a failed warm-up is silent.
- **Loading order.** When search mode opens, availability is requested first. Every dimension is then requested in parallel, and a response marked `stale: true` is shown as-is, then asked again for as long as answers stay stale (after 2 s, then each wait doubled up to 30 s), so a change since the last search (a new favourite, an upload) appears without leaving search. The remembered "empty for the whole screen" answer (#910's hide) is refreshed the same way when it was stale, even after a filter has been picked.
- **Race.** Given an options request for filter A is still in flight when filter B is applied, when A's response arrives after B's, then A's response is dropped.
- **Older Gallery server** (no flag): options come from `/search/suggestions/filters` with no counts, cities from `/search/suggestions?type=city` per country, and When's months from `/timeline/buckets`. Nothing throws.
- **Stock Immich server:** facet options are unavailable (as `serverSupportsSpacesProvider` decides today). Results still work, and dates use the `localTakenRange` encoding when the server lacks it.

**End-to-end test:** `mobile/test/gallery/search/search_core_contract_test.dart`:
- Runs the real providers and the real generated Dart client against the strict contract server.
- For every scope, loads options, applies two filters and loads results.
- Asserts the totals and option lists equal the fixtures.
- An unexpected parameter, such as `withSharedSpaces` on an album, fails the test because no fixture matches.
- Adds fixtures for the fallbacks:
  - **Older Gallery server:** `/server/features` without the flag.
  - **Stock Immich server:** the `/server/version` and `/server/features` a stock client sees. Record them **without** the `x-gallery-app` header; the server then reports the Immich base version (`src/gallery/utils/client-version.ts`).
- For the stock case, the test asserts that no fork endpoint is requested.

### Slice 3 — Mobile: search mode on Photos (preview)

**Goal:** the search mode UI on Photos for the field, the chip row with People, When, Places, Tags and Clear all, the four chip sheets, and the results header. It is reachable only when a temporary **"New search (preview)"** switch in Advanced settings is on. With the switch off, today's sheet still opens.

**Touches:**
- New UI in `mobile/lib/gallery/search/`.
- One `else if (searchActive)` arm in `presentation/widgets/timeline/timeline.widget.dart` (the UI swap seam).
- The `TimelineRouteScope` search argument (data swap), generalising `buildPhotosTimelineRouteService`.
- `gallery_search_action.dart` for the entry.
- The preview switch: a `StoreKey` plus its strings in en and the nine locales. All of it is removed in Slice 5.

**Behaviours:**
- **Entering.** Given the preview is on, when the search button is tapped, then the app bar and bottom nav hide, the field and chip row show, the keyboard stays closed, and the results show the whole timeline with its exact total.
- **Leaving.** When ← or Android back is pressed, then every filter and the query clear, the app bar and nav return, and the timeline is at the scroll position it had before.
- **Field.**
  - Typing `@a` shows only people. Tapping one fills the People chip, clears the field and narrows results.
  - Enter on "beach" shows a query token and sets Relevance. Backspace in the empty field removes the token.
- **People sheet.**
  - It shows the Recent row and the most photographed, with counts.
  - Search filters the list on the device, with no request per keystroke.
  - Selecting two people narrows results to photos with both.
- **When sheet.**
  - Quick ranges select Today, This week, This month and This year.
  - A year selects the year. "▾ months" opens months at once, with empty months greyed.
- **Places sheet.**
  - Countries show folded with no spinner; the "Cities" caret opens one country, and a city search opens its country at the matches.
  - Typing "lis" leaves Lisbon under Portugal.
  - A country selects the whole country.
- **Tags sheet:** multi-select AND, and choosing a tag turns Untagged off.
- **Live sheets.** While a sheet is open, results behind it update, and "Show N photos" shows the exact total.
- **#910.**
  - Given the library has no tags, the Tags chip is hidden.
  - Given Kyoto has no tagged photos, with Kyoto active the Tags chip is greyed and can't be tapped.
- **Clear all** appears with two or more filters, and clears them while staying in search mode.
- **Memories and grouping.** While search mode is open the memory lane is hidden. The grouping pill stays, and Years zoom works on results.

**End-to-end test:** `mobile/test/gallery/search/photos_search_mode_e2e_test.dart`:
- Pumps the real Photos page with the preview on, against the contract server.
- Enters search mode, then picks: `@a` → a person; When → a year; Places → Kyoto.
- Asserts the header total and the grid's asset count equal the fixtures.
- Presses ← and asserts the original timeline and scroll position.
- Record any new fixtures this needs through Slice 1's e2e spec, in the same PR.

### Slice 4 — Mobile: the Filters sheet (preview)

**Goal:** ⚙ Filters and its sections, the active-extra chips with ✕, and the badge.

**Touches:** `mobile/lib/gallery/search/` only.

**Behaviours:**
- **Favorites switch.** Turning it on narrows results, and a "♥ Favorites ✕" chip appears in the row. Tapping ✕ turns it off.
- **Photo or video.**
  - All, Photos and Videos always show.
  - Given every result is a photo, Videos still shows and is not greyed.
- **Rating.**
  - All five stars always show.
  - Given the options report ratings `[5]` only, tapping the fourth star selects "at least 4", not 5.
- **Camera.** A make opens its models at once. "Any Apple" selects the make, and a model selects that model.
- **Albums:** Any, In an album and Not in one. The section is hidden on album scopes.
- **Text.** Filling OCR "menu" and File name "IMG_1" together sends both and narrows results to photos matching both.
- **Date range.** A from/to range replaces a When selection, and the reverse.
- **Archived only, Untagged only.** Each narrows results as today. Untagged clears tags, and the reverse.
- **#910 per section.** A section empty for the scope is hidden. One empty only because of the current filters is greyed.
- **Badge.** The badge counts active extra filters, and each active extra filter shows as its own chip.

**End-to-end test:** `mobile/test/gallery/search/filters_sheet_e2e_test.dart`:
- Against the contract server, opens Filters.
- Turns on Favorites, sets rating 3, picks a camera model, and enters OCR text.
- Asserts each request matches a fixture and the totals match.
- Asserts all five stars and all three media options are present when the fixture's options report a single rating and only photos.

### Slice 5 — Switch over and remove the old filter sheet

**Goal:**
- Search mode becomes the only search, and the preview switch goes.
- Similar photos, View in timeline, the empty state, the memory lane and the timeline provider move to the new state.
- The old filter sheet is deleted.

**Touches:**
- Everything listed in "Removing the old filter sheet".
- `similar_photos.action.dart`.
- `routing/router.dart` (picker routes removed) and the regenerated `router.gr.dart`.
- `providers/infrastructure/timeline.provider.dart` (`dependencies`).
- `docs/fork/ownership.yml`.
- Overlay strings only the old sheet used: grep web and mobile before removing them.
- Any user docs under `docs/docs/` that describe the old mobile filter sheet: grep, and run prettier.

**Behaviours:**
- **Entry.** Tapping the search button always opens search mode. The preview switch and its `StoreKey` are gone.
- **Similar photos.** From the asset viewer, it opens Photos search mode with the "Similar to this photo" token, Photos only and Relevance. Removing the token returns to unfiltered search mode.
- **View in timeline.** From a search result, it leaves search mode and shows that photo in the normal Photos timeline.
- **Empty state.** With no matches, the filtered empty state shows and its action clears the filters.
- **Old settings.** After upgrading, the stored hidden-sections and collapsed-sections settings are removed. Nothing reads them.
- **Router.** The five old picker routes no longer exist, and no code navigates to them.
- **Upstream diff.** `main_timeline.page.dart` and `router.dart` are smaller against the upstream tag than before this project. The PR reports before and after for every upstream file the project has touched so far.

**End-to-end test:** `mobile/test/gallery/search/switch_over_e2e_test.dart`:
- Against the contract server, with no preview switch:
  - the search button opens search mode;
  - Similar photos from a pumped asset viewer opens search mode with the token and the fixture's results;
  - View in timeline from a result leaves search mode.
- Against the stock-server fixtures, search mode opens with no facet chips and results load.

### Slice 6 — Scoped search: albums, spaces, people

**Goal:** search mode on the album, space, space album and person pages, entered from the grouping pill.

**Touches:**
- `TimelineGroupingBottomPill` (fork) for the search button.
- One `search:` argument on `TimelineRouteScope` in each of `remote_album.page.dart`, `space_detail.page.dart`, `space_album_detail.page.dart` and `person.page.dart`, inside hunks that already differ from upstream.

**Behaviours:**
- **Album.**
  - The pill's search button enters search mode with "Search in <album>".
  - The Albums section is hidden.
  - Requests carry the album scope only.
  - ← restores the album.
- **Space.** People options are the space's people, and selecting one sends a bare space-person id.
- **Space album.**
  - The album only, never `spaceId`.
  - Archived photos linked into the album are included, as the album page shows them today.
- **Personal person.**
  - The person is shown as selected and can't be removed. Adding another person narrows to photos with both.
  - No `withSharedSpaces` is sent.
- **Space person:** `spaceId` + `spacePersonIds`.
- **Placeholder.** Each screen's placeholder names the album, space or person.

**End-to-end test:** `mobile/test/gallery/search/scoped_search_albums_spaces_people_e2e_test.dart`:
- Pumps each real page against the contract server, enters through the pill, and applies one filter.
- Asserts every request matches a fixture.
- The rejected combinations are fixtures with 400s, so a leaked `withSharedSpaces` or `spaceId` fails the test.
- Record any new fixtures through Slice 1's e2e spec in the same PR.

### Slice 7 — Scoped search: place, favorites, archive, videos, recently taken, recently added

**Goal:** the remaining rows of the scope table.

**Touches:**
- One `search:` argument in `place_detail.page.dart`, `favorite.page.dart`, `archive.page.dart`, `video.page.dart` and `recently_taken.page.dart`.
- `recently_added.page.dart`: new hunk wrapping it in `TimelineRouteScope` with the grouping pill, about 15 lines. Recorded as a deliberate divergence in the PR.

**Behaviours:**
- **Place.** The Places chip is hidden, and results stay in that city.
- **Favorites.**
  - The Favorites switch is hidden.
  - Results include my archived favorites, and my favorites among timeline partners' and every member space's photos as the timeline shows them, as the page does. Another owner's archived photo never appears in browse mode.
  - On an older server (no `searchFavoritesAcrossSpaces`), my own favorites only.
  - Counts agree with results.
- **Archive.**
  - The Archived switch is hidden.
  - Results, options and counts cover only my archived photos.
  - A partner's archived photos never appear.
- **Videos.** Photo or video is hidden, and results are videos within the Photos scope.
- **Recently taken:** my own photos only, timeline visibility.
- **Recently added.**
  - My own photos, timeline + archive.
  - Newest/Oldest sort by upload date.
  - With a smart query, Relevance.
  - The page looks and scrolls as before when search is not active.

**End-to-end test:** `mobile/test/gallery/search/scoped_search_other_screens_e2e_test.dart`:
- Pumps each real page against the contract server, enters through the pill, and applies one filter.
- Asserts the requests and totals match the fixtures.
- For Archive, asserts the fixture's partner-archived asset is absent.

**Project done when:** all seven slices are merged and CI is green on `main`. The final PR's upstream-diff report shows the expected changes:
- Smaller: `main_timeline.page.dart`, `router.dart`.
- About one argument per page.
- A few lines in `timeline.widget.dart`.
- One new hunk in `recently_added.page.dart`.
- One flag line in `server.dto.ts`.
