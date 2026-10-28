import { Kysely, sql } from 'kysely';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { PersonUserRole } from 'src/dtos/person.dto.js';
import { JobStatus } from 'src/enum.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { DB } from 'src/schema/index.js';
import * as splitMigration from 'src/schema/migrations-gallery/1790900000000-SplitSharedPersonGroups.js';
import { PersonService } from 'src/services/person.service.js';
import { SyncTestContext, newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

// Seeds the multi-owner person groups an Immich 3.3 database can hold, through upstream's own paths:
// recognition inside a cluster group (a second owner's row in an existing group) and person sharing
// (person_user, whose trigger adds the recipient's row). Each test gets its own database copy, because
// up() and down() act on every group in it.
let db: Kysely<DB>;

beforeEach(async () => {
  db = await getKyselyDB();
  // Gallery's one-row-per-group index; an Immich database does not have it.
  await sql`DROP INDEX "person_personGroupId_key"`.execute(db);
});

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));

const seed = async () => {
  const ctx = new SyncTestContext(db);
  const { user: alice } = await ctx.newUser();
  const { user: bob } = await ctx.newUser({ clusterGroupId: alice.clusterGroupId });
  const { user: carol } = await ctx.newUser({ clusterGroupId: alice.clusterGroupId });
  const face = async (ownerId: string, personGroupId: string) => {
    const { asset } = await ctx.newAsset({ ownerId });
    const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId });
    return assetFace.id;
  };

  // Recognition: Alice's face made the group, then Bob's matched it. Carol's face sits in it without a row.
  const { person: recognized } = await ctx.newPerson({
    ownerId: alice.id,
    name: 'Grandma',
    isFavorite: true,
    createdAt: at(1),
  });
  const group = recognized.personGroupId;
  await ctx.newPerson({ ownerId: bob.id, personGroupId: group, name: 'Oma', isHidden: true, createdAt: at(2) });
  const recognizedFaces = { alice: await face(alice.id, group), bob: await face(bob.id, group), carol: await face(carol.id, group) };

  // Sharing: Bob shares with Alice (the trigger adds her row), who passes it on to Carol.
  const { person: shared } = await ctx.newPerson({ ownerId: bob.id, name: 'Rex', createdAt: at(3) });
  const sharedGroup = shared.personGroupId;
  await ctx.newPersonUser({ personGroupId: sharedGroup, sharedById: bob.id, sharedWithId: alice.id });
  await ctx.newPersonUser({
    personGroupId: sharedGroup,
    sharedById: alice.id,
    sharedWithId: carol.id,
    role: PersonUserRole.Read,
  });
  // Alice cleared the name she was given; restoring the shares must not refill it from Bob's.
  await sql`UPDATE "person" SET "name" = '' WHERE "ownerId" = ${alice.id} AND "personGroupId" = ${sharedGroup}`.execute(
    db,
  );
  const sharedFaces = { bob: await face(bob.id, sharedGroup), alice: await face(alice.id, sharedGroup) };

  // A group with one owner is left alone.
  const { person: solo } = await ctx.newPerson({ ownerId: carol.id, createdAt: at(4) });
  const soloFace = await face(carol.id, solo.personGroupId);

  return { alice, bob, carol, group, sharedGroup, soloGroup: solo.personGroupId, recognizedFaces, sharedFaces, soloFace };
};

// The upstream state the round trip must restore. updatedAt/updateId are left out: moving a row bumps them,
// which is what makes sync pick it up.
const snapshot = async () => ({
  person: await db
    .selectFrom('person')
    .select(['ownerId', 'personGroupId', 'name', 'birthDate', 'isHidden', 'isFavorite', 'thumbnailPath', 'color', 'faceAssetId', 'createdAt'])
    .orderBy(['personGroupId', 'ownerId'])
    .execute(),
  faces: await db.selectFrom('asset_face').select(['id', 'personGroupId']).orderBy('id').execute(),
  shares: await db.selectFrom('person_user').selectAll().orderBy(['personGroupId', 'sharedById', 'sharedWithId']).execute(),
  groups: await db.selectFrom('person_group').select(['id', 'clusterGroupId']).orderBy('id').execute(),
  users: await db.selectFrom('user').select(['id', 'clusterGroupId']).orderBy('id').execute(),
});

