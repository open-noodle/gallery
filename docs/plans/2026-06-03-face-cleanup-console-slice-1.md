# Face Cleanup Console — Slice 1 (scan persistence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist a face-repair scan (status + thresholds + enriched per-person report) in a new fork table
`face_repair_scan`, behind a `FaceRepairScanRepository`, so later slices' scan job can write it and the console
can read the latest.

**Architecture:** A new fork table (decorator definition + `migrations-gallery` migration + schema
registration), a thin Kysely repository with lifecycle methods (`createScan`/`updateScanProgress`/
`completeScan`/`failScan`/`getLatestScan`/`getScanById`/`pruneSupersededScans`) and an enrichment query
(`enrichReportPersons`) that joins `person` for names + representative-face thumbnails. No HTTP, no job yet
(Slice 3). Only one scan may be `pending`/`running` at a time (a DB guard in `createScan`).

**Tech Stack:** Kysely + `@immich/sql-tools` decorators, PostgreSQL `jsonb`, Vitest **medium** (real DB via
testcontainers), `test/medium.factory.ts` repository registration.

**Spec:** [`2026-06-03-face-cleanup-console-design.md`](2026-06-03-face-cleanup-console-design.md) §S-A + §Testing/Slice 1.

---

## File Structure

- Create `server/src/schema/tables/face-repair-scan.table.ts` — the table definition (one responsibility: schema).
- Modify `server/src/schema/index.ts` — register the table (import, table list, `DB` map).
- Create `server/src/schema/migrations-gallery/1780000000000-AddFaceRepairScan.ts` — create/drop the table.
- Create `server/src/repositories/face-repair-scan.repository.ts` — persistence + enrichment.
- Modify `server/src/repositories/index.ts` — export the repository.
- Modify `server/test/medium.factory.ts` — register the repository in `newRealRepository`.
- Create `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts` — medium tests.

**Shared types** (defined in the repository file, imported by later slices):

```ts
export type RepairScanStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RepairScanParams {
  maxDistance: number;
  minFaces: number;
  voteWindow: number;
  voteMargin: number;
  maxAttributionDistance: number;
  maxFlaggedFraction: number;
  largeClusterThreshold: number;
  ownerId?: string;
}

export interface RepairScanSuspectedOwner {
  ownerPersonId: string;
  ownerName: string | null;
  thumbnailFaceId: string | null;
  count: number;
}

export interface RepairScanPerson {
  personId: string;
  ownerId: string;
  personName: string | null;
  faceCount: number;
  thumbnailFaceId: string | null;
  eligible: number;
  flagged: number;
  flaggedFraction: number;
  suspectedOwners: RepairScanSuspectedOwner[];
  recommendation: 'confident' | 'review-first';
  reviewReasons: string[];
}

export interface RepairScanTotals {
  eligibleFaces: number;
  flaggedFaces: number;
  toRepair: number;
  reviewOnlyFaces: number;
  reviewOnlyPersons: number;
  affectedPersons: number;
  reviewOnlyByReason: { overCap: number; badTarget: number; unAttributable: number };
}

export interface RepairScanProgress {
  scanned: number;
  total: number;
}
```

> Note: `recommendation`/`reviewReasons` are produced by Slice 2's classifier and `totals` mirrors
> `RepairReport.totals` from `face-repair.summary.ts`. Slice 1 only stores/reads these shapes as `jsonb`; it
> does not compute them. The medium tests construct them as literals.

---

## Task 1: Define types + table + register

**Files:**

- Create: `server/src/repositories/face-repair-scan.repository.ts` (types + empty class shell — methods come in Tasks 3-6)
- Create: `server/src/schema/tables/face-repair-scan.table.ts`
- Modify: `server/src/schema/index.ts` (import near line 45, table list near line 124, `DB` map near line 244)

