# Workflow Expansion — Slice 3: Resolver relative date ranges

> Implement test-first. The test cases below are EXACT and authoritative — the
> implementation must make them pass verbatim. Do not change the expected values.

**Goal:** Add deterministic relative-date parsing to the shared
`asset-source-resolver.mjs` so a date-bounded source ("from 2024", "in May 2024",
"yesterday", "last weekend", "last week", "this month", "last month") resolves to a
metadata search with `{ takenAfter, takenBefore }` filters. Unparseable date
phrases → handoff (never guess). Combines with recency. **Recency-only behavior
must stay byte-identical** (no `filters` key), so `add_photos` tests stay green.

**Also (folded in per the resolver clean-source gate decision):** add a
**clean-source gate** so the resolver resolves ONLY when the whole source is
recency/date/generic-noun/filler tokens. If a substantive residual remains
(a place, name, tag — or a type-specific noun like "videos"/"images" until
Slice 4), the source hands off. This prevents over-resolution
("archive my Berlin photos from last weekend" → handoff, NOT "all of last
weekend") and retroactively tightens recency ("newest 20 Berlin photos" →
handoff). The gate errs toward handoff.

**Spec scope:** Slice 3 of the workflow-expansion design.
**Depends on:** Slices 1-2 (contract fixtures, resolver). `searchAssets` filter
fields verified against the DTO: `takenAfter` / `takenBefore` are
`isoDatetimeToDate` (ISO strings).

## Design

Add a pure `parseDateRange(source, now)` to `asset-source-resolver.mjs`:

- Returns `{ takenAfter: Date, takenBefore: Date }` or `undefined`.
- `now` is an injected `Date` (no `Date.now()` inside — caller passes it).
- All bounds are **UTC**; start = `00:00:00.000Z`, end = `23:59:59.999Z`.
- Weeks start **Monday**. "last weekend" = Sat-Sun of the calendar week before
  `now`'s week. "last week" = Mon-Sun of the week before `now`'s week.
- Precedence: month+year before bare year; explicit relatives before nothing.
- A 4-digit year must be `20\d{2}` (so "newest 20" never reads as a year).

Wire into `resolveAssetSource({ client, sourceDescription, signal, now = new Date() })`:

```
const source = clean(sourceDescription);
if (SUBJECTIVE_PATTERN.test(source)) return handoff(...);          // unchanged
const recencyLimit = parseRecencyLimit(source);                    // number | undefined
const dateRange = parseDateRange(source, now);                     // {…} | undefined
if (recencyLimit === undefined && dateRange === undefined) return handoff(...);
const filters = dateRange
  ? { takenAfter: dateRange.takenAfter.toISOString(), takenBefore: dateRange.takenBefore.toISOString() }
  : undefined;
const limit = recencyLimit ?? MAX_RECENCY_LIMIT;                   // date-only: high cap, server enforces session limits
const handleResult = await client.call('searchAssets',
  { mode: 'metadata', order: 'desc', limit, ...(filters ? { filters } : {}), detail: 'handle' },
  { signal });
// …empty / resolved as today.
```

Note: for recency-only, `filters` is `undefined` so **no `filters` key is sent** —
this keeps the existing `add_photos` assertion
`deepEqual(search.args, { mode:'metadata', order:'desc', limit:20, detail:'handle' })`
exactly green. Verify that test still passes unchanged.

## Files

- Edit `agent-runner/src/strict-workflows/asset-source-resolver.mjs`: add
  `parseDateRange`, add `now` param to `resolveAssetSource`, wire filters.
- Edit `agent-runner/src/strict-workflows/asset-source-resolver.test.mjs`: add the
  date cases below.

## TDD — exact tests (add to asset-source-resolver.test.mjs)

Use a fixed `const NOW = new Date('2026-05-15T12:00:00.000Z');` (a **Friday**).
Add a `describe('parseDateRange', ...)` importing `parseDateRange` (export it).
Assert `.toISOString()` of each bound.

| Phrase             | takenAfter (ISO)           | takenBefore (ISO)          |
| ------------------ | -------------------------- | -------------------------- |
| `photos from 2024` | `2024-01-01T00:00:00.000Z` | `2024-12-31T23:59:59.999Z` |
| `in May 2024`      | `2024-05-01T00:00:00.000Z` | `2024-05-31T23:59:59.999Z` |
| `yesterday`        | `2026-05-14T00:00:00.000Z` | `2026-05-14T23:59:59.999Z` |
| `this month`       | `2026-05-01T00:00:00.000Z` | `2026-05-31T23:59:59.999Z` |
| `last month`       | `2026-04-01T00:00:00.000Z` | `2026-04-30T23:59:59.999Z` |
| `last week`        | `2026-05-04T00:00:00.000Z` | `2026-05-10T23:59:59.999Z` |
| `last weekend`     | `2026-05-09T00:00:00.000Z` | `2026-05-10T23:59:59.999Z` |

- [ ] `parseDateRange('sometime recently', NOW)` → `undefined` (unparseable).
- [ ] `parseDateRange('my newest 20 photos', NOW)` → `undefined` (no date phrase;
      recency is handled separately).
- [ ] Each row above (run red first — function not exported yet → green).

### resolveAssetSource integration tests (same file)

- [ ] `resolveAssetSource({ client, sourceDescription: 'my photos from 2024', now: NOW })`
      → `status: 'resolved'`; the recorded `searchAssets` call equals
      `{ mode:'metadata', order:'desc', limit:1000, filters:{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z' }, detail:'handle' }`.
- [ ] `resolveAssetSource({ client, sourceDescription: 'newest 20 photos from 2024', now: NOW })`
      → recorded `searchAssets` call has `limit:20` AND the 2024 `filters` (recency + date combine).
- [ ] `resolveAssetSource({ client, sourceDescription: 'my newest 20 photos' })` (no
      date) → recorded call is `{ mode:'metadata', order:'desc', limit:20, detail:'handle' }`
      with **no `filters` key** (recency-only unchanged).
- [ ] `resolveAssetSource({ client, sourceDescription: 'Berlin photos from last weekend', now: NOW })`
      → still `handoff` (location term present but the resolver only date-binds; it
      does not strip "Berlin" — a location source is not deterministically
      resolvable, so it hands off). NOTE: assert handoff here; the date phrase alone
      does not rescue a location source this slice. _(If implementing chooses to
      resolve it by date, that is a scope change — keep it handoff.)_

## Edge cases (must be covered)

- Bare year only `20\d{2}` (not 2- or 3-digit numbers).
- Month name + year (`May 2024`, `january 2026`).
- yesterday / this month / last month / last week / last weekend exact UTC bounds.
- Unparseable date phrase → undefined → resolver handoff.
- Recency + date combine (limit + filters).
- Recency-only sends NO filters key (add_photos unchanged).
- A location-bearing phrase still hands off (resolver does not invent location
  filters).

## Acceptance

- `parseDateRange` exported + unit-tested to the exact bounds above.
- `resolveAssetSource` accepts `now`, sends date filters as ISO strings, leaves
  recency-only calls unchanged.
- `pnpm --dir agent-runner test` green; `add_photos` suite unchanged.

## Commit

`feat: resolve relative-date asset sources via metadata date filters (slice 3)`
