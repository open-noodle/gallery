/**
When a name or birthday crosses between spaces (#1317, specs/2026-11-22-cross-account-identity-joins-design.md).

A value typed into one space reaches another only while the person who typed it is a member of that other space and
shares person names there. A personal alias never crosses, a person their owner hid still lends, and an inherited copy
is never a source, so two spaces cannot keep a value alive after its original is gone.
*/
import { Kysely } from 'kysely';
import { SharedSpaceRole, SourceType } from 'src/enum.js';
import { FaceSearchRepository } from 'src/gallery/repositories/face-search.repository.js';
import { QueueMaintenanceRepository } from 'src/gallery/repositories/queue-maintenance.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { DB } from 'src/schema/index.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newEmbedding } from 'test/small.factory.js';
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
      FacePersonVerdictRepository,
      FaceSearchRepository,
      PersonRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
    ],
    mock: [JobRepository, LoggingRepository, QueueMaintenanceRepository],
  });
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(QueueMaintenanceRepository).hasInFlightDedupChain.mockResolvedValue(false);
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
    faceId: assetFace.id,
    sourcePersonId,
    targetPersonId,
    authOf,
    backfill,
    targetRow,
  };
};

const sourceRow = (w: Awaited<ReturnType<typeof buildWorld>>, id: string) =>
  w.ctx.database
    .selectFrom('shared_space_person')
    .select(['name', 'nameSource', 'nameSetById'])
    .where('id', '=', id)
    .executeTakeFirstOrThrow();

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

  // Owner decision (2026-11-25): hiding a person only tidies its owner's own People page; the name it lent stays.
  it('keeps lending a name after its owner hides the person', async () => {
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

    await expect(w.targetRow()).resolves.toMatchObject({
      name: 'Owner name',
      nameSource: 'inherited',
      birthDate: new Date('1980-03-04'),
    });
  });

  it('keeps a name someone typed directly into the space', async () => {
    const w = await buildWorld({ namerInTarget: false });
    await w.sut.updateSpacePerson(w.authOf(w.adder), w.target.id, w.targetPersonId, { name: 'Typed here' });

    await w.backfill();

    await expect(w.targetRow()).resolves.toMatchObject({ name: 'Typed here', nameSource: 'manual' });
  });

  describe('a name typed when creating a space person', () => {
    it('records who typed it and carries it into another space they are in', async () => {
      const w = await buildWorld({ namerInTarget: true });
      const created = await w.sut.createSpacePerson(w.authOf(w.namer), w.source.id, {
        name: 'Sam',
        assetFaceId: w.faceId,
      });

      await w.backfill();

      await expect(sourceRow(w, created.id)).resolves.toEqual({
        name: 'Sam',
        nameSource: 'manual',
        nameSetById: w.namer.id,
      });
      await expect(w.targetRow()).resolves.toMatchObject({ name: 'Sam', nameSource: 'inherited' });
    });

    it("is not replaced by the photo owner's own name", async () => {
      const w = await buildWorld({ namerInTarget: true });
      const created = await w.sut.createSpacePerson(w.authOf(w.namer), w.source.id, {
        name: 'Sam',
        assetFaceId: w.faceId,
      });
      await w.ctx.database
        .updateTable('person')
        .set({ name: 'Owner name' })
        .where('personGroupId', '=', w.person.personGroupId)
        .execute();

      await w.backfill();

      await expect(sourceRow(w, created.id)).resolves.toMatchObject({ name: 'Sam', nameSource: 'manual' });
    });

    it('records who typed it for a person created without a face', async () => {
      const w = await buildWorld({ namerInTarget: true });
      const created = await w.sut.createSpacePerson(w.authOf(w.namer), w.source.id, { name: 'Sam' });

      await expect(sourceRow(w, created.id)).resolves.toEqual({
        name: 'Sam',
        nameSource: 'manual',
        nameSetById: w.namer.id,
      });
    });

    it('keeps the name and author of a person someone already named', async () => {
      const w = await buildWorld({ namerInTarget: true });
      await w.sut.updateSpacePerson(w.authOf(w.adder), w.source.id, w.sourcePersonId, { name: 'First' });

      const created = await w.sut.createSpacePerson(w.authOf(w.namer), w.source.id, {
        name: 'Second',
        assetFaceId: w.faceId,
      });

      expect(created.id).toBe(w.sourcePersonId);
      await expect(sourceRow(w, created.id)).resolves.toEqual({
        name: 'First',
        nameSource: 'manual',
        nameSetById: w.adder.id,
      });
    });
  });

  it('keeps who typed a name when duplicate space people are folded together', async () => {
    const w = await buildWorld({ namerInTarget: true });
    const embedding = newEmbedding();
    // Two space people in the source space for one face shape: the unnamed one has more faces and survives.
    const addFace = async (spacePersonId: string) => {
      const { asset } = await w.ctx.newAsset({ ownerId: w.adder.id });
      const { person } = await w.ctx.newPerson({ ownerId: w.adder.id, name: '' });
      const { assetFace } = await w.ctx.newAssetFace({
        assetId: asset.id,
        personGroupId: person.personGroupId,
        sourceType: SourceType.MachineLearning,
      });
      await w.ctx.database.insertInto('face_search').values({ faceId: assetFace.id, embedding }).execute();
      await w.ctx.newSharedSpaceAsset({ spaceId: w.source.id, assetId: asset.id, addedById: w.adder.id });
      await w.ctx.database
        .insertInto('shared_space_person_face')
        .values({ personId: spacePersonId, assetFaceId: assetFace.id })
        .execute();
      return assetFace.id;
    };
    const named = await w.ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: w.source.id, type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const namedFace = await addFace(named.id);
    await w.ctx.database
      .updateTable('shared_space_person')
      .set({ representativeFaceId: namedFace })
      .where('id', '=', named.id)
      .execute();
    await w.sut.updateSpacePerson(w.authOf(w.namer), w.source.id, named.id, { name: 'Sam' });
    const unnamed = await w.ctx.database
      .insertInto('shared_space_person')
      .values({ spaceId: w.source.id, type: 'person' })
      .returning('id')
      .executeTakeFirstOrThrow();
    const unnamedFace = await addFace(unnamed.id);
    await addFace(unnamed.id);
    await addFace(unnamed.id);
    await w.ctx.database
      .updateTable('shared_space_person')
      .set({ representativeFaceId: unnamedFace })
      .where('id', '=', unnamed.id)
      .execute();

    await w.sut.handleSharedSpacePersonDedup({ spaceId: w.source.id });

    const rows = await w.ctx.database
      .selectFrom('shared_space_person')
      .select(['id', 'name', 'nameSource', 'nameSetById'])
      .where('id', 'in', [named.id, unnamed.id])
      .execute();
    expect(rows).toEqual([{ id: unnamed.id, name: 'Sam', nameSource: 'manual', nameSetById: w.namer.id }]);
  });
});
