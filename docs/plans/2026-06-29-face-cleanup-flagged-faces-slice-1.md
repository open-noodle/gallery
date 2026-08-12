# Face Cleanup — flagged-faces persist — Slice 1 (table + repository) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the `face_repair_scan_flagged_face` fork table (decorator + migration + schema registration +
revert-to-immich) and two `FaceRepairScanRepository` methods — `replaceScanFlaggedFaces` (chunked write) and
`getScanFlaggedFaces` (eligibility-joined read) — so a later slice can persist the scan's flagged faces and the
review page can read them.

**Architecture:** One new fork table keyed to `face_repair_scan` (FK ON DELETE CASCADE) with a `(scanId,
personId)` index. The read method mirrors `streamEligibleFaces`'s filter exactly (inner-join `asset` +
`asset_face` + `face_search`) so it returns only faces still on the person and still eligible. Tested at the
**medium** tier (real Postgres via testcontainers).

**Tech Stack:** Kysely + `@immich/sql-tools` decorators, PostgreSQL, `migrations-gallery` hand-written migration,
Vitest **medium** (`newMediumService` + ctx seeders).

**Spec:** [`2026-06-29-face-cleanup-flagged-faces-persist-design.md`](2026-06-29-face-cleanup-flagged-faces-persist-design.md)
— Architecture §1–§2; edges E1, E2, E5, E7, E8, E11 (and E15/E16 via cascade + scoping).

## Global Constraints

- **Fork migration layout:** new migration in `server/src/schema/migrations-gallery/` with a round timestamp
  (`1782000000000`); never touch `schema/migrations/`. Register the table in `server/src/schema/index.ts`
  (import + table list + `DB` map). Add a `DROP TABLE` to `scripts/revert-to-immich.sql`.
- **Schema check:** the decorator (incl. its `@Index`) must describe the **same** schema the migration creates —
  CI's "SQL Schema Checks" runs `migrations:generate` against the decorators and fails on any drift. Express the
  composite index via an `@Index({ name, columns })` class decorator (like `face_repair_decline`), and keep every
  constraint/index name identical between the decorator and the migration so no `TestMigration` diff is generated.
  No `migration_overrides` are needed (the `@Index` decorator expresses the index).
- **Eligibility filter (read):** mirror `streamEligibleFaces` exactly — `asset_face.personId = :personId`,
  `sourceType = MachineLearning` (`sql.lit`), `asset_face.deletedAt is null`, `asset_face.isVisible = true`,
  `asset.deletedAt is null`, and an inner-join to `face_search` (embedding must exist).
- **Server imports:** `src/` path alias only. Prettier (120/single-quote/trailing-comma); `tsc --noEmit` clean
  per commit; full lint deferred to the final slice.
- **Medium tests require Docker** (testcontainers Postgres).

---

## File Structure

- Create: `server/src/schema/tables/face-repair-scan-flagged-face.table.ts` — the table definition.
- Modify: `server/src/schema/index.ts` — register the table (import, table list, `DB` map).
- Create: `server/src/schema/migrations-gallery/1782000000000-AddFaceRepairScanFlaggedFace.ts` — create/drop.
- Modify: `scripts/revert-to-immich.sql` — `DROP TABLE` step.
- Modify: `server/src/repositories/face-repair-scan.repository.ts` — `replaceScanFlaggedFaces` +
  `getScanFlaggedFaces`.
- Create: `server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts` — medium tests.

---

## Task 1: Table + migration + schema registration + revert

**Files:**

- Create: `server/src/schema/tables/face-repair-scan-flagged-face.table.ts`
- Modify: `server/src/schema/index.ts`
- Create: `server/src/schema/migrations-gallery/1782000000000-AddFaceRepairScanFlaggedFace.ts`
- Modify: `scripts/revert-to-immich.sql`

**Interfaces:**

- Produces: the `face_repair_scan_flagged_face` table + `DB['face_repair_scan_flagged_face']` Kysely type used by
  Task 2's repository methods.

- [ ] **Step 1: Write the table definition**

`server/src/schema/tables/face-repair-scan-flagged-face.table.ts` (mirrors `face-repair-scan.table.ts`; the FK
column targets the scan table with CASCADE and no auto single-column index — the composite index is created in the
migration):

```ts
import { Column, ForeignKeyColumn, Generated, Index, Table } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table';

@Table('face_repair_scan_flagged_face')
@Index({ name: 'face_repair_scan_flagged_face_scanId_personId_idx', columns: ['scanId', 'personId'] })
export class FaceRepairScanFlaggedFaceTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FaceRepairScanTable, { onDelete: 'CASCADE', index: false })
  scanId!: string;

  @Column({ type: 'uuid' })
  assetFaceId!: string;

  @Column({ type: 'uuid' })
  personId!: string;

  @Column({ type: 'uuid' })
  suspectedOwnerId!: string;
}
```

