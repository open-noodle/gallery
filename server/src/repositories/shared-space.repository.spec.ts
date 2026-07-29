import { Kysely } from 'kysely';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
import { describe, expect, it, vitest } from 'vitest';

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

const fake = (execute: () => Promise<unknown>) => {
  const transaction = vitest.fn(() => ({ execute }));
  return { db: { transaction } as unknown as Kysely<DB>, transaction };
};

/**
 * The recount is a deadlock victim under a real delete storm (#864): the representativeFaceId
 * ON DELETE SET NULL cascade locks shared_space_person rows in face order, so Postgres can pick
 * a recount to kill even though the recount itself claims its rows in id order.
 *
 * These cover the retry wiring. The end-to-end effect is measured by the library-unmap repro,
 * which cannot be expressed as a deterministic unit test.
 */
describe(`${SharedSpaceRepository.name}.recountPersons deadlock retry (#864)`, () => {
  const ids = ['11111111-1111-4111-8111-111111111111'];

  it('re-drives the recount in a FRESH transaction when it is chosen as the victim', async () => {
    let attempts = 0;
    const execute = vitest.fn(() => {
      attempts++;
      if (attempts < 3) {
        return Promise.reject(deadlock());
      }
      return Promise.resolve(void 0);
    });
    const transaction = vitest.fn(() => ({ execute }));
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).recountPersons(ids, db)).resolves.toBeUndefined();

    // a retry must open a new transaction: the deadlocked one is already dead
    expect(transaction).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('gives up and surfaces the deadlock once the attempt budget is spent', async () => {
    const execute = vitest.fn(() => Promise.reject(deadlock()));
    const transaction = vitest.fn(() => ({ execute }));
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).recountPersons(ids, db)).rejects.toMatchObject({ code: '40P01' });

    // bounded — a permanently contended row must not spin forever
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('opens exactly one transaction when the first attempt succeeds', async () => {
    const execute = vitest.fn(() => Promise.resolve(void 0));
    const transaction = vitest.fn(() => ({ execute }));
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await new SharedSpaceRepository(db).recountPersons(ids, db);

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('opens no transaction at all for an empty id list', async () => {
    const transaction = vitest.fn();
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).recountPersons([], db)).resolves.toBeUndefined();

    expect(transaction).not.toHaveBeenCalled();
  });

  it('runs the recount work inside each attempt, not just around it', async () => {
    const callbacks: unknown[] = [];
    let attempts = 0;
    const execute = vitest.fn((cb: unknown) => {
      callbacks.push(cb);
      attempts++;
      return attempts < 2 ? Promise.reject(deadlock()) : Promise.resolve(void 0);
    });
    const transaction = vitest.fn(() => ({ execute }));
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await new SharedSpaceRepository(db).recountPersons(ids, db);

    expect(callbacks).toHaveLength(2);
    expect(callbacks.every((cb) => typeof cb === 'function')).toBe(true);
  });

  it('does not retry failures that are not deadlocks', async () => {
    const execute = vitest.fn(() => Promise.reject(Object.assign(new Error('nope'), { code: '23503' })));
    const transaction = vitest.fn(() => ({ execute }));
    const db = { isTransaction: false, transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).recountPersons(ids, db)).rejects.toMatchObject({ code: '23503' });

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  // A deadlock aborts the caller's whole transaction, so re-running the statements inside it would
  // only raise "current transaction is aborted". The caller has to re-drive its own transaction.
  it('never retries, or nests a transaction, when the caller supplied one', async () => {
    const transaction = vitest.fn();
    let claims = 0;
    const chain: any = {
      select: () => chain,
      where: () => chain,
      orderBy: () => chain,
      forUpdate: () => chain,
      execute: () => {
        claims++;
        return Promise.reject(deadlock());
      },
    };
    const trx = { isTransaction: true, transaction, selectFrom: () => chain } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(trx).recountPersons(ids, trx)).rejects.toMatchObject({ code: '40P01' });

    expect(claims).toBe(1);
    expect(transaction).not.toHaveBeenCalled();
  });
});

