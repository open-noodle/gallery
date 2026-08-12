# Asset Viewer Contextual Filters — Slice 1 (Server) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three new timeline filter dimensions — `lensModel`, `state`, and `ownerId` — to the server, and prove with medium tests that Space viewers/editors can filter assets they do **not** own (the #655 bug class) while `ownerId` narrows and never widens (no data leak).

**Architecture:** `lensModel` and `state` are exact-match `=` predicates on the existing `asset_exif` inner join in `withTimeBucketAssetFilters`, exactly like `make`/`model`/`city`/`country`. `ownerId` is a **separate top-level** `AND asset.ownerId = X` on the `asset` table — deliberately NOT routed through the existing `userIds` option, which means "timeline composition" and is OR-ed with `timelineSpaceIds`.

**Tech Stack:** NestJS 11, Kysely (not TypeORM), Zod DTOs via `nestjs-zod`, Vitest. Medium tests run against a real Postgres via testcontainers.

**Spec:** `docs/superpowers/specs/2026-07-12-asset-viewer-contextual-filters-design.md` (§4.1–§4.4, §9 Slice 1)

## Global Constraints

- **No database migration.** `asset_exif.lensModel` and `asset_exif.state` already exist (`server/src/schema/tables/asset-exif.table.ts:56,77`). These are exact-match `=` predicates, so no trigram index is needed. **Do NOT create a file in `server/src/schema/migrations-gallery/`** — doing so would also drag in the `revert-to-immich.sql` CI gate for no reason.
- **Do NOT run `mise sql` / `mise //:sql`.** It deletes all query files when no DB is running. It is also unnecessary: `getTimeBuckets`'s `@GenerateSql` dummy params are `{}` / `{bucketSize}` (`asset.repository.ts:1193-1197`) and `getTimeBucket`'s are `{withStacked:true}` / `{bucketSize}` (`:1297-1301`), so every new `$if` branch is false during SQL generation and `server/src/queries/asset.repository.sql` is unchanged. The `sql-schema-up-to-date` CI job stays green without running it.
- **The `make` targets are GONE.** `make open-api`, `make sql` and `make build-sdk` now print "This command has been removed" and `exit 1` (`Makefile:135-140`). Use **`mise open-api`**. (CLAUDE.md still references the old `make` targets — it is stale.)
- **The generated TypeScript SDK source lives at `packages/sdk/src/fetch-client.ts`**, NOT `open-api/typescript-sdk/src/` (that directory contains only `build/`). See `mise.toml:58`.
- **Prettier is a CI gate for the server** (`pnpm format` = `prettier --check .`). Run `pnpm format:fix` before committing.
- **No relative imports in `server/`** — use the `src/` path alias.
- **Server lint is zero-warning**: `pnpm lint` runs `--max-warnings 0` (`server/package.json:22`), and `no-unused-vars` is a _warning_, so a single unused import fails the gate.
- **`ownerId` must never be routed through `options.userIds`.** See §4.2 of the spec: the `userIds` clause has an AND arm (`asset.repository.ts:359-361`) and an **OR arm** (`:362-380`) that activates once `timelineSpaceIds` is set. Routing a contributor filter through it would **widen** results — that OR arm is precisely what tests E21b/E21c exist to catch.
- **No `Co-Authored-By` or `Generated-with` trailers in commits.**

## File Structure

| File                                                         | Change | Responsibility                                                                                |
| ------------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `server/src/dtos/time-bucket.dto.ts`                         | Modify | Add `lensModel`, `state`, `ownerId` to `TimeBucketQueryBaseSchema`                            |
| `server/src/repositories/asset.repository.ts`                | Modify | Add the 3 fields to `AssetBuilderOptions`; add SQL predicates in `withTimeBucketAssetFilters` |
| `server/test/medium/specs/services/timeline.service.spec.ts` | Modify | Two-owner Space fixture + filter tests + RBAC tests (E17, E18, E20, E21, E22)                 |
| `server/test/medium/specs/services/search.service.spec.ts`   | Modify | E19 — camera suggestions in a Space include non-owned assets                                  |

**No service change is required.** `TimelineService.buildTimeBucketOptions` destructures
`const { userId, personId, spacePersonId, tagId, type, ...options } = dto;` (`timeline.service.ts:50`),
so `lensModel`, `state` and `ownerId` flow into `options` automatically.

---

### Task 1: Two-owner Space fixture + `lensModel` / `state` filters, proven RBAC-correct (E17, E18)

The RBAC test **is** the red test. We do not write a happy-path test first and bolt RBAC on later — the
very first failing test uses a Space viewer filtering by an asset owned by someone else. That way the
#655 bug class is designed against from the first line of code.

