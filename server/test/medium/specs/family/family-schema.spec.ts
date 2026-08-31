import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

/** face_identity has no medium.factory helper, so insert directly. */
const newIdentity = async () => {
  const row = await db.insertInto('face_identity').values({ type: 'person' }).returning('id').executeTakeFirstOrThrow();
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

const newUnion = async (values: {
  partnerKey?: string | null;
  startDate?: string | null;
  createdById?: string | null;
}) => {
  const row = await db
    .insertInto('family_union')
    .values({ status: 'married', ...values })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

describe('family relationship schema', () => {
  // GIVEN a union created by a user
  // WHEN that user is deleted
  // THEN the union survives with a null creator — family history must outlive accounts.
  it('keeps a union when the user who created it is deleted', async () => {
    const userId = await newUser();
    const unionId = await newUnion({ createdById: userId });

    await db.deleteFrom('user').where('id', '=', userId).execute();

    const found = await db.selectFrom('family_union').where('id', '=', unionId).selectAll().executeTakeFirst();
    expect(found).toBeDefined();
    expect(found?.createdById).toBeNull();
  });

  // Positive control for the above: prove the cascade we DO want still fires, so the
  // test above cannot pass merely because nothing is wired up.
  it('removes partner and child rows when the union itself is deleted', async () => {
    const unionId = await newUnion({});
    const [a, b, c] = [await newIdentity(), await newIdentity(), await newIdentity()];
    await db
      .insertInto('family_union_partner')
      .values([
        { unionId, identityId: a },
        { unionId, identityId: b },
      ])
      .execute();
    await db.insertInto('family_union_child').values({ unionId, identityId: c }).execute();

    await db.deleteFrom('family_union').where('id', '=', unionId).execute();

    const partners = await db.selectFrom('family_union_partner').where('unionId', '=', unionId).execute();
    const children = await db.selectFrom('family_union_child').where('unionId', '=', unionId).execute();
    expect(partners).toHaveLength(0);
    expect(children).toHaveLength(0);
  });

  it('removes membership rows when a participating identity is deleted', async () => {
    const unionId = await newUnion({});
    const identityId = await newIdentity();
    await db.insertInto('family_union_partner').values({ unionId, identityId }).execute();

    await db.deleteFrom('face_identity').where('id', '=', identityId).execute();

    const partners = await db.selectFrom('family_union_partner').where('unionId', '=', unionId).execute();
    expect(partners).toHaveLength(0);
    // The union itself must survive — only the membership goes (E13).
    const union = await db.selectFrom('family_union').where('id', '=', unionId).executeTakeFirst();
    expect(union).toBeDefined();
  });

  it('rejects a second union with the same partnerKey', async () => {
    const key = `${randomUUID()}:${randomUUID()}:1998-06-12`;
    await newUnion({ partnerKey: key });

    // Assert the SQLSTATE, not the message. A Postgres unique violation names the
    // *index*, not the column, so matching /partnerKey/ would pass or fail for the wrong reason.
    await expect(newUnion({ partnerKey: key })).rejects.toMatchObject({ code: '23505' });
  });

  it('allows the same two partners to marry again on a different date', async () => {
    // E60 — remarriage. startDate is part of partnerKey precisely so this works.
    const [a, b] = [randomUUID(), randomUUID()].sort();
    await newUnion({ partnerKey: `${a}:${b}:1998-06-12` });
    await expect(newUnion({ partnerKey: `${a}:${b}:2011-09-04` })).resolves.toBeDefined();
  });

  it('allows many unions with a null partnerKey', async () => {
    // E5 — partnerKey is NULL below two partners, so those must never collide.
    await newUnion({ partnerKey: null });
    await expect(newUnion({ partnerKey: null })).resolves.toBeDefined();
  });

  it('stores an optional gender on an identity', async () => {
    const identityId = await newIdentity();
    await db.updateTable('face_identity').set({ gender: 'female' }).where('id', '=', identityId).execute();

    const row = await db
      .selectFrom('face_identity')
      .where('id', '=', identityId)
      .select('gender')
      .executeTakeFirstOrThrow();
    expect(row.gender).toBe('female');
  });

  it('defaults gender to null', async () => {
    const identityId = await newIdentity();
    const row = await db
      .selectFrom('face_identity')
      .where('id', '=', identityId)
      .select('gender')
      .executeTakeFirstOrThrow();
    expect(row.gender).toBeNull();
  });

  it('stores a per-user access level', async () => {
    const userId = await newUser();
    await db.insertInto('family_access').values({ userId, level: 'contribute' }).execute();

    const row = await db.selectFrom('family_access').where('userId', '=', userId).selectAll().executeTakeFirstOrThrow();
    expect(row.level).toBe('contribute');
  });

  it('removes the access row when the user is deleted', async () => {
    const userId = await newUser();
    await db.insertInto('family_access').values({ userId, level: 'view' }).execute();

    await db.deleteFrom('user').where('id', '=', userId).execute();

    const rows = await db.selectFrom('family_access').where('userId', '=', userId).execute();
    expect(rows).toHaveLength(0);
  });
});
