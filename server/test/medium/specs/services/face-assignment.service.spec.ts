import { Kysely } from 'kysely';
import { SourceType } from 'src/enum.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { FacePersonVerdictRepository } from 'src/repositories/face-person-verdict.repository.js';
import { FaceRepairDeclineRepository } from 'src/repositories/face-repair-decline.repository.js';
import { FaceRepairRepository } from 'src/repositories/face-repair.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { FaceAssignmentService } from 'src/services/face-assignment.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const BAND = { maxDistance: 0.5, suggestionMaxDistance: 0.8 };

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      DatabaseRepository,
      FaceIdentityRepository,
      FacePersonVerdictRepository,
      FaceRepairDeclineRepository,
      FaceRepairRepository,
      PersonRepository,
    ],
    mock: [LoggingRepository],
  });
  const sut = new FaceAssignmentService({
    databaseRepository: ctx.get(DatabaseRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    facePersonVerdictRepository: ctx.get(FacePersonVerdictRepository),
    faceRepairDeclineRepository: ctx.get(FaceRepairDeclineRepository),
    faceRepairRepository: ctx.get(FaceRepairRepository),
    personRepository: ctx.get(PersonRepository),
  });
  return { ctx, sut, verdicts: ctx.get(FacePersonVerdictRepository), identities: ctx.get(FaceIdentityRepository) };
};

// One owner, a target person P (with an identity), a source person A, an unrelated person Q, and one face
// sitting on A with a pending suggestion for B and two negative verdicts: one against P, one against Q.
const fixture = async () => {
  const { ctx, sut, verdicts, identities } = setup();
  const { user } = await ctx.newUser();
  const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'P' });
  const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'A' });
  const { person: other } = await ctx.newPerson({ ownerId: user.id, name: 'Q' });
  const { person: suggested } = await ctx.newPerson({ ownerId: user.id, name: 'B' });
  const { asset } = await ctx.newAsset({ ownerId: user.id });
  const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: source.personGroupId });
  const identity = await identities.ensurePersonIdentity(target.personGroupId);
  await verdicts.upsertPending([{ personGroupId: suggested.personGroupId, assetFaceId: face.id, distance: 0.6 }]);
  await verdicts.markRejected(target.personGroupId, face.id, { identityId: identity.id });
  await verdicts.markRejected(other.personGroupId, face.id);
  return { ctx, sut, user, target, source, other, face, identity };
};