**Files:**

- Modify: `server/src/dtos/time-bucket.dto.ts` — `TimeBucketQueryBaseSchema`, right after `make`/`model` (`:63-64`)
- Modify: `server/src/repositories/asset.repository.ts` — `interface AssetBuilderOptions` (`:86-123`) and `withTimeBucketAssetFilters` (`:259-312`)
- Test: `server/test/medium/specs/services/timeline.service.spec.ts`

**Interfaces:**

- Produces: `TimeBucketDto.lensModel?: string`, `TimeBucketDto.state?: string` — consumed by Slice 2's web codec (URL params `lens` and `state`).
- Produces: `TimeBucketOptions.lensModel?: string`, `TimeBucketOptions.state?: string`.

- [ ] **Step 1: Add the two-owner Space fixture helper to the medium spec**

In `server/test/medium/specs/services/timeline.service.spec.ts`, add **only** `SharedSpaceRole` to the
existing `src/enum` import. Do **not** add `AlbumUserRole` yet — it is
not used until Task 3, and `@typescript-eslint/no-unused-vars` is a **warning** (`server/eslint.config.mjs:73`)
while `pnpm lint` runs `--max-warnings 0` (`server/package.json:22`), so an unused import would **fail this
task's own lint gate**.

```ts
import { AssetOrder, AssetType, AssetVisibility, SharedLinkType, SharedSpaceRole, TimeBucketSize } from 'src/enum';
```

Add `SharedSpaceRepository` to the `real:` list in the existing `setup` helper:

```ts
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';

const setup = (db?: Kysely<DB>) => {
  return newMediumService(TimelineService, {
    database: db || defaultDatabase,
    real: [AssetRepository, AccessRepository, PartnerRepository, SharedSpaceRepository],
    mock: [LoggingRepository],
  });
};
```

**Why this specific repository, and only this one** — there are two different injection paths and they are
easy to conflate:

- **The SUT's injected dependencies are frozen at construction** from the `real:` / `mock:` lists.
  `makeDeps` (`medium.factory.ts:134-142`) maps anything in neither list to **`undefined`**.
  `buildTimeBucketOptions` calls `this.sharedSpaceRepository.getSpaceIdsForTimeline(...)` whenever
  `withSharedSpaces` is set (`timeline.service.ts:81-86`) — so without this addition, tests E21b/E21c
  below die with `TypeError: Cannot read properties of undefined (reading 'getSpaceIdsForTimeline')`.
- **Fixture repositories are different.** `ctx.newAlbum` / `ctx.newAlbumUser` go through
  `MediumTestContext.get()` (`medium.factory.ts:145-152`), which lazily builds a real repo on demand
  regardless of the `real:` list. So **do NOT** add `AlbumRepository` / `AlbumUserRepository` — they are
  unnecessary, and an unused import would trip the zero-warning lint gate.

Note `Permission.SharedSpaceRead` itself resolves through **`AccessRepository`**
(`src/utils/access.ts:347` → `access.sharedSpace.checkMemberAccess`), which is already registered — the
access check is not why `SharedSpaceRepository` is needed. `withSharedSpaces` is.

Now add the fixture helpers below the existing `createTimelineAsset` helper:

```ts
const SPACE_BUCKET = '2026-01-01';
const SPACE_DATE = new Date('2026-01-15T10:00:00Z');

/** An asset owned by `ownerId`, added to `spaceId`, with the given EXIF. */
const newSpaceAssetWithExif = async (
  ctx: ReturnType<typeof setup>['ctx'],
  spaceId: string,
  ownerId: string,
  exif: { make?: string; model?: string; lensModel?: string; state?: string; city?: string; country?: string },
) => {
  const { asset } = await ctx.newAsset({
    ownerId,
    fileCreatedAt: SPACE_DATE,
    localDateTime: SPACE_DATE,
    width: 400,
    height: 200,
    thumbhash: Buffer.from('thumbhash'),
  });
  await ctx.newExif({ assetId: asset.id, timeZone: 'UTC', ...exif });
  await ctx.newSharedSpaceAsset({ spaceId, assetId: asset.id, addedById: ownerId });
  return asset;
};

/**
 * A Space with TWO contributing owners (anna, ben) plus a viewer and an editor who own NOTHING.
 *
 * The two-owner shape is load-bearing: with a single owner every RBAC assertion below passes
 * vacuously and the #655 bug class ("viewers get empty facets for assets owned by someone else")
 * stays invisible. Do not collapse this to one owner.
 */
const createTwoOwnerSpace = async (ctx: ReturnType<typeof setup>['ctx']) => {
  const { user: anna } = await ctx.newUser();
  const { user: ben } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const { user: editor } = await ctx.newUser();

  const { space } = await ctx.newSharedSpace({ createdById: anna.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ben.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: SharedSpaceRole.Editor });

  const annaAsset = await newSpaceAssetWithExif(ctx, space.id, anna.id, {
    make: 'Apple',
    model: 'iPhone 17 Pro Max',
    lensModel: 'iPhone 17 Pro Max back triple camera',
    city: 'Berlin',
    state: 'State of Berlin',
    country: 'Germany',
  });
  const benAsset = await newSpaceAssetWithExif(ctx, space.id, ben.id, {
    make: 'Canon',
    model: 'EOS R5',
    lensModel: 'RF24-70mm F2.8 L IS USM',
    city: 'Hamburg',
    state: 'Hamburg',
    country: 'Germany',
  });

  return { space, anna, ben, viewer, editor, annaAsset, benAsset };
};

/** Asset ids returned by the Space timeline for the given filter. */
const spaceBucketAssetIds = async (
  sut: ReturnType<typeof setup>['sut'],
  auth: AuthDto,
  spaceId: string,
  filter: Partial<TimeBucketDto>,
): Promise<string[]> => {
  const json = await sut.getTimeBucket(auth, { ...filter, spaceId, timeBucket: SPACE_BUCKET });
  const parsed = JSON.parse(json) as { id?: string[] };
  return parsed.id ?? [];
};
```

Add the two type imports this helper needs:

```ts
import { AuthDto } from 'src/dtos/auth.dto';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto';
```

- [ ] **Step 2: Write the failing RBAC tests for `lensModel` and `state` (E17, E18)**

Append a new `describe` block inside the existing `describe(TimelineService.name, ...)`:

```ts
describe('contextual filters — lensModel / state (Slice 1)', () => {
  it('E17: a Space VIEWER filters by a lens model on an asset they do not own', async () => {
    const { sut, ctx } = setup();
    const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, {
      lensModel: 'iPhone 17 Pro Max back triple camera',
    });

    // The viewer owns NOTHING in this space. Anna's asset must still come back.
    expect(ids).toEqual([annaAsset.id]);
  });

  it('E18: a Space EDITOR filters by a lens model on an asset they do not own', async () => {
    const { sut, ctx } = setup();
    const { space, editor, benAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: editor });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, {
      lensModel: 'RF24-70mm F2.8 L IS USM',
    });

    expect(ids).toEqual([benAsset.id]);
  });

  it('E17: a Space VIEWER filters by state on an asset they do not own', async () => {
    const { sut, ctx } = setup();
    const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, { state: 'State of Berlin' });

    expect(ids).toEqual([annaAsset.id]);
  });

  it('filters by lensModel are exact-match, not substring', async () => {
    const { sut, ctx } = setup();
    const { space, viewer } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, { lensModel: 'RF24-70mm' });

    expect(ids).toEqual([]);
  });

  it('lensModel and state compose with make as an AND', async () => {
    const { sut, ctx } = setup();
    const { space, viewer } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, {
      make: 'Canon',
      state: 'State of Berlin', // Anna's state, but Ben's make → no asset has both
    });

    expect(ids).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail RED**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/timeline.service.spec.ts
```

Expected: **FAIL**. Because `lensModel` and `state` are not on `TimeBucketDto`, TypeScript rejects
`{ lensModel: ... }` in `spaceBucketAssetIds`'s `Partial<TimeBucketDto>` argument — the failure surfaces as
a type error (`Object literal may only specify known properties`) or, at runtime, as the filter being
ignored so **all** space assets come back (`[annaAsset.id, benAsset.id]`) instead of one.

If instead the tests **pass** at this point, stop — something is wrong with the fixture (most likely the
assets are not actually in the space, so every result is empty and `toEqual([])` cases pass vacuously).

- [ ] **Step 4: Add `lensModel` and `state` to the DTO**

In `server/src/dtos/time-bucket.dto.ts`, inside `TimeBucketQueryBaseSchema`, immediately after the
existing `model` line:

```ts
    make: z.string().optional().describe('Filter by camera make'),
    model: z.string().optional().describe('Filter by camera model'),
    lensModel: z.string().optional().describe('Filter by camera lens model'),
    state: z.string().optional().describe('Filter by state/province name'),
```

- [ ] **Step 5: Add the two fields to `AssetBuilderOptions`**

In `server/src/repositories/asset.repository.ts`, in `interface AssetBuilderOptions`, after `model?: string;`:

```ts
  make?: string;
  model?: string;
  lensModel?: string;
  state?: string;
```

- [ ] **Step 6: Add the SQL predicates in `withTimeBucketAssetFilters`**

Two edits in `server/src/repositories/asset.repository.ts`.

First, extend the `$if` guard that decides whether to inner-join `asset_exif` (currently `:267-274`) so the
join also happens when only `lensModel` or `state` is set — **forgetting this is the #1 way to break this
task**, because the `where` clauses below would reference a table that was never joined:

```ts
    .$if(
      !!options.bbox ||
        !!options.city ||
        !!options.country ||
        !!options.state ||
        !!options.make ||
        !!options.model ||
        !!options.lensModel ||
        !!options.description ||
        options.rating !== undefined,
      (qb) => {
```

Second, inside that same callback, add the two exact-match predicates directly after the existing `model`
predicate:

```ts
if (options.model) {
  q = q.where('asset_exif.model', '=', options.model) as any;
}
if (options.lensModel) {
  q = q.where('asset_exif.lensModel', '=', options.lensModel) as any;
}
if (options.state) {
  q = q.where('asset_exif.state', '=', options.state) as any;
}
```

- [ ] **Step 7: Run the tests to verify they pass GREEN**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/timeline.service.spec.ts
```

Expected: **PASS** — all five new tests, and every pre-existing test in the file still passes.

- [ ] **Step 8: Typecheck and lint**

```bash
cd server && pnpm check && pnpm format:fix && pnpm lint
```

Expected: typecheck clean; lint clean with **zero warnings** (`--max-warnings 0`). `pnpm format` is a CI
gate, so `format:fix` first.

Expected: clean, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add server/src/dtos/time-bucket.dto.ts server/src/repositories/asset.repository.ts \
        server/test/medium/specs/services/timeline.service.spec.ts
git commit -m "feat(timeline): filter by lensModel and state

Exact-match predicates on the existing asset_exif join, mirroring make/model.
No migration and no new index: these follow the exact-match path, not the
ILIKE/trigram path used by description/ocr/originalFileName.

Tested on a two-owner Space fixture so the RBAC property is designed in from
the start: a Space viewer/editor filtering by lens or state sees assets owned
by OTHER members (the issue #655 bug class)."
```

---

### Task 2: `ownerId` — narrows, never widens (E20, E21)

This is the one task in the whole spec where a mistake causes a **data leak** rather than a broken filter.

**Files:**

- Modify: `server/src/dtos/time-bucket.dto.ts` (`TimeBucketQueryBaseSchema`)
- Modify: `server/src/repositories/asset.repository.ts` (`AssetBuilderOptions`, `withTimeBucketAssetFilters`)
- Test: `server/test/medium/specs/services/timeline.service.spec.ts`

**Interfaces:**

- Consumes: the two-owner Space fixture from Task 1 (`createTwoOwnerSpace`, `spaceBucketAssetIds`).
- Produces: `TimeBucketDto.ownerId?: string` (uuid) — consumed by Slice 2's web codec as the URL param **`owner`** (short form in URLs; `ownerId` in the API — this asymmetry is intentional, see spec §5.2).

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `server/test/medium/specs/services/timeline.service.spec.ts`:

