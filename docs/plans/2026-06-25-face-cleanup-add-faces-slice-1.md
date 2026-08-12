# Face Cleanup — Add Faces — Slice 1 (paginated cluster-face lister) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add `FaceRepairRepository.getClusterFacePage(personId, { excludeFaceIds, limit, offset })` — a
server-paginated lister of a person's eligible (visible, ML-sourced, non-deleted) faces minus a caller-supplied
exclude list — so the review screen can lazily render the "Rest of this cluster" section and the server can
report the cluster's total without the client ever loading the whole cluster.

**Architecture:** One new Kysely method on the existing `FaceRepairRepository`, tested at the **medium** tier
(real Postgres via testcontainers) because it is a real SQL query. The method's filter **mirrors
`streamEligibleFaces` exactly — including the `face_search` inner join** — so the page/`total` it returns are
precisely the set an entire-cluster move (which enumerates via `streamEligibleFaces`) will actually move. No
HTTP, no DTO, no service wiring in this slice (those are Slice 2/3).

**Tech Stack:** Kysely query builder (NOT TypeORM), PostgreSQL, Vitest **medium** (testcontainers Postgres via
`test/medium/globalSetup.ts`), `newMediumService` harness in `server/test/medium.factory.ts`.

**Spec:** [`2026-06-25-face-cleanup-add-faces-design.md`](2026-06-25-face-cleanup-add-faces-design.md) — Slice 1;
Architecture §Server.1; edge cases E1, E2, E3.

## Global Constraints

- **Server imports:** no relative imports — use the `src/` path alias (e.g. `src/enum`, `src/schema`).
- **Formatting:** Prettier — 120 char width, single quotes, trailing commas, semicolons.
- **Linting:** ESLint zero-warnings (`--max-warnings 0`); full lint is deferred to the final slice (Slice 7),
  but every commit must be `tsc --noEmit`-clean and prettier-clean.
- **ORM:** Kysely typed query builder only. `sql.lit(...)` for enum literals, mirroring sibling methods.
- **Medium tests require Docker.** `test:medium` boots a Postgres container via testcontainers; the Docker
  daemon must be running. If `getKyselyDB` throws about `IMMICH_TEST_POSTGRES_URL`/Docker, the daemon is down.

---

## File Structure

- Modify: `server/src/repositories/face-repair.repository.ts` — add the `getClusterFacePage` method (one
  responsibility: paginated eligible-face read). No new file; the repo is a small, focused Kysely class.
- Modify: `server/test/medium/specs/repositories/face-repair.repository.spec.ts` — add a module-scope
  `Ctx` type + `seedEligibleFace` helper and a new `describe('FaceRepairRepository.getClusterFacePage')` block.

---

## Task 1: `getClusterFacePage` — paginated, exclude-aware, eligibility-mirrored (medium TDD)

**Files:**

- Modify: `server/src/repositories/face-repair.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair.repository.spec.ts`

**Interfaces:**

- Consumes: existing `ctx` medium helpers — `ctx.newUser()`, `ctx.newPerson({ ownerId })`,
  `ctx.newAsset({ ownerId, visibility? })`, `ctx.newAssetFace({ assetId, personId, sourceType?, isVisible? })`,
  `ctx.softDeleteAsset(id)`, `ctx.database` (Kysely). `SourceType.MachineLearning` from `src/enum`.
- Produces (relied on by Slice 2/3):

  ```ts
  getClusterFacePage(
    personId: string,
    options: { excludeFaceIds: string[]; limit: number; offset: number },
  ): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }>
  ```

- [ ] **Step 1: Write the failing tests**

Add the module-scope helper block **once**, directly after the `beforeAll(...)` block near the top of
`server/test/medium/specs/repositories/face-repair.repository.spec.ts` (before the first `describe`):

```ts
type Ctx = ReturnType<typeof setup>['ctx'];

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

const seedEligibleFace = async (ctx: Ctx, userId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId: userId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: EMBEDDING }).execute();
  return assetFace.id;
};
```

Append this new `describe` block at the **end** of the same file:

```ts
describe('FaceRepairRepository.getClusterFacePage', () => {
  it('returns only eligible same-person faces, minus excludeFaceIds, with a correct total', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });

    // 4 eligible faces on `person`
    const eligible = [
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
    ];

    // exclude two of them (the "flagged" ids the client already holds)
    const excludeFaceIds = [eligible[0], eligible[1]];
    const remaining = [eligible[2], eligible[3]];

    // skip: eligible face on a DIFFERENT person
    await seedEligibleFace(ctx, user.id, other.id);

    // skip: manual-sourced face on `person`
    const { asset: am } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({ assetId: am.id, personId: person.id });
    await ctx.database
      .updateTable('asset_face')
      .set({ sourceType: 'manual' as SourceType })
      .where('id', '=', manualFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: manualFace.id, embedding: EMBEDDING }).execute();

    // skip: not-visible face on `person`
    const { asset: anv } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: notVisible } = await ctx.newAssetFace({
      assetId: anv.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisible.id, embedding: EMBEDDING }).execute();

    // skip: soft-deleted face on `person`
    const { asset: ad } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: ad.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: deletedFace.id, embedding: EMBEDDING }).execute();

    // skip: face on a soft-deleted asset
    const { asset: deletedAsset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: faceOnDeletedAsset } = await ctx.newAssetFace({
      assetId: deletedAsset.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .insertInto('face_search')
      .values({ faceId: faceOnDeletedAsset.id, embedding: EMBEDDING })
      .execute();
    await ctx.softDeleteAsset(deletedAsset.id);

    // skip: face with NO face_search row (mirrors streamEligibleFaces' inner join)
    const { asset: anofs } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newAssetFace({ assetId: anofs.id, personId: person.id, sourceType: SourceType.MachineLearning });

    const page = await sut.getClusterFacePage(person.id, { excludeFaceIds, limit: 50, offset: 0 });

    expect(page.total).toBe(2);
    expect(page.hasMore).toBe(false);
    expect(page.faces.map((f) => f.assetFaceId).toSorted()).toEqual(remaining.toSorted());
  });

  it('paginates with a stable order: disjoint pages whose union is the full filtered set', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const ids = [
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
    ];

    const page0 = await sut.getClusterFacePage(person.id, { excludeFaceIds: [], limit: 2, offset: 0 });
    const page1 = await sut.getClusterFacePage(person.id, { excludeFaceIds: [], limit: 2, offset: 2 });
    const page2 = await sut.getClusterFacePage(person.id, { excludeFaceIds: [], limit: 2, offset: 4 });

    expect(page0.total).toBe(5);
    expect(page0.faces).toHaveLength(2);
    expect(page0.hasMore).toBe(true);

    expect(page1.faces).toHaveLength(2);
    expect(page1.hasMore).toBe(true);

    expect(page2.faces).toHaveLength(1);
    expect(page2.hasMore).toBe(false);

    const union = [...page0.faces, ...page1.faces, ...page2.faces].map((f) => f.assetFaceId);
    expect(new Set(union).size).toBe(5); // pages are disjoint
    expect(union.toSorted()).toEqual(ids.toSorted()); // union = full filtered set
  });

  it('applies excludeFaceIds before pagination so total/hasMore stay correct across a page boundary', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const ids = [
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
      await seedEligibleFace(ctx, user.id, person.id),
    ];
    const excludeFaceIds = [ids[0], ids[1]]; // filtered set = 3

    const page0 = await sut.getClusterFacePage(person.id, { excludeFaceIds, limit: 2, offset: 0 });
    const page1 = await sut.getClusterFacePage(person.id, { excludeFaceIds, limit: 2, offset: 2 });

    expect(page0.total).toBe(3);
    expect(page0.faces).toHaveLength(2);
    expect(page0.hasMore).toBe(true);

    expect(page1.total).toBe(3);
    expect(page1.faces).toHaveLength(1);
    expect(page1.hasMore).toBe(false);

    const union = [...page0.faces, ...page1.faces].map((f) => f.assetFaceId);
    expect(union).not.toContain(ids[0]);
    expect(union).not.toContain(ids[1]);
    expect(union.toSorted()).toEqual([ids[2], ids[3], ids[4]].toSorted());
  });

  it('returns an empty page (total 0, hasMore false) when every visible face is excluded', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });

    const a = await seedEligibleFace(ctx, user.id, person.id);
    const b = await seedEligibleFace(ctx, user.id, person.id);

    const page = await sut.getClusterFacePage(person.id, { excludeFaceIds: [a, b], limit: 50, offset: 0 });

    expect(page.total).toBe(0);
    expect(page.faces).toEqual([]);
    expect(page.hasMore).toBe(false);
  });
});
```

