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