const groupOf = async (ownerId: string, faceId: string) => {
  const { personGroupId } = await db
    .selectFrom('asset_face')
    .select('personGroupId')
    .where('id', '=', faceId)
    .executeTakeFirstOrThrow();
  const person = await db
    .selectFrom('person')
    .select(['personGroupId', 'name', 'isHidden', 'isFavorite'])
    .where('ownerId', '=', ownerId)
    .where('personGroupId', '=', personGroupId!)
    .executeTakeFirst();
  return { personGroupId, person };
};

describe('1790900000000-SplitSharedPersonGroups', () => {
  it('splits every multi-owner group one per owner, and down() restores it exactly', async () => {
    const { alice, bob, carol, group, sharedGroup, soloGroup, recognizedFaces, sharedFaces, soloFace } = await seed();
    const before = await snapshot();
    expect(before.shares).toHaveLength(2);

    await splitMigration.up(db);

    // One row per group, so 1791000000000's index holds.
    await expect(
      sql`SELECT "personGroupId" FROM "person" GROUP BY "personGroupId" HAVING count(*) > 1`.execute(db),
    ).resolves.toMatchObject({ rows: [] });
    await sql`CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId")`.execute(db);
    await sql`DROP INDEX "person_personGroupId_key"`.execute(db);

    // The oldest row keeps the group; the others move with the faces on their own assets.
    await expect(groupOf(alice.id, recognizedFaces.alice)).resolves.toEqual({
      personGroupId: group,
      person: { personGroupId: group, name: 'Grandma', isHidden: false, isFavorite: true },
    });
    const bobSplit = await groupOf(bob.id, recognizedFaces.bob);
    expect(bobSplit.personGroupId).not.toBe(group);
    expect(bobSplit.person).toMatchObject({ name: 'Oma', isHidden: true });
    await expect(groupOf(alice.id, recognizedFaces.carol)).resolves.toMatchObject({ personGroupId: group });
    await expect(groupOf(bob.id, sharedFaces.bob)).resolves.toMatchObject({ personGroupId: sharedGroup });
    const aliceShared = await groupOf(alice.id, sharedFaces.alice);
    expect(aliceShared.personGroupId).not.toBe(sharedGroup);
    expect(aliceShared.person).toMatchObject({ name: '' });
    await expect(groupOf(carol.id, soloFace)).resolves.toMatchObject({ personGroupId: soloGroup });

    // Carol's copy of the shared person has no face on her photos: it is parked whole, not moved to an empty
    // group that the nightly PersonCleanup would delete.
    const splits = await db.selectFrom('person_group_split').selectAll().execute();
    expect(splits.map(({ originalGroupId, ownerId }) => ({ originalGroupId, ownerId }))).toEqual(
      expect.arrayContaining([
        { originalGroupId: group, ownerId: bob.id },
        { originalGroupId: sharedGroup, ownerId: alice.id },
      ]),
    );
    expect(splits).toHaveLength(2);
    const carolBefore = before.person.find(
      ({ ownerId, personGroupId }) => ownerId === carol.id && personGroupId === sharedGroup,
    )!;
    await expect(db.selectFrom('person_group_split_person').selectAll().execute()).resolves.toEqual([
      expect.objectContaining({ ownerId: carol.id, personGroupId: sharedGroup, name: carolBefore.name }),
    ]);
    await expect(
      db.selectFrom('person').select('ownerId').where('ownerId', '=', carol.id).where('personGroupId', '=', sharedGroup).execute(),
    ).resolves.toEqual([]);
    const clusterGroups = await db
      .selectFrom('person_group')
      .select('clusterGroupId')
      .where('id', 'in', splits.map(({ splitGroupId }) => splitGroupId))
      .execute();
    expect(clusterGroups).toEqual(splits.map(() => ({ clusterGroupId: alice.clusterGroupId })));
    await expect(db.selectFrom('person_user').selectAll().execute()).resolves.toEqual([]);
    await expect(db.selectFrom('person_group_split_share').selectAll().execute()).resolves.toHaveLength(2);
    const audit = await db.selectFrom('person_audit').select(['personGroupId', 'ownerId']).execute();
    expect(audit).toEqual(
      expect.arrayContaining([
        { personGroupId: group, ownerId: bob.id },
        { personGroupId: sharedGroup, ownerId: alice.id },
        { personGroupId: sharedGroup, ownerId: carol.id },
      ]),
    );

    // Idempotent: nothing is left to split.
    await splitMigration.up(db);
    await expect(db.selectFrom('person_group_split').selectAll().execute()).resolves.toHaveLength(2);
    await expect(db.selectFrom('person_group_split_person').selectAll().execute()).resolves.toHaveLength(1);

    await splitMigration.down(db);

    await expect(snapshot()).resolves.toEqual(before);
    await expect(sql`SELECT to_regclass('person_group_split') AS t`.execute(db)).resolves.toMatchObject({
      rows: [{ t: null }],
    });
  });

  it("survives Gallery's nightly PersonCleanup, and down() still restores everything", async () => {
    await seed();
    const before = await snapshot();
    await splitMigration.up(db);

    // The nightly job deletes people with no visible face; nothing the split leaves behind may qualify.
    const { sut } = newMediumService(PersonService, {
      database: db,
      real: [PersonRepository, SharedSpaceRepository],
      mock: [JobRepository, LoggingRepository],
    });
    const people = await db.selectFrom('person').select(['ownerId', 'personGroupId']).execute();
    await expect(sut.handlePersonCleanup()).resolves.toBe(JobStatus.Success);
    await expect(db.selectFrom('person').select(['ownerId', 'personGroupId']).execute()).resolves.toEqual(
      expect.arrayContaining(people),
    );
    await expect(db.selectFrom('person').select('ownerId').execute()).resolves.toHaveLength(people.length);

    await splitMigration.down(db);
    await expect(snapshot()).resolves.toEqual(before);
  });

  it('leaves a person deleted while on Gallery deleted, and drops the shares that named it', async () => {
    const { alice, bob, carol, sharedGroup, sharedFaces } = await seed();

    await splitMigration.up(db);
    const aliceShared = await groupOf(alice.id, sharedFaces.alice);
    await db
      .deleteFrom('person')
      .where('ownerId', '=', alice.id)
      .where('personGroupId', '=', aliceShared.personGroupId!)
      .execute();

    await splitMigration.down(db);

    const people = await db
      .selectFrom('person')
      .select('ownerId')
      .where('personGroupId', '=', sharedGroup)
      .orderBy('ownerId')
      .execute();
    expect(people.map(({ ownerId }) => ownerId).sort()).toEqual([bob.id, carol.id].sort());
    // Alice's faces stay where her person left them; no share survives without both of its rows.
    await expect(groupOf(alice.id, sharedFaces.alice)).resolves.toMatchObject({
      personGroupId: aliceShared.personGroupId,
    });
    await expect(db.selectFrom('person_user').selectAll().execute()).resolves.toEqual([]);
  });

  it('is undone by the rejoin block in scripts/revert-to-immich.sql', async () => {
    await seed();
    const before = await snapshot();
    await splitMigration.up(db);
    // As on a Gallery database: 1791000000000 has put the index back.
    await sql`CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId")`.execute(db);

    const script = readFileSync(join(process.cwd(), '..', 'scripts', 'revert-to-immich.sql'), 'utf8');
    const start = script.indexOf('DROP INDEX IF EXISTS "person_personGroupId_key";');
    const end = script.indexOf('END $$;', start) + 'END $$;'.length;
    expect(start).toBeGreaterThan(-1);
    await sql.raw(script.slice(start, end)).execute(db);

    await expect(snapshot()).resolves.toEqual(before);
    await expect(db.selectFrom('person_group_split').selectAll().execute()).resolves.toEqual([]);
  });

  it('does nothing on a database with one row per group', async () => {
    const ctx = new SyncTestContext(db);
    const { user } = await ctx.newUser();
    await ctx.newPerson({ ownerId: user.id });
    const before = await snapshot();

    await splitMigration.up(db);

    await expect(snapshot()).resolves.toEqual(before);
    await expect(db.selectFrom('person_group_split').selectAll().execute()).resolves.toEqual([]);
    await expect(db.selectFrom('person_audit').selectAll().execute()).resolves.toEqual([]);

    // A Gallery database applied this migration last and undoes it first, with the index still in place.
    await sql`CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId")`.execute(db);
    await splitMigration.down(db);
    await expect(snapshot()).resolves.toEqual(before);
    await expect(sql`SELECT to_regclass('person_group_split') AS t`.execute(db)).resolves.toMatchObject({
      rows: [{ t: null }],
    });
  });

  it('refuses to undo while groups are split and the one-row-per-group index exists', async () => {
    await seed();
    await splitMigration.up(db);
    await sql`CREATE UNIQUE INDEX "person_personGroupId_key" ON "person" ("personGroupId")`.execute(db);
    const before = await snapshot();

    await expect(splitMigration.down(db)).rejects.toThrow(
      'Cannot rejoin split person groups while person_personGroupId_key exists',
    );
    await expect(snapshot()).resolves.toEqual(before);
  });
});
