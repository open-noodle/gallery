# Slice 1 — `getMemoryAssetsForPeriod` returns `type` + `duration`

Spec: `docs/plans/2026-07-19-memory-types-tier3-spec.md` §3.5, §6.8, Slice 1.
Foundation for `video_moments` (Slice 2). No new memory type registered here.

## Goal

Make the shared period query return each asset's `type` and `duration`, and accept an optional
`type` filter. Additive in behavior, **not** source-compatible (the new fields are required), so the
four existing fixture factories must be updated in this same slice or `tsc` breaks.

## TDD order

### Step 1 — RED: medium tests

File: `server/test/medium/specs/repositories/asset.repository.spec.ts`, inside the existing
`describe('getMemoryAssetsForPeriod')` (starts line 911).

First extend the local `seedPeriodAsset` helper (line 31) with two optional params, passed straight
through to `ctx.newAsset` (`assetInsert` spreads overrides over its defaults, so both are accepted):

```ts
type = AssetType.Image,
duration = null,
...
type?: AssetType;
duration?: number | null;
```

Then add these four cases:

1. **returns `type` and `duration` on each row** — seed one image (`duration: null`) and one video
   (`duration: 5000`); assert both rows expose the correct `type` and `duration`.
2. **`type: AssetType.Video` returns only videos** — seed 1 image + 2 videos in the same month;
   assert length 2 and every `row.type === AssetType.Video`.
3. **omitting `type` returns both** — same fixture, no `type` option; assert length 3. (Proves the
   filter is opt-in and existing callers are unaffected.)
4. **a video with `duration: null` is still returned** — the band filter is the rule's job, not the
   query's.
5. **an asset exactly on `takenBefore` is included** — seed `localDateTime` exactly equal to
   `takenBefore`; assert it is returned (SQL uses `<=`).

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts`
**Expected red:** cases 1/2/4 fail because `type`/`duration` are `undefined` on the returned rows and
the `type` option is not honored. Capture the failure summary.

### Step 2 — GREEN: repository

File: `server/src/repositories/asset.repository.ts`.

Interfaces (~line 165 and ~line 182):

```ts
export interface MemoryPeriodAsset {
  id: string;
  localDateTime: Date;
  year: number;
  country: string | null;
  city: string | null;
  isFavorite: boolean;
  type: AssetType; // NEW
  duration: number | null; // NEW — milliseconds
}

export interface MemoryPeriodOptions {
  months: number[];
  day?: number;
  favoritesOnly?: boolean;
  type?: AssetType; // NEW
  takenBefore: Date;
}
```

Query (`getMemoryAssetsForPeriod`, line 890) — three edits:

1. Add `type` to the destructured params: `{ months, day, favoritesOnly, type, takenBefore }`.
2. Add `'asset.type'` and `'asset.duration'` to the `.select([...])` list.
3. Add, next to the existing `favoritesOnly` guard:
   `.$if(type !== undefined, (qb) => qb.where('asset.type', '=', type!))`

Keep every existing filter, the Preview `asset_file` `exists` clause, and the `orderBy` unchanged.

### Step 3 — GREEN: the four fixture factories

Adding required fields breaks these object literals. Add `type: AssetType.Image, duration: null` to
each factory (import `AssetType` from `src/enum` where missing):

- `server/src/services/memory-rules/month-recap.rule.spec.ts:7-16`
- `server/src/services/memory-rules/favorites-throwback.rule.spec.ts:7-16`
- `server/src/services/memory-rules/on-this-day-place.rule.spec.ts:13-23`
- `server/src/services/memory-rules/season-recap.rule.spec.ts:9-19`

Do **not** change any assertion in those four files — their behavior must be untouched.

## Verification

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts  # green
cd server && pnpm test -- --run src/services/memory-rules/                                      # all green, unchanged
make check-server
cd server && npx prettier --check src/repositories/asset.repository.ts "src/services/memory-rules/**"
```

`make sql` regeneration is handled by the controller against a live dev DB (it **deletes all query
files** if no DB is running). Do not run it.

## Out of scope

No new rule, no registry/metadata entry, no i18n, no docs. Those belong to Slice 2.

## Commit

`feat(memories): return asset type and duration from getMemoryAssetsForPeriod`
