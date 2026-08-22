import { DatabaseConnectionParams, schemaDiff, schemaFromCode, schemaFromDatabase } from '@immich/sql-tools';
import { Kysely, sql } from 'kysely';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
// Side-effect import: registers every decorated table (incl. FacePersonVerdictTable's partial-index overrides)
// so schemaFromCode() below has something to diff against. See schema-drift.spec.ts for the same idiom.
import 'src/schema';
import { immich_uuid_v7 } from 'src/schema/functions';
import {
  down as downMigration,
  up as upMigration,
} from 'src/schema/migrations-gallery/1788000000000-ReconcileFacePersonVerdictConstraints';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The unified branch authors `face_person_verdict` in its final shape in one migration
// (1787000000000-AddFacePersonVerdict), replacing three never-deployed fork migrations. This spec pins the
// resulting schema — especially the delete semantics, which are the subtle part: an identity-keyed verdict
// has to outlive the person row it was written against (people merge), which rules out CASCADE on the
// target columns, while a lower-bound check on "at least one key" would make that person's DELETE fail.
let db: Kysely<DB>;

// A migration's `up`/`down` take `Kysely<unknown>` (the sql-tools contract) while the medium harness hands
// out a `Kysely<DB>`. Kysely's schema generic is invariant — `fn.any` makes the two mutually
// unassignable — so narrow once here rather than casting at every call site.
const up = (handle: Kysely<DB>) => upMigration(handle as unknown as Kysely<unknown>);
const down = (handle: Kysely<DB>) => downMigration(handle as unknown as Kysely<unknown>);

beforeAll(async () => {
  db = await getKyselyDB();
});

afterAll(async () => {
  await db.destroy();
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [FacePersonVerdictRepository],
    mock: [LoggingRepository],
  });
  return { ctx, sut: ctx.get(FacePersonVerdictRepository) };
};

