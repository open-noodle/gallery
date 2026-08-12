# Face Verdict Remediation — Slice 1: Verdicts survive merges — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A negative/keep-here `face_person_verdict` row outlives person merges, space-person merges, identity merges, and identity GC — closing defect **D1** of `docs/superpowers/specs/2026-07-23-face-verdict-layer-remediation-design.md`.

**Architecture:** Two mechanisms. (1) **Re-key/re-target inside the existing merge transactions, before source rows are deleted:** merges re-key `face_person_verdict.identityId` onto the surviving identity, and re-target `personId`/`spacePersonId` onto the surviving profile with a survivor-wins collision policy. (2) **Defense-in-depth:** the `identityId` FK flips `ON DELETE CASCADE` → `ON DELETE SET NULL`, so any deletion path that misses re-keying (GC, future code) degrades a row to target-fallback matching instead of destroying it.

**Tech Stack:** NestJS 11, Kysely (type-safe SQL, `sql` template + expression builders), Vitest medium tests (real Postgres via testcontainers, `getKyselyDB()` + `newMediumService`), PostgreSQL partial indexes.

## Global Constraints

- Server imports use the `src/` alias — **no relative imports**.
- Server lint is `--max-warnings 0`; formatting is Prettier (120 col, single quotes, trailing commas, semicolons).
- Medium tests need Docker (testcontainers). Targeted run form is **`pnpm exec vitest --config test/vitest.config.medium.mjs --run <path>`** — never `pnpm test:medium -- --run <path>` (drops the path filter). Unit run form is `pnpm exec vitest --run <path>`.
- Kysely rule (fork): inside a `.transaction().execute(async (trx) => …)` / a passed `db: Transaction<DB>` callback, **every** query uses that same `trx`/`db` — never `this.db`.
- `face_person_verdict` uniqueness: `(personId, assetFaceId)` and `(spacePersonId, assetFaceId)` are **UNIQUE partial** (`WHERE … IS NOT NULL`); `(identityId, assetFaceId)` is **non-unique**. Re-keying `identityId` cannot collide; re-targeting `personId`/`spacePersonId` can, hence survivor-wins.
- One commit for the whole slice at the end (message in Task 7). Do not commit mid-slice.

---

## File Structure

- **Create** `server/src/utils/face-verdict-merge.ts` — three tiny pure helpers (`rekeyVerdictIdentity`, `retargetVerdictPersonId`, `retargetVerdictSpacePersonId`) that run against a passed `Kysely<DB> | Transaction<DB>`. One home for the merge-durability SQL, imported by the three repositories below. No repo cross-injection.
- **Modify** `server/src/repositories/face-identity.repository.ts` — call `rekeyVerdictIdentity` inside `mergeIdentities` (`trx`) and `mergeIdentitiesAfterProfileResolution` (`db`), before their `deletable` computations.
- **Modify** `server/src/repositories/person.repository.ts` — call `retargetVerdictPersonId` inside `mergePersonProfile` before it deletes the source `person`; correct the false merge-safety comment.
- **Modify** `server/src/repositories/shared-space.repository.ts` — call `retargetVerdictSpacePersonId` inside `mergeSpacePersonProfile` before it deletes the source `shared_space_person`.
- **Modify** `server/src/schema/tables/face-person-verdict.table.ts` — `identityId` decorator `onDelete: 'CASCADE'` → `'SET NULL'`; correct the "no re-key pass is ever needed" comment.
- **Modify** `server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts` — `face_person_verdict_identityId_fkey` `ON DELETE CASCADE` → `ON DELETE SET NULL` (edit in place; RC DBs are reset).
- **Create** `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts` — the red-first regression suite (5 scenarios + edge cases), driving the **real** `IdentityMergePropagationService` merge flow.

**Interfaces produced by `face-verdict-merge.ts`** (later tasks depend on these exact names/types):

```ts
export async function rekeyVerdictIdentity(
  db: Kysely<DB> | Transaction<DB>,
  sourceIdentityIds: string[],
  targetIdentityId: string,
): Promise<void>;

export async function retargetVerdictPersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourcePersonId: string,
  targetPersonId: string,
): Promise<void>;

export async function retargetVerdictSpacePersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourceSpacePersonId: string,
  targetSpacePersonId: string,
): Promise<void>;
```

