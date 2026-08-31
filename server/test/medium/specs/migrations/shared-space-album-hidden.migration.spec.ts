import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
// Side-effect import: registers every decorated table so the schema exists to assert against.
import 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

let db: Kysely<DB>;

beforeAll(async () => {
  db = await getKyselyDB();
});

describe('shared_space_album_hidden schema', () => {
  it('creates the table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shared_space_album_hidden'
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual([
      'albumId',
      'createId',
      'createdAt',
      'spaceId',
      'updateId',
      'updatedAt',
      'userId',
    ]);
  });

  it('creates the audit table with the expected columns', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shared_space_album_hidden_audit'
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual([
      'albumId',
      'deletedAt',
      'id',
      'spaceId',
      'userId',
    ]);
  });

  it('keys the hidden row on (spaceId, albumId, userId)', async () => {
    const rows = await sql<{ column_name: string }>`
      SELECT a.attname AS column_name
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = 'shared_space_album_hidden'::regclass AND i.indisprimary
    `.execute(db);
    expect(rows.rows.map((r) => r.column_name).toSorted()).toEqual(['albumId', 'spaceId', 'userId']);
  });
});

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: db,
    real: [SharedSpaceRepository],
    mock: [LoggingRepository],
  });
  return { ctx, spaceRepo: ctx.get(SharedSpaceRepository) };
};

// Seeds a space with one member and one linked album, and hides it for that member.
const seedHiddenAlbum = async () => {
  const { ctx, spaceRepo } = setup();
  const { user } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: user.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: user.id, role: 'owner' });
  const { result: album } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Hidden' });
  await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });
  await db
    .insertInto('shared_space_album_hidden')
    .values({ spaceId: space.id, albumId: album.id, userId: user.id })
    .execute();
  return { ctx, spaceRepo, user, space, album };
};

const hiddenCount = async (spaceId: string, albumId: string, userId: string) => {
  const rows = await db
    .selectFrom('shared_space_album_hidden')
    .select((eb) => eb.fn.countAll<number>().as('count'))
    .where('spaceId', '=', spaceId)
    .where('albumId', '=', albumId)
    .where('userId', '=', userId)
    .execute();
  return Number(rows[0].count);
};

describe('shared_space_album_hidden cleanup', () => {
  it('E11: unlinking the album from the space removes the hidden row', async () => {
    const { spaceRepo, user, space, album } = await seedHiddenAlbum();
    expect(await hiddenCount(space.id, album.id, user.id)).toBe(1);

    await spaceRepo.removeAlbum(space.id, album.id);

    expect(await hiddenCount(space.id, album.id, user.id)).toBe(0);
  });

  it('E11b: re-linking the album after an unlink does not resurrect the hidden state', async () => {
    const { spaceRepo, user, space, album } = await seedHiddenAlbum();
    await spaceRepo.removeAlbum(space.id, album.id);

    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: user.id });

    expect(await hiddenCount(space.id, album.id, user.id)).toBe(0);
  });

  it('E14: removing the member leaves the hidden row in place (inert by design)', async () => {
    const { ctx, user, space, album } = await seedHiddenAlbum();
    const { user: other } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: other.id, role: 'viewer' });

    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', user.id)
      .execute();

    // Membership removal deliberately does not cascade: there is no FK to shared_space_member,
    // and resolution is membership-scoped, so the row cannot affect any timeline.
    expect(await hiddenCount(space.id, album.id, user.id)).toBe(1);
  });

  it('E14b: rejoining the space restores the previous hiding preference', async () => {
    const { user, space, album } = await seedHiddenAlbum();
    await db
      .deleteFrom('shared_space_member')
      .where('spaceId', '=', space.id)
      .where('userId', '=', user.id)
      .execute();

    await db
      .insertInto('shared_space_member')
      .values({ spaceId: space.id, userId: user.id, role: 'owner' })
      .execute();

    expect(await hiddenCount(space.id, album.id, user.id)).toBe(1);
  });

  it('deleting the user removes the hidden row', async () => {
    const { user, space, album } = await seedHiddenAlbum();

    await db.deleteFrom('user').where('id', '=', user.id).execute();

    expect(await hiddenCount(space.id, album.id, user.id)).toBe(0);
  });
});