describe('face_person_verdict migration', () => {
  it('creates the table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'face_person_verdict'
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual(
      [
        'actorId',
        'assetFaceId',
        'createdAt',
        'distance',
        'id',
        'identityId',
        'personId',
        'source',
        'spacePersonId',
        'status',
        'updateId',
        'updatedAt',
      ].toSorted(),
    );
  });

  it('makes every key column except assetFaceId nullable', async () => {
    const columns = await sql<{ column_name: string; is_nullable: string }>`
      SELECT column_name, is_nullable FROM information_schema.columns
      WHERE table_name = 'face_person_verdict'
        AND column_name IN ('personId', 'spacePersonId', 'identityId', 'assetFaceId', 'distance')
    `.execute(db);
    expect(Object.fromEntries(columns.rows.map((row) => [row.column_name, row.is_nullable]))).toEqual({
      personId: 'YES',
      spacePersonId: 'YES',
      identityId: 'YES',
      distance: 'YES',
      assetFaceId: 'NO',
    });
  });

  it('permits at most one target, and permits neither', async () => {
    const checks = await sql<{ def: string }>`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'face_person_verdict'::regclass
        AND contype = 'c'
        AND pg_get_constraintdef(oid) ILIKE '%num_nonnulls%'
    `.execute(db);
    expect(checks.rows).toHaveLength(1);
    // <= 1, never = 1: a verdict whose person was deleted keeps working via identityId.
    expect(checks.rows[0].def).toContain('<= 1');
  });

  it('constrains status and source to the shipped values', async () => {
    const checks = await sql<{ conname: string; def: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'face_person_verdict'::regclass AND contype = 'c'
    `.execute(db);
    const byName = Object.fromEntries(checks.rows.map((r) => [r.conname, r.def]));

    const status = byName['face_person_verdict_status_chk'];
    expect(status).toContain('pending');
    expect(status).toContain('rejected');
    expect(status).toContain('ignored');
    // The positive verdict lives in face_identity_face.source='manual', never here.
    expect(status).not.toContain('confirmed');

    const source = byName['face_person_verdict_source_chk'];
    expect(source).toContain('suggestion');
    expect(source).toContain('cleanup');
  });

  it('defines the target uniqueness, identity, and queue indexes', async () => {
    const indexes = await sql<{ indexname: string; indexdef: string }>`
      SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'face_person_verdict'
    `.execute(db);
    const defs = Object.fromEntries(indexes.rows.map((row) => [row.indexname, row.indexdef]));

    expect(defs.face_person_verdict_personId_assetFaceId_uq).toContain('UNIQUE INDEX');
    expect(defs.face_person_verdict_personId_assetFaceId_uq).toContain('("personId", "assetFaceId")');
    expect(defs.face_person_verdict_personId_assetFaceId_uq).toContain('WHERE ("personId" IS NOT NULL)');

    expect(defs.face_person_verdict_spacePersonId_assetFaceId_uq).toContain('UNIQUE INDEX');
    expect(defs.face_person_verdict_spacePersonId_assetFaceId_uq).toContain('("spacePersonId", "assetFaceId")');
    expect(defs.face_person_verdict_spacePersonId_assetFaceId_uq).toContain('WHERE ("spacePersonId" IS NOT NULL)');

    // The cross-scope read path.
    expect(defs.face_person_verdict_identityId_assetFaceId_idx).toContain('("identityId", "assetFaceId")');
    expect(defs.face_person_verdict_identityId_assetFaceId_idx).toContain('WHERE ("identityId" IS NOT NULL)');

    expect(defs.face_person_verdict_personId_status_distance_idx).toContain('("personId", status, distance)');
    expect(defs.face_person_verdict_assetFaceId_idx).toBeDefined();
    expect(defs.face_person_verdict_updateId_idx).toBeDefined();
  });

  it('uses SET NULL on the targets and identity, and CASCADE on face', async () => {
    const fks = await sql<{ conname: string; def: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'face_person_verdict'::regclass AND contype = 'f'
    `.execute(db);
    const byName = Object.fromEntries(fks.rows.map((r) => [r.conname, r.def]));

    expect(byName['face_person_verdict_personId_fkey']).toContain('ON DELETE SET NULL');
    expect(byName['face_person_verdict_spacePersonId_fkey']).toContain('ON DELETE SET NULL');
    expect(byName['face_person_verdict_actorId_fkey']).toContain('ON DELETE SET NULL');
    // D1: identity is SET NULL (not CASCADE) — merges re-key it onto the survivor, and this is the
    // defense-in-depth net for any deletion path that misses that re-key.
    expect(byName['face_person_verdict_identityId_fkey']).toContain('ON DELETE SET NULL');
    expect(byName['face_person_verdict_assetFaceId_fkey']).toContain('ON DELETE CASCADE');
  });

  it('lets a person be deleted even when the verdict has no identity to fall back on', async () => {
    // The regression a `num_nonnulls(...) >= 1` check would cause: SET NULL would violate it and the
    // person DELETE would fail outright.
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Doomed' });

    await sut.markRejected(person.personGroupId, assetFace.id);

    await expect(db.deleteFrom('person').where('personGroupId', '=', person.personGroupId).execute()).resolves.toBeDefined();

    const row = await db
      .selectFrom('face_person_verdict')
      .selectAll()
      .where('assetFaceId', '=', assetFace.id)
      .executeTakeFirst();
    expect(row).toBeDefined();
    expect(row?.personId).toBeNull();
  });

  it('registered the updatedAt trigger override row', async () => {
    const rows = await sql<{ name: string }>`
      SELECT name FROM migration_overrides WHERE name = 'trigger_face_person_verdict_updatedAt'
    `.execute(db);
    expect(rows.rows).toHaveLength(1);
  });

  it('created the updatedAt trigger in the database', async () => {
    const rows = await sql<{ tgname: string }>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'face_person_verdict'::regclass AND tgname = 'face_person_verdict_updatedAt'
    `.execute(db);
    expect(rows.rows).toHaveLength(1);
  });
});

async function getIdentityFkDeleteType() {
  const rows = await sql<{ confdeltype: string }>`
    SELECT confdeltype FROM pg_constraint WHERE conname = 'face_person_verdict_identityId_fkey'
  `.execute(db);
  return rows.rows[0]?.confdeltype;
}

async function getIdentityFkDef() {
  const rows = await sql<{ def: string }>`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint WHERE conname = 'face_person_verdict_identityId_fkey'
  `.execute(db);
  return rows.rows[0]?.def;
}

// Undoes 7ed4e8c4bc6, simulating an RC/staging database that ran 1787 before that commit landed.
async function setIdentityFkCascade() {
  await sql`ALTER TABLE "face_person_verdict" DROP CONSTRAINT "face_person_verdict_identityId_fkey"`.execute(db);
  await sql`
    ALTER TABLE "face_person_verdict"
    ADD CONSTRAINT "face_person_verdict_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "face_identity" ("id") ON DELETE CASCADE
  `.execute(db);
}

async function getOverrideValues() {
  const rows = await sql<{ name: string; value: unknown }>`
    SELECT name, value FROM migration_overrides
    WHERE name IN (
      'index_face_person_verdict_personId_assetFaceId_uq',
      'index_face_person_verdict_spacePersonId_assetFaceId_uq',
      'index_face_person_verdict_spacePersonId_status_distance_idx',
      'index_face_person_verdict_identityId_assetFaceId_idx'
    )
    ORDER BY name
  `.execute(db);
  return rows.rows;
}

// Undoes 4a64b158139, simulating an RC/staging database that ran 1787 before that commit landed.
async function setOverridesUnparenthesized() {
  await sql`
    UPDATE "migration_overrides" SET "value" =
      '{"type":"index","name":"face_person_verdict_personId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_personId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"personId\\", \\"assetFaceId\\") WHERE \\"personId\\" IS NOT NULL;"}'::jsonb
    WHERE "name" = 'index_face_person_verdict_personId_assetFaceId_uq'
  `.execute(db);
  await sql`
    UPDATE "migration_overrides" SET "value" =
      '{"type":"index","name":"face_person_verdict_spacePersonId_assetFaceId_uq","sql":"CREATE UNIQUE INDEX \\"face_person_verdict_spacePersonId_assetFaceId_uq\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"assetFaceId\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb
    WHERE "name" = 'index_face_person_verdict_spacePersonId_assetFaceId_uq'
  `.execute(db);
  await sql`
    UPDATE "migration_overrides" SET "value" =
      '{"type":"index","name":"face_person_verdict_spacePersonId_status_distance_idx","sql":"CREATE INDEX \\"face_person_verdict_spacePersonId_status_distance_idx\\" ON \\"face_person_verdict\\" (\\"spacePersonId\\", \\"status\\", \\"distance\\") WHERE \\"spacePersonId\\" IS NOT NULL;"}'::jsonb
    WHERE "name" = 'index_face_person_verdict_spacePersonId_status_distance_idx'
  `.execute(db);
  await sql`
    UPDATE "migration_overrides" SET "value" =
      '{"type":"index","name":"face_person_verdict_identityId_assetFaceId_idx","sql":"CREATE INDEX \\"face_person_verdict_identityId_assetFaceId_idx\\" ON \\"face_person_verdict\\" (\\"identityId\\", \\"assetFaceId\\") WHERE \\"identityId\\" IS NOT NULL;"}'::jsonb
    WHERE "name" = 'index_face_person_verdict_identityId_assetFaceId_idx'
  `.execute(db);
}

// Same schemaDiff/schemaFromCode/schemaFromDatabase entry point schema-drift.spec.ts uses, parameterized to
// this file's per-suite cloned database instead of the fixed template URL (`getKyselyDB()` clones a
// fresh "immich_<suffix>" database per file from the "mich" template — schema-drift.spec.ts's own helper
// targets the template itself via IMMICH_TEST_POSTGRES_URL, which this suite's manual mutations never touch).
async function computeDriftForThisDb() {
  const { rows } = await sql<{ db: string }>`SELECT current_database() as db`.execute(db);
  const dbName = rows[0].db;
  const testUrl = process.env.IMMICH_TEST_POSTGRES_URL!;
  const url = testUrl.replace(/\/[^/]+$/, () => `/${dbName}`);

  const source = schemaFromCode({
    overrides: true,
    namingStrategy: 'default',
    uuidFunction: (version) => (version === 7 ? `${immich_uuid_v7.name}()` : 'uuid_generate_v4()'),
  });
  const connection = { connectionType: 'url', url } as DatabaseConnectionParams;
  const target = await schemaFromDatabase({ connection });
  return schemaDiff(source, target, {
    tables: { ignoreExtra: true },
    constraints: { ignoreExtra: false },
    indexes: { ignoreExtra: true },
    triggers: { ignoreExtra: true },
    columns: { ignoreExtra: true },
    functions: { ignoreExtra: false },
    parameters: { ignoreExtra: true },
    extensions: { ignoreExtra: true },
  });
}

// Slice 13 (F33): 1787000000000-AddFacePersonVerdict was edited in place after it had already run against
// RC/staging databases. Kysely records migrations by name only (no checksum), so those instances never re-ran
// 1787 and are stuck on the pre-edit shape: CASCADE on identityId (instead of SET NULL) and unparenthesized
// override payloads (instead of the parenthesized form asIndexCreate emits). 1788000000000 repairs both,
// idempotently, without ever amending 1787 itself.
describe('1788000000000-ReconcileFacePersonVerdictConstraints', () => {
  // setup() (module scope, above): the `1787000000000-AddFacePersonVerdict` describe block above uses the
  // same helper and additionally destructures `sut`; this describe only needs `ctx`.
  // S13.2 — must run before any other test in this describe block mutates the FK or the overrides: it is
  // pinning that a SECOND application of 1788 on top of the ALREADY-applied one (every fresh clone from the
  // "mich" template ran 1788 once, via runMigrations() in globalSetup) changes nothing.
  it('S13.2 is a no-op on a freshly-migrated database', async () => {
    const beforeFkDef = await getIdentityFkDef();
    const beforeOverrides = await getOverrideValues();
    expect(beforeFkDef).toContain('ON DELETE SET NULL'); // positive control: the "before" state is the fixed one.

    await up(db);

    expect(await getIdentityFkDef()).toEqual(beforeFkDef);
    expect(await getOverrideValues()).toEqual(beforeOverrides);
  });

  it('S13.1 repairs a CASCADE identityId FK to SET NULL, idempotently', async () => {
    await setIdentityFkCascade();
    expect(await getIdentityFkDeleteType()).toBe('c'); // positive control: confirm the broken state landed.

    await up(db);
    expect(await getIdentityFkDeleteType()).toBe('n');

    // Run a second time: must not error, and must still be SET NULL.
    await expect(up(db)).resolves.toBeUndefined();
    expect(await getIdentityFkDeleteType()).toBe('n');
  });

  it('S13.3 repairs unparenthesized override payloads and clears schema drift', async () => {
    await setOverridesUnparenthesized();
    const broken = await getOverrideValues();
    expect(broken.every((row) => !JSON.stringify(row.value).includes('IS NOT NULL)'))).toBe(true); // control.

    const driftBefore = await computeDriftForThisDb();
    expect(driftBefore.asHuman().length).toBeGreaterThan(0); // positive control: broken state IS visible as drift.

    await up(db);

    const repaired = await getOverrideValues();
    expect(repaired.every((row) => JSON.stringify(row.value).includes('IS NOT NULL)'))).toBe(true);

    const driftAfter = await computeDriftForThisDb();
    expect(driftAfter.asHuman()).toEqual([]);
  });

  // S13.5 — BDD, the data-loss case (F33). Given/When/Then plus the required positive control: the same delete,
  // under the same unrepaired CASCADE FK, removes the row when 1788 has NOT run.
  it('S13.5 preserves an identity-keyed verdict across an identity delete once repaired, unlike the unrepaired CASCADE', async () => {
    const { ctx } = setup();
    const { user } = await ctx.newUser();

    const newIdentityKeyedVerdict = async () => {
      const identity = await db
        .insertInto('face_identity')
        .values({ type: 'person' })
        .returningAll()
        .executeTakeFirstOrThrow();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace } = await ctx.newAssetFace({ assetId: asset.id });
      await db
        .insertInto('face_person_verdict')
        .values({ identityId: identity.id, assetFaceId: assetFace.id, status: 'rejected' })
        .execute();
      return { identityId: identity.id, assetFaceId: assetFace.id };
    };

    // Given a database whose FK is CASCADE (the unrepaired shape)...
    await setIdentityFkCascade();

    // Control: without 1788 having run, deleting the identity removes the verdict row. Proves the fixture is
    // exercising real CASCADE semantics, not something the test would pass under regardless.
    const control = await newIdentityKeyedVerdict();
    await db.deleteFrom('face_identity').where('id', '=', control.identityId).execute();
    const controlRow = await db
      .selectFrom('face_person_verdict')
      .selectAll()
      .where('assetFaceId', '=', control.assetFaceId)
      .executeTakeFirst();
    expect(controlRow).toBeUndefined();

    // When 1788000000000 runs...
    await up(db);

    // ...and a verdict row keyed to identity I (with a live assetFaceId) has I deleted...
    const main = await newIdentityKeyedVerdict();
    await db.deleteFrom('face_identity').where('id', '=', main.identityId).execute();

    // Then the verdict row still exists with identityId NULL.
    const mainRow = await db
      .selectFrom('face_person_verdict')
      .selectAll()
      .where('assetFaceId', '=', main.assetFaceId)
      .executeTakeFirst();
    expect(mainRow).toBeDefined();
    expect(mainRow?.identityId).toBeNull();
  });

  // S13.4 — deliberately last: down() restores the pre-repair shape, which is the correct thing for down() to
  // do but leaves this suite's database in that state. Nothing later in this file depends on a clean database.
  it('S13.4 down() restores the CASCADE FK and the unparenthesized override payloads', async () => {
    await up(db); // known-good baseline regardless of prior test ordering.
    expect(await getIdentityFkDeleteType()).toBe('n'); // positive control before down().

    await down(db);

    expect(await getIdentityFkDeleteType()).toBe('c');
    const overrides = await getOverrideValues();
    expect(overrides).toHaveLength(4);
    for (const row of overrides) {
      const text = JSON.stringify(row.value);
      expect(text).toContain('IS NOT NULL;');
      expect(text).not.toContain('IS NOT NULL)');
    }
  });
});
