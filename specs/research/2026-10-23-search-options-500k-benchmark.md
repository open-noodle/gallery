# `POST /search/options` at 500,000 assets

**Date:** 2026-10-23
**Context:** Slice 1 of [`2026-10-23-mobile-search-redesign-design.md`](../2026-10-23-mobile-search-redesign-design.md).
The owner asked for proof that the new endpoint is not meaningfully slower than what mobile calls today, on a large
library where photos reach the viewer from many spaces.
**Benchmark:** `server/test/perf/search-options.bench.ts` (opt-in, see `server/test/perf/README.md`).

## Setup

- **Machine:** Apple M5 Max, 18 cores, 128 GB, macOS 26.6.2. Docker gets 18 CPUs and 32 GB. Another session's `mise dev`
  stack was running at the same time, so expect some noise.
- **Postgres:** 14.19 with VectorChord 0.4.3 (`ghcr.io/immich-app/postgres:14-vectorchord0.4.3`, the medium-test image),
  started with `shared_buffers=512MB`, `fsync=off`, `synchronous_commit=off` and otherwise the image's configuration.
  One dedicated container, not the dev or e2e stacks.
- **Data**, seeded set-based with `generate_series`, then `ANALYZE`:
  - The owner: 500,000 assets over 12 years. ~10% videos, ~5% archived, ~15% rated, ~7% favourites, ~2% with OCR
    text. EXIF across ~40 countries and ~400 cities (Zipf-skewed), 4 makes and 12 models.
  - 2,000 personal people, identity-linked, with 1.2M faces (Zipf: the top person is in ~51k photos). 300 tags on ~400k
    asset links. 200 albums with ~150k asset links. 50,000 smart-search embeddings in 20 clusters.
  - A timeline partner with 50,000 assets.
  - 9 shared spaces the owner belongs to: the original 100k-asset space plus 8 of ~150k, 80k, 50k, 30k, 20k, 10k, 5k
    and 500 assets, 2–5 contributing members each. Shown in the owner's timeline: 6 (100k, 150k, 50k, 30k, 10k, 500);
    hidden: 3 (80k, 20k, 5k). ~15% of the owner's own assets are also linked into 1–2 spaces, and ~10% of each space's
    assets also into a second space. 50–300 space people per space (Zipf), identity-linked, ~420k more faces.
  - In all: ~1M assets, ~2M faces.
- **Method:** each case is called at the service level (scope resolution plus the same SQL the endpoint runs, no HTTP),
  2 warm-ups then 10 timed runs; the tables give median / p95 in ms. Every browse case also asserts that the options
  total equals the sum of the real `/timeline/buckets` counts for the same request, which covers the shown/hidden
  spaces and the overlap (no double counting).
- **OLD** is what mobile triggers today on every filter change: `GET /search/suggestions/filters`
  (`SearchService.getFilterSuggestions`). Mobile also fetches each country's cities on tap
  (`/search/suggestions?type=city`, ~430 ms here) and pages `GET /people` before the people picker shows; neither is in
  the OLD column.

## Results

All numbers are median / p95 in ms, from the multi-space seed.

- **Lists:** final full run, 10 timed runs per cell.
- **Availability:** re-timed after the hedged probes landed (the last change), 10 runs.
- **Columns:**
  - **OLD:** the whole `getFilterSuggestions` request.
  - **avail:** the availability request.
  - **Lists:** each list asked for alone, cold.
  - **∥:** every list asked for at once in parallel, as a client does when search opens. That is the wall time of the slowest list under contention.
  - **warm:** unfiltered states served from the cache.
- **Unfiltered states** (1, 7, 8, 12, 14) are cold here: a fresh service, so an empty cache.