```ts
describe('contextual filters — ownerId (Slice 1)', () => {
  it('narrows a Space timeline to one contributor', async () => {
    const { sut, ctx } = setup();
    const { space, anna, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: anna.id });

    // Anna's contribution only — Ben's asset is excluded.
    expect(ids).toEqual([annaAsset.id]);
  });

  it('E20: ownerId of a non-member returns EMPTY inside a Space (narrows, never widens)', async () => {
    const { sut, ctx } = setup();
    const { space, viewer } = await createTwoOwnerSpace(ctx);
    const { user: carol } = await ctx.newUser(); // not a member of the space
    const auth = factory.auth({ user: viewer });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: carol.id });

    expect(ids).toEqual([]);
  });

  it('E21: ownerId of a stranger on the personal timeline returns EMPTY (no leak)', async () => {
    const { sut, ctx } = setup();
    const { user: me } = await ctx.newUser();
    const { user: carol } = await ctx.newUser();

    // I MUST own an asset in the same bucket. Without this the assertion is vacuous:
    // an empty timeline returns [] whether or not the filter is applied at all, so the
    // test would pass on the RED run and prove nothing.
    const date = new Date('2026-01-15T10:00:00Z');
    const { asset: myAsset } = await ctx.newAsset({
      ownerId: me.id,
      fileCreatedAt: date,
      localDateTime: date,
    });
    await ctx.newExif({ assetId: myAsset.id, make: 'Apple', timeZone: 'UTC' });

    // Carol has an asset. It must never surface on my timeline.
    const { asset: carolAsset } = await ctx.newAsset({
      ownerId: carol.id,
      fileCreatedAt: date,
      localDateTime: date,
    });
    await ctx.newExif({ assetId: carolAsset.id, make: 'Apple', timeZone: 'UTC' });

    const auth = factory.auth({ user: me });

    // Baseline: my timeline is NOT empty. This is what makes the assertion below meaningful.
    const unfiltered = await sut.getTimeBuckets(auth, {});
    expect(unfiltered).not.toEqual([]);

    // timeBucketChecks defaults dto.userId to auth.user.id when no album/space scope is set
    // (timeline.service.ts:132), so the query is (ownerId = me) AND (ownerId = carol) = empty.
    const buckets = await sut.getTimeBuckets(auth, { ownerId: carol.id });
    expect(buckets).toEqual([]);
  });

  it('ownerId does NOT widen: it must not be OR-ed with the space predicate', async () => {
    const { sut, ctx } = setup();
    const { space, anna, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    // Anna also owns an asset OUTSIDE the space, in the SAME bucket. Filtering the space by
    // owner=anna must not pull it in.
    const { asset: outsideAsset } = await ctx.newAsset({
      ownerId: anna.id,
      fileCreatedAt: SPACE_DATE,
      localDateTime: SPACE_DATE,
    });
    await ctx.newExif({ assetId: outsideAsset.id, timeZone: 'UTC' });

    const ids = await spaceBucketAssetIds(sut, auth, space.id, { ownerId: anna.id });

    expect(ids).toEqual([annaAsset.id]);
    expect(ids).not.toContain(outsideAsset.id);
  });

  /**
   * THE ACTUAL WIDENING VECTOR. The userIds/timelineSpaceIds OR-group at
   * asset.repository.ts:362-380 only fires when `timelineSpaceIds` is set, and that only
   * happens under `withSharedSpaces: true` (timeline.service.ts:81-86).
   *
   * Every other test in this file leaves timelineSpaceIds undefined, so the `:359` clause
   * already ANDs — meaning an implementer who WRONGLY merged ownerId into options.userIds
   * would still pass all of them. These two tests are the only thing standing between that
   * mistake and a data leak. Do not delete them.
   */
  it('E21b: ownerId of a stranger under withSharedSpaces returns EMPTY (the real leak vector)', async () => {
    const { sut, ctx } = setup();
    const { space, viewer } = await createTwoOwnerSpace(ctx);
    const { user: carol } = await ctx.newUser();

    // Carol is a stranger with an asset, outside every space the viewer can see.
    const { asset: carolAsset } = await ctx.newAsset({
      ownerId: carol.id,
      fileCreatedAt: SPACE_DATE,
      localDateTime: SPACE_DATE,
    });
    await ctx.newExif({ assetId: carolAsset.id, make: 'Apple', timeZone: 'UTC' });

    const auth = factory.auth({ user: viewer });

    // withSharedSpaces sets timelineSpaceIds, which activates the userIds OR-group.
    // If ownerId were routed through userIds, Carol's asset would be OR-ed in => LEAK.
    //
    // `visibility` is REQUIRED here: timeline.service.ts:158-168 throws BadRequestException
    // when withSharedSpaces is combined with an undefined visibility. Omit it and the test
    // fails for the wrong reason and can never go green.
    const json = await sut.getTimeBucket(auth, {
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      ownerId: carol.id,
      timeBucket: SPACE_BUCKET,
    });
    const ids = (JSON.parse(json) as { id?: string[] }).id ?? [];

    expect(ids).toEqual([]);
    expect(ids).not.toContain(carolAsset.id);
  });

  it('E21c: ownerId under withSharedSpaces narrows to that member, not to everything', async () => {
    const { sut, ctx } = setup();
    const { anna, viewer, annaAsset, benAsset } = await createTwoOwnerSpace(ctx);
    const auth = factory.auth({ user: viewer });

    const json = await sut.getTimeBucket(auth, {
      withSharedSpaces: true,
      visibility: AssetVisibility.Timeline,
      ownerId: anna.id,
      timeBucket: SPACE_BUCKET,
    });
    const ids = (JSON.parse(json) as { id?: string[] }).id ?? [];

    expect(ids).toContain(annaAsset.id);
    expect(ids).not.toContain(benAsset.id);
  });
});
```

Notes for these two tests:

- **`AssetVisibility` is already imported** in this spec file, and `mediumFactory.assetInsert` defaults new
  assets to `AssetVisibility.Timeline` (`medium.factory.ts:655`), so the fixture assets are all visible under
  this filter and the assertions stay meaningful.
- **`showInTimeline`**: `sharedSpaceMemberInsert` hardcodes `showInTimeline: true` for every member
  (`medium.factory.ts:892-899`), and `getSpaceIdsForTimeline` filters on exactly that
  (`shared-space.repository.ts:218-225`) — so the viewer's space really is timeline-enabled and
  `timelineSpaceIds` is genuinely populated. These tests are not vacuous.
- **`userId` is set**: `timeBucketChecks` mutates `dto.userId = auth.user.id` in its else-branch
  (`timeline.service.ts:127-133`) before `buildTimeBucketOptions` runs, so `userIds = [viewer.id]` and the
  OR-group is genuinely active. That is the whole point of these two tests.

**Discrimination check** (why these two tests are worth more than all the others combined): under a WRONG
implementation that merges `ownerId` into `options.userIds`, E21b returns Carol's asset via the
`asset.ownerId = any(userIds)` arm (`asset.repository.ts:365`) and E21c returns Ben's asset via the
`shared_space_asset` EXISTS arm (`:366-371`) — both assertions fail. Under the correct separate-AND
implementation, both pass.

- [ ] **Step 2: Run the tests to verify they fail RED**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/timeline.service.spec.ts -t ownerId
```

Expected: **FAIL** — `ownerId` is not on `TimeBucketDto`, so it is a type error / is ignored at runtime
(the space queries return **both** assets instead of one, and the E21 personal-timeline query returns
nothing only by accident rather than by design).

- [ ] **Step 3: Add `ownerId` to the DTO**

In `server/src/dtos/time-bucket.dto.ts`, immediately after the `state` line added in Task 1:

```ts
    ownerId: z
      .uuidv4()
      .optional()
      .describe(
        'Filter by asset owner (contributor). Narrows within the current scope and never widens it. This is NOT the same as userId, which selects whose timeline is being composed.',
      ),
```

- [ ] **Step 4: Add `ownerId` to `AssetBuilderOptions`**

In `server/src/repositories/asset.repository.ts`, in `interface AssetBuilderOptions`, next to `userIds`:

```ts
  userIds?: string[];
  /**
   * Contributor filter: a plain AND on asset.ownerId. Deliberately separate from `userIds`,
   * which expresses timeline COMPOSITION and is OR-ed with `timelineSpaceIds` below. Routing a
   * contributor filter through `userIds` would WIDEN results inside a Space instead of narrowing.
   */
  ownerId?: string;
```

- [ ] **Step 5: Add the `ownerId` predicate as a separate top-level condition**

In `server/src/repositories/asset.repository.ts`, in `withTimeBucketAssetFilters`, add this immediately
after the `visibility` `$if` chain (i.e. right before the `.$if(!!options.albumId, ...)` clause at `:316`):

```ts
    .$if(!!options.ownerId, (qb) => qb.where('asset.ownerId', '=', asUuid(options.ownerId!)))
```

`asUuid` is already imported in this file (it is used at `:319`). **Do not** add `ownerId` to the
`options.userIds` clauses at `:359-373` — that is the trap this whole task exists to avoid.

- [ ] **Step 6: Run the tests to verify they pass GREEN**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/timeline.service.spec.ts
```

Expected: **PASS** — all four new `ownerId` tests plus everything from Task 1 and the pre-existing suite.

- [ ] **Step 7: Typecheck and lint**

```bash
cd server && pnpm check && pnpm format:fix && pnpm lint
```

Expected: typecheck clean; lint clean with **zero warnings** (`--max-warnings 0`). `pnpm format` is a CI
gate, so `format:fix` first.

- [ ] **Step 8: Commit**

```bash
git add server/src/dtos/time-bucket.dto.ts server/src/repositories/asset.repository.ts \
        server/test/medium/specs/services/timeline.service.spec.ts
git commit -m "feat(timeline): filter by ownerId (contributor)

A plain AND on asset.ownerId, deliberately kept separate from the existing
userIds option. userIds expresses timeline composition and is OR-ed with
timelineSpaceIds, so routing a contributor filter through it would WIDEN
results inside a Space rather than narrow them.

Tested for the leak case in both directions: owner=<non-member> inside a
Space and owner=<stranger> on the personal timeline both return empty."
```

---

### Task 3: Regression guards for the pre-existing RBAC behavior (E19, E22)

