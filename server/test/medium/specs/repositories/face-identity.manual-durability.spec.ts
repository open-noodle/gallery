import { Kysely } from 'kysely';
import { SourceType } from 'src/enum';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { DB } from 'src/schema';
import { FaceIdentityFaceSource } from 'src/schema/tables/face-identity-face.table';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

// Slice 1 of the face-review unification: the load-bearing assumption.
//
// The unified design retires `face_repair_lock` and treats `face_identity_face.source = 'manual'` as THE
// durable record that a human placed a face on a person. Both engines then exclude manually-linked faces
// from their queues. That is only sound if a manual link cannot be silently downgraded by background work.
//
// `FaceIdentityBackfill` is the risk: `realignFacesToPersonIdentity` writes
// `.set({ identityId, source: 'backfill' })` unconditionally, so any face whose link identity has drifted
// away from its person's identity gets its `source` rewritten — manual included. These tests pin the
// behaviour down. If they cannot be made to pass, retiring the lock table is invalid.
let db: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [PersonRepository, FaceIdentityRepository],
    mock: [LoggingRepository],
  });
  return {
    ctx,
    personRepository: ctx.get(PersonRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
  };
};

type Ctx = ReturnType<typeof setup>['ctx'];

beforeAll(async () => {
  db = await getKyselyDB();
});

const seedFace = async (ctx: Ctx, ownerId: string, personId: string): Promise<string> => {
  const { asset } = await ctx.newAsset({ ownerId });
  const { assetFace } = await ctx.newAssetFace({ assetId: asset.id, personGroupId: personId, sourceType: SourceType.MachineLearning });
  return assetFace.id;
};

const linkRowFor = (assetFaceId: string) =>
  db
    .selectFrom('face_identity_face')
    .select(['assetFaceId', 'identityId', 'source'])
    .where('assetFaceId', '=', assetFaceId)
    .executeTakeFirst();

const linkRowsFor = (assetFaceId: string) =>
  db.selectFrom('face_identity_face').selectAll().where('assetFaceId', '=', assetFaceId).execute();

// Direct-insert a face_identity_face row with an exact source, bypassing linkFace/replaceFaceIdentity so the
// fixture can plant a state (e.g. a pre-existing 'manual' link on a face about to be swept up by an
// automatic merge) that those methods would not themselves produce.
const insertLinkRow = (assetFaceId: string, identityId: string, source: FaceIdentityFaceSource) =>
  db.insertInto('face_identity_face').values({ assetFaceId, identityId, source }).execute();

// Drain the personal backfill the way the job does — page until there is no cursor left.
const runPersonalBackfill = async (faceIdentityRepository: FaceIdentityRepository) => {
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await faceIdentityRepository.backfillPersonalIdentities({ cursor, limit: 100 });
    if (!result.nextCursor) {
      return;
    }
    cursor = result.nextCursor;
  }
  throw new Error('personal backfill did not converge');
};

describe('face_identity_face.source=manual durability (Slice 1 — load-bearing assumption)', () => {
  it('survives a full FaceIdentityBackfill pass when the link is aligned with its person', async () => {
    const { ctx, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const faceId = await seedFace(ctx, user.id, person.personGroupId);

    const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: identity.id,
      source: 'manual',
    });

    await runPersonalBackfill(faceIdentityRepository);

    const row = await linkRowFor(faceId);
    expect(row).toBeDefined();
    expect(row?.identityId).toBe(identity.id);
    expect(row?.source).toBe('manual');
  });

  it('survives a backfill realign when the link identity has drifted from its person', async () => {
    // The direct probe at `realignFacesToPersonIdentity`: the face sits on `person` but its link points at
    // an unrelated identity that no person of this owner references, so the backfill takes the "stranded"
    // branch and realigns it. Realigning WHICH human the face is linked to is correct; erasing the fact
    // that a HUMAN placed it is not.
    const { ctx, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const faceId = await seedFace(ctx, user.id, person.personGroupId);

    const personIdentity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    const stranded = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: stranded.id,
      source: 'manual',
    });

    await runPersonalBackfill(faceIdentityRepository);

    const row = await linkRowFor(faceId);
    expect(row).toBeDefined();
    // Realigned onto the person's own identity...
    expect(row?.identityId).toBe(personIdentity.id);
    // ...but the human placement must survive.
    expect(row?.source).toBe('manual');
  });

  it('survives a people merge followed by a backfill', async () => {
    const { ctx, personRepository, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person: source } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const { person: target } = await ctx.newPerson({ ownerId: user.id, name: 'Anna dup' });
    const faceId = await seedFace(ctx, user.id, source.personGroupId);

    const sourceIdentity = await faceIdentityRepository.ensurePersonIdentity(source.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: sourceIdentity.id,
      source: 'manual',
    });

    const targetIdentity = await faceIdentityRepository.ensurePersonIdentity(target.personGroupId);
    await personRepository.mergePersonProfile({
      sourcePersonId: source.personGroupId,
      targetPersonId: target.personGroupId,
      targetIdentityId: targetIdentity.id,
    });

    await runPersonalBackfill(faceIdentityRepository);

    const row = await linkRowFor(faceId);
    expect(row).toBeDefined();
    expect(row?.source).toBe('manual');
  });

  it('re-affirming an existing link is an idempotent source-only update', async () => {
    const { ctx, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const faceId = await seedFace(ctx, user.id, person.personGroupId);

    const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({ assetFaceId: faceId, identityId: identity.id, source: 'ml' });

    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: identity.id,
      source: 'manual',
    });

    const rows = await linkRowsFor(faceId);
    expect(rows).toHaveLength(1);
    expect(rows[0].identityId).toBe(identity.id);
    expect(rows[0].source).toBe('manual');

    // ...and re-affirming again changes nothing.
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: faceId,
      identityId: identity.id,
      source: 'manual',
    });
    const again = await linkRowsFor(faceId);
    expect(again).toHaveLength(1);
    expect(again[0].source).toBe('manual');
  });
});