> **Edge mapping:** test 1 = eligibility filter parity with `streamEligibleFaces` + exclude; test 2 = E2
> (pagination, disjoint, stable order); test 3 = E3 (exclude across a page boundary); test 4 = E1 (empty Rest).

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair.repository.spec.ts -t getClusterFacePage`
Expected: FAIL — `sut.getClusterFacePage is not a function` (method undefined). The other (existing) describes
are not in scope due to `-t getClusterFacePage`. If instead the run errors before any test with a Docker /
`IMMICH_TEST_POSTGRES_URL` message, the Docker daemon is down — start Docker Desktop and re-run.

- [ ] **Step 3: Implement `getClusterFacePage`**

Add this method to the `FaceRepairRepository` class in `server/src/repositories/face-repair.repository.ts`
(place it after `countEligibleFaces`, before `reattributeFaces`). It reuses the exact eligibility filter of
`streamEligibleFaces`/`countEligibleFaces` (including the `face_search` inner join):

```ts
  // Paginated list of a person's eligible faces minus a caller-supplied exclude list (the already-shown
  // flagged ids). Mirrors streamEligibleFaces' filter exactly — including the face_search join — so `total`
  // and the returned page are precisely the set an entire-cluster move enumerates and moves. Ordered by
  // asset_face.id for a stable offset cursor.
  async getClusterFacePage(
    personId: string,
    options: { excludeFaceIds: string[]; limit: number; offset: number },
  ): Promise<{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }> {
    const base = this.db
      .selectFrom('asset_face')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .where('asset_face.personId', '=', personId)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .$if(options.excludeFaceIds.length > 0, (qb) =>
        qb.where('asset_face.id', 'not in', options.excludeFaceIds),
      );

    const { count } = await base.select((eb) => eb.fn.countAll().as('count')).executeTakeFirstOrThrow();
    const total = Number(count);

    const rows = await base
      .select(['asset_face.id as assetFaceId'])
      .orderBy('asset_face.id')
      .limit(options.limit)
      .offset(options.offset)
      .execute();

    return {
      faces: rows.map((row) => ({ assetFaceId: row.assetFaceId })),
      total,
      hasMore: options.offset + rows.length < total,
    };
  }
```

> `sql` and `SourceType` are already imported at the top of the file — no new imports.

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair.repository.spec.ts`
Expected: PASS — all four new `getClusterFacePage` cases **and** the pre-existing `streamEligibleFaces` /
`reattributeFaces` / `reconcileRepresentativeFaces` cases (full file green).

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0.
Run: `cd .. && npx prettier --check server/src/repositories/face-repair.repository.ts server/test/medium/specs/repositories/face-repair.repository.spec.ts`
Expected: "All matched files use Prettier code style!" (if not, `npx prettier --write` those two files and re-run).

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/face-repair.repository.ts server/test/medium/specs/repositories/face-repair.repository.spec.ts
git commit -m "feat(server): paginated face-repair cluster-face lister (getClusterFacePage)"
```

---

## Self-Review

- **Spec coverage (Slice 1):** `getClusterFacePage(personId, { excludeFaceIds, limit, offset })` with the
  eligibility filter, exclude, stable ordering, `total`, `hasMore` — Task 1 ✓. Edge cases: E1 (empty Rest,
  test 4) ✓; E2 (pagination disjoint/stable, test 2) ✓; E3 (exclude across boundary, test 3) ✓. Eligibility
  parity (non-visible / non-ML / soft-deleted face / soft-deleted asset / other-person / no-face_search all
  excluded) — test 1 ✓.
- **Placeholders:** none — full method + full tests + exact commands.
- **Type consistency:** return shape `{ faces: { assetFaceId: string }[]; total: number; hasMore: boolean }`
  is identical in the Interfaces block, the implementation, and every test call. Method name
  `getClusterFacePage` is stable; matches the spec and the Slice 2/3 consumers.
- **Carry-forward to Slice 2:** the controller converts `{ page, size }` → `{ offset: page * size, limit: size }`
  and passes `excludeFaceIds` straight through to this method; the endpoint returns this method's result verbatim.