- [ ] **Step 2: Register the table in `server/src/schema/index.ts`**

Add the import next to `FaceRepairScanTable` (~line 47):

```ts
import { FaceRepairScanFlaggedFaceTable } from 'src/schema/tables/face-repair-scan-flagged-face.table';
```

Add to the exported tables array (next to `FaceRepairScanTable,` ~line 129):

```ts
    FaceRepairScanFlaggedFaceTable,
```

Add to the `DB` interface map (next to `face_repair_scan: FaceRepairScanTable;` ~line 251):

```ts
face_repair_scan_flagged_face: FaceRepairScanFlaggedFaceTable;
```

- [ ] **Step 3: Write the migration**

`server/src/schema/migrations-gallery/1782000000000-AddFaceRepairScanFlaggedFace.ts` (mirrors
`1781000000000-AddFaceRepairDecline.ts`):

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "face_repair_scan_flagged_face" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "scanId" uuid NOT NULL,
      "assetFaceId" uuid NOT NULL,
      "personId" uuid NOT NULL,
      "suspectedOwnerId" uuid NOT NULL,
      CONSTRAINT "face_repair_scan_flagged_face_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_repair_scan_flagged_face_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "face_repair_scan" ("id") ON DELETE CASCADE
    )
  `.execute(db);
  await sql`CREATE INDEX "face_repair_scan_flagged_face_scanId_personId_idx" ON "face_repair_scan_flagged_face" ("scanId", "personId")`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "face_repair_scan_flagged_face"`.execute(db);
}
```

- [ ] **Step 4: Add the revert-to-immich drop**

In `scripts/revert-to-immich.sql`, next to the existing `DROP TABLE IF EXISTS "face_repair_decline" CASCADE;`
(~line 125), add **above** it (drop the child before its parent scan table):

```sql
DROP TABLE IF EXISTS "face_repair_scan_flagged_face" CASCADE;
```

- [ ] **Step 5: Type-check**

Run: `cd server && npx tsc --noEmit` → exit 0.

> The decorator (with `@Index`) and the migration describe the same schema; CI's "SQL Schema Checks" job validates
> decorator==migration by running `migrations:generate` (it needs a fixed-port Postgres + a build, so it isn't run
> locally here). It is validated two other ways: (a) Task 2's medium tests apply this migration via testcontainers
> `globalSetup` — a malformed migration fails their setup; (b) the constraint/index names mirror
> `face_repair_decline` exactly (`<table>_<col>_fkey`, `<table>_pkey`, and the `@Index` name == the migration's
> `CREATE INDEX` name). If CI still reports drift, reconcile per its emitted `TestMigration` diff.

- [ ] **Step 6: Commit**

```bash
git add server/src/schema/tables/face-repair-scan-flagged-face.table.ts server/src/schema/index.ts server/src/schema/migrations-gallery/1782000000000-AddFaceRepairScanFlaggedFace.ts scripts/revert-to-immich.sql
git commit -m "feat(server): face_repair_scan_flagged_face table + migration"
```

---

## Task 2: Repository write + read methods (medium TDD)

**Files:**

- Modify: `server/src/repositories/face-repair-scan.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts`

**Interfaces:**

- Consumes: the table from Task 1; medium ctx seeders (`ctx.newUser`, `ctx.newPerson({ ownerId })`,
  `ctx.newAsset({ ownerId })`, `ctx.newAssetFace({ assetId, personId, sourceType?, isVisible? })`, `ctx.database`),
  `FaceRepairScanRepository.createScan`.
- Produces (Slice 2 consumes):
  - `replaceScanFlaggedFaces(scanId: string, faces: { assetFaceId: string; personId: string; suspectedOwnerId:
string }[]): Promise<void>`
  - `getScanFlaggedFaces(scanId: string, personId: string): Promise<{ assetFaceId: string; suspectedOwnerId:
string }[]>`

- [ ] **Step 1: Write the failing tests**

Create `server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { FaceRepairScanRepository, RepairScanParams } from 'src/repositories/face-repair-scan.repository';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

const EMBEDDING = '[' + Array.from({ length: 512 }, () => 1).join(',') + ']';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [FaceRepairScanRepository, FaceRepairRepository, PersonRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FaceRepairScanRepository) };
};

