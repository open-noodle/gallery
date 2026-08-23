# Timeline Grouping — Feedback Fixes (Bug 1 + Bug 2)

**Date:** 2026-06-08
**Status:** Design — awaiting review
**Related:** [2026-05-19-timeline-grouping-design.md](./2026-05-19-timeline-grouping-design.md), [2026-05-22-mobile-timeline-overview-design.md](./2026-05-22-mobile-timeline-overview-design.md) (PR #625)

## Context

Hagen reported two issues against the timeline grouping feature (Year / Month / Day zoom levels, shipped in PR #625):

1. **Drill-up skips a level (mobile).** Drill-down works (Year → Month → Day, via the top control or by tapping tiles). But tapping the grouping control while in Day view jumps straight to Year instead of going up one level to Month.
2. **Year-tile cover thumbnails load slowly.** In Year view, each year tile's cover shows a grey placeholder for several seconds on every visit. Noticeable at 220k assets; expected to be worse at 550k+.

This spec covers the fixes for both. The two bugs are independent and can ship together or separately.

## Bug 1 — Mobile drill-up bounce

### Root cause

The control Hagen taps is the **compact** grouping selector (`TimelineGroupingSelector.compact()` in the timeline app bar, `mobile/lib/presentation/pages/dev/main_timeline.page.dart`). Its tap handler `_selectNext()` (`mobile/lib/presentation/widgets/timeline/timeline_grouping_selector.widget.dart:168`) is a one-directional **wrap** cycle:

```dart
year  => month,
month => day,
day   => year,   // from Day, wraps straight back to Year — the reported bug
```

So from Day, one tap lands on Year. The full 3-segment selector (overview header) and the long-press menu both use direct selection and are correct; only the compact tap cycle is wrong.

### Desired behaviour (ping-pong)

Tapping bounces between the extremes, inverting direction at each end:

```
Year → Month → Day → Month → Year → Month → Day → …
```

(The compact chip labels the bottom level **"Day"**; the web control labels the same level **"All"**. We keep "Day" on mobile — label alignment is out of scope.)

### Design

The ends (Year, Day) are self-correcting — from Year you can only go down, from Day only up. Only the **middle** (Month) is ambiguous, so we need to remember the current direction.

`_TimelineGroupingCompactSelector` becomes a `StatefulWidget` holding an ephemeral `bool _zoomingIn`:

- `year → month`, set `_zoomingIn = true`
- `day → month`, set `_zoomingIn = false`
- `month → _zoomingIn ? day : year` (preserve direction)
- `didUpdateWidget`: when `selected` changes externally to an extreme, sync `_zoomingIn` (Year ⇒ true, Day ⇒ false; Month leaves it unchanged). This covers level changes that arrive via the long-press menu, the full selector, or drill-down by tapping a tile.
- Default `_zoomingIn = true` on first mount.
- The direction `setState` must be **synchronous with the tap** (set it before/around the awaited `onSelected`), since the tap handler is `() => unawaited(_selectNext())`.
- The `switch (selected)` stays **exhaustive** over the enum — `auto`/`none` (which never reach the normalised selector) fold into the `day` branch.

The long-press menu (`_showMenu`) and the full selector are unchanged — they keep direct, explicit selection.

**Verify before shipping:** confirm on-device that the compact app-bar selector (`pages/dev/main_timeline.page.dart`) is the control Hagen tapped — i.e. the beta/Drift timeline is the active path on his build. If he was on the full 3-segment selector instead, the symptom would differ and the fix target changes.

### Testing (TDD)

**RED first:** the existing test `'compact mode cycles to the next grouping on tap'` asserts `Day → Year` — flip it to `Day → Month` so it fails against the current code, then implement the bounce to make it pass.

Rewrite the compact-selector test in
`mobile/test/presentation/widgets/timeline/timeline_grouping_selector_test.dart`:

- Starting at Day, tap → Month (was the buggy `Day → Year` assertion).
- Full bounce sequence across taps: `Year→Month→Day→Month→Year` (and continues `→Month→Day…`).
- Direction is preserved through Month in both directions (the disambiguation case).
- **External level change resets direction:** set level to Day, tap → Month (heading up); then change level externally to Year (long-press menu/full selector), tap → Month (heading down, not Day) — proves `didUpdateWidget` sync.
- Long-press menu still selects directly (regression guard).

### Scope

Mobile only. Single widget + its test. No server/SDK/web changes.

## Bug 2 — Slow year/month covers

### Root cause (web/server)

`AssetRepository.getTimeBuckets` (`server/src/repositories/asset.repository.ts:879`) always computes a per-bucket cover via a `bucket_representatives` CTE:

```sql
SELECT DISTINCT ON (timeBucket) id, thumbhash, ratio
ORDER BY timeBucket, ("localDateTime" AT TIME ZONE 'UTC')::date <order>, fileCreatedAt <order>
```

Problems:

- **Unconditional.** There is no request flag — every `getTimeBuckets` call computes covers, including the default month-scrubber timeline that never displays a cover. Upstream Immich returns only `{ timeBucket, count }`; this CTE is a fork addition that regressed the hot path.
- **Full sort.** The bucket key is a `date_trunc` expression. There is a functional index for **month** (`asset_localDateTime_month_idx`) and one on the date cast (`asset_localDateTime_idx`), but **none for year**, so `DISTINCT ON` over year buckets sorts the entire filtered asset set.
- **Uncached.** The response JSON is dynamic and not HTTP-cached, so it recomputes on every visit. Year buckets are the largest → slowest.

Symptom chain: open Year view → web refetches `getTimeBuckets(bucketSize=year)` on mount (`web/.../timeline-manager.svelte.ts:285`) → server sorts all assets → several seconds → tiles grey until the response lands.

### Mobile reality (investigated — verify-only)

Mobile is **already** lazy and disk-cached, so the cover symptom is a web/server problem:

- Covers load per-visible-segment via `FutureBuilder` (`overview_segment.model.dart:75`) from the local Drift DB.
- Remote thumbnails are disk-cached across launches (iOS `URLSession returnCacheDataElseLoad`; Android OkHttp disk cache).
- Mobile's real O(n)-per-visit scale cost is the `mergedBucket` **count** query (the core watched timeline stream), which is a separate concern and the backbone of the whole timeline.

**Mobile scope = verify-only:** confirm covers stay lazy + disk-cached; do **not** rewrite `mergedBucket` as part of this fix.

### Design (web/server): counts-only buckets + dedicated lazy cover endpoint

The cleanest realisation of "optimize + lazy-load": stop computing covers inside `getTimeBuckets` entirely, and resolve them on demand for visible buckets via a dedicated, index-friendly endpoint.

**Server**

1. **Remove the `bucket_representatives` CTE from `getTimeBuckets`.** It returns counts only — restoring the fast, upstream-shaped hot path. Drop the `representativeAssetId/Thumbhash/Ratio` fields from `TimeBucketsResponseDto`.

   _Design decision — remove vs. gate:_ we **remove** covers from `getTimeBuckets` and serve them only from the dedicated endpoint (single mechanism, clean API). The lower-blast-radius alternative is to keep the fields and add a `withCover` flag (default `false`) so the shape is unchanged; rejected because it leaves two redundant cover paths. The trade-off is that removal touches the e2e API assertions and the web UI mock generator (see Testing).

2. **New cover endpoint** — `getTimeBucketCovers`: takes the standard timeline filters (shared with `TimeBucketDto`) + `bucketSize` + the set of `timeBuckets` to resolve (the client passes only the buckets it currently needs), and returns one representative per requested bucket: `[{ timeBucket, representativeAssetId, representativeThumbhash, representativeRatio }]`. N buckets in → N covers out; the client decides N (its visible window).
3. **Index-friendly per-bucket resolution.** Express each requested bucket as a **range predicate on the indexed date cast** — `(localDateTime AT TIME ZONE 'UTC')::date >= bucketStart AND < bucketEnd` — which `asset_localDateTime_idx` serves, rather than equality on the `date_trunc` bucket key (there is **no year-trunc index**, so equality would force a sort). Resolve all requested buckets in one query via a `LATERAL` over the requested bucket list (a `VALUES` list of `[start,end)` ranges), each doing `ORDER BY (localDateTime AT TIME ZONE 'UTC')::date <order>, fileCreatedAt <order> LIMIT 1`. This **preserves the current representative** (first asset by the existing ordering) so covers do not change vs. today. Validate the plan with `EXPLAIN ANALYZE` on the 220k+ personal instance before/after; add a supporting index as a fork migration (`server/src/schema/migrations-gallery/`) **only if** the benchmark shows the filtered case isn't index-served.
4. **Authorization — identical to `getTimeBuckets`.** The cover endpoint MUST run the same `timeBucketChecks` and build its filters through the same `buildTimeBucketOptions`, and honor shared-link `key`/`slug` scoping, so it can never surface a cover for an asset the caller cannot access (shared-space, visibility, partner, archive boundaries all apply).
5. **Album/space overlay.** The overlay timeline merges two `getTimeBuckets` calls (`mergeTimeBuckets`/`getTimelineAlbumQueryOptions`, preferring the album representative, `album-picker-support.ts`). Covers must be resolved for the **effective overlaid bucket set**: the client requests covers using the same album/space-scoped filters it uses for the overlay (album rep preferred, main as fallback). Define this explicitly when implementing — it's the one place a single cover request isn't sufficient.

**Web**

- Render tiles immediately from counts. Call `getTimeBuckets` without covers. **Initial tile state is a neutral skeleton, not a thumbhash blur** — the thumbhash now arrives _with_ the cover from the new endpoint (it can't be in the counts response without paying for representative selection). The win is that the skeleton clears in a fast, cached, index-served cover fetch for the _visible_ buckets, instead of waiting several seconds on a full sort of _all_ buckets.
- `TimelineRepresentativeBuckets` already windows the visible buckets; have it request covers for visible (+ small overscan) buckets via the new endpoint, store them on the `TimelineBucket`, and render the thumbhash + image when they arrive. **Dedupe in-flight requests, memoize resolved covers** in the `TimelineManager` (instant within a session), and **cancel outstanding cover requests** on grouping/option change (reuse the existing `AbortSignal`). Cover images stay HTTP-cached (`max-age=86400`) across visits.

**Scope boundary (do not touch):** there are two representative mechanisms on web. (a) The timeline overview (year/month tiles) sources representatives from `getTimeBuckets` — **this is what we change**. (b) `gallery-viewer-grouping.ts` derives representatives **client-side from already-loaded assets** (album / search / space viewers) and never calls `getTimeBuckets` for covers — **leave it unchanged**; confirm its spec still passes.

### Data flow (web, after)

1. Mount Year view → `getTimeBuckets(bucketSize=year)` → counts only (fast) → all year tiles render immediately as neutral skeletons.
2. Viewport windowing yields visible bucket keys → `getTimeBucketCovers(filters, year, [keys])` (batched, deduped) → thumbhash + cover image stream into the visible tiles.
3. Scroll → new visible buckets request their covers; in-flight requests are deduped, resolved covers memoized, and requests cancelled on grouping/option change; images are HTTP-cached on re-fetch.

### Testing (TDD)

**Order: write/adjust the failing test first (RED), then implement (GREEN).** Several existing tests encode the _old_ "representatives come from `getTimeBuckets`" behaviour and must be flipped first — they are the RED step, not collateral.

- **Server (medium, real DB) — write first:**
  - `getTimeBuckets` returns `{timeBucket, count}` only — no representative fields.
  - `getTimeBucketCovers` returns the correct representative per bucket, **identical to the old `DISTINCT ON` pick**, for ASC and DESC order, honouring every filter (person / space-person / tag / album / shared-space / visibility / favourite / type / date range / bbox / make / model / rating).
  - **Authorization:** a caller without access to a bucket's would-be representative gets no leak — the endpoint's representative respects shared-space / visibility / partner / `key`+`slug` exactly as `getTimeBuckets` (assert via the access matrix already used for timeline tests).
  - **Edge cases:** empty `timeBuckets[]` → `[]`; unknown/stale bucket key → null/omitted for that key; bucket whose assets are all filtered out / concurrently deleted → null representative; representative with null thumbhash → returned as null (no error).
- **Server (manual):** `EXPLAIN ANALYZE` before/after on the personal instance (220k+), unfiltered **and** a person-filtered year view; record timings in the PR. If the filtered plan isn't index-served, add the fork migration index and re-measure.
- **Web (vitest) — flip these existing specs first, then implement:** `timeline-manager.svelte.spec.ts`, `timeline-grouping.svelte.spec.ts`, `TimelineRepresentativeBuckets.spec.ts`, `TimelineBucketCard.spec.ts`, `Timeline.spec.ts`. New assertions: `getTimeBuckets` is called without covers; covers fetched only for visible buckets; in-flight dedupe + memoization; requests cancelled on grouping/option change; tile renders skeleton before cover, image after. Confirm `gallery-viewer-grouping.spec.ts` still passes unchanged (scope boundary).
- **Web (album overlay):** a test for the merged album/space timeline — covers resolve for the overlaid bucket set (album rep preferred, main fallback).
- **Mobile (verify):** assert covers remain lazy; add tests only if a concrete change is made (none planned).
- **E2E (blast radius from removing the fields):**
  - `e2e/src/specs/server/api/timeline.e2e-spec.ts` currently asserts `getTimeBuckets` returns `representativeAssetId/Thumbhash/Ratio` — update to assert counts-only, and add coverage for `getTimeBucketCovers` (including an access-control case).
  - `e2e/src/ui/generators/timeline/rest-response.{ts,spec.ts}` (Playwright UI mock generator) inlines representatives into bucket responses — update it to serve covers via the new endpoint mock so web UI tests match the new flow.

### OpenAPI / codegen

New endpoint + changed `TimeBucketsResponseDto` ⇒ regenerate the SDK and Dart client (`pnpm -C server sync:open-api` then `make open-api`; the "OpenAPI Clients" CI job runs `generate-open-api.sh` + git-diff, and `make open-api-typescript` alone leaves Dart stale).

## Out of scope

- Mobile `mergedBucket` count-query optimization (separate, higher-risk).
- Mobile chip label "Day" → "All" alignment.
- Server-side caching / materialised cover table (the index-friendly per-bucket query is expected to be fast enough; revisit only if benchmarks say otherwise).

## Rollout / validation

- Benchmark Bug 2 on the personal instance (220k+) and, if needed, a Hagen-scale personal-clone via the RC/clone tooling.
- Ship behind no flag; both are bug fixes. Bug 1 and Bug 2 are independent and can be separate commits/PRs.