> **Ordering note (do this first):** `face-repair-scan.table.ts` imports the `RepairScan*` types from
> `face-repair-scan.repository.ts`, so that file must exist before the table compiles. Create the repository
> file now with **only** the shared type block (from the File Structure section above) plus an empty class:
>
> ```ts
> import { Kysely } from 'kysely';
> import { InjectKysely } from 'nestjs-kysely';
> import { DB } from 'src/schema';
>
> // ... paste the RepairScan* type block from "File Structure" here, all `export`ed ...
>
> export class FaceRepairScanRepository {
>   constructor(@InjectKysely() private db: Kysely<DB>) {}
> }
> ```
>
> `Selectable<FaceRepairScanTable>` (`RepairScanRow`) is added in Task 3 once the table is registered — leave it
> out of this shell. Tasks 3-6 add methods to this same class.

- [ ] **Step 1: Write the table definition**

`server/src/schema/tables/face-repair-scan.table.ts`:

```ts
import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import {
  RepairScanParams,
  RepairScanPerson,
  RepairScanProgress,
  RepairScanTotals,
} from 'src/repositories/face-repair-scan.repository';
import { UserTable } from 'src/schema/tables/user.table';

@Table('face_repair_scan')
export class FaceRepairScanTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'character varying', default: 'pending' })
  status!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true, index: false })
  requestedBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  params!: RepairScanParams | null;

  @Column({ type: 'jsonb', nullable: true })
  totals!: RepairScanTotals | null;

  @Column({ type: 'jsonb', default: '[]' })
  persons!: Generated<RepairScanPerson[]>;

  @Column({ type: 'jsonb', nullable: true })
  progress!: RepairScanProgress | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

- [ ] **Step 2: Register the table in `server/src/schema/index.ts`**

Add with the other imports (alphabetical-ish, near the `FaceIdentityTable` import ~line 45):

```ts
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table';
```

Add to the exported tables array (near `FaceIdentityTable,` ~line 124):

```ts
    FaceRepairScanTable,
```

Add to the `DB` interface map (near `face_identity: FaceIdentityTable;` ~line 244):

```ts
face_repair_scan: FaceRepairScanTable;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0 (no errors). The `DB` type now knows `face_repair_scan`.

- [ ] **Step 4: Commit**

```bash
git add server/src/schema/tables/face-repair-scan.table.ts server/src/schema/index.ts
git commit -m "feat(server): define face_repair_scan table"
```

---

## Task 2: Migration to create the table

**Files:**

- Create: `server/src/schema/migrations-gallery/1780000000000-AddFaceRepairScan.ts`

- [ ] **Step 1: Write the migration**

`server/src/schema/migrations-gallery/1780000000000-AddFaceRepairScan.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "face_repair_scan" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "status" character varying NOT NULL DEFAULT 'pending',
      "requestedBy" uuid,
      "params" jsonb,
      "totals" jsonb,
      "persons" jsonb NOT NULL DEFAULT '[]'::jsonb,
      "progress" jsonb,
      "error" text,
      "startedAt" timestamp with time zone,
      "finishedAt" timestamp with time zone,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "face_repair_scan_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_repair_scan_requestedBy_fkey" FOREIGN KEY ("requestedBy") REFERENCES "users" ("id") ON DELETE SET NULL
    )
  `.execute(db);

  await sql`CREATE INDEX "face_repair_scan_createdAt_idx" ON "face_repair_scan" ("createdAt")`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "face_repair_scan"`.execute(db);
}
```

> The `users` table name + `immich_uuid_v7()` default match the existing `AddFaceIdentities` migration. If
> `make sql` (next step) reports the FK references a differently-named table, copy the exact `REFERENCES` clause
> the differ emits.

- [ ] **Step 2: Run the schema diff check and reconcile**

