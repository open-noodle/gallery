# Stacked Photos in Spaces — Slice S1 Implementation Plan (Server: add expands the whole stack)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adding any frame of a stack to a Space (`SharedSpaceService.addAssets`) brings in all of the adder's space-eligible frames of that stack, so the Space timeline collapses to the cover exactly like the main timeline and any primary change "just works."

**Architecture:** A new owner-scoped repository query `getOwnedStackSiblingIds` returns the stack siblings of the given assets; `addAssets` unions those with the passed ids and inserts/face-matches the expanded set. No schema change. Read-time stack collapse is unchanged and does the rest.

**Tech Stack:** NestJS 11, Kysely, Vitest (unit + medium via testcontainers Postgres), `@GenerateSql` SQL-doc generation.

Spec: `docs/superpowers/specs/2026-07-06-spaces-stacked-photos-design.md` (Slice S1; edge cases E1–E13).

## Global Constraints

- No relative imports in `server/` — use the `src/` path alias.
- Prettier: 120 cols, single quotes, trailing commas, semicolons. ESLint zero-warnings.
- Reuse the existing constant `visibleSpaceAssetVisibilities = [AssetVisibility.Archive, AssetVisibility.Timeline]` (`server/src/repositories/shared-space.repository.ts:42`) — do NOT invent a new visibility set. It excludes Hidden and Locked (the RBAC-sensitive tiers).
- Expansion is **owner-scoped**: only siblings with `ownerId = auth.user.id` (stacks are single-owner, so the adder already has `AssetRead` — no extra permission check).
- New `@GenerateSql` method ⇒ regenerate `server/src/queries/shared.space.repository.sql` (built server + Postgres) and commit it.
- Adding a repository **method** (not a new repository) ⇒ no `BaseService` / `BaseService.create()` / medium-factory `newRealRepository` changes.

---

### Task 1: Repository query `getOwnedStackSiblingIds`

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts` (add method near `addAssets`, ~line 333)
- Create: `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
- Regenerate: `server/src/queries/shared.space.repository.sql`

**Interfaces:**

- Produces: `getOwnedStackSiblingIds(userId: string, assetIds: string[]): Promise<string[]>` — asset ids of all non-deleted, space-eligible-visibility, `ownerId = userId` assets sharing a non-null `stackId` with any of `assetIds`. Returns `[]` for empty input.

- [ ] **Step 1: Write the failing medium tests**

Create `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AssetVisibility } from 'src/enum';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(SharedSpaceRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('SharedSpaceRepository.getOwnedStackSiblingIds', () => {
  it('returns all siblings when the seed is the stack cover (E1)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child2 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id, child2.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id, child1.id, child2.id]));
  });

  it('returns all siblings incl. the primary when the seed is a non-primary frame (E2)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [child1.id]);

    expect(new Set(result)).toEqual(new Set([primary.id, child1.id]));
  });

  it('returns nothing for an asset with no stack (E3)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });

    const result = await sut.getOwnedStackSiblingIds(user.id, [asset.id]);

    expect(result).toEqual([]);
  });

  it('does not expand a stack owned by another user (E4)', async () => {
    const { ctx, sut } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: other } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: owner.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: owner.id });
    await ctx.newStack({ ownerId: owner.id }, [primary.id, child1.id]);

    const result = await sut.getOwnedStackSiblingIds(other.id, [primary.id]);

    expect(result).toEqual([]);
  });

  it('excludes Hidden and Locked siblings (E5)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: hidden } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Hidden });
    const { asset: locked } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });
    await ctx.newStack({ ownerId: user.id }, [primary.id, hidden.id, locked.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id]));
  });

  it('includes Archived siblings — archive is space-eligible (E5b)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: archived } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });
    await ctx.newStack({ ownerId: user.id }, [primary.id, archived.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id, archived.id]));
  });

  it('excludes soft-deleted siblings (E6)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: deleted } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, deleted.id]);
    await ctx.softDeleteAsset(deleted.id);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id]);

    expect(new Set(result)).toEqual(new Set([primary.id]));
  });

  it('dedupes when two seeds share a stack (E8)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id, child1.id]);

    expect(result.length).toBe(new Set(result).size);
    expect(new Set(result)).toEqual(new Set([primary.id, child1.id]));
  });

  it('handles a mixed batch of stacked and unstacked seeds (E9)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: standalone } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);

    const result = await sut.getOwnedStackSiblingIds(user.id, [primary.id, standalone.id]);

    // standalone has no stack → contributes no siblings; the stack expands fully
    expect(new Set(result)).toEqual(new Set([primary.id, child1.id]));
  });

  it('returns [] for empty input (E11)', async () => {
    const { sut } = setup();
    const result = await sut.getOwnedStackSiblingIds('00000000-0000-0000-0000-000000000000', []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
Expected: FAIL — `sut.getOwnedStackSiblingIds is not a function` (method does not exist yet).

- [ ] **Step 3: Implement the query**

In `server/src/repositories/shared-space.repository.ts`, add immediately after the `addAssets` method (after line 333):

```ts
  @GenerateSql({ params: [DummyValue.UUID, [DummyValue.UUID]] })
  async getOwnedStackSiblingIds(userId: string, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) {
      return [];
    }

    const rows = await this.db
      .selectFrom('asset as seed')
      .innerJoin('asset as sibling', 'sibling.stackId', 'seed.stackId')
      .select('sibling.id as assetId')
      .distinct()
      .where('seed.id', 'in', assetIds)
      .where('seed.stackId', 'is not', null)
      .where('sibling.ownerId', '=', userId)
      .where('sibling.deletedAt', 'is', null)
      .where('sibling.visibility', 'in', visibleSpaceAssetVisibilities)
      .execute();

    return rows.map((row) => row.assetId);
  }
