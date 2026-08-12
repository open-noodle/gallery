# Face Recognition Suggestions Phase 5a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate shared-space face suggestions automatically, with no HTTP API or web UI yet.

**Architecture:** Extend the existing single `person_face_suggestion` table so each row targets exactly one personal person or one shared-space person. Add space-scoped vector search and shared-space scan repository methods, then mirror the Phase 2 personal scan jobs on `QueueName.PeopleBackfill`. The scan keys on `shared_space_person`, not personal `person`, so inherited space-person names are eligible even when a member has no named personal person row.

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools` schema decorators, fork migrations in `server/src/schema/migrations-gallery/`, BullMQ jobs via `@OnJob`, Vitest unit tests, Vitest medium tests with testcontainers Postgres.

**Design Reference:** `docs/plans/2026-05-16-face-recognition-suggestions-phase-5-design.md`.

**Phase 5a Scope:** schema migration, `searchFaces({ spaceId })`, shared-space scan repository methods, space-keyed suggestion repository methods, scan queue jobs, identity-maintenance terminal trigger, and merge/dedup pending-row resolution. No controller, DTO, OpenAPI, SDK, Dart, or web changes.

**Design Review Result:** The design is correct and consistent. The dedicated space scan is required because inherited names live on `shared_space_person.name`, while the personal scanner filters `person.name` and `asset.ownerId = person.ownerId`. The implementation must explicitly handle three gotchas: `FaceEmbeddingSearch.userIds` is currently required and must become optional only for `spaceId` scans; the migration must drop the old `(personId, assetFaceId)` unique constraint before `personId` becomes nullable and partial unique indexes are added; and every upsert that targets a partial unique index must use a matching `ON CONFLICT ... WHERE` predicate.

**Conventions for every task:** strict TDD. Write the failing test, run it, verify the expected failure, implement the minimal code, rerun green, then commit. Run all commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`.

- Unit test: `cd server && pnpm test -- --run <file>`
- Medium test: `cd server && pnpm test:medium -- --run <file>`
- Type check: `make check-server`
- Generated SQL: run `make sql` after repository method changes with `@GenerateSql`

---

### Task 1: Add space-person targeting to the suggestion schema

**Files:**

- Modify: `server/src/schema/tables/person-face-suggestion.table.ts`
- Create: `server/src/schema/migrations-gallery/1779000000000-AddSpacePersonFaceSuggestion.ts`
- Modify: `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`
- Modify: `server/src/schema/index.ts` only if type generation requires import ordering cleanup

- [ ] **Step 1: Re-check migration timestamp**

Run:

```bash
find server/src/schema/migrations server/src/schema/migrations-gallery -maxdepth 1 -type f -printf '%f\n' | sort -n | tail -n 20
```

Expected: no migration timestamp greater than or equal to `1779000000000`. If one exists, choose the next free round timestamp greater than it and use that filename throughout this task.

- [ ] **Step 2: Write the failing migration tests**

Append these tests to `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`:

```ts
it('allows exactly one of personId or spacePersonId', async () => {
  const rows = await sql<{ column_name: string; is_nullable: string }>`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'person_face_suggestion'
      AND column_name IN ('personId', 'spacePersonId')
    ORDER BY column_name
  `.execute(db);

  expect(rows.rows).toEqual([
    { column_name: 'personId', is_nullable: 'YES' },
    { column_name: 'spacePersonId', is_nullable: 'YES' },
  ]);

  const check = await sql<{ count: string }>`
    SELECT COUNT(*) AS count
    FROM pg_constraint
    WHERE conname = 'person_face_suggestion_exactly_one_target_chk'
      AND contype = 'c'
  `.execute(db);
  expect(Number(check.rows[0].count)).toBe(1);
});

it('uses partial unique indexes for personal and space-person suggestions', async () => {
  const indexes = await sql<{ indexname: string; indexdef: string }>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'person_face_suggestion'
      AND indexname IN (
        'person_face_suggestion_personId_assetFaceId_uq',
        'person_face_suggestion_spacePersonId_assetFaceId_uq',
        'person_face_suggestion_spacePersonId_status_distance_idx'
      )
    ORDER BY indexname
  `.execute(db);

  expect(indexes.rows.map((row) => row.indexname).sort()).toEqual([
    'person_face_suggestion_personId_assetFaceId_uq',
    'person_face_suggestion_spacePersonId_assetFaceId_uq',
    'person_face_suggestion_spacePersonId_status_distance_idx',
  ]);
  expect(
    indexes.rows.find((row) => row.indexname === 'person_face_suggestion_personId_assetFaceId_uq')?.indexdef,
  ).toContain('WHERE ("personId" IS NOT NULL)');
  expect(
    indexes.rows.find((row) => row.indexname === 'person_face_suggestion_spacePersonId_assetFaceId_uq')?.indexdef,
  ).toContain('WHERE ("spacePersonId" IS NOT NULL)');
});

it('keeps the updatedAt trigger migration override row intact', async () => {
  const row = await sql<{ count: string }>`
    SELECT COUNT(*) AS count
    FROM migration_overrides
    WHERE name = 'trigger_person_face_suggestion_updatedAt'
  `.execute(db);

  expect(Number(row.rows[0].count)).toBe(1);
});
```

- [ ] **Step 3: Run the migration test and verify RED**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/migrations/person-face-suggestion.migration.spec.ts
```

Expected: FAIL because `spacePersonId` and `person_face_suggestion_exactly_one_target_chk` do not exist.

- [ ] **Step 4: Update the schema table**

In `server/src/schema/tables/person-face-suggestion.table.ts`, import `SharedSpacePersonTable` and change the decorators/columns to this shape:

