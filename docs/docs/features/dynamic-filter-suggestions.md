# Dynamic Filter Suggestions

When you apply a filter on the Photos page or inside an album, all other filter panels dynamically update to show only values that exist in the current result set. Every visible option is guaranteed to return results. Sections that could never filter anything in this scope stay out of the way entirely, and sections your current filters happen to have emptied grey out rather than sitting there uselessly.

## How it works

Select any filter value and the other panels narrow immediately:

1. Select **Germany** in Location -- People, Camera, and Tags panels update to show only values present in German photos. Rating and Media Type keep every star and every Photo/Video button visible -- see [What updates](#what-updates) -- but their whole section can hide or grey depending on what your German photos contain.
2. Then select **Canon** in Camera -- the remaining panels narrow further to show only values for Canon photos taken in Germany
3. Every combination is valid -- you can never select a filter that produces zero results

This is called **faceted search** -- the same pattern used by Amazon, eBay, and other search-heavy applications.

## What updates

| Filter     | Options narrow with other filters?  | Whole section hidden when it cannot filter?            |
| ---------- | ----------------------------------- | ------------------------------------------------------ |
| People     | Yes                                 | Yes, unless unnamed faces exist                        |
| Location   | Yes (countries)                     | Yes, when no photo has a location                      |
| Camera     | Yes (makes)                         | Yes, when no photo has camera metadata                 |
| Tags       | Yes                                 | Yes, when nothing is tagged                            |
| Rating     | No -- all five stars always show    | Yes, when nothing is rated                             |
| Media Type | No -- all three buttons always show | Yes, unless you have both photos and videos            |
| Favorites  | n/a -- a toggle, not a list         | Yes, when nothing is favourited                        |
| Albums     | n/a -- a toggle, not a list         | Yes, unless some photos are in albums and some are not |
| Timeline   | Drives filtering                    | Never -- it greys out instead                          |
| Text       | No -- free text                     | Never                                                  |

## Sections you do not see

A filter section only appears when it can change what you are looking at.

- **Hidden.** Nothing in this library, album or space could ever populate the section -- you have no videos, so there is no Media Type section, and no way to filter by something you do not have. The section reappears on its own as soon as the content does.
- **Greyed out, with `(0)`.** The section could normally filter, but the filters you have applied right now leave it nothing to offer. Clear or change a filter and it comes back.

A section holding an active filter is never hidden or greyed, so you can always undo a selection.

The greyed `(0)` state is a web detail. The mobile app's filter sheet has no in-between treatment: a section is either hidden (nothing to offer at all, in this scope) or shown normally -- a section merely emptied by your current filters still renders on mobile rather than dimming.

## Orphaned selections

If you select a value from a list -- a person, country, camera or tag -- and then apply another filter that removes it from the available options, the selected value stays visible but appears **dimmed**. This lets you see why your result set might be empty and undo the selection with one click.

Rating stars and the Photo/Video buttons never dim or disappear individually: their meaning comes from their position, so a gap in the row would be misleading. When they cannot help, the whole section is hidden or greyed instead.

## Debouncing

Filter changes are debounced to avoid excessive server requests:

- **Discrete selections** (clicking a person, country, tag): 50ms debounce to batch rapid clicks
- **Temporal changes** (selecting a year or month): 200ms debounce
- **Clearing all filters**: instant (0ms)

Previous in-flight requests are automatically cancelled when a new filter change occurs.

## Architecture

A single API endpoint (`GET /search/suggestions/filters`) returns all suggestion categories in one round trip. The server runs eight parallel facet queries -- one per category, including the favourites and album-membership presence checks -- each applying all active filters **except its own category**. This exclusion is what makes it faceted: selecting Germany still shows all countries that match the other filters, not just Germany. Album membership is one of those eight but issues two SQL probes internally (one asking whether any matching asset is already filed, one asking whether any is unfiled), so nine queries actually reach the database.

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

Map and Spaces pages can adopt the unified endpoint in the future with minimal changes -- the `suggestionsProvider` interface is generic and the endpoint supports `spaceId` scoping.