Run: `cd server && make -C .. sql` (or `pnpm sync:sql` / `pnpm migrations:generate` per repo) and then
`pnpm sql` checks. Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run --reporter=dot 2>/dev/null || true` is NOT how to check schema — instead run the repo's SQL check:

Run: `cd .. && make sql && git diff --exit-code server/src/queries server/src/schema`
Expected: no unexpected diff. If the differ wants a `migration_overrides` row for the `createdAt` index or
anything it cannot represent, add the matching `INSERT INTO "migration_overrides" ...` line to the migration
`up` (and the deletion to `down`), mirroring `1778400000000-AddFaceIdentities.ts`. Re-run until clean.

- [ ] **Step 3: Commit**

```bash
git add server/src/schema/migrations-gallery/1780000000000-AddFaceRepairScan.ts
git commit -m "feat(server): add face_repair_scan migration"
```

---

## Task 3: Repository `createScan`/`getLatestScan` + registration (TDD)

**Files:**

- Modify: `server/src/repositories/face-repair-scan.repository.ts` (the types + empty class exist from Task 1 — add `RepairScanRow` and the methods here)
- Modify: `server/src/repositories/index.ts`
- Modify: `server/test/medium.factory.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`

> The repository file already holds the `RepairScan*` types + an empty `FaceRepairScanRepository` class (Task 1).
> Step 4 below adds `export type RepairScanRow = Selectable<FaceRepairScanTable>;` and the two methods to it; do
> not re-paste the type block.

- [ ] **Step 1: Register the repository so the medium harness can build it**

In `server/src/repositories/index.ts`, add the export (follow the existing alphabetical export list):

```ts
export { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository';
```

In `server/test/medium.factory.ts`: add the import next to `FaceRepairRepository` (~line 36):

```ts
import { FaceRepairScanRepository } from 'src/repositories/face-repair-scan.repository';
```

and add the `case` next to `FaceRepairRepository:` in `newRealRepository` (~line 479):

```ts
    case FaceRepairScanRepository:
```

(The `case` falls through to the shared `return new key(db);` block used by the other simple DB repositories.)

- [ ] **Step 2: Write the failing test**

`server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { FaceRepairScanRepository, RepairScanParams } from 'src/repositories/face-repair-scan.repository';
import { DB } from 'src/schema';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

const PARAMS: RepairScanParams = {
  maxDistance: 0.5,
  minFaces: 3,
  voteWindow: 200,
  voteMargin: 2,
  maxAttributionDistance: 0.35,
  maxFlaggedFraction: 0.5,
  largeClusterThreshold: 50,
};

describe(FaceRepairScanRepository.name, () => {
  let db: Kysely<DB>;
  let sut: FaceRepairScanRepository;

  beforeAll(async () => {
    db = await getKyselyDB();
    sut = new FaceRepairScanRepository(db);
  });

  it('creates a pending scan and returns it as the latest', async () => {
    const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
    expect(scan.status).toBe('pending');

    const latest = await sut.getLatestScan();
    expect(latest?.id).toBe(scan.id);
    expect(latest?.params).toEqual(PARAMS);
    expect(latest?.persons).toEqual([]);
  });
});
```

> Confirm the real getter helpers: this repo follows the project's medium pattern — check a sibling spec
> (`face-identity.repository.spec.ts`) for the exact `getKyselyDB`/`newMediumService` import paths and copy them
> verbatim; adjust the imports above if the sibling differs. Do NOT invent helper names.

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: FAIL — `FaceRepairScanRepository` has no `createScan`/`getLatestScan` (module/method missing).

- [ ] **Step 4: Implement the repository**

`server/src/repositories/face-repair-scan.repository.ts` (types from the File Structure section go at the top of this file):

```ts
import { Insertable, Kysely, Selectable } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB, FaceRepairScanTable } from 'src/schema';

// ... (paste the RepairScan* type block from "File Structure" here) ...

export type RepairScanRow = Selectable<FaceRepairScanTable>;

