import { Kysely, sql } from 'kysely';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { DB } from 'src/schema';
// Side-effect import: registers every decorated table so the schema exists to assert against.
import 'src/schema';
import { seedHiddenRowsFromSharedFlag } from 'src/schema/migrations-gallery/1793000000000-AddSharedSpaceAlbumHidden';
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

const auditRows = async (userId: string) =>
  db.selectFrom('shared_space_album_hidden_audit').selectAll().where('userId', '=', userId).execute();

describe('shared_space_album_hidden delete audit', () => {
  it('writes an audit row when a member unhides an album', async () => {
    const { user, space, album } = await seedHiddenAlbum();
    expect(await auditRows(user.id)).toHaveLength(0);

    await db
      .deleteFrom('shared_space_album_hidden')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .where('userId', '=', user.id)
      .execute();

    const rows = await auditRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spaceId: space.id, albumId: album.id, userId: user.id });
  });

  it('writes one audit row per deleted row for a multi-row statement', async () => {
    // The trigger is statement-level with a transition table; a per-row trigger would also pass
    // the single-row test above, so this is the case that distinguishes them.
    const { ctx, spaceRepo, user, space } = await seedHiddenAlbum();
    const { result: second } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Hidden2' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: second.id, addedById: user.id });
    await db
      .insertInto('shared_space_album_hidden')
      .values({ spaceId: space.id, albumId: second.id, userId: user.id })
      .execute();

    await db.deleteFrom('shared_space_album_hidden').where('userId', '=', user.id).execute();

    expect(await auditRows(user.id)).toHaveLength(2);
  });

  it('writes an audit row when the row disappears via the unlink cascade', async () => {
    // Mobile must learn about the unhide however it happened, not only via an explicit delete.
    const { spaceRepo, user, space, album } = await seedHiddenAlbum();

    await spaceRepo.removeAlbum(space.id, album.id);

    const rows = await auditRows(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spaceId: space.id, albumId: album.id });
  });
});

// The seeding function takes the sql-tools Kysely<unknown> contract; the medium harness hands
// out Kysely<DB>. Kysely's schema generic is invariant, so narrow once here.
const seed = () => seedHiddenRowsFromSharedFlag(db as unknown as Kysely<unknown>);

describe('migration seeding', () => {
  it('E18: seeds a hidden row for every member of a space whose album is hidden by the shared flag', async () => {
    const { ctx, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { user: second } = await ctx.newUser();
    const { user: third } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    for (const [u, role] of [
      [owner, 'owner'],
      [second, 'editor'],
      [third, 'viewer'],
    ] as const) {
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: u.id, role });
    }
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SharedHidden' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);

    await seed();

    const rows = await db
      .selectFrom('shared_space_album_hidden')
      .select('userId')
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(rows.map((r) => r.userId).toSorted()).toEqual([owner.id, second.id, third.id].toSorted());
  });

  it('E18b: does not seed rows for an album that is shown', async () => {
    const { ctx, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'SharedShown' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    await seed();

    const rows = await db
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(0);
  });

  it('E19: is a no-op when there are no hidden albums', async () => {
    const before = await db
      .selectFrom('shared_space_album_hidden')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .execute();

    await expect(seed()).resolves.not.toThrow();

    const after = await db
      .selectFrom('shared_space_album_hidden')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .execute();
    expect(Number(after[0].count)).toBe(Number(before[0].count));
  });

  it('E20: a member who joins after the seeding gets no hidden row', async () => {
    const { ctx, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'LateJoin' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);
    await seed();

    const { user: latecomer } = await ctx.newUser();
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: latecomer.id, role: 'viewer' });

    const rows = await db
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('userId', '=', latecomer.id)
      .execute();
    // Seeding is a ONE-TIME upgrade step, not an ongoing rule. A member joining later sees the
    // album in their timeline until they hide it themselves.
    expect(rows).toHaveLength(0);
  });

  it('is idempotent — running it twice does not error or duplicate', async () => {
    const { ctx, spaceRepo } = setup();
    const { user: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
    const { result: album } = await ctx.newAlbum({ ownerId: owner.id, albumName: 'Twice' });
    await spaceRepo.addAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });
    await spaceRepo.setAlbumShowInTimeline(space.id, album.id, false);

    await seed();
    await expect(seed()).resolves.not.toThrow();

    const rows = await db
      .selectFrom('shared_space_album_hidden')
      .selectAll()
      .where('spaceId', '=', space.id)
      .where('albumId', '=', album.id)
      .execute();
    expect(rows).toHaveLength(1);
  });
});