---

## Task 1: Red — author the merge-durability regression suite

**Files:**

- Create: `server/test/medium/specs/services/face-verdict.merge-durability.spec.ts`

**Interfaces:**

- Consumes: `IdentityMergePropagationService` (real merge flow), `FaceIdentityRepository.ensurePersonIdentity`/`mergeIdentities`, `FacePersonVerdictRepository.markRejected`/`getNegativeVerdictTokens`/`deleteUnreferencedIdentities`, medium-test helpers `newMediumService`, `getKyselyDB`, `ctx.newUser`/`newPerson`/`newAsset`/`newAssetFace`, `factory.auth`.
- Produces: the permanent Slice-1 regression suite.

**Pattern to follow** (copy setup from `server/test/medium/specs/services/identity-merge-propagation.service.spec.ts` — the ONLY template that exercises the real identity-deletion path; the existing `face-repair.merge-consistency.spec.ts` calls `personRepository.mergePersonProfile` directly and does **not** reproduce D1). Add `FacePersonVerdictRepository` to the `real:` list.

- [ ] **Step 1: Write the failing spec** covering all five spec scenarios + edge cases.

```ts
import { Kysely } from 'kysely';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { BaseService } from 'src/services/base.service';
import { DB } from 'src/schema';
import { SourceType } from 'src/enum';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { factory } from 'test/small.factory';
import { Mocked } from 'vitest';

let defaultDatabase: Kysely<DB>;

const setup = (db: Kysely<DB> = defaultDatabase) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
      FacePersonVerdictRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  const jobRepository = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobRepository.queue.mockResolvedValue();
  const sut = new IdentityMergePropagationService({
    databaseRepository: ctx.get(DatabaseRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    jobRepository,
    logger: ctx.getMock<LoggingRepository, Mocked<LoggingRepository>>(LoggingRepository),
    personRepository: ctx.get(PersonRepository),
    sharedSpaceRepository: ctx.get(SharedSpaceRepository),
  });
  return {
    ctx,
    sut,
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    facePersonVerdictRepository: ctx.get(FacePersonVerdictRepository),
  };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const seedFace = async (ctx: Awaited<ReturnType<typeof setup>>['ctx'], ownerId: string) => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personId: null,
    sourceType: SourceType.MachineLearning,
  });
  return assetFace.id;
};

const verdictRow = (assetFaceId: string, personCol: 'personId' | 'spacePersonId' = 'personId') =>
  defaultDatabase
    .selectFrom('face_person_verdict')
    .select(['id', 'personId', 'spacePersonId', 'identityId', 'status'])
    .where('assetFaceId', '=', assetFaceId)
    .execute();

describe('face verdict merge durability (D1)', () => {
  it('keep-here verdict survives Bob→Robert person merge, re-keyed to the survivor identity', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // cleanup keep-here: (F, Bob, I(Bob), rejected, cleanup)
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rejected', personId: robert.id, identityId: robertIdentity.id });
    // honoured identity-first by the shared read
    const tokens = await facePersonVerdictRepository.getNegativeVerdictTokens([faceId]);
    expect([...(tokens.get(faceId) ?? [])]).toContain(`identity:${robertIdentity.id}`);
  });

  it('identity-null suggestion reject survives the merge via personId re-target', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // suggestion reject as it is written TODAY (pre-Slice-2): no identity, personId only.
    await facePersonVerdictRepository.markRejected(bob.id, faceId);

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'rejected', personId: robert.id });
  });

  it('identity-only merge re-keys the verdict instead of destroying it', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const target = await defaultDatabase
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    // 'manual' source merges all sources without the embedding-consistency filter, exercising the
    // identical re-key statement; the shared-space-evidence production path is covered above.
    await faceIdentityRepository.mergeIdentities({
      targetIdentityId: target.id,
      sourceIdentityIds: [bobIdentity.id],
      source: 'manual',
    });

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].identityId).toBe(target.id);
    expect(rows[0].status).toBe('rejected');
  });

  it('survivor wins on collision: source verdict dropped, survivor untouched', async () => {
    const { ctx, sut, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const { person: robert } = await ctx.newPerson({ ownerId: user.id, name: 'Robert' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    const robertIdentity = await faceIdentityRepository.ensurePersonIdentity(robert.id);
    // Bob IGNORED F, Robert (survivor) REJECTED F. Distinct statuses prove which row survives.
    await facePersonVerdictRepository.markIgnored(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'suggestion',
      actorId: user.id,
    });
    await facePersonVerdictRepository.markRejected(robert.id, faceId, {
      identityId: robertIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });

    await sut.mergePersonalPeople(factory.auth({ user }), robert.id, [bob.id]);

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // no unique-violation, source row dropped
    // Survivor's row kept untouched: it is Robert's REJECTED row, not Bob's ignored one.
    expect(rows[0]).toMatchObject({ personId: robert.id, identityId: robertIdentity.id, status: 'rejected' });
  });

  it('GC (deleteUnreferencedIdentities) degrades an identity-only verdict to SET NULL, never deletes', async () => {
    const { ctx, faceIdentityRepository, facePersonVerdictRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: bob } = await ctx.newPerson({ ownerId: user.id, name: 'Bob' });
    const faceId = await seedFace(ctx, user.id);
    const bobIdentity = await faceIdentityRepository.ensurePersonIdentity(bob.id);
    await facePersonVerdictRepository.markRejected(bob.id, faceId, {
      identityId: bobIdentity.id,
      source: 'cleanup',
      actorId: user.id,
    });
    // remove the person so only the verdict references the identity, then GC
    await defaultDatabase.deleteFrom('person').where('id', '=', bob.id).execute();
    await faceIdentityRepository.deleteUnreferencedIdentities();

    const rows = await verdictRow(faceId);
    expect(rows).toHaveLength(1); // NOT cascade-deleted
    expect(rows[0].identityId).toBeNull(); // SET NULL degrade
    expect(rows[0].status).toBe('rejected');
  });
});
```

