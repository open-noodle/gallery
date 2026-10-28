import { Kysely, sql } from 'kysely';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { DB } from 'src/schema/index.js';
import * as splitMigration from 'src/schema/migrations-gallery/1790900000000-SplitSharedPersonGroups.js';
import { SyncTestContext } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// What a phone holds across 1790900000000-SplitSharedPersonGroups and its rejoin. The phone applies the stream
// in order, the way the mobile sync repository does: a delete removes the id, an upsert writes it. Its people
// and faces must then match the server's, whether it syncs at every step or only once at the end.
let db: Kysely<DB>;

beforeEach(async () => {
  db = await getKyselyDB();
  await sql`DROP INDEX "person_personGroupId_key"`.execute(db);
});

const types = [SyncRequestType.PeopleV1, SyncRequestType.AssetFacesV2];

class Phone {
  people = new Map<string, string>();
  faces = new Map<string, string | null>();

  constructor(
    private ctx: SyncTestContext,
    private auth: AuthDto,
  ) {}

  async sync() {
    const response = await this.ctx.syncStream(this.auth, types);
    for (const { type, data } of response as Array<{ type: string; data: any }>) {
      switch (type) {
        case SyncEntityType.PersonV1: {
          this.people.set(data.id, data.name);
          break;
        }
        case SyncEntityType.PersonDeleteV1: {
          this.people.delete(data.personId);
          break;
        }
        case SyncEntityType.AssetFaceV2: {
          this.faces.set(data.id, data.personId);
          break;
        }
        case SyncEntityType.AssetFaceDeleteV1: {
          this.faces.delete(data.assetFaceId);
          break;
        }
      }
    }
    await this.ctx.syncAckAll(this.auth, response);
  }
}

const serverState = async (ownerId: string) => {
  const people = await db
    .selectFrom('person')
    .select(['personGroupId', 'name'])
    .where('ownerId', '=', ownerId)
    .execute();
  const faces = await db
    .selectFrom('asset_face')
    .innerJoin('asset', 'asset.id', 'asset_face.assetId')
    .select(['asset_face.id', 'asset_face.personGroupId'])
    .where('asset.ownerId', '=', ownerId)
    .where('asset_face.deletedAt', 'is', null)
    .execute();
  return {
    people: new Map(people.map(({ personGroupId, name }) => [personGroupId, name])),
    faces: new Map(faces.map(({ id, personGroupId }) => [id, personGroupId])),
  };
};

// The phone holds exactly what the server has for this user.
const expectInSync = async (phone: Phone, ownerId: string) => {
  const server = await serverState(ownerId);
  expect(phone.people).toEqual(server.people);
  expect(phone.faces).toEqual(server.faces);
  return server;
};

const setup = async () => {
  const ctx = new SyncTestContext(db);
  const { auth: aliceAuth, user: alice } = await ctx.newSyncAuthUser();
  const { auth: bobAuth, user: bob } = await ctx.newSyncAuthUser();
  const { session: bobTablet } = await ctx.newSession({ userId: bob.id });
  const bobTabletAuth = factory.auth({ session: bobTablet, user: { id: bob.id, name: bob.name, email: bob.email } });

  // One person pooled by recognition: Alice's row made the group, Bob's joined it; each has a face on their asset.
  const { person } = await ctx.newPerson({ ownerId: alice.id, name: 'Grandma', createdAt: new Date('2026-01-01') });
  const group = person.personGroupId;
  await ctx.newPerson({ ownerId: bob.id, personGroupId: group, name: 'Oma', createdAt: new Date('2026-01-02') });
  for (const ownerId of [alice.id, bob.id]) {
    const { asset } = await ctx.newAsset({ ownerId });
    await ctx.newAssetFace({ assetId: asset.id, personGroupId: group });
  }

  return {
    alice,
    bob,
    group,
    alicePhone: new Phone(ctx, aliceAuth),
    bobPhone: new Phone(ctx, bobAuth),
    bobTablet: new Phone(ctx, bobTabletAuth),
  };
};

describe('sync across the shared person group split', () => {
  it('moves the person on a phone that syncs before and after each step', async () => {
    const { alice, bob, group, alicePhone, bobPhone } = await setup();
    await alicePhone.sync();
    await bobPhone.sync();
    expect(bobPhone.people.keys().toArray()).toEqual([group]);

    await splitMigration.up(db);
    await alicePhone.sync();
    await bobPhone.sync();

    const afterSplit = await expectInSync(bobPhone, bob.id);
    expect(afterSplit.people.keys().toArray()).not.toEqual([group]);
    // Alice kept the group and is told nothing about Bob's copy.
    await expectInSync(alicePhone, alice.id);

    await splitMigration.down(db);
    await bobPhone.sync();
    await expectInSync(bobPhone, bob.id);
    expect(bobPhone.people.keys().toArray()).toEqual([group]);
  });

  it('ends right on a phone that last synced before the split and next syncs after the rejoin', async () => {
    const { bob, group, bobPhone, bobTablet } = await setup();
    await bobTablet.sync();

    await splitMigration.up(db);
    await bobPhone.sync();
    await splitMigration.down(db);
    await bobTablet.sync();

    // The tablet receives the delete of Bob's row in the group (the split) and its upsert (the rejoin); the
    // person must survive.
    await expectInSync(bobTablet, bob.id);
    expect(bobTablet.people.keys().toArray()).toEqual([group]);
  });

  it('ends right on a phone that next syncs only after the split', async () => {
    const { bob, bobTablet } = await setup();
    await bobTablet.sync();

    await splitMigration.up(db);
    await bobTablet.sync();

    await expectInSync(bobTablet, bob.id);
  });
});
