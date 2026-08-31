import { Kysely } from 'kysely';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository';
import { FamilyRepository } from 'src/repositories/family.repository';
import { JobRepository } from 'src/repositories/job.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { IdentityMergePropagationService } from 'src/services/identity-merge-propagation.service';
import { asDateString } from 'src/utils/date';
import { newMediumService } from 'test/medium.factory';
import { factory } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';
import type { Mocked } from 'vitest';
import { beforeAll, describe, expect, it } from 'vitest';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

// This suite drives every case through the REAL IdentityMergePropagationService — the same
// engine production merges use — never a stub. The point of Task 3 is that the existing merge
// engine does the right thing with family data; a test against a hand-rolled fake would prove
// nothing about that integration. Mirrors the setup in
// test/medium/specs/services/identity-merge-propagation.service.spec.ts.
const setup = (db: Kysely<DB> = defaultDatabase) => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [DatabaseRepository, FaceIdentityRepository, FamilyRepository, PersonRepository, SharedSpaceRepository],
    mock: [JobRepository, LoggingRepository],
  });
  const jobRepository = ctx.getMock<JobRepository, Mocked<JobRepository>>(JobRepository);
  jobRepository.queue.mockResolvedValue();

  const sut = new IdentityMergePropagationService({
    databaseRepository: ctx.get(DatabaseRepository),
    faceIdentityRepository: ctx.get(FaceIdentityRepository),
    familyRepository: ctx.get(FamilyRepository),
    jobRepository,
    logger: ctx.getMock<LoggingRepository, Mocked<LoggingRepository>>(LoggingRepository),
    personRepository: ctx.get(PersonRepository),
    sharedSpaceRepository: ctx.get(SharedSpaceRepository),
  });

  return { ctx, sut };
};

const createIdentity = (db: Kysely<DB>) => {
  return db.insertInto('face_identity').values({ type: 'person' }).returningAll().executeTakeFirstOrThrow();
};

const createPersonProfile = async (
  ctx: ReturnType<typeof setup>['ctx'],
  input: { ownerId: string; identityId: string; name?: string },
) => {
  const { person } = await ctx.newPerson({ ownerId: input.ownerId, name: input.name ?? 'Person' });
  await ctx.database.updateTable('person').set({ identityId: input.identityId }).where('id', '=', person.id).execute();
  return person;
};

const newUnion = (
  db: Kysely<DB>,
  values: { startDate?: string | null; status?: string; partnerKey?: string | null } = {},
) => {
  return db
    .insertInto('family_union')
    .values({ status: 'partnered', ...values })
    .returning('id')
    .executeTakeFirstOrThrow();
};

const addPartner = (db: Kysely<DB>, unionId: string, identityId: string) =>
  db.insertInto('family_union_partner').values({ unionId, identityId }).execute();

const addChild = (db: Kysely<DB>, unionId: string, identityId: string) =>
  db.insertInto('family_union_child').values({ unionId, identityId }).execute();

const getPartnerIds = async (db: Kysely<DB>, unionId: string) => {
  const rows = await db
    .selectFrom('family_union_partner')
    .select('identityId')
    .where('unionId', '=', unionId)
    .execute();
  return rows.map((row) => row.identityId);
};

const getChildIds = async (db: Kysely<DB>, unionId: string) => {
  const rows = await db.selectFrom('family_union_child').select('identityId').where('unionId', '=', unionId).execute();
  return rows.map((row) => row.identityId);
};

