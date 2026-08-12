# Face Recognition Suggestions — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the persistence + plumbing for face-recognition suggestions — a new
`person_face_suggestion` table, a tri-state `searchFaces`, a person-embedding fetch, the
suggestion repository (conditional upsert, band read with read-gate, resolve-on-assign), and
the `suggestionMaxDistance` config — with **no generation, no API, no UI**.

**Architecture:** A new fork table + isolated repository. The "never reappear" guarantee is a
conditional `ON CONFLICT … WHERE status='pending'` upsert. No request-time vectors here (the
embedding search lives in the repository methods, called only by Phase 2 jobs later).

**Tech Stack:** NestJS, Kysely, `@immich/sql-tools` schema decorators, fork migration in
`migrations-gallery/`, Vitest medium tests (testcontainers Postgres), Zod config schemas.

**Design reference:** `docs/plans/2026-05-15-face-recognition-suggestions-design.md` (Phase 1
section). **Edge cases covered by this phase:** 3, 4, 7 (read gate), 13, 17 — plus building
blocks for 2 and 11.

**Conventions for every task:** strict TDD (write the failing test, run it, see it fail for
the expected reason, write the minimal code, run it green, commit). No `--no-verify`. Run all
commands from `/home/pierre/dev/gallery/.worktrees/face-recognition-suggestions`. Server
commands run in `server/`.

- Small/unit test: `cd server && pnpm test -- --run <file>`
- Medium test (real Postgres via testcontainers): `cd server && pnpm test:medium -- --run <file>`
- Type check: `make check-server`

There are **no** controller/DTO/OpenAPI changes in Phase 1, so do **not** run `make open-api`.
There **are** new `@GenerateSql`-decorated repository methods, so `make sql` runs once at the
end (Task 8).

---

### Task 1: Add `suggestionMaxDistance` to the config type, defaults, and Zod schema

**Files:**

- Modify: `server/src/config.ts` (type block ~73-79; defaults block ~292-298)
- Modify: `server/src/dtos/model-config.dto.ts:32-46` (`FacialRecognitionConfigSchema`)
- Create: `server/src/dtos/model-config.dto.spec.ts`

**Step 1: Write the failing test**

Create `server/src/dtos/model-config.dto.spec.ts`:

```ts
import { FacialRecognitionConfigSchema } from 'src/dtos/model-config.dto';
import { defaults } from 'src/config';
import { describe, expect, it } from 'vitest';

describe('FacialRecognitionConfigSchema suggestionMaxDistance', () => {
  const base = {
    enabled: true,
    modelName: 'buffalo_l',
    minScore: 0.7,
    maxDistance: 0.5,
    minFaces: 3,
  };

  it('accepts a valid suggestionMaxDistance', () => {
    const parsed = FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: 0.7 });
    expect(parsed.suggestionMaxDistance).toBe(0.7);
  });

  it('accepts 0 (feature disabled)', () => {
    expect(FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: 0 }).suggestionMaxDistance).toBe(0);
  });

  it('rejects a negative value', () => {
    expect(() => FacialRecognitionConfigSchema.parse({ ...base, suggestionMaxDistance: -1 })).toThrow();
  });

  it('defaults suggestionMaxDistance to 0 (disabled)', () => {
    expect(defaults.machineLearning.facialRecognition.suggestionMaxDistance).toBe(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/dtos/model-config.dto.spec.ts`
Expected: FAIL — `suggestionMaxDistance` is stripped/undefined and `defaults...suggestionMaxDistance` is `undefined`.

**Step 3: Write minimal implementation**

In `server/src/config.ts`, add to the `facialRecognition` type block (after `maxDistance: number;`):

```ts
maxDistance: number;
suggestionMaxDistance: number;
```

In `server/src/config.ts` `defaults`, in the `facialRecognition` object (after `minFaces: 3,`):

```ts
      minFaces: 3,
      suggestionMaxDistance: 0,
```