```

(`GenerateSql`, `DummyValue` are already imported at the top of the file; `visibleSpaceAssetVisibilities` is the module constant at line 42.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Type-check**

Run: `cd server && pnpm check`
Expected: no errors.

- [ ] **Step 6: Regenerate SQL docs and commit**

Regenerate the query doc for the new `@GenerateSql` method (needs a built server + Postgres — see "SQL regeneration" note at the end of this plan):

Run: `cd server && pnpm build && (mise sql || node ./dist/bin/sync-sql.js)`
Expected: `server/src/queries/shared.space.repository.sql` gains a `getOwnedStackSiblingIds` entry; no other query files change.

```bash
git add server/src/repositories/shared-space.repository.ts \
        server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts \
        server/src/queries/shared.space.repository.sql
git commit -m "feat(spaces): add getOwnedStackSiblingIds repo query for stack expansion (#751)"
```

---

### Task 2: `addAssets` expands to the stack closure

**Files:**

- Modify: `server/src/services/shared-space.service.ts:571-596` (`addAssets`)
- Modify: `server/src/services/shared-space.service.spec.ts` (add default mock in `beforeEach`; add expansion tests to the `describe('addAssets', …)` block near line 2139)

**Interfaces:**

- Consumes: `SharedSpaceRepository.getOwnedStackSiblingIds(userId, assetIds) → Promise<string[]>` (Task 1).

- [ ] **Step 1: Add the default mock so existing tests keep passing**

In `server/src/services/shared-space.service.spec.ts`, inside `beforeEach` (after `({ sut, mocks } = newTestService(SharedSpaceService));`, near line 243), add:

```ts
mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([]);
```

- [ ] **Step 2: Write the failing unit tests**

Add these tests inside `describe('addAssets', …)` in `server/src/services/shared-space.service.spec.ts`:

```ts
it('should expand a stack to its siblings and insert the whole stack (E1/E2)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const cover = newUuid();
  const sibling1 = newUuid();
  const sibling2 = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([cover]));
  mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([cover, sibling1, sibling2]);
  mocks.sharedSpace.addAssets.mockResolvedValue([] as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.addAssets(auth, spaceId, { assetIds: [cover] });

  expect(mocks.sharedSpace.getOwnedStackSiblingIds).toHaveBeenCalledWith(auth.user.id, [cover]);
  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
    { spaceId, assetId: cover, addedById: auth.user.id },
    { spaceId, assetId: sibling1, addedById: auth.user.id },
    { spaceId, assetId: sibling2, addedById: auth.user.id },
  ]);
});

it('should dedupe seeds and returned siblings (E8)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const a = newUuid();
  const b = newUuid();
  const c = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([a, b]));
  mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([b, c]);
  mocks.sharedSpace.addAssets.mockResolvedValue([] as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.addAssets(auth, spaceId, { assetIds: [a, b] });

  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([
    { spaceId, assetId: a, addedById: auth.user.id },
    { spaceId, assetId: b, addedById: auth.user.id },
    { spaceId, assetId: c, addedById: auth.user.id },
  ]);
});