> Note the `matchObject` in scenario 4 uses only stable columns; drop the `source_present` sentinel if the reviewer prefers — the load-bearing assertions are `toHaveLength(1)` + `personId: robert.id` + `identityId: robertIdentity.id` (Robert's row, not Bob's). Verify `factory.auth` / `test/small.factory` import paths against a sibling medium spec before finalizing; if `mergePersonalPeople` needs a destructive-merge authorizer for cross-identity collapses, use the same-owner non-destructive pattern shown at `identity-merge-propagation.service.spec.ts:255-266` (no authorizer needed for same-owner collapse).

- [ ] **Step 2: Run to verify RED**

Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-verdict.merge-durability.spec.ts`
Expected: scenarios 1, 2, 4, 5 FAIL — scenario 1 finds `identityId` still = Bob's (or the row CASCADE-deleted → length 0); scenario 2 finds `personId` still = Bob (SET NULL → null) or 0 rows; scenario 4 hits a unique-violation or leaves 2 rows; scenario 5 finds 0 rows (CASCADE). Scenario 3 (identity-only) may already fail with 0 rows. **Confirm the file actually executed** (5 tests collected), not silently skipped.

---

## Task 2: Green — create the merge helper module

**Files:**

- Create: `server/src/utils/face-verdict-merge.ts`

- [ ] **Step 1: Write the helpers**

```ts
import { Kysely, Transaction } from 'kysely';
import { DB } from 'src/schema';

/**
 * Re-key negative/keep-here verdicts from merged-away source identities onto the surviving identity.
 * `(identityId, assetFaceId)` is non-unique, so a straight update cannot violate a constraint. Must run
 * BEFORE the source identities are deleted so the verdict never dangles.
 */
export async function rekeyVerdictIdentity(
  db: Kysely<DB> | Transaction<DB>,
  sourceIdentityIds: string[],
  targetIdentityId: string,
): Promise<void> {
  if (sourceIdentityIds.length === 0) {
    return;
  }
  await db
    .updateTable('face_person_verdict')
    .set({ identityId: targetIdentityId })
    .where('identityId', 'in', sourceIdentityIds)
    .execute();
}