```ts
import { SharedSpacePersonTable } from 'src/schema/tables/shared-space-person.table';

@Index({
  name: 'person_face_suggestion_personId_status_distance_idx',
  columns: ['personId', 'status', 'distance'],
})
@Index({
  name: 'person_face_suggestion_spacePersonId_status_distance_idx',
  columns: ['spacePersonId', 'status', 'distance'],
  where: '"spacePersonId" IS NOT NULL',
})
@Index({ name: 'person_face_suggestion_assetFaceId_idx', columns: ['assetFaceId'] })
@Index({
  name: 'person_face_suggestion_personId_assetFaceId_uq',
  columns: ['personId', 'assetFaceId'],
  unique: true,
  where: '"personId" IS NOT NULL',
})
@Index({
  name: 'person_face_suggestion_spacePersonId_assetFaceId_uq',
  columns: ['spacePersonId', 'assetFaceId'],
  unique: true,
  where: '"spacePersonId" IS NOT NULL',
})
@Check({
  name: 'person_face_suggestion_exactly_one_target_chk',
  expression: `num_nonnulls("personId", "spacePersonId") = 1`,
})
export class PersonFaceSuggestionTable {
  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', nullable: true, index: false })
  personId!: string | null;

  @ForeignKeyColumn(() => SharedSpacePersonTable, { onDelete: 'CASCADE', nullable: true, index: false })
  spacePersonId!: string | null;
}
```

Keep the existing status check, `assetFaceId`, timestamps, and `updateId`.

- [ ] **Step 5: Add the migration**

Create `server/src/schema/migrations-gallery/1779000000000-AddSpacePersonFaceSuggestion.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT IF EXISTS "person_face_suggestion_personId_assetFaceId_uq"
  `.execute(db);

  await sql`
    DROP INDEX IF EXISTS "person_face_suggestion_personId_assetFaceId_uq"
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ALTER COLUMN "personId" DROP NOT NULL
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD COLUMN "spacePersonId" uuid
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_spacePersonId_fkey"
    FOREIGN KEY ("spacePersonId") REFERENCES "shared_space_person" ("id") ON DELETE CASCADE
  `.execute(db);

  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_exactly_one_target_chk"
    CHECK (num_nonnulls("personId", "spacePersonId") = 1)
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_personId_assetFaceId_uq"
    ON "person_face_suggestion" ("personId", "assetFaceId")
    WHERE "personId" IS NOT NULL
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_spacePersonId_assetFaceId_uq"
    ON "person_face_suggestion" ("spacePersonId", "assetFaceId")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);

  await sql`
    CREATE INDEX "person_face_suggestion_spacePersonId_status_distance_idx"
    ON "person_face_suggestion" ("spacePersonId", "status", "distance")
    WHERE "spacePersonId" IS NOT NULL
  `.execute(db);

  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES (
      'trigger_person_face_suggestion_updatedAt',
      '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb
    )
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP INDEX IF EXISTS "person_face_suggestion_spacePersonId_status_distance_idx"`.execute(db);
  await sql`DROP INDEX IF EXISTS "person_face_suggestion_spacePersonId_assetFaceId_uq"`.execute(db);
  await sql`DROP INDEX IF EXISTS "person_face_suggestion_personId_assetFaceId_uq"`.execute(db);
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT IF EXISTS "person_face_suggestion_exactly_one_target_chk"
  `.execute(db);
  await sql`
    ALTER TABLE "person_face_suggestion"
    DROP CONSTRAINT IF EXISTS "person_face_suggestion_spacePersonId_fkey"
  `.execute(db);
  await sql`ALTER TABLE "person_face_suggestion" DROP COLUMN IF EXISTS "spacePersonId"`.execute(db);
  await sql`
    ALTER TABLE "person_face_suggestion"
    ALTER COLUMN "personId" SET NOT NULL
  `.execute(db);
  await sql`
    ALTER TABLE "person_face_suggestion"
    ADD CONSTRAINT "person_face_suggestion_personId_assetFaceId_uq" UNIQUE ("personId", "assetFaceId")
  `.execute(db);
  await sql`
    INSERT INTO "migration_overrides" ("name", "value")
    VALUES (
      'trigger_person_face_suggestion_updatedAt',
      '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb
    )
    ON CONFLICT ("name") DO UPDATE SET "value" = EXCLUDED."value"
  `.execute(db);
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/migrations/person-face-suggestion.migration.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/schema/tables/person-face-suggestion.table.ts server/src/schema/migrations-gallery/1779000000000-AddSpacePersonFaceSuggestion.ts server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts server/src/schema/index.ts
git commit -m "feat(server): support space-person face suggestion rows"
```

### Task 2: Add space-scoped `searchFaces`

**Files:**

- Modify: `server/src/repositories/search.repository.ts`
- Modify: `server/test/medium/specs/repositories/search.repository.spec.ts`

- [ ] **Step 1: Write failing medium tests**

Append under `describe('searchFaces hasPerson tri-state')` or create a sibling describe:

```ts
it('spaceId scope returns unassigned faces from direct shared assets and linked libraries without owner filtering', async () => {
  const { ctx, sut } = setup();
  const { user: owner } = await ctx.newUser();
  const { user: other } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  const { library } = await ctx.newLibrary({ ownerId: other.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: owner.id });

  const embedding = newEmbedding();
  const { asset: directAsset } = await ctx.newAsset({ ownerId: owner.id });
  const { assetFace: directFace } = await ctx.newAssetFace({ assetId: directAsset.id, personId: null });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: directAsset.id, addedById: owner.id });

  const { asset: libraryAsset } = await ctx.newAsset({ ownerId: other.id, libraryId: library.id });
  const { assetFace: libraryFace } = await ctx.newAssetFace({ assetId: libraryAsset.id, personId: null });

  const { asset: outsideAsset } = await ctx.newAsset({ ownerId: other.id });
  const { assetFace: outsideFace } = await ctx.newAssetFace({ assetId: outsideAsset.id, personId: null });

  await ctx.database
    .insertInto('face_search')
    .values([
      { faceId: directFace.id, embedding },
      { faceId: libraryFace.id, embedding },
      { faceId: outsideFace.id, embedding },
    ])
    .execute();

  const result = await sut.searchFaces({
    spaceId: space.id,
    embedding,
    numResults: 10,
    maxDistance: 2,
    hasPerson: false,
  });

  const ids = result.map((row) => row.id);
  expect(ids).toContain(directFace.id);
  expect(ids).toContain(libraryFace.id);
  expect(ids).not.toContain(outsideFace.id);
});

