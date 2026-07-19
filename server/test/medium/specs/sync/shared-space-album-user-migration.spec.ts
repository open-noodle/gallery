import { Kysely, sql } from 'kysely';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = async (db?: Kysely<DB>) => {
  const ctx = new SyncTestContext(db || defaultDatabase);
  const { auth, user } = await ctx.newSyncAuthUser();
  return { auth, user, ctx };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('shared_space_album_user grant table', () => {
  it('accepts a (userId, albumId) row and defaults createId + createdAt', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('userId', '=', auth.user.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].createId).toEqual(expect.any(String));
    expect(rows[0].createdAt).toBeDefined();
  });

  it('dedupes on (userId, albumId) primary key', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });

    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .onConflict((oc) => oc.columns(['userId', 'albumId']).doNothing())
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('cascades when the album is deleted', async () => {
    const { auth, ctx } = await setup();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: auth.user.id, albumId: album.id })
      .execute();

    await defaultDatabase.deleteFrom('album').where('id', '=', album.id).execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('cascades when the user is deleted', async () => {
    const { auth, ctx } = await setup();
    const { user: other } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: auth.user.id });
    await defaultDatabase
      .insertInto('shared_space_album_user')
      .values({ userId: other.id, albumId: album.id })
      .execute();

    await defaultDatabase.deleteFrom('user').where('id', '=', other.id).execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user')
      .selectAll()
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(0);
  });
});

describe('shared_space_album audit tables (append logs, no FKs)', () => {
  it('shared_space_album_audit accepts a (spaceId, albumId) row with defaulted id + deletedAt', async () => {
    const idResult = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const id = idResult.rows[0].id;
    const fakeSpaceResult = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const fakeSpace = fakeSpaceResult.rows[0].id;
    const fakeAlbumResult = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const fakeAlbum = fakeAlbumResult.rows[0].id;

    // No FK: a row survives even though spaceId/albumId reference nothing.
    await defaultDatabase
      .insertInto('shared_space_album_audit')
      .values({ id, spaceId: fakeSpace, albumId: fakeAlbum })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_audit')
      .selectAll()
      .where('id', '=', id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeDefined();
  });

  it('shared_space_album_user_audit accepts an (albumId, userId) row with no FK constraint', async () => {
    const idResult2 = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const id = idResult2.rows[0].id;
    const fakeAlbumResult2 = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const fakeAlbum = fakeAlbumResult2.rows[0].id;
    const fakeUserResult = await sql<{ id: string }>`SELECT immich_uuid_v7() AS id`.execute(defaultDatabase);
    const fakeUser = fakeUserResult.rows[0].id;

    await defaultDatabase
      .insertInto('shared_space_album_user_audit')
      .values({ id, albumId: fakeAlbum, userId: fakeUser })
      .execute();

    const rows = await defaultDatabase
      .selectFrom('shared_space_album_user_audit')
      .selectAll()
      .where('id', '=', id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).toBeDefined();
  });
});
