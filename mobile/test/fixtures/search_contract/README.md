# Search contract fixtures

Recorded real-server traffic for the mobile search mode (`specs/2026-10-23-mobile-search-redesign-design.md`,
"Testing approach"). Each file is one request the app may send and the response the real server gave.

- **Written and checked by** `e2e/src/specs/server/api/gallery-search-contract.e2e-spec.ts`. In CI it replays every
  file here against a freshly seeded server and fails on any difference. To re-record after a deliberate server
  change, run it with `SEARCH_CONTRACT_RECORD=1` against an e2e stack built from your branch, then review the diff:

  ```bash
  cd e2e && SEARCH_CONTRACT_RECORD=1 npx vitest --run src/specs/server/api/gallery-search-contract.e2e-spec.ts
  ```

  A new fixture is a new entry in that spec's `fixtureCases`, recorded the same way.

- **Served by** the strict loopback server in the mobile tests (`mobile/test/gallery/search/`), which answers only
  requests that match a fixture.

`POST /search/options` computes only the `dimensions` a request names (`availability` when it names none). The
`dimension-photos-*` fixtures are the calls a client makes when search opens (availability, then one request per list,
in parallel); the `options-*` fixtures ask for every dimension at once, so one file holds the whole answer for a scope
and filter combination.

A response may also carry `stale: true`. The server sends it when it serves a cached unfiltered answer whose data has
changed since, while it computes a fresh one in the background. The fixtures never contain it, because whether it
appears depends on timing. A client shows a stale answer as it would any other and asks again later.

## File format

```jsonc
{
  "actor": "me",                     // whose session sent it: me, partner or member (see the seed in the e2e spec)
  "description": "…",
  "setup": "smart-search",           // optional: smart search was switched on for this request (see below)
  "responseView": "stock-immich",    // optional: the response as another server would give it (see "Scope flows")
  "request": {
    "method": "POST",
    "path": "/api/search/options",   // includes the /api prefix the app's base URL carries
    "query": { "key": "value" },     // optional; a repeated key is an array of its values, in order
    "body": { … },                   // optional; the JSON body exactly as sent (null kept, e.g. tagIds: null)
    "headers": { "x-gallery-app": "search-contract" } // informational, not matched
  },
  "response": { "status": 200, "body": { … } },
  "ids": { "<uuid>": "asset:kyoto-1" } // legend: what each UUID in the file stands for
}
```

Keys are sorted at every level, and files end with a newline, so a re-record only shows real changes.

### Ids and volatile values

Real ids change on every seed, so every UUID is replaced by a stable fake UUID derived from the entity's seed label
(`asset:kyoto-1`, `person:anna`, `space-person:pia`, `album:trip`, `tag:beach`, `space:family`, `user:me`, …). The
`ids` legend names them. Tokens keep their prefix: `person:<uuid>`, `space-person:<uuid>`. A UUID the seed does not
name becomes `unknown-N`, numbered in order of first appearance in that file.

Values the server sets on its own are fixed, keeping their JSON type so the generated Dart client still decodes them:
`createdAt`, `updatedAt` and `profileChangedAt` become `2000-01-01T00:00:00.000Z`; `checksum`, `thumbhash` and
`originalPath` become their own key name, also inside the column arrays of `/timeline/bucket`. Seeded values (taken
dates, places, cameras, ratings, names) are real; the seed sets each asset's upload date (`createdAt`) to its taken date,
so Recently added groups the same on every run. `/server/version` keeps only its `major` (the only part a client
decides on, Gallery 5+ against stock Immich below 5): `minor` and `patch` become `0`.

### Scope flows and fallbacks

The `scope-<screen>-*` fixtures are one screen's search as the app runs it
(`mobile/test/gallery/search/search_core_contract_test.dart`): the per-dimension options when search opens, the same
after two filters (`scope-<screen>-filtered-*`), then the filtered results (`-timeline-buckets` and `-timeline-bucket`,
or `-smart` in query mode). Photos opens on the `dimension-photos-*` set.