// Slice 4 of the face-review unification: D4. A positive verdict (source='manual') must survive every
// non-human write path — an automatic shared-space-evidence merge (D4a), the recognition-race replace
// (D4b), and a personal-identity backfill sweep (D4c). Each of these sites writes a non-'manual' incoming
// source, so the fix is a `CASE WHEN existing='manual' THEN 'manual' ELSE <incoming> END` — NOT the
// omit-source mechanism used on the human people-merge path (see identity-merge-propagation.service.spec.ts).
describe('face_identity_face.source=manual durability (Slice 4 — D4a/b/c non-human write sites)', () => {
  it('D4a: an automatic shared-space-evidence merge preserves a manual loser-link', async () => {
    const { ctx, faceIdentityRepository } = setup();
    const target = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const source = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();
    const { user } = await ctx.newUser();
    const { asset } = await ctx.newAsset({ ownerId: user.id });
    const { assetFace: manualFace } = await ctx.newAssetFace({
      assetId: asset.id,
      sourceType: SourceType.MachineLearning,
    });
    const { assetFace: mlFace } = await ctx.newAssetFace({ assetId: asset.id, sourceType: SourceType.MachineLearning });
    await insertLinkRow(manualFace.id, source.id, 'manual');
    await insertLinkRow(mlFace.id, source.id, 'ml');

    await faceIdentityRepository.mergeIdentities({
      targetIdentityId: target.id,
      sourceIdentityIds: [source.id],
      source: 'shared-space-evidence',
    });

    const manualRow = await linkRowFor(manualFace.id);
    const mlRow = await linkRowFor(mlFace.id);
    // The human placement survives the automatic merge...
    expect(manualRow?.identityId).toBe(target.id);
    expect(manualRow?.source).toBe('manual');
    // ...while a non-manual rode-along face is relabeled (NOT stamped manual) and stays cleanup-flaggable.
    expect(mlRow?.identityId).toBe(target.id);
    expect(mlRow?.source).toBe('shared-space-evidence');
  });

  it('D4b: replaceFaceIdentity cannot downgrade a manual link (control: a non-manual link still updates)', async () => {
    const { ctx, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    const manualFaceId = await seedFace(ctx, user.id, person.personGroupId);
    const mlFaceId = await seedFace(ctx, user.id, person.personGroupId);
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: manualFaceId,
      identityId: identity.id,
      source: 'manual',
    });
    await faceIdentityRepository.replaceFaceIdentity({ assetFaceId: mlFaceId, identityId: identity.id, source: 'ml' });

    // The recognition-race value ('owner-person') must not downgrade an existing manual placement.
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: manualFaceId,
      identityId: identity.id,
      source: 'owner-person',
    });
    // Control: the same write on a non-manual link behaves as before (ELSE branch).
    await faceIdentityRepository.replaceFaceIdentity({
      assetFaceId: mlFaceId,
      identityId: identity.id,
      source: 'owner-person',
    });

    const manualRow = await linkRowFor(manualFaceId);
    const mlRow = await linkRowFor(mlFaceId);
    expect(manualRow?.source).toBe('manual');
    expect(mlRow?.source).toBe('owner-person');
  });

  it("D4c: backfill's linkPersonFaces preserves a drifted manual link", async () => {
    // repairRemainingPersonalIdentityFaceLinks calls `linkPersonFaces({ personId, identityId, source:
    // 'backfill' })` with exactly this shape whenever a person's own faces are still linked to a stale
    // identity after the rest of the personal backfill pass has run. Drive linkPersonFaces directly with the
    // same arguments to pin the fix at the exact site the backfill caller uses.
    const { ctx, faceIdentityRepository } = setup();
    const { user } = await ctx.newUser();
    const { person } = await ctx.newPerson({ ownerId: user.id, name: 'Anna' });
    const identity = await faceIdentityRepository.ensurePersonIdentity(person.personGroupId);
    const staleIdentity = await db
      .insertInto('face_identity')
      .values({ type: 'person' })
      .returningAll()
      .executeTakeFirstOrThrow();

    const manualFaceId = await seedFace(ctx, user.id, person.personGroupId);
    const mlFaceId = await seedFace(ctx, user.id, person.personGroupId);
    // Both faces are on `person` but their links have drifted onto a stale, unrelated identity.
    await insertLinkRow(manualFaceId, staleIdentity.id, 'manual');
    await insertLinkRow(mlFaceId, staleIdentity.id, 'ml');

    await faceIdentityRepository.linkPersonFaces({ personId: person.personGroupId, identityId: identity.id, source: 'backfill' });

    const manualRow = await linkRowFor(manualFaceId);
    const mlRow = await linkRowFor(mlFaceId);
    expect(manualRow?.identityId).toBe(identity.id);
    expect(manualRow?.source).toBe('manual');
    expect(mlRow?.identityId).toBe(identity.id);
    expect(mlRow?.source).toBe('backfill');
  });
});