export class FaceRepairScanRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  async createScan(input: { requestedBy: string | null; params: RepairScanParams }): Promise<RepairScanRow> {
    return this.db
      .insertInto('face_repair_scan')
      .values({ status: 'pending', requestedBy: input.requestedBy, params: input.params })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  getLatestScan(): Promise<RepairScanRow | undefined> {
    return this.db.selectFrom('face_repair_scan').selectAll().orderBy('createdAt', 'desc').limit(1).executeTakeFirst();
  }

  getScanById(id: string): Promise<RepairScanRow | undefined> {
    return this.db.selectFrom('face_repair_scan').selectAll().where('id', '=', id).executeTakeFirst();
  }
}
```

> If `jsonb` insert needs an explicit cast in this codebase, use the project's JSON helper (grep for
> `sql.val`/`jsonb` in `repositories/*.ts`); plain object insert works with Kysely + `jsonb` columns in most of
> this repo, so start plain and only add a cast if the test errors on serialization.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: PASS. (If it fails with "Unable to create repository instance for key" the medium factory case in
Step 1 is missing.)

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/face-repair-scan.repository.ts server/src/repositories/index.ts server/test/medium.factory.ts server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts
git commit -m "feat(server): face_repair_scan repository create + getLatest"
```

---

## Task 4: Lifecycle transitions — `updateScanProgress`/`completeScan`/`failScan` (TDD)

**Files:**

- Modify: `server/src/repositories/face-repair-scan.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**

Append to the spec:

```ts
it('advances progress, then completes with totals + persons and finishedAt', async () => {
  const scan = await sut.createScan({ requestedBy: null, params: PARAMS });

  await sut.updateScanProgress(scan.id, { status: 'running', progress: { scanned: 10, total: 100 } });
  let row = await sut.getScanById(scan.id);
  expect(row?.status).toBe('running');
  expect(row?.progress).toEqual({ scanned: 10, total: 100 });

  const totals = {
    eligibleFaces: 5,
    flaggedFaces: 2,
    toRepair: 0,
    reviewOnlyFaces: 2,
    reviewOnlyPersons: 1,
    affectedPersons: 1,
    reviewOnlyByReason: { overCap: 2, badTarget: 0, unAttributable: 0 },
  };
  await sut.completeScan(scan.id, { totals, persons: [] });
  row = await sut.getScanById(scan.id);
  expect(row?.status).toBe('completed');
  expect(row?.totals).toEqual(totals);
  expect(row?.finishedAt).not.toBeNull();
});

it('fails a scan with an error message and finishedAt, no half-written report', async () => {
  const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
  await sut.failScan(scan.id, 'boom');
  const row = await sut.getScanById(scan.id);
  expect(row?.status).toBe('failed');
  expect(row?.error).toBe('boom');
  expect(row?.finishedAt).not.toBeNull();
  expect(row?.totals).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts -t "advances progress"`
Expected: FAIL — `updateScanProgress`/`completeScan` not defined.

- [ ] **Step 3: Implement the methods**

Add to the repository:

```ts
  async updateScanProgress(
    id: string,
    input: { status?: RepairScanStatus; progress?: RepairScanProgress; startedAt?: Date },
  ): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({
        ...(input.status ? { status: input.status } : {}),
        ...(input.progress ? { progress: input.progress } : {}),
        ...(input.startedAt ? { startedAt: input.startedAt } : {}),
      })
      .where('id', '=', id)
      .execute();
  }

  async completeScan(
    id: string,
    input: { totals: RepairScanTotals; persons: RepairScanPerson[] },
  ): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({ status: 'completed', totals: input.totals, persons: input.persons, finishedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async failScan(id: string, error: string): Promise<void> {
    await this.db
      .updateTable('face_repair_scan')
      .set({ status: 'failed', error, finishedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/face-repair-scan.repository.ts server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts
git commit -m "feat(server): face_repair_scan lifecycle transitions"
```

---

## Task 5: Concurrency guard + retention (TDD)

**Files:**

- Modify: `server/src/repositories/face-repair-scan.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('refuses a second scan while one is pending/running', async () => {
  await sut.createScan({ requestedBy: null, params: PARAMS });
  await expect(sut.createScan({ requestedBy: null, params: PARAMS })).rejects.toThrow(/scan .*in progress/i);
});

it('pruneSupersededScans keeps only the latest', async () => {
  const first = await sut.createScan({ requestedBy: null, params: PARAMS });
  await sut.completeScan(first.id, { totals: zeroTotals(), persons: [] });
  const second = await sut.createScan({ requestedBy: null, params: PARAMS });
  await sut.completeScan(second.id, { totals: zeroTotals(), persons: [] });

  await sut.pruneSupersededScans();
  expect(await sut.getScanById(first.id)).toBeUndefined();
  expect((await sut.getLatestScan())?.id).toBe(second.id);
});
```

Add this helper near the top of the spec (module scope, per `unicorn/consistent-function-scoping`):

```ts
const zeroTotals = () => ({
  eligibleFaces: 0,
  flaggedFaces: 0,
  toRepair: 0,
  reviewOnlyFaces: 0,
  reviewOnlyPersons: 0,
  affectedPersons: 0,
  reviewOnlyByReason: { overCap: 0, badTarget: 0, unAttributable: 0 },
});
```

> Because the earlier tests leave `pending`/`completed` rows, give each test its own clean state: add an
> `afterEach(() => db.deleteFrom('face_repair_scan').execute())` to the `describe` so the concurrency guard
> test starts from zero in-progress scans. (Add the import `afterEach` from vitest.)

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts -t "refuses a second"`
Expected: FAIL — second `createScan` resolves instead of throwing.

- [ ] **Step 3: Implement guard + prune**

Replace `createScan` body to guard, and add `pruneSupersededScans`:

```ts
  async createScan(input: { requestedBy: string | null; params: RepairScanParams }): Promise<RepairScanRow> {
    return this.db.transaction().execute(async (trx) => {
      const inFlight = await trx
        .selectFrom('face_repair_scan')
        .select('id')
        .where('status', 'in', ['pending', 'running'])
        .executeTakeFirst();
      if (inFlight) {
        throw new Error('A face-repair scan is already in progress');
      }
      return trx
        .insertInto('face_repair_scan')
        .values({ status: 'pending', requestedBy: input.requestedBy, params: input.params })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async pruneSupersededScans(): Promise<void> {
    const latest = await this.db
      .selectFrom('face_repair_scan')
      .select('id')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .executeTakeFirst();
    if (!latest) {
      return;
    }
    await this.db.deleteFrom('face_repair_scan').where('id', '!=', latest.id).execute();
  }
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/face-repair-scan.repository.ts server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts
git commit -m "feat(server): face_repair_scan single-flight guard + retention"
```

---

## Task 6: Enrichment query + JSONB-at-scale + null-field coverage (TDD)

**Files:**

- Modify: `server/src/repositories/face-repair-scan.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts`

Enrichment input = the raw per-person report from `buildRepairPlan` (Slice 3 supplies it): a list of
`{ personId, flagged-count info, suspectedOwnerIds }`. `enrichReportPersons` joins `person` to fill
`personName`, `ownerId`, `faceCount`, `thumbnailFaceId` (the person's `faceAssetId`), and each suspected
owner's `ownerName` + `thumbnailFaceId`.

- [ ] **Step 1: Write the failing tests**

Build two people via the medium person factory (check `face-identity.repository.spec.ts` /
`test/medium.factory.ts` for the exact `ctx.newPerson` / `getRepositoryMock` helpers and copy them), one
**named** and one **unnamed (name = null)**, plus a suspected-owner person with **no** `faceAssetId`. Then:

```ts
it('enriches persons with names + thumbnails; null name and null thumbnail survive', async () => {
  // named person `p`, owner `ownerId`; suspected owner `q` with faceAssetId = null
  const enriched = await sut.enrichReportPersons([
    { personId: p.id, eligible: 10, flagged: 8, flaggedFraction: 0.8, suspectedOwnerIds: [q.id] },
    { personId: unnamed.id, eligible: 4, flagged: 3, flaggedFraction: 0.75, suspectedOwnerIds: [] },
  ]);

  const enrichedP = enriched.find((row) => row.personId === p.id)!;
  expect(enrichedP.personName).toBe('Jula');
  expect(enrichedP.ownerId).toBe(ownerId);
  expect(enrichedP.thumbnailFaceId).toBe(p.faceAssetId);
  expect(enrichedP.suspectedOwners).toEqual([
    { ownerPersonId: q.id, ownerName: q.name ?? null, thumbnailFaceId: null, count: 8 },
  ]);

  const enrichedUnnamed = enriched.find((row) => row.personId === unnamed.id)!;
  expect(enrichedUnnamed.personName).toBeNull();
});

it('round-trips a 600+ person report through jsonb without loss', async () => {
  const persons: RepairScanPerson[] = Array.from({ length: 600 }, (_, i) => ({
    personId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    ownerId,
    personName: i % 2 === 0 ? `P${i}` : null,
    faceCount: i,
    thumbnailFaceId: null,
    eligible: i + 1,
    flagged: i,
    flaggedFraction: i / (i + 1),
    suspectedOwners: [],
    recommendation: 'confident',
    reviewReasons: [],
  }));
  const scan = await sut.createScan({ requestedBy: null, params: PARAMS });
  await sut.completeScan(scan.id, { totals: zeroTotals(), persons });
  const row = await sut.getScanById(scan.id);
  expect(row?.persons).toHaveLength(600);
  expect(row?.persons[599].personName).toBeNull();
});
```

> `recommendation`/`reviewReasons` are not computed here — `enrichReportPersons` sets `recommendation:
'confident'` and `reviewReasons: []` as placeholders that Slice 3 overwrites with the Slice 2 classifier
> output before `completeScan`. Assert only the enrichment fields in the first test.

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts -t "enriches persons"`
Expected: FAIL — `enrichReportPersons` not defined.

- [ ] **Step 3: Implement `enrichReportPersons`**

```ts
  async enrichReportPersons(
    rows: Array<{
      personId: string;
      eligible: number;
      flagged: number;
      flaggedFraction: number;
      suspectedOwnerIds: string[];
    }>,
  ): Promise<RepairScanPerson[]> {
    const personIds = [...new Set(rows.flatMap((r) => [r.personId, ...r.suspectedOwnerIds]))];
    if (personIds.length === 0) {
      return [];
    }
    const people = await this.db
      .selectFrom('person')
      .select(['id', 'ownerId', 'name', 'faceAssetId'])
      .where('id', 'in', personIds)
      .execute();
    const byId = new Map(people.map((person) => [person.id, person]));
    const nameOf = (id: string) => (byId.get(id)?.name ? byId.get(id)!.name : null);
    const thumbOf = (id: string) => byId.get(id)?.faceAssetId ?? null;

    return rows.map((row) => {
      const counts = new Map<string, number>();
      for (const ownerId of row.suspectedOwnerIds) {
        counts.set(ownerId, (counts.get(ownerId) ?? 0) + 1);
      }
      // suspectedOwnerIds is one entry per flagged face → collapse to per-owner counts; Slice 3 passes the
      // already-collapsed owner→count map, so this also accepts a single id repeated `count` times.
      return {
        personId: row.personId,
        ownerId: byId.get(row.personId)?.ownerId ?? '',
        personName: nameOf(row.personId),
        faceCount: row.eligible,
        thumbnailFaceId: thumbOf(row.personId),
        eligible: row.eligible,
        flagged: row.flagged,
        flaggedFraction: row.flaggedFraction,
        suspectedOwners: [...counts].map(([ownerPersonId, count]) => ({
          ownerPersonId,
          ownerName: nameOf(ownerPersonId),
          thumbnailFaceId: thumbOf(ownerPersonId),
          count,
        })),
        recommendation: 'confident',
        reviewReasons: [],
      };
    });
  }
```

> `person.name` is `''` for unnamed people in this codebase (not NULL). `nameOf` maps empty string → `null`
> so the UI can show "Unnamed cluster". `faceCount` is set to `eligible` here as a stand-in; Slice 3 passes the
> true person face count if it diverges from eligible — revisit only if Slice 3 needs the distinction.

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add server/src/repositories/face-repair-scan.repository.ts server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts
git commit -m "feat(server): enrich face-repair scan persons with names + thumbnails"
```

---

## Task 7: Migration reversibility + full-suite green

**Files:** none (verification only)

- [ ] **Step 1: Assert the migration is reversible**

Add to the spec (or a dedicated migration spec if the repo has one — check
`test/medium/specs/.../migration` patterns):

```ts
it('migration up creates and down drops face_repair_scan', async () => {
  // table exists (the suite ran against it); assert a round-trip of down+up via the migration module
  const migration = await import('src/schema/migrations-gallery/1780000000000-AddFaceRepairScan');
  await migration.down(db as never);
  const existsAfterDown = await db.introspection.getTables();
  expect(existsAfterDown.some((t) => t.name === 'face_repair_scan')).toBe(false);
  await migration.up(db as never);
  const existsAfterUp = await db.introspection.getTables();
  expect(existsAfterUp.some((t) => t.name === 'face_repair_scan')).toBe(true);
});
```

> Run this test **last** in the file (it mutates schema). If the medium harness shares one DB across files,
> prefer a dedicated `describe` with its own `afterAll` that re-runs `up`, so other files still find the table.
> If that coupling is fragile in this harness, drop the runtime test and instead assert reversibility by
> reading the migration source for a non-empty `down` — but prefer the runtime check.

- [ ] **Step 2: Run the whole slice's tests**

Run: `cd server && npx vitest --config test/vitest.config.medium.mjs run test/medium/specs/repositories/face-repair-scan.repository.spec.ts`
Expected: PASS (every case).

- [ ] **Step 3: Type-check, lint, schema, revert script**

Run: `cd .. && make check-server && make lint-server && make sql`
Expected: all clean. Then add `face_repair_scan` to the revert-to-immich cleanup
(`scripts/revert-to-immich/`) per `feedback_rebase_revert_script_update` — grep that script for
`face_identity` and add a sibling `DROP TABLE IF EXISTS "face_repair_scan"` step.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(server): face_repair_scan migration reversibility + revert-script cleanup"
```

---

## Self-Review

- **Spec coverage (Slice 1 list):** create→getLatest (T3) ✓; transitions + finishedAt/error (T4) ✓;
  enrichment + null name/thumbnail (T6) ✓; clean-instance empty report — covered by `persons: []` default +
  enrich-empty (T3/T6) ✓; JSONB 600+ round-trip (T6) ✓; retention/prune + concurrency guard (T5) ✓; migration
  reversibility (T7) ✓; medium.factory registration (T3 Step 1) ✓.
- **Placeholders:** none — every step has concrete code/commands. The two soft spots (exact medium helper
  import names; whether `make sql` wants `migration_overrides` rows) are explicitly flagged with how to
  resolve against the real tooling, not left as "TODO".
- **Type consistency:** `RepairScan*` types defined once (File Structure / repository top) and reused; method
  names (`createScan`, `updateScanProgress`, `completeScan`, `failScan`, `getLatestScan`, `getScanById`,
  `pruneSupersededScans`, `enrichReportPersons`) are stable across tasks and match §S-A.
- **Carry-forward to Slice 3:** the scan job calls `createScan` → `updateScanProgress(running)` →
  `enrichReportPersons` (then overwrite `recommendation`/`reviewReasons` from Slice 2) → `completeScan` /
  `failScan`, then `pruneSupersededScans`.
