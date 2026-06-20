# "Has album" Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Has album" filter state (show only assets in ≥1 album) alongside the existing "Has no album" filter, across the web filter UI and the server search/timeline/map APIs.

**Architecture:** Add a parallel boolean `isInAlbum` everywhere the fork-only `isNotInAlbum` boolean is already wired (web + server). The two are mutually exclusive in the UI (selecting one clears the other). Server SQL for `isInAlbum` is the same `EXISTS(album_asset)` subquery as `isNotInAlbum` but **without** the `NOT`. No API/URL migration — a new URL value `?album=has` is added beside the existing `?album=none`.

**Tech Stack:** NestJS + Kysely + Zod (server), SvelteKit + Svelte 5 runes + Vitest + Testing Library (web), generated `@immich/sdk` (TypeScript) from the OpenAPI spec.

## Global Constraints

- **TDD always:** write the failing test, run it red, implement minimally, run it green, commit.
- **Server imports:** no relative imports — use the `src/` path alias.
- **Formatting:** Prettier (120 cols, single quotes, trailing commas, semicolons); ESLint zero-warnings. Defer the full `lint` pass to the final task; use `pnpm check` (tsc) in the loop.
- **Test runners:** server `cd server && pnpm test -- --run <file>`; web `cd web && pnpm test -- --run <file>`.
- **SQL semantics:** `isInAlbum` predicate = `EXISTS (select from album_asset where album_asset.assetId = asset.id)`. Mirror each existing `isNotInAlbum` site's album-scope guard verbatim (`!options.albumId` at the suggestion/timeline sites, `(!options.albumIds || options.albumIds.length === 0)` at `searchAssetBuilder`).
- **i18n:** add new keys to `i18n/en.json` only; keep keys in alphabetical order (the repo uses `prettier-plugin-sort-json`). Other locales fall back to English.
- **Order matters:** all server tasks + SDK regen (Tasks 1–7) must land **before** the web tasks (8–20), because the web option-builders and pages reference SDK request types that gain `isInAlbum` only after regeneration.
- **Out of scope:** mobile (Flutter/Dart), the command palette (`global-search-manager`), and the dead `web/src/lib/types.ts` `SearchDisplayFilters`/`SearchFilter` types and the unused `filter-panel-favorites.stub.svelte` — do not touch these. (See the spec.)

**Spec:** `docs/superpowers/specs/2026-06-19-has-album-filter-design.md`

---

## Task 1: Server — `search.dto.ts` accepts `isInAlbum`

**Files:**

- Modify: `server/src/dtos/search.dto.ts` (4 sites)
- Test: `server/src/dtos/search.dto.spec.ts`

**Interfaces:**

- Produces: `isInAlbum?: boolean` on `SmartSearchDto`, `SmartSearchFacetsDto`, `FilterSuggestionsRequestDto`, `SearchSuggestionRequestDto`.

- [ ] **Step 1: Write the failing tests** — append these inside the existing `describe('search DTO albumless filters', …)` block in `server/src/dtos/search.dto.spec.ts` (before its closing `});`):

```ts
it('should accept isInAlbum on smart search requests', () => {
  const result = SmartSearchDto.schema.safeParse({ query: 'beach', isInAlbum: true });

  expect(result.success).toBe(true);
  expect(result.data?.isInAlbum).toBe(true);
});

it('should accept isInAlbum on smart search facet requests', () => {
  const result = SmartSearchFacetsDto.schema.safeParse({ query: 'beach', isInAlbum: true });

  expect(result.success).toBe(true);
  expect(result.data?.isInAlbum).toBe(true);
});

it('should coerce isInAlbum on filter suggestion requests', () => {
  const result = FilterSuggestionsRequestDto.schema.safeParse({ isInAlbum: 'true' });

  expect(result.success).toBe(true);
  expect(result.data?.isInAlbum).toBe(true);
});

it('should coerce isInAlbum on dependent search suggestion requests', () => {
  const result = SearchSuggestionRequestDto.schema.safeParse({
    type: SearchSuggestionType.CITY,
    country: 'Germany',
    isInAlbum: 'true',
  });

  expect(result.success).toBe(true);
  expect(result.data?.isInAlbum).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/dtos/search.dto.spec.ts`
Expected: FAIL — `isInAlbum` is stripped (`result.data?.isInAlbum` is `undefined`).

- [ ] **Step 3: Implement** — add `isInAlbum` next to each `isNotInAlbum` line in `server/src/dtos/search.dto.ts`:

At the `BaseSearchSchema` field (after the `isNotInAlbum: z.boolean()…` line):

```ts
  isInAlbum: z.boolean().optional().describe('Filter assets in at least one album'),
```

In the `SmartSearchFacetsSchema.pick({…})` object (after `isNotInAlbum: true,`):

```ts
  isInAlbum: true,
```

In **both** `stringToBool` schemas (the suggestion-request base and the dependent-suggestion base — after each `isNotInAlbum: stringToBool…` line):

```ts
  isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/dtos/search.dto.spec.ts`