it('spaceId scope still respects hasPerson:false', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const embedding = newEmbedding();
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Ada' });
  const { assetFace: assigned } = await ctx.newAssetFace({ assetId: asset.id, personId: person.id });
  const { assetFace: unassigned } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  await ctx.database
    .insertInto('face_search')
    .values([
      { faceId: assigned.id, embedding },
      { faceId: unassigned.id, embedding },
    ])
    .execute();

  const result = await sut.searchFaces({
    spaceId: space.id,
    embedding,
    numResults: 10,
    maxDistance: 2,
    hasPerson: false,
  });

  expect(result.map((row) => row.id)).toEqual([unassigned.id]);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts
```

Expected: FAIL because `searchFaces` requires/applies `userIds` and ignores `spaceId`.

- [ ] **Step 3: Implement the space scope**

In `server/src/repositories/search.repository.ts`, change `SearchEmbeddingOptions` and `FaceEmbeddingSearch` so `userIds` is optional only when `spaceId` is provided:

```ts
export interface SearchEmbeddingOptions {
  embedding: string;
  userIds?: string[];
  spaceId?: string;
  maxDistance?: number;
}
```

Update `searchFaces`:

```ts
searchFaces({ userIds = [], spaceId, embedding, numResults, maxDistance, hasPerson, minBirthDate }: FaceEmbeddingSearch) {
  if (spaceId && userIds.length > 0) {
    throw new Error(`'userIds' must be omitted when 'spaceId' is provided`);
  }
  if (!spaceId && userIds.length === 0) {
    throw new Error(`Either 'userIds' or 'spaceId' is required`);
  }

  // inside the CTE query, replace the unconditional owner filter:
  .$if(!spaceId, (qb) => qb.where('asset.ownerId', '=', anyUuid(userIds)))
  .$if(!!spaceId, (qb) =>
    qb.where((eb) =>
      eb.or([
        eb.exists(
          eb
            .selectFrom('shared_space_asset')
            .whereRef('shared_space_asset.assetId', '=', 'asset.id')
            .where('shared_space_asset.spaceId', '=', asUuid(spaceId!)),
        ),
        eb.exists(
          eb
            .selectFrom('shared_space_library')
            .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
            .where('shared_space_library.spaceId', '=', asUuid(spaceId!)),
        ),
      ]),
    ),
  )
```

Keep `asset.deletedAt IS NULL`, `hasPerson`, `minBirthDate`, vector ordering, and distance filter unchanged.

Update the `@GenerateSql` decorator for `searchFaces` so generated SQL docs cover both branches:

```ts
@GenerateSql({
  params: [
    {
      userIds: [DummyValue.UUID],
      embedding: DummyValue.VECTOR,
      numResults: 10,
      maxDistance: 0.6,
    },
    {
      spaceId: DummyValue.UUID,
      embedding: DummyValue.VECTOR,
      numResults: 10,
      maxDistance: 0.6,
      hasPerson: false,
    },
  ],
})
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): add space-scoped face embedding search"
```

### Task 3: Add shared-space scan repository methods

**Files:**

- Modify: `server/src/repositories/shared-space.repository.ts`
- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts`

- [ ] **Step 1: Write failing tests**

Append to `server/test/medium/specs/repositories/shared-space.repository.spec.ts`:

```ts
describe('space face suggestion scan helpers', () => {
  it('gets assigned face embeddings for a shared-space person', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace: linkedFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const { assetFace: unlinkedFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const spacePerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Alice',
      representativeFaceId: linkedFace.id,
    });
    await sut.addPersonFaces([{ personId: spacePerson.id, assetFaceId: linkedFace.id }]);
    await ctx.database
      .insertInto('face_search')
      .values([
        { faceId: linkedFace.id, embedding: newEmbedding() },
        { faceId: unlinkedFace.id, embedding: newEmbedding() },
      ])
      .execute();

    const rows = await sut.getSpacePersonAssignedFaceEmbeddings(spacePerson.id, 20);

    expect(rows).toHaveLength(1);
    expect(rows[0].embedding).toEqual(expect.any(String));
  });

  it('streams only named visible person-type space people in face-recognition-enabled spaces with unassigned ML faces in scope', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { space: disabledSpace } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    await ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding: newEmbedding() }).execute();

    const included = await sut.createPerson({ spaceId: space.id, name: '  Alice  ', type: 'person', isHidden: false });
    const whitespace = await sut.createPerson({ spaceId: space.id, name: '   ', type: 'person', isHidden: false });
    const hidden = await sut.createPerson({ spaceId: space.id, name: 'Hidden', type: 'person', isHidden: true });
    const pet = await sut.createPerson({ spaceId: space.id, name: 'Pet', type: 'pet', isHidden: false });
    const disabled = await sut.createPerson({
      spaceId: disabledSpace.id,
      name: 'Disabled',
      type: 'person',
      isHidden: false,
    });

    const ids: string[] = [];
    for await (const row of sut.getScannableSpacePeopleWithUnassignedFaces()) {
      ids.push(row.id);
    }

    expect(ids).toContain(included.id);
    expect(ids).not.toContain(whitespace.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(pet.id);
    expect(ids).not.toContain(disabled.id);
  });

  it('treats linked-library unassigned ML faces as scannable space scope', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { library } = await ctx.newLibrary({ ownerId: user.id });
    await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id, addedById: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id, libraryId: library.id });
    await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const linkedLibraryPerson = await sut.createPerson({
      spaceId: space.id,
      name: 'Library Alice',
      type: 'person',
      isHidden: false,
    });

    const ids: string[] = [];
    for await (const row of sut.getScannableSpacePeopleWithUnassignedFaces()) {
      ids.push(row.id);
    }

    expect(ids).toContain(linkedLibraryPerson.id);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts
```

Expected: FAIL because the two repository methods do not exist.

- [ ] **Step 3: Implement methods**

Add to `server/src/repositories/shared-space.repository.ts` near `getSpacePersonsWithEmbeddings`:

```ts
@GenerateSql({ params: [DummyValue.UUID, 20] })
getSpacePersonAssignedFaceEmbeddings(spacePersonId: string, limit: number) {
  return this.db
    .selectFrom('shared_space_person_face')
    .innerJoin('face_search', 'face_search.faceId', 'shared_space_person_face.assetFaceId')
    .innerJoin('asset_face', 'asset_face.id', 'shared_space_person_face.assetFaceId')
    .select('face_search.embedding')
    .where('shared_space_person_face.personId', '=', spacePersonId)
    .where('asset_face.deletedAt', 'is', null)
    .where('asset_face.isVisible', '=', true)
    .limit(limit)
    .execute();
}

getScannableSpacePeopleWithUnassignedFaces() {
  return this.db
    .selectFrom('shared_space_person')
    .innerJoin('shared_space', 'shared_space.id', 'shared_space_person.spaceId')
    .select(['shared_space_person.id', 'shared_space_person.spaceId'])
    .where(sql`BTRIM("shared_space_person"."name")`, '<>', '')
    .where('shared_space_person.isHidden', '=', false)
    .where('shared_space_person.type', '=', 'person')
    .where('shared_space.faceRecognitionEnabled', '=', true)
    .where((eb) =>
      eb.exists(
        eb
          .selectFrom('asset_face')
          .innerJoin('asset', 'asset.id', 'asset_face.assetId')
          .select('asset_face.id')
          .where('asset.deletedAt', 'is', null)
          .where('asset_face.personId', 'is', null)
          .where('asset_face.deletedAt', 'is', null)
          .where('asset_face.isVisible', '=', true)
          .where('asset_face.sourceType', '=', SourceType.MachineLearning)
          .where((eb) =>
            eb.or([
              eb.exists(
                eb
                  .selectFrom('shared_space_asset')
                  .select('shared_space_asset.assetId')
                  .whereRef('shared_space_asset.assetId', '=', 'asset.id')
                  .whereRef('shared_space_asset.spaceId', '=', 'shared_space_person.spaceId'),
              ),
              eb.exists(
                eb
                  .selectFrom('shared_space_library')
                  .select('shared_space_library.libraryId')
                  .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
                  .whereRef('shared_space_library.spaceId', '=', 'shared_space_person.spaceId'),
              ),
            ]),
          ),
      ),
    )
    .stream();
}
```

Use existing `SourceType` import or add it from `src/enum`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/repositories/shared-space.repository.ts server/test/medium/specs/repositories/shared-space.repository.spec.ts
git commit -m "feat(server): add space-person suggestion scan queries"
```

### Task 4: Add space-keyed suggestion repository methods and read filtering

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

- [ ] **Step 1: Write failing repository tests**

Append:

```ts
describe('space-person suggestion methods', () => {
  it('upserts pending rows by spacePersonId and never resurrects dismissed rows', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Alice' })
      .returningAll()
      .executeTakeFirstOrThrow();

    await sut.upsertPendingForSpacePerson([
      { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
    ]);
    expect(await sut.markDismissedForSpacePerson(spacePerson.id, assetFace.id)).toBe(1);
    await sut.upsertPendingForSpacePerson([
      { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.6 },
    ]);

    const row = await defaultDatabase
      .selectFrom('person_face_suggestion')
      .selectAll()
      .where('spacePersonId', '=', spacePerson.id)
      .where('assetFaceId', '=', assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('dismissed');
    expect(row.distance).toBe(0.7);
  });

  it('markConfirmedForSpacePerson is idempotent and status-guarded', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Alice' })
      .returningAll()
      .executeTakeFirstOrThrow();

    await sut.upsertPendingForSpacePerson([
      { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
    ]);

    expect(await sut.markConfirmedForSpacePerson(spacePerson.id, assetFace.id)).toBe(1);
    expect(await sut.markConfirmedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);
    expect(await sut.markDismissedForSpacePerson(spacePerson.id, assetFace.id)).toBe(0);

    const row = await defaultDatabase
      .selectFrom('person_face_suggestion')
      .selectAll()
      .where('spacePersonId', '=', spacePerson.id)
      .where('assetFaceId', '=', assetFace.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('confirmed');
  });

  it('getPendingForSpacePerson filters unshared stale rows at read time', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { asset: keptAsset } = await ctx.newAsset({ ownerId: user.id });
    const { asset: unsharedAsset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: keptAsset.id, addedById: user.id });
    const { assetFace: keptFace } = await ctx.newAssetFace({ assetId: keptAsset.id, personId: null });
    const { assetFace: staleFace } = await ctx.newAssetFace({ assetId: unsharedAsset.id, personId: null });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Alice', type: 'person', isHidden: false })
      .returningAll()
      .executeTakeFirstOrThrow();
    await sut.upsertPendingForSpacePerson([
      { spacePersonId: spacePerson.id, assetFaceId: keptFace.id, distance: 0.6 },
      { spacePersonId: spacePerson.id, assetFaceId: staleFace.id, distance: 0.7 },
    ]);

    const result = await sut.getPendingForSpacePerson(space.id, spacePerson.id, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.8,
      page: 1,
      size: 10,
    });

    expect(result.total).toBe(1);
    expect(result.items.map((item) => item.assetFaceId)).toEqual([keptFace.id]);
  });

  it('getPendingForSpacePerson returns empty for whitespace name, hidden person, pet person, disabled space, and disabled band', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
    const { space: disabledSpace } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: false });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const rows = await ctx.database
      .insertInto('shared_space_person')
      .values([
        { spaceId: space.id, name: 'Valid', type: 'person', isHidden: false },
        { spaceId: space.id, name: '   ', type: 'person', isHidden: false },
        { spaceId: space.id, name: 'Hidden', type: 'person', isHidden: true },
        { spaceId: space.id, name: 'Pet', type: 'pet', isHidden: false },
        { spaceId: disabledSpace.id, name: 'Disabled', type: 'person', isHidden: false },
      ])
      .returningAll()
      .execute();

    for (const person of rows.slice(1)) {
      await sut.upsertPendingForSpacePerson([{ spacePersonId: person.id, assetFaceId: assetFace.id, distance: 0.6 }]);
      await expect(
        sut.getPendingForSpacePerson(person.spaceId, person.id, {
          maxDistance: 0.5,
          suggestionMaxDistance: 0.8,
          page: 1,
          size: 10,
        }),
      ).resolves.toEqual({ total: 0, items: [] });
    }

    await sut.upsertPendingForSpacePerson([{ spacePersonId: rows[0].id, assetFaceId: assetFace.id, distance: 0.6 }]);
    await expect(
      sut.getPendingForSpacePerson(space.id, rows[0].id, {
        maxDistance: 0.5,
        suggestionMaxDistance: 0.5,
        page: 1,
        size: 10,
      }),
    ).resolves.toEqual({ total: 0, items: [] });
  });

  it('resolveAssignedFace deletes pending personal and space-person rows for the same face', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Personal' });
    const { space } = await ctx.newSharedSpace({ createdById: user.id });
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
    const spacePerson = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: space.id, name: 'Space' })
      .returningAll()
      .executeTakeFirstOrThrow();

    await sut.upsertPending([{ personId: person.id, assetFaceId: assetFace.id, distance: 0.65 }]);
    await sut.upsertPendingForSpacePerson([
      { spacePersonId: spacePerson.id, assetFaceId: assetFace.id, distance: 0.7 },
    ]);
    await sut.resolveAssignedFace(assetFace.id);

    const pending = await defaultDatabase
      .selectFrom('person_face_suggestion')
      .selectAll()
      .where('assetFaceId', '=', assetFace.id)
      .where('status', '=', 'pending')
      .execute();
    expect(pending).toEqual([]);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