describe('family relationships under identity merge', () => {
  // GIVEN Johan appears twice as two identities, one of them a partner in a union
  // WHEN the duplicate is merged away
  // THEN the union keeps him — membership must re-point BEFORE the source row is
  // deleted, or ON DELETE CASCADE silently eats the relationship.
  it('keeps a union when one of its partners is merged into another identity', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Johan' });
    const source = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      name: 'Johan (dup)',
    });
    const child = await createIdentity(ctx.database);
    const union = await newUnion(ctx.database);
    await addPartner(ctx.database, union.id, sourceIdentity.id);
    await addChild(ctx.database, union.id, child.id);

    await expect(sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id])).resolves.toBeDefined();

    await expect(getPartnerIds(ctx.database, union.id)).resolves.toEqual([targetIdentity.id]);
    await expect(getChildIds(ctx.database, union.id)).resolves.toEqual([child.id]);
  });

  // Positive control: prove the merge itself actually happened, so the test above cannot pass
  // merely because nothing ran.
  it('leaves exactly one surviving identity after that merge', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const targetIdentity = await createIdentity(ctx.database);
    const sourceIdentity = await createIdentity(ctx.database);
    const target = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetIdentity.id, name: 'Johan' });
    const source = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceIdentity.id,
      name: 'Johan (dup)',
    });
    const union = await newUnion(ctx.database);
    await addPartner(ctx.database, union.id, sourceIdentity.id);

    await sut.mergePersonalPeople(factory.auth({ user }), target.id, [source.id]);

    const identities = await ctx.database
      .selectFrom('face_identity')
      .select('id')
      .where('id', 'in', [targetIdentity.id, sourceIdentity.id])
      .execute();
    expect(identities).toEqual([{ id: targetIdentity.id }]);
  });

  // E57 — the failure that breaks an unrelated shipped feature.
  // GIVEN union(A,C) and union(B,C) both exist
  // WHEN B is merged into A, making both unions key on the same pair
  // THEN they fold into one and the merge SUCCEEDS. A unique-violation abort here
  // would roll back the caller's face merge, not just the family data.
  it('folds two unions into one when a merge collides them on partnerKey', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const identityA = await createIdentity(ctx.database);
    const identityB = await createIdentity(ctx.database);
    const identityC = await createIdentity(ctx.database);
    const personA = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityA.id, name: 'A' });
    const personB = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityB.id, name: 'B' });

    const sharedDate = '1998-06-12';
    const unionAC = await newUnion(ctx.database, {
      startDate: sharedDate,
      partnerKey: `${[identityA.id, identityC.id].sort().join(':')}:${sharedDate}`,
    });
    await addPartner(ctx.database, unionAC.id, identityA.id);
    await addPartner(ctx.database, unionAC.id, identityC.id);

    const unionBC = await newUnion(ctx.database, {
      startDate: sharedDate,
      partnerKey: `${[identityB.id, identityC.id].sort().join(':')}:${sharedDate}`,
    });
    await addPartner(ctx.database, unionBC.id, identityB.id);
    await addPartner(ctx.database, unionBC.id, identityC.id);

    await expect(sut.mergePersonalPeople(factory.auth({ user }), personA.id, [personB.id])).resolves.toBeDefined();

    const survivingUnions = await ctx.database
      .selectFrom('family_union')
      .select('id')
      .where('id', 'in', [unionAC.id, unionBC.id])
      .execute();
    expect(survivingUnions).toHaveLength(1);

    const survivorPartners = await getPartnerIds(ctx.database, survivingUnions[0].id);
    expect(new Set(survivorPartners)).toEqual(new Set([identityA.id, identityC.id]));
  });

  it('keeps the earliest start date and the non-null status when folding', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const identityA = await createIdentity(ctx.database);
    const identityB = await createIdentity(ctx.database);
    const identityC = await createIdentity(ctx.database);
    const personA = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityA.id, name: 'A' });
    const personB = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityB.id, name: 'B' });

    // Two colliding unions necessarily share the same startDate component (that is what makes
    // their partnerKey collide) — the interesting assertion is that it survives the fold intact,
    // and that a deliberately-set, more specific status ('divorced') wins over the schema's
    // anonymous default ('partnered'), regardless of which physical row happens to survive.
    const sharedDate = '1998-06-12';
    const unionAC = await newUnion(ctx.database, {
      startDate: sharedDate,
      partnerKey: `${[identityA.id, identityC.id].sort().join(':')}:${sharedDate}`,
    });
    await addPartner(ctx.database, unionAC.id, identityA.id);
    await addPartner(ctx.database, unionAC.id, identityC.id);

    const unionBC = await newUnion(ctx.database, {
      startDate: sharedDate,
      status: 'divorced',
      partnerKey: `${[identityB.id, identityC.id].sort().join(':')}:${sharedDate}`,
    });
    await addPartner(ctx.database, unionBC.id, identityB.id);
    await addPartner(ctx.database, unionBC.id, identityC.id);

    await sut.mergePersonalPeople(factory.auth({ user }), personA.id, [personB.id]);

    const survivor = await ctx.database
      .selectFrom('family_union')
      .selectAll()
      .where('id', 'in', [unionAC.id, unionBC.id])
      .executeTakeFirstOrThrow();
    expect(asDateString(survivor.startDate)).toBe(sharedDate);
    expect(survivor.status).toBe('divorced');
  });

  // E58 — the merge path never runs write-path validation, so it can forge
  // graphs the write path would refuse.
  it('deletes a union that a merge would turn into a person partnered with themselves', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const identityA = await createIdentity(ctx.database);
    const identityB = await createIdentity(ctx.database);
    const personA = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityA.id, name: 'A' });
    const personB = await createPersonProfile(ctx, { ownerId: user.id, identityId: identityB.id, name: 'B' });
    const union = await newUnion(ctx.database);
    await addPartner(ctx.database, union.id, identityA.id);
    await addPartner(ctx.database, union.id, identityB.id);

    await expect(sut.mergePersonalPeople(factory.auth({ user }), personA.id, [personB.id])).resolves.toBeDefined();

    const remaining = await ctx.database.selectFrom('family_union').select('id').where('id', '=', union.id).execute();
    expect(remaining).toHaveLength(0);
  });

  it('breaks a parent cycle that a merge would close, without failing the merge', async () => {
    const { ctx, sut } = setup();
    const { user } = await ctx.newUser();
    const anton = await createIdentity(ctx.database);
    const targetAlex = await createIdentity(ctx.database);
    const sourceAlex = await createIdentity(ctx.database);
    const unrelatedPartner = await createIdentity(ctx.database);
    const personTarget = await createPersonProfile(ctx, { ownerId: user.id, identityId: targetAlex.id, name: 'Alex' });
    const personSource = await createPersonProfile(ctx, {
      ownerId: user.id,
      identityId: sourceAlex.id,
      name: 'Alex (dup)',
    });

    // union1: Anton is a parent of (source) Alex.
    const union1 = await newUnion(ctx.database);
    await addPartner(ctx.database, union1.id, anton.id);
    await addChild(ctx.database, union1.id, sourceAlex.id);

    // union2: (target) Alex is a parent of Anton.
    const union2 = await newUnion(ctx.database);
    await addPartner(ctx.database, union2.id, targetAlex.id);
    await addChild(ctx.database, union2.id, anton.id);

    // union3: unrelated to the cycle — (source) Alex is also a child of a completely different
    // union. Nothing about cycle-breaking should ever touch this edge; it exists purely to prove
    // repointing actually ran, rather than the source identity's memberships simply being lost to
    // ON DELETE CASCADE when the source row is deleted. Without this control, "the cycle edge was
    // silently destroyed by cascade" and "the cycle edge was correctly dropped by design" are
    // indistinguishable from the two counts below alone.
    const union3 = await newUnion(ctx.database);
    await addPartner(ctx.database, union3.id, unrelatedPartner.id);
    await addChild(ctx.database, union3.id, sourceAlex.id);

    // WHEN the two Alex identities are merged, union1's child re-points to targetAlex, closing a
    // cycle (Anton parent of Alex, Alex parent of Anton) that createUnion/addParticipant would
    // have refused outright (E7). The merge path never runs that validation, so it must repair
    // the graph instead — and must not fail while doing it.
    await expect(
      sut.mergePersonalPeople(factory.auth({ user }), personTarget.id, [personSource.id]),
    ).resolves.toBeDefined();

    // The unrelated membership was re-pointed, not lost to cascade.
    await expect(getChildIds(ctx.database, union3.id)).resolves.toEqual([targetAlex.id]);

    // Exactly one of the two cyclical edges must have been dropped to break the cycle — which one
    // is an implementation detail (it depends on iteration order over an unordered result set);
    // that a cycle no longer exists is not.
    const union1Children = await getChildIds(ctx.database, union1.id);
    const union2Children = await getChildIds(ctx.database, union2.id);
    expect(union1Children.length + union2Children.length).toBe(1);
  });

  // E13 — plain identity deletion, not a merge.
  it('leaves the union in place when a participating identity is deleted', async () => {
    const identity = await createIdentity(defaultDatabase);
    const union = await newUnion(defaultDatabase);
    await addPartner(defaultDatabase, union.id, identity.id);

    await defaultDatabase.deleteFrom('face_identity').where('id', '=', identity.id).execute();

    await expect(getPartnerIds(defaultDatabase, union.id)).resolves.toEqual([]);
    await expect(
      defaultDatabase.selectFrom('family_union').select('id').where('id', '=', union.id).executeTakeFirst(),
    ).resolves.toBeDefined();
  });

  // Not a named edge case — extra robustness evidence for the plan's "None of these may throw"
  // requirement. Forces a genuine SQL-level failure inside repointIdentities (a foreign-key
  // violation, by repointing at a target identity that doesn't exist) and proves the SAVEPOINT
  // recovers cleanly: the call itself never throws, family data is left completely untouched by
  // the failed attempt, and — critically — the surrounding transaction is still usable afterward
  // (a plain try/catch around the call would NOT be enough for this: Postgres marks a transaction
  // aborted on a SQL-level error, so the very next statement would fail too without a savepoint).
  it('recovers from a genuine repointing failure without leaving the transaction unusable', async () => {
    const { ctx } = setup();
    const identity = await createIdentity(ctx.database);
    const union = await newUnion(ctx.database);
    await addPartner(ctx.database, union.id, identity.id);
    const nonExistentTargetId = '00000000-0000-4000-a000-000000000999';
    const familyRepository = ctx.get(FamilyRepository);

    await ctx.database.transaction().execute(async (trx) => {
      await expect(
        familyRepository.repointIdentities([identity.id], nonExistentTargetId, trx),
      ).resolves.toBeUndefined();

      // The transaction must still accept further writes — proof the savepoint rollback did not
      // poison it.
      await trx.insertInto('face_identity').values({ type: 'person' }).execute();
    });

    // The failed repoint left the original membership completely untouched.
    await expect(getPartnerIds(ctx.database, union.id)).resolves.toEqual([identity.id]);
  });
});