These tests are **expected to pass on the first run.** That is correct and intentional — they are
_characterization_ tests. They do not drive new code; they pin down behavior that already works so a
future refactor cannot silently reintroduce the #655 bug (viewers seeing empty camera/location facets
for assets owned by someone else). Do not "fix" anything if they pass immediately.

**Files:**

- Test: `server/test/medium/specs/services/timeline.service.spec.ts` (E22)
- Test: `server/test/medium/specs/services/search.service.spec.ts` (E19)

**Interfaces:**

- Consumes: `createTwoOwnerSpace` from Task 1.

- [ ] **Step 1: E17 (make/model variant) — a Space viewer filters by a camera they do not own**

The spec's Slice-1 BDD lists E17 against `make="Apple"`. `make` **already works**, so unlike the
lens/state variants in Task 1 this one cannot be red — it is a pure regression guard for the #655 class.
Add it to `server/test/medium/specs/services/timeline.service.spec.ts` inside the
`contextual filters — lensModel / state (Slice 1)` describe block created in Task 1:

```ts
it('E17: a Space VIEWER filters by a CAMERA MAKE on an asset they do not own', async () => {
  const { sut, ctx } = setup();
  const { space, viewer, annaAsset } = await createTwoOwnerSpace(ctx);
  const auth = factory.auth({ user: viewer });

  const ids = await spaceBucketAssetIds(sut, auth, space.id, {
    make: 'Apple',
    model: 'iPhone 17 Pro Max',
  });

  // Regression guard: passes today. If someone reintroduces an ownerId predicate into the
  // Space timeline scope, this flips to [] — issue #655.
  expect(ids).toEqual([annaAsset.id]);
});
```

- [ ] **Step 2: E19 — camera suggestions in a Space include other members' cameras**

`server/test/medium/specs/services/search.service.spec.ts` **already** imports `SharedSpaceRepository`,
`AlbumUserRole` and `SearchRepository`, and already registers them in its `setup` `real:` list — **no
imports or setup changes are needed there.** It also already has a `describe('getFilterSuggestions', ...)`
block (starting `:382`), but every existing test in it is owner-scoped (no `spaceId`), so this Space-scoped
case is genuinely new.

Add this test inside that existing `describe('getFilterSuggestions', ...)` block:

```ts
it('E19: camera suggestions in a Space include cameras from assets the viewer does not own', async () => {
  const { sut, ctx } = setup();
  const { user: anna } = await ctx.newUser();
  const { user: ben } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();

  const { space } = await ctx.newSharedSpace({ createdById: anna.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: anna.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: ben.id, role: SharedSpaceRole.Editor });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: SharedSpaceRole.Viewer });

  for (const [ownerId, make] of [
    [anna.id, 'Apple'],
    [ben.id, 'Canon'],
  ] as const) {
    const { asset } = await ctx.newAsset({ ownerId });
    await ctx.newExif({ assetId: asset.id, make, timeZone: 'UTC' });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: ownerId });
  }

  const auth = factory.auth({ user: { id: viewer.id } });
  const result = await sut.getFilterSuggestions(auth, { spaceId: space.id });

  // applySuggestionScope's spaceId branch (search.repository.ts:1257-1274) carries NO ownerId
  // predicate. If someone reintroduces one, the viewer sees an empty dropdown — issue #655.
  expect(result.cameraMakes).toEqual(expect.arrayContaining(['Apple', 'Canon']));
});
```

Add `SharedSpaceRole` to the existing `src/enum` import in that file:

```ts
import { AlbumUserRole, AssetVisibility, SharedSpaceRole } from 'src/enum';
```

- [ ] **Step 3: E22 — an album viewer filters by the album owner's camera**

In `server/test/medium/specs/services/timeline.service.spec.ts`. Note `ctx.newAlbum` takes the asset ids as
its **second argument** and links them itself (`medium.factory.ts:227-236`), so there is no need for
`ctx.newAlbumAsset`. It also already registers the owner as an `AlbumUserRole.Owner` album user.

**Now** add `AlbumUserRole` to the `src/enum` import in this file (it was deliberately left out in Task 1,
where it would have been an unused import and failed the zero-warning lint gate):

```ts
import {
  AlbumUserRole,
  AssetOrder,
  AssetType,
  AssetVisibility,
  SharedLinkType,
  SharedSpaceRole,
  TimeBucketSize,
} from 'src/enum';
```

Use **double quotes** for the test title below — a `\'` escape inside a single-quoted string gets rewritten
by prettier, and `pnpm format` is a CI gate.

