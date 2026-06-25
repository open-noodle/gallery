import { Kysely } from 'kysely';
import { SharedSpaceRole } from 'src/enum';
import { up } from 'src/schema/migrations-gallery/1779300000000-BackfillSharedSpaceAlbumUserGrants';
import { DB } from 'src/schema';
import { SyncTestContext } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

const grantsFor = (albumId: string) =>
  defaultDatabase.selectFrom('shared_space_album_user').selectAll().where('albumId', '=', albumId).execute();

describe('1779300000000-BackfillSharedSpaceAlbumUserGrants', () => {
  it('restores grants for albums linked before create-side triggers existed', async () => {
    const ctx = new SyncTestContext(defaultDatabase);

    // Create a space with two members
    const { user: owner } = await ctx.newUser();
    const { user: m1 } = await ctx.newUser();
    const { user: m2 } = await ctx.newUser();
    const { album } = await ctx.newAlbum({ ownerId: owner.id });
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    // Add members — triggers auto-grant for existing linked albums (none yet)
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: SharedSpaceRole.Owner });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m1.id, role: SharedSpaceRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: m2.id, role: SharedSpaceRole.Viewer });

    // Link album to space — create-side trigger fires and grants all 3 members
    await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: album.id, addedById: owner.id });

    // Verify trigger created grants
    const afterLink = await grantsFor(album.id);
    expect(afterLink.length).toBeGreaterThanOrEqual(2);

    // Simulate Phase-1 state: delete the trigger-created grants
    await defaultDatabase.deleteFrom('shared_space_album_user').where('albumId', '=', album.id).execute();

    // Precondition: 0 grants now
    const afterDelete = await grantsFor(album.id);
    expect(afterDelete).toHaveLength(0);

    // Run the backfill migration
    await up(defaultDatabase);

    // Assert grants are restored for all 3 members (owner + m1 + m2)
    const restored = await grantsFor(album.id);
    expect(restored).toHaveLength(3);
    expect(new Set(restored.map((g) => g.userId))).toEqual(new Set([owner.id, m1.id, m2.id]));
    // Each grant must have a non-null createId
    expect(restored.every((g) => g.createId != null)).toBe(true);

    // Idempotency: run up() a second time — still exactly 3 rows
    await up(defaultDatabase);
    const afterSecondRun = await grantsFor(album.id);
    expect(afterSecondRun).toHaveLength(3);
  });

  it('is a safe no-op on a fresh DB with no linked albums', async () => {
    // Empty tables — migration must not throw
    await expect(up(defaultDatabase)).resolves.toBeUndefined();
  });
});
