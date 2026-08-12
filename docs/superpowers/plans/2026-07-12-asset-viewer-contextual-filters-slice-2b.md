# Asset Viewer Contextual Filters — Slice 2b (wire the new dimensions into the queries)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the four new filter dimensions (`lensModel`, `state`, `albumId`, `ownerId`) actually _do_ something. Slices 1 and 2 added them to the server DTO and to the web URL codec — but **no query builder forwards them**, so today a `?lens=…` URL renders a chip and changes nothing.

**Why this slice exists:** it was not in the original spec. The Slice 2 review caught the gap: all five web option-builders forward **zero** of the new fields, so the feature would have shipped dead. This slice closes it, and must land **before** Slices 3–8.

**Architecture:** Mostly a pass-through. The timeline builders feed `TimeBucketDto`, which already accepts all four fields (Slice 1). The map-markers endpoint feeds a _different_ builder (`searchAssetBuilder`), which **already** applies `state` and `lensModel` — so it needs only a DTO + service pass-through. Only `ownerId` needs new server code, and it hits **the exact same trap as Slice 1**.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md`

## Global Constraints

- **`ownerId` must never be routed through `userIds`.** In `searchAssetBuilder`, `options.userIds` is the owner **scoping** predicate (`database.ts:677, 687, 770`) — the same role it plays in the timeline builder. Routing a contributor _filter_ through it would widen results / leak. `ownerId` must be its own separate `AND asset.ownerId = X`. This is the identical trap Slice 1 documented; do not re-derive it.
- **No database migration.** All columns exist.
- Do NOT run `mise sql` / `make sql` / `make open-api` / `make build-sdk`. To regenerate clients use **`mise open-api`**, and remember the TS SDK source is `packages/sdk/src/fetch-client.ts` (commit `packages/sdk`, not just `open-api/`).
- Server lint is ZERO-WARNING; web lint is not (≈640 pre-existing tailwind warnings are fine, 0 errors required).
- Server: no relative imports (`src/` alias). Prettier is a CI gate on the server (`pnpm format:fix`).
- No `Co-Authored-By` / `Generated-with` commit trailers.

## What each endpoint can accept (verified — do not re-derive)

| Field       | Timeline (`TimeBucketDto`) | Map markers (`searchAssetBuilder`)              |
| ----------- | -------------------------- | ----------------------------------------------- |
| `lensModel` | ✅ added in Slice 1        | ✅ **already applied** (`database.ts:752-756`)  |
| `state`     | ✅ added in Slice 1        | ✅ **already applied** (`database.ts:735`)      |
| `albumId`   | ✅ pre-existing            | ✅ via `inAlbums()` (`database.ts:465`), plural |
| `ownerId`   | ✅ added in Slice 1        | ❌ **must be added** (this slice)               |

---

### Task 1: Server — `ownerId` on the map-markers query, plus `lensModel`/`state` on its DTO

**Files:**

- Modify: `server/src/repositories/search.repository.ts` (`AssetSearchOptions` — add `ownerId?: string`)
- Modify: `server/src/utils/database.ts` (`searchAssetBuilder` — add the predicate)
- Modify: `server/src/dtos/gallery-map.dto.ts` (`FilteredMapMarkerDto` — add 3 fields)
- Modify: `server/src/services/shared-space.service.ts` (`getFilteredMapMarkers` — pass them through)
- Test: `server/src/services/shared-space.service.spec.ts` (there is an existing `describe('getFilteredMapMarkers')` at ~`:9325` — add there)

- [ ] **Step 1: Write the failing tests**

In the existing `describe('getFilteredMapMarkers', ...)` block in `server/src/services/shared-space.service.spec.ts`, follow the block's established mocking style and add three tests asserting that the DTO fields reach the repository call:

```ts
it('forwards lensModel to the repository', async () => {
  // …arrange exactly as the neighbouring tests in this describe block do…
  await sut.getFilteredMapMarkers(auth, { lensModel: 'RF24-70mm F2.8 L IS USM' } as FilteredMapMarkerDto);

  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({ lensModel: 'RF24-70mm F2.8 L IS USM' }),
  );
});

it('forwards state to the repository', async () => {
  await sut.getFilteredMapMarkers(auth, { state: 'State of Berlin' } as FilteredMapMarkerDto);

  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({ state: 'State of Berlin' }),
  );
});