```

Expected: FAIL because space-keyed methods do not exist.

- [ ] **Step 3: Implement methods**

Add methods to `server/src/repositories/person-face-suggestion.repository.ts`:

```ts
@GenerateSql({ params: [[{ spacePersonId: DummyValue.UUID, assetFaceId: DummyValue.UUID, distance: 0.6 }]] })
async upsertPendingForSpacePerson(
  rows: Array<{ spacePersonId: string; assetFaceId: string; distance: number }>,
): Promise<void> {
  if (rows.length === 0) {
    return;
  }
  await this.db
    .insertInto('person_face_suggestion')
    .values(rows.map((row) => ({ spacePersonId: row.spacePersonId, assetFaceId: row.assetFaceId, distance: row.distance })))
    .onConflict((oc) =>
      oc
        .columns(['spacePersonId', 'assetFaceId'])
        .where('spacePersonId', 'is not', null)
        .doUpdateSet({ distance: (eb) => eb.ref('excluded.distance'), updatedAt: sql`now()` })
        .where('person_face_suggestion.status', '=', 'pending'),
    )
    .execute();
}
```

Also update the existing personal `upsertPending` to target its new partial unique index:

```ts
.onConflict((oc) =>
  oc
    .columns(['personId', 'assetFaceId'])
    .where('personId', 'is not', null)
    .doUpdateSet({
      distance: (eb) => eb.ref('excluded.distance'),
      updatedAt: sql`now()`,
    })
    .where('person_face_suggestion.status', '=', 'pending'),
)
```

```ts
@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async markConfirmedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
  const result = await this.db
    .updateTable('person_face_suggestion')
    .set({ status: 'confirmed' })
    .where('spacePersonId', '=', spacePersonId)
    .where('assetFaceId', '=', assetFaceId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0n);
}

