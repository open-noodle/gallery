# Face Cleanup Console — persistent decline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Let a Face Cleanup admin persistently **decline** a flagged face or **dismiss** a flagged person so the
console stops surfacing it on future scans, until the suspected owner (the evidence) changes.

**Architecture:** A new fork table `face_repair_decline` (two row kinds: face / person) behind a
`FaceRepairDeclineRepository`. A pure filter (`applyDeclineFilters` in `src/utils/face-repair.ts`) runs inside
`FaceRepairService.buildRepairPlan` — the single chokepoint used by the dashboard scan, the per-person review
list, and apply — so a declined face is never shown and never moved. Three admin endpoints create / list / remove
declines. Web: a distinct per-face **Decline** action (alongside the existing transient exclude), a per-person
**Dismiss** action, and a `/admin/face-cleanup/declined` management+undo route.

**Tech Stack:** NestJS 11 + Kysely + `@immich/sql-tools` decorators, PostgreSQL `jsonb`, `nestjs-zod` DTOs,
Vitest (unit + medium via testcontainers), SvelteKit/Svelte 5 runes, `@immich/sdk` (oazapfts), Playwright e2e.

**Spec:** [`2026-06-05-face-cleanup-decline-design.md`](2026-06-05-face-cleanup-decline-design.md).

---

## File Structure

**Slice 1 — storage**

- Create `server/src/schema/tables/face-repair-decline.table.ts` — table definition (schema only).
- Modify `server/src/schema/index.ts` — register the table (import, table list, `DB` map).
- Create `server/src/schema/migrations-gallery/1781000000000-AddFaceRepairDecline.ts` — create/drop DDL.
- Create `server/src/repositories/face-repair-decline.repository.ts` — persistence + map loading.
- Modify `server/src/repositories/index.ts` — export the repository.
- Modify `server/src/services/base.service.ts` — import, provider array, constructor param.
- Modify `server/test/utils.ts` — `ServiceOverrides` type, `getMocks` map, `newTestService` positional arg.
- Modify `server/test/medium.factory.ts` — `newRealRepository` switch case.
- Modify `scripts/revert-to-immich.sql` — drop the fork table.
- Create `server/test/medium/specs/repositories/face-repair-decline.repository.spec.ts` — repo CRUD + cascade.

**Slice 2 — filter**

- Modify `server/src/utils/face-repair.ts` — `DeclineMaps` type, `isSubset`, `applyDeclineFilters` (pure).
- Modify `server/src/utils/face-repair.spec.ts` — unit tests for the pure filter.
- Modify `server/src/services/face-repair.service.ts` — load maps + call the filter in `buildRepairPlan`.
- Modify `server/test/medium/specs/services/face-repair.service.spec.ts` — scan/review/apply honor declines.

**Slice 3 — API**

- Modify `server/src/dtos/face-repair.dto.ts` — request/response DTOs.
- Modify `server/src/services/face-repair.service.ts` — `createDeclines` / `listDeclines` / `removeDeclines`.
- Modify `server/src/controllers/face-repair-admin.controller.ts` — three endpoints.
- Modify `server/src/controllers/face-repair-admin.controller.spec.ts` — endpoint auth + delegation.
- Regenerate `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/`, `mobile/openapi/`.

**Slice 4 — web**

- Modify `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts` + `+page.svelte` — Decline action.
- Modify `web/src/routes/admin/face-cleanup/[personId]/review.spec.ts` — model stays correct.
- Modify `web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte` + `+page.svelte` — Dismiss action.
- Create `web/src/routes/admin/face-cleanup/declined/+page.ts` + `+page.svelte` — management/undo.
- Modify `web/src/lib/route.ts` — `faceCleanupDeclined` entry.
- Modify `i18n/en.json` — new keys.

**Slice 5 — e2e**

- Modify `e2e/src/specs/web/face-cleanup.e2e-spec.ts` — decline → re-scan gone; change evidence → reappears.

---

## Slice 1 — Decline storage

**Goal:** A `face_repair_decline` table and a `FaceRepairDeclineRepository` that can create declines, load them as
two lookup maps, list them enriched, and remove them by id — fully wired into DI and both test factories.

### Task 1.1: Table definition

**Files:**

- Create: `server/src/schema/tables/face-repair-decline.table.ts`

- [ ] **Step 1: Write the table** (model on `face-repair-scan.table.ts`; `@Index` supports a partial-unique
      index, exactly like `person.table.ts:34`).

```ts
import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { PersonTable } from 'src/schema/tables/person.table';
import { UserTable } from 'src/schema/tables/user.table';

// A persisted admin "leave it" decision for the Face Cleanup console. `type='face'` rows mute a single flagged
// face while it is still suspected toward `suspectedOwnerId`; `type='person'` rows mute a whole cluster while its
// suspected-owner set stays within `suspectedOwnerIds`. Console-only — never touches identity or recognition.
@Table('face_repair_decline')
@Index({
  name: 'face_repair_decline_face_owner_uq',
  columns: ['assetFaceId', 'suspectedOwnerId'],
  unique: true,
  where: '"assetFaceId" IS NOT NULL',
})
export class FaceRepairDeclineTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'character varying' })
  type!: 'face' | 'person';

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', nullable: true, index: true })
  assetFaceId!: string | null;

  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', nullable: true, index: false })
  suspectedOwnerId!: string | null;

  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', nullable: true, index: true })
  personId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  suspectedOwnerIds!: string[] | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true, index: false })
  declinedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
```

> If the `AssetFaceTable` class is exported under a different path/name, confirm with
> `grep -rn "class AssetFaceTable" server/src/schema/tables` and fix the import — `tsc` will flag it.

- [ ] **Step 2: Register in the schema.** In `server/src/schema/index.ts`: add the import next to
      `FaceRepairScanTable` (~line 46), add `FaceRepairDeclineTable,` to the table array (~line 127), and add
      `face_repair_decline: FaceRepairDeclineTable;` to the `DB` map (~line 248).