it('forwards ownerId as a contributor filter, NOT as userIds', async () => {
  const ownerId = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  await sut.getFilteredMapMarkers(auth, { ownerId } as FilteredMapMarkerDto);

  const args = mocks.sharedSpace.getFilteredMapMarkers.mock.calls[0][0];
  expect(args.ownerId).toBe(ownerId);
  // The trap: userIds is the OWNER SCOPING predicate. A contributor filter must never be
  // merged into it, or it widens the result set instead of narrowing it.
  expect(args.userIds).not.toContain(ownerId);
});
```

Match the surrounding tests' exact arrange/mock idiom — read them first rather than inventing one.

- [ ] **Step 2: Run to verify RED**

```bash
cd server && pnpm test --run src/services/shared-space.service.spec.ts -t getFilteredMapMarkers
```

Expected: **FAIL** — the fields are not on the DTO, so they are never forwarded.

- [ ] **Step 3: Add the three fields to `FilteredMapMarkerDto`**

In `server/src/dtos/gallery-map.dto.ts`, alongside the existing `make` / `model` (`:31-32`) and `city` / `country` (`:40-41`):

```ts
    lensModel: z.string().optional().describe('Camera lens model'),
    state: z.string().optional().describe('Filter by state/province'),
    ownerId: z
      .uuidv4()
      .optional()
      .describe('Filter by asset owner (contributor). Narrows within the current scope; never widens it.'),
```

- [ ] **Step 4: Add `ownerId` to the search options and the builder**

In `server/src/repositories/search.repository.ts`, add to `AssetSearchOptions` (near the existing owner/`userIds` fields):

```ts
  /**
   * Contributor filter: a plain AND on asset.ownerId. Deliberately separate from `userIds`, which
   * is the owner SCOPING predicate (database.ts:677/687/770). Merging a contributor filter into
   * userIds would widen the result set instead of narrowing it.
   */
  ownerId?: string;