@GenerateSql({ params: [DummyValue.UUID, DummyValue.UUID] })
async markDismissedForSpacePerson(spacePersonId: string, assetFaceId: string): Promise<number> {
  const result = await this.db
    .updateTable('person_face_suggestion')
    .set({ status: 'dismissed' })
    .where('spacePersonId', '=', spacePersonId)
    .where('assetFaceId', '=', assetFaceId)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  return Number(result.numUpdatedRows ?? 0n);
}
```

Add `getPendingForSpacePerson(spaceId, spacePersonId, opts)` by copying `getPendingForPerson`, replacing the person read gate with:

```ts
.selectFrom('shared_space_person')
.innerJoin('shared_space', 'shared_space.id', 'shared_space_person.spaceId')
.select('shared_space_person.id')
.where('shared_space_person.id', '=', spacePersonId)
.where('shared_space_person.spaceId', '=', spaceId)
.where(sql`BTRIM("shared_space_person"."name")`, '<>', '')
.where('shared_space_person.isHidden', '=', false)
.where('shared_space_person.type', '=', 'person')
.where('shared_space.faceRecognitionEnabled', '=', true)
```

In the base query use `pfs.spacePersonId = spacePersonId`, `af.personId IS NULL`, `af.deletedAt IS NULL`, `af.isVisible = true`, `asset.deletedAt IS NULL`, and this space-accessible predicate:

```ts
.where((eb) =>
  eb.or([
    eb.exists(
      eb
        .selectFrom('shared_space_asset')
        .whereRef('shared_space_asset.assetId', '=', 'asset.id')
        .where('shared_space_asset.spaceId', '=', spaceId),
    ),
    eb.exists(
      eb
        .selectFrom('shared_space_library')
        .whereRef('shared_space_library.libraryId', '=', 'asset.libraryId')
        .where('shared_space_library.spaceId', '=', spaceId),
    ),
  ]),
)
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): add space-person suggestion repository methods"
```

### Task 5: Add space-person suggestion job names and scan handlers

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/types.ts`
- Modify: `server/src/services/person.service.ts`
- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Add minimal enum/type scaffolding**

> TDD note: this is compile-only scaffolding so the following RED tests can reference the new job names and payload type. Keep this step limited to enum members and TypeScript payload declarations; all runtime behavior is introduced only after failing tests.

In `server/src/enum.ts`, after `PersonSuggestionScan` add:

```ts
SpacePersonSuggestionScanQueueAll = 'SpacePersonSuggestionScanQueueAll',
SpacePersonSuggestionScan = 'SpacePersonSuggestionScan',
```

In `server/src/types.ts`, add:

```ts
export interface ISpacePersonSuggestionScanJob extends IBaseJob {
  id: string;
}
```

And add to `JobItem`:

```ts
| { name: JobName.SpacePersonSuggestionScanQueueAll; data: IBaseJob }
| { name: JobName.SpacePersonSuggestionScan; data: ISpacePersonSuggestionScanJob }
```

- [ ] **Step 2: Write failing unit tests for the scan handler**

In `server/src/services/person.service.spec.ts`, add:

```ts
describe('handleSpacePersonSuggestionScan', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('runs on the people backfill queue', () => {
    const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScan);
    expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
  });

  it('skips when feature is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
    });

    await expect(sut.handleSpacePersonSuggestionScan({ id: 'space-person-1' })).resolves.toBe(JobStatus.Skipped);
    expect((mocks.sharedSpace as any).getSpacePersonAssignedFaceEmbeddings).not.toHaveBeenCalled();
  });

  it('skips missing, unnamed, whitespace, hidden, pet, or disabled-space people', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    (mocks.sharedSpace as any).getPersonById.mockResolvedValueOnce(undefined);
    await expect(sut.handleSpacePersonSuggestionScan({ id: 'gone' })).resolves.toBe(JobStatus.Skipped);

    for (const person of [
      { id: 'p', spaceId: 's', name: '', isHidden: false, type: 'person', faceRecognitionEnabled: true },
      { id: 'p', spaceId: 's', name: '   ', isHidden: false, type: 'person', faceRecognitionEnabled: true },
      { id: 'p', spaceId: 's', name: 'Alice', isHidden: true, type: 'person', faceRecognitionEnabled: true },
      { id: 'p', spaceId: 's', name: 'Rex', isHidden: false, type: 'pet', faceRecognitionEnabled: true },
      { id: 'p', spaceId: 's', name: 'Alice', isHidden: false, type: 'person', faceRecognitionEnabled: false },
    ]) {
      (mocks.sharedSpace as any).getPersonById.mockResolvedValueOnce(person);
      (mocks.sharedSpace as any).getById.mockResolvedValueOnce({
        id: 's',
        faceRecognitionEnabled: person.faceRecognitionEnabled,
      });
      await expect(sut.handleSpacePersonSuggestionScan({ id: 'p' })).resolves.toBe(JobStatus.Skipped);
    }
  });

  it('keeps only the open band, takes min distance per candidate, and upserts by spacePersonId', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    (mocks.sharedSpace as any).getPersonById.mockResolvedValue({
      id: 'sp',
      spaceId: 'space-1',
      name: 'Alice',
      isHidden: false,
      type: 'person',
    });
    (mocks.sharedSpace as any).getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true });
    (mocks.sharedSpace as any).getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([
      { embedding: 'e1' },
      { embedding: 'e2' },
    ]);
    mocks.search.searchFaces
      .mockResolvedValueOnce([
        { id: 'too-close', personId: null, distance: 0.5 },
        { id: 'candidate', personId: null, distance: 0.7 },
      ])
      .mockResolvedValueOnce([{ id: 'candidate', personId: null, distance: 0.6 }]);

    await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Success);

    expect(mocks.search.searchFaces).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: 'space-1',
        hasPerson: false,
        maxDistance: 0.8,
        numResults: 100,
      }),
    );
    expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).toHaveBeenCalledWith([
      { spacePersonId: 'sp', assetFaceId: 'candidate', distance: 0.6 },
    ]);
  });

  it('skips when the space person has zero linked face embeddings', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    (mocks.sharedSpace as any).getPersonById.mockResolvedValue({
      id: 'sp',
      spaceId: 'space-1',
      name: 'Alice',
      isHidden: false,
      type: 'person',
    });
    (mocks.sharedSpace as any).getById.mockResolvedValue({ id: 'space-1', faceRecognitionEnabled: true });
    (mocks.sharedSpace as any).getSpacePersonAssignedFaceEmbeddings.mockResolvedValue([]);

    await expect(sut.handleSpacePersonSuggestionScan({ id: 'sp' })).resolves.toBe(JobStatus.Skipped);
    expect(mocks.search.searchFaces).not.toHaveBeenCalled();
    expect(mocks.personFaceSuggestion.upsertPendingForSpacePerson).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Write failing unit tests for queue-all**

Add:

```ts
describe('handleSpacePersonSuggestionScanQueueAll', () => {
  const enabled = {
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  };

  it('runs on the people backfill queue', () => {
    const config = new Reflector().get(MetadataKey.JobConfig, sut.handleSpacePersonSuggestionScanQueueAll);
    expect(config).toEqual(expect.objectContaining({ queue: QueueName.PeopleBackfill }));
  });

  it('skips enumeration when feature is disabled', async () => {
    mocks.systemMetadata.get.mockResolvedValue({
      machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0, minFaces: 3 } },
    });
    await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Skipped);
    expect((mocks.sharedSpace as any).getScannableSpacePeopleWithUnassignedFaces).not.toHaveBeenCalled();
  });

  it('queues one SpacePersonSuggestionScan per scannable space person', async () => {
    mocks.systemMetadata.get.mockResolvedValue(enabled);
    (mocks.sharedSpace as any).getScannableSpacePeopleWithUnassignedFaces.mockReturnValue(
      makeStream([
        { id: 'sp1', spaceId: 's1' },
        { id: 'sp2', spaceId: 's1' },
      ]),
    );

    await expect(sut.handleSpacePersonSuggestionScanQueueAll({})).resolves.toBe(JobStatus.Success);

    expect(mocks.job.queueAll).toHaveBeenCalledWith([
      { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp1' } },
      { name: JobName.SpacePersonSuggestionScan, data: { id: 'sp2' } },
    ]);
  });
});
```

- [ ] **Step 4: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
```

Expected: FAIL because handlers do not exist.

- [ ] **Step 5: Implement handlers**