In `server/src/dtos/model-config.dto.ts`, extend `FacialRecognitionConfigSchema` (after the
`minFaces` line, before the closing `}).meta(...)`):

```ts
  minFaces: z.int().min(1).describe('Minimum number of faces required for recognition'),
  suggestionMaxDistance: z
    .number()
    .meta({ format: 'double' })
    .min(0)
    .max(2)
    .describe('Maximum distance for face suggestions; 0 disables the suggestion feature'),
}).meta({ id: 'FacialRecognitionConfig' });
```

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test -- --run src/dtos/model-config.dto.spec.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add server/src/config.ts server/src/dtos/model-config.dto.ts server/src/dtos/model-config.dto.spec.ts
git commit -m "feat(server): add facialRecognition.suggestionMaxDistance config"
```

---

### Task 2: Create the `person_face_suggestion` table, migration, and schema registration

**Files:**

- Create: `server/src/schema/tables/person-face-suggestion.table.ts`
- Create: `server/src/schema/migrations-gallery/1778800000000-AddPersonFaceSuggestion.ts`
- Modify: `server/src/schema/index.ts` (table import ~95-97; `tables = [...]` array ~143; `DB` interface ~214+)
- Create: `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`

**Step 1: Write the failing test**

Create `server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`:

```ts
import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

afterAll(async () => {
  await db.destroy();
});

