import { Kysely, RawBuilder, sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { DB } from 'src/schema/index.js';
import * as jobStatus from 'src/schema/migrations-gallery/1798500000000-AddAssetJobStatusGalleryTable.js';
import * as personIdentity from 'src/schema/migrations-gallery/1798600000000-AddPersonIdentityTable.js';
import * as personPet from 'src/schema/migrations-gallery/1798700000000-AddPersonPetTable.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// down() then up() on this file's own database copy: down() must move each sidecar's rows back onto
// the upstream columns, and up() must move them out again (the backfill an upgrading database runs).
let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

const raw = async <T>(query: RawBuilder<T>) => {
  const { rows } = await query.execute(db);
  return rows;
};

describe('1798500000000-AddAssetJobStatusGalleryTable', () => {
  it('round-trips the pet and classification stamps through asset_job_status', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { asset: stamped } = await ctx.newAsset({ ownerId: user.id });
    const { asset: noStatusRow } = await ctx.newAsset({ ownerId: user.id });
    await ctx.newJobStatus({ assetId: stamped.id });
    const petsDetectedAt = new Date('2026-01-02T03:04:05Z');
    const classifiedAt = new Date('2026-02-03T04:05:06Z');
    await db
      .insertInto('asset_job_status_gallery')
      .values([
        { assetId: stamped.id, petsDetectedAt, classifiedAt },
        { assetId: noStatusRow.id, petsDetectedAt },
      ])
      .execute();
    const expected = [
      { assetId: stamped.id, petsDetectedAt, classifiedAt },
      { assetId: noStatusRow.id, petsDetectedAt, classifiedAt: null },
    ];

    await jobStatus.down(db);
    await expect(
      raw(
        sql`SELECT "assetId", "petsDetectedAt", "classifiedAt" FROM asset_job_status WHERE "assetId" IN (${stamped.id}, ${noStatusRow.id}) ORDER BY array_position(ARRAY[${stamped.id}, ${noStatusRow.id}]::uuid[], "assetId")`,
      ),
    ).resolves.toEqual(expected);
    await expect(raw(sql`SELECT to_regclass('asset_job_status_gallery') AS t`)).resolves.toEqual([{ t: null }]);

    await jobStatus.up(db);
    await expect(
      raw(
        sql`SELECT "assetId", "petsDetectedAt", "classifiedAt" FROM asset_job_status_gallery WHERE "assetId" IN (${stamped.id}, ${noStatusRow.id}) ORDER BY array_position(ARRAY[${stamped.id}, ${noStatusRow.id}]::uuid[], "assetId")`,
      ),
    ).resolves.toEqual(expected);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'asset_job_status' AND column_name IN ('petsDetectedAt', 'classifiedAt')`,
      ),
    ).resolves.toEqual([]);
  });
});

describe('1798600000000-AddPersonIdentityTable', () => {
  it('round-trips the person identity through person."identityId"', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const identity = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const { person: linked } = await ctx.newPerson({ ownerId: user.id, identityId: identity.id });
    const { person: unlinked } = await ctx.newPerson({ ownerId: user.id });

    await personIdentity.down(db);
    await expect(
      raw(
        sql`SELECT "personGroupId", "identityId" FROM person WHERE "personGroupId" IN (${linked.personGroupId}, ${unlinked.personGroupId}) ORDER BY array_position(ARRAY[${linked.personGroupId}, ${unlinked.personGroupId}]::uuid[], "personGroupId")`,
      ),
    ).resolves.toEqual([
      { personGroupId: linked.personGroupId, identityId: identity.id },
      { personGroupId: unlinked.personGroupId, identityId: null },
    ]);
    await expect(raw(sql`SELECT to_regclass('person_identity') AS t`)).resolves.toEqual([{ t: null }]);

    await personIdentity.up(db);
    await expect(
      raw(
        sql`SELECT "personGroupId", "ownerId", "identityId" FROM person_identity WHERE "personGroupId" IN (${linked.personGroupId}, ${unlinked.personGroupId})`,
      ),
    ).resolves.toEqual([{ personGroupId: linked.personGroupId, ownerId: user.id, identityId: identity.id }]);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'person' AND column_name = 'identityId'`,
      ),
    ).resolves.toEqual([]);
  });
});

describe('1798700000000-AddPersonPetTable', () => {
  it('round-trips pets through person."type" and person."species"', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    const { person: dog } = await ctx.newPerson({ ownerId: user.id, type: 'pet', species: 'dog' });
    const { person: unnamedSpecies } = await ctx.newPerson({ ownerId: user.id, type: 'pet' });
    const { person: human } = await ctx.newPerson({ ownerId: user.id });
    const ids = [dog.personGroupId, unnamedSpecies.personGroupId, human.personGroupId];

    await personPet.down(db);
    await expect(
      raw(
        sql`SELECT "personGroupId", type, species FROM person WHERE "personGroupId" IN (${ids[0]}, ${ids[1]}, ${ids[2]}) ORDER BY array_position(ARRAY[${ids[0]}, ${ids[1]}, ${ids[2]}]::uuid[], "personGroupId")`,
      ),
    ).resolves.toEqual([
      { personGroupId: dog.personGroupId, type: 'pet', species: 'dog' },
      { personGroupId: unnamedSpecies.personGroupId, type: 'pet', species: null },
      { personGroupId: human.personGroupId, type: 'person', species: null },
    ]);
    await expect(raw(sql`SELECT to_regclass('person_pet') AS t`)).resolves.toEqual([{ t: null }]);

    await personPet.up(db);
    await expect(
      raw(
        sql`SELECT "personGroupId", species FROM person_pet WHERE "personGroupId" IN (${ids[0]}, ${ids[1]}, ${ids[2]}) ORDER BY array_position(ARRAY[${ids[0]}, ${ids[1]}, ${ids[2]}]::uuid[], "personGroupId")`,
      ),
    ).resolves.toEqual([
      { personGroupId: dog.personGroupId, species: 'dog' },
      { personGroupId: unnamedSpecies.personGroupId, species: null },
    ]);
    await expect(
      raw(
        sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'person' AND column_name IN ('type', 'species')`,
      ),
    ).resolves.toEqual([]);
  });
});