it('should retain an explicitly-added seed that is not a returned sibling (E7)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const seed = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: false });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([seed]));
  mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([]);
  mocks.sharedSpace.addAssets.mockResolvedValue([] as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.addAssets(auth, spaceId, { assetIds: [seed] });

  expect(mocks.sharedSpace.addAssets).toHaveBeenCalledWith([{ spaceId, assetId: seed, addedById: auth.user.id }]);
});

it('should queue SharedSpaceFaceMatch jobs for the expanded set (E12)', async () => {
  const auth = factory.auth();
  const spaceId = newUuid();
  const cover = newUuid();
  const sibling1 = newUuid();
  const editorMember = makeMemberResult({ spaceId, userId: auth.user.id, role: SharedSpaceRole.Editor });
  const space = factory.sharedSpace({ id: spaceId, faceRecognitionEnabled: true });

  mocks.sharedSpace.getMember.mockResolvedValue(editorMember);
  mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([cover]));
  mocks.sharedSpace.getOwnedStackSiblingIds.mockResolvedValue([cover, sibling1]);
  mocks.sharedSpace.addAssets.mockResolvedValue([] as any);
  mocks.sharedSpace.getById.mockResolvedValue(space);
  mocks.sharedSpace.update.mockResolvedValue(space);
  mocks.sharedSpace.logActivity.mockResolvedValue(void 0);

  await sut.addAssets(auth, spaceId, { assetIds: [cover] });

  expect(mocks.job.queueAll).toHaveBeenCalledWith([
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId, assetId: cover } },
    { name: JobName.SharedSpaceFaceMatch, data: { spaceId, assetId: sibling1 } },
  ]);
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts -t addAssets`
Expected: the 4 new tests FAIL (siblings not expanded); existing `addAssets` tests still PASS (default mock returns `[]`).

- [ ] **Step 4: Implement the expansion in `addAssets`**

Replace the body of `addAssets` (`server/src/services/shared-space.service.ts:571-596`) with:

```ts
  async addAssets(auth: AuthDto, spaceId: string, dto: SharedSpaceAssetAddDto): Promise<void> {
    await this.requireRole(auth, spaceId, SharedSpaceRole.Editor);
    await this.requireAccess({ auth, permission: Permission.AssetRead, ids: dto.assetIds });

    const siblingIds = await this.sharedSpaceRepository.getOwnedStackSiblingIds(auth.user.id, dto.assetIds);
    const expandedAssetIds = [...new Set([...dto.assetIds, ...siblingIds])];

    const inserted = await this.sharedSpaceRepository.addAssets(
      expandedAssetIds.map((assetId) => ({ spaceId, assetId, addedById: auth.user.id })),
    );

    await this.sharedSpaceRepository.update(spaceId, { lastActivityAt: new Date() });

    await this.sharedSpaceRepository.logActivity({
      spaceId,
      userId: auth.user.id,
      type: SharedSpaceActivityType.AssetAdd,
      data: { count: inserted.length, assetIds: dto.assetIds.slice(0, 4) },
    });

    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (space?.faceRecognitionEnabled) {
      await this.jobRepository.queueAll(
        expandedAssetIds.map((assetId) => ({
          name: JobName.SharedSpaceFaceMatch as const,
          data: { spaceId, assetId },
        })),
      );
    }
  }