// Ranked P0 by the #864 lock audit: onAssetDelete calls this immediately after the (protected)
// recountPersons, so protecting only the recount just moves the deadlock victim onto this DELETE.
describe(`${SharedSpaceRepository.name} orphan cleanup deadlock safety (#864)`, () => {
  const spaceId = '22222222-2222-4222-8222-222222222222';
  const ids = ['11111111-1111-4111-8111-111111111111'];

  it('re-drives deleteOrphanedPersons in a fresh transaction when it is the victim', async () => {
    let attempts = 0;
    const { db, transaction } = fake(() => {
      attempts++;
      return attempts < 3 ? Promise.reject(deadlock()) : Promise.resolve(void 0);
    });

    await expect(new SharedSpaceRepository(db).deleteOrphanedPersons(spaceId)).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('gives up on deleteOrphanedPersons once the budget is spent', async () => {
    const { db, transaction } = fake(() => Promise.reject(deadlock()));

    await expect(new SharedSpaceRepository(db).deleteOrphanedPersons(spaceId)).rejects.toMatchObject({
      code: '40P01',
    });
    expect(transaction).toHaveBeenCalledTimes(5);
  });

  it('does not retry deleteOrphanedPersons on non-deadlock failures', async () => {
    const { db, transaction } = fake(() => Promise.reject(Object.assign(new Error('x'), { code: '23503' })));

    await expect(new SharedSpaceRepository(db).deleteOrphanedPersons(spaceId)).rejects.toMatchObject({
      code: '23503',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('re-drives deleteOrphanedPersonsByIds too', async () => {
    let attempts = 0;
    const { db, transaction } = fake(() => {
      attempts++;
      return attempts < 2 ? Promise.reject(deadlock()) : Promise.resolve(void 0);
    });

    await expect(new SharedSpaceRepository(db).deleteOrphanedPersonsByIds(spaceId, ids)).resolves.toBeUndefined();
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it('opens no transaction for deleteOrphanedPersonsByIds with an empty id list', async () => {
    const transaction = vitest.fn();
    const db = { transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).deleteOrphanedPersonsByIds(spaceId, [])).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
  });
});

// Path 3 from the #864 lock audit: an INSERT into shared_space_person_face takes FOR KEY SHARE on
// its shared_space_person parents to satisfy the FK — invisible in the statement, but a real
// deadlock participant against the representativeFaceId SET NULL cascade during an asset delete.
describe(`${SharedSpaceRepository.name}.addPersonFaces deadlock safety (#864)`, () => {
  const values = [{ personId: '11111111-1111-4111-8111-111111111111', assetFaceId: 'a' }] as any;

  it('re-drives the insert in a fresh transaction when it is the deadlock victim', async () => {
    let attempts = 0;
    const { db, transaction } = fake(() => {
      attempts++;
      return attempts < 3 ? Promise.reject(deadlock()) : Promise.resolve([]);
    });

    await expect(new SharedSpaceRepository(db).addPersonFaces(values)).resolves.toEqual([]);
    expect(transaction).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-deadlock failures', async () => {
    const { db, transaction } = fake(() => Promise.reject(Object.assign(new Error('x'), { code: '23503' })));

    await expect(new SharedSpaceRepository(db).addPersonFaces(values)).rejects.toMatchObject({ code: '23503' });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('opens no transaction for an empty value list', async () => {
    const transaction = vitest.fn();
    const db = { transaction } as unknown as Kysely<DB>;

    await expect(new SharedSpaceRepository(db).addPersonFaces([])).resolves.toEqual([]);
    expect(transaction).not.toHaveBeenCalled();
  });
});

// Chainable Kysely stub: every builder method returns itself, `execute` is caller-controlled.
const chain = (execute: () => Promise<unknown>): any =>
  new Proxy({}, { get: (_target, prop) => (prop === 'execute' ? execute : () => chain(execute)) });

const dbWith = (onDelete: () => Promise<unknown>) => {
  const deletes = { count: 0 };
  const db = {
    selectFrom: () => chain(() => Promise.resolve([])),
    deleteFrom: () =>
      chain(() => {
        deletes.count++;
        return onDelete();
      }),
  } as unknown as Kysely<DB>;
  return { db, deletes };
};

// P1 from the #864 lock audit — reached from unlinkLibrary / AlbumDelete / AlbumAssetsRemove,
// i.e. the library unmap itself.
describe(`${SharedSpaceRepository.name} face-removal deadlock safety (#864)`, () => {
  const spaceId = '22222222-2222-4222-8222-222222222222';

  it('re-drives removePersonFacesByAssetIds when the delete is the deadlock victim', async () => {
    let attempts = 0;
    const { db, deletes } = dbWith(() => {
      attempts++;
      return attempts < 3 ? Promise.reject(deadlock()) : Promise.resolve(void 0);
    });

    await expect(new SharedSpaceRepository(db).removePersonFacesByAssetIds(spaceId, ['a'])).resolves.toBeUndefined();
    expect(deletes.count).toBe(3);
  });

  it('does not retry removePersonFacesByAssetIds on non-deadlock failures', async () => {
    const { db, deletes } = dbWith(() => Promise.reject(Object.assign(new Error('x'), { code: '23503' })));

    await expect(new SharedSpaceRepository(db).removePersonFacesByAssetIds(spaceId, ['a'])).rejects.toMatchObject({
      code: '23503',
    });
    expect(deletes.count).toBe(1);
  });

  it('re-drives removePersonFacesByLibrary when the delete is the deadlock victim', async () => {
    let attempts = 0;
    const { db, deletes } = dbWith(() => {
      attempts++;
      return attempts < 2 ? Promise.reject(deadlock()) : Promise.resolve(void 0);
    });

    await expect(new SharedSpaceRepository(db).removePersonFacesByLibrary(spaceId, 'lib')).resolves.toBeUndefined();
    expect(deletes.count).toBe(2);
  });
});