```

In `server/src/utils/database.ts`, inside `searchAssetBuilder` (starts `:642`), add a standalone predicate next to the other exact-match `$if`s (e.g. beside the `lensModel` one at `:752`):

```ts
    .$if(options.ownerId !== undefined, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
```

Confirm `asUuid` is already imported in `database.ts`; if not, import it from wherever the file's siblings do.

**Do NOT touch the `options.userIds` clauses.**

- [ ] **Step 5: Pass the three fields through the service**

In `server/src/services/shared-space.service.ts`, in the `this.sharedSpaceRepository.getFilteredMapMarkers({ … })` call (~`:739-762`), add alongside the existing `make: dto.make, model: dto.model, city: dto.city, country: dto.country`:

```ts
      lensModel: dto.lensModel,
      state: dto.state,
      ownerId: dto.ownerId,
```

`searchAssetBuilder` already applies `state` (`database.ts:735`) and `lensModel` (`:752`) — they need no repository change, only this pass-through.

- [ ] **Step 6: GREEN + gate**

```bash
cd server && pnpm test --run src/services/shared-space.service.spec.ts && pnpm check && pnpm format:fix && pnpm lint
```

- [ ] **Step 7: Regenerate the clients and commit**

```bash
mise open-api
git add server open-api packages/sdk mobile/openapi
git commit -m "feat(map): filter map markers by lensModel, state and ownerId

lensModel and state were already applied by searchAssetBuilder and only needed to
reach it; ownerId is new. Like the timeline's ownerId, it is a standalone AND on
asset.ownerId and is deliberately NOT merged into userIds, which is the owner
SCOPING predicate — merging it there would widen the result set, not narrow it.

Without this the map's pins would ignore exactly the filters its own timeline
panel honours, which is a fresh instance of the bug #767 reports."
```

---

### Task 2: Web — forward the four dimensions from every option builder

**Files:**

- Modify: `web/src/lib/utils/photos-filter-options.ts` (`buildPhotosTimelineOptions`)
- Modify: `web/src/lib/utils/space-filter-options.ts` (`buildSpaceTimelineOptions`)
- Modify: `web/src/lib/utils/album-filter-options.ts` (`buildAlbumTimelineOptions`)
- Modify: `web/src/lib/utils/map-filter-options.ts` (`buildMapTimeBucketOptions`, `buildMapMarkerOptions`)
- Modify: `web/src/lib/utils/filter-search-terms.ts` (`filterStateToSearchTerms`)
- Test: the existing spec files under `web/src/lib/utils/__tests__/`

**Interfaces:**

- Consumes: `FilterState.lensModel | .state | .albumId | .ownerId` (Slice 2).
- The server-side param names are `lensModel`, `state`, `albumId`, `ownerId` (NOT the short URL names `lens` / `owner` — those exist only in the browser URL).

- [ ] **Step 1: Write the failing tests**

For each builder's existing spec file, add a case asserting the new fields are forwarded. Example for photos (mirror the file's existing idiom):

```ts
it('forwards the new filter dimensions to the timeline query', () => {
  const options = buildPhotosTimelineOptions({
    ...createFilterState(),
    lensModel: 'RF24-70mm F2.8 L IS USM',
    state: 'State of Berlin',
    albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  });

  expect(options).toMatchObject({
    lensModel: 'RF24-70mm F2.8 L IS USM',
    state: 'State of Berlin',
    albumId: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',
    ownerId: 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',
  });
});
```

Write the equivalent for `buildSpaceTimelineOptions`, `buildAlbumTimelineOptions`, `buildMapTimeBucketOptions` and `buildMapMarkerOptions`, and for `filterStateToSearchTerms` (which feeds "add all results to a collection").

**Two exceptions to encode as tests:**

```ts
// The album page's route ALREADY scopes the query to its album, and the server's albumId is a
// scalar driving one inner join — a second album cannot be AND-ed. So an albumId FILTER is
// meaningless here and must not overwrite the route's album scope (spec E9).
it('buildAlbumTimelineOptions ignores an albumId filter and keeps the route album', () => {
  const options = buildAlbumTimelineOptions('route-album-id', {
    ...createFilterState(),
    albumId: 'some-other-album',
  });

  expect(options.albumId).toBe('route-album-id');
});
```

```ts
// The map-markers endpoint has no albumId param (its builder takes albumIds, which this
// endpoint's DTO does not expose). Forward the other three, not this one.
it('buildMapMarkerOptions forwards lensModel/state/ownerId but not albumId', () => {
  const options = buildMapMarkerOptions(
    { ...createFilterState(), lensModel: 'RF24', state: 'Hamburg', ownerId: 'u1', albumId: 'a1' },
    undefined,
  );

  expect(options).toMatchObject({ lensModel: 'RF24', state: 'Hamburg', ownerId: 'u1' });
  expect(options.albumId).toBeUndefined();
});
```

- [ ] **Step 2: Run to verify RED**

```bash
cd web && pnpm test --run src/lib/utils
```

Expected: **FAIL** — the builders drop the new fields.

- [ ] **Step 3: Forward the fields**

In each builder, follow the file's existing `if (filters.X) { base.X = filters.X; }` idiom exactly. Add:

```ts
if (filters.lensModel) {
  base.lensModel = filters.lensModel;
}
if (filters.state) {
  base.state = filters.state;
}
if (filters.ownerId) {
  base.ownerId = filters.ownerId;
}
if (filters.albumId) {
  base.albumId = filters.albumId;
}
```

- In **`buildAlbumTimelineOptions`**: add `lensModel`, `state`, `ownerId` — but **NOT** `albumId` (the route owns it; see the test above).
- In **`buildMapMarkerOptions`**: add `lensModel`, `state`, `ownerId` — but **NOT** `albumId` (the endpoint has no such param).
- In **`filterStateToSearchTerms`**: add `lensModel` and `state` (both exist on `MetadataSearchDto`). Do **not** add `ownerId` unless you verify `MetadataSearchDto` actually has it — check `packages/sdk/src/fetch-client.ts` and skip it if absent, noting that in your report.

- [ ] **Step 4: GREEN + full gate**

```bash
cd web && pnpm test --run && pnpm check:typescript && pnpm lint
```

`pnpm lint` must show **0 errors** (≈640 pre-existing tailwind warnings are expected and must be left alone).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils
git commit -m "feat(web): forward lens/state/albumId/owner from every filter option builder

Slices 1 and 2 added these dimensions to the server DTO and the URL codec, but no
option builder forwarded them — so a ?lens= URL rendered a chip and changed
nothing. This wires them into the photos, space, album and map timeline queries,
the map-marker query, and the search terms used by add-all-to-collection.

Two deliberate exceptions: the album page ignores an albumId filter (its route
already scopes the query, and the server's albumId is a scalar), and the
map-markers endpoint takes no albumId param."
```

---

## Done When

- A `?lens=…` / `?state=…` / `?owner=…` / `?albumId=…` URL actually filters the timeline on **/photos, a space, an album and the map**.
- The map's **pins** honour the same filters as its timeline panel (no fresh #767).
- `ownerId` narrows and never widens on the map, exactly as on the timeline.
- The album page ignores a stray `albumId` filter rather than hijacking its own route scope.