```ts
import { FaceRepairDeclineTable } from 'src/schema/tables/face-repair-decline.table';
```

- [ ] **Step 3: Type-check.**

Run: `cd server && pnpm check`
Expected: PASS (no unused-import / missing-type errors).

- [ ] **Step 4: Commit.**

```bash
git add server/src/schema/tables/face-repair-decline.table.ts server/src/schema/index.ts
git commit -m "feat(face-repair): add face_repair_decline table definition"
```

### Task 1.2: Migration

**Files:**

- Create: `server/src/schema/migrations-gallery/1781000000000-AddFaceRepairDecline.ts`

- [ ] **Step 1: Write the migration** (authoritative DDL; partial-unique index matches the decorator).

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE TABLE "face_repair_decline" (
      "id" uuid NOT NULL DEFAULT immich_uuid_v7(),
      "type" character varying NOT NULL,
      "assetFaceId" uuid,
      "suspectedOwnerId" uuid,
      "personId" uuid,
      "suspectedOwnerIds" jsonb,
      "declinedBy" uuid,
      "createdAt" timestamp with time zone NOT NULL DEFAULT now(),
      CONSTRAINT "face_repair_decline_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "face_repair_decline_assetFaceId_fkey" FOREIGN KEY ("assetFaceId") REFERENCES "asset_face" ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_suspectedOwnerId_fkey" FOREIGN KEY ("suspectedOwnerId") REFERENCES "person" ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_personId_fkey" FOREIGN KEY ("personId") REFERENCES "person" ("id") ON DELETE CASCADE,
      CONSTRAINT "face_repair_decline_declinedBy_fkey" FOREIGN KEY ("declinedBy") REFERENCES "user" ("id") ON DELETE SET NULL
    )
  `.execute(db);
  await sql`CREATE INDEX "face_repair_decline_assetFaceId_idx" ON "face_repair_decline" ("assetFaceId")`.execute(db);
  await sql`CREATE INDEX "face_repair_decline_personId_idx" ON "face_repair_decline" ("personId")`.execute(db);
  await sql`
    CREATE UNIQUE INDEX "face_repair_decline_face_owner_uq"
    ON "face_repair_decline" ("assetFaceId", "suspectedOwnerId")
    WHERE "assetFaceId" IS NOT NULL
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP TABLE IF EXISTS "face_repair_decline"`.execute(db);
}
```

- [ ] **Step 2: Verify the decorator schema matches the migration.**

Run: `cd server && pnpm sync:sql` (then `git diff --stat`)
Expected: no unexpected schema drift reported for `face_repair_decline`; if the SQL-schema check reports a
missing/renamed index, align the migration index names with what the decorator emits and re-run. Commit any
generated `.sql` doc updates with the migration.

- [ ] **Step 3: Commit.**

```bash
git add server/src/schema/migrations-gallery/1781000000000-AddFaceRepairDecline.ts
git commit -m "feat(face-repair): migration for face_repair_decline"
```

### Task 1.3: Repository (with medium test first)

**Files:**

- Create: `server/src/repositories/face-repair-decline.repository.ts`
- Test: `server/test/medium/specs/repositories/face-repair-decline.repository.spec.ts`

- [ ] **Step 1: Add the repository skeleton + shared types.** `DeclineMaps` lives in `src/utils/face-repair.ts`
      (Slice 2 fills in the filter; define the type here in Slice 1 so the repo can return it).

In `server/src/utils/face-repair.ts`, add near the top (exported):

```ts
export interface DeclineMaps {
  declinedFaceOwners: Map<string, Set<string>>; // assetFaceId -> Set<suspectedOwnerId>
  dismissedPersons: Map<string, Set<string>>; // personId -> Set<suspectedOwnerId>
}
```

Create `server/src/repositories/face-repair-decline.repository.ts`:

```ts
import { Insertable, Kysely } from 'kysely';
import { InjectKysely } from 'nestjs-kysely';
import { DB } from 'src/schema';
import { FaceRepairDeclineTable } from 'src/schema/tables/face-repair-decline.table';
import { DeclineMaps } from 'src/utils/face-repair';

export interface FaceDeclineInput {
  assetFaceId: string;
  suspectedOwnerId: string;
}
export interface PersonDeclineInput {
  personId: string;
  suspectedOwnerIds: string[];
}

export interface DeclineListRow {
  id: string;
  type: 'face' | 'person';
  assetFaceId: string | null;
  suspectedOwnerId: string | null;
  personId: string | null;
  suspectedOwnerIds: string[] | null;
  declinedBy: string | null;
  createdAt: Date;
}

export class FaceRepairDeclineRepository {
  constructor(@InjectKysely() private db: Kysely<DB>) {}

  // Insert face and/or person declines. Face rows are idempotent on the (assetFaceId, suspectedOwnerId) partial
  // unique index — re-declining the same face/owner is a no-op. Returns the number of rows actually inserted.
  async createDeclines(input: {
    faces?: FaceDeclineInput[];
    persons?: PersonDeclineInput[];
    declinedBy: string | null;
  }): Promise<number> {
    const rows: Insertable<FaceRepairDeclineTable>[] = [
      ...(input.faces ?? []).map((f) => ({
        type: 'face' as const,
        assetFaceId: f.assetFaceId,
        suspectedOwnerId: f.suspectedOwnerId,
        personId: null,
        suspectedOwnerIds: null,
        declinedBy: input.declinedBy,
      })),
      ...(input.persons ?? []).map((p) => ({
        type: 'person' as const,
        assetFaceId: null,
        suspectedOwnerId: null,
        personId: p.personId,
        suspectedOwnerIds: p.suspectedOwnerIds as unknown as Insertable<FaceRepairDeclineTable>['suspectedOwnerIds'],
        declinedBy: input.declinedBy,
      })),
    ];
    if (rows.length === 0) {
      return 0;
    }
    const inserted = await this.db
      .insertInto('face_repair_decline')
      .values(rows)
      .onConflict((oc) => oc.constraint('face_repair_decline_face_owner_uq').doNothing())
      .returning('id')
      .execute();
    return inserted.length;
  }

  // Load every decline into the two lookup maps the planner consults. The decline set is admin-curated and
  // bounded, so loading all rows is cheap relative to the face scan.
  async getDeclineMaps(): Promise<DeclineMaps> {
    const rows = await this.db
      .selectFrom('face_repair_decline')
      .select(['type', 'assetFaceId', 'suspectedOwnerId', 'personId', 'suspectedOwnerIds'])
      .execute();
    const declinedFaceOwners = new Map<string, Set<string>>();
    const dismissedPersons = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.type === 'face' && row.assetFaceId && row.suspectedOwnerId) {
        const set = declinedFaceOwners.get(row.assetFaceId) ?? new Set<string>();
        set.add(row.suspectedOwnerId);
        declinedFaceOwners.set(row.assetFaceId, set);
      } else if (row.type === 'person' && row.personId) {
        dismissedPersons.set(row.personId, new Set((row.suspectedOwnerIds as unknown as string[]) ?? []));
      }
    }
    return { declinedFaceOwners, dismissedPersons };
  }

  listDeclines(): Promise<DeclineListRow[]> {
    return this.db
      .selectFrom('face_repair_decline')
      .select([
        'id',
        'type',
        'assetFaceId',
        'suspectedOwnerId',
        'personId',
        'suspectedOwnerIds',
        'declinedBy',
        'createdAt',
      ])
      .orderBy('createdAt', 'desc')
      .execute() as unknown as Promise<DeclineListRow[]>;
  }

  async removeDeclines(ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const rows = await this.db.deleteFrom('face_repair_decline').where('id', 'in', ids).returning('id').execute();
    return rows.length;
  }
}
```

