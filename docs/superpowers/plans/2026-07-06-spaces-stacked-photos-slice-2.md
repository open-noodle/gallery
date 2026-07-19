# Stacked Photos in Spaces — Slice S2 Implementation Plan (Server: remove expands the whole stack)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Removing any frame of a stack from a Space (`SharedSpaceService.removeAssets`) removes all of that stack's direct members from the Space, with correct thumbnail-reset and face-orphan handling; frames still reachable via a linked album stay members.

**Architecture:** A new space-scoped repository query `getStackSiblingIdsInSpace` returns the same-stack direct members of a Space; `removeAssets` unions those with the passed ids and deletes/cleans up the expanded set. No schema change.

**Tech Stack:** NestJS 11, Kysely, Vitest (unit + medium testcontainers), `@GenerateSql`.

Spec: `docs/superpowers/specs/2026-07-06-spaces-stacked-photos-design.md` (Slice S2; edge cases E14–E19). Baseline: S1 is complete (commits through `3adecfa66d`) — `getOwnedStackSiblingIds`, `addAssets` expansion, and the medium file `shared-space-stack-expansion.medium.spec.ts` already exist.

## Global Constraints

- No relative imports in `server/`; Prettier 120 cols/single quotes/trailing commas; ESLint zero-warnings.
- Remove expansion is **space-scoped, not owner-scoped**: a stack sibling qualifies iff it is a current direct member (`shared_space_asset`) of THIS `spaceId`. No visibility/owner/offline filter (members are members).
- `expandedAssetIds` (= `dto.assetIds` ∪ member-siblings) must feed the delete, the thumbnail-reset check, AND the `getAssetIdsWithoutOtherSpacePath` face-orphan computation.
- Preserve all existing `removeAssets` behavior: role check, `NotFoundException` when space missing, `getLastAssetAddedAt` → `lastActivityAt`, activity log, orphan face/person cleanup.
- New `@GenerateSql` method ⇒ regenerate `server/src/queries/shared.space.repository.sql` (controller handles it).
- Adding a repository method ⇒ no `BaseService`/`create()`/medium-factory changes.

---