const placement = (ctx: ReturnType<typeof setup>['ctx'], faceId: string) =>
  Promise.all([
    ctx.database.selectFrom('asset_face').select('personGroupId').where('id', '=', faceId).executeTakeFirstOrThrow(),
    ctx.database
      .selectFrom('face_identity_face')
      .select(['identityId', 'source'])
      .where('assetFaceId', '=', faceId)
      .executeTakeFirst(),
    ctx.database
      .selectFrom('face_person_verdict')
      .select(['personGroupId', 'status'])
      .where('assetFaceId', '=', faceId)
      .orderBy('status')
      .execute(),
  ]).then(([face, link, verdicts]) => ({ personGroupId: face.personGroupId, link, verdicts }));

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(FaceAssignmentService.name, () => {
  describe('assignFaces', () => {
    it('moves the face, links it manually, drains pending, and clears negatives for the target only', async () => {
      const { ctx, sut, target, other, face, identity } = await fixture();

      await expect(
        sut.assignFaces({ personGroupId: target.personGroupId, faceIds: [face.id], strength: 'manual' }),
      ).resolves.toEqual([face.id]);

      expect(await placement(ctx, face.id)).toEqual({
        personGroupId: target.personGroupId,
        link: { identityId: identity.id, source: 'manual' },
        // The pending suggestion is drained and the "not P" verdict is gone; "not Q" survives.
        verdicts: [{ personGroupId: other.personGroupId, status: 'rejected' }],
      });
    });

    it('writes an ordinary (owner-person) link when asked to', async () => {
      const { ctx, sut, target, source, face, identity } = await fixture();

      await sut.assignFaces({
        personGroupId: target.personGroupId,
        faceIds: [face.id],
        strength: 'owner-person',
        from: source.personGroupId,
      });

      const { personGroupId, link } = await placement(ctx, face.id);
      expect(personGroupId).toBe(target.personGroupId);
      // B2: an unlocked move still re-points the identity at the target; only the strength differs.
      expect(link).toEqual({ identityId: identity.id, source: 'owner-person' });
    });

    it('with `from`, leaves a face that is no longer on `from` untouched', async () => {
      const { ctx, sut, target, other, face } = await fixture();
      const before = await placement(ctx, face.id);

      await expect(
        sut.assignFaces({
          personGroupId: target.personGroupId,
          faceIds: [face.id],
          strength: 'manual',
          from: other.personGroupId,
        }),
      ).resolves.toEqual([]);

      expect(await placement(ctx, face.id)).toEqual(before);
    });

    it('in place (`from` = the target) links only faces still on the target', async () => {
      const { ctx, sut, target, face, identity } = await fixture();
      const { asset } = await ctx.newAsset({ ownerId: target.ownerId });
      const { assetFace: onTarget } = await ctx.newAssetFace({
        assetId: asset.id,
        personGroupId: target.personGroupId,
      });

      await expect(
        sut.assignFaces({
          personGroupId: target.personGroupId,
          faceIds: [onTarget.id, face.id],
          strength: 'manual',
          from: target.personGroupId,
        }),
      ).resolves.toEqual([onTarget.id]);

      const [placed, raced] = await Promise.all([placement(ctx, onTarget.id), placement(ctx, face.id)]);
      expect(placed.link).toEqual({ identityId: identity.id, source: 'manual' });
      expect(raced.link).toBeUndefined();
    });

    it('in place with `movableOnly` leaves a hand-drawn face untouched', async () => {
      const { ctx, sut, target, identity } = await fixture();
      const { asset } = await ctx.newAsset({ ownerId: target.ownerId });
      const [{ assetFace: detected }, { assetFace: drawn }] = await Promise.all([
        ctx.newAssetFace({ assetId: asset.id, personGroupId: target.personGroupId }),
        ctx.newAssetFace({ assetId: asset.id, personGroupId: target.personGroupId, sourceType: SourceType.Manual }),
      ]);

      await expect(
        sut.assignFaces({
          personGroupId: target.personGroupId,
          faceIds: [detected.id, drawn.id],
          strength: 'owner-person',
          from: target.personGroupId,
          movableOnly: true,
        }),
      ).resolves.toEqual([detected.id]);

      const [relinked, untouched] = await Promise.all([placement(ctx, detected.id), placement(ctx, drawn.id)]);
      expect(relinked.link).toEqual({ identityId: identity.id, source: 'owner-person' });
      expect(untouched.link).toBeUndefined();
    });

    it('is atomic: a failure on the last write leaves nothing written', async () => {
      const { ctx, sut, target, face } = await fixture();
      const before = await placement(ctx, face.id);
      vi.spyOn(ctx.get(FacePersonVerdictRepository), 'clearNegativeForTarget').mockRejectedValueOnce(
        new Error('clear failed'),
      );

      await expect(
        sut.assignFaces({ personGroupId: target.personGroupId, faceIds: [face.id], strength: 'manual' }),
      ).rejects.toThrow('clear failed');

      expect(await placement(ctx, face.id)).toEqual(before);
    });

    it("joins the caller's transaction and rolls back with it", async () => {
      const { ctx, sut, target, face } = await fixture();
      const before = await placement(ctx, face.id);

      await expect(
        ctx.get(DatabaseRepository).transaction(async (trx) => {
          await sut.assignFaces({ personGroupId: target.personGroupId, faceIds: [face.id], strength: 'manual' }, trx);
          throw new Error('caller failed');
        }),
      ).rejects.toThrow('caller failed');

      expect(await placement(ctx, face.id)).toEqual(before);
    });
  });

  // The suggestion engine decides "already settled for this target" in TS (getSettledFaceIds over
  // isSettledForOwner); the confirm claim decides it in SQL (claimPending's eligibility gate), because the
  // claim has to be one DELETE on the caller's transaction. Same fixture, both sides must agree.
  describe('settlement: claimPending (SQL) agrees with getSettledFaceIds (TS)', () => {
    type Arrange = (args: {
      ctx: ReturnType<typeof setup>['ctx'];
      faceId: string;
      identityId: string;
      ownerId: string;
    }) => Promise<unknown>;

    const scenarios: Array<[string, boolean, Arrange]> = [
      ['no verdict', false, () => Promise.resolve()],
      [
        'rejected against the target identity',
        true,
        ({ ctx, faceId, identityId }) =>
          ctx.database
            .insertInto('face_person_verdict')
            .values({ assetFaceId: faceId, identityId, status: 'rejected', source: 'cleanup' })
            .execute(),
      ],
      [
        'ignored against the target identity, recorded on another person',
        true,
        async ({ ctx, faceId, identityId, ownerId }) => {
          const { person } = await ctx.newPerson({ ownerId, name: 'Twin' });
          await ctx.get(FacePersonVerdictRepository).markIgnored(person.personGroupId, faceId, { identityId });
        },
      ],
      [
        'rejected against a different person',
        false,
        async ({ ctx, faceId, ownerId }) => {
          const { person } = await ctx.newPerson({ ownerId, name: 'Other' });
          await ctx.get(FacePersonVerdictRepository).markRejected(person.personGroupId, faceId);
        },
      ],
      [
        'manually linked to another identity',
        true,
        async ({ ctx, faceId, ownerId }) => {
          const { person } = await ctx.newPerson({ ownerId, name: 'Placed' });
          const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(person.personGroupId);
          await ctx
            .get(FaceIdentityRepository)
            .replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'manual' });
        },
      ],
      [
        'ordinarily linked to another identity',
        false,
        async ({ ctx, faceId, ownerId }) => {
          const { person } = await ctx.newPerson({ ownerId, name: 'Clustered' });
          const identity = await ctx.get(FaceIdentityRepository).ensurePersonIdentity(person.personGroupId);
          await ctx
            .get(FaceIdentityRepository)
            .replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'owner-person' });
        },
      ],
    ];

    it.each(scenarios)('%s (settled: %s)', async (_name, settled, arrange) => {
      const { ctx, sut, verdicts, identities } = setup();
      const { user } = await ctx.newUser();
      const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Target' });
      const identity = await identities.ensurePersonIdentity(target.personGroupId);
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { assetFace: face } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: null });
      await verdicts.upsertPending([{ personGroupId: target.personGroupId, assetFaceId: face.id, distance: 0.6 }]);
      await arrange({ ctx, faceId: face.id, identityId: identity.id, ownerId: user.id });

      const settledTs = await sut.getSettledFaceIds([face.id], {
        personGroupId: target.personGroupId,
        identityId: identity.id,
      });
      const claimed = await verdicts.claimPending(target.personGroupId, face.id, BAND);

      expect(settledTs.has(face.id)).toBe(settled);
      expect(claimed === 0).toBe(settled);
    });
  });
});
