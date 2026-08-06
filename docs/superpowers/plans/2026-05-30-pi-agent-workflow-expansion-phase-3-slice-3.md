# Pi Agent Workflow Expansion (Phase 3) — Slice 3 Implementation Plan

Spec: `docs/superpowers/specs/2026-05-30-pi-agent-workflow-expansion-phase-3-design.md`
Slice: 3 — Recent-upload source token (shared resolver).

## Goal

Teach `asset-source-resolver.mjs` to resolve upload-date phrasing ("uploaded
today", "added this week", "imported yesterday", "recent uploads") to
`createdAfter`/`createdBefore` search filters, distinct from the existing
capture-date `takenAfter`/`takenBefore`. Additive: benefits every source
workflow (archive, tag, untag, create_album_from_source) at once.

## Resolved contracts

- `searchAssets` metadata filters accept `createdAfter`/`createdBefore`
  (upload/import date) and `takenAfter`/`takenBefore` (capture date)
  (`server/src/dtos/agent-tool.dto.ts:319-322`). OQ6: confirm `createdAfter`
  returns the upload-date set live (Slice 4 L3).
- `parseDateRange(source, now)` returns `{ takenAfter: Date, takenBefore: Date }`
  (Date objects), remapped to ISO strings by the caller (`:352-353`).
- The non-entity branch handoffs when `recencyLimit === undefined && dateRange === undefined`
  (`:395`). The entity branch handoffs when the merged `filters` is empty and
  there is no recency bound (`:388`).
- `isCleanSource` clears the residual via `DATE_STRIP`, `RECENCY_PATTERN_G`,
  `GENERIC_NOUNS`, `TYPE_NOUNS`, `STOPWORDS` (`:300-326`). Upload words are NOT
  yet stripped, so an upload source would leave a residual → handoff.

## Implementation (in `asset-source-resolver.mjs`)

### 1. Add upload detection + `parseUploadRange`

```js
const UPLOAD_PHRASE = /\b(?:uploaded|imported|added|recent\s+uploads?|recently\s+(?:uploaded|added|imported))\b/i;
const UPLOAD_STRIP = /\b(?:uploaded|imported|added|uploads?|recently)\b/gi;
const DEFAULT_UPLOAD_WINDOW_DAYS = 30;

// Resolve upload phrasing to an upload-date (created) range, or undefined.
// "uploaded <timeword>" delegates to parseDateRange for the time; "recent
// uploads"/"recently uploaded" with no explicit time uses a default window.
export const parseUploadRange = (source, now = new Date()) => {
  const text = String(source ?? '');
  if (!UPLOAD_PHRASE.test(text)) return undefined;
  const range = parseDateRange(text, now);
  if (range) return { createdAfter: range.takenAfter, createdBefore: range.takenBefore };
  if (/\brecent(?:ly)?\b/i.test(text)) {
    return { createdAfter: new Date(now.getTime() - DEFAULT_UPLOAD_WINDOW_DAYS * DAY_MS), createdBefore: now };
  }
  return undefined; // "photos I uploaded" (no time, not "recent") → unbounded → caller handoffs
};
```

(Place `parseUploadRange` after `parseDateRange`; reuse the module `DAY_MS`.)

### 2. Use it in `resolveAssetSource` (capture vs upload)

Where `dateRange` is computed (~`:339`) and `dateFilters` built (~`:352`):

```js
const uploadRange = parseUploadRange(source, now);
const dateRange = uploadRange ? undefined : parseDateRange(source, now);
// ...
const dateFilters = uploadRange
  ? { createdAfter: uploadRange.createdAfter.toISOString(), createdBefore: uploadRange.createdBefore.toISOString() }
  : dateRange
    ? { takenAfter: dateRange.takenAfter.toISOString(), takenBefore: dateRange.takenBefore.toISOString() }
    : {};
```

Update the non-entity handoff guard (`:395`) so an upload bound counts:

```js
if (recencyLimit === undefined && dateRange === undefined && uploadRange === undefined) {
  return { status: 'handoff', reason: `Source "${source}" needs a count or date range this workflow can bound.` };
}
```

(The entity branch already keys off the merged `filters` being non-empty, so an
upload-dated entity source is bounded by the `createdAfter` filter — verify no
extra change is needed there.)

### 3. Clean-source: consume upload words

In `isCleanSource`'s residual chain (`:318`), add `.replace(UPLOAD_STRIP, ' ')`
so "everything I uploaded today" / "recent uploads" clear to an empty residual
and do not handoff. Order does not matter; add it alongside the other strips.

## TDD steps

### Task 1: failing tests (red) — `asset-source-resolver.test.mjs`

`parseUploadRange` (use a FIXED `now`, e.g. `new Date('2026-05-15T12:00:00Z')`):

- "uploaded today" → `{ createdAfter, createdBefore }` bounding 2026-05-15.
- "added this week" → this-week created range.
- "imported yesterday" → 2026-05-14 created range.
- "uploaded in January 2024" → Jan 2024 created range.
- "recent uploads" / "recently uploaded" → `createdAfter` = now − 30 days,
  `createdBefore` = now (default window).
- "photos I uploaded" (no time, not "recent") → undefined.
- capture phrasing returns undefined: "photos from today", "taken last weekend".

`resolveAssetSource` (mock client so `searchAssets` captures the filters):

- "everything I uploaded today" → `status:'resolved'`; the `searchAssets` call
  carries `createdAfter`/`createdBefore` and NOT `takenAfter`/`takenBefore`.
- "photos from today" (capture) → `searchAssets` carries `takenAfter`/`takenBefore`,
  NOT `createdAfter`.
- Mixed "photos I uploaded today" → upload wins → `createdAfter`/`createdBefore`.
- "recent uploads" → resolved (NOT handoff), `createdAfter` default window.
- "photos I uploaded" (no time) → handoff (no bounded range).

Workflow-level (one is enough): drive `archive_assets` (or reuse its test
harness) with "archive everything I uploaded today" → resolves to a bounded
selection (not handoff), `searchAssets` carries `createdAfter`.

Confirm red (parseUploadRange undefined / filters carry takenAfter).

### Task 2: implement (green)

Add `parseUploadRange`, the resolver remap, the guard update, and the clean-source
strip. Green:

```bash
/opt/homebrew/bin/mise exec -- pnpm --dir agent-runner test
```

### Task 3: L1 check

Run the L1 eval (`--runs 5`). Routing should be unchanged (this is a resolver/slot
change, not a new workflow), so the baseline should still be 100%. If an existing
date-phrasing scenario shifts, re-seed with `--accept` and note why. No new
manifest/matrix changes.

## Edge cases (covered above)

- Upload vs capture phrasing (createdAfter vs takenAfter).
- Mixed phrasing → upload wins.
- "recent uploads" default 30-day window.
- "uploaded" with no time word → handoff (no unbounded upload range).
- Upload words consumed by the clean-source gate (no false handoff).
- Timezone via the existing `dayStart`/`dayEnd` UTC helpers.

## Acceptance

- `parseUploadRange` + resolver tests green; full agent-runner suite green.
- Capture-date routing unchanged; upload phrasing yields `createdAfter`/`createdBefore`.
- L1 baseline still 100% (re-seed only if an intended routing change occurred).

## Commit

`feat(agent): resolve recent-upload sources via createdAfter/createdBefore (phase 3 slice 3)`
