/**
An album share link made from inside a space lives only as long as the space tether that authorised it: CREATOR ×
REVOCATION matrix (CLAUDE.md rule 7, #1018).

`SharedLinkService.create` lets a space Owner/Editor publish an album linked into the space without `AlbumShare` on it
(specs/2026-08-23-space-share-links-contributed-assets-design.md, S2). The design's consent model is that such a link is
re-derived from live space state on every read: once the creator leaves the space, is demoted to Viewer, or the album
is unlinked, the link stops serving. The read gate only did that for the cross-owner contribution arm; the album's own
photos (`album_asset`) and uploads through the link kept working forever.

The gate under test is link authentication (`SharedLinkRepository.authBuilder`): a space album link whose creator
cannot share the album on their own (`AlbumShare`: album owner or album Editor) authenticates only while the creator
still holds Owner/Editor in the space and the album is still linked to it. A creator who could have shared the album
without the space keeps upstream's behaviour, whatever happens to the space.

Each cell creates the link through the real create gate, applies the revocation, then authenticates the key through
AuthService and asks the real access check whether the album and its photo are served.

Mutation-checked: without the authBuilder condition, every revoked cell of a creator without AlbumShare fails.
*/
import { Kysely } from 'kysely';
import { AlbumUserRole, Permission, SharedLinkType } from 'src/enum.js';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AuthService } from 'src/services/auth.service.js';
import { BaseService } from 'src/services/base.service.js';
import { SharedLinkService } from 'src/services/shared-link.service.js';
import { checkAccess } from 'src/utils/access.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const CREATORS = ['album owner', 'album editor', 'space owner', 'space editor'] as const;
type Creator = (typeof CREATORS)[number];

const REVOCATIONS = ['none', 'creator leaves the space', 'creator demoted to viewer', 'album unlinked'] as const;
type Revocation = (typeof REVOCATIONS)[number];

/** Whether the creator may share the album without the space (Permission.AlbumShare). */
const HAS_ALBUM_SHARE: Record<Creator, boolean> = {
  'album owner': true,
  'album editor': true,
  'space owner': false,
  'space editor': false,
};

/** The rule: a link serves while nothing was revoked, or while its creator could share the album on their own. */
const serves = (creator: Creator, revocation: Revocation) => revocation === 'none' || HAS_ALBUM_SHARE[creator];

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      CryptoRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      UserRepository,
    ],
    mock: [EventRepository, LoggingRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  return ctx;
};

type Ctx = ReturnType<typeof setup>;

/**
A space with an Owner (`host`), the album's owner and an album Editor as space Editors, and one more space Editor with
no album role. The album owner's album is linked into the space and holds one of their photos.
*/
const buildWorld = async (ctx: Ctx) => {
  const { user: host } = await ctx.newUser();
  const { user: albumOwner } = await ctx.newUser();
  const { user: albumEditor } = await ctx.newUser();
  const { user: spaceEditor } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: host.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  for (const { id } of [albumOwner, albumEditor, spaceEditor]) {
    await ctx.newSharedSpaceMember({ spaceId: space.id, userId: id, role: SharedSpaceRole.Editor });
  }

  const { asset } = await ctx.newAsset({ ownerId: albumOwner.id });
  await ctx.newExif({ assetId: asset.id, make: 'test' });
  const { result: album } = await ctx.newAlbum({ ownerId: albumOwner.id, albumName: 'linked album' }, [asset.id]);
  await ctx.newAlbumUser({ albumId: album.id, userId: albumEditor.id, role: AlbumUserRole.Editor });
  await ctx.get(SharedSpaceRepository).addAlbum({ spaceId: space.id, albumId: album.id, addedById: albumOwner.id });

  const creators: Record<Creator, { id: string }> = {
    'album owner': albumOwner,
    'album editor': albumEditor,
    'space owner': host,
    'space editor': spaceEditor,
  };

  return { space, album, asset, creators };
};

const revoke = async (
  ctx: Ctx,
  revocation: Revocation,
  { space, album, creatorId }: { space: { id: string }; album: { id: string }; creatorId: string },
) => {
  switch (revocation) {
    case 'none': {
      return;
    }
    case 'creator leaves the space': {
      await ctx.database
        .deleteFrom('shared_space_member')
        .where('spaceId', '=', space.id)
        .where('userId', '=', creatorId)
        .execute();
      return;
    }
    case 'creator demoted to viewer': {
      await ctx.database
        .updateTable('shared_space_member')
        .set({ role: SharedSpaceRole.Viewer })
        .where('spaceId', '=', space.id)
        .where('userId', '=', creatorId)
        .execute();
      return;
    }
    case 'album unlinked': {
      await ctx.database
        .deleteFrom('shared_space_album')
        .where('spaceId', '=', space.id)
        .where('albumId', '=', album.id)
        .execute();
      return;
    }
  }
};

/** What an anonymous visitor holding the key gets: nothing when the key no longer authenticates. */
const visit = async (ctx: Ctx, key: string, { album, asset }: { album: { id: string }; asset: { id: string } }) => {
  const auth = await ctx
    .getService(AuthService)
    .validateSharedLinkKey(key)
    .catch(() => null);
  if (!auth) {
    return { authenticates: false, album: false, asset: false };
  }

  const access = ctx.get(AccessRepository);
  const albums = await checkAccess(access, { auth, permission: Permission.AlbumRead, ids: new Set([album.id]) });
  const assets = await checkAccess(access, { auth, permission: Permission.AssetView, ids: new Set([asset.id]) });
  return { authenticates: true, album: albums.has(album.id), asset: assets.has(asset.id) };
};

const grid: Partial<Record<Creator, Partial<Record<Revocation, string>>>> = {};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('an album share link made from a space', () => {
  describe.each(CREATORS)('created by the %s', (creator) => {
    it.each(REVOCATIONS)('revocation: %s', async (revocation) => {
      const ctx = setup();
      const world = await buildWorld(ctx);
      const creatorId = world.creators[creator].id;

      const link = await ctx.getService(SharedLinkService).create(factory.auth({ user: { id: creatorId } }), {
        type: SharedLinkType.Album,
        albumId: world.album.id,
        spaceId: world.space.id,
        allowUpload: true,
      });
      // Every link serves before anything is revoked, so a cell that expects nothing cannot pass vacuously.
      await expect(visit(ctx, link.key, world)).resolves.toEqual({ authenticates: true, album: true, asset: true });

      await revoke(ctx, revocation, { space: world.space, album: world.album, creatorId });
      const outcome = await visit(ctx, link.key, world);

      const expected = serves(creator, revocation);
      expect(outcome).toEqual({ authenticates: expected, album: expected, asset: expected });

      grid[creator] ??= {};
      grid[creator][revocation] = outcome.authenticates ? 'serves' : 'revoked';
    });
  });

  it('outcome grid', () => {
    expect(Object.keys(grid).toSorted()).toEqual([...CREATORS].toSorted());
    expect(grid).toMatchSnapshot();
  });
});