> `onConflict(...constraint('face_repair_decline_face_owner_uq'))` targets the partial unique index. If the
> SQL-schema check named it differently in Task 1.2 Step 2, use that exact name here.

- [ ] **Step 2: Wire the repository into DI and both test factories.** (All five edits are required — a repo
      added to the `BaseService` constructor but missing from the `newTestService` positional list at
      `server/test/utils.ts:384` silently shifts every later repo, the PR #652-class footgun.)
  1. `server/src/repositories/index.ts`: import next to `FaceRepairScanRepository` (~line 22) and add
     `FaceRepairDeclineRepository,` to the exported array (~line 83).
  2. `server/src/services/base.service.ts`: import next to `FaceRepairScanRepository` (~line 34), add
     `FaceRepairDeclineRepository,` to the provider array (~line 116), and add a constructor parameter
     **immediately after** `faceRepairScanRepository` (~line 182):

```ts
protected faceRepairDeclineRepository: FaceRepairDeclineRepository,
```

3. `server/test/utils.ts`: add `faceRepairDecline: FaceRepairDeclineRepository;` to `ServiceOverrides`
   immediately after `faceRepairScan` (~line 242); add
   `faceRepairDecline: automock(FaceRepairDeclineRepository, { strict: false }),` to the `mocks` object
   immediately after `faceRepairScan` (~line 331); and add the positional arg to `new Service(...)`
   **immediately after** the `faceRepairScan` line (~line 406):

```ts
overrides.faceRepairDecline || (mocks.faceRepairDecline as As<FaceRepairDeclineRepository>),
```

     Add the import for `FaceRepairDeclineRepository` at the top of `utils.ts` next to the other repo imports.

4. `server/test/medium.factory.ts`: import next to `FaceRepairScanRepository` (~line 37) and add the switch
case next to `FaceRepairScanRepository` (~line 481):

```ts
    case FaceRepairDeclineRepository:
```

- [ ] **Step 3: Write the failing medium test.**

```ts
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

// NOTE: follow the existing face-repair repository medium spec for the exact harness/import helpers
// (server/test/medium/specs/repositories/face-repair-scan.repository.spec.ts) — fixture user/person/asset_face
// creation and `getRepository` wiring differ slightly across the medium suite.
describe(FaceRepairDeclineRepository.name, () => {
  let sut: FaceRepairDeclineRepository;
  let db: Awaited<ReturnType<typeof getKyselyDB>>;

  beforeAll(async () => {
    db = await getKyselyDB();
    sut = new FaceRepairDeclineRepository(db);
  });

  it('creates face + person declines and loads them into maps', async () => {
    // Arrange: create an owner user, a person P, a suspected owner Q, and a visible ML asset_face F on P.
    // (Reuse the fixture helpers from face-repair-scan.repository.spec.ts.)
    const { faceId, personP, personQ, declinedBy } = await seedFaceAndPersons(db);

    await sut.createDeclines({ faces: [{ assetFaceId: faceId, suspectedOwnerId: personQ }], declinedBy });
    await sut.createDeclines({ persons: [{ personId: personP, suspectedOwnerIds: [personQ] }], declinedBy });

    const maps = await sut.getDeclineMaps();
    expect(maps.declinedFaceOwners.get(faceId)).toEqual(new Set([personQ]));
    expect(maps.dismissedPersons.get(personP)).toEqual(new Set([personQ]));
  });

  it('is idempotent on (assetFaceId, suspectedOwnerId)', async () => {
    const { faceId, personQ, declinedBy } = await seedFaceAndPersons(db);
    const first = await sut.createDeclines({ faces: [{ assetFaceId: faceId, suspectedOwnerId: personQ }], declinedBy });
    const second = await sut.createDeclines({
      faces: [{ assetFaceId: faceId, suspectedOwnerId: personQ }],
      declinedBy,
    });
    expect(first).toBe(1);
    expect(second).toBe(0);
  });

  it('cascades: deleting the face removes its decline rows', async () => {
    const { faceId, personQ, declinedBy } = await seedFaceAndPersons(db);
    await sut.createDeclines({ faces: [{ assetFaceId: faceId, suspectedOwnerId: personQ }], declinedBy });
    await db.deleteFrom('asset_face').where('id', '=', faceId).execute();
    const maps = await sut.getDeclineMaps();
    expect(maps.declinedFaceOwners.has(faceId)).toBe(false);
  });

  it('lists and removes declines by id', async () => {
    const { personP, personQ, declinedBy } = await seedFaceAndPersons(db);
    await sut.createDeclines({ persons: [{ personId: personP, suspectedOwnerIds: [personQ] }], declinedBy });
    const list = await sut.listDeclines();
    const target = list.find((d) => d.personId === personP)!;
    expect(target.type).toBe('person');
    const removed = await sut.removeDeclines([target.id]);
    expect(removed).toBe(1);
  });
});
```

> Write a local `seedFaceAndPersons(db)` helper that inserts a `user`, two `person` rows (P, Q), an `asset` and a
> visible ML `asset_face` on P, returning their ids — copy the insertion shape from
> `face-repair-scan.repository.spec.ts` / `face-repair.repository.spec.ts` in the same folder.

- [ ] **Step 4: Run the test — verify it fails** (repo/table not yet migrated in the test DB), then implement
      until green.

Run: `cd server && pnpm test:medium -- --run test/medium/specs/repositories/face-repair-decline.repository.spec.ts`
Expected first run: FAIL. After the table migration applies in the test DB and the repo compiles: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/src/repositories/face-repair-decline.repository.ts server/src/repositories/index.ts \
  server/src/services/base.service.ts server/src/utils/face-repair.ts server/test/utils.ts \
  server/test/medium.factory.ts server/test/medium/specs/repositories/face-repair-decline.repository.spec.ts
git commit -m "feat(face-repair): FaceRepairDeclineRepository with CRUD + map loading"
```

### Task 1.4: revert-to-immich drop

**Files:**

- Modify: `scripts/revert-to-immich.sql`

- [ ] **Step 1:** Add a drop for the fork table alongside the other fork-table drops (search the file for
      `face_repair_scan` and add next to it):

```sql
DROP TABLE IF EXISTS "face_repair_decline" CASCADE;
```

- [ ] **Step 2: Commit.**

```bash
git add scripts/revert-to-immich.sql
git commit -m "chore(face-repair): drop face_repair_decline in revert-to-immich"
```

---

## Slice 2 — The decline filter in `buildRepairPlan`

**Goal:** A pure, unit-tested filter that drops declined faces (face-level) and dismissed clusters (person-level)
from the flagged set, wired into `buildRepairPlan` so the scan, the review list, and apply all honor it.

### Task 2.1: Pure filter (TDD)

**Files:**

- Modify: `server/src/utils/face-repair.ts`
- Test: `server/src/utils/face-repair.spec.ts`

- [ ] **Step 1: Write the failing unit tests.** Append to `face-repair.spec.ts`:

```ts
import { applyDeclineFilters, isSubset } from 'src/utils/face-repair';

const f = (assetFaceId: string, currentPersonId: string, suspectedOwnerId: string) => ({
  assetFaceId,
  currentPersonId,
  suspectedOwnerId,
});

describe('isSubset', () => {
  it('true when every element is present', () => {
    expect(isSubset(new Set(['a']), new Set(['a', 'b']))).toBe(true);
  });
  it('false when an element is missing', () => {
    expect(isSubset(new Set(['a', 'c']), new Set(['a', 'b']))).toBe(false);
  });
});

describe('applyDeclineFilters', () => {
  it('drops a face declined toward its current suspected owner', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'Q')]]]);
    applyDeclineFilters(flagged, {
      declinedFaceOwners: new Map([['face1', new Set(['Q'])]]),
      dismissedPersons: new Map(),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face2']);
  });

  it('keeps a declined face if a DIFFERENT owner is now suspected (evidence changed)', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'R')]]]);
    applyDeclineFilters(flagged, {
      declinedFaceOwners: new Map([['face1', new Set(['Q'])]]),
      dismissedPersons: new Map(),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face1']);
  });

  it('drops a whole dismissed person when its suspected set is a subset of the fingerprint', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'Q')]]]);
    applyDeclineFilters(flagged, {
      declinedFaceOwners: new Map(),
      dismissedPersons: new Map([['P', new Set(['Q', 'R'])]]),
    });
    expect(flagged.get('P')).toEqual([]);
  });

  it('re-surfaces a dismissed person when a NEW suspected owner appears', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'S')]]]);
    applyDeclineFilters(flagged, {
      declinedFaceOwners: new Map(),
      dismissedPersons: new Map([['P', new Set(['Q'])]]),
    });
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face1', 'face2']);
  });

  it('applies face-level before person-level (a re-flagged new-owner face keeps the person)', () => {
    const flagged = new Map([['P', [f('face1', 'P', 'Q'), f('face2', 'P', 'S')]]]);
    applyDeclineFilters(flagged, {
      declinedFaceOwners: new Map([['face1', new Set(['Q'])]]),
      dismissedPersons: new Map([['P', new Set(['Q'])]]),
    });
    // face1 dropped (declined); face2 toward NEW owner S keeps the person on the board
    expect(flagged.get('P')!.map((x) => x.assetFaceId)).toEqual(['face2']);
  });
});
```

- [ ] **Step 2: Run — verify it fails.**

Run: `cd server && pnpm test -- --run src/utils/face-repair.spec.ts`
Expected: FAIL ("applyDeclineFilters is not a function").

- [ ] **Step 3: Implement the pure functions** in `src/utils/face-repair.ts` (the `DeclineMaps` type is already
      there from Slice 1):

```ts
export function isSubset(subset: Set<string>, superset: Set<string>): boolean {
  for (const value of subset) {
    if (!superset.has(value)) {
      return false;
    }
  }
  return true;
}

