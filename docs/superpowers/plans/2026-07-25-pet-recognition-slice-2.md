# Slice 2 — Server: `pet_search` table, migration, vector plumbing

- **Spec:** [`../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md`](../specs/2026-07-25-pet-recognition-phase2-implementation-slices.md) § Slice 2
- **Scope:** `server/` schema only. Do not touch `machine-learning/`, `web/`, or any service.

## Objective

Create the `pet_search` table (512-d embeddings, one row per pet `asset_face`) with a cosine vector
index, registered so both Kysely and sql-tools know about it.

## Context you need

- `server/src/schema/tables/face-search.table.ts` is the exact structural template.
- Registration is **two places** in `server/src/schema/index.ts`: the `ImmichDatabase.tables` array
  (sql-tools scans it) **and** the `DB` interface (Kysely types). Missing either breaks silently in
  a different way — tables array missing ⇒ schema drift specs fail; DB interface missing ⇒ queries
  do not typecheck.
- Index DDL must come from `vectorIndexQuery()` (`server/src/utils/database.ts:912-935`), which
  branches on VectorChord vs pgvector. Do **not** hardcode `USING hnsw` in the migration — Gallery
  runs on vchordrq in production.
- Fork migrations go in `server/src/schema/migrations-gallery/` with a round timestamp. Use
  `1785000000000-CreatePetSearchTable.ts`. Confirm no existing file uses that timestamp.
- Look at `server/src/schema/migrations/1744910873969-InitialMigration.ts:486` for how `face_search`
  is created + indexed in a migration, including how it obtains `vectorExtension`.

## TDD steps

### Step 1 — RED: medium tests

Create `server/test/medium/specs/repositories/pet-search.repository.spec.ts`, modelled on
`server/test/medium/specs/repositories/face-identity.repository.spec.ts` (imports, `newMediumService`,
`getKyselyDB`, `newEmbedding`).

Tests (spec 2.1–2.3):

1. inserting an `asset_face` and then `pet_search` `{ faceId, embedding: newEmbedding() }` round-trips
2. deleting the `asset_face` cascades the `pet_search` row away (assert count 0)
3. `pet_index` exists: `SELECT indexname FROM pg_indexes WHERE tablename = 'pet_search'` contains it

Run:

```bash
cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/pet-search.repository.spec.ts
```

Expected red: `relation "pet_search" does not exist`.

Also add a unit assertion (spec 2.4) somewhere appropriate — e.g. extend an existing constants or
database repository spec — that `VECTOR_INDEX_TABLES[VectorIndex.Pet] === 'pet_search'` and
`probes[VectorIndex.Pet]` is a number. Expected red: `VectorIndex.Pet` does not exist (TS error).

### Step 2 — GREEN: implement

1. `server/src/schema/tables/pet-search.table.ts` — copy `face-search.table.ts`, rename table to
   `pet_search` and index to `pet_index`.
2. `server/src/schema/index.ts` — import it, add `PetSearchTable` to the `tables` array, add
   `pet_search: PetSearchTable;` to the `DB` interface.
3. `server/src/enum.ts` — `VectorIndex.Pet = 'pet_index'`.
4. `server/src/constants.ts` — `[VectorIndex.Pet]: 'pet_search'` in `VECTOR_INDEX_TABLES`.
5. `server/src/repositories/database.repository.ts` — `[VectorIndex.Pet]: 1` in `probes`.
6. `server/src/schema/migrations-gallery/1785000000000-CreatePetSearchTable.ts`:
   ```ts
   export async function up(db: Kysely<any>): Promise<void> {
     await sql`CREATE TABLE "pet_search" (
       "faceId" uuid NOT NULL,
       "embedding" vector(512) NOT NULL,
       CONSTRAINT "pet_search_pkey" PRIMARY KEY ("faceId"),
       CONSTRAINT "pet_search_faceId_fkey" FOREIGN KEY ("faceId") REFERENCES "asset_face" ("id") ON UPDATE CASCADE ON DELETE CASCADE
     )`.execute(db);
     // vectorIndexQuery() picks vchordrq vs hnsw from the installed extension
     await sql.raw(vectorIndexQuery({ vectorExtension, table: 'pet_search', indexName: 'pet_index' })).execute(db);
   }
   export async function down(db: Kysely<any>): Promise<void> {
     await sql`DROP INDEX IF EXISTS "pet_index"`.execute(db);
     await sql`DROP TABLE "pet_search"`.execute(db);
   }
   ```
   Obtain `vectorExtension` exactly the way the initial migration does — read that file and copy the
   mechanism rather than inventing one.

### Step 3 — verify

```bash
cd server
pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/pet-search.repository.spec.ts
pnpm test -- --run src/schema        # schema drift / override parity specs
pnpm check                           # tsc
```

The schema-drift specs (`migration-override-parity.spec.ts`, `trigger-override-parity.spec.ts`) are
the ones that catch a table declared in code but not in a migration — the fork has had drift
regressions before, so they must be green, not skipped.

## Edge cases

- The FK must be `ON DELETE CASCADE` — a pet face deletion must not orphan an embedding.
- `embedding` is `vector(512)` and `synchronize: false` on the column decorator (matching
  `face-search.table.ts`), otherwise sql-tools tries to manage the vector type itself.
- Migration must be idempotent-safe on a fresh DB **and** on an existing one — use
  `CREATE INDEX IF NOT EXISTS` semantics via `vectorIndexQuery` (it already does).

## Done criteria

- Medium tests green against a real DB; schema specs green; tsc clean.
- Nothing outside `server/src/schema/`, `server/src/enum.ts`, `server/src/constants.ts`,
  `server/src/repositories/database.repository.ts`, and the new test file is modified.

## Commit

`feat(pet-recognition): pet_search table + vector index`