| # | State | Total | OLD | avail | total | time | people | tags | places | cameras | ratings | media | ∥ | warm ∥ |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Photos, no filters | 837,556 | 2677 / 2848 | 10 / 16 | 1168 / 1398 | 1588 / 1803 | **4860 / 6268** | 1699 / 1771 | **2970 / 3183** | **2893 / 3761** | 736 / 877 | 1665 / 1922 | **5847 / 6489** | 2 / 3 |
| 2 | one top person | 49,467 | 1598 / 1687 | **152 / 156** | 226 / 240 | 261 / 294 | **949 / 1064** | **407 / 442** | 288 / 342 | 278 / 321 | 188 / 206 | 221 / 235 | 1545 / 1689 | – |
| 3 | top person + country | 14,368 | 1611 / 1679 | **165 / 175** | 198 / 219 | 202 / 213 | **449 / 523** | 252 / 266 | **308 / 340** | 243 / 275 | 228 / 300 | 281 / 349 | 1282 / 1729 | – |
| 4 | two tags | 29,002 | 1308 / 1704 | 14 / 17 | 135 / 139 | 148 / 150 | **547 / 555** | 1 / 2 | 226 / 231 | 232 / 260 | 109 / 128 | 148 / 199 | 551 / 585 | – |
| 5 | rating ≥4 + favourites | 2,025 | 116 / 129 | 6 / 8 | 32 / 33 | 32 / 39 | 87 / 103 | 35 / 44 | 33 / 36 | 34 / 39 | 37 / 43 | 32 / 35 | 146 / 157 | – |
| 6 | one year | 69,524 | 657 / 720 | 9 / 16 | 122 / 139 | 1 / 1 | **577 / 605** | 164 / 173 | 279 / 290 | 251 / 259 | 180 / 183 | 123 / 126 | 879 / 937 | – |
| 7 | space (100k) | 100,000 | 4925 / 5085 | **591 / 623** | 369 / 434 | 392 / 447 | 648 / 752 | 469 / 520 | 622 / 724 | 657 / 687 | 494 / 540 | 377 / 396 | 1124 / 1208 | 3 / 3 |
| 8 | archive | 24,921 | – | 3 / 4 | 40 / 69 | 38 / 49 | 108 / 147 | 55 / 69 | 79 / 84 | 68 / 84 | 58 / 72 | 36 / 45 | 242 / 261 | 2 / 3 |
| 9 | OCR text | 1,462 | – | 8 / 9 | 12 / 13 | 13 / 15 | 35 / 38 | 15 / 16 | 17 / 17 | 16 / 17 | 10 / 10 | 13 / 14 | 36 / 39 | – |
| 10 | query: reference photo + person | 5,073 | 1610 / 1758 | **255 / 292** | 193 / 205 | 207 / 227 | 254 / 352 | 214 / 233 | 197 / 209 | 200 / 212 | 195 / 229 | 199 / 316 | 1286 / 1480 | – |
| 11 | Photos + one space person | 16,481 | 1704 / 1939 | **258 / 328** | 112 / 119 | 124 / 146 | 232 / 310 | 133 / 142 | 148 / 165 | 142 / 170 | 112 / 122 | 115 / 120 | 824 / 1091 | – |
| 12 | largest space (150k), no filters | 162,047 | 4747 / 5391 | 15 / 21 | 994 / 1192 | 985 / 1181 | 578 / 736 | 1043 / 1209 | 1191 / 1317 | 1274 / 1398 | 1102 / 1148 | 994 / 1145 | 2197 / 2500 | 2 / 3 |
| 13 | largest space + space person | 17,357 | 2512 / 3516 | **308 / 350** | 115 / 125 | 132 / 142 | **381 / 492** | 266 / 339 | 309 / 1482 | 285 / 361 | 280 / 333 | 171 / 210 | 1170 / 3580 | – |
| 14 | smallest space (500), no filters | 13,054 | 5403 / 9389 | 8 / 11 | 356 / 396 | 336 / 368 | 5 / 10 | 437 / 474 | 565 / 666 | 563 / 889 | 439 / 507 | 340 / 374 | 736 / 911 | 1 / 3 |

**Bold** marks a cell over its budget:

- **Availability:** under 100 ms p95 in every state.
- **Cold unfiltered list:** no slower than OLD's whole request, and the same for ∥.
- **Filtered list:** under 300 ms.

State 14 counts 13,054 assets, not 500: through the overlap, ~12.5k of its assets are also the viewer's own or in other spaces. Every browse state asserted that the total equals the `/timeline/buckets` sum.

Other measurements:

- **Watermark query:** 1 / 1 ms.
- **City list:** mobile's per-country `/search/suggestions?type=city` takes 1023 / 1120 ms.
- **Smart facets:** the old query-mode path takes 1891 / 2024 ms.

### Availability

Availability started at 12 ms (Photos) to 35 s (space). These changes brought it to the column above:

1. **The unnamed-people probe left availability.** It needs every face checked when there are none, and caused the 12–35 s cases. `hasUnnamedPeople` now comes with the people list.
2. **Materialising every filtered or space probe** fixed the token state (11, 3.46 s → 0.30 s), but cost the person states about 250 ms each (state 2: 96 → 338 ms).
3. **The final shape, hedged probes:**
   - Each probe first runs inline under a 60 ms `statement_timeout`, in its own transaction.
   - Only a probe that runs out of time is retried.
   - Probes that read the request's own set retry as one shared statement: that set materialised once (`id`, `type`), each probe an EXISTS over it.
   - A probe whose own filter is set (people under a person filter, places under a country) is materialised on its own.
   - Query mode skips the inline attempt. Its statements share one connection (the candidates temp table), so a timeout per probe would add up.
   - The logger skips a probe's cancellation, which is expected. A one-line hook in `src/utils/database.ts` checks the select alias `search_options_probe`.

