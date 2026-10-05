import { Kysely } from 'kysely';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { OcrRepository } from 'src/repositories/ocr.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { AssetService } from 'src/services/asset.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(AssetService, {
    database: db || defaultDatabase,
    real: [
      AssetRepository,
      AssetEditRepository,
      AssetJobRepository,
      AlbumRepository,
      AccessRepository,
      SharedLinkAssetRepository,
      SharedSpaceRepository,
      StackRepository,
      UserRepository,
      SharedLinkRepository,
    ],
    mock: [EventRepository, LoggingRepository, JobRepository, StorageRepository, OcrRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(AssetService.name, () => {
  describe('shared space permissions', () => {
    describe('asset access by role', () => {
      it('should allow asset read for any space member', async () => {
        const { sut, ctx } = setup();
        const { user: owner } = await ctx.newUser();
        const { user: viewer } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        // Add asset to space
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

        // Add viewer member to space
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

        const auth = factory.auth({ user: { id: viewer.id } });

        // Should be able to read asset
        await expect(sut.get(auth, asset.id)).resolves.toBeDefined();
      });

      it('should deny asset edit if user is VIEWER role', async () => {
        const { sut, ctx } = setup();
        ctx.getMock(JobRepository).queue.mockResolvedValue();
        const { user: owner } = await ctx.newUser();
        const { user: viewer } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        // Add asset to space
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

        // #734 spec §2.3: checkSpaceEditAccess requires the asset's owner to also be a member of
        // the space granting the caller their role — see the EDITOR test below for the full
        // rationale. Without this row the denial would come from the owner-is-member EXISTS, not
        // from the role gate this test is meant to cover.
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

        // Add viewer member to space
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: viewer.id, role: 'viewer' });

        const auth = factory.auth({ user: { id: viewer.id } });

        // Should NOT be able to edit asset
        await expect(sut.update(auth, asset.id, { description: 'new' })).rejects.toThrow();
      });

      it('should allow asset edit if user is EDITOR role', async () => {
        const { sut, ctx } = setup();
        ctx.getMock(JobRepository).queue.mockResolvedValue();
        const { user: owner } = await ctx.newUser();
        const { user: editor } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        // Add asset to space
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

        // #734 spec §2.3: checkSpaceEditAccess requires the asset's owner to also be a member of
        // the space granting the caller their role — an editor may act on a fellow MEMBER's
        // asset, not on any asset merely reachable through the space. Without this row the owner
        // isn't a member, so this test would assert the pre-#734 behaviour instead of the
        // scenario it's meant to cover.
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

        // Add editor member to space
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: editor.id, role: 'editor' });

        const auth = factory.auth({ user: { id: editor.id } });

        // Should be able to edit asset
        await expect(sut.update(auth, asset.id, { description: 'new' })).resolves.toBeDefined();
      });

      it('should allow asset edit if user is ADMIN role', async () => {
        const { sut, ctx } = setup();
        ctx.getMock(JobRepository).queue.mockResolvedValue();
        const { user: owner } = await ctx.newUser();
        const { user: admin } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        // Add asset to space
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

        // #734 spec §2.3: checkSpaceEditAccess requires the asset's owner to also be a member of
        // the space granting the caller their role — see the EDITOR test above for the full
        // rationale.
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });

        // Add admin member to space
        await ctx.newSharedSpaceMember({ spaceId: space.id, userId: admin.id, role: 'owner' });

        const auth = factory.auth({ user: { id: admin.id } });

        // Should be able to edit asset
        await expect(sut.update(auth, asset.id, { description: 'new' })).resolves.toBeDefined();
      });
    });

    describe('asset access control on lifecycle', () => {
      it('should deny access when user is removed from space', async () => {
        const { sut, ctx } = setup();
        const { user: owner } = await ctx.newUser();
        const { user: member } = await ctx.newUser();
        const { space } = await ctx.newSharedSpace({ createdById: owner.id });
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        // Add asset to space
        await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: owner.id });

        // Add member to space
        await ctx.newSharedSpaceMember({
          spaceId: space.id,
          userId: member.id,
          role: 'editor',
        });

        const auth = factory.auth({ user: { id: member.id } });

        // Can access while member
        await expect(sut.get(auth, asset.id)).resolves.toBeDefined();

        // Remove from space
        await defaultDatabase
          .deleteFrom('shared_space_member')
          .where('spaceId', '=', space.id)
          .where('userId', '=', member.id)
          .execute();

        // Can't access after removal
        await expect(sut.get(auth, asset.id)).rejects.toThrow();
      });
    });

    describe('non-space assets', () => {
      it('should allow owner to access asset not in space', async () => {
        const { sut, ctx } = setup();
        const { user: owner } = await ctx.newUser();
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        const auth = factory.auth({ user: { id: owner.id } });

        // Owner should be able to access their own asset
        await expect(sut.get(auth, asset.id)).resolves.toBeDefined();
      });

      it('should deny non-owner access to asset not in space', async () => {
        const { sut, ctx } = setup();
        const { user: owner } = await ctx.newUser();
        const { user: other } = await ctx.newUser();
        const { asset } = await ctx.newAsset({ ownerId: owner.id });

        const auth = factory.auth({ user: { id: other.id } });

        // Non-owner should NOT be able to access asset not in space
        await expect(sut.get(auth, asset.id)).rejects.toThrow();
      });
    });
  });
});
