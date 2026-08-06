# Workflow Expansion — Slice 4: Resolver media type

> Implement test-first. Test cases below are EXACT and authoritative.

**Goal:** Add deterministic media-type parsing to `asset-source-resolver.mjs` so an
explicitly type-qualified source adds a `{ type: 'IMAGE' | 'VIDEO' }` metadata
filter, combined with recency/date. **Explicit type words only:**
`videos/video/clips/clip/movies/movie` → `VIDEO`; `images/image` → `IMAGE`. The
generic colloquial words (`photos/pics/pictures/snaps/shots`) stay **generic = no
type** (Slice 3 `GENERIC_NOUNS`), so recency-only `"my newest 20 photos"` keeps
sending **no `filters` key** (byte-identical, no regression). Type alone is NOT a
bound — a type-only source still needs recency/date or it hands off (unbounded).
Non-type qualifiers (`screenshots`, places, names) stay handoff via the gate.

**Spec scope:** Slice 4. **Depends on:** Slices 1-3 (contract fixtures, resolver,
clean-source gate). Verified against the DTO: metadata `searchAssets.filters` is a
`strictObject` with `type: AssetTypeSchema.optional()`,
`AssetType ∈ {IMAGE, VIDEO, AUDIO, OTHER}`.

## Design

`asset-source-resolver.mjs`:

1. Add `parseMediaType(source)` (pure):
   - `/\b(?:videos?|clips?|movies?)\b/i` → `'VIDEO'` (checked first).
   - `/\b(?:images?)\b/i` → `'IMAGE'`.
   - else `undefined`.
   - Export it (unit-tested directly).
2. Add a `TYPE_NOUNS` regex `/\b(?:videos?|clips?|movies?|images?)\b/gi` and strip
   it in `isCleanSource` (so a type-qualified source is now "clean"). Place the
   strip alongside the `GENERIC_NOUNS` strip.
3. In `resolveAssetSource`, after computing `recencyLimit`/`dateRange`, compute
   `const mediaType = parseMediaType(source);`. Build filters from BOTH date and
   type, and only attach a `filters` key when at least one is present:
   ```
   const filters = {
     ...(dateRange ? { takenAfter: dateRange.takenAfter.toISOString(), takenBefore: dateRange.takenBefore.toISOString() } : {}),
     ...(mediaType ? { type: mediaType } : {}),
   };
   const hasFilters = Object.keys(filters).length > 0;
   // searchAssets args: { mode:'metadata', order:'desc', limit, ...(hasFilters ? { filters } : {}), detail:'handle' }
   ```
   `limit = recencyLimit ?? MAX_RECENCY_LIMIT`.
4. **Unbounded gate unchanged:** keep
   `if (recencyLimit === undefined && dateRange === undefined) return handoff(...)`.
   So a type-only source (`"my videos"`, clean but no count/date) → handoff.

Order of operations in `resolveAssetSource` (final):

```
source = clean(...)
if SUBJECTIVE → handoff
recencyLimit = parseRecencyLimit(source)
dateRange = parseDateRange(source, now)
mediaType = parseMediaType(source)
if !isCleanSource(source) → handoff        // residual qualifier
if recencyLimit===undefined && dateRange===undefined → handoff   // unbounded (type alone not a bound)
filters = {...date, ...type}; hasFilters = keys>0
search { mode:'metadata', order:'desc', limit: recencyLimit ?? MAX, ...(hasFilters?{filters}:{}), detail:'handle' }
empty / resolved as today
```

## Contract fixture (Slice 1 helper) — tighten for type fidelity

Edit `validateSearchAssets` in `workflows/contract-fixtures.mjs` so the fake client
mirrors the real `strictObject` + enum:

- Add `const KNOWN_SEARCH_FILTER_KEYS = new Set([... all AgentSearchAssetsFilterFields keys ...])`
  — at minimum the ones the resolver can emit plus the common ones:
  `takenAfter, takenBefore, createdAfter, createdBefore, updatedAfter, updatedBefore,
city, state, country, make, model, lensModel, isFavorite, isNotInAlbum, type,
rating, tagIds, tagMatchAny, albumIds, albumMatchAny, personIds, personMatchAny,
spaceId, spacePersonIds, withSharedSpaces, visibility`.
- Add `const KNOWN_ASSET_TYPES = new Set(['IMAGE','VIDEO','AUDIO','OTHER'])`.
- In `validateSearchAssets(args)`, when `args.filters` is present:
  - reject any key not in `KNOWN_SEARCH_FILTER_KEYS` (`fail("unknown searchAssets filter key ...")`).
  - if `filters.type !== undefined && !KNOWN_ASSET_TYPES.has(filters.type)` → `fail("invalid searchAssets filter type ...")`.

This keeps the fixture contract-faithful (strictObject + enum) without changing any
existing passing behavior (current resolver emits only `takenAfter/takenBefore`,
both known keys).

## TDD — exact tests

### `asset-source-resolver.test.mjs`

Add `parseMediaType` to the import. Add a `describe('parseMediaType', ...)`:

- [ ] `parseMediaType('my videos from 2024')` → `'VIDEO'`
- [ ] `parseMediaType('newest 10 clips')` → `'VIDEO'`
- [ ] `parseMediaType('my movies')` → `'VIDEO'`
- [ ] `parseMediaType('newest 20 images')` → `'IMAGE'`
- [ ] `parseMediaType('my newest 20 photos')` → `undefined` (generic, NOT a type)
- [ ] `parseMediaType('my pics from 2024')` → `undefined` (generic)
- [ ] `parseMediaType('screenshots')` → `undefined`

Add to `describe('resolveAssetSource', ...)`:

- [ ] **video + date:** `resolveAssetSource({ client, sourceDescription: 'my videos from last weekend', now: NOW })`
      → `status:'resolved'`; recorded `searchAssets.args.filters` deepEquals
      `{ takenAfter:'2026-05-09T00:00:00.000Z', takenBefore:'2026-05-10T23:59:59.999Z', type:'VIDEO' }`,
      and `args.limit === 1000` (no recency).
- [ ] **image + recency:** `resolveAssetSource({ client, sourceDescription: 'newest 20 images', now: NOW })`
      → recorded `searchAssets.args` deepEquals
      `{ mode:'metadata', order:'desc', limit:20, filters:{ type:'IMAGE' }, detail:'handle' }`.
- [ ] **recency-only photos unchanged:** `resolveAssetSource({ client, sourceDescription: 'my newest 20 photos', now: NOW })`
      → recorded `searchAssets.args` deepEquals
      `{ mode:'metadata', order:'desc', limit:20, detail:'handle' }` (**NO `filters` key** — regression guard).
- [ ] **video + recency + date combine:** `resolveAssetSource({ client, sourceDescription: 'newest 20 videos from 2024', now: NOW })`
      → `args.limit === 20` and `args.filters` deepEquals
      `{ takenAfter:'2024-01-01T00:00:00.000Z', takenBefore:'2024-12-31T23:59:59.999Z', type:'VIDEO' }`.
- [ ] **type-only is unbounded → handoff:** `resolveAssetSource({ client, sourceDescription: 'my videos', now: NOW })`
      → `status:'handoff'`; no `searchAssets` call.
- [ ] **screenshots → handoff:** `resolveAssetSource({ client, sourceDescription: 'my screenshots', now: NOW })`
      → `status:'handoff'`; no `searchAssets` call.

Also extend the existing clean-source-gate handoff loop note: `'my videos from 2024'`
that was a handoff in Slice 3 now RESOLVES — REMOVE it from the Slice 3 handoff list
in this test (it was explicitly marked "substantive until Slice 4"). Replace it in
that loop with a still-handoff residual case if needed, e.g. keep
`'newest 20 Berlin photos'` and `'photos of Alex from last week'` (unchanged).

### `workflows/add-photos-to-album.test.mjs`

- [ ] **type source for free:** add a case — `wf.run({ client, slots: { albumRef:'Family', sourceDescription:'my videos from 2024' } })`
      → `outcome.status === 'planned'`; the `searchAssets` call has
      `filters.type === 'VIDEO'` and the 2024 `takenAfter/takenBefore`; the
      `proposeAlbumOperations` op is `album.addAssets` over `handle-1`.
- [ ] Confirm the existing recency case (`'my newest 20 photos'`) still asserts a
      `searchAssets` call with `args.query === undefined` and **no type** (already
      green; do not change).

### `workflows/contract-fixtures.test.mjs` (if it exists; else add to resolver test)

- [ ] fake client `searchAssets({ mode:'metadata', filters:{ type:'BOGUS' } })`
      throws (invalid enum).
- [ ] fake client `searchAssets({ mode:'metadata', filters:{ notARealKey:true } })`
      throws (unknown filter key).
- [ ] fake client `searchAssets({ mode:'metadata', filters:{ type:'VIDEO', takenAfter:'2024-01-01T00:00:00.000Z' } })`
      does NOT throw (valid).

(If there is no dedicated contract-fixtures test file, add these three asserts to a
small `describe('contract fixture searchAssets type fidelity', …)` in
`asset-source-resolver.test.mjs`.)

## Edge cases (must be covered)

- Generic `photos/pics/pictures/snaps/shots` → no type (recency-only no-filters
  regression guard).
- `images/image` → IMAGE; `videos/video/clips/clip/movies/movie` → VIDEO.
- `screenshots` and other non-type nouns → handoff (residual).
- Type alone (no count/date) → handoff (unbounded; type is not a bound).
- Type × recency, type × date, type × recency × date combine correctly.
- Contract fixture rejects unknown filter key and non-enum `type`.
- `add_photos_to_album` gains a type source for free; recency-only unchanged.

## Run / acceptance

```
export PATH="/Users/pierre/.local/share/mise/installs/node/24.14.1/bin:$PATH"
node --test 'agent-runner/src/**/*.test.mjs'    # or: pnpm --dir agent-runner test
```

- All prior tests stay green (esp. recency-only no-filters + Slice 3 date cases).
- New `parseMediaType` + type-combination cases green.
- `parseMediaType` exported.

## Commit

`feat: resolve media-type asset sources (image/video) via the shared resolver (slice 4)`