In `server/src/services/person.service.ts`, reuse the existing constants `PERSON_SUGGESTION_EMBEDDING_SAMPLE` and `PERSON_SUGGESTION_NUM_RESULTS`.

Add:

```ts
@OnJob({ name: JobName.SpacePersonSuggestionScan, queue: QueueName.PeopleBackfill })
async handleSpacePersonSuggestionScan({ id }: JobOf<JobName.SpacePersonSuggestionScan>): Promise<JobStatus> {
  const { machineLearning } = await this.getConfig({ withCache: true });
  const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
  if (suggestionMaxDistance <= maxDistance) {
    return JobStatus.Skipped;
  }

  const person = await this.sharedSpaceRepository.getPersonById(id);
  if (!person || person.name.trim() === '' || person.isHidden || person.type !== 'person') {
    return JobStatus.Skipped;
  }
  const space = await this.sharedSpaceRepository.getById(person.spaceId);
  if (!space?.faceRecognitionEnabled) {
    return JobStatus.Skipped;
  }

  const embeddings = await this.sharedSpaceRepository.getSpacePersonAssignedFaceEmbeddings(
    id,
    PERSON_SUGGESTION_EMBEDDING_SAMPLE,
  );
  if (embeddings.length === 0) {
    return JobStatus.Skipped;
  }

  const bestByFace = new Map<string, number>();
  for (const { embedding } of embeddings) {
    const matches = await this.searchRepository.searchFaces({
      spaceId: person.spaceId,
      embedding,
      hasPerson: false,
      maxDistance: suggestionMaxDistance,
      numResults: PERSON_SUGGESTION_NUM_RESULTS,
    });
    for (const match of matches) {
      if (match.distance <= maxDistance) {
        continue;
      }
      const previous = bestByFace.get(match.id);
      if (previous === undefined || match.distance < previous) {
        bestByFace.set(match.id, match.distance);
      }
    }
  }

  await this.personFaceSuggestionRepository.upsertPendingForSpacePerson(
    [...bestByFace].map(([assetFaceId, distance]) => ({ spacePersonId: id, assetFaceId, distance })),
  );
  return JobStatus.Success;
}

@OnJob({ name: JobName.SpacePersonSuggestionScanQueueAll, queue: QueueName.PeopleBackfill })
async handleSpacePersonSuggestionScanQueueAll(_data: JobOf<JobName.SpacePersonSuggestionScanQueueAll>): Promise<JobStatus> {
  const { machineLearning } = await this.getConfig({ withCache: false });
  const { maxDistance, suggestionMaxDistance } = machineLearning.facialRecognition;
  if (suggestionMaxDistance <= maxDistance) {
    return JobStatus.Skipped;
  }

  let jobs: { name: JobName.SpacePersonSuggestionScan; data: { id: string } }[] = [];
  for await (const person of this.sharedSpaceRepository.getScannableSpacePeopleWithUnassignedFaces()) {
    jobs.push({ name: JobName.SpacePersonSuggestionScan, data: { id: person.id } });
    if (jobs.length === JOBS_ASSET_PAGINATION_SIZE) {
      await this.jobRepository.queueAll(jobs);
      jobs = [];
    }
  }
  await this.jobRepository.queueAll(jobs);
  return JobStatus.Success;
}
```

- [ ] **Step 6: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/enum.ts server/src/types.ts server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): add space-person suggestion scan jobs"
```

### Task 6: Chain space scans at identity-maintenance terminal

**Files:**

- Modify: `server/src/services/person.service.ts`
- Modify: `server/src/services/person.service.spec.ts`

- [ ] **Step 1: Write failing tests**

Extend the existing `handleFaceIdentityBackfill` terminal tests:

```ts
it('chains personal and space suggestion queue-all jobs when identity maintenance completes and suggestions are enabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.8, minFaces: 3 } },
  });
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: false,
    hasSharedSpaceProjectionWork: false,
  });

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
  expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
});