describe('person_face_suggestion migration', () => {
  it('creates the table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'person_face_suggestion'
    `.execute(db);
    const cols = rows.rows.map((r) => r.column_name).sort();
    expect(cols).toEqual(
      ['assetFaceId', 'createdAt', 'distance', 'id', 'personId', 'status', 'updateId', 'updatedAt'].sort(),
    );
  });

  it('enforces the unique (personId, assetFaceId) constraint', async () => {
    const c = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_indexes
      WHERE tablename = 'person_face_suggestion'
        AND indexdef ILIKE '%UNIQUE%("personId", "assetFaceId")%'
    `.execute(db);
    expect(Number(c.rows[0].count)).toBeGreaterThan(0);
  });

  it('defines the status check constraint', async () => {
    // Assert the constraint via the catalog, NOT via an INSERT — a bare INSERT with random
    // ids would fail the personId/assetFaceId FK first and never reach the CHECK.
    const r = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM pg_constraint
      WHERE conname = 'person_face_suggestion_status_chk'
        AND contype = 'c'
    `.execute(db);
    expect(Number(r.rows[0].count)).toBe(1);
  });

  it('registered the updatedAt trigger override row', async () => {
    const r = await sql<{ count: string }>`
      SELECT COUNT(*) AS count FROM migration_overrides
      WHERE name = 'trigger_person_face_suggestion_updatedAt'
    `.execute(db);
    expect(Number(r.rows[0].count)).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`
Expected: FAIL — table `person_face_suggestion` does not exist.

**Step 3: Write minimal implementation**

Create `server/src/schema/tables/person-face-suggestion.table.ts`:

```ts
import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { PersonTable } from 'src/schema/tables/person.table';

export type PersonFaceSuggestionStatus = 'pending' | 'confirmed' | 'dismissed';

@Table('person_face_suggestion')
@UpdatedAtTrigger('person_face_suggestion_updatedAt')
@Check({
  name: 'person_face_suggestion_status_chk',
  expression: `"status" IN ('pending', 'confirmed', 'dismissed')`,
})
@Index({
  name: 'person_face_suggestion_personId_status_distance_idx',
  columns: ['personId', 'status', 'distance'],
})
@Index({ name: 'person_face_suggestion_assetFaceId_idx', columns: ['assetFaceId'] })
@Index({
  name: 'person_face_suggestion_personId_assetFaceId_uq',
  columns: ['personId', 'assetFaceId'],
  unique: true,
})
export class PersonFaceSuggestionTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', index: false })
  personId!: string;

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', index: false })
  assetFaceId!: string;

  @Column({ type: 'double precision' })
  distance!: number;

  @Column({ type: 'character varying', default: 'pending' })
  status!: Generated<PersonFaceSuggestionStatus>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
```

Create `server/src/schema/migrations-gallery/1778800000000-AddPersonFaceSuggestion.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE "person_face_suggestion" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "personId" uuid NOT NULL,
      "assetFaceId" uuid NOT NULL,
      "distance" double precision NOT NULL,
      "status" character varying NOT NULL DEFAULT 'pending',
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updatedAt" timestamp with time zone NOT NULL DEFAULT now(),
      "updateId" uuid NOT NULL DEFAULT immich_uuid_v7(),
      CONSTRAINT "person_face_suggestion_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "person_face_suggestion_status_chk" CHECK ("status" IN ('pending', 'confirmed', 'dismissed')),
      CONSTRAINT "person_face_suggestion_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person" ("id") ON DELETE CASCADE,
      CONSTRAINT "person_face_suggestion_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE
    )
  `.execute(db);

  await sql`
    CREATE UNIQUE INDEX "person_face_suggestion_personId_assetFaceId_uq"
    ON "person_face_suggestion" ("personId", "assetFaceId")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_personId_status_distance_idx"
    ON "person_face_suggestion" ("personId", "status", "distance")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_assetFaceId_idx"
    ON "person_face_suggestion" ("assetFaceId")
  `.execute(db);
  await sql`
    CREATE INDEX "person_face_suggestion_updateId_idx"
    ON "person_face_suggestion" ("updateId")
  `.execute(db);

  await sql`
    CREATE OR REPLACE TRIGGER "person_face_suggestion_updatedAt"
    BEFORE UPDATE ON "person_face_suggestion"
    FOR EACH ROW
    EXECUTE FUNCTION updated_at()
  `.execute(db);

  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('trigger_person_face_suggestion_updatedAt', '{"type":"trigger","name":"person_face_suggestion_updatedAt","sql":"CREATE OR REPLACE TRIGGER \\"person_face_suggestion_updatedAt\\"\\n  BEFORE UPDATE ON \\"person_face_suggestion\\"\\n  FOR EACH ROW\\n  EXECUTE FUNCTION updated_at();"}'::jsonb)`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM "migration_overrides"
    WHERE "name" = 'trigger_person_face_suggestion_updatedAt'
  `.execute(db);

  await sql`
    DROP TRIGGER IF EXISTS "person_face_suggestion_updatedAt"
    ON "person_face_suggestion"
  `.execute(db);

  await sql`DROP TABLE IF EXISTS "person_face_suggestion"`.execute(db);
}
```

In `server/src/schema/index.ts`:

1. Add the import alongside the other table imports (near the `PersonTable` import):

```ts
import { PersonFaceSuggestionTable } from 'src/schema/tables/person-face-suggestion.table';
```

2. Add to the `tables = [` array, immediately after `PersonAuditTable,`:

```ts
    PersonTable,
    PersonAuditTable,
    PersonFaceSuggestionTable,
```

3. Add to the `DB` interface, grouped with the other `person`-prefixed entries:

```ts
person_face_suggestion: PersonFaceSuggestionTable;
```

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/migrations/person-face-suggestion.migration.spec.ts`
Expected: PASS (4 tests). Then `make check-server` → no type errors.

**Step 5: Commit**

```bash
git add server/src/schema/tables/person-face-suggestion.table.ts server/src/schema/migrations-gallery/1778800000000-AddPersonFaceSuggestion.ts server/src/schema/index.ts server/test/medium/specs/migrations/person-face-suggestion.migration.spec.ts
git commit -m "feat(server): add person_face_suggestion table and migration"
```

---

### Task 3: Make `searchFaces` `hasPerson` tri-state

**Files:**

- Modify: `server/src/repositories/search.repository.ts:922`
- Modify: `server/test/medium/specs/repositories/search.repository.spec.ts`

**Step 1: Write the failing test**

Append to `server/test/medium/specs/repositories/search.repository.spec.ts` a `describe` (mirror
the existing setup in that file — reuse its `setup`/`ctx`/`db` helpers and its asset/face
seeding helpers; do not invent new infra):

```ts
describe('searchFaces hasPerson tri-state', () => {
  it('hasPerson:false returns only unassigned faces (personId IS NULL)', async () => {
    // Seed: one face with a personId, one face with personId=null, same owner, similar embedding.
    // (Use the file's existing asset/person/face helpers + newEmbedding from test/small.factory.)
    const result = await sut.searchFaces({
      userIds: [ownerId],
      embedding,
      numResults: 10,
      maxDistance: 2,
      hasPerson: false,
    });
    expect(result.every((r) => r.personId === null)).toBe(true);
    expect(result.map((r) => r.id)).toContain(unassignedFaceId);
    expect(result.map((r) => r.id)).not.toContain(assignedFaceId);
  });

  it('hasPerson:true still returns only assigned faces (regression)', async () => {
    const result = await sut.searchFaces({
      userIds: [ownerId],
      embedding,
      numResults: 10,
      maxDistance: 2,
      hasPerson: true,
    });
    expect(result.every((r) => r.personId !== null)).toBe(true);
  });

  it('hasPerson omitted returns both', async () => {
    const result = await sut.searchFaces({ userIds: [ownerId], embedding, numResults: 10, maxDistance: 2 });
    const ids = result.map((r) => r.id);
    expect(ids).toContain(assignedFaceId);
    expect(ids).toContain(unassignedFaceId);
  });
});
```

> If the spec file lacks reusable seeding for an assigned + unassigned face pair, add a local
> `beforeAll` that creates one asset, one person, two `asset_face` rows (one with `personId`,
> one without) + `face_search` embeddings, using the same `ctx`/repository helpers the rest of
> the file already uses.

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts`
Expected: the `hasPerson:false` test FAILS — currently `!!false` is falsy so the filter is
skipped and the assigned face is wrongly returned.

**Step 3: Write minimal implementation**

In `server/src/repositories/search.repository.ts`, replace line 922:

```ts
            .$if(!!hasPerson, (qb) => qb.where('asset_face.personId', 'is not', null))
```

with:

```ts
            .$if(hasPerson === true, (qb) => qb.where('asset_face.personId', 'is not', null))
            .$if(hasPerson === false, (qb) => qb.where('asset_face.personId', 'is', null))
```

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/search.repository.spec.ts`
Expected: PASS — all three new tests plus the pre-existing suite still green (regression).

**Step 5: Commit**

```bash
git add server/src/repositories/search.repository.ts server/test/medium/specs/repositories/search.repository.spec.ts
git commit -m "feat(server): make searchFaces hasPerson tri-state for unassigned-face search"
```

---

### Task 4: Add `personRepository.getAssignedFaceEmbeddings`

**Files:**

- Modify: `server/src/repositories/person.repository.ts` (add method inside `PersonRepository`)
- Modify: `server/test/medium/specs/repositories/person.repository.spec.ts`

**Step 1: Write the failing test**

Append to `server/test/medium/specs/repositories/person.repository.spec.ts` (reuse its
existing `setup`/`ctx`/`db`/seed helpers):

```ts
describe('getAssignedFaceEmbeddings', () => {
  it('returns embeddings only for visible, non-deleted faces of the person, capped at the limit', async () => {
    // Seed: person P with 3 visible faces (+embeddings), 1 isVisible=false face, 1 deletedAt face;
    //       another person Q with 1 face. Use the file's existing helpers + newEmbedding.
    const rows = await sut.getAssignedFaceEmbeddings(personPId, 2);
    expect(rows).toHaveLength(2); // capped
    rows.forEach((r) => expect(r.embedding).toBeTruthy());
  });

  it('returns an empty array for a person with no assigned faces', async () => {
    expect(await sut.getAssignedFaceEmbeddings(personWithNoFacesId, 20)).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts`
Expected: FAIL — `sut.getAssignedFaceEmbeddings is not a function`.

**Step 3: Write minimal implementation**

In `server/src/repositories/person.repository.ts`, add the method to the `PersonRepository`
class (place it near the other face/embedding queries; keep the `@GenerateSql` decorator
style used by sibling methods):

```ts
  @GenerateSql({ params: [DummyValue.UUID, 20] })
  getAssignedFaceEmbeddings(personId: string, limit: number) {
    return this.db
      .selectFrom('asset_face')
      .innerJoin('face_search', 'face_search.faceId', 'asset_face.id')
      .select('face_search.embedding')
      .where('asset_face.personId', '=', personId)
      .where('asset_face.deletedAt', 'is', null)
      .where('asset_face.isVisible', 'is', true)
      .limit(limit)
      .execute();
  }
```

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person.repository.spec.ts`
Expected: PASS (2 new tests; existing suite green).

**Step 5: Commit**

```bash
git add server/src/repositories/person.repository.ts server/test/medium/specs/repositories/person.repository.spec.ts
git commit -m "feat(server): add PersonRepository.getAssignedFaceEmbeddings"
```

---

### Task 5: Scaffold `PersonFaceSuggestionRepository` and wire it everywhere

**Files:**

- Create: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/src/services/base.service.ts` (import; `BASE_SERVICE_DEPENDENCIES` array ~124; constructor `protected` param ~187 — **do NOT touch the `StorageCore.create(...)` call at ~213-222**)
- Modify: `server/test/utils.ts` (`ServiceOverrides` interface ~252; automock map ~339)
- Modify: `server/test/medium.factory.ts` (import ~45; both `case` switches ~481 and ~552)
- Create: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

**Step 1: Write the failing test**

Create `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
(mirror `face-identity.repository.spec.ts` setup exactly):

```ts
import { Kysely } from 'kysely';
import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  const { ctx } = newMediumService(BaseService, {
    database: db || defaultDatabase,
    real: [PersonFaceSuggestionRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(PersonFaceSuggestionRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

describe('PersonFaceSuggestionRepository', () => {
  it('is constructible via the medium service container', () => {
    const { sut } = setup();
    expect(sut).toBeInstanceOf(PersonFaceSuggestionRepository);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — module `person-face-suggestion.repository` not found.

**Step 3: Write minimal implementation**

Create `server/src/repositories/person-face-suggestion.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';

@Injectable()
export class PersonFaceSuggestionRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}
}
```

Wire it (mirror exactly how `PersonRepository` / `FaceIdentityRepository` appear in each file):

- `server/src/services/base.service.ts`:
  - import: `import { PersonFaceSuggestionRepository } from 'src/repositories/person-face-suggestion.repository';`
  - add `PersonFaceSuggestionRepository,` to the `BASE_SERVICE_DEPENDENCIES` array (next to `PersonRepository,`)
  - add constructor param `protected personFaceSuggestionRepository: PersonFaceSuggestionRepository,` (next to `protected personRepository: PersonRepository,`)
  - **Do NOT** add it to the `StorageCore.create(assetRepository, …, personRepository, …, this.logger)` call at ~lines 213-222 — that is a fixed-signature factory call with a specific repo subset, not a generic deps list. Only the three edits above (import, `BASE_SERVICE_DEPENDENCIES`, constructor param) are needed; the new repository is reached via `this.personFaceSuggestionRepository`.
- `server/test/utils.ts`:
  - add `personFaceSuggestion: PersonFaceSuggestionRepository;` to the overrides interface (next to `person: PersonRepository;`)
  - add `personFaceSuggestion: automock(PersonFaceSuggestionRepository, { strict: false }),` (next to the `person: automock(PersonRepository, ...)` entry)
  - add the import for `PersonFaceSuggestionRepository`
- `server/test/medium.factory.ts`:
  - add the import for `PersonFaceSuggestionRepository`
  - add `case PersonFaceSuggestionRepository:` to **both** `switch` blocks (next to `case PersonRepository:` in each, ~481 and ~552)

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Then: `make check-server`
Expected: PASS (1 test); no type errors.

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/src/services/base.service.ts server/test/utils.ts server/test/medium.factory.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): scaffold PersonFaceSuggestionRepository and wiring"
```

---

### Task 6: Conditional upsert (the "never reappear" guarantee)

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

**Step 1: Write the failing test**

Add to the spec (seed a person + an unassigned `asset_face` using `ctx.get(PersonRepository)`
helpers as in the medium factory; capture `personId`, `assetFaceId`):

```ts
describe('upsertPending', () => {
  it('inserts a new pending row', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    const row = await getRow(personId, assetFaceId);
    expect(row).toMatchObject({ status: 'pending', distance: 0.6 });
  });

  it('refreshes distance for a still-pending row', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.55 }]);
    const row = await getRow(personId, assetFaceId);
    expect(row).toMatchObject({ status: 'pending', distance: 0.55 });
  });

  it('NEVER resurrects a dismissed row (headline guarantee)', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    // Phase 1 has no typed markDismissed (that is Phase 3). Set the precondition directly.
    await defaultDatabase
      .updateTable('person_face_suggestion')
      .set({ status: 'dismissed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
    const row = await getRow(personId, assetFaceId);
    expect(row.status).toBe('dismissed');
    expect(row.distance).toBe(0.6); // unchanged
  });

  it('leaves a confirmed row untouched', async () => {
    const { sut } = setup();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.6 }]);
    await defaultDatabase
      .updateTable('person_face_suggestion')
      .set({ status: 'confirmed' })
      .where('personId', '=', personId)
      .where('assetFaceId', '=', assetFaceId)
      .execute();
    await sut.upsertPending([{ personId, assetFaceId, distance: 0.4 }]);
    const row = await getRow(personId, assetFaceId);
    expect(row.status).toBe('confirmed');
    expect(row.distance).toBe(0.6);
  });
});
```

> `getRow` = small local helper doing
> `defaultDatabase.selectFrom('person_face_suggestion').selectAll().where('personId','=',personId).where('assetFaceId','=',assetFaceId).executeTakeFirstOrThrow()`.
> The dismissed/confirmed precondition is set with a direct `defaultDatabase.updateTable(...)`
> (shown above) because the typed `markDismissed`/`markConfirmed` helpers do not exist until
> Phase 3 — Phase 1 only needs upsert + read + resolve. Seed `personId` (a **named,
> non-hidden, type='person'** person) and an unassigned `assetFaceId` in a `beforeEach` using
> the medium factory helpers `mediumFactory.personFactory` / `assetFaceFactory` the way
> `face-identity.repository.spec.ts` and the medium factory's `newPerson` / `newAssetFace`
> do (one asset, one person, one `asset_face` with `personId = null` + a `face_search` row).

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — `sut.upsertPending is not a function`.

**Step 3: Write minimal implementation**

Add to `PersonFaceSuggestionRepository`:

```ts
  @GenerateSql({ params: [[{ personId: DummyValue.UUID, assetFaceId: DummyValue.UUID, distance: 0.6 }]] })
  async upsertPending(rows: Array<{ personId: string; assetFaceId: string; distance: number }>): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    await this.db
      .insertInto('person_face_suggestion')
      .values(rows.map((r) => ({ personId: r.personId, assetFaceId: r.assetFaceId, distance: r.distance })))
      .onConflict((oc) =>
        oc
          .columns(['personId', 'assetFaceId'])
          .doUpdateSet({ distance: (eb) => eb.ref('excluded.distance'), updatedAt: sql`now()` })
          .where('person_face_suggestion.status', '=', 'pending'),
      )
      .execute();
  }
```

Add imports as needed: `import { sql } from 'kysely';` and `import { DummyValue, GenerateSql } from 'src/decorators';`.

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: PASS (covers edge cases 2, 17 and the headline guarantee).

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): conditional pending upsert for face suggestions"
```

---

### Task 7: Band read with read-gate + total

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`

**Step 1: Write the failing test**

Add to the spec. Seed for a named, non-hidden, `type='person'` person P: pending rows at
`distance` 0.45 (≤ maxDistance), 0.60 and 0.70 (in band), 0.90 (> suggestionMaxDistance);
plus a `dismissed` 0.62 row; plus a pending row whose `asset_face` is now assigned/deleted.
Also seed an unnamed person U and a hidden person H and a `type='pet'` person with in-band
pending rows.

```ts
describe('getPendingForPerson (band read + read gate)', () => {
  const maxDistance = 0.5;
  const suggestionMaxDistance = 0.8;

  it('returns only pending rows strictly inside (maxDistance, suggestionMaxDistance], ordered, paginated, with total', async () => {
    const { sut } = setup();
    const res = await sut.getPendingForPerson(personPId, { maxDistance, suggestionMaxDistance, page: 1, size: 10 });
    expect(res.total).toBe(2);
    expect(res.items.map((i) => i.distance)).toEqual([0.6, 0.7]); // ascending; 0.45/0.90/dismissed/assigned excluded
  });

  it('read gate: returns empty for an unnamed / hidden / pet person even if pending rows exist', async () => {
    const { sut } = setup();
    for (const id of [unnamedPersonId, hiddenPersonId, petPersonId]) {
      const res = await sut.getPendingForPerson(id, { maxDistance, suggestionMaxDistance, page: 1, size: 10 });
      expect(res).toEqual({ total: 0, items: [] });
    }
  });

  it('read gate: returns empty when the feature is disabled (suggestionMaxDistance <= maxDistance)', async () => {
    const { sut } = setup();
    const res = await sut.getPendingForPerson(personPId, {
      maxDistance: 0.5,
      suggestionMaxDistance: 0.5,
      page: 1,
      size: 10,
    });
    expect(res).toEqual({ total: 0, items: [] });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — `sut.getPendingForPerson is not a function`.

**Step 3: Write minimal implementation**

Add to `PersonFaceSuggestionRepository`:

```ts
  @GenerateSql({
    params: [DummyValue.UUID, { maxDistance: 0.5, suggestionMaxDistance: 0.8, page: 1, size: 10 }],
  })
  async getPendingForPerson(
    personId: string,
    opts: { maxDistance: number; suggestionMaxDistance: number; page: number; size: number },
  ): Promise<{ total: number; items: Array<{ assetFaceId: string; distance: number }> }> {
    // Read gate: feature disabled, or person not currently scannable → nothing.
    if (opts.suggestionMaxDistance <= opts.maxDistance) {
      return { total: 0, items: [] };
    }
    const scannable = await this.db
      .selectFrom('person')
      .select('person.id')
      .where('person.id', '=', personId)
      .where('person.name', '!=', '')
      .where('person.isHidden', '=', false)
      .where('person.type', '=', 'person')
      .executeTakeFirst();
    if (!scannable) {
      return { total: 0, items: [] };
    }

    const base = this.db
      .selectFrom('person_face_suggestion as pfs')
      .innerJoin('asset_face as af', 'af.id', 'pfs.assetFaceId')
      .where('pfs.personId', '=', personId)
      .where('pfs.status', '=', 'pending')
      .where('pfs.distance', '>', opts.maxDistance)
      .where('pfs.distance', '<=', opts.suggestionMaxDistance)
      .where('af.personId', 'is', null)
      .where('af.deletedAt', 'is', null);

    const totalRow = await base
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();

    const items = await base
      .select(['pfs.assetFaceId as assetFaceId', 'pfs.distance as distance'])
      .orderBy('pfs.distance', 'asc')
      .limit(opts.size)
      .offset((opts.page - 1) * opts.size)
      .execute();

    return { total: Number(totalRow.total), items };
  }
```

**Step 4: Run test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: PASS (covers edge cases 3, 4, 7, 13).

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
git commit -m "feat(server): band read with scannable-person read gate"
```

---

### Task 8: Resolve-on-assign + final generated-files & checks

**Files:**

- Modify: `server/src/repositories/person-face-suggestion.repository.ts`
- Modify: `server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
- Generated: `server/src/queries/*` (via `make sql`)

**Step 1: Write the failing test**

```ts
describe('resolveAssignedFace', () => {
  it('deletes pending rows for a face across all persons but keeps resolved ones', async () => {
    const { sut } = setup();
    // Seed: faceX pending for P1 and P2; faceX dismissed for P3.
    await sut.resolveAssignedFace(faceXId);
    expect(await countRows(faceXId, 'pending')).toBe(0);
    expect(await countRows(faceXId, 'dismissed')).toBe(1); // resolved decisions preserved
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts`
Expected: FAIL — `sut.resolveAssignedFace is not a function`.

**Step 3: Write minimal implementation**

```ts
  @GenerateSql({ params: [DummyValue.UUID] })
  async resolveAssignedFace(assetFaceId: string): Promise<void> {
    await this.db
      .deleteFrom('person_face_suggestion')
      .where('assetFaceId', '=', assetFaceId)
      .where('status', '=', 'pending')
      .execute();
  }
```

**Step 4: Run test to verify it passes + regenerate SQL docs + full checks**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/person-face-suggestion.repository.spec.ts
```

Expected: PASS (covers edge case 11 building block).

Then regenerate the decorated-query SQL docs and run the gates. **`make sql` runs
`node ./dist/bin/sync-sql.js`, so it requires (a) a built server and (b) a reachable
Postgres** (it connects to `DB_URL`, default `postgres://postgres:postgres@localhost:5432/immich`).
Bring up the dev DB first if one is not already running:

```bash
make build-server                 # produces server/dist (sync-sql.js)
make dev                          # or otherwise ensure Postgres is reachable at DB_URL
make sql                          # regenerates server/src/queries/*.repository.sql
make check-server
cd server && pnpm test -- --run src/dtos/model-config.dto.spec.ts
```

Expected: `make sql` creates `server/src/queries/person-face-suggestion.repository.sql` and
updates `person.repository.sql` / `search.repository.sql` for the new/changed `@GenerateSql`
methods; `make check-server` clean; unit test green. Do **not** run `make open-api` (no API
changes). If no local Postgres is available in the execution environment, commit the code
without the regenerated SQL and note that `make sql` must be run before the PR (CI enforces
generated-file freshness — cf. memory `feedback_ci_generated_files`).

**Step 5: Commit**

```bash
git add server/src/repositories/person-face-suggestion.repository.ts server/test/medium/specs/repositories/person-face-suggestion.repository.spec.ts server/src/queries
git commit -m "feat(server): resolve pending suggestions on face assignment + sync SQL docs"
```

---

## Phase 1 exit criteria

- `person_face_suggestion` table + migration (+ `migration_overrides`) applied by the medium harness.
- `searchFaces` tri-state verified (true/false/undefined) with the existing suite still green.
- `PersonRepository.getAssignedFaceEmbeddings` returns capped, visible, non-deleted embeddings.
- `PersonFaceSuggestionRepository`: conditional upsert never resurrects resolved rows; band
  read enforces the band + scannable read-gate + feature-disabled gate; resolve-on-assign
  clears only pending rows.
- `make check-server` clean; `make sql` committed; **no** API/UI/OpenAPI changes.
- Edge cases exercised: **3, 4, 7, 13, 17 fully**; **2 and 11 as building blocks** (the
  conditional-upsert invariant and resolve-on-assign mechanism are tested here; full
  concurrency / recognition-assignment interplay is Phase 2). Matches the header.

**Not in this phase (Phase 2+):** the scan jobs, triggers, HTTP endpoints, web UI. The
repository methods exist but nothing calls them yet — that is intentional and correct for
Phase 1.