/**
 * Survivor-wins re-target of a personal verdict onto the merge survivor. `(personId, assetFaceId)` is
 * unique-partial, so first drop source rows that would collide with an existing survivor row, then move
 * the rest. Must run BEFORE the source person is deleted (its FK is SET NULL, so a delete would orphan
 * the verdict rather than move it).
 */
export async function retargetVerdictPersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourcePersonId: string,
  targetPersonId: string,
): Promise<void> {
  await db
    .deleteFrom('face_person_verdict')
    .where('personId', '=', sourcePersonId)
    .where('assetFaceId', 'in', (eb) =>
      eb
        .selectFrom('face_person_verdict as survivor')
        .select('survivor.assetFaceId')
        .where('survivor.personId', '=', targetPersonId),
    )
    .execute();
  await db
    .updateTable('face_person_verdict')
    .set({ personId: targetPersonId })
    .where('personId', '=', sourcePersonId)
    .execute();
}

/** Space twin of {@link retargetVerdictPersonId}. */
export async function retargetVerdictSpacePersonId(
  db: Kysely<DB> | Transaction<DB>,
  sourceSpacePersonId: string,
  targetSpacePersonId: string,
): Promise<void> {
  await db
    .deleteFrom('face_person_verdict')
    .where('spacePersonId', '=', sourceSpacePersonId)
    .where('assetFaceId', 'in', (eb) =>
      eb
        .selectFrom('face_person_verdict as survivor')
        .select('survivor.assetFaceId')
        .where('survivor.spacePersonId', '=', targetSpacePersonId),
    )
    .execute();
  await db
    .updateTable('face_person_verdict')
    .set({ spacePersonId: targetSpacePersonId })
    .where('spacePersonId', '=', sourceSpacePersonId)
    .execute();
}
```

- [ ] **Step 2: Type-check** — `cd server && pnpm exec tsc --noEmit -p tsconfig.json` (or `pnpm check`). Expected: no errors from the new file. If Kysely rejects the subquery form, use `.where('assetFaceId', 'in', db.selectFrom('face_person_verdict as survivor')…)` (a standalone subquery bound to the same `db`) — functionally identical.

---

## Task 3: Green — re-key identity inside both identity-merge methods

**Files:**

- Modify: `server/src/repositories/face-identity.repository.ts`

**Interfaces:** Consumes `rekeyVerdictIdentity` from Task 2.

- [ ] **Step 1: Add the import** (top of file, with the other `src/` imports):

```ts
import { rekeyVerdictIdentity } from 'src/utils/face-verdict-merge';
```

- [ ] **Step 2:** In `mergeIdentities`, immediately AFTER the `shared_space_person` re-key (the `.updateTable('shared_space_person')…execute()` block that ends ~line 3078) and BEFORE the `const deletable = …` query (~line 3084), insert:

```ts
// D1: move any verdict rows off the merged-away identities onto the survivor before those
// identities are deleted (identityId FK is SET NULL, but we re-key so identity-first reads keep working).
await rekeyVerdictIdentity(trx, mergeableSourceIdentityIds, input.targetIdentityId);
```

- [ ] **Step 3:** In `mergeIdentitiesAfterProfileResolution`, AFTER the `shared_space_person` type-sync updates and BEFORE the `const deletable = …` query (~line 3180), insert (note the transaction variable here is the passed `db`, and the source set is `sourceIdentityIds`):

```ts
// D1: same re-key as mergeIdentities, on the production person-merge path.
await rekeyVerdictIdentity(db, sourceIdentityIds, input.targetIdentityId);
```

- [ ] **Step 4: Type-check** `cd server && pnpm check`. Expected: clean.

---

## Task 4: Green — survivor-wins re-target inside the person / space-person merges

**Files:**

- Modify: `server/src/repositories/person.repository.ts` (`mergePersonProfile`, ~lines 138-195)
- Modify: `server/src/repositories/shared-space.repository.ts` (`mergeSpacePersonProfile`, ~lines 2692-2721)

**Interfaces:** Consumes `retargetVerdictPersonId` / `retargetVerdictSpacePersonId` from Task 2.

- [ ] **Step 1: person.repository.ts** — add import `import { retargetVerdictPersonId } from 'src/utils/face-verdict-merge';`. In `mergePersonProfile`, immediately BEFORE `const targetNeedsFeatureFaceRepair = …` / the `deleteFrom('person')` at ~line 189, insert:

```ts
// D1: move this person's verdicts to the survivor before deleting the source person (personId FK is
// SET NULL — a bare delete would orphan them). Survivor-wins on the (personId, assetFaceId) collision.
await retargetVerdictPersonId(db, input.sourcePersonId, input.targetPersonId);
```

- [ ] **Step 2: Replace the false merge-safety comment** at `person.repository.ts:181-185` with an accurate one:

```ts
// Human placements live in `face_identity_face.source='manual'` (identity-keyed); negative/keep-here
// verdicts live in `face_person_verdict`. Both are re-pointed to the survivor at merge time: the
// identityId re-key runs in mergeIdentitiesAfterProfileResolution, and the personId re-target runs
// just above (survivor-wins). The identityId FK is ON DELETE SET NULL as a safety net.
```

- [ ] **Step 3: shared-space.repository.ts** — add import `import { retargetVerdictSpacePersonId } from 'src/utils/face-verdict-merge';`. In `mergeSpacePersonProfile`, immediately BEFORE the `deleteFrom('shared_space_person')` at ~line 2716, insert:

```ts
// D1: move this space-person's verdicts to the survivor before deleting the source row.
await retargetVerdictSpacePersonId(db, input.sourcePersonId, input.targetPersonId);
```

> Confirm the exact param names on `mergeSpacePersonProfile`'s `input` (digest: `{ sourcePersonId, targetPersonId }`, space-person ids) and that its `db` is the passed transaction. Match them.

- [ ] **Step 4: Type-check** `cd server && pnpm check`. Expected: clean.

---

## Task 5: Green — flip the identityId FK to SET NULL (defense-in-depth)

**Files:**

- Modify: `server/src/schema/tables/face-person-verdict.table.ts` (~lines 94-98)
- Modify: `server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts` (~line 28)

- [ ] **Step 1: Decorator + comment** in `face-person-verdict.table.ts`. Replace the 94-98 block:

```ts
  // Identity-first key. Written whenever the target has an identity; the target columns above remain the
  // fallback. Merges re-key this onto the survivor; ON DELETE SET NULL is the safety net that degrades an
  // orphaned verdict to target-fallback matching instead of destroying it (parent §4.1).
  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'SET NULL', index: false, nullable: true })
  identityId!: string | null;