interface FlaggedLike {
  assetFaceId: string;
  currentPersonId: string;
  suspectedOwnerId: string;
}

// Mutates flaggedByPerson in place. (1) face-level: drop any face declined toward its current suspected owner.
// (2) person-level: if the person was dismissed and its REMAINING suspected-owner set is a subset of the stored
// fingerprint (no new evidence), drop the whole person. Face-level runs first so a face re-flagged toward a new
// owner keeps its person surfaced.
export function applyDeclineFilters<T extends FlaggedLike>(flaggedByPerson: Map<string, T[]>, maps: DeclineMaps): void {
  for (const [personId, faces] of flaggedByPerson) {
    const kept = faces.filter((face) => !maps.declinedFaceOwners.get(face.assetFaceId)?.has(face.suspectedOwnerId));
    const fingerprint = maps.dismissedPersons.get(personId);
    if (fingerprint && kept.length > 0) {
      const currentOwners = new Set(kept.map((face) => face.suspectedOwnerId));
      if (isSubset(currentOwners, fingerprint)) {
        flaggedByPerson.set(personId, []);
        continue;
      }
    }
    flaggedByPerson.set(personId, kept);
  }
}
```

- [ ] **Step 4: Run — verify it passes.**

Run: `cd server && pnpm test -- --run src/utils/face-repair.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add server/src/utils/face-repair.ts server/src/utils/face-repair.spec.ts
git commit -m "feat(face-repair): pure decline filter (face + person level)"
```

### Task 2.2: Call the filter inside `buildRepairPlan`

**Files:**

- Modify: `server/src/services/face-repair.service.ts`

- [ ] **Step 1: Import the filter.** Add `applyDeclineFilters` to the existing import from
      `src/utils/face-repair` (joins `classifyFlaggedPerson, decideReattribution, tallyReattribution`).

- [ ] **Step 2: Load the maps and apply the filter.** In `buildRepairPlan`, immediately **after** the
      `for await (... findReattributionCandidates ...)` streaming loop closes (current line ~111) and **before**
      the `reviewOnlyPersonIds` computation (current line ~113), insert:

```ts
const declineMaps = await this.faceRepairDeclineRepository.getDeclineMaps();
applyDeclineFilters(flaggedByPerson, declineMaps);
```

Placing the filter here means every downstream consumer — `reviewOnlyPersonIds` (over-cap ratio), `toRepair`,
the approved-exemption, and `perPerson` counts — sees the post-decline flagged set. A face-level decline therefore
also beats a person-level approve (the declined face is gone before the approved push at ~line 125), and
`applyRepair` won't move it. `eligibleByPerson` is untouched, so eligible counts / fractions stay truthful.

- [ ] **Step 3: Type-check.**

Run: `cd server && pnpm check`
Expected: PASS (`faceRepairDeclineRepository` resolves via `BaseService`).

- [ ] **Step 4: Write the failing medium test** in
      `server/test/medium/specs/services/face-repair.service.spec.ts` (follow the existing harness there for
      seeding eligible faces + neighbors so a face flags toward Q). Add cases:

```ts
it('a declined face is not flagged on the next scan', async () => {
  // Arrange: seed a cluster on P with a face F that flags toward Q (existing helper).
  // Record a face-level decline for (F -> Q), then re-run getPersonFlaggedFaces(P).
  await declineRepo.createDeclines({ faces: [{ assetFaceId: F, suspectedOwnerId: Q }], declinedBy: admin });
  const { flaggedFaces } = await sut.getPersonFlaggedFaces(P);
  expect(flaggedFaces.find((x) => x.assetFaceId === F)).toBeUndefined();
});

