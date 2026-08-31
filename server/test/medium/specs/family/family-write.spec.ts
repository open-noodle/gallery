import { BadRequestException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { AuthDto } from 'src/dtos/auth.dto';
import { FamilyRepository } from 'src/repositories/family.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { DB } from 'src/schema';
import { FamilyService } from 'src/services/family.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

/** face_identity has no medium.factory helper, so insert directly (mirrors family-schema.spec.ts). */
const newIdentity = async (type: 'person' | 'pet' = 'person') => {
  const row = await db.insertInto('face_identity').values({ type }).returning('id').executeTakeFirstOrThrow();
  return row.id;
};

const newUser = async () => {
  const row = await db
    .insertInto('user')
    .values({ email: `${randomUUID()}@family.test`, name: 'Family Test' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

const setup = () => {
  const { sut } = newMediumService(FamilyService, {
    database: db,
    real: [FamilyRepository],
    mock: [LoggingRepository],
  });
  // Access control (who may write) is covered exhaustively by the unit suite in
  // family.service.spec.ts. Bypassing it here keeps these tests focused on the one thing
  // that needs a real database: the recursive ancestor walk.
  sut['requireFamilyWrite'] = async () => {};
  return { sut };
};

const newAuth = async (): Promise<AuthDto> => {
  const userId = await newUser();
  return { user: { id: userId } } as AuthDto;
};

const getUnionRow = async (unionId: string) =>
  db.selectFrom('family_union').where('id', '=', unionId).selectAll().executeTakeFirstOrThrow();

const countByPartnerKey = async (partnerKey: string | null) =>
  db.selectFrom('family_union').where('partnerKey', '=', partnerKey).selectAll().execute();

describe('family relationships — union write path (real SQL)', () => {
  // GIVEN Anton is a parent of Alex
  // WHEN an editor tries to make Alex a parent of Anton
  // THEN it is refused: Anton is already an ancestor of Alex.
  it('refuses to make someone the parent of their own parent', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [anton, alex] = [await newIdentity(), await newIdentity()];

    await expect(sut.createUnion(auth, { partnerIds: [anton], childIds: [alex] })).resolves.toBeDefined();

    await expect(sut.createUnion(auth, { partnerIds: [alex], childIds: [anton] })).rejects.toThrow(BadRequestException);

    // Positive control: an unrelated pair, with no ancestor relationship at all, is still
    // allowed — proving the rejection above is about the cycle, not a blanket refusal.
    const [unrelatedPartner, unrelatedChild] = [await newIdentity(), await newIdentity()];
    await expect(
      sut.createUnion(auth, { partnerIds: [unrelatedPartner], childIds: [unrelatedChild] }),
    ).resolves.toBeDefined();
  });

  // GIVEN Anton is a parent of Alex, and Alex a parent of Iris
  // WHEN an editor tries to make Iris a parent of Anton
  // THEN it is refused: the ancestor check must walk the whole chain, not one hop. A naive
  // one-level check would see only Alex as Iris's direct parent, miss Anton entirely, and
  // wrongly allow this — it would pass the test above and fail this one.
  it('refuses a cycle that closes three generations up', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [anton, alex, iris] = [await newIdentity(), await newIdentity(), await newIdentity()];

    await expect(sut.createUnion(auth, { partnerIds: [anton], childIds: [alex] })).resolves.toBeDefined();
    await expect(sut.createUnion(auth, { partnerIds: [alex], childIds: [iris] })).resolves.toBeDefined();

    await expect(sut.createUnion(auth, { partnerIds: [iris], childIds: [anton] })).rejects.toThrow(BadRequestException);

    // Positive control: an unrelated pair still succeeds after the refusal above.
    const [unrelatedPartner, unrelatedChild] = [await newIdentity(), await newIdentity()];
    await expect(
      sut.createUnion(auth, { partnerIds: [unrelatedPartner], childIds: [unrelatedChild] }),
    ).resolves.toBeDefined();
  });
});

describe('family relationships — partnerKey maintenance and deduplication (real SQL)', () => {
  // E4, E61
  it('returns the existing union when the same two partners and start date are added again', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const first = await sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' });
    const second = await sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' });
    // Same pair, order swapped — partnerKey sorts the pair, so this must collapse too.
    const third = await sut.createUnion(auth, { partnerIds: [b, a], startDate: '1998-06-12' });

    expect(second.id).toBe(first.id);
    expect(third.id).toBe(first.id);

    const firstRow = await getUnionRow(first.id);
    expect(firstRow.partnerKey).not.toBeNull();

    // Exactly one row on disk for this pair/date — the duplicate writes never created a
    // second row (the point of E4/E61), not merely that the returned ids happen to match.
    const matching = await countByPartnerKey(firstRow.partnerKey);
    expect(matching).toHaveLength(1);
  });

  // E5
  it('creates two independent unions when neither has two partners', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const a = await newIdentity();

    const first = await sut.createUnion(auth, { partnerIds: [a] });
    const second = await sut.createUnion(auth, { partnerIds: [a] });

    expect(second.id).not.toBe(first.id);

    const rows = await db.selectFrom('family_union').where('id', 'in', [first.id, second.id]).selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.partnerKey === null)).toBe(true);
  });

  // E17
  it('clears partnerKey when a union drops to one partner', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    const before = await getUnionRow(unionId);
    expect(before.partnerKey).not.toBeNull();

    await sut.removeParticipant(auth, unionId, b);

    const after = await getUnionRow(unionId);
    expect(after.partnerKey).toBeNull();
  });

  // E60
  it('lets the same two partners marry again on a different date', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const first = await sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' });
    const second = await sut.createUnion(auth, { partnerIds: [a, b], startDate: '2011-09-04' });

    expect(second.id).not.toBe(first.id);

    const rows = await db.selectFrom('family_union').where('id', 'in', [first.id, second.id]).selectAll().execute();
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.partnerKey)).size).toBe(2);
  });

  // E62
  it('recomputes partnerKey when a union start date is edited', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' });
    const before = await getUnionRow(unionId);

    await sut.updateUnion(auth, unionId, { startDate: '2011-09-04' });

    const after = await getUnionRow(unionId);
    const [sortedA, sortedB] = [a, b].sort();
    expect(after.partnerKey).not.toBe(before.partnerKey);
    expect(after.partnerKey).toBe(`${sortedA}:${sortedB}:2011-09-04`);
  });

  // E4 under concurrency
  it('resolves two concurrent creations of the same union to one row', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const [first, second] = await Promise.all([
      sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' }),
      sut.createUnion(auth, { partnerIds: [a, b], startDate: '1998-06-12' }),
    ]);

    expect(second.id).toBe(first.id);

    const rows = await db.selectFrom('family_union').where('id', '=', first.id).selectAll().execute();
    expect(rows).toHaveLength(1);
  });
});