```

- [ ] **Step 2: Migration** — in `1787000000000-AddFacePersonVerdict.ts`, change the identityId FK constraint (~line 28) from:

```ts
  CONSTRAINT "face_person_verdict_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE CASCADE,
```

to:

```ts
  CONSTRAINT "face_person_verdict_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE SET NULL,
```

- [ ] **Step 3: Hunt for any test that pins the old CASCADE** on `identityId` (not the personId row, which is already SET NULL). Run:

```bash
cd server && grep -rn "identityId.*CASCADE\|CASCADE.*identityId" src test | grep -i verdict
```

If `test/medium/specs/migrations/face-person-verdict.migration.spec.ts` (or any repo spec) asserts `identityId` FK = CASCADE, update that assertion to `SET NULL`. (The mislabeled `face-person-verdict.repository.spec.ts:638-661` CASCADE test targets the **personId** delete and is unaffected here — leave it for Slice 10.)

- [ ] **Step 4: Type-check** `cd server && pnpm check`. Expected: clean.

---

## Task 6: Green + refactor — verify the suite is green, then tidy

- [ ] **Step 1: Run the new spec — expect GREEN**

Run: `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-verdict.merge-durability.spec.ts`
Expected: all 5 tests PASS.

- [ ] **Step 2: Run the sibling merge/verdict suites — no regressions**

Run each and confirm green:

- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/identity-merge-propagation.service.spec.ts`
- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/services/face-repair.merge-consistency.spec.ts`
- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/repositories/face-person-verdict.repository.spec.ts`
- `cd server && pnpm exec vitest --config test/vitest.config.medium.mjs --run test/medium/specs/migrations/face-person-verdict.migration.spec.ts`