it('re-surfaces the face when a different owner is suspected', async () => {
  // Decline (F -> Q) but seed neighbors so F now flags toward R.
  await declineRepo.createDeclines({ faces: [{ assetFaceId: F, suspectedOwnerId: Q }], declinedBy: admin });
  const { flaggedFaces } = await sut.getPersonFlaggedFaces(P);
  expect(flaggedFaces.find((x) => x.assetFaceId === F)?.suspectedOwnerId).toBe(R);
});

it('apply does not move a declined face', async () => {
  await declineRepo.createDeclines({ faces: [{ assetFaceId: F, suspectedOwnerId: Q }], declinedBy: admin });
  const result = await sut.applyRepair({ approvedPersonIds: [P] });
  // F stays on P (was the only flagged face) -> nothing moved.
  expect(result.moved).toBe(0);
});
```

- [ ] **Step 5: Run — verify fail → implement → pass.**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/services/face-repair.service.spec.ts`
Expected: PASS after Step 2 is in place.

- [ ] **Step 6: Commit.**

```bash
git add server/src/services/face-repair.service.ts server/test/medium/specs/services/face-repair.service.spec.ts
git commit -m "feat(face-repair): honor declines in buildRepairPlan (scan/review/apply)"
```

---

## Slice 3 — API endpoints

**Goal:** Three admin endpoints — create, list, remove declines — plus regenerated SDK/clients.

### Task 3.1: DTOs

**Files:**

- Modify: `server/src/dtos/face-repair.dto.ts`