type Ctx = ReturnType<typeof setup>['ctx'];

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

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('FaceRepairScanRepository flagged faces', () => {
  it('writes and reads a scan’s flagged faces for a person (E1)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);

    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    const result = await sut.getScanFlaggedFaces(scan.id, person.id);
    expect(result.map((r) => r.assetFaceId).toSorted()).toEqual([f1, f2].toSorted());
    expect(result.every((r) => r.suspectedOwnerId === owner.id)).toBe(true);
  });

  it('excludes a flagged face that has moved off the person (E2)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const { person: other } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const moved = await seedEligibleFace(ctx, user.id, person.id);
    const stay = await seedEligibleFace(ctx, user.id, person.id);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: moved, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: stay, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    // simulate an apply: reassign `moved` to another person
    await ctx.database.updateTable('asset_face').set({ personId: other.id }).where('id', '=', moved).execute();

    const result = await sut.getScanFlaggedFaces(scan.id, person.id);
    expect(result.map((r) => r.assetFaceId)).toEqual([stay]);
  });

  it('excludes non-visible / soft-deleted / asset-deleted / no-embedding faces (E5)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const ok = await seedEligibleFace(ctx, user.id, person.id);

    // not-visible
    const { asset: a1 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: notVisible } = await ctx.newAssetFace({
      assetId: a1.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
      isVisible: false,
    });
    await ctx.database.insertInto('face_search').values({ faceId: notVisible.id, embedding: EMBEDDING }).execute();

    // soft-deleted face
    const { asset: a2 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: deletedFace } = await ctx.newAssetFace({
      assetId: a2.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });
    await ctx.database
      .updateTable('asset_face')
      .set({ deletedAt: new Date() })
      .where('id', '=', deletedFace.id)
      .execute();
    await ctx.database.insertInto('face_search').values({ faceId: deletedFace.id, embedding: EMBEDDING }).execute();

    // face with no face_search embedding
    const { asset: a3 } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: noEmbedding } = await ctx.newAssetFace({
      assetId: a3.id,
      personId: person.id,
      sourceType: SourceType.MachineLearning,
    });

    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: ok, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: notVisible.id, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: deletedFace.id, personId: person.id, suspectedOwnerId: owner.id },
      { assetFaceId: noEmbedding.id, personId: person.id, suspectedOwnerId: owner.id },
    ]);

    const result = await sut.getScanFlaggedFaces(scan.id, person.id);
    expect(result.map((r) => r.assetFaceId)).toEqual([ok]);
  });

  it('scopes reads to (scanId, personId) (E11)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person: p1 } = await ctx.newPerson({ ownerId: user.id });
    const { person: p2 } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, p1.id);
    const f2 = await seedEligibleFace(ctx, user.id, p2.id);
    await sut.replaceScanFlaggedFaces(scan.id, [
      { assetFaceId: f1, personId: p1.id, suspectedOwnerId: owner.id },
      { assetFaceId: f2, personId: p2.id, suspectedOwnerId: owner.id },
    ]);

    expect((await sut.getScanFlaggedFaces(scan.id, p1.id)).map((r) => r.assetFaceId)).toEqual([f1]);
    expect((await sut.getScanFlaggedFaces(scan.id, p2.id)).map((r) => r.assetFaceId)).toEqual([f2]);
  });

  it('keeps a second scan’s rows independent and cascade-deletes on scan delete (E7, E8)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });

    const scanA = await sut.createScan({ requestedBy: null, params: PARAMS });
    const fa = await seedEligibleFace(ctx, user.id, person.id);
    await sut.replaceScanFlaggedFaces(scanA.id, [{ assetFaceId: fa, personId: person.id, suspectedOwnerId: owner.id }]);

    // cascade: deleting the scan row removes its flagged rows
    await ctx.database.deleteFrom('face_repair_scan').where('id', '=', scanA.id).execute();
    const remaining = await ctx.database
      .selectFrom('face_repair_scan_flagged_face')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('scanId', '=', scanA.id)
      .executeTakeFirstOrThrow();
    expect(Number(remaining.count)).toBe(0);

    // a fresh scan reads only its own rows
    const scanB = await sut.createScan({ requestedBy: null, params: PARAMS });
    const fb = await seedEligibleFace(ctx, user.id, person.id);
    await sut.replaceScanFlaggedFaces(scanB.id, [{ assetFaceId: fb, personId: person.id, suspectedOwnerId: owner.id }]);
    expect((await sut.getScanFlaggedFaces(scanB.id, person.id)).map((r) => r.assetFaceId)).toEqual([fb]);
  });

  it('replaceScanFlaggedFaces is idempotent (re-write replaces prior rows for the scan)', async () => {
    const { sut, ctx } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id });
    const { person: owner } = await ctx.newPerson({ ownerId: user.id });
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

    const f1 = await seedEligibleFace(ctx, user.id, person.id);
    const f2 = await seedEligibleFace(ctx, user.id, person.id);
    await sut.replaceScanFlaggedFaces(scan.id, [{ assetFaceId: f1, personId: person.id, suspectedOwnerId: owner.id }]);
    await sut.replaceScanFlaggedFaces(scan.id, [{ assetFaceId: f2, personId: person.id, suspectedOwnerId: owner.id }]);

    expect((await sut.getScanFlaggedFaces(scan.id, person.id)).map((r) => r.assetFaceId)).toEqual([f2]);
  });
});
```

> Each test uses a fresh `scan` + fresh persons, so no `afterEach` cleanup is required (reads are scoped by
> `scanId`/`personId`). Copy the exact `getKyselyDB` / `newMediumService` import paths from the sibling
> `face-repair.repository.spec.ts` if they differ.

- [ ] **Step 2: Run the tests to verify they fail (red)**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts`
Expected: FAIL — `sut.replaceScanFlaggedFaces` / `sut.getScanFlaggedFaces` are not functions. (If it errors before
any test with a Docker / `IMMICH_TEST_POSTGRES_URL` message, start Docker Desktop and re-run.)

