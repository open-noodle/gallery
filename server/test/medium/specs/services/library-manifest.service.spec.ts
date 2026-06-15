import { NotFoundException } from '@nestjs/common';
import { Kysely } from 'kysely';
import { AssetStatus, AssetType, AssetVisibility, ChecksumAlgorithm } from 'src/enum';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { LibraryManifestService } from 'src/services/library-manifest.service';
import { newMediumService } from 'test/medium.factory';
import { factory, newUuid } from 'test/small.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = (db?: Kysely<DB>) => {
  return newMediumService(LibraryManifestService, {
    database: db || defaultDatabase,
    real: [AssetRepository, UserRepository, AlbumRepository],
    mock: [LoggingRepository],
  });
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe(LibraryManifestService.name, () => {
  describe('getManifest', () => {
    it('returns the owner and a mapped asset for an owned, active asset', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const checksum = Buffer.from('0123456789abcdef0123', 'utf8');
      const { asset } = await ctx.newAsset({
        ownerId: user.id,
        checksum,
        checksumAlgorithm: ChecksumAlgorithm.sha1File,
        type: AssetType.Image,
        originalPath: 'upload/library/user/2026/photo.jpg',
        originalFileName: 'photo.jpg',
      });
      await ctx.newExif({ assetId: asset.id, fileSizeInByte: 123_456 });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.owner).toEqual({ id: user.id, email: user.email });
      expect(result.manifestSchemaVersion).toBe(1);
      expect(result.generatedAt).toEqual(expect.any(String));
      expect(result.albums).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.assets).toEqual([
        expect.objectContaining({
          assetId: asset.id,
          objectKey: 'upload/library/user/2026/photo.jpg',
          originalFileName: 'photo.jpg',
          checksum: checksum.toString('base64'),
          checksumAlgorithm: ChecksumAlgorithm.sha1File,
          size: 123_456,
          type: AssetType.Image,
          albumIds: [],
        }),
      ]);
    });

    it("only returns the target user's assets", async () => {
      const { sut, ctx } = setup();
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset: mine } = await ctx.newAsset({ ownerId: owner.id });
      await ctx.newAsset({ ownerId: other.id });

      const auth = factory.auth({ user: { id: owner.id } });
      const result = await sut.getManifest(auth, owner.id);

      expect(result.assets.map((a) => a.assetId)).toEqual([mine.id]);
    });

    it('excludes trashed and permanently-deleted assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: active } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAsset({ ownerId: user.id, status: AssetStatus.Trashed, deletedAt: new Date() });
      await ctx.newAsset({ ownerId: user.id, status: AssetStatus.Deleted, deletedAt: new Date() });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.map((a) => a.assetId)).toEqual([active.id]);
    });

    it('excludes external-library assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: managed } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAsset({ ownerId: user.id, isExternal: true });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.map((a) => a.assetId)).toEqual([managed.id]);
    });

    it('includes assets of every visibility', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const ids = [];
      for (const visibility of [
        AssetVisibility.Timeline,
        AssetVisibility.Archive,
        AssetVisibility.Hidden,
        AssetVisibility.Locked,
      ]) {
        const { asset } = await ctx.newAsset({ ownerId: user.id, visibility });
        ids.push(asset.id);
      }

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.map((a) => a.assetId).toSorted()).toEqual(ids.toSorted());
    });

    it('returns size null when the asset has no exif row', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets).toEqual([expect.objectContaining({ assetId: asset.id, size: null })]);
    });

    it('returns an empty manifest for a user with no assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(result.albums).toEqual([]);
    });

    it("still exports a deactivated (soft-deleted) user's library", async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser({ deletedAt: new Date() });
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.owner.id).toBe(user.id);
      expect(result.assets.map((a) => a.assetId)).toEqual([asset.id]);
    });

    it('throws NotFoundException for a user that does not exist', async () => {
      const { sut } = setup();
      const missingId = newUuid();
      const auth = factory.auth({ user: { id: missingId } });

      await expect(sut.getManifest(auth, missingId)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('sets nextCursor and trims to pageSize when more rows remain', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const made = [];
      for (let i = 0; i < 3; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        made.push(asset.id);
      }
      const ordered = [...made].toSorted();
      const auth = factory.auth({ user: { id: user.id } });

      const page1 = await sut.getManifest(auth, user.id, undefined, 2);
      expect(page1.assets.map((a) => a.assetId)).toEqual(ordered.slice(0, 2));
      expect(page1.nextCursor).toBe(ordered[1]);

      const page2 = await sut.getManifest(auth, user.id, page1.nextCursor ?? undefined, 2);
      expect(page2.assets.map((a) => a.assetId)).toEqual([ordered[2]]);
      expect(page2.nextCursor).toBeNull();
    });

    it('returns nextCursor null when the page exactly equals pageSize', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await ctx.newAsset({ ownerId: user.id });
      await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const page = await sut.getManifest(auth, user.id, undefined, 2);
      expect(page.assets).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('paginates to exhaustion with no duplicates or skips', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const all = new Set<string>();
      for (let i = 0; i < 5; i++) {
        const { asset } = await ctx.newAsset({ ownerId: user.id });
        all.add(asset.id);
      }
      const auth = factory.auth({ user: { id: user.id } });

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await sut.getManifest(auth, user.id, cursor, 2);
        seen.push(...page.assets.map((a) => a.assetId));
        if (!page.nextCursor) {
          break;
        }
        cursor = page.nextCursor;
      }
      expect(seen).toHaveLength(5);
      expect(new Set(seen)).toEqual(all);
    });

    it('returns an empty page for a cursor past the end', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      const page = await sut.getManifest(auth, user.id, 'ffffffff-ffff-4fff-bfff-ffffffffffff', 2);
      expect(page.assets).toEqual([]);
      expect(page.nextCursor).toBeNull();
    });

    it('accepts a cursor whose asset no longer exists (returns rows ordered after it)', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const auth = factory.auth({ user: { id: user.id } });

      // a random uuid less-than the existing id is unlikely; use a known-small cursor
      const page = await sut.getManifest(auth, user.id, '00000000-0000-4000-8000-000000000000', 2);
      expect(page.assets.map((a) => a.assetId)).toContain(asset.id);
    });

    it('populates albumIds for an asset in multiple owned albums and lists the albums', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album: a1 } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Trip' }, [asset.id]);
      const { album: a2 } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Family' }, [asset.id]);

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      const entry = result.assets.find((x) => x.assetId === asset.id)!;
      expect(entry.albumIds.toSorted()).toEqual([a1.id, a2.id].toSorted());
      expect(result.albums.map((al) => al.id).toSorted()).toEqual([a1.id, a2.id].toSorted());
      expect(result.albums).toEqual(
        expect.arrayContaining([
          { id: a1.id, name: 'Trip' },
          { id: a2.id, name: 'Family' },
        ]),
      );
    });

    it('gives an asset in no album an empty albumIds', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.find((x) => x.assetId === asset.id)!.albumIds).toEqual([]);
    });

    it('does not include foreign shared-album membership and keeps the envelope consistent', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      // other user's album containing this user's asset (a shared album owned by someone else)
      await ctx.newAlbum({ ownerId: other.id, albumName: 'Shared' }, [asset.id]);

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      const entry = result.assets.find((x) => x.assetId === asset.id)!;
      expect(entry.albumIds).toEqual([]);
      // consistency invariant: every albumId referenced resolves in `albums`
      const albumIdSet = new Set(result.albums.map((al) => al.id));
      for (const a of result.assets) {
        for (const albumId of a.albumIds) {
          expect(albumIdSet.has(albumId)).toBe(true);
        }
      }
    });

    it('repeats the same albums list on every page', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset: a } = await ctx.newAsset({ ownerId: user.id });
      const { asset: b } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newAlbum({ ownerId: user.id, albumName: 'All' }, [a.id, b.id]);

      const auth = factory.auth({ user: { id: user.id } });
      const page1 = await sut.getManifest(auth, user.id, undefined, 1);
      const page2 = await sut.getManifest(auth, user.id, page1.nextCursor ?? undefined, 1);

      expect(page1.albums).toEqual(page2.albums);
      expect(page1.albums).toHaveLength(1);
    });

    it('serializes timestamps as ISO strings and stamps a valid generatedAt', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const fileCreatedAt = new Date('2021-01-02T03:04:05.000Z');
      const fileModifiedAt = new Date('2022-06-07T08:09:10.000Z');
      const { asset } = await ctx.newAsset({ ownerId: user.id, fileCreatedAt, fileModifiedAt });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      const entry = result.assets.find((x) => x.assetId === asset.id)!;
      expect(entry.fileCreatedAt).toBe('2021-01-02T03:04:05.000Z');
      expect(entry.fileModifiedAt).toBe('2022-06-07T08:09:10.000Z');
      expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
    });

    it('passes through non-image asset types', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.find((x) => x.assetId === asset.id)!.type).toBe(AssetType.Video);
    });

    it('lists an owned album that has no assets', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      await ctx.newAsset({ ownerId: user.id });
      const { album: empty } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Empty' });

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.albums.map((al) => al.id)).toContain(empty.id);
    });

    it('includes only owned-album ids for an asset that is also in a foreign album', async () => {
      const { sut, ctx } = setup();
      const { user } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album: owned } = await ctx.newAlbum({ ownerId: user.id, albumName: 'Mine' }, [asset.id]);
      await ctx.newAlbum({ ownerId: other.id, albumName: 'Theirs' }, [asset.id]);

      const auth = factory.auth({ user: { id: user.id } });
      const result = await sut.getManifest(auth, user.id);

      expect(result.assets.find((x) => x.assetId === asset.id)!.albumIds).toEqual([owned.id]);
    });
  });
});