- [ ] **Step 1: Add the DTOs** (zod, matching the file's existing style):

```ts
const FaceDeclineSchema = z.object({ assetFaceId: z.uuidv4(), suspectedOwnerId: z.uuidv4() });
const PersonDeclineSchema = z.object({ personId: z.uuidv4(), suspectedOwnerIds: z.array(z.uuidv4()) });

export const FaceRepairDeclineRequestSchema = z
  .object({
    faces: z.array(FaceDeclineSchema).optional(),
    persons: z.array(PersonDeclineSchema).optional(),
  })
  .meta({ id: 'FaceRepairDeclineRequestDto' });
export class FaceRepairDeclineRequestDto extends createZodDto(FaceRepairDeclineRequestSchema) {}

export const FaceRepairDeclineCreatedSchema = z
  .object({ created: z.number() })
  .meta({ id: 'FaceRepairDeclineCreatedDto' });
export class FaceRepairDeclineCreatedDto extends createZodDto(FaceRepairDeclineCreatedSchema) {}

const DeclineItemSchema = z.object({
  id: z.string(),
  type: z.enum(['face', 'person']),
  assetFaceId: z.string().nullable(),
  suspectedOwnerId: z.string().nullable(),
  suspectedOwnerName: z.string().nullable(),
  suspectedOwnerThumbnailFaceId: z.string().nullable(),
  personId: z.string().nullable(),
  personName: z.string().nullable(),
  personThumbnailFaceId: z.string().nullable(),
  createdAt: z.date(),
});
export const FaceRepairDeclineListSchema = z
  .object({ declines: z.array(DeclineItemSchema) })
  .meta({ id: 'FaceRepairDeclineListDto' });
export class FaceRepairDeclineListDto extends createZodDto(FaceRepairDeclineListSchema) {}

export const FaceRepairDeclineRemoveRequestSchema = z
  .object({ ids: z.array(z.uuidv4()).min(1) })
  .meta({ id: 'FaceRepairDeclineRemoveRequestDto' });
export class FaceRepairDeclineRemoveRequestDto extends createZodDto(FaceRepairDeclineRemoveRequestSchema) {}

export const FaceRepairDeclineRemovedSchema = z
  .object({ removed: z.number() })
  .meta({ id: 'FaceRepairDeclineRemovedDto' });
export class FaceRepairDeclineRemovedDto extends createZodDto(FaceRepairDeclineRemovedSchema) {}
```

- [ ] **Step 2: Commit.**

```bash
git add server/src/dtos/face-repair.dto.ts
git commit -m "feat(face-repair): decline DTOs"
```

### Task 3.2: Service methods

**Files:**

- Modify: `server/src/services/face-repair.service.ts`

- [ ] **Step 1: Add the three methods.** `listDeclines` enriches person/owner names + thumbnails live from the
      `person` table (mirroring `withCurrentNames`):

```ts
async createDeclines(input: {
  faces?: { assetFaceId: string; suspectedOwnerId: string }[];
  persons?: { personId: string; suspectedOwnerIds: string[] }[];
  declinedBy: string;
}): Promise<{ created: number }> {
  const created = await this.faceRepairDeclineRepository.createDeclines(input);
  return { created };
}

async listDeclines() {
  const rows = await this.faceRepairDeclineRepository.listDeclines();
  const ids = [
    ...new Set(rows.flatMap((r) => [r.personId, r.suspectedOwnerId].filter((x): x is string => !!x))),
  ];
  const people = ids.length
    ? await this.personRepository.getForFaceRepairDecline(ids) // see note
    : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const nameOf = (id: string | null) => (id && byId.get(id)?.name ? byId.get(id)!.name : null);
  const thumbOf = (id: string | null) => (id ? (byId.get(id)?.faceAssetId ?? null) : null);
  return {
    declines: rows.map((r) => ({
      id: r.id,
      type: r.type,
      assetFaceId: r.assetFaceId,
      suspectedOwnerId: r.suspectedOwnerId,
      suspectedOwnerName: nameOf(r.suspectedOwnerId),
      suspectedOwnerThumbnailFaceId: thumbOf(r.suspectedOwnerId),
      personId: r.personId,
      personName: nameOf(r.personId),
      personThumbnailFaceId: thumbOf(r.personId),
      createdAt: r.createdAt,
    })),
  };
}

async removeDeclines(ids: string[]): Promise<{ removed: number }> {
  const removed = await this.faceRepairDeclineRepository.removeDeclines(ids);
  return { removed };
}
```

> To avoid adding a `PersonRepository` method, the enrichment query can instead be a small private select inside
> `FaceRepairDeclineRepository.listDeclines` returning already-joined names/thumbnails (preferred — keeps the
> `person` join in the data layer, matching `FaceRepairScanRepository.enrichReportPersons`). If you take that
> route, move the enrichment into the repository and have the service pass the rows straight through. Pick one;
> do not invent a `getForFaceRepairDecline` that you don't implement.

- [ ] **Step 2: Commit** (compiles against the chosen enrichment path).

```bash
git add server/src/services/face-repair.service.ts server/src/repositories/face-repair-decline.repository.ts
git commit -m "feat(face-repair): decline service methods + enriched list"
```

### Task 3.3: Controller endpoints (TDD)

**Files:**

- Modify: `server/src/controllers/face-repair-admin.controller.ts`
- Test: `server/src/controllers/face-repair-admin.controller.spec.ts`

- [ ] **Step 1: Add a failing controller test** mirroring the existing cases in the spec (auth guard + service
      delegation). Example for the create endpoint:

```ts
it('POST /admin/face-repair/decline requires admin and delegates', async () => {
  // existing spec already mocks the service + auth; follow its pattern.
  await request(ctx.getHttpServer())
    .post('/admin/face-repair/decline')
    .send({ faces: [{ assetFaceId: uuid1, suspectedOwnerId: uuid2 }] })
    .expect(200);
  expect(service.createDeclines).toHaveBeenCalled();
});
```

- [ ] **Step 2: Implement the endpoints** on `FaceRepairAdminController`:

```ts
@Post('decline')
@Authenticated({ admin: true })
@Endpoint({ summary: 'Decline flagged faces / dismiss flagged persons', history: new HistoryBuilder().added('v1') })
declineFaceRepair(@Auth() auth: AuthDto, @Body() dto: FaceRepairDeclineRequestDto): Promise<FaceRepairDeclineCreatedDto> {
  return this.service.createDeclines({ ...dto, declinedBy: auth.user.id }) as Promise<FaceRepairDeclineCreatedDto>;
}

@Get('decline')
@Authenticated({ admin: true })
@Endpoint({ summary: 'List face-repair declines', history: new HistoryBuilder().added('v1') })
getFaceRepairDeclines(): Promise<FaceRepairDeclineListDto> {
  return this.service.listDeclines() as Promise<FaceRepairDeclineListDto>;
}

@Delete('decline')
@Authenticated({ admin: true })
@Endpoint({ summary: 'Remove face-repair declines', history: new HistoryBuilder().added('v1') })
removeFaceRepairDeclines(@Body() dto: FaceRepairDeclineRemoveRequestDto): Promise<FaceRepairDeclineRemovedDto> {
  return this.service.removeDeclines(dto.ids) as Promise<FaceRepairDeclineRemovedDto>;
}
```

Add `Body, Delete, Get, Post` to the `@nestjs/common` import and the new DTOs to the dto import.

- [ ] **Step 3: Run — verify pass.**

Run: `cd server && pnpm test -- --run src/controllers/face-repair-admin.controller.spec.ts`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add server/src/controllers/face-repair-admin.controller.ts server/src/controllers/face-repair-admin.controller.spec.ts
git commit -m "feat(face-repair): decline/list/remove admin endpoints"
```

### Task 3.4: Regenerate OpenAPI + clients

- [ ] **Step 1: Build + regenerate.**

```bash
cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api
```

- [ ] **Step 2: Verify** the new operations appear (`declineFaceRepair`, `getFaceRepairDeclines`,
      `removeFaceRepairDeclines`) in `open-api/typescript-sdk/src/fetch-client.ts`.

Run: `grep -n "declineFaceRepair\|getFaceRepairDeclines\|removeFaceRepairDeclines" open-api/typescript-sdk/src/fetch-client.ts`
Expected: three matches.

- [ ] **Step 3: Commit.**

```bash
git add open-api mobile/openapi
git commit -m "chore(face-repair): regenerate OpenAPI clients for decline endpoints"
```

---

## Slice 4 — Web UI

**Goal:** A distinct per-face **Decline** action, a per-person **Dismiss** action, and a `/declined`
management+undo route.

### Task 4.1: Route entry + i18n

**Files:**

- Modify: `web/src/lib/route.ts`, `i18n/en.json`

- [ ] **Step 1:** Add to `route.ts` after `viewFaceCleanupPerson` (~line 164):

```ts
  faceCleanupDeclined: () => '/admin/face-cleanup/declined',
```

- [ ] **Step 2:** Add i18n keys under the existing `admin.face_cleanup_*` group in `i18n/en.json` (keep them
      alphabetical within the block):

```json
"face_cleanup_decline": "Decline",
"face_cleanup_decline_hint": "Stop flagging this face until a different owner is suspected",
"face_cleanup_declined_empty": "No declined faces or people",
"face_cleanup_declined_title": "Declined",
"face_cleanup_declined_undo": "Undo",
"face_cleanup_dismiss": "Dismiss",
"face_cleanup_dismiss_confirm": "Stop flagging {name} until a new owner is suspected?",
"face_cleanup_view_declined": "View declined"
```

- [ ] **Step 3: Commit.**

```bash
git add web/src/lib/route.ts i18n/en.json
git commit -m "feat(web): route + i18n for face-cleanup declines"
```

### Task 4.2: Per-face Decline action (TDD on the model)

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts`, `review.spec.ts`, `+page.svelte`

- [ ] **Step 1: Extend the review model test** (`review.spec.ts`) — declining tracks a separate set from
      exclude:

```ts
it('tracks declined faces separately from excluded', () => {
  const vm = createReviewModel([{ assetFaceId: 'a' }, { assetFaceId: 'b' }]);
  vm.toggle('a'); // exclude a (transient)
  vm.markDeclined('b'); // decline b (persistent intent)
  expect(vm.isExcluded('a')).toBe(true);
  expect(vm.isDeclined('b')).toBe(true);
  expect(vm.isExcluded('b')).toBe(false);
  expect(vm.declinedFaceIds()).toEqual(['b']);
});
```

- [ ] **Step 2: Run — verify fail.**

Run: `cd web && pnpm test -- --run src/routes/admin/face-cleanup/[personId]/review.spec.ts`
Expected: FAIL (`markDeclined` undefined).

- [ ] **Step 3: Implement** in `review.svelte.ts` — add a second `SvelteSet` for declined ids and the accessors,
      leaving the existing `excluded` plumbing intact:

```ts
export interface ReviewModel {
  readonly excluded: Set<string>;
  readonly declined: Set<string>;
  readonly movingCount: number;
  readonly excludedCount: number;
  toggle(assetFaceId: string): void;
  isExcluded(assetFaceId: string): boolean;
  excludeFaceIds(): string[];
  markDeclined(assetFaceId: string): void;
  isDeclined(assetFaceId: string): boolean;
  declinedFaceIds(): string[];
}
```

In `createReviewModel`, add `const declined: SvelteSet<string> = new SvelteSet();`, expose `declined`, and add
`markDeclined`/`isDeclined`/`declinedFaceIds`. A declined face also counts as not-moving, so update `movingCount`:

```ts
get movingCount() {
  return flaggedFaces.filter((f) => !excluded.has(f.assetFaceId) && !declined.has(f.assetFaceId)).length;
},
```

- [ ] **Step 4: Run — verify pass.**

Run: `cd web && pnpm test -- --run src/routes/admin/face-cleanup/[personId]/review.spec.ts`
Expected: PASS.

- [ ] **Step 5: Wire the page.** In `[personId]/+page.svelte`, import `declineFaceRepair` from `@immich/sdk` and
      add a small distinct affordance on each face tile (a corner button, visually separate from the tile-click
      exclude). On click:

```ts
const handleDecline = async (face: FlaggedFace) => {
  vm.markDeclined(face.assetFaceId); // optimistic: drop from the moving set immediately
  flaggedFaces = flaggedFaces.filter((x) => x.assetFaceId !== face.assetFaceId);
  try {
    await declineFaceRepair({
      faceRepairDeclineRequestDto: {
        faces: [{ assetFaceId: face.assetFaceId, suspectedOwnerId: face.suspectedOwnerId }],
      },
    });
  } catch {
    // non-fatal: it will simply re-appear on the next scan if the write failed
  }
};
```

Render a Decline button distinct from the exclude checkmark — e.g. a top-right `mdiCancel` button with
`title={$t('admin.face_cleanup_decline_hint')}` and `data-testid="decline-btn"` — so the two negative actions
never blur together (exclude = "not this run", decline = "stop flagging").

- [ ] **Step 6: Commit.**

```bash
git add web/src/routes/admin/face-cleanup/[personId]/review.svelte.ts \
  web/src/routes/admin/face-cleanup/[personId]/review.spec.ts \
  web/src/routes/admin/face-cleanup/[personId]/+page.svelte
git commit -m "feat(web): per-face Decline action in the review screen"
```

### Task 4.3: Per-person Dismiss action

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte`, `+page.svelte`

- [ ] **Step 1:** Add an `onDismiss: (personId: string) => void` prop to `FaceCleanupTable.svelte` and a
      **Dismiss** button in each `personRow` (next to the Review link), guarded by a confirm using
      `admin.face_cleanup_dismiss_confirm`.

- [ ] **Step 2:** In the dashboard `+page.svelte`, implement `onDismiss`: call `declineFaceRepair` with the
      person's suspected-owner set, then remove the row from the loaded scan persons (mirroring how apply prunes
      rows):

```ts
const handleDismiss = async (personId: string) => {
  const person = scan?.persons.find((p) => p.personId === personId);
  if (!person) return;
  const suspectedOwnerIds = person.suspectedOwners.map((o) => o.ownerPersonId);
  await declineFaceRepair({ faceRepairDeclineRequestDto: { persons: [{ personId, suspectedOwnerIds }] } });
  if (scan) scan = { ...scan, persons: scan.persons.filter((p) => p.personId !== personId) };
  toastManager.success($t('admin.face_cleanup_dismiss'));
};
```

- [ ] **Step 3: Type-check.**

Run: `make check-web`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add web/src/routes/admin/face-cleanup/FaceCleanupTable.svelte web/src/routes/admin/face-cleanup/+page.svelte
git commit -m "feat(web): per-person Dismiss action on the dashboard"
```

### Task 4.4: `/declined` management + undo route

**Files:**

- Create: `web/src/routes/admin/face-cleanup/declined/+page.ts`, `declined/+page.svelte`

- [ ] **Step 1:** `+page.ts` — a trivial loader (auth handled by the admin layout; mirror the sibling
      `face-cleanup/+page.ts`).

- [ ] **Step 2:** `+page.svelte` — on mount call `getFaceRepairDeclines()`, render two lists (faces, persons)
      with thumbnails and an **Undo** button per row that calls
      `removeFaceRepairDeclines({ faceRepairDeclineRemoveRequestDto: { ids: [id] } })` and drops the row. Add a
      **View declined** link from the dashboard `+page.svelte` header pointing at `Route.faceCleanupDeclined()`.
      Reuse the thumbnail helpers (`getPeopleThumbnailPath`, `getPersonFaceThumbnailUrl`) already used by the
      review page.

- [ ] **Step 3: Type-check + lint.**

Run: `make check-web lint-web`
Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add web/src/routes/admin/face-cleanup/declined web/src/routes/admin/face-cleanup/+page.svelte
git commit -m "feat(web): declined management + undo route"
```

---

## Slice 5 — e2e

**Files:**

- Modify: `e2e/src/specs/web/face-cleanup.e2e-spec.ts`

- [ ] **Step 1:** Extend the existing spec (follow its setup for seeding a flagged cluster + triggering a scan):
      decline a face via the review screen, re-trigger the scan, assert the declined face is no longer flagged;
      then mutate the evidence so a different owner is suspected and assert it reappears. Add a person-dismiss
      case: dismiss a person, re-scan, assert the row is gone, then visit `/admin/face-cleanup/declined` and undo
      it.

- [ ] **Step 2: Run the relevant e2e** (against the e2e stack — see `make e2e` / `make e2e-web-dev`).

Run: `cd e2e && pnpm test:web -- face-cleanup`
Expected: PASS.

- [ ] **Step 3: Commit.**

```bash
git add e2e/src/specs/web/face-cleanup.e2e-spec.ts
git commit -m "test(e2e): face-cleanup decline + dismiss + undo"
```

---

## Final verification (before pushing to CI)

`vitest` alone skips `tsc`, lint, and the web suite — run the full fork gate locally:

- [ ] `make check-server lint-server` — server types + lint clean.
- [ ] `cd server && pnpm test -- --run` — server unit suite green (watch the default-config and job-queue specs
      that assert exact repo wiring).
- [ ] `cd server && pnpm test:medium -- --run test/medium/specs/repositories/face-repair-decline.repository.spec.ts test/medium/specs/services/face-repair.service.spec.ts`
- [ ] `make check-web lint-web` — web types + lint clean.
- [ ] `cd web && pnpm test -- --run src/routes/admin/face-cleanup` — web unit specs green.
- [ ] Confirm OpenAPI + Dart regen is committed (no `git diff` under `open-api/` or `mobile/openapi/`).

## Self-review notes (author)

- **Spec coverage:** storage (S1) ✓, evidence-keyed face + person filter (S2) ✓, console-only / no identity
  side effects (S2 — only `personId`/`suspectedOwner*` written, no identity calls) ✓, distinct decline-vs-exclude
  (S4.2) ✓, manage/undo route (S4.4) ✓, two granularities (S4.2 + S4.3) ✓, CASCADE cleanup (S1 test) ✓.
- **Type consistency:** `DeclineMaps` defined once in `src/utils/face-repair.ts`, consumed by repo + filter;
  `applyDeclineFilters`/`isSubset` names match across Task 2.1 and 2.2; SDK fn names
  (`declineFaceRepair`/`getFaceRepairDeclines`/`removeFaceRepairDeclines`) match the controller method names
  (the generator derives them from method names, as with `applyFaceRepair`).
- **Open choice flagged in 3.2:** enrich names in the repository (preferred) vs the service — pick one; do not
  leave a `getForFaceRepairDecline` stub.
