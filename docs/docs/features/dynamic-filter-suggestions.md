# Dynamic Filter Suggestions

When you apply a filter on the Photos page or inside an album, the other filter panels update to show only values that exist in the current result set. Every option you can see will return something. A section that could never filter anything in this scope is hidden, and a section your current filters have emptied is greyed out.

## How it works

Select any filter value and the other panels narrow immediately:

1. Select **Germany** in Location. The People, Camera and Tags panels now show only values present in German photos. Rating and Media Type keep every star and every Photo/Video button visible (see [What updates](#what-updates)), but their whole section can hide or grey depending on what your German photos contain.
2. Then select **Canon** in Camera. The remaining panels narrow again, to values for Canon photos taken in Germany.
3. Every combination is valid. You can never pick a filter that produces zero results.

The pattern is called **faceted search**. Amazon and eBay do the same thing.

## What updates

| Filter     | Options narrow with other filters? | Whole section hidden when it cannot filter?            |
| ---------- | ---------------------------------- | ------------------------------------------------------ |
| People     | Yes                                | Yes, unless unnamed faces exist                        |
| Location   | Yes (countries)                    | Yes, when no photo has a location                      |
| Camera     | Yes (makes)                        | Yes, when no photo has camera metadata                 |
| Tags       | Yes                                | Yes, when nothing is tagged                            |
| Rating     | No, all five stars always show     | Yes, when nothing is rated                             |
| Media Type | No, all three buttons always show  | Yes, unless you have both photos and videos            |
| Favorites  | n/a, a toggle rather than a list   | Yes, when nothing is favourited                        |
| Albums     | n/a, a toggle rather than a list   | Yes, unless some photos are in albums and some are not |
| Timeline   | Drives filtering                   | Never; it greys out instead                            |
| Text       | No, free text                      | Never                                                  |

## Sections you do not see

A filter section only appears when it can change what you are looking at.

- **Hidden.** Nothing in this library, album or space could ever fill the section. You have no videos, so there is no Media Type section, and no way to filter by something you do not have. The section comes back on its own as soon as the content does.
- **Greyed out, with `(0)`.** The section could normally filter, but the filters you have applied right now leave it nothing to offer. Clear or change a filter and it comes back.

A section holding an active filter is never hidden or greyed, so you can always undo a selection.

The greyed `(0)` state is web only. The mobile filter sheet has no in-between: a section is either hidden, when it has nothing to offer in this scope at all, or shown normally. A section that your current filters merely emptied still renders on mobile instead of dimming.

## Orphaned selections

If you select a value from a list (a person, country, camera or tag) and then apply another filter that removes it from the available options, the value stays visible and turns **dimmed**. You can see why your result set may be empty, and undo the selection with one click.

Rating stars and the Photo/Video buttons never dim or disappear individually: their meaning comes from their position, so a gap in the row would be misleading. When they cannot help, the whole section is hidden or greyed instead.

## Debouncing

Filter changes are debounced so the server is not hit on every click. Clicking a person, country or tag waits 50ms, which batches rapid clicks. Selecting a year or month waits 200ms. Clearing all filters fires at once, with no debounce at all.

An in-flight request is cancelled as soon as a new filter change arrives.

## Architecture

A single API endpoint (`GET /search/suggestions/filters`) returns all suggestion categories in one round trip. The server runs eight facet queries in parallel, one per category, including the favourites and album-membership presence checks. Each query applies all active filters **except its own category**. That exclusion is what makes it faceted: selecting Germany still shows every country that matches the other filters. Album membership is one of the eight, but it issues two SQL probes internally (one asking whether any matching asset is already filed, one asking whether any is unfiled), so nine queries reach the database.

For album detail pages, the same endpoint is scoped with `albumId`. Album scoping cannot be combined with `spaceId` or `withSharedSpaces`, because an album and a space are separate collection boundaries.

### Server flow

```
Client: GET /search/suggestions/filters?country=Germany&withSharedSpaces=true

Server:
  1. Resolve user IDs (own + partners)
  2. Resolve shared space IDs (if withSharedSpaces)
  3. Run 8 facet queries in parallel:
     - Countries: all filters EXCEPT country/city
     - Camera makes: all filters EXCEPT make/model
     - Tags: all filters EXCEPT tagIds
     - People: all filters EXCEPT personIds
     - Ratings: all filters EXCEPT rating
     - Media types: all filters EXCEPT mediaType
     - Favourites: all filters EXCEPT isFavorite
     - Album membership: all filters EXCEPT isInAlbum/isNotInAlbum
       - probe 1: is any matching asset already filed in an album?
       - probe 2: is any matching asset not filed in any album?
  4. Return unified response
```

### Client flow

```
FilterPanel:
  1. User changes a filter (e.g., clicks a country)
  2. Debounce (50ms for discrete, 200ms for temporal)
  3. Call suggestionsProvider(currentFilterState)
  4. Receive response with narrowed suggestions
  5. Update all filter panels
  6. Orphaned list-style selections shown dimmed; sections left with nothing to offer hide or grey
```

### Shared query helper

All eight facet queries share a common `buildFilteredAssetIds` helper that applies user/space scoping, temporal bounds, exif filters, person filters (via EXISTS), tag filters (via EXISTS), media type, and favorites. Each extraction method passes its own filter through `without()` to exclude its category before building the query. Album membership calls the helper once per probe.

## Supported pages

| Page         | Dynamic suggestions? | Notes                                           |
| ------------ | -------------------- | ----------------------------------------------- |
| Photos       | Yes                  | Full cross-filter scoping                       |
| Album detail | Yes                  | Scoped to assets already in the current album   |
| Album picker | Yes                  | Filters the assets available to add to an album |
| Map          | Partial              | Uses individual providers plus active filters   |
| Spaces       | Partial              | Uses individual providers plus active filters   |

Map and Spaces can move to the unified endpoint later with small changes: the `suggestionsProvider` interface is generic, and the endpoint already supports `spaceId` scoping.