### Task 1: Repository query `getStackSiblingIdsInSpace`

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` — add after `removeAssets` (the method around line 392).
- Modify: `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts` — add a `describe` block.

**Interfaces:**

- Produces: `getStackSiblingIdsInSpace(spaceId: string, assetIds: string[]): Promise<string[]>` — asset ids of assets that (a) share a non-null `stackId` with any of `assetIds` AND (b) are direct members of `spaceId`. Returns `[]` for empty input.

- [ ] **Step 1: Write the failing medium tests** — append this `describe` to `shared-space-stack-expansion.medium.spec.ts` (the file already imports `setup`, `ctx` helpers, `SharedSpaceRepository`):

```ts
describe('SharedSpaceRepository.getStackSiblingIdsInSpace', () => {
  it('returns same-stack direct members of the space (E18)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child2 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id, child2.id]);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: primary.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child1.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child2.id, addedById: user.id });

    const result = await sut.getStackSiblingIdsInSpace(space.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id, child1.id, child2.id]));
  });

  it('excludes same-stack assets that are NOT members of the space (E18)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);
    // only the primary is a direct member; child1 is not
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: primary.id, addedById: user.id });

    const result = await sut.getStackSiblingIdsInSpace(space.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id]));
  });

  it('does not cross space boundaries (E18)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space: spaceA } = await ctx.newSharedSpace({ createdById: user.id });
    const { space: spaceB } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);
    await ctx.newSharedSpaceAsset({ spaceId: spaceA.id, assetId: primary.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: spaceB.id, assetId: child1.id, addedById: user.id });

    const result = await sut.getStackSiblingIdsInSpace(spaceA.id, [primary.id]);

    // child1 is a member of space B, not A → excluded from space A's expansion
    expect(new Set(result)).toEqual(new Set([primary.id]));
  });

  it('returns [] for empty input', async () => {
    const { ctx, sut } = setup();
    const { space } = await ctx.newSharedSpace({ createdById: (await ctx.newUser()).user.id });
    const result = await sut.getStackSiblingIdsInSpace(space.id, []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts -t getStackSiblingIdsInSpace`
Expected: FAIL — `sut.getStackSiblingIdsInSpace is not a function`.

- [ ] **Step 3: Implement the query** — in `shared-space.repository.ts`, after `removeAssets`:

```ts
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getStackSiblingIdsInSpace(spaceId: string, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('asset as seed')
      .innerJoin('asset as sibling', 'sibling.stackId', 'seed.stackId')
      .innerJoin('shared_space_asset', 'shared_space_asset.assetId', 'sibling.id')
      .select('sibling.id as assetId')
      .distinct()
      .where('seed.id', 'in', assetIds)
      .where('seed.stackId', 'is not', null)
      .where('shared_space_asset.spaceId', '=', spaceId)
      .execute();

    return rows.map((row) => row.assetId);
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
Expected: PASS (all describes, including the new one).

- [ ] **Step 5: Type-check + commit** (omit the `.sql` — controller regenerates it)

Run: `cd server && pnpm check` → no errors.

```bash
git add server/src/repositories/shared-space.repository.ts \
        server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts
git commit -m "feat(spaces): add getStackSiblingIdsInSpace repo query for remove expansion (#751)"
```

---

### Task 2: `removeAssets` expands to the stack closure

**Files:**

- Modify: `server/src/services/shared-space.service.ts` — the `removeAssets` method.
- Modify: `server/src/services/shared-space.service.spec.ts` — add default mock in `beforeEach`; add tests to the `describe('removeAssets', …)` block.

**Interfaces:**

- Consumes: `SharedSpaceRepository.getStackSiblingIdsInSpace(spaceId, assetIds) → Promise<string[]>` (Task 1).

- [ ] **Step 1: Add the default mock** — in `beforeEach` (next to the existing `mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([])` added in S1):

```ts
mocks.sharedSpace.getStackSiblingIdsInSpace.mockResolvedValue([]);
```

- [ ] **Step 2: Write the failing unit tests** — add to `describe('removeAssets', …)` in `shared-space.service.spec.ts`. (Mirror the setup style already used in that block: mock `getMember` with an Editor member, `getById` with a space, `getLastAssetAddedAt`, `getAssetIdsWithoutOtherSpacePath` → `[]` unless asserting orphans.)

```ts
it('should expand removal to same-stack space members (E14/E15)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const cover = newUuid();
  const sibling1 = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getStackSiblingIdsInSpace.mockResolvedValue([cover, sibling1]);
  mocks.sharedSpace.getLastAssetAddedAt.mockResolvedValue(undefined);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);
  mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);

  await sut.removeAssets(auth, spaceId, { assetIds: [cover] });

  expect(mocks.sharedSpace.getStackSiblingIdsInSpace).toHaveBeenCalledWith(spaceId, [cover]);
  expect(mocks.sharedSpace.removeAssets).toHaveBeenCalledWith(spaceId, [cover, sibling1]);
  expect(mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath).toHaveBeenCalledWith(spaceId, [cover, sibling1]);
});

it('should reset the thumbnail when it is an expanded (sibling) frame (E17)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const cover = newUuid();
  const sibling1 = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, thumbnailAssetId: sibling1 });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.getStackSiblingIdsInSpace.mockResolvedValue([cover, sibling1]);
  mocks.sharedSpace.getLastAssetAddedAt.mockResolvedValue(undefined);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);
  mocks.sharedSpace.getAssetIdsWithoutOtherSpacePath.mockResolvedValue([]);

  // thumbnail (sibling1) is NOT in the caller's dto.assetIds — only reachable via expansion
  await sut.removeAssets(auth, spaceId, { assetIds: [cover] });

  expect(mocks.sharedSpace.update).toHaveBeenCalledWith(spaceId, expect.objectContaining({ thumbnailAssetId: null }));
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t removeAssets`
Expected: the 2 new tests FAIL (no expansion yet — `removeAssets` called with `[cover]`, thumbnail not reset); existing `removeAssets` tests PASS (default mock `[]`).

- [ ] **Step 4: Implement expansion in `removeAssets`** — replace the method body so it reads exactly:

```ts
  async removeAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetRemoveDto): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (!space) {
      throw new NotFoundException('Space not found');
    }

    const siblingIds = await this.sharedSpaceRepository.getStackSiblingIdsInSpace(spaceId, dto.assetIds);
    const expandedAssetIds = [...new Set([...dto.assetIds, ...siblingIds])];

    await this.sharedSpaceRepository.removeAssets(spaceId, expandedAssetIds);

    const lastAddedAt = await this.sharedSpaceRepository.getLastAssetAddedAt(spaceId);
    const updateData: { lastActivityAt: Date | null; thumbnailAssetId?: null } = {
      lastActivityAt: lastAddedAt ?? null,
    };

    if (space?.thumbnailAssetId && expandedAssetIds.includes(space.thumbnailAssetId)) {
      updateData.thumbnailAssetId = null;
    }

    await this.sharedSpaceRepository.update(spaceId, updateData);

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.AssetRemove,
      data: { count: expandedAssetIds.length },
    });

    const orphanedAssetIds = await this.sharedSpaceRepository.getAssetIdsWithoutOtherSpacePath(
      spaceId,
      expandedAssetIds,
    );
    if (orphanedAssetIds.length > 0) {
      await this.sharedSpaceRepository.removePersonFacesByAssetIds(spaceId, orphanedAssetIds);
      await this.sharedSpaceRepository.deleteOrphanedPersons(spaceId);
      await this.queueSpacePersonMetadataBackfill();
    }
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS (all `removeAssets` tests, new and existing).

- [ ] **Step 6: Type-check + commit**

Run: `cd server && pnpm check` → no errors.

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): expand remove-from-space to the whole stack (#751)"
```

---

### Task 3: Composition E2E medium tests (remove whole stack, album survival)

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts` — add a `describe`.

**Interfaces:**

- Consumes: `getStackSiblingIdsInSpace`, `removeAssets`, `getAssetCount`, `getAssetIdsWithoutOtherSpacePath`; `ctx.newAlbum`, `ctx.newSharedSpaceAlbum`, `ctx.newSharedSpaceAsset`.

- [ ] **Step 1: Write the tests** — append:

```ts
describe('stack-in-space removal composition (E14/E15/E16)', () => {
  const removeWholeStack = async (sut: SharedSpaceRepository, spaceId: string, seedId: string) => {
    const siblings = await sut.getStackSiblingIdsInSpace(spaceId, [seedId]);
    const expanded = [...new Set([seedId, ...siblings])];
    await sut.removeAssets(spaceId, expanded);
    return expanded;
  };

  it('removing the cover removes the whole stack (E14)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: primary.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child1.id, addedById: user.id });

    await removeWholeStack(sut, space.id, primary.id);

    expect(await sut.getAssetCount(space.id)).toBe(0);
  });

  it('removing a non-cover frame removes the whole stack (E15)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: primary.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child1.id, addedById: user.id });

    await removeWholeStack(sut, space.id, child1.id);

    expect(await sut.getAssetCount(space.id)).toBe(0);
  });

  it('a frame still reachable via a linked album is not flagged as a face-orphan (E16)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: primary.id, addedById: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: child1.id, addedById: user.id });
    // child1 is ALSO in an album that is linked to the space
    const { album } = await ctx.newAlbum({ ownerId: user.id }, [child1.id]);
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    const expanded = await removeWholeStack(sut, space.id, primary.id);
    const orphans = await sut.getAssetIdsWithoutOtherSpacePath(space.id, expanded);

    // primary has no remaining path → orphan; child1 remains via the album → NOT an orphan
    expect(orphans).toContain(primary.id);
    expect(orphans).not.toContain(child1.id);
  });
});
```

> `ctx.newAlbum` returns `{ album }`; confirm the returned album shape has `.id` (medium.factory.ts:228). If `newAlbum`'s asset-adding overload isn't wired for `album_asset`, add the asset via `ctx.newAlbumAsset({ albumId: album.id, assetId: child1.id })` instead.

- [ ] **Step 2: Run to verify pass** (exercises implemented code; first-run green acceptable)

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts
git commit -m "test(spaces): composition E2E for stack-in-space removal + album survival (#751)"
```

---

## SQL regeneration (controller, after Task 1)

Same procedure as S1: `cd server && pnpm build`; start `ghcr.io/immich-app/postgres:14-vectorchord0.4.3` on :5432 (POSTGRES_USER/PASSWORD=postgres, DB=immich); `DB_URL=postgres://postgres:postgres@localhost:5432/immich pnpm --filter immich migrations:run`; `DB_URL=… mise //:sql`; confirm only `server/src/queries/shared.space.repository.sql` changed (adds a `getStackSiblingIdsInSpace` block); commit it.

## Slice S2 Verification Gate

- [ ] `cd server && pnpm check` — clean
- [ ] `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts` — green
- [ ] medium spec green (query + both composition describes)
- [ ] `server/src/queries/shared.space.repository.sql` regenerated + committed
- [ ] `cd server && pnpm lint` — zero warnings on touched files
