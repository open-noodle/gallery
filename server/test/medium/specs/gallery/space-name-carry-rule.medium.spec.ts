/**
When a name or birthday crosses between spaces (#1317, specs/2026-11-22-cross-account-identity-joins-design.md).

A value typed into one space reaches another only while the person who typed it is a member of that other space and
shares person names there. A personal alias never crosses, a person their owner hid lends nothing, and an inherited copy
is never a source, so two spaces cannot keep a value alive after its original is gone.
*/
import { Kysely } from 'kysely';
import { SharedSpaceRole, SourceType } from 'src/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

afterAll(async () => {
  await defaultDatabase.destroy();
});

const setup = () => {
  const { sut, ctx } = newMediumService(SharedSpaceService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      ConfigRepository,
      DatabaseRepository,
      FaceIdentityRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  return { sut, ctx };
};

/** A person in two spaces. `adder` added the photo to both; `namer` belongs to the first and maybe the second. */
const buildWorld = async (input: { namerInTarget: boolean }) => {
  const { sut, ctx } = setup();
  const { user: adder } = await ctx.newUser();
  const { user: namer } = await ctx.newUser();
  const { space: source } = await ctx.newSharedSpace({ createdById: adder.id, faceRecognitionEnabled: true });
  const { space: target } = await ctx.newSharedSpace({ createdById: adder.id, faceRecognitionEnabled: true });
  await ctx.newSharedSpaceMember({ spaceId: source.id, userId: adder.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: target.id, userId: adder.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: source.id, userId: namer.id, role: SharedSpaceRole.Editor });
  if (input.namerInTarget) {
    await ctx.newSharedSpaceMember({ spaceId: target.id, userId: namer.id, role: SharedSpaceRole.Editor });
  }

  const { person } = await ctx.newPerson({ ownerId: adder.id, name: '' });
  const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(person.personGroupId);
  const { asset } = await ctx.newAsset({ ownerId: adder.id });
  const { assetFace } = await ctx.newAssetFace({
    assetId: asset.id,
    personGroupId: person.personGroupId,
    sourceType: SourceType.MachineLearning,
  });
  await ctx.get(FaceIdentityRepository).linkFace({
    assetFaceId: assetFace.id,
    identityId: identity.id,
    source: 'owner-person',
  });
  await ctx.newSharedSpaceAsset({ spaceId: source.id, assetId: asset.id, addedById: adder.id });
  await ctx.newSharedSpaceAsset({ spaceId: target.id, assetId: asset.id, addedById: adder.id });

  const addSpacePerson = async (spaceId: string) => {
    const row = await ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId, identityId: identity.id, representativeFaceId: assetFace.id, type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await ctx.database
      .insertInto('shared_space_person_face')
      .values({ personId: row.id, assetFaceId: assetFace.id })
      .execute();
    return row.id;
  };
  const sourcePersonId = await addSpacePerson(source.id);
  const targetPersonId = await addSpacePerson(target.id);

  const authOf = (user: typeof namer) => factory.auth({ user: { id: user.id, name: user.name, email: user.email } });
  const backfill = () => sut.backfillSpacePersonMetadata({ identityId: identity.id, limit: 1000 });
  const targetRow = () =>
    ctx.database
      .selectFrom('shared_space_person')
      .select(['name', 'nameSource', 'birthDate'])
      .where('id', '=', targetPersonId)
      .executeTakeFirstOrThrow();
  return {
    sut,
    ctx,
    adder,
    namer,
    source,
    target,
    person,
    sourcePersonId,
    targetPersonId,
    authOf,
    backfill,
    targetRow,
  };
};

describe('names crossing between spaces (#1317)', () => {
  it('carries a name when the person who typed it is in the other space', async () => {
    const w = await buildWorld({ namerInTarget: true });
    await w.sut.updateSpacePerson(w.authOf(w.namer), w.source.id, w.sourcePersonId, {
      name: 'Sam',
      birthDate: '1990-01-02',
    });

    await w.backfill();

    const carried = await w.targetRow();
    expect(carried).toMatchObject({ name: 'Sam', nameSource: 'inherited' });
    expect(String(carried.birthDate)).toContain('1990');
  });

  it('does not carry a name when the person who typed it is not in the other space', async () => {
    const w = await buildWorld({ namerInTarget: false });
    await w.sut.updateSpacePerson(w.authOf(w.namer), w.source.id, w.sourcePersonId, {
      name: 'Sam',
      birthDate: '1990-01-02',
    });

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none', birthDate: null });
  });

  it('removes the carried name after the person who typed it leaves the other space', async () => {
    const w = await buildWorld({ namerInTarget: true });
    await w.sut.updateSpacePerson(w.authOf(w.namer), w.source.id, w.sourcePersonId, { name: 'Sam' });
    await w.backfill();

    await w.ctx.database
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', w.target.id)
      .where('userId', '=', w.namer.id)
      .execute();
    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none' });
  });

  it('does not carry a name typed before authors were recorded', async () => {
    const w = await buildWorld({ namerInTarget: true });
    await w.ctx.database
      .updateTable('shared_space_person')
      .set({ name: 'Sam', nameSource: 'manual' })
      .where('id', '=', w.sourcePersonId)
      .execute();

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none' });
  });

  it('never publishes a personal alias', async () => {
    const w = await buildWorld({ namerInTarget: true });
    await w.ctx.database
      .insertInto('shared_space_person_alias')
      .values({ personId: w.sourcePersonId, userId: w.adder.id, alias: 'Private alias' })
      .execute();

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none' });
  });

  it('clears copies that were keeping each other alive between two spaces', async () => {
    const w = await buildWorld({ namerInTarget: true });
    for (const [id, otherId] of [
      [w.sourcePersonId, w.targetPersonId],
      [w.targetPersonId, w.sourcePersonId],
    ]) {
      await w.ctx.database
        .updateTable('shared_space_person')
        .set({
          name: 'Stale alias',
          nameSource: 'inherited',
          nameSourceProfileType: 'space-person',
          nameSourceProfileId: otherId,
        })
        .where('id', '=', id)
        .execute();
    }

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none' });
  });

  it('stops lending a name from a person their owner hid, in every space', async () => {
    const w = await buildWorld({ namerInTarget: true });
    await w.ctx.database
      .updateTable('person')
      .set({ name: 'Owner name', birthDate: '1980-03-04' })
      .where('personGroupId', '=', w.person.personGroupId)
      .execute();
    await w.backfill();
    await expect(w.targetRow()).resolves.toMatchObject({ name: 'Owner name' });

    await w.ctx.database
      .updateTable('person')
      .set({ isHidden: true })
      .where('personGroupId', '=', w.person.personGroupId)
      .execute();
    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: '', nameSource: 'none', birthDate: null });
  });

  it('keeps a name someone typed directly into the space', async () => {
    const w = await buildWorld({ namerInTarget: false });
    await w.sut.updateSpacePerson(w.authOf(w.adder), w.target.id, w.targetPersonId, { name: 'Typed here' });

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: 'Typed here', nameSource: 'manual' });
  });
});