- [ ] **Step 3: Refactor check** — the three helpers already live in one module (`face-verdict-merge.ts`) consumed by all three repositories; the survivor-wins body is shared in shape between the person/space twins. Confirm no duplicated inline SQL remains in the repositories (all re-key/re-target goes through the helpers). No behavior change; re-run Step 1 to confirm still green.

---

## Task 7: Done gate + commit

- [ ] **Step 1: Full slice done gate** (run in full, not delegated):

```bash
cd server && pnpm check          # tsc --noEmit, clean
cd server && pnpm lint           # eslint --max-warnings 0, clean
```

Plus all five spec runs from Task 6 Steps 1-2 green.

- [ ] **Step 2: Commit** (single slice commit):

```bash
cd /Users/pierre/dev/gallery/.claude/worktrees/face-unified
git add server/src/utils/face-verdict-merge.ts \
        server/src/repositories/face-identity.repository.ts \
        server/src/repositories/person.repository.ts \
        server/src/repositories/shared-space.repository.ts \
        server/src/schema/tables/face-person-verdict.table.ts \
        server/src/schema/migrations-gallery/1787000000000-AddFacePersonVerdict.ts \
        server/test/medium/specs/services/face-verdict.merge-durability.spec.ts \
        docs/superpowers/plans/2026-07-23-face-verdict-remediation-slice-1.md
git commit -m "fix(server): re-key face verdicts through merges instead of cascading them away"
```

(If Task 5 Step 3 modified a migration/repo spec, add that path too.) No `Co-Authored-By` / `Generated with` trailers.

---

## Edge-case coverage map (spec §Slice 1 table → test)

| Edge case                                                              | Covered by                                                                                                                                                       |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Both merged people hold rows for the same face                         | scenario 4 "survivor wins" (both rejected)                                                                                                                       |
| Source pending + survivor rejected (and vice versa)                    | scenario 4 variant — survivor's row wins regardless of status (add a 2nd assertion seeding Bob=pending, Robert=rejected → 1 row, Robert's)                       |
| Merge where loser has no identity                                      | scenario 2 (identity-null) — personId re-target fires, identity re-key is a no-op                                                                                |
| Identity merge, same face via both identities                          | non-unique index → both keyed to target, reads treat as one fact (assert length≥1, identityId=target) — fold into scenario 3 with a 2nd source identity if cheap |
| Self-merge / rollback mid-trx                                          | merge trx is all-or-nothing (covered structurally; no separate test needed — re-key is inside the same `trx`/`db`)                                               |
| `deleteUnreferencedIdentities` on identity referenced only by verdicts | scenario 5 (GC → SET NULL degrade)                                                                                                                               |

> Implementer: add the two parenthetical extra assertions (source-pending/survivor-rejected; identity-merge same-face) so every row of the spec's edge table has a proving assertion.

## Self-review (author)

- **Spec coverage:** all 5 Slice-1 scenarios + the 6-row edge table map to tests above. FK flip, both identity-merge methods, both profile-merge methods, both comments — each has a task. ✅
- **Placeholder scan:** no TBD/TODO; every code step shows real code. The two "confirm exact param names / import paths" notes are verification instructions, not placeholders — the code is complete and the fallback is named. ✅
- **Type consistency:** helper names (`rekeyVerdictIdentity`, `retargetVerdictPersonId`, `retargetVerdictSpacePersonId`) are used identically in the interface block, Task 2 definitions, and Tasks 3-4 call sites. ✅
- **Scope:** no Slice-2+ work (identity/actor on writes, reads, manual preservation) leaks in. Suggestion rows are seeded in their _current_ (identity-null) form deliberately. ✅