The `mode-photos-*` fixtures are Photos search mode as its end-to-end test walks it
(`mobile/test/gallery/search/photos_search_mode_e2e_test.dart`): `@a` picks Anna, When picks 2024, Places picks Kyoto.
Each step is the per-dimension options, `-timeline-buckets`, and one `-timeline-bucket-<month>` per month the grid
opens. The `mode-filters-*` fixtures are the same for the Filters sheet
(`mobile/test/gallery/search/filters_sheet_e2e_test.dart`): Favorites only, then rating 3, then the iPhone 15, then
"receipt" in the photo.

The `screen-*` fixtures are search mode on the album, space, space album and person pages as their end-to-end test
walks it (`mobile/test/gallery/search/scoped_search_albums_spaces_people_e2e_test.dart`): the grouping pill opens
search mode on the `scope-<screen>-*` options (and `screen-<screen>-timeline-buckets`, the unfiltered results, where no
other fixture records them), then one filter: People → Ben on the album, People → Quinn on the space, Places → Madrid on
the space album (its archived photo stays in), Ben added on Anna's page, When → 2024 on Pia's page. Each step is the
per-dimension options, `-timeline-buckets` and one `-timeline-bucket-<month>`. The place, favorites, archive, videos,
recently taken and recently added pages follow the same pattern
(`mobile/test/gallery/search/scoped_search_other_screens_e2e_test.dart`): People → Anna on Lisbon's place page, Places →
Osaka on Favorites (an archived favourite), Archive (never the partner's archived photo in Nice) and Recently added (by
upload date, `orderBy=createdAt`), When → 2024 on Videos, Places → Kyoto on Recently taken. No two fixtures outside the
`older-*` and `stock-*` views record the same request: the stand-in serves the first match, so a duplicate would hide
the other.

The switch-over end-to-end test (`mobile/test/gallery/search/switch_over_e2e_test.dart`) adds `scope-similar-smart`,
the first results page of Similar photos with no other filter, and the stock server's unfiltered results
(`stock-search-*-unfiltered`), which is what search mode asks a stock server for when it opens.

Two fixture sets stand in for servers this stack is not:

- **Older Gallery server** (`older-*`): `"responseView": "older-gallery"` drops `searchOptions` from `/server/features`;
  options then come from `/search/suggestions/filters` and `/search/suggestions?type=city`.
- **Stock Immich server** (`stock-*`): recorded without `x-gallery-app` (empty `headers`), so `/server/version` is the
  Immich base a stock client sees, and `"responseView": "stock-immich"` keeps only upstream's `/server/features` keys.

The view is applied to the real response both when recording and when verifying.

## Matching rule (for the mobile stand-in server)

A request matches a fixture when all of these hold:

1. **Method** is equal.
2. **Path** is equal, without the query string.
3. **Query**: the request's query string parsed into `key → [values in order]` equals the fixture's `query` with a
   scalar read as a one-element list. Keys are unordered; a key present on one side only is a mismatch. No `query`
   means no query string.
4. **Body**: the request body parsed as JSON deep-equals the fixture's `body`. Object key order does not matter; array
   order does; `null` and an absent key are different. No `body` means no request body.

Headers and auth are not matched. A request that matches no fixture must fail the test: the stand-in accepts exactly
what the server was recorded accepting, including the rejected combinations recorded with their real `400`s.

## Limits of the recording stack

The e2e stack runs without machine learning. A text `query` therefore always answers
`400 Smart search is not enabled` (`options-query-ml-disabled`, `smart-query-ml-disabled`). Query mode by reference
photo works: fixtures with `"setup": "smart-search"` were recorded with smart search switched on in the system config
and embeddings seeded into `smart_search`, so `queryAssetId` reads a stored embedding and needs no ML call
(`options-similar`, `smart-similar`). Query mode with text is covered by the server's medium tests instead.
