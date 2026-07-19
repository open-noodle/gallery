# Slice 1 — Album-Read Visibility Gate: HIGH Metadata Leaks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close security-1 (album-scoped `POST /search/metadata` leaks the owner's Hidden assets to any space member) and security-3 (`GET /timeline/bucket?albumId=…&visibility=hidden` leaks the same via the album path), so album read surfaces never surface Hidden/Locked metadata that #754 blocked.

**Architecture:** Three server-side query/guard edits, each a flat `spaceVisibilityGate` (Archive+Timeline, no owner exception — consistent with the album grid's `withDefaultVisibility`) or a `BadRequestException` guard: (1) reject `albumId` + Hidden/Locked in `timeBucketChecks`; (2) gate the plain-album OR-branch of `albumSharedSpaceScope`; (3) gate the asset-repo `albumId` arm as defense-in-depth. Each fix is driven red-first by a test at the layer where the leak lives (unit for the guard, unit SQL-shape + medium behavior for the search predicate, medium behavior for the repo arm), then locked with e2e negatives over both HTTP surfaces.

**Tech Stack:** NestJS 11 + Kysely (type-safe SQL) server; Vitest unit + medium (testcontainers Postgres) tests; e2e Vitest + supertest against the `make e2e` API stack.

## Global Constraints

- **No relative imports in `server/`** — use the `src/` path alias (enforced by ESLint).
- **Prettier**: 120-char width, single quotes, trailing commas, semicolons.
- **TDD is mandatory** (spec §0.1): every fix is red-first with a captured command + expected failure, then green, then a final full-suite validation for the touched package. A test that passes on first run is a red flag.
- **Flat gate, no owner exception** (spec §0.4): the album _content_ read surfaces use `spaceVisibilityGate(eb)` / `withDefaultVisibility` with **no** `own OR` — the album grid already hides the owner's own Hidden/Locked, so an owner exception here would be an inconsistency. Only the non-album `userIds` search path keeps its existing `own OR gate` and stays untouched.
- **No Claude co-author trailers** on commits (spec §0.3). One commit per fix-group; boundaries defined per task below.
- **No SDK/DTO changes** in this slice — no endpoint or DTO signature changes, so no `make build-sdk` / `make open-api` needed. (`visibility` is already `AssetVisibilitySchema.optional()` on the search DTO and an existing field on `TimeBucketDto`.)
- **No `make sql` in this slice** — no `@GenerateSqlQueries`-decorated repository method signature changes (the edits are inside `searchAssetBuilder` / the `getTimeBucket*` query bodies, whose generated SQL fixtures are not asserted by these tasks). Do **not** run `make sql` without a running scratch DB (deletes query files).

### Reference: exact run commands (hand these to implementers)

```bash
# Unit (server) — single file, one-shot
cd server && pnpm test -- --run src/services/timeline.service.spec.ts
cd server && pnpm test -- --run src/repositories/search.repository.spec.ts

# Medium (server) — needs Docker (testcontainers spins up its own Postgres)
cd server && pnpm test:medium -- --run test/medium/specs/services/search.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts

# e2e (API) — needs the e2e stack (`make e2e` up on :2285)
cd e2e && pnpm test -- --run src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts

# Type/lint gate for the package
make check-server && make lint-server
```

---

## File map

- **Modify** `server/src/services/timeline.service.ts` — `timeBucketChecks` private-visibility rejection (Fix 2 / security-3 primary).
- **Modify** `server/src/utils/database.ts` — `albumSharedSpaceScope` plain-album OR-branch (Fix 1 / security-1).
- **Modify** `server/src/repositories/asset.repository.ts` — the `.$if(!!options.albumId, …)` arm (Fix 3 / security-3 defense-in-depth).
- **Modify (tests)**:
  - `server/src/services/timeline.service.spec.ts` — unit for `timeBucketChecks`.
  - `server/src/repositories/search.repository.spec.ts` — unit SQL-shape for the plain-album search branch.
  - `server/test/medium/specs/services/search.service.spec.ts` — medium behavior for `searchMetadata` album path.
  - `server/test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts` — medium behavior for the repo `albumId` arm.
  - `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` — e2e negatives for both HTTP surfaces.

**Task order** (keeps the repo green between commits — the e2e in T4 depends on all three server fixes): T1 timeline guard → T2 search predicate → T3 repo arm → T4 e2e → T5 full-suite validation.

---

### Task 1: `timeBucketChecks` rejects `albumId` + Hidden/Locked (security-3 primary)

**Files:**

- Modify: `server/src/services/timeline.service.ts:133-138` (the `spaceBrowse` private-visibility rejection)
- Test: `server/src/services/timeline.service.spec.ts` (add a new `describe` block)

**Interfaces:**

- Consumes: `TimelineService.getTimeBuckets(auth, dto)` / `getTimeBucket(auth, dto)` — both call the private `timeBucketChecks` first (`timeline.service.ts:20,36`).
- Produces: no signature change. Behavior: `albumId` + `visibility` ∈ {Hidden, Locked} → `BadRequestException` for everyone (flat, no owner exception), thrown before the repo call and before the `AlbumRead` access check.

- [ ] **Step 1: Write the failing tests**

Add this `describe` block inside the top-level `describe(TimelineService.name, …)` in `server/src/services/timeline.service.spec.ts` (e.g. right after the existing `describe('edge cases', …)` block, before the final closing `});`). It reuses the file's existing imports (`BadRequestException`, `AssetVisibility`, `TimeBucketSize`, `authStub`).

```ts
describe('album browse visibility (Slice 1 / security-3)', () => {
  // The rejection is flat — even the album owner (here: an elevated admin, mocked to hold
  // album access) is refused Hidden/Locked via the album path, matching the album grid.
  it('rejects Hidden visibility on an albumId browse for getTimeBuckets', async () => {
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
    mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 1 }]);

    await expect(
      sut.getTimeBuckets(authStub.adminWithElevatedPermission, {
        albumId: 'album-id',
        visibility: AssetVisibility.Hidden,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.asset.getTimeBuckets).not.toHaveBeenCalled();
  });

  it('rejects Locked visibility on an albumId browse for getTimeBuckets', async () => {
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
    mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 1 }]);

    await expect(
      sut.getTimeBuckets(authStub.adminWithElevatedPermission, {
        albumId: 'album-id',
        visibility: AssetVisibility.Locked,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.asset.getTimeBuckets).not.toHaveBeenCalled();
  });

  it('rejects Hidden visibility on an albumId browse for getTimeBucket', async () => {
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
    mocks.asset.getTimeBucket.mockResolvedValue({ assets: `[{ id: ['asset-id'] }]` });

    await expect(
      sut.getTimeBucket(authStub.adminWithElevatedPermission, {
        timeBucket: '2024-01-01',
        albumId: 'album-id',
        visibility: AssetVisibility.Hidden,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(mocks.asset.getTimeBucket).not.toHaveBeenCalled();
  });

  it('allows Archive visibility on an albumId browse (Archive is shareable)', async () => {
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
    mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 1 }]);

    await expect(
      sut.getTimeBuckets(authStub.admin, { albumId: 'album-id', visibility: AssetVisibility.Archive }),
    ).resolves.toEqual([{ timeBucket: '2024-01-01', count: 1 }]);

    expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'album-id' }));
  });

  it('allows default (undefined) visibility on an albumId browse', async () => {
    mocks.access.album.checkOwnerAccess.mockResolvedValue(new Set(['album-id']));
    mocks.asset.getTimeBuckets.mockResolvedValue([{ timeBucket: '2024-01-01', count: 1 }]);

    await expect(sut.getTimeBuckets(authStub.admin, { albumId: 'album-id' })).resolves.toEqual([
      { timeBucket: '2024-01-01', count: 1 },
    ]);

    expect(mocks.asset.getTimeBuckets).toHaveBeenCalledWith(expect.objectContaining({ albumId: 'album-id' }));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail (RED)**

Run: `cd server && pnpm test -- --run src/services/timeline.service.spec.ts`

Expected: the three `rejects…` tests FAIL. Pre-fix, `albumId` is not part of `spaceBrowse`, so no rejection is thrown; `checkOwnerAccess` is mocked to grant access, so the call proceeds into `super.getTimeBuckets`/`getTimeBucket` (mocked to resolve). The `rejects.toThrow(BadRequestException)` assertions fail (the promise resolves) and the `not.toHaveBeenCalled()` assertions fail (the repo mock _was_ called). The two "allows …" tests pass on first run (they are the positive-control guard, not the RED driver).

- [ ] **Step 3: Apply the minimal fix**

In `server/src/services/timeline.service.ts`, add `dto.albumId` to the `spaceBrowse` condition and broaden the message. Change:

```ts
const spaceBrowse = !!dto.spaceId || !!dto.spacePersonId;
const requestsPrivateVisibility =
  dto.visibility === AssetVisibility.Hidden || dto.visibility === AssetVisibility.Locked;
if (spaceBrowse && requestsPrivateVisibility) {
  throw new BadRequestException('Hidden and locked assets are not available when browsing a shared space');
}
```

to:

```ts
const spaceBrowse = !!dto.spaceId || !!dto.spacePersonId || !!dto.albumId;
const requestsPrivateVisibility =
  dto.visibility === AssetVisibility.Hidden || dto.visibility === AssetVisibility.Locked;
if (spaceBrowse && requestsPrivateVisibility) {
  throw new BadRequestException('Hidden and locked assets are not available when browsing a shared space or album');
}
```

- [ ] **Step 4: Run the tests to verify they pass (GREEN)**

Run: `cd server && pnpm test -- --run src/services/timeline.service.spec.ts`

Expected: PASS (all tests in the file, including the pre-existing `spaceId`/`spacePersonId` rejection tests, which are unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/timeline.service.ts server/src/services/timeline.service.spec.ts
git commit -m "fix(spaces): reject Hidden/Locked album-scoped timeline buckets (security-3)"
```

---

### Task 2: Gate the plain-album search branch in `albumSharedSpaceScope` (security-1)

**Files:**

- Modify: `server/src/utils/database.ts:612-619` (the first OR-branch `eb.and([...])` inside `albumSharedSpaceScope`)
- Test (unit SQL-shape): `server/src/repositories/search.repository.spec.ts` (add one `it` in the existing album-branch `describe`, near line 597)
- Test (medium behavior): `server/test/medium/specs/services/search.service.spec.ts` (add a new `describe` after the existing `describe('albumIds option', …)`, ~line 485)

**Interfaces:**

- Consumes: `spaceVisibilityGate(eb)` from `src/utils/shared-space-album-scope` — already imported and used in `database.ts` (the two `timelineSpaceIds` branches at `:626,:636`). Predicate: `asset.visibility IN (Archive, Timeline)`.
- Produces: `albumSharedSpaceScope`'s first OR-branch now ANDs the flat visibility gate, so a Hidden/Locked asset reachable only via a linked (or plain) album is excluded from `searchAssetBuilder` when `albumIds` is set and `userIds` is unset (the album-scoped `searchMetadata` path — `search.service.ts:142-146`; `database.ts:709`).

- [ ] **Step 1a: Write the failing unit SQL-shape test**

In `server/src/repositories/search.repository.spec.ts`, inside the `describe` that already contains `'searchAssetBuilder album-scoped branch gates space assets on Archive+Timeline visibility'` (the block ending ~line 610), add:

```ts
it('searchAssetBuilder plain-album branch (no timelineSpaceIds) gates on Archive+Timeline visibility (security-1)', () => {
  // albumSharedSpaceScope's FIRST OR-branch (plain non-shared-space album assets) had NO
  // visibility gate, so a Hidden asset reachable only via a linked album leaked. With ONLY
  // albumIds set (no timelineSpaceIds, no userIds) that branch is the sole album predicate —
  // it must now carry the flat visibility gate.
  const sql = buildAssetSearchSql({
    albumIds: ['11111111-1111-1111-1111-111111111111'],
  });

  expect(sql).toMatch(/"asset"\."visibility" in \(\$\d+(?:, \$\d+)*\)/);
});
```

- [ ] **Step 1b: Write the failing medium behavior tests**

In `server/test/medium/specs/services/search.service.spec.ts`, add this `describe` immediately after the existing `describe('albumIds option', …)` block (it reuses the file's `setup`, `factory`, `AssetVisibility`, and `ctx.*` helpers):

```ts
describe('albumIds option — visibility gate (Slice 1 / security-1)', () => {
  // Owner's album carrying one asset per visibility, linked into a space with a Viewer member.
  const seedAlbumWithVisibilities = async (ctx: SearchCtx) => {
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'VisAlbum' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: archiveAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Archive });
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    const { asset: lockedAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Locked });
    for (const asset of [timelineAsset, archiveAsset, hiddenAsset, lockedAsset]) {
      await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });
    }

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: member.id, role: 'viewer' });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    return { owner, member, album, space, timelineAsset, archiveAsset, hiddenAsset, lockedAsset };
  };

  const itemIds = (response: Awaited<ReturnType<SearchService['searchMetadata']>>) =>
    response.assets.items.map((item) => item.id);

  it('hides a Hidden album asset from a Viewer member (default visibility); Timeline+Archive present, Locked absent', async () => {
    const { sut, ctx } = setup();
    const s = await seedAlbumWithVisibilities(ctx);
    const auth = factory.auth({ user: { id: s.member.id } });

    const response = await sut.searchMetadata(auth, { albumIds: [s.album.id] });
    const ids = itemIds(response);

    expect(ids).toContain(s.timelineAsset.id);
    expect(ids).toContain(s.archiveAsset.id); // Archive is shareable — not stripped
    expect(ids).not.toContain(s.hiddenAsset.id); // security-1: Hidden gated on the album path
    expect(ids).not.toContain(s.lockedAsset.id); // Locked never present
  });

  it('hides a Hidden album asset even when the member explicitly requests visibility=hidden', async () => {
    const { sut, ctx } = setup();
    const s = await seedAlbumWithVisibilities(ctx);
    const auth = factory.auth({ user: { id: s.member.id } });

    const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], visibility: AssetVisibility.Hidden });

    expect(itemIds(response)).not.toContain(s.hiddenAsset.id);
  });

  it("hides the OWNER's own Hidden album asset via the album path (flat gate, matches the grid)", async () => {
    const { sut, ctx } = setup();
    const s = await seedAlbumWithVisibilities(ctx);
    const ownerAuth = factory.auth({ user: { id: s.owner.id } });

    const response = await sut.searchMetadata(ownerAuth, {
      albumIds: [s.album.id],
      visibility: AssetVisibility.Hidden,
    });

    expect(itemIds(response)).not.toContain(s.hiddenAsset.id);
  });

  it('OWNER still finds their Hidden asset via the non-album userIds search path (untouched)', async () => {
    const { sut, ctx } = setup();
    const s = await seedAlbumWithVisibilities(ctx);
    const ownerAuth = factory.auth({ user: { id: s.owner.id } });

    // No albumIds -> userIds = [owner], scoped to ownerId + explicit Hidden. This path keeps its
    // own `own OR gate` and is untouched by the fix.
    const response = await sut.searchMetadata(ownerAuth, { visibility: AssetVisibility.Hidden });

    expect(itemIds(response)).toContain(s.hiddenAsset.id);
  });

  it('gates a Hidden asset reachable via an album linked into TWO spaces (member of one)', async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: member } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'TwoSpaceAlbum' });

    const { asset: timelineAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    const { asset: hiddenAsset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Hidden });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: timelineAsset.id });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: hiddenAsset.id });

    const { space: spaceA } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: spaceB.id, userId: owner.id, role: 'owner' });
    // member belongs ONLY to spaceA
    await ctx.newSharedSpaceMember({ spaceId: spaceA.id, userId: member.id, role: 'viewer' });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceA.id, albumId: album.id });
    await ctx.newSharedSpaceAlbum({ spaceId: spaceB.id, albumId: album.id });

    const auth = factory.auth({ user: { id: member.id } });
    const response = await sut.searchMetadata(auth, { albumIds: [album.id] });
    const ids = itemIds(response);

    expect(ids).toContain(timelineAsset.id);
    expect(ids).not.toContain(hiddenAsset.id);
  });

  it('a member of NEITHER space has no album.read access (403-empty)', async () => {
    const { sut, ctx } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: stranger } = await ctx.newUser();
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'NoAccessAlbum' });
    const { asset } = await ctx.newAsset({ ownerId: owner.id, visibility: AssetVisibility.Timeline });
    await ctx.newAlbumAsset({ albumId: album.id, assetId: asset.id });

    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id });

    const strangerAuth = factory.auth({ user: { id: stranger.id } });

    await expect(sut.searchMetadata(strangerAuth, { albumIds: [album.id] })).rejects.toThrow(
      'Not found or no album.read access',
    );
  });

  it('gate still applies when albumIds is combined with a personIds filter', async () => {
    const { sut, ctx } = setup();
    const s = await seedAlbumWithVisibilities(ctx);

    // A person whose face sits on BOTH the Timeline and the Hidden album asset. Combining the
    // album scope with the person scope must not open a bypass — the Hidden asset stays gated.
    const { person } = await ctx.newPerson({ ownerId: s.owner.id, name: 'ComboPerson' });
    await ctx.newAssetFace({ assetId: s.timelineAsset.id, personId: person.id });
    await ctx.newAssetFace({ assetId: s.hiddenAsset.id, personId: person.id });

    const auth = factory.auth({ user: { id: s.member.id } });
    const response = await sut.searchMetadata(auth, { albumIds: [s.album.id], personIds: [person.id] });
    const ids = itemIds(response);

    expect(ids).toContain(s.timelineAsset.id);
    expect(ids).not.toContain(s.hiddenAsset.id);
  });
});
```

Note: this uses `SearchService` in a type annotation — add it to the existing import from `src/services/search.service` (already imported at line 14, so no new import needed).

- [ ] **Step 2: Run both test layers to verify they fail (RED)**

Run:

```bash
cd server && pnpm test -- --run src/repositories/search.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/services/search.service.spec.ts
```

Expected:

- Unit: the new `plain-album branch … gates on Archive+Timeline` test FAILS — with only `albumIds` set (no `timelineSpaceIds`, no `visibility`, no `userIds`), the compiled SQL has no `"asset"."visibility" in (…)` clause at all (the plain-album branch is `NOT EXISTS shared_space_asset AND NOT EXISTS shared_space_library` with no gate), so the regex does not match.
- Medium: the `hides a Hidden album asset …`, `… explicitly requests visibility=hidden`, `hides the OWNER's own …`, `two spaces …`, and `combined with a personIds filter` tests FAIL — pre-fix the ungated plain-album branch returns the Hidden asset. The `OWNER still finds … via the non-album path` and `member of NEITHER space` tests pass on first run (they pin untouched behavior).

- [ ] **Step 3: Apply the minimal fix**

In `server/src/utils/database.ts`, add the flat gate as a conjunct to the first OR-branch of `albumSharedSpaceScope`. Change:

```ts
      eb.and([
        eb.not(eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id'))),
        eb.not(
          eb.exists(
            eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId'),
          ),
        ),
      ]),
```

to:

```ts
      eb.and([
        // Fork RBAC (Slice 1 / security-1): the plain-album branch (assets NOT reached via a
        // direct shared_space_asset / shared_space_library) had no visibility gate, so a Hidden or
        // Locked asset reachable only through a linked album leaked to album searchers. Gate it flat
        // (Archive+Timeline, no owner exception) to match the album grid's withDefaultVisibility.
        spaceVisibilityGate(eb),
        eb.not(eb.exists(eb.selectFrom('shared_space_asset').whereRef('shared_space_asset.assetId', '=', 'asset.id'))),
        eb.not(
          eb.exists(
            eb.selectFrom('shared_space_library').whereRef('shared_space_library.libraryId', '=', 'asset.libraryId'),
          ),
        ),
      ]),
```

- [ ] **Step 4: Run both test layers to verify they pass (GREEN)**

Run:

```bash
cd server && pnpm test -- --run src/repositories/search.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/services/search.service.spec.ts
```

Expected: PASS (all tests in both files, including the pre-existing `'should return assets from shared album'` medium test — its album asset is Timeline, so the flat gate keeps it).

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/database.ts server/src/repositories/search.repository.spec.ts server/test/medium/specs/services/search.service.spec.ts
git commit -m "fix(spaces): gate plain-album search branch on shareable visibility (security-1)"
```

---

### Task 3: Gate the asset-repo `albumId` arm (security-3 defense-in-depth)

**Files:**

- Modify: `server/src/repositories/asset.repository.ts:295-299` (the `.$if(!!options.albumId, …)` arm)
- Test (medium behavior): `server/test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts` (add a new `describe`)

**Interfaces:**

- Consumes: `spaceVisibilityGate` from `src/utils/shared-space-album-scope` — already imported and used in `asset.repository.ts` (the `spaceId` arm at `:328`).
- Produces: the `albumId` timeline arm ANDs the flat visibility gate, so an explicit `visibility=Hidden`/`Locked` on `getTimeBuckets`/`getTimeBucket`/`getTimeBucketCovers` can never surface Hidden/Locked album assets even if the service-level guard (Task 1) is bypassed. The top-level `withDefaultVisibility` (`:293`) only fires when `options.visibility === undefined`, which is why an explicit visibility needs this arm gated. The gate is idempotent for the album grid's default view (`withDefaultVisibility` is the same `IN (Archive, Timeline)` predicate).

- [ ] **Step 1: Write the failing tests**

In `server/test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts`, add this `describe` at the end of the file (before the final line). It reuses the file's existing `setup`, `makeBucketAsset`, `countBuckets`, `bucketAssetIds`, `BUCKET`, `AssetVisibility`, `TimeBucketSize`, and `TimeBucketOptions`.

```ts
// ─────────────────────────────────────────────────────────────────────────────
// PATH 4: albumId arm (explicit visibility bypasses withDefaultVisibility)
// ─────────────────────────────────────────────────────────────────────────────

describe('timeline bucket explicit-visibility — albumId arm', () => {
  const seedAlbum = async (ctx: ReturnType<typeof setup>['ctx'], spaceRepo: ReturnType<typeof setup>['spaceRepo']) => {
    const { user: owner } = await ctx.newUser();
    const { user: viewer } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'AlbumArm' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    const hidden = await makeBucketAsset(ctx, owner.id, AssetVisibility.Hidden);
    const locked = await makeBucketAsset(ctx, owner.id, AssetVisibility.Locked);
    const archive = await makeBucketAsset(ctx, owner.id, AssetVisibility.Archive);
    const timeline = await makeBucketAsset(ctx, owner.id, AssetVisibility.Timeline);
    for (const assetId of [hidden, locked, archive, timeline]) {
      await ctx.newAlbumAsset({ albumId: album.id, assetId });
    }

    return { owner, viewer, album, hidden, locked, archive, timeline };
  };

  it('visibility=HIDDEN via albumId surfaces NO Hidden album asset (viewer OR owner — flat gate)', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Hidden,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts))).toBe(0);

    const asViewer = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(asViewer.has(s.hidden)).toBe(false);

    // Flat: even the album owner does not see their own Hidden via the album arm.
    const asOwner = await bucketAssetIds(assetRepo, BUCKET, opts, s.owner.id);
    expect(asOwner.has(s.hidden)).toBe(false);
  });

  it('visibility=LOCKED via albumId surfaces NO Locked album asset', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Locked,
      bucketSize: TimeBucketSize.Year,
    };

    expect(countBuckets(await assetRepo.getTimeBuckets(opts))).toBe(0);
    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.locked)).toBe(false);
  });

  it('regression: visibility=Timeline via albumId STILL returns the Timeline album asset', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
    };

    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.timeline)).toBe(true);
  });

  it('regression: visibility=Archive via albumId STILL returns the Archive album asset (Archive is shareable)', async () => {
    const { assetRepo, spaceRepo, ctx } = setup();
    const s = await seedAlbum(ctx, spaceRepo);

    const opts: TimeBucketOptions = {
      albumId: s.album.id,
      visibility: AssetVisibility.Archive,
      bucketSize: TimeBucketSize.Year,
    };

    const ids = await bucketAssetIds(assetRepo, BUCKET, opts, s.viewer.id);
    expect(ids.has(s.archive)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the medium tests to verify they fail (RED)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts`

Expected: the `visibility=HIDDEN via albumId …` and `visibility=LOCKED via albumId …` tests FAIL — pre-fix the `albumId` arm is a bare `album_asset` join with no visibility gate, so with an explicit `visibility=Hidden`/`Locked` the top-level filter is `asset.visibility = <requested>` and the Hidden/Locked album assets surface (count 1, id present). The two `regression` tests pass on first run (Timeline/Archive already pass the top-level filter).

- [ ] **Step 3: Apply the minimal fix**

In `server/src/repositories/asset.repository.ts`, add a flat visibility gate to the `albumId` arm. Change:

```ts
    .$if(!!options.albumId, (qb) =>
      qb
        .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
        .where('album_asset.albumId', '=', asUuid(options.albumId!)),
    )
```

to:

```ts
    .$if(!!options.albumId, (qb) =>
      qb
        .innerJoin('album_asset', 'asset.id', 'album_asset.assetId')
        .where('album_asset.albumId', '=', asUuid(options.albumId!))
        // Fork RBAC (Slice 1 / security-3 defense-in-depth): an explicit visibility=HIDDEN/LOCKED
        // bypasses the top-level withDefaultVisibility (which only fires when visibility is
        // undefined). Flat-gate the album arm so Hidden/Locked album assets never surface via the
        // timeline bucket, even if the service-level guard is bypassed. Idempotent for the default
        // album grid view (withDefaultVisibility is the same Archive+Timeline predicate).
        .where((eb) => spaceVisibilityGate(eb)),
    )
```

- [ ] **Step 4: Run the medium tests to verify they pass (GREEN)**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts`

Expected: PASS (all tests in the file, including the pre-existing `spaceId`/`timelineSpaceIds`/`spacePersonIds` path tests).

- [ ] **Step 5: Guard against regressing the existing `albumId` bucket test**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts`

Expected: PASS. The `'filters by video type, album, tag, and stacked state'` test (uses `visibility: AssetVisibility.Timeline` + `albumId`) stays green — Timeline passes the flat gate.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/asset.repository.ts server/test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts
git commit -m "fix(spaces): gate asset-repo albumId timeline arm on shareable visibility (security-3)"
```

---

### Task 4: e2e negatives over both HTTP surfaces

**Files:**

- Test: `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts` (add two new `describe` blocks + one import)

**Interfaces:**

- Consumes existing helpers in the file/utils (all confirmed present): `utils.createAsset`, `utils.createAlbum`, `utils.createSpace` (via the file's `freshSpace`), `utils.addSpaceMember`, the file's `setVisibility(assetId, visibility)` helper, and the `PUT /shared-spaces/:spaceId/albums/:albumId` link call. A space member gets `AlbumRead`/`AlbumDownload` on a linked album via `checkSpaceLinkedAlbumReadAccess` (already exercised by the file's existing `POST /download/info (albumId …)` block).
- Produces: HTTP-level proof that both fixes hold end-to-end.

- [ ] **Step 1: Add the search-metadata + timeline-bucket negatives**

At the top of `e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`, extend the `@immich/sdk` import to add `SharedSpaceRole`:

```ts
import { AssetVisibility, LoginResponseDto, SharedSpaceRole, updateAssets } from '@immich/sdk';
```

Then add these two `describe` blocks inside the top-level `describe('shared-space visibility negatives (Slice 11)', …)` (e.g. after the existing album-download block, before the final closing `});`). They reuse the file's `owner`, `member`, `setVisibility`, and the raw `request(app)` pattern.

```ts
// ─────────────────────────────────────────────────────────────────────────────
// POST /search/metadata (albumId via space AlbumRead grant) — Hidden/Locked absent
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /search/metadata (albumIds via space AlbumRead grant) — Hidden/Locked absent (security-1)', () => {
  // Fresh space with owner=Owner, member=Viewer; returns the space id.
  const freshSpaceWithViewer = async (name: string) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: member.userId,
      role: SharedSpaceRole.Viewer,
    });
    return space.id;
  };

  const linkAlbum = (spaceId: string, albumId: string) =>
    request(app).put(`/shared-spaces/${spaceId}/albums/${albumId}`).set('Authorization', `Bearer ${owner.accessToken}`);

  const searchAlbumIds = async (body: Record<string, unknown>): Promise<string[]> => {
    const { status, body: resBody } = await request(app)
      .post('/search/metadata')
      .set('Authorization', `Bearer ${member.accessToken}`)
      .send(body);
    expect(status).toBe(200);
    return (resBody.assets.items as Array<{ id: string }>).map((item) => item.id);
  };

  it('Hidden album-linked asset absent for a Viewer (default visibility); Timeline+Archive present', async () => {
    const timelineAsset = await utils.createAsset(owner.accessToken);
    const archiveAsset = await utils.createAsset(owner.accessToken);
    await setVisibility(archiveAsset.id, AssetVisibility.Archive);
    const hiddenAsset = await utils.createAsset(owner.accessToken);

    const album = await utils.createAlbum(owner.accessToken, {
      albumName: 'SearchAlbumHiddenNeg',
      assetIds: [timelineAsset.id, archiveAsset.id, hiddenAsset.id],
    });
    // hide AFTER album-add (a pre-Hidden asset would be rejected / auto-removed from the album)
    await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

    const spaceId = await freshSpaceWithViewer('search-album-hidden-neg');
    await linkAlbum(spaceId, album.id);

    const ids = await searchAlbumIds({ albumIds: [album.id] });

    expect(ids).toContain(timelineAsset.id);
    expect(ids).toContain(archiveAsset.id);
    expect(ids).not.toContain(hiddenAsset.id);
  });

  it('Hidden album-linked asset absent even with an explicit visibility=hidden request', async () => {
    const timelineAsset = await utils.createAsset(owner.accessToken);
    const hiddenAsset = await utils.createAsset(owner.accessToken);

    const album = await utils.createAlbum(owner.accessToken, {
      albumName: 'SearchAlbumHiddenExplicit',
      assetIds: [timelineAsset.id, hiddenAsset.id],
    });
    await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);

    const spaceId = await freshSpaceWithViewer('search-album-hidden-explicit');
    await linkAlbum(spaceId, album.id);

    const ids = await searchAlbumIds({ albumIds: [album.id], visibility: AssetVisibility.Hidden });

    expect(ids).not.toContain(hiddenAsset.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /timeline/bucket (albumId) — Hidden/Locked → 400; Timeline/Archive → 200
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /timeline/bucket (albumId via space AlbumRead grant) — Hidden/Locked rejected (security-3)', () => {
  const freshSpaceWithViewer = async (name: string) => {
    const space = await utils.createSpace(owner.accessToken, { name });
    await utils.addSpaceMember(owner.accessToken, space.id, {
      userId: member.userId,
      role: SharedSpaceRole.Viewer,
    });
    return space.id;
  };

  const linkAlbum = (spaceId: string, albumId: string) =>
    request(app).put(`/shared-spaces/${spaceId}/albums/${albumId}`).set('Authorization', `Bearer ${owner.accessToken}`);

  // Resolve a real bucket for the album's assets so the positive controls query a populated bucket.
  const firstAlbumBucket = async (albumId: string): Promise<string> => {
    const { status, body } = await request(app)
      .get(`/timeline/buckets?bucketSize=month&albumId=${albumId}`)
      .set('Authorization', `Bearer ${member.accessToken}`);
    expect(status).toBe(200);
    return (body as Array<{ timeBucket: string }>)[0].timeBucket;
  };

  const setupLinkedAlbum = async (name: string) => {
    const timelineAsset = await utils.createAsset(owner.accessToken);
    const hiddenAsset = await utils.createAsset(owner.accessToken);
    const album = await utils.createAlbum(owner.accessToken, {
      albumName: name,
      assetIds: [timelineAsset.id, hiddenAsset.id],
    });
    await setVisibility(hiddenAsset.id, AssetVisibility.Hidden);
    const spaceId = await freshSpaceWithViewer(name);
    await linkAlbum(spaceId, album.id);
    return { album, timelineAsset, hiddenAsset };
  };

  it('albumId + visibility=hidden → 400 for a Viewer member', async () => {
    const { album } = await setupLinkedAlbum('bucket-album-hidden-neg');

    const { status } = await request(app)
      .get(`/timeline/bucket?bucketSize=month&timeBucket=1970-01-01&albumId=${album.id}&visibility=hidden`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(status).toBe(400);
  });

  it('albumId + visibility=locked → 400 for a Viewer member', async () => {
    const { album } = await setupLinkedAlbum('bucket-album-locked-neg');

    const { status } = await request(app)
      .get(`/timeline/bucket?bucketSize=month&timeBucket=1970-01-01&albumId=${album.id}&visibility=locked`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(status).toBe(400);
  });

  it('albumId (default visibility) → 200 with the Timeline asset present, Hidden absent', async () => {
    const { album, timelineAsset, hiddenAsset } = await setupLinkedAlbum('bucket-album-default-pos');
    const timeBucket = await firstAlbumBucket(album.id);

    const { status, body } = await request(app)
      .get(`/timeline/bucket?bucketSize=month&timeBucket=${timeBucket}&albumId=${album.id}`)
      .set('Authorization', `Bearer ${member.accessToken}`);

    expect(status).toBe(200);
    const returnedIds = (body.id ?? []) as string[];
    expect(returnedIds).toContain(timelineAsset.id);
    expect(returnedIds).not.toContain(hiddenAsset.id);
  });
});
```

- [ ] **Step 2: Run the e2e file to verify GREEN**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`

Expected: PASS. (Because Tasks 1–3 are already committed, these assertions are green — the search Hidden asset is absent, and the timeline `albumId + visibility=hidden|locked` requests return 400. To confirm the tests are real, an implementer may `git stash` the three server fixes and re-run: the search-Hidden-absent and the two 400 assertions FAIL, proving the tests exercise the leak. Restore with `git stash pop`.)

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts
git commit -m "test(spaces): e2e negatives for album-scoped search + timeline visibility leaks"
```

---

### Task 5: Full-suite regression validation (touched packages)

**Files:** none (validation only).

- [ ] **Step 1: Run the full server unit suite**

Run: `cd server && pnpm test -- --run`
Expected: PASS (no regressions in `timeline.service.spec.ts`, `search.repository.spec.ts`, or any search/asset unit spec).

- [ ] **Step 2: Run the relevant medium suites**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/search.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/timeline-bucket-explicit-visibility.medium.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/asset.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/utils/shared-space-album-scope-sql.medium.spec.ts
```

Expected: PASS. (Include `shared-space-album-scope-sql.medium.spec.ts` and the guard spec below because they pin `albumSharedSpaceScope`-adjacent behavior.)

- [ ] **Step 3: Run the guard spec (no unintended library-arm coverage change)**

Run: `cd server && pnpm test -- --run src/utils/shared-space-album-scope.guard.spec.ts`
Expected: PASS. `albumSharedSpaceScope` is still allowlisted as an `album-absence gate` (the fix adds no new `shared_space_library` scoping arm — it adds a `spaceVisibilityGate` conjunct only).

- [ ] **Step 4: Run the e2e negatives file**

Run: `cd e2e && pnpm test -- --run src/specs/server/api/shared-space-visibility-negatives.e2e-spec.ts`
Expected: PASS.

- [ ] **Step 5: Type + lint gate**

Run: `make check-server && make lint-server`
Expected: no type errors, zero lint warnings.

- [ ] **Step 6: No commit** (validation-only task). If any suite fails, return to the owning task, fix red-first, and re-run this task.

---

## Self-Review

- **Spec coverage (Slice 1):** security-1 → Task 2 (`albumSharedSpaceScope` flat gate) + unit SQL-shape + medium behavior + e2e. security-3 primary → Task 1 (`timeBucketChecks` reject) + unit + e2e 400. security-3 defense-in-depth → Task 3 (repo `albumId` arm) + medium + e2e default-view.
- **Edge cases (each an explicit assertion):**
  - Owner via album path does NOT see own Hidden → T2 `hides the OWNER's own Hidden album asset` + T3 owner branch of `visibility=HIDDEN via albumId`.
  - Owner still finds Hidden via non-album `userIds` path (untouched) → T2 `OWNER still finds their Hidden asset via the non-album userIds search path`.
  - Archived album asset IS visible → T2 `Timeline+Archive present` + T3 `regression: visibility=Archive …` + e2e search Archive present.
  - Locked album asset never present → T2 `Locked absent` + T3 `visibility=LOCKED via albumId` + e2e timeline 400 on locked.
  - Album linked into two spaces (member of one / neither) → T2 `two spaces` + `member of NEITHER space`.
  - `albumIds` combined with `personIds` scope → T2 `combined with a personIds filter`.
  - Direct (non-album) space path unchanged → pinned by the pre-existing `timeline-bucket-explicit-visibility` spaceId/timelineSpaceIds/spacePersonIds tests (kept green by T3) and the pre-existing `searchMetadata … filtering by spaceId` medium test.
- **Placeholder scan:** none — every step shows real test/impl code and exact commands.
- **Type consistency:** helper names (`itemIds`, `seedAlbumWithVisibilities`, `seedAlbum`, `freshSpaceWithViewer`, `linkAlbum`, `searchAlbumIds`, `firstAlbumBucket`, `setupLinkedAlbum`, `bucketAssetIds`, `countBuckets`, `makeBucketAsset`) are defined in the task that uses them or already exist in the target file; `spaceVisibilityGate` / `SharedSpaceRole` / `SearchService` are imported where used.