Before → after the hedged probes:

| State | Before (ms) | After (ms) |
| --- | ---: | ---: |
| 2 | 338 | 152 |
| 3 | 462 | 165 |
| 7 | 617 | 591 |
| 10 | 1066 | 255 |
| 11 | 303 | 258 |
| 13 | 500 | 308 |

The states over 100 ms are bounded by computing their set once. With no early hit, a LIMIT 1 plan is worse than that: state 13's first space asset took 370 ms inline, while the same set counts in 115 ms.

- **State 7.** This space has no tagged and no album assets, so "no" has to scan all 100k ids. The set itself costs ~400 ms: a seq scan of `asset` with the space path checks, the same work as its `total`.
- **The remaining unfiltered space states.** In the app they are served warm, in 2–3 ms, from the cache.

### What is still over budget, and why

- **Photos, cold unfiltered: people 4.9 s, places 3.0 s, cameras 2.9 s, ∥ 5.8 s vs OLD 2.7 s.**
  - Explained serially, people takes 2.9 s:
    - 1.4 s to scan the Photos set: 837k assets, 475k space-path EXISTS checks for the six shown spaces.
    - 0.5 s of hash joins over 1.5M faces.
    - 0.4 s to sort and dedupe 1.38M (identity, asset) pairs.
  - In parallel, eight lists each scan that set, so they contend: OLD scans it once for all of its lists.
  - The scan is the floor. No index removes it, because nearly every row of `asset` qualifies.
  - `work_mem` 256 MB instead of 64 MB did not help: 5.5 s.
  - A shared single pass over the set (GROUPING SETS) was tried earlier and lost (see below).
  - This is the state the unfiltered cache exists for:
    - It is computed once per user and scope, then served in 1–2 ms.
    - After a change, the previous answer is served `stale` while one background computation refreshes it.
    - So a user meets this cost once, on their first search, not on each open.
- **Filtered people, 450–950 ms** (states 2, 3, 4, 6, 13). The people list counts distinct (identity, asset) pairs over the set's faces. For a 50k-asset set that is ~100k faces plus their identity profiles. OLD's people suggestions read only names, with no counts.
- **Filtered tags and places, 300–400 ms** (states 2, 3). Same shape: an aggregate over the set's 50k assets.
  - State 13's places p95 of 1482 ms is one outlier (median 309): it ran alongside the space-person availability probes.

No index or migration was added. The costs above are the set scans themselves, which an index on the joined tables does not shorten. A covering `asset_face (assetId) INCLUDE (id, deletedAt, isVisible)` was considered for the people joins. The face side of the plan is two hash joins over sequential scans (0.13 s and 0.08 s), so it would save little.

### Earlier variants (single-space seed, state 1, whole request NEW vs OLD 1191 / 1406)

| Variant | Median / p95 (ms) |
| --- | --- |
| One request computing every list in sequence | 6727 / 7423 |
| Lists in parallel on the pool | 2624 / 2755 |
| + space lists over a materialised set | 2218 / 2428 (space state 5302 → 648) |
| + one GROUPING SETS pass for all lists | 3067 / 3414 (dropped) |

These led to the per-dimension shape: a client asks for availability first, then each list on its own, and the unfiltered state is cached.

### Cache and staleness

- **Key:** the unfiltered state is cached in process, per user, scope and dimension (an LRU).
- **Validity:** an entry is valid while the watermark matches. The watermark is the newest `updateId` or audit id of every table the options read, plus Postgres' write counters for the tables with no indexed `updateId`.
- **Counter delay:** on PG14 a connection reports its counters at most every 500 ms. A connection that goes idle keeps them until it next runs a statement. On a busy server pool that is usually under a second.
- **Stale-while-revalidate:**
  - When the watermark moves, the previous answer is served at once with `stale: true`, and one background computation per key refreshes it.
  - A refresh starts at most every `SEARCH_OPTIONS_REFRESH_INTERVAL_MS` = 30 s.
  - An answer older than `SEARCH_OPTIONS_MAX_STALE_MS` = 10 min is never served stale: the request computes it.
- **Own filter only:** a list whose only filter is its own (the tags list under a tag filter) is the unfiltered list, served from the same cache with the selection marked.