- [ ] **Step 3: Implement the repository methods**

In `server/src/repositories/face-repair-scan.repository.ts`: ensure `SourceType` is imported (add
`import { SourceType } from 'src/enum';` if missing; `sql` is already imported from `kysely`). Add these methods
to the `FaceRepairScanRepository` class:

```ts
  async replaceScanFlaggedFaces(
    scanId: string,
    faces: { assetFaceId: string; personId: string; suspectedOwnerId: string }[],
  ): Promise<void> {
    await this.db.deleteFrom('face_repair_scan_flagged_face').where('scanId', '=', scanId).execute();
    for (let index = 0; index < faces.length; index += 1000) {
      const chunk = faces.slice(index, index + 1000);
      await this.db
        .insertInto('face_repair_scan_flagged_face')
        .values(
          chunk.map((face) => ({
            scanId,
            assetFaceId: face.assetFaceId,
            personId: face.personId,
            suspectedOwnerId: face.suspectedOwnerId,
          })),
        )
        .execute();
    }
  }

  async getScanFlaggedFaces(
    scanId: string,
    personId: string,
  ): Promise<{ assetFaceId: string; suspectedOwnerId: string }[]> {
    return this.db
      .selectFrom('face_repair_scan_flagged_face as ff')
      .innerJoin('asset_face', 'asset_face.id', 'ff.assetFaceId')
      .innerJoin('asset', 'asset.id', 'asset_face.assetId')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select(['ff.assetFaceId as assetFaceId', 'ff.suspectedOwnerId as suspectedOwnerId'])
      .where('ff.scanId', '=', scanId)
      .where('ff.personId', '=', personId)
      .where('asset_face.personId', '=', personId)
      .where('asset_face.sourceType', '=', sql.lit(SourceType.MachineLearning))
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', '=', true)
      .where('asset.deletedAt', 'is', null)
      .orderBy('ff.assetFaceId')
      .execute();
  }
```

- [ ] **Step 4: Run the tests to verify they pass (green)**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Type-check + format**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd .. && npx prettier --check server/src/repositories/face-repair-scan.repository.ts server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts` (write + re-run if needed).

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/face-repair-scan.repository.ts server/test/medium/specs/repositories/face-repair-scan-flagged-face.repository.spec.ts
git commit -m "feat(server): replace/get scan flagged faces (eligibility-joined read)"
```

---

## Self-Review

- **Spec coverage (Slice 1):** table + FK CASCADE + `(scanId, personId)` index + schema reg + revert (Task 1) ✓;
  `replaceScanFlaggedFaces` chunked write + `getScanFlaggedFaces` eligibility-joined read (Task 2) ✓. Edges:
  E1 (write/read) ✓; E2 (moved-off excluded) ✓; E5 (non-visible/soft-deleted/asset-deleted/no-embedding) ✓;
  E11 (scoping) ✓; E7 (independent second scan) ✓; E8 (cascade on scan delete) ✓ — E15/E16 ride on the cascade +
  scoping + personId filter.
- **Placeholders:** none — full decorator, migration, methods, tests, commands.
- **Type consistency:** `replaceScanFlaggedFaces(scanId, { assetFaceId, personId, suspectedOwnerId }[])` and
  `getScanFlaggedFaces(scanId, personId) → { assetFaceId, suspectedOwnerId }[]` are identical in the Interfaces,
  the implementation, and every test call. Table name `face_repair_scan_flagged_face` and the `DB` map key match.
- **Carry-forward to Slice 2:** `runScan` calls `replaceScanFlaggedFaces(scanId, allFlaggedFaces.map(...))` before
  `completeScan`; `getPersonFlaggedFaces` calls `getScanFlaggedFaces(getLatestScan().id, personId)` then
  `applyDeclineFilters`.