```ts
it("E22: an album viewer filters by the album owner's camera and sees their assets", async () => {
  const { sut, ctx } = setup();
  const { user: anna } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();

  const date = new Date('2026-01-15T10:00:00Z');
  const { asset } = await ctx.newAsset({ ownerId: anna.id, fileCreatedAt: date, localDateTime: date });
  await ctx.newExif({ assetId: asset.id, make: 'Apple', timeZone: 'UTC' });

  const { album } = await ctx.newAlbum({ ownerId: anna.id }, [asset.id]);
  await ctx.newAlbumUser({ albumId: album.id, userId: viewer.id, role: AlbumUserRole.Viewer });

  const auth = factory.auth({ user: viewer });
  const json = await sut.getTimeBucket(auth, {
    albumId: album.id,
    make: 'Apple',
    timeBucket: SPACE_BUCKET,
  });

  expect((JSON.parse(json) as { id?: string[] }).id ?? []).toEqual([asset.id]);
});
```

- [ ] **Step 4: Run both medium specs**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/timeline.service.spec.ts test/medium/specs/services/search.service.spec.ts
```

Expected: **PASS on the first run.** These are characterization tests (see the note at the top of this
task). If E19 **fails**, that is a genuine live bug — the #655 class has already regressed for Spaces —
stop and report it rather than editing the assertion.

- [ ] **Step 5: Commit**

```bash
git add server/test/medium/specs/services/timeline.service.spec.ts \
        server/test/medium/specs/services/search.service.spec.ts
git commit -m "test(timeline,search): pin RBAC facets for non-owned assets

Characterization tests for behavior that already works: a Space viewer's
camera suggestions include other members' cameras, and an album viewer can
filter by the album owner's camera. Both guard the issue #655 bug class
(viewers getting empty facets for assets they do not own) against future
regressions in applySuggestionScope."
```

---

### Task 4: Regenerate the SDK and run the full gate

**Files:**

- Modify (generated): `open-api/typescript-sdk/**`, `mobile/openapi/**`

- [ ] **Step 1: Regenerate the OpenAPI spec + clients**

```bash
mise open-api
```

**Not `make open-api`** — that target was removed and now exits 1 (`Makefile:135-140`). And there is no
`pnpm sync:open-api` script; it is the mise task `//server:sync-open-api`. The single `mise open-api` task
(`mise.toml:67-76`) already chains: plugins → server install → server build → `sync-open-api` →
`open-api-typescript` → `open-api-dart`. Java 21 is required for the Dart generator and is present.

- [ ] **Step 2: Verify the three new fields landed in the TypeScript SDK**

```bash
grep -n "lensModel" packages/sdk/src/fetch-client.ts | head
```

The generated SDK source is **`packages/sdk/src/fetch-client.ts`** (`mise.toml:58`) — **not**
`open-api/typescript-sdk/src/`, which does not exist (that directory holds only `build/`).

Expected: `lensModel` (and `state`, `ownerId`) appear in the `getTimeBucket` / `getTimeBuckets`
destructured parameter lists, alongside the existing `make` / `model`.

- [ ] **Step 3: Run the full server gate**

```bash
cd server && pnpm test -- --run && pnpm check && pnpm format:fix && pnpm lint
```

Expected: all unit tests pass, typecheck clean, lint clean with **zero warnings**. `pnpm format` (prettier
`--check`) is a CI gate for the server, so run `format:fix` before committing.

- [ ] **Step 4: Confirm NO migration and NO generated-SQL churn**

```bash
git status --short server/src/schema/migrations-gallery/ server/src/queries/
```

Expected: **empty output on both.** If a migration file appeared, delete it (see Global Constraints — these
are exact-match predicates on existing columns). If `server/src/queries/asset.repository.sql` changed, the
`@GenerateSql` dummy params must have picked up one of the new fields — investigate rather than committing
it, and **do not** run `mise sql` to "fix" it.

- [ ] **Step 5: Commit the regenerated clients**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore(api): regenerate SDK for lensModel/state/ownerId timeline filters"
```

**`packages/sdk` must be in the `git add`** — omitting it silently drops the regenerated TypeScript SDK, and
Slice 2's web work would then have no typed fields to consume.

---

## Done When

- `lensModel`, `state` and `ownerId` filter the timeline correctly (Tasks 1–2).
- A Space **viewer** and **editor** can filter by lens/state/camera and see assets owned by **other
  members** — E17, E18 — proven on a **two-owner** Space fixture.
- `ownerId` provably narrows and never widens: E20 (non-member inside a Space → empty) and E21
  (stranger on the personal timeline → empty).
- E19 and E22 pin the pre-existing non-owner facet behavior against regression.
- SDK + Dart client regenerated and committed.
- **No migration added.**