it('does not chain space suggestion queue-all when face suggestion band is disabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({
    machineLearning: { facialRecognition: { maxDistance: 0.5, suggestionMaxDistance: 0.5, minFaces: 3 } },
  });
  mocks.faceIdentity.backfillPersonalIdentities.mockResolvedValue({ processed: 0 });
  mocks.faceIdentity.backfillSpacePersonIdentities.mockResolvedValue({ processed: 0, conflictCount: 0 });
  (mocks.faceIdentity as any).getBackfillWork.mockResolvedValue({
    hasPersonalIdentityWork: false,
    hasSpacePersonIdentityWork: false,
    hasSharedSpaceProjectionWork: false,
  });

  await expect(sut.handleFaceIdentityBackfill({ stage: 'person' })).resolves.toBe(JobStatus.Success);

  expect(mocks.job.queue).not.toHaveBeenCalledWith({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
```

Expected: FAIL because only `PersonSuggestionScanQueueAll` is queued.

- [ ] **Step 3: Implement terminal queue**

In `handleFaceIdentityBackfill`, inside:

```ts
if (suggestionMaxDistance > maxDistance) {
  await this.jobRepository.queue({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
}
```

change to:

```ts
if (suggestionMaxDistance > maxDistance) {
  await this.jobRepository.queue({ name: JobName.PersonSuggestionScanQueueAll, data: {} });
  await this.jobRepository.queue({ name: JobName.SpacePersonSuggestionScanQueueAll, data: {} });
}
```

Keep it inside `queuedTargets.length === 0` so scans run only at the identity-maintenance terminal.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/services/person.service.ts server/src/services/person.service.spec.ts
git commit -m "feat(server): chain space face-suggestion scans after identity maintenance"
```

### Task 7: Resolve moved space-person faces during merges and dedup

**Files:**

- Modify: `server/src/services/shared-space.service.ts`
- Modify: `server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts` or `server/test/medium/specs/services/shared-space-person-metadata-rbac.spec.ts`
- Modify: `server/src/repositories/shared-space.repository.ts` if `getFaceIdsForPerson` is added
- Modify: `server/test/medium/specs/repositories/shared-space.repository.spec.ts` if `getFaceIdsForPerson` is added

- [ ] **Step 1: Write failing medium test for manual merge**

Add a medium test that creates two space people, puts a pending suggestion row on a face that is linked to the source person, calls `mergeSpacePeople`, and asserts pending rows for the moved face are gone:

```ts
it('resolves pending suggestions for faces moved by mergeSpacePeople', async () => {
  const { sut, ctx } = setup();
  const { user } = await ctx.newUser();
  const auth = factory.auth({ user });
  const { space } = await ctx.newSharedSpace({ createdById: user.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: user.id });
  const { assetFace: targetFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const { assetFace: sourceFace } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const target = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Target', representativeFaceId: targetFace.id })
    .returningAll()
    .executeTakeFirstOrThrow();
  const source = await ctx.database
    .insertInto('shared_space_person')
    .values({ spaceId: space.id, name: 'Source', representativeFaceId: sourceFace.id })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ctx.database
    .insertInto('shared_space_person_face')
    .values([
      { personId: target.id, assetFaceId: targetFace.id },
      { personId: source.id, assetFaceId: sourceFace.id },
    ])
    .execute();
  await ctx.database
    .insertInto('person_face_suggestion')
    .values({
      spacePersonId: target.id,
      assetFaceId: sourceFace.id,
      distance: 0.7,
    })
    .execute();

  await sut.mergeSpacePeople(auth, space.id, target.id, { ids: [source.id] });

  const rows = await ctx.database
    .selectFrom('person_face_suggestion')
    .selectAll()
    .where('assetFaceId', '=', sourceFace.id)
    .where('status', '=', 'pending')
    .execute();
  expect(rows).toEqual([]);
});
```

- [ ] **Step 2: Run and verify RED**

Run the target medium spec:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts
```

Expected: FAIL because moved source-face pending rows are not resolved.

- [ ] **Step 3: Implement moved-face resolution**

In `server/src/services/shared-space.service.ts`, before each call to `reassignPersonFaces` or `reassignPersonFacesSafe`, fetch source face ids:

```ts
const movedFaceIds = await this.sharedSpaceRepository.getFaceIdsForPerson(source.id);
await this.sharedSpaceRepository.reassignPersonFaces(source.id, targetPersonId);
for (const { assetFaceId } of movedFaceIds) {
  await this.personFaceSuggestionRepository.resolveAssignedFace(assetFaceId);
}
```

If `getFaceIdsForPerson` does not exist, add it to `SharedSpaceRepository`:

First write this failing repository test:

```ts
it('getFaceIdsForPerson returns all shared-space face ids for a person', async () => {
  const { ctx, sut } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace: first } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const { assetFace: second } = await ctx.newAssetFace({ assetId: asset.id, personId: null });
  const person = await sut.createPerson({ spaceId: space.id, name: 'Alice', representativeFaceId: first.id });
  await sut.addPersonFaces([
    { personId: person.id, assetFaceId: first.id },
    { personId: person.id, assetFaceId: second.id },
  ]);

  await expect(sut.getFaceIdsForPerson(person.id)).resolves.toEqual(
    expect.arrayContaining([{ assetFaceId: first.id }, { assetFaceId: second.id }]),
  );
});
```

Then implement:

```ts
@GenerateSql({ params: [DummyValue.UUID] })
getFaceIdsForPerson(personId: string): Promise<Array<{ assetFaceId: string }>> {
  return this.db
    .selectFrom('shared_space_person_face')
    .select('assetFaceId')
    .where('personId', '=', personId)
    .execute();
}
```

Apply the same pattern in the dedup path that calls `reassignPersonFacesSafe(source.id, target.id)`.

- [ ] **Step 4: Run tests and commit**

Run:

```bash
cd server && pnpm test:medium -- --run test/medium/specs/services/shared-space-face-identity-repair.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts
make check-server
```

Expected: PASS.

Commit:

```bash
git add server/src/services/shared-space.service.ts server/src/repositories/shared-space.repository.ts server/test/medium/specs/services/shared-space-face-identity-repair.spec.ts
git commit -m "feat(server): resolve space suggestions when space people merge"
```

### Task 8: Regenerate SQL docs and run Phase 5a regression

**Files:**

- Generated: `server/src/queries/*.sql`

- [ ] **Step 1: Regenerate SQL docs**

Run:

```bash
make sql
```

Expected: SQL docs update for new `@GenerateSql` methods in `PersonFaceSuggestionRepository` and `SharedSpaceRepository`.

- [ ] **Step 2: Run focused regression**

Run:

```bash
cd server && pnpm test -- --run src/services/person.service.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/migrations/person-face-suggestion.migration.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts
cd server && pnpm test:medium -- --run test/medium/specs/repositories/shared-space.repository.spec.ts
make check-server
```

Expected: PASS.

- [ ] **Step 3: Edge-case audit**

Verify each Phase 5a edge is covered before final commit:

| Edge                                      | Covered By                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| 21 asset unshared after scan              | `getPendingForSpacePerson filters unshared stale rows at read time`                      |
| 27 pet space person                       | shared-space scannable repository test and scan-handler skip test                        |
| 29 `suggestionMaxDistance <= maxDistance` | queue-all and per-person scan skip tests                                                 |
| 30 zero linked faces / embeddings         | scan-handler zero embeddings test, mirroring personal scan test                          |
| 28 shared/personal pending cleanup        | `resolveAssignedFace deletes pending personal and space-person rows`                     |
| inherited or whitespace names             | `BTRIM(name) <> ''` scannable repository test and `person.name.trim()` scan-handler skip |
| `faceRecognitionEnabled = false`          | scannable repository test and scan-handler skip                                          |

- [ ] **Step 4: Commit generated SQL and final verification**

Commit:

```bash
git add server/src/queries server/src/repositories server/src/services server/src/schema server/test server/src/enum.ts server/src/types.ts
git commit -m "test(server): cover shared-space face suggestion scan regressions"
```

Run:

```bash
git status --short
```

Expected: clean except unrelated user changes.
