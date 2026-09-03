import { BadRequestException, NotFoundException } from '@nestjs/common';
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

  // E17. The union must still EXIST for this to be meaningful, so it carries a child: a couple
  // with no children that drops to one partner is pruned outright (see the removal suite below),
  // and there would be no partnerKey left to assert on.
  it('clears partnerKey when a union drops to one partner', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b, kid] = [await newIdentity(), await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b], childIds: [kid] });
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

// Removing people and deleting unions, against real SQL — where the cascades and the pruning
// actually live.
//
// The motivating defect: nothing pruned a union that removal had emptied out. A real library ended
// up with four unions nobody could see — two with a single partner, two with NO partners and one
// child. `computeVisibleUnions` hides anything under two resolvable participants, so they were
// invisible rather than merely untidy, which is exactly why they went unnoticed.
const unionExists = async (unionId: string) => {
  const row = await db.selectFrom('family_union').where('id', '=', unionId).select('id').executeTakeFirst();
  return row !== undefined;
};

const participantsOf = async (unionId: string) => {
  const [partners, children] = await Promise.all([
    db.selectFrom('family_union_partner').where('unionId', '=', unionId).select('identityId').execute(),
    db.selectFrom('family_union_child').where('unionId', '=', unionId).select('identityId').execute(),
  ]);
  return { partners: partners.map((row) => row.identityId), children: children.map((row) => row.identityId) };
};

describe('family relationships — removing people and unions (real SQL)', () => {
  // GIVEN a childless couple
  // WHEN one of them is removed
  // THEN the union goes with them — one participant conveys nothing and can never be rendered.
  it('deletes a couple that loses one of its two partners', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    await sut.removeParticipant(auth, unionId, b);

    expect(await unionExists(unionId)).toBe(false);
  });

  // The same rule from the other side: a lone parent whose only child is removed.
  it('deletes a one-parent union that loses its only child', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [parent, kid] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [parent], childIds: [kid] });
    await sut.removeParticipant(auth, unionId, kid);

    expect(await unionExists(unionId)).toBe(false);
  });

  // The positive control for both: two participants left is a union that still means something,
  // so it must survive. Without this, "delete on removal" would pass by deleting everything.
  it('keeps a union that still has two participants', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b, kid] = [await newIdentity(), await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b], childIds: [kid] });
    await sut.removeParticipant(auth, unionId, b);

    expect(await unionExists(unionId)).toBe(true);
    const remaining = await participantsOf(unionId);
    expect(remaining.partners).toEqual([a]);
    expect(remaining.children).toEqual([kid]);
  });

  // The reason the husks were dangerous rather than merely untidy: a one-partner remnant still has
  // a free partner seat, and the canvas `beside` gesture fills the first union that has one. An
  // abandoned union would be silently resurrected — carrying its old status and dates into a
  // relationship that has nothing to do with it.
  it('leaves behind no union with a free partner seat for a later drop to adopt', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b, c] = [await newIdentity(), await newIdentity(), await newIdentity()];

    const { id: abandoned } = await sut.createUnion(auth, {
      partnerIds: [a, b],
      status: 'married',
      startDate: '1998-06-12',
    });
    await sut.removeParticipant(auth, abandoned, b);

    // The invariant that matters: `a` is left in NO union, so there is no half-empty remnant for a
    // later drop to find. Asserting only that a fresh union gets a fresh id would pass with the
    // husk still sitting there, since a new pair always makes a new row anyway.
    const stillContainingA = await db
      .selectFrom('family_union_partner')
      .where('identityId', '=', a)
      .select('unionId')
      .execute();
    expect(stillContainingA).toEqual([]);

    const { id: fresh } = await sut.createUnion(auth, { partnerIds: [a, c] });
    expect(fresh).not.toBe(abandoned);
    const row = await getUnionRow(fresh);
    expect(row.status).toBe('partnered');
    expect(row.startDate).toBeNull();
  });

  // Removing someone takes them out of THIS union only. The canvas "remove from this family"
  // walks every union they appear in and calls this once per union; if one call reached further
  // than its own union, that walk would delete far more than it was asked to.
  it('removes a person from one union without touching their others', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [shared, partnerA, partnerB, kidA, kidB] = [
      await newIdentity(),
      await newIdentity(),
      await newIdentity(),
      await newIdentity(),
      await newIdentity(),
    ];

    const { id: first } = await sut.createUnion(auth, { partnerIds: [shared, partnerA], childIds: [kidA] });
    const { id: second } = await sut.createUnion(auth, { partnerIds: [shared, partnerB], childIds: [kidB] });

    await sut.removeParticipant(auth, first, shared);

    expect(await unionExists(second)).toBe(true);
    const secondAfter = await participantsOf(second);
    const firstAfter = await participantsOf(first);
    expect(secondAfter.partners.toSorted()).toEqual([partnerB, shared].toSorted());
    expect(firstAfter.partners).toEqual([partnerA]);
  });

  // A no-op, not an error: the union is untouched and, crucially, NOT pruned — the participant
  // count never changed, so a stray call must not be able to delete a healthy union.
  it('changes nothing when the person is not in that union', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b, stranger] = [await newIdentity(), await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    await sut.removeParticipant(auth, unionId, stranger);

    expect(await unionExists(unionId)).toBe(true);
    const untouched = await participantsOf(unionId);
    expect(untouched.partners.toSorted()).toEqual([a, b].toSorted());
  });

  // Deleting a union must take its membership rows with it, or the next insert of the same pair
  // collides with rows pointing at a union that no longer exists.
  it('takes every membership row with a deleted union', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b, kid] = [await newIdentity(), await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b], childIds: [kid] });
    await sut.deleteUnion(auth, unionId);

    expect(await unionExists(unionId)).toBe(false);
    const remaining = await participantsOf(unionId);
    expect(remaining.partners).toEqual([]);
    expect(remaining.children).toEqual([]);
  });

  // E23's shape: deleting a union removes the RELATIONSHIP, never the people. They stay in the
  // library and in every other union they belong to.
  it('leaves the people themselves alone when their union is deleted', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    await sut.deleteUnion(auth, unionId);

    const identities = await db.selectFrom('face_identity').where('id', 'in', [a, b]).select('id').execute();
    expect(identities).toHaveLength(2);
  });

  // Deleting the same union twice is the double-click case, and the second call must not 500.
  it('refuses a second delete of the same union', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    await sut.deleteUnion(auth, unionId);

    await expect(sut.deleteUnion(auth, unionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  // The pruning deletes the union mid-removal, so a second removal has no union to find.
  it('refuses a removal from a union that pruning already deleted', async () => {
    const { sut } = setup();
    const auth = await newAuth();
    const [a, b] = [await newIdentity(), await newIdentity()];

    const { id: unionId } = await sut.createUnion(auth, { partnerIds: [a, b] });
    await sut.removeParticipant(auth, unionId, b);

    await expect(sut.removeParticipant(auth, unionId, a)).rejects.toBeInstanceOf(NotFoundException);
  });
});