```

- [ ] **Step 5: Run to verify pass**

Run: `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts`
Expected: PASS (all `addAssets` tests, new and existing).

- [ ] **Step 6: Type-check + commit**

Run: `cd server && pnpm check`
Expected: no errors.

```bash
git add server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): expand add-to-space to the whole stack (#751)"
```

---

### Task 3: Composition E2E medium tests (timeline collapse, promote-primary, idempotency)

**Files:**

- Modify: `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts` (add a second `describe`)

**Interfaces:**

- Consumes: `SharedSpaceRepository.getOwnedStackSiblingIds` + `addAssets`; `AssetRepository.getTimeBuckets`; `StackRepository.update`; `ctx.newStack`, `ctx.newSharedSpace`, `ctx.newSharedSpaceMember`.

- [ ] **Step 1: Write the failing composition tests**

Append to `server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`. Add imports at the top:

```ts
import { AssetRepository } from 'src/repositories/asset.repository';
import { StackRepository } from 'src/repositories/stack.repository';
import { TimeBucketSize } from 'src/enum';
```

Then the describe block:

```ts
describe('stack-in-space composition (E10/E13)', () => {
  const addWholeStack = async (
    ctx: any,
    sut: SharedSpaceRepository,
    spaceId: string,
    userId: string,
    seedId: string,
  ) => {
    const siblings = await sut.getOwnedStackSiblingIds(userId, [seedId]);
    const expanded = [...new Set([seedId, ...siblings])];
    return sut.addAssets(expanded.map((assetId) => ({ spaceId, assetId, addedById: userId })));
  };

  const bucketCount = async (ctx: any, spaceId: string) => {
    const buckets = await ctx.get(AssetRepository).getTimeBuckets({
      spaceId,
      visibility: AssetVisibility.Timeline,
      bucketSize: TimeBucketSize.Year,
      withStacked: true,
    });
    return buckets.reduce((sum: number, b: { count: number }) => sum + b.count, 0);
  };

  it('collapses to one cover after the whole stack is added (E1/E13)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child2 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id, child2.id]);

    await addWholeStack(ctx, sut, space.id, user.id, primary.id);

    expect(await sut.getAssetCount(space.id)).toBe(3);
    await expect(bucketCount(ctx, space.id)).resolves.toBe(1);
  });

  it('keeps the stack visible after promoting a different primary (E13)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    const { stack } = await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);

    await addWholeStack(ctx, sut, space.id, user.id, primary.id);
    await ctx.get(StackRepository).update(stack.id, { id: stack.id, primaryAssetId: child1.id });

    await expect(bucketCount(ctx, space.id)).resolves.toBe(1);
  });

  it('is idempotent on re-add (E10)', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
    const { asset: primary } = await ctx.newAsset({ ownerId: user.id });
    const { asset: child1 } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newStack({ ownerId: user.id }, [primary.id, child1.id]);

    await addWholeStack(ctx, sut, space.id, user.id, primary.id);
    const secondInsert = await addWholeStack(ctx, sut, space.id, user.id, primary.id);

    expect(secondInsert).toHaveLength(0);
    expect(await sut.getAssetCount(space.id)).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify pass**

These exercise already-implemented code (Tasks 1–2 + existing collapse), so they should PASS on first run. If any fails, fix the implementation, not the test.

Run: `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts`
Expected: PASS (all describes).

> Note: these are composition tests over already-shipped behavior; a first-run green is acceptable here (they assert the integrated outcome, not a new unit). If `TimeBucketSize` import path differs, confirm against `server/src/enum.ts`.

- [ ] **Step 3: Commit**

```bash
git add server/test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts
git commit -m "test(spaces): composition E2E for stack-in-space add + collapse (#751)"
```

---

## SQL regeneration (for Task 1, Step 6)

`node ./dist/bin/sync-sql.js` reads the `@GenerateSql` decorators from the built `dist/` and writes `server/src/queries/*.sql`. It needs a reachable Postgres.

Procedure:

1. `cd server && pnpm build` (produces `dist/bin/sync-sql.js`).
2. Ensure a Postgres is reachable with the immich dev env (`DB_HOSTNAME`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE_NAME`, `DB_PORT`). If the dev stack DB is not up, start just Postgres, or export the same connection the medium tests would use.
3. `mise sql` (or `node ./dist/bin/sync-sql.js`).
4. `git diff --stat server/src/queries/` should show **only** `shared.space.repository.sql` changed (a new `getOwnedStackSiblingIds` block). Commit it with Task 1.

If SQL regeneration is environmentally blocked, do NOT skip silently — report it as a blocker; the CI SQL-docs check will fail without it.

## Slice S1 Verification Gate (run before pushing)

- [ ] `cd server && pnpm check` — no type errors
- [ ] `cd server && pnpm test -- --run src/services/shared-space.service.spec.ts` — green
- [ ] `cd server && ./node_modules/.bin/vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/shared-space-stack-expansion.medium.spec.ts` — green
- [ ] `server/src/queries/shared.space.repository.sql` regenerated and committed
- [ ] `cd server && pnpm lint` (deferred to end is fine) — zero warnings on touched files