Expected: PASS (all album filter tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/search.dto.ts server/src/dtos/search.dto.spec.ts
git commit -m "feat(server): accept isInAlbum on search DTOs (#675)"
```

---

## Task 2: Server — `time-bucket.dto.ts` coerces `isInAlbum`

**Files:**

- Modify: `server/src/dtos/time-bucket.dto.ts`
- Test: `server/src/dtos/time-bucket.dto.spec.ts`

**Interfaces:**

- Produces: `isInAlbum?: boolean` on `TimeBucketDto` / `TimeBucketAssetDto`.

- [ ] **Step 1: Write the failing tests** — add a new `describe` block after the existing `describe('isNotInAlbum query param handling', …)` block in `server/src/dtos/time-bucket.dto.spec.ts`:

```ts
describe('isInAlbum query param handling', () => {
  it('should coerce true string to boolean', () => {
    const result = TimeBucketDto.schema.safeParse({ isInAlbum: 'true' });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });

  it('should coerce false string to boolean', () => {
    const result = TimeBucketDto.schema.safeParse({ isInAlbum: 'false' });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/dtos/time-bucket.dto.spec.ts`
Expected: FAIL — `result.data?.isInAlbum` is `undefined`.

- [ ] **Step 3: Implement** — in `server/src/dtos/time-bucket.dto.ts`, add after the `isNotInAlbum: stringToBool…` line:

```ts
    isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/dtos/time-bucket.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/time-bucket.dto.ts server/src/dtos/time-bucket.dto.spec.ts
git commit -m "feat(server): coerce isInAlbum on time-bucket DTO (#675)"
```

---

## Task 3: Server — `gallery-map.dto.ts` coerces `isInAlbum`

**Files:**

- Modify: `server/src/dtos/gallery-map.dto.ts`
- Test: `server/src/dtos/gallery-map.dto.spec.ts`

**Interfaces:**

- Produces: `isInAlbum?: boolean` on `FilteredMapMarkerDto`.

- [ ] **Step 1: Write the failing tests** — add a new `describe` block after the existing `describe('isNotInAlbum', …)` block in `server/src/dtos/gallery-map.dto.spec.ts`:

```ts
describe('isInAlbum', () => {
  it('should coerce true string to boolean', () => {
    const result = parse({ isInAlbum: 'true' });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(true);
  });

  it('should coerce false string to boolean', () => {
    const result = parse({ isInAlbum: 'false' });

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBe(false);
  });

  it('should leave undefined when not provided', () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.data?.isInAlbum).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/dtos/gallery-map.dto.spec.ts`
Expected: FAIL — `result.data?.isInAlbum` is `undefined` for the true/false cases.

- [ ] **Step 3: Implement** — in `server/src/dtos/gallery-map.dto.ts`, add after the `isNotInAlbum: stringToBool…` line:

```ts
    isInAlbum: stringToBool.optional().describe('Filter assets in at least one album'),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/dtos/gallery-map.dto.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/gallery-map.dto.ts server/src/dtos/gallery-map.dto.spec.ts
git commit -m "feat(server): coerce isInAlbum on gallery-map DTO (#675)"
```

---

## Task 4: Server — search-query SQL for `isInAlbum`

Covers the three search-side option types and three SQL predicates: the suggestion `buildFilteredAssetIds` and `getExifField` (in `search.repository.ts`) and the core `searchAssetBuilder` (in `database.ts`). All three are compile-tested offline.

**Files:**

- Modify: `server/src/repositories/search.repository.ts` (3 option interfaces + 2 SQL sites)
- Modify: `server/src/utils/database.ts` (1 SQL site)
- Test: `server/src/repositories/search.repository.spec.ts`

**Interfaces:**

- Produces: `isInAlbum?: boolean` on `SearchStatusOptions` (⇒ `AssetSearchOptions` ⇒ `AssetSearchBuilderOptions`, consumed by `searchAssetBuilder`), `ExifSuggestionScopeOptions`, and `FilterSuggestionFilterOptions`.

- [ ] **Step 1: Write the failing tests** — add inside the same `describe` block that holds the existing `isNotInAlbum` SQL tests in `server/src/repositories/search.repository.spec.ts` (right after the `'filters dependent EXIF suggestions to assets without album membership'` test):

```ts
it('filters suggestion asset ids to assets with album membership', () => {
  const sql = compileFilteredAssetIds(sut, { isInAlbum: true });

  expect(sql).toContain('"album_asset"');
  expect(sql).toContain('exists');
  expect(sql).not.toContain('not exists');
  expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
});

it('does not add album inclusion for false has-album filters', () => {
  const sql = compileFilteredAssetIds(sut, { isInAlbum: false });

  expect(sql).not.toContain('"album_asset"');
});

it('filters dependent EXIF suggestions to assets with album membership', () => {
  const sql = compileExifField(sut, 'model', { isInAlbum: true });

  expect(sql).toContain('"album_asset"');
  expect(sql).toContain('exists');
  expect(sql).not.toContain('not exists');
});

it('filters metadata search assets to album members via searchAssetBuilder', () => {
  const sql = buildAssetSearchSql({ isInAlbum: true });

  expect(sql).toContain('"album_asset"');
  expect(sql).toContain('exists');
  expect(sql).not.toContain('not exists');
});

it('does not add album inclusion to metadata search when isInAlbum is false', () => {
  const sql = buildAssetSearchSql({ isInAlbum: false });

  expect(sql).not.toContain('"album_asset"');
});

// Edge case (unreachable via UI): both album booleans true → the predicates are
// ANDed, yielding the empty intersection. Documents that no special handling is needed.
it('ANDs both album predicates when isInAlbum and isNotInAlbum are both true', () => {
  const sql = buildAssetSearchSql({ isInAlbum: true, isNotInAlbum: true });

  expect(sql).toContain('exists');
  expect(sql).toContain('not exists');
});
```

> The `not.toContain('not exists')` assertions are safe because, for these minimal option objects, the only `not exists` the builders can emit is the `isNotInAlbum` album predicate (the only other `eb.not(exists(...))` — `isEncoded === false` — is gated behind `isEncoded !== undefined`, which we do not set). The final edge test intentionally sets both to confirm both predicates coexist.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && pnpm test -- --run src/repositories/search.repository.spec.ts`
Expected: FAIL — `isInAlbum` is not a recognized option, so no `album_asset` predicate is emitted (assertions on `'exists'` / `'"album_asset"'` fail).

- [ ] **Step 3a: Add the option fields** — in `server/src/repositories/search.repository.ts`:

In `interface SearchStatusOptions` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

In `interface ExifSuggestionScopeOptions` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

In `interface FilterSuggestionFilterOptions` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

- [ ] **Step 3b: Add the suggestion SQL** — in `server/src/repositories/search.repository.ts`, immediately after each existing `isNotInAlbum` `.$if(…)` block (there are two: in `getExifField`/`applySuggestionScope` near the top of the file region around line 1280, and in `buildFilteredAssetIds` around line 1302), add the mirror:

```ts
      .$if(!!options?.isInAlbum && !options?.albumId, (qb) =>
        qb.where((eb) =>
          eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
```

For the `buildFilteredAssetIds` site, match its non-optional style (it uses `options.isInAlbum` / `options.albumId`, no `?.`):

```ts
      .$if(!!options.isInAlbum && !options.albumId, (qb) =>
        qb.where((eb) =>
          eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
        ),
      )
```

- [ ] **Step 3c: Add the `searchAssetBuilder` SQL** — in `server/src/utils/database.ts`, immediately after the existing `isNotInAlbum` `.$if(…)` block (around line 671), add:

```ts
    .$if(!!options.isInAlbum && (!options.albumIds || options.albumIds.length === 0), (qb) =>
      qb.where((eb) => eb.exists((eb) => eb.selectFrom('album_asset').whereRef('assetId', '=', 'asset.id'))),
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && pnpm test -- --run src/repositories/search.repository.spec.ts`
Expected: PASS (new `isInAlbum` SQL tests and all existing `isNotInAlbum` tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/search.repository.ts server/src/utils/database.ts server/src/repositories/search.repository.spec.ts
git commit -m "feat(server): add isInAlbum search SQL predicates (#675)"
```

---

## Task 5: Server — asset-repository timeline SQL for `isInAlbum`

The album predicate lives at two `asset.repository` sites: the module-private helper `withTimeBucketAssetFilters` (used by both `getTimeBuckets` and `getTimeBucketCovers`) and the inline CTE inside `getTimeBucket`. Both consume `TimeBucketOptions extends AssetBuilderOptions`.

> **TDD note — why a compile test, not just forwarding.** `buildTimeBucketOptions` builds its result with `const { … ...options } = dto` and passes the spread `options` straight to the repository, so a `timeline.service` forwarding test would pass via that spread **before any asset.repository change** — it can't drive the SQL red→green. The real red driver is therefore an **offline SQL compile test** on `withTimeBucketAssetFilters` (mirroring `search.repository.spec`'s `offlineKysely` harness). That requires exporting the helper. The forwarding tests are added too, as regression guards (they catch a future `buildTimeBucketOptions` that drops unknown fields), but they are not the red driver.
>
> **Residual gap (documented):** `getTimeBucket`'s inline CTE (the second SQL site) is not reachable by an offline `.compile()` (the method calls `.execute()` directly). It is covered by the forwarding guard plus the identical predicate shape proven here and in Task 4. This still **improves** on the status quo, where the existing `isNotInAlbum` timeline SQL has no unit coverage at all.

**Files:**

- Create: `server/src/repositories/asset.repository.spec.ts`
- Modify: `server/src/repositories/asset.repository.ts` (`export` the helper, `AssetBuilderOptions` field, 2 SQL sites)
- Test (regression guards): `server/src/services/timeline.service.spec.ts`

**Interfaces:**

- Consumes: `TimeBucketDto.isInAlbum` (Task 2) via `buildTimeBucketOptions`' `...options` spread.
- Produces: exported `withTimeBucketAssetFilters`; `isInAlbum?: boolean` on `AssetBuilderOptions` (⇒ `TimeBucketOptions`).

- [ ] **Step 1: Write the failing SQL compile test (red driver)** — create `server/src/repositories/asset.repository.spec.ts`:

```ts
import { DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { withTimeBucketAssetFilters } from 'src/repositories/asset.repository';
import type { DB } from 'src/schema';
import { describe, expect, it } from 'vitest';

// Offline Kysely — compiles SQL without executing it. No DB connection needed.
const offlineKysely = () =>
  new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });

const compileTimeBucketFilters = (options: Record<string, unknown>) =>
  withTimeBucketAssetFilters(offlineKysely().selectFrom('asset').select('asset.id'), options as any).compile().sql;

describe('withTimeBucketAssetFilters album filters', () => {
  it('filters timeline assets to album members when isInAlbum is true', () => {
    const sql = compileTimeBucketFilters({ isInAlbum: true });

    expect(sql).toContain('"album_asset"');
    expect(sql).toContain('exists');
    expect(sql).not.toContain('not exists');
    expect(sql).toContain('"album_asset"."assetId" = "asset"."id"');
  });

  it('filters timeline assets to non-album members when isNotInAlbum is true', () => {
    const sql = compileTimeBucketFilters({ isNotInAlbum: true });

    expect(sql).toContain('"album_asset"');
    expect(sql).toContain('not exists');
  });

  it('omits the album predicate when isInAlbum is false', () => {
    const sql = compileTimeBucketFilters({ isInAlbum: false });

    expect(sql).not.toContain('"album_asset"');
  });
});
```

- [ ] **Step 2: Write the forwarding regression guards** — in `server/src/services/timeline.service.spec.ts`, add after the `'should pass false has-no-album through for getTimeBuckets…'` test:

```ts
it('should pass has-album through to asset repository for getTimeBuckets', async () => {
  mocks.asset.getTimeBuckets.mockResolvedValue([]);
  await sut.getTimeBuckets(authStub.admin, { isInAlbum: true });
  expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }));
});
```

…and after the `'should pass has-no-album through for getTimeBucket'` test:

```ts
it('should pass has-album through for getTimeBucket', async () => {
  const json = `[{ id: ['asset-id'] }]`;
  mocks.asset.getTimeBucket.mockResolvedValue({ assets: json });

  await sut.getTimeBucket(authStub.admin, { timeBucket: '2023-08-01', isInAlbum: true });

  expect(mocks.asset.getTimeBucket).toHaveBeenCalledWith(
    '2023-08-01',
    expect.objectContaining({ isInAlbum: true }),
    authStub.admin,
  );
});
```

- [ ] **Step 3: Run tests to verify the red driver fails**

Run:

```bash
cd server && pnpm test -- --run src/repositories/asset.repository.spec.ts src/services/timeline.service.spec.ts
```

Expected: the **compile tests FAIL** — `withTimeBucketAssetFilters` is not exported (import error) and emits no album predicate. (The two `timeline.service` guards pass already via the DTO spread — that is expected; they guard against regressions, they are not the red driver.)

- [ ] **Step 4a: Export the helper** — in `server/src/repositories/asset.repository.ts`, change `function withTimeBucketAssetFilters<O>(` to:

```ts
export function withTimeBucketAssetFilters<O>(
```

- [ ] **Step 4b: Add the option field** — in `interface AssetBuilderOptions` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

- [ ] **Step 4c: Add the SQL** — at **both** `isNotInAlbum` `.$if(…)` sites in `asset.repository.ts`, add the mirror immediately after, matching each site's indentation. Site one is inside `withTimeBucketAssetFilters` (the shared helper); site two is inside the `getTimeBucket` inline CTE (more deeply nested — match the adjacent `isNotInAlbum` block's indentation there):

```ts
    .$if(!!options.isInAlbum && !options.albumId, (qb) =>
      qb.where((eb) =>
        eb.exists((eb) => eb.selectFrom('album_asset').whereRef('album_asset.assetId', '=', 'asset.id')),
      ),
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
cd server && pnpm test -- --run src/repositories/asset.repository.spec.ts src/services/timeline.service.spec.ts
```

Expected: PASS (the compile tests now emit the `exists` album predicate; the forwarding guards stay green).

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/src/repositories/asset.repository.spec.ts server/src/services/timeline.service.spec.ts
git commit -m "feat(server): add isInAlbum to asset timeline SQL (#675)"
```

---

## Task 6: Server — shared-space map markers forward `isInAlbum`

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Test: `server/src/services/shared-space.service.spec.ts`

**Interfaces:**

- Consumes: `FilteredMapMarkerDto.isInAlbum` (Task 3) and `AssetSearchBuilderOptions.isInAlbum` (Task 4, via `SearchStatusOptions`).

- [ ] **Step 1: Write the failing test** — in `server/src/services/shared-space.service.spec.ts`, add after the `'should pass false has-no-album to repository…'` test:

```ts
it('should pass has-album to repository', async () => {
  const auth = factory.auth();
  mocks.sharedSpace.getFilteredMapMarkers.mockResolvedValue([]);

  await sut.getFilteredMapMarkers(auth, { isInAlbum: true });

  expect(mocks.sharedSpace.getFilteredMapMarkers).toHaveBeenCalledWith(
    expect.objectContaining({
      isInAlbum: true,
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: FAIL — the service does not map `dto.isInAlbum` onto the repository options.

- [ ] **Step 3: Implement** — in `server/src/services/shared-space.service.ts`, in the `getFilteredMapMarkers` call object, after `isNotInAlbum: dto.isNotInAlbum,`:

```ts
      isInAlbum: dto.isInAlbum,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(server): forward isInAlbum to shared-space map markers (#675)"
```

---

## Task 7: Regenerate OpenAPI spec + TypeScript SDK

**Files:**

- Modify (generated): `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/**` (Dart client; regenerated for spec parity, mobile app code untouched)

**Interfaces:**

- Produces: `isInAlbum?: boolean` on the generated request types for `getTimeBucket(s)`, `getTimeBucketCovers`, `getFilteredMapMarkers`, `searchLargeAssets`, `getSearchSuggestions`, `getFilterSuggestions`, and the smart-search DTOs.

- [ ] **Step 1: Build the server and regenerate the spec**

Run:

```bash
cd server && pnpm build && pnpm sync:open-api
```

Expected: `open-api/immich-openapi-specs.json` now contains `isInAlbum` parameters (it previously had only `isNotInAlbum`).

- [ ] **Step 2: Regenerate the SDK clients**

Run (from repo root):

```bash
make open-api
```

Expected: `open-api/typescript-sdk/src/fetch-client.ts` gains `isInAlbum?: boolean;` next to each `isNotInAlbum?: boolean;`. (If the Dart generator fails for lack of Java, run `make open-api-typescript` instead and note that the Dart client must be regenerated in CI.)

- [ ] **Step 3: Verify the SDK picked up the field**

Run:

```bash
grep -c "isInAlbum" open-api/typescript-sdk/src/fetch-client.ts
```

Expected: a non-zero count (≈ the same number of sites as `isNotInAlbum`).

- [ ] **Step 4: Type-check the SDK build is consistent**

Run: `cd open-api/typescript-sdk && npx tsc --noEmit -p tsconfig.json` (or `make build-sdk`)
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add open-api/ mobile/openapi/
git commit -m "chore(api): regenerate OpenAPI spec and SDK for isInAlbum (#675)"
```

---

## Task 8: Web — `FilterState` + helpers carry `isInAlbum`

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.ts`
- Test: `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`

**Interfaces:**

- Produces: `isInAlbum?: boolean` on `FilterState` and `FilterContext`; counted by `getActiveFilterCount`; included by `buildFilterContext`; cleared by `clearFilters`.

> `createFilterState()` returns a minimal object and does **not** set `isNotInAlbum`, so it needs **no** change for `isInAlbum` (both default to `undefined`).

- [ ] **Step 1: Write the failing tests** — in `web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts`, add after the `'should count has-no-album as an active filter'` test:

```ts
it('should count has-album as an active filter', () => {
  const state = { ...createFilterState(), isInAlbum: true };

  expect(getActiveFilterCount(state)).toBe(1);
});
```

…after the `'should clear has-no-album while preserving sortOrder'` test:

```ts
it('should clear has-album while preserving sortOrder', () => {
  const state = { ...createFilterState(), isInAlbum: true, sortOrder: 'asc' as const };

  const cleared = clearFilters(state);

  expect(cleared.isInAlbum).toBeUndefined();
  expect(cleared.sortOrder).toBe('asc');
});
```

…and after the `'should exclude has-no-album from dependent suggestion context when requested'` test:

```ts
it('should include has-album in dependent suggestion context', () => {
  const state = { ...createFilterState(), isInAlbum: true, rating: 4 };

  expect(buildFilterContext(state)).toEqual({ rating: 4, isInAlbum: true });
});

it('should exclude has-album from dependent suggestion context when requested', () => {
  const state = { ...createFilterState(), isInAlbum: true, rating: 4 };

  expect(buildFilterContext(state, ['isInAlbum'])).toEqual({ rating: 4 });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
Expected: FAIL — count is `0`, `clearFilters` doesn't clear it, context omits it.

- [ ] **Step 3: Implement** — in `web/src/lib/components/filter-panel/filter-panel.ts`:

In `interface FilterState` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

In `type FilterContext` (after `isNotInAlbum?: boolean;`):

```ts
  isInAlbum?: boolean;
```

In `getActiveFilterCount`, after the `(state.isNotInAlbum === true ? 1 : 0) +` line:

```ts
    (state.isInAlbum === true ? 1 : 0) +
```

In `buildFilterContext`, after the `isNotInAlbum` block:

```ts
if (includes('isInAlbum') && state.isInAlbum === true) {
  context.isInAlbum = true;
}
```

In `clearFilters`, after `isNotInAlbum: undefined,`:

```ts
    isInAlbum: undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-state.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.ts web/src/lib/components/filter-panel/__tests__/filter-state.spec.ts
git commit -m "feat(web): add isInAlbum to filter state helpers (#675)"
```

---

## Task 9: Web — `AlbumsFilter` becomes a 3-button tri-state

**Files:**

- Modify: `web/src/lib/components/filter-panel/albums-filter.svelte`
- Modify: `i18n/en.json` (add `filter_has_album`)
- Test: `web/src/lib/components/filter-panel/__tests__/albums-filter.spec.ts` (rewrite)

**Interfaces:**

- Produces: `AlbumsFilter` props `{ selected: 'all' | 'has' | 'none'; onChange: (value: 'all' | 'has' | 'none') => void }`. Test ids: `albums-all`, `albums-has` (new), `albums-none`.

- [ ] **Step 1: Add the i18n key** — in `i18n/en.json`, insert directly **before** the `"filter_has_no_album": "Has no album",` line:

```json
  "filter_has_album": "Has album",
```

- [ ] **Step 2: Rewrite the failing tests** — replace the entire body of `web/src/lib/components/filter-panel/__tests__/albums-filter.spec.ts` with:

```ts
import AlbumsFilter from '$lib/components/filter-panel/albums-filter.svelte';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

describe('AlbumsFilter', () => {
  it('should render All, Has album, and Has no album buttons', () => {
    render(AlbumsFilter, { props: { selected: 'all', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-all')).toBeInTheDocument();
    expect(screen.getByTestId('albums-has')).toBeInTheDocument();
    expect(screen.getByTestId('albums-none')).toBeInTheDocument();
  });

  it('should highlight All when selected is all', () => {
    render(AlbumsFilter, { props: { selected: 'all', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-all').className).toContain('border-immich-primary');
  });

  it('should highlight Has album when selected is has', () => {
    render(AlbumsFilter, { props: { selected: 'has', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-has').className).toContain('border-immich-primary');
  });

  it('should highlight Has no album when selected is none', () => {
    render(AlbumsFilter, { props: { selected: 'none', onChange: vi.fn() } });

    expect(screen.getByTestId('albums-none').className).toContain('border-immich-primary');
  });

  it('should call onChange with has when Has album is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'all', onChange } });

    screen.getByTestId('albums-has').click();

    expect(onChange).toHaveBeenCalledWith('has');
  });

  it('should call onChange with none when Has no album is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'all', onChange } });

    screen.getByTestId('albums-none').click();

    expect(onChange).toHaveBeenCalledWith('none');
  });

  it('should call onChange with all when All is clicked', () => {
    const onChange = vi.fn();
    render(AlbumsFilter, { props: { selected: 'has', onChange } });

    screen.getByTestId('albums-all').click();

    expect(onChange).toHaveBeenCalledWith('all');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/albums-filter.spec.ts`
Expected: FAIL — `albums-has` does not exist; the component still uses the old `selected?: boolean` / `onToggle` contract.

- [ ] **Step 4: Implement** — replace the entire contents of `web/src/lib/components/filter-panel/albums-filter.svelte` with:

```svelte
<script lang="ts">
  import { Icon } from '@immich/ui';
  import { mdiImageAlbum, mdiImageMultipleOutline, mdiImageOffOutline } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props {
    selected: 'all' | 'has' | 'none';
    onChange: (value: 'all' | 'has' | 'none') => void;
  }

  let { selected, onChange }: Props = $props();

  const activeClass =
    'border-immich-primary bg-immich-primary/10 text-immich-primary dark:border-immich-dark-primary dark:bg-immich-dark-primary/20 dark:text-immich-dark-primary';
  const inactiveClass = 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400';
</script>

<div class="flex gap-1.5" data-testid="albums-filter">
  <button
    type="button"
    class="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs {selected === 'all'
      ? activeClass
      : inactiveClass}"
    onclick={() => onChange('all')}
    data-testid="albums-all"
  >
    <Icon icon={mdiImageAlbum} size="14" />
    {$t('all')}
  </button>
  <button
    type="button"
    class="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs {selected === 'has'
      ? activeClass
      : inactiveClass}"
    onclick={() => onChange('has')}
    data-testid="albums-has"
  >
    <Icon icon={mdiImageMultipleOutline} size="14" />
    {$t('filter_has_album')}
  </button>
  <button
    type="button"
    class="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs {selected === 'none'
      ? activeClass
      : inactiveClass}"
    onclick={() => onChange('none')}
    data-testid="albums-none"
  >
    <Icon icon={mdiImageOffOutline} size="14" />
    {$t('filter_has_no_album')}
  </button>
</div>
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/albums-filter.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/lib/components/filter-panel/albums-filter.svelte web/src/lib/components/filter-panel/__tests__/albums-filter.spec.ts i18n/en.json
git commit -m "feat(web): add Has album option to AlbumsFilter (#675)"
```

---

## Task 10: Web — wire the tri-state into `filter-panel.svelte`

**Files:**

- Modify: `web/src/lib/components/filter-panel/filter-panel.svelte` (3 sites)
- Test: `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`

**Interfaces:**

- Consumes: `AlbumsFilter` tri-state contract (Task 9), `FilterState.isInAlbum` (Task 8).

- [ ] **Step 1: Write the failing test** — in `web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`, add after the `'should update filters when has-no-album is selected'` test:

```ts
it('should select has-album and clear has-no-album (mutual exclusivity)', async () => {
  const onFiltersChange = vi.fn();
  // Start with "Has no album" already active to prove selecting "Has album" clears it.
  const filters = { ...createFilterState(), isNotInAlbum: true };

  render(FilterPanel, {
    props: {
      config: { sections: ['albums' as FilterSection], providers: {} },
      timeBuckets: [],
      filters,
      onFiltersChange,
    },
  });

  await fireEvent.click(screen.getByTestId('albums-has'));

  const updated = onFiltersChange.mock.calls.at(-1)![0];
  expect(updated.isInAlbum).toBe(true);
  expect(updated.isNotInAlbum).toBeUndefined();
});

it('should show active state for has-album when collapsed', async () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  render(FilterPanel, {
    props: {
      config: { sections: ['albums' as FilterSection], providers: {} },
      timeBuckets: [],
      filters,
    },
  });

  await fireEvent.click(screen.getByTestId('collapse-panel-btn'));

  expect(screen.getByTestId('collapsed-icon-strip').querySelector('.bg-immich-primary')).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: FAIL — `albums-has` button isn't rendered by the panel (still passes the old `selected`/`onToggle` props), and `hasActiveFilter('albums')` ignores `isInAlbum`.

- [ ] **Step 3a: Update the `AlbumsFilter` usage** — in `web/src/lib/components/filter-panel/filter-panel.svelte`, replace the `{:else if section === 'albums'}` block:

```svelte
            {:else if section === 'albums'}
              <AlbumsFilter
                selected={filters.isInAlbum ? 'has' : filters.isNotInAlbum ? 'none' : 'all'}
                onChange={(value) => {
                  updateFilters({
                    ...filters,
                    isInAlbum: value === 'has' ? true : undefined,
                    isNotInAlbum: value === 'none' ? true : undefined,
                  });
                }}
              />
```

- [ ] **Step 3b: Update `hasActiveFilter`** — in the `case 'albums':` branch:

```ts
      case 'albums': {
        return filters.isNotInAlbum === true || filters.isInAlbum === true;
      }
```

- [ ] **Step 3c: Track `isInAlbum` in the suggestions effect** — in the `const current: FilterState = {…}` object (inside the `$effect` for `config.suggestionsProvider`), after `isNotInAlbum: filters.isNotInAlbum,`:

```ts
      isInAlbum: filters.isInAlbum,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/filter-panel.spec.ts`
Expected: PASS — including the pre-existing `albums-none → isNotInAlbum: true` test (the new mapping preserves it).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/filter-panel.svelte web/src/lib/components/filter-panel/__tests__/filter-panel.spec.ts
git commit -m "feat(web): wire Has album tri-state into filter panel (#675)"
```

---

## Task 11: Web — active-filters chip for `isInAlbum`

**Files:**

- Modify: `web/src/lib/components/filter-panel/active-filters-bar.svelte`
- Test: `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`

**Interfaces:**

- Consumes: `FilterState.isInAlbum` (Task 8), i18n `filter_has_album` (Task 9). The chip reuses `type: 'albums'`, so removal clears both album booleans (handled in Tasks 13/14's remove cases).

- [ ] **Step 1: Write the failing tests** — in `web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`, add after the `'should remove has-no-album filter on chip close'` test:

```ts
it('should render chip for has-album filter', () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  const { getAllByTestId } = render(ActiveFiltersBar, {
    props: {
      filters,
      onRemoveFilter: () => {},
      onClearAll: () => {},
    },
  });

  const chips = getAllByTestId('active-chip');
  expect(chips).toHaveLength(1);
  expect(chips[0].textContent).toContain('Has album');
});

it('should remove has-album filter on chip close', async () => {
  let removedType: string | undefined;
  const filters = { ...createFilterState(), isInAlbum: true };

  const { getByTestId } = render(ActiveFiltersBar, {
    props: {
      filters,
      onRemoveFilter: (type: string) => {
        removedType = type;
      },
      onClearAll: () => {},
    },
  });

  await fireEvent.click(getByTestId('chip-close'));
  expect(removedType).toBe('albums');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
Expected: FAIL — no chip rendered for `isInAlbum` (0 chips found).

- [ ] **Step 3: Implement** — in `web/src/lib/components/filter-panel/active-filters-bar.svelte`, immediately after the existing `// Albums chip` block:

```svelte
    if (filters.isInAlbum === true) {
      result.push({ type: 'albums', labelKey: 'filter_has_album' });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/filter-panel/active-filters-bar.svelte web/src/lib/components/filter-panel/__tests__/active-filters-bar.spec.ts
git commit -m "feat(web): show Has album chip in active filters bar (#675)"
```

---

## Task 12: Web — URL param `?album=has`

**Files:**

- Modify: `web/src/lib/utils/searchable-page-search.ts` (type union, `parseAlbumFilter`, `getSearchablePageFilterState`, `appendSearchablePageFilterParams`)
- Test: `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`

**Interfaces:**

- Produces: `?album=has` ⇔ `isInAlbum: true`; `?album=none` ⇔ `isNotInAlbum: true` (unchanged). `parseAlbumFilter` returns `'has' | 'none' | undefined`.

- [ ] **Step 1: Write the failing tests** — in `web/src/lib/utils/__tests__/searchable-page-search.spec.ts`, add these tests (place near the existing album URL tests):

```ts
it('serializes has-album into URLs as album=has', () => {
  const url = new URL('https://gallery.test/photos');
  const filters = { ...createFilterState(), isInAlbum: true };

  expect(buildSearchablePageUrl(url, '', 'desc', filters)).toBe('/photos?sort=desc&album=has');
});

it('hydrates album=has into isInAlbum', () => {
  const url = new URL('https://gallery.test/photos?album=has');

  expect(getSearchablePageFilterState(url)).toEqual({ isInAlbum: true });
});

it('still hydrates album=none into isNotInAlbum', () => {
  const url = new URL('https://gallery.test/photos?album=none');

  expect(getSearchablePageFilterState(url)).toEqual({ isNotInAlbum: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/searchable-page-search.spec.ts`
Expected: FAIL — `album=has` is not serialized or parsed (`isInAlbum` ignored).

- [ ] **Step 3a: Extend the type union** — in `web/src/lib/utils/searchable-page-search.ts`, in the `SearchablePageFilterState` `Pick<…>` union, after `| 'isNotInAlbum'`:

```ts
    | 'isInAlbum'
```

- [ ] **Step 3b: Update `parseAlbumFilter`** — replace the function:

```ts
function parseAlbumFilter(value: string | null): 'has' | 'none' | undefined {
  if (value === 'none') {
    return 'none';
  }
  if (value === 'has') {
    return 'has';
  }
  return undefined;
}
```

- [ ] **Step 3c: Update hydration** — in `getSearchablePageFilterState`, replace the `const isNotInAlbum = parseAlbumFilter(…)` assignment and its `if (isNotInAlbum === true) {…}` block with:

```ts
const albumFilter = parseAlbumFilter(url.searchParams.get('album'));
```

and (in the result-building section, replacing the old `if (isNotInAlbum === true)` block):

```ts
if (albumFilter === 'none') {
  result.isNotInAlbum = true;
}
if (albumFilter === 'has') {
  result.isInAlbum = true;
}
```

- [ ] **Step 3d: Update serialization** — in `appendSearchablePageFilterParams`, after the existing `if (filters.isNotInAlbum === true) { params.set('album', 'none'); }` block:

```ts
if (filters.isInAlbum === true) {
  params.set('album', 'has');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/searchable-page-search.spec.ts`
Expected: PASS (new and existing album URL tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/searchable-page-search.ts web/src/lib/utils/__tests__/searchable-page-search.spec.ts
git commit -m "feat(web): support album=has URL param (#675)"
```

---

## Task 13: Web — photos filter options carry `isInAlbum`

**Files:**

- Modify: `web/src/lib/utils/photos-filter-options.ts` (build option + remove cases)
- Test: `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`

**Interfaces:**

- Consumes: `FilterState.isInAlbum` (Task 8), SDK request type with `isInAlbum` (Task 7).
- Produces: `buildPhotosTimelineOptions` includes `isInAlbum: true` when set; `handlePhotosRemoveFilter(filters, 'albums')` clears **both** album booleans; `handlePhotosRemoveFilter(filters, 'isInAlbum')` clears `isInAlbum`.

- [ ] **Step 1: Write the failing tests** — in `web/src/lib/utils/__tests__/photos-filter-options.spec.ts`, add after the `'should omit has-no-album when it is false'` test:

```ts
it('should include has-album when selected', () => {
  const filters = { ...createFilterState(), isInAlbum: true };
  const options = buildPhotosTimelineOptions(filters);

  expect(options.isInAlbum).toBe(true);
});

it('should omit has-album when it is false', () => {
  const filters = { ...createFilterState(), isInAlbum: false };
  const options = buildPhotosTimelineOptions(filters);

  expect(options).not.toHaveProperty('isInAlbum');
});
```

…and after the `'should clear has-no-album filter'` test:

```ts
it('should clear has-album filter', () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  expect(handlePhotosRemoveFilter(filters, 'albums').isInAlbum).toBeUndefined();
  expect(handlePhotosRemoveFilter(filters, 'isInAlbum').isInAlbum).toBeUndefined();
});

it('should clear both album booleans when removing the albums filter', () => {
  const filters = { ...createFilterState(), isNotInAlbum: true, isInAlbum: true };
  const cleared = handlePhotosRemoveFilter(filters, 'albums');

  expect(cleared.isNotInAlbum).toBeUndefined();
  expect(cleared.isInAlbum).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/photos-filter-options.spec.ts`
Expected: FAIL — `isInAlbum` not added to options; remove `'albums'` doesn't clear `isInAlbum`.

- [ ] **Step 3a: Add to the option builder** — in `web/src/lib/utils/photos-filter-options.ts`, after the `if (filters.isNotInAlbum === true) { base.isNotInAlbum = true; }` block:

```ts
if (filters.isInAlbum === true) {
  base.isInAlbum = true;
}
```

- [ ] **Step 3b: Update the remove cases** — replace the `case 'albums': case 'isNotInAlbum':` block with three explicit cases:

```ts
    case 'albums': {
      return { ...filters, isNotInAlbum: undefined, isInAlbum: undefined };
    }
    case 'isNotInAlbum': {
      return { ...filters, isNotInAlbum: undefined };
    }
    case 'isInAlbum': {
      return { ...filters, isInAlbum: undefined };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run src/lib/utils/__tests__/photos-filter-options.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/photos-filter-options.ts web/src/lib/utils/__tests__/photos-filter-options.spec.ts
git commit -m "feat(web): carry isInAlbum in photos filter options (#675)"
```

---

## Task 14: Web — space filter options & smart-search params carry `isInAlbum`

**Files:**

- Modify: `web/src/lib/utils/space-filter-options.ts` (build option + remove cases)
- Modify: `web/src/lib/utils/space-search.ts` (smart-search params)
- Test: `web/src/lib/utils/__tests__/space-filter-options.spec.ts`
- Test: `web/src/lib/utils/__tests__/space-search.spec.ts`

**Interfaces:**

- Produces: `buildSpaceTimelineOptions` includes `isInAlbum`; `handleSpaceRemoveFilter('albums')` clears both album booleans; `buildSmartSearchParams` sets `isInAlbum` when true.

- [ ] **Step 1: Write the failing tests** —

In `web/src/lib/utils/__tests__/space-filter-options.spec.ts`, after the `'omits has-no-album when it is false'` test:

```ts
it('preserves has-album in spaces timeline options', () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  expect(buildSpaceTimelineOptions('space-1', filters)).toEqual(
    expect.objectContaining({
      spaceId: 'space-1',
      isInAlbum: true,
    }),
  );
});

it('omits has-album when it is false', () => {
  const filters = { ...createFilterState(), isInAlbum: false };

  expect(buildSpaceTimelineOptions('space-1', filters)).not.toHaveProperty('isInAlbum');
});
```

…and after the `'clears has-no-album when removing albums filter'` test:

```ts
it('clears has-album when removing albums filter', () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  expect(handleSpaceRemoveFilter(filters, 'albums').isInAlbum).toBeUndefined();
  expect(handleSpaceRemoveFilter(filters, 'isInAlbum').isInAlbum).toBeUndefined();
});
```

In `web/src/lib/utils/__tests__/space-search.spec.ts`, after the `'omits isNotInAlbum when has-no-album is false'` test:

```ts
it('sets isInAlbum when has-album is selected', () => {
  const result = buildSmartSearchParams({
    query: 'beach',
    filters: { ...baseFilters, isInAlbum: true },
  });

  expect(result.isInAlbum).toBe(true);
});

it('omits isInAlbum when has-album is false', () => {
  const result = buildSmartSearchParams({
    query: 'beach',
    filters: { ...baseFilters, isInAlbum: false },
  });

  expect(result.isInAlbum).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/space-filter-options.spec.ts src/lib/utils/__tests__/space-search.spec.ts
```

Expected: FAIL — `isInAlbum` missing from options/params; remove `'albums'` doesn't clear it.

- [ ] **Step 3a: `space-filter-options.ts`** — after the `if (filters.isNotInAlbum === true) { base.isNotInAlbum = true; }` block:

```ts
if (filters.isInAlbum === true) {
  base.isInAlbum = true;
}
```

…and replace the `case 'albums': case 'isNotInAlbum':` block with:

```ts
    case 'albums': {
      return { ...filters, isNotInAlbum: undefined, isInAlbum: undefined };
    }
    case 'isNotInAlbum': {
      return { ...filters, isNotInAlbum: undefined };
    }
    case 'isInAlbum': {
      return { ...filters, isInAlbum: undefined };
    }
```

- [ ] **Step 3b: `space-search.ts`** — after the `if (filters.isNotInAlbum === true) { params.isNotInAlbum = true; }` block:

```ts
if (filters.isInAlbum === true) {
  params.isInAlbum = true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/space-filter-options.spec.ts src/lib/utils/__tests__/space-search.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/space-filter-options.ts web/src/lib/utils/space-search.ts web/src/lib/utils/__tests__/space-filter-options.spec.ts web/src/lib/utils/__tests__/space-search.spec.ts
git commit -m "feat(web): carry isInAlbum in space filter options and search (#675)"
```

---

## Task 15: Web — map filter options & config carry `isInAlbum`

**Files:**

- Modify: `web/src/lib/utils/map-filter-options.ts`
- Modify: `web/src/lib/utils/map-filter-config.ts`
- Test: `web/src/lib/utils/__tests__/map-filter-options.spec.ts`
- Test: `web/src/lib/utils/__tests__/map-filter-config.spec.ts`

**Interfaces:**

- Produces: `buildMapMarkerOptions` includes `isInAlbum`; the map `suggestionsProvider` forwards `isInAlbum` to `getFilterSuggestions`.

- [ ] **Step 1: Write the failing tests** —

In `web/src/lib/utils/__tests__/map-filter-options.spec.ts`, after the `'omits has-no-album from map marker options when false'` test:

```ts
it('includes has-album in map marker options', () => {
  const filters = { ...createFilterState(), isInAlbum: true };

  expect(buildMapMarkerOptions(filters)).toEqual(expect.objectContaining({ isInAlbum: true }));
});

it('omits has-album from map marker options when false', () => {
  const filters = { ...createFilterState(), isInAlbum: false };

  expect(buildMapMarkerOptions(filters)).not.toHaveProperty('isInAlbum');
});
```

In `web/src/lib/utils/__tests__/map-filter-config.spec.ts`, after the `'should omit has-no-album from filter suggestions when false'` test:

```ts
it('should pass has-album to filter suggestions', async () => {
  const config = buildMapFilterConfig();
  await config.suggestionsProvider!({ ...emptyFilters, isInAlbum: true });

  expect(getFilterSuggestions).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }));
});

it('should omit has-album from filter suggestions when false', async () => {
  const config = buildMapFilterConfig();
  await config.suggestionsProvider!({ ...emptyFilters, isInAlbum: false });

  expect(getFilterSuggestions).toHaveBeenCalledWith(expect.not.objectContaining({ isInAlbum: expect.anything() }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/map-filter-options.spec.ts src/lib/utils/__tests__/map-filter-config.spec.ts
```

Expected: FAIL — `isInAlbum` missing from marker options / suggestions request.

- [ ] **Step 3a: `map-filter-options.ts`** — after the `if (filters.isNotInAlbum === true) { base.isNotInAlbum = true; }` block:

```ts
if (filters.isInAlbum === true) {
  base.isInAlbum = true;
}
```

- [ ] **Step 3b: `map-filter-config.ts`** — after the `isNotInAlbum: filters.isNotInAlbum === true ? true : undefined,` line in the `getFilterSuggestions` request object:

```ts
      isInAlbum: filters.isInAlbum === true ? true : undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
cd web && pnpm test -- --run src/lib/utils/__tests__/map-filter-options.spec.ts src/lib/utils/__tests__/map-filter-config.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/map-filter-options.ts web/src/lib/utils/map-filter-config.ts web/src/lib/utils/__tests__/map-filter-options.spec.ts web/src/lib/utils/__tests__/map-filter-config.spec.ts
git commit -m "feat(web): carry isInAlbum in map filter options and config (#675)"
```

---

## Task 16: Web — photos page threading + test stubs

This task also updates the shared stubs that Tasks 17–18 rely on.

**Files:**

- Modify: `web/src/test-data/mocks/bindable-filter-panel.stub.svelte` (used by photos/spaces/map page specs)
- Modify: `web/src/test-data/mocks/smart-search-results.stub.svelte`
- Modify: `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`
- Test: `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`

**Interfaces:**

- Produces (stub): a `select-has-album-filter` button calling `updateFilters({ ...filters, isInAlbum: true })`, a `data-is-in-album` attribute (bindable stub), and a `data-filter-in-album` attribute (smart-search stub).

- [ ] **Step 1: Update the stubs**

In `web/src/test-data/mocks/bindable-filter-panel.stub.svelte`, add a function after `selectHasNoAlbum`:

```svelte
  function selectHasAlbum() {
    if (filters) {
      updateFilters({ ...filters, isInAlbum: true });
    }
  }
```

Add `data-is-in-album={String(filters?.isInAlbum)}` next to the existing `data-is-not-in-album={…}` attribute, and add a button next to the existing has-no-album button:

```svelte
  <button type="button" data-testid="select-has-album-filter" onclick={selectHasAlbum}>Has album</button>
```

In `web/src/test-data/mocks/smart-search-results.stub.svelte`, add next to `data-filter-not-in-album`:

```svelte
  data-filter-in-album={String(filters?.isInAlbum)}
```

- [ ] **Step 2: Write the failing tests** — in `web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts`, add after the `'passes has-no-album into photos timeline options…'` test:

```ts
it('passes has-album into photos timeline options when hydrated from the URL', async () => {
  mockPage.url = new URL('https://gallery.test/photos?album=has');

  renderPage();

  await waitFor(() => {
    expect(buildPhotosTimelineOptions).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }));
  });
});
```

…after the `'narrows photos suggestions and dependent providers to has-no-album when selected'` test:

```ts
it('narrows photos suggestions and dependent providers to has-album when selected', async () => {
  mockPage.url = new URL('https://gallery.test/photos');

  renderPage();
  await fireEvent.click(screen.getByTestId('select-has-album-filter'));
  await fireEvent.click(screen.getByTestId('load-city-suggestions'));
  await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

  await waitFor(() => {
    expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ isInAlbum: true, withSharedSpaces: true }),
    );
    expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Germany', isInAlbum: true }),
    );
    expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ make: 'Sony', isInAlbum: true }),
    );
  });
});

it('hydrates has-album from the URL into search results', async () => {
  mockPage.url = new URL('https://gallery.test/photos?q=beach&album=has');

  renderPage();

  expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-in-album', 'true');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: the **`'narrows photos suggestions…to has-album'` test FAILS** — the `+page.svelte` inline suggestions provider does not yet pass `isInAlbum`. The other two new tests (`buildPhotosTimelineOptions` URL hydration and the `data-filter-in-album` smart-results attribute) already pass from Tasks 8/12/13 + the Step 1 stub change — that is expected; they are integration guards, and the suggestions test is this task's red driver.

- [ ] **Step 4: Implement** — in `web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte`, in the suggestions-provider request object, after `isNotInAlbum: nextFilters.isNotInAlbum === true ? true : undefined,`:

```ts
      isInAlbum: nextFilters.isInAlbum === true ? true : undefined,
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/test-data/mocks/bindable-filter-panel.stub.svelte web/src/test-data/mocks/smart-search-results.stub.svelte "web/src/routes/(user)/photos/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/photos/[[assetId=id]]/photos-page.spec.ts"
git commit -m "feat(web): thread isInAlbum through the photos page (#675)"
```

---

## Task 17: Web — spaces page threading

Depends on the stub button added in Task 16.

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts`

- [ ] **Step 1: Write the failing tests** — add after the `'narrows space suggestions and dependent providers to has-no-album when selected'` test:

```ts
it('narrows space suggestions and dependent providers to has-album when selected', async () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos');

  renderPage();
  await fireEvent.click(screen.getByTestId('select-has-album-filter'));
  await fireEvent.click(screen.getByTestId('load-city-suggestions'));
  await fireEvent.click(screen.getByTestId('load-camera-model-suggestions'));

  await waitFor(() => {
    expect(sdkMock.getFilterSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: 'space-1', isInAlbum: true }),
    );
    expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Germany', spaceId: 'space-1', isInAlbum: true }),
    );
    expect(sdkMock.getSearchSuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ make: 'Sony', spaceId: 'space-1', isInAlbum: true }),
    );
  });
});
```

…and after the `'hydrates has-no-album from the space URL into search results'` test:

```ts
it('hydrates has-album from the space URL into search results', () => {
  mockPage.url = new URL('https://gallery.test/spaces/space-1/photos?q=beach&album=has');

  renderPage();

  expect(screen.getByTestId('smart-search-results')).toHaveAttribute('data-filter-in-album', 'true');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: FAIL — the spaces `+page.svelte` suggestions request omits `isInAlbum`.

- [ ] **Step 3: Implement** — in the spaces `+page.svelte`, in the suggestions-provider request object, after `isNotInAlbum: nextFilters.isNotInAlbum === true ? true : undefined,`:

```ts
      isInAlbum: nextFilters.isInAlbum === true ? true : undefined,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/+page.svelte" "web/src/routes/(user)/spaces/[spaceId]/[[photos=photos]]/[[assetId=id]]/spaces-page.spec.ts"
git commit -m "feat(web): thread isInAlbum through the spaces page (#675)"
```

---

## Task 18: Web — map page integration test

No production change beyond Tasks 15 + 16; this adds the integration test proving the map page forwards `isInAlbum` to `getFilteredMapMarkers`.

**Files:**

- Test: `web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts`

- [ ] **Step 1: Write the failing test** — add after the `'passes has-no-album to filtered map markers when selected'` test:

```ts
it('passes has-album to filtered map markers when selected', async () => {
  renderPage();
  await fireEvent.click(screen.getByTestId('select-has-album-filter'));
  await flushQueryDebounce();

  await waitFor(() => {
    expect(sdkMock.getFilteredMapMarkers).toHaveBeenCalledWith(expect.objectContaining({ isInAlbum: true }));
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd web && pnpm test -- --run "src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"`
Expected: PASS immediately (Task 15 added `buildMapMarkerOptions` support and Task 16 added the stub button). If it FAILS, the cause is a missing wire-up in one of those tasks — fix there, not here.

- [ ] **Step 3: Commit**

```bash
git add "web/src/routes/(user)/map/[[photos=photos]]/[[assetId=id]]/map-page.spec.ts"
git commit -m "test(web): map page forwards isInAlbum to markers (#675)"
```

---

## Task 19: Web — smart-search terms label for `isInAlbum`

Display parity: when an "in album" term appears on the `/search` results page, render a human label instead of the raw `isInAlbum` key. (Mirrors the existing untested `not_in_any_album` label; no dedicated unit test, like its counterpart.)

**Files:**

- Modify: `web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte`
- Modify: `i18n/en.json` (add `in_any_album`)

- [ ] **Step 1: Add the i18n key** — in `i18n/en.json`, insert between `"in_albums": …` and `"in_archive": "In archive",` (alphabetical order):

```json
  "in_any_album": "In an album",
```

- [ ] **Step 2: Add the label mapping** — in the `getHumanReadableSearchKey` `keyMap` object, after `isNotInAlbum: $t('not_in_any_album'),`:

```ts
      isInAlbum: $t('in_any_album'),
```

- [ ] **Step 3: Type-check the web package**

Run: `cd web && pnpm check`
Expected: no errors (`isInAlbum` is a valid `SearchTerms` key now that the SDK declares it — Task 7).

- [ ] **Step 4: Commit**

```bash
git add "web/src/routes/(user)/search/[[photos=photos]]/[[assetId=id]]/+page.svelte" i18n/en.json
git commit -m "feat(web): label in-album term on smart-search results (#675)"
```

---

## Task 20: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full server test suite**

Run: `cd server && pnpm test`
Expected: PASS (no regressions).

- [ ] **Step 2: Full web test suite**

Run: `cd web && pnpm test`
Expected: PASS.

- [ ] **Step 3: Type checks**

Run: `make check-server && make check-web`
Expected: no errors.

- [ ] **Step 4: Lint (deferred full pass)**

Run: `make lint-server && make lint-web`
Expected: zero warnings. Fix any issues, then re-run the affected test file(s).

- [ ] **Step 5: Manual verification (the SQL the unit tests can't fully prove)**

Start the dev stack (`make dev`), open the timeline filter panel, and confirm: the Album section shows **All / Has album / Has no album**; selecting **Has album** narrows the timeline to assets in ≥1 album; selecting **Has no album** still works; the active-filters chip and the `?album=has` URL round-trip; and the map/space filters behave the same. (Use the verify skill / e2e if available.)

- [ ] **Step 6: Commit any lint fixes**

```bash
git add -A
git commit -m "chore(web,server): lint fixes for isInAlbum filter (#675)"
```

---

## Self-Review

**Spec coverage** — every spec change maps to a task:

| Spec item                                                  | Task                                         |
| ---------------------------------------------------------- | -------------------------------------------- |
| `AlbumsFilter` tri-state UI                                | 9                                            |
| `filter-panel.svelte` binding / `hasActiveFilter` / effect | 10                                           |
| `filter-panel.ts` state helpers                            | 8                                            |
| `active-filters-bar.svelte` chip                           | 11                                           |
| `searchable-page-search.ts` `?album=has`                   | 12                                           |
| photos/space/map filter-option utils                       | 13, 14, 15                                   |
| photos/spaces/search `+page.svelte` threading              | 16, 17, 19                                   |
| test stubs                                                 | 16                                           |
| i18n `filter_has_album` / `in_any_album`                   | 9 / 19                                       |
| search DTOs                                                | 1                                            |
| time-bucket DTO                                            | 2                                            |
| gallery-map DTO                                            | 3                                            |
| search.repository + database.ts SQL                        | 4 (offline compile tests)                    |
| asset.repository timeline SQL                              | 5 (offline compile test on exported helper)  |
| shared-space.service mapping                               | 6                                            |
| timeline.service (no change; forwarded via spread)         | 5 (regression guards)                        |
| SDK / OpenAPI regen                                        | 7                                            |
| page integration (photos/spaces/map)                       | 16, 17, 18                                   |
| Edge: both-true intersection                               | 4 (SQL compile test asserts both predicates) |
| Edge: album-scoped guard no-op                             | 4, 5 (guards mirrored verbatim)              |
| Edge: `onAlbumAddAssets` no `isInAlbum` branch             | intentionally untouched (documented in spec) |

**Known coverage limit (documented, not a gap to fix):** `getTimeBucket`'s inline-CTE SQL site cannot be reached by an offline `.compile()` (the method executes directly), so it is covered by the Task 5 forwarding guard plus the identical, compile-tested predicate shape from the shared helper and Task 4 — an improvement over the status quo, where the existing `isNotInAlbum` timeline SQL has no unit coverage at all.

**Placeholder scan:** none — every code step shows the exact diff; every test step shows the exact test.

**Type consistency:** `isInAlbum?: boolean` is used consistently across `FilterState`, `FilterContext`, all server option interfaces, and DTOs. The `AlbumsFilter` contract `selected: 'all' | 'has' | 'none'` + `onChange` is defined in Task 9 and consumed identically in Task 10. The URL value `'has'` is consistent across Tasks 12, 16, 17. Test ids `albums-has` / `select-has-album-filter` / `data-filter-in-album` are consistent across Tasks 9, 10, 16, 17, 18.
