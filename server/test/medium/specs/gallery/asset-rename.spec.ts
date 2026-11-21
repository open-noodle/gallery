import { Kysely, sql } from 'kysely';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AssetFileType,
  AssetRenameTargetState,
  AssetStatus,
  ChecksumAlgorithm,
  DatabaseLock,
  JobName,
} from 'src/enum.js';
import { FileOperationRepository } from 'src/gallery/repositories/file-operation.repository.js';
import { AssetRenameService } from 'src/gallery/services/asset-rename.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LibraryRepository } from 'src/repositories/library.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { LibraryService } from 'src/services/library.service.js';
import { MediumTestContext, newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;
let root: string;

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  root = await mkdtemp(path.join(tmpdir(), 'gallery-rename-'));
  return () => rm(root, { recursive: true, force: true });
});

const real = [
  AccessRepository,
  AssetRepository,
  CryptoRepository,
  FileOperationRepository,
  LibraryRepository,
  StorageRepository,
  UserRepository,
];
const mock = [EventRepository, JobRepository, LoggingRepository];

const setup = async () => {
  const { sut, ctx } = newMediumService(AssetRenameService, { database: defaultDatabase, real, mock });
  ctx.getMock(JobRepository).queueAll.mockResolvedValue(void 0);
  const { user } = await ctx.newUser();
  const folder = await mkdtemp(path.join(root, 'library-'));
  const { id: libraryId } = await defaultDatabase
    .insertInto('library')
    .values({ name: 'External', ownerId: user.id, importPaths: [folder], exclusionPatterns: ['**/excluded*'] })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { sut, ctx, user, folder, libraryId, auth: factory.auth({ user: { id: user.id, email: user.email } }) };
};

type Setup = Awaited<ReturnType<typeof setup>>;

const pathChecksum = (file: string) => new CryptoRepository().hashSha1(`path:${file}`);

const addAsset = async (
  { ctx, user, folder, libraryId }: Setup,
  fileName: string,
  overrides: Record<string, unknown> = {},
) => {
  const originalPath = path.join(folder, fileName);
  await writeFile(originalPath, 'content');
  const { asset } = await ctx.newAsset({
    ownerId: user.id,
    libraryId,
    isExternal: true,
    originalPath,
    originalFileName: fileName,
    checksum: pathChecksum(originalPath),
    checksumAlgorithm: ChecksumAlgorithm.sha1Path,
    ...overrides,
  });
  return asset;
};

/** An item whose file is gone, at `b.jpg` in the folder. */
const ghostAtB = async (s: Setup, overrides: Record<string, unknown>) => {
  const asset = await addAsset(s, 'b.jpg', overrides);
  await rm(asset.originalPath);
  return asset;
};

const row = (id: string) =>
  defaultDatabase
    .selectFrom('asset')
    .select(['id', 'originalPath', 'originalFileName', 'checksum', 'deletedAt', 'status', 'isOffline'])
    .where('id', '=', id)
    .executeTakeFirst();

const files = async (folder: string) => {
  const names = await readdir(folder);
  return names.toSorted();
};

/** Holds the file-operation lock on its own connection until released. */
const holdLock = async () => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  let acquired!: () => void;
  const ready = new Promise<void>((resolve) => (acquired = resolve));
  const done = defaultDatabase.connection().execute(async (connection) => {
    await sql`SELECT pg_advisory_lock(${DatabaseLock.FileOperation})`.execute(connection);
    acquired();
    await released;
    await sql`SELECT pg_advisory_unlock(${DatabaseLock.FileOperation})`.execute(connection);
  });
  await ready;
  return async () => {
    release();
    await done;
  };
};

describe(AssetRenameService.name, () => {
  describe('rename on disk', () => {
    it('renames the file and its sidecars, and moves the row to the new path and checksum, keeping its id', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'IMG_0007.JPEG');
      await writeFile(path.join(s.folder, 'IMG_0007.JPEG.xmp'), '<x/>');
      await writeFile(path.join(s.folder, 'IMG_0007.xmp'), '<x/>');
      await s.ctx.newAssetFile({
        assetId: asset.id,
        type: AssetFileType.Sidecar,
        path: path.join(s.folder, 'IMG_0007.JPEG.xmp'),
      });

      const response = await s.sut.rename(s.auth, asset.id, { fileName: 'Beach 2006-08', renameOnDisk: true });

      const newPath = path.join(s.folder, 'Beach 2006-08.jpg');
      expect(response).toEqual({ originalFileName: 'Beach 2006-08.jpg', originalPath: newPath });
      expect(await files(s.folder)).toEqual(['Beach 2006-08.jpg', 'Beach 2006-08.jpg.xmp', 'Beach 2006-08.xmp']);
      await expect(row(asset.id)).resolves.toMatchObject({
        originalPath: newPath,
        originalFileName: 'Beach 2006-08.jpg',
        checksum: pathChecksum(newPath),
      });
      const sidecar = await defaultDatabase
        .selectFrom('asset_file')
        .select('path')
        .where('assetId', '=', asset.id)
        .where('type', '=', AssetFileType.Sidecar)
        .executeTakeFirstOrThrow();
      expect(sidecar.path).toBe(`${newPath}.xmp`);
    });

    it('leaves no probe file behind', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');

      await s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true });

      expect(await files(s.folder)).toEqual(['b.jpg']);
    });

    it('can rename a file and then rename it back', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');

      await s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true });
      await s.sut.rename(s.auth, asset.id, { fileName: 'a', renameOnDisk: true });

      expect(await files(s.folder)).toEqual(['a.jpg']);
      await expect(row(asset.id)).resolves.toMatchObject({
        originalPath: path.join(s.folder, 'a.jpg'),
        checksum: pathChecksum(path.join(s.folder, 'a.jpg')),
      });
    });

    it('lets a scan add a new file at the old path after the rename', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true });

      const oldPath = path.join(s.folder, 'a.jpg');
      await expect(
        s.ctx.newAsset({
          ownerId: s.user.id,
          libraryId: s.libraryId,
          isExternal: true,
          originalPath: oldPath,
          checksum: pathChecksum(oldPath),
          checksumAlgorithm: ChecksumAlgorithm.sha1Path,
        }),
      ).resolves.toBeDefined();
    });

    it('renames both files of a live photo as one unit', async () => {
      const s = await setup();
      const motion = await addAsset(s, 'IMG_0007.MOV');
      const still = await addAsset(s, 'IMG_0007.HEIC', { livePhotoVideoId: motion.id });
      await writeFile(path.join(s.folder, 'IMG_0007.xmp'), '<x/>');

      await s.sut.rename(s.auth, still.id, { fileName: 'Beach', renameOnDisk: true });

      expect(await files(s.folder)).toEqual(['Beach.heic', 'Beach.mov', 'Beach.xmp']);
      await expect(row(still.id)).resolves.toMatchObject({ originalPath: path.join(s.folder, 'Beach.heic') });
      await expect(row(motion.id)).resolves.toMatchObject({
        originalPath: path.join(s.folder, 'Beach.mov'),
        originalFileName: 'Beach.mov',
      });
    });

    it('refuses a live photo, changing nothing, when the motion video would collide', async () => {
      const s = await setup();
      const motion = await addAsset(s, 'IMG_0007.MOV');
      const still = await addAsset(s, 'IMG_0007.HEIC', { livePhotoVideoId: motion.id });
      await writeFile(path.join(s.folder, 'Beach.mov'), 'other');

      await expect(s.sut.rename(s.auth, still.id, { fileName: 'Beach', renameOnDisk: true })).rejects.toMatchObject({
        status: 409,
      });

      expect(await files(s.folder)).toEqual(['Beach.mov', 'IMG_0007.HEIC', 'IMG_0007.MOV']);
      await expect(row(still.id)).resolves.toMatchObject({ originalPath: path.join(s.folder, 'IMG_0007.HEIC') });
    });

    it('refuses a name the library excludes', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');

      await expect(
        s.sut.rename(s.auth, asset.id, { fileName: 'excluded copy', renameOnDisk: true }),
      ).rejects.toMatchObject({ status: 400 });

      expect(await files(s.folder)).toEqual(['a.jpg']);
    });

    it('refuses a folder that is not writable, changing nothing', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await rm(s.folder, { recursive: true });
      await mkdir(s.folder);
      await writeFile(path.join(s.folder, 'a.jpg'), 'content');
      const storage = s.ctx.get(StorageRepository);
      vi.spyOn(storage, 'createFile').mockRejectedValueOnce(Object.assign(new Error('ro'), { code: 'EROFS' }));

      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toThrow(/read-only/);

      expect(await files(s.folder)).toEqual(['a.jpg']);
      await expect(row(asset.id)).resolves.toMatchObject({ originalPath: path.join(s.folder, 'a.jpg') });
    });

    it('puts the file back when the row can no longer be updated', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      const operations = s.ctx.get(FileOperationRepository);
      const apply = operations.applyRename.bind(operations);
      vi.spyOn(operations, 'applyRename').mockImplementationOnce(async (plan) => {
        await defaultDatabase.deleteFrom('asset').where('id', '=', asset.id).execute();
        return apply(plan);
      });

      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toMatchObject({
        status: 409,
      });

      expect(await files(s.folder)).toEqual(['a.jpg']);
    });
  });

  describe('the name at the new path', () => {
    it('removes an offline item and renames', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      const offline = await ghostAtB(s, { isOffline: true, deletedAt: new Date() });

      await expect(s.sut.check(s.auth, asset.id, { fileName: 'b' })).resolves.toEqual({
        state: AssetRenameTargetState.Offline,
      });
      await s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true });

      expect(await files(s.folder)).toEqual(['b.jpg']);
      await expect(row(asset.id)).resolves.toMatchObject({
        originalPath: path.join(s.folder, 'b.jpg'),
        checksum: pathChecksum(path.join(s.folder, 'b.jpg')),
      });
      // set aside at once, so a scan cannot bring it back before its deletion job runs
      const aside = await row(offline.id);
      expect(aside?.originalPath).toBe(`${offline.originalPath}.replaced-${offline.id}`);
      expect(aside?.checksum).not.toEqual(pathChecksum(offline.originalPath));
      expect(s.ctx.getMock(JobRepository).queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDelete, data: { id: offline.id, deleteOnDisk: false } },
      ]);
    });

    it('asks before it removes an item the user trashed', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      const trashed = await ghostAtB(s, { status: AssetStatus.Trashed, deletedAt: new Date() });

      await expect(s.sut.check(s.auth, asset.id, { fileName: 'b' })).resolves.toEqual({
        state: AssetRenameTargetState.Trashed,
      });
      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toMatchObject({
        status: 409,
        response: { state: AssetRenameTargetState.Trashed },
      });

      expect(await files(s.folder)).toEqual(['a.jpg']);
      await expect(row(trashed.id)).resolves.toMatchObject({ originalPath: trashed.originalPath });
      expect(s.ctx.getMock(JobRepository).queueAll).not.toHaveBeenCalled();

      await s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true, deleteTrashed: true });

      expect(await files(s.folder)).toEqual(['b.jpg']);
      expect(s.ctx.getMock(JobRepository).queueAll).toHaveBeenCalledWith([
        { name: JobName.AssetDelete, data: { id: trashed.id, deleteOnDisk: false } },
      ]);
    });

    it('refuses a name held by a file on disk', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await addAsset(s, 'b.jpg');

      await expect(s.sut.check(s.auth, asset.id, { fileName: 'b' })).resolves.toEqual({
        state: AssetRenameTargetState.Exists,
      });
      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toMatchObject({
        status: 409,
      });

      expect(await files(s.folder)).toEqual(['a.jpg', 'b.jpg']);
    });

    it('refuses a name held by a live item whose file is missing', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await ghostAtB(s, {});

      await expect(s.sut.check(s.auth, asset.id, { fileName: 'b' })).resolves.toEqual({
        state: AssetRenameTargetState.Exists,
      });
    });

    it('does not run these checks for a rename of the name only', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await addAsset(s, 'b.jpg');

      await s.sut.rename(s.auth, asset.id, { fileName: 'b' });

      await expect(row(asset.id)).resolves.toMatchObject({
        originalFileName: 'b.jpg',
        originalPath: path.join(s.folder, 'a.jpg'),
      });
      expect(await files(s.folder)).toEqual(['a.jpg', 'b.jpg']);
    });
  });

  describe('the file-operation lock', () => {
    it('refuses a rename while another file operation holds it, changing nothing', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      const release = await holdLock();

      try {
        await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toMatchObject({
          status: 409,
        });
        expect(await files(s.folder)).toEqual(['a.jpg']);
        await expect(row(asset.id)).resolves.toMatchObject({ originalPath: path.join(s.folder, 'a.jpg') });
      } finally {
        await release();
      }

      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).resolves.toBeDefined();
    });

    it('is released after a rename, also when it fails', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      await addAsset(s, 'b.jpg');
      const operations = s.ctx.get(FileOperationRepository);

      await expect(s.sut.rename(s.auth, asset.id, { fileName: 'b', renameOnDisk: true })).rejects.toBeDefined();

      await expect(operations.isHeld()).resolves.toBe(false);
    });

    it('reports a held lock from another session, and none once it is released', async () => {
      const operations = new FileOperationRepository(defaultDatabase, LoggingRepository.create());
      await expect(operations.isHeld()).resolves.toBe(false);

      const release = await holdLock();
      await expect(operations.isHeld()).resolves.toBe(true);
      await expect(operations.tryRun(() => Promise.resolve('ran'))).resolves.toEqual({ acquired: false });

      await release();
      await expect(operations.isHeld()).resolves.toBe(false);
      await expect(operations.tryRun(() => Promise.resolve('ran'))).resolves.toEqual({
        acquired: true,
        result: 'ran',
      });
    });

    it('waits for a holder and stops waiting after the timeout', async () => {
      const operations = new FileOperationRepository(defaultDatabase, LoggingRepository.create());
      const release = await holdLock();

      const started = Date.now();
      await operations.waitUntilIdle({ timeoutMs: 300, intervalMs: 50 });
      expect(Date.now() - started).toBeGreaterThanOrEqual(250);

      const waiting = operations.waitUntilIdle({ timeoutMs: 5000, intervalMs: 50 });
      setTimeout(() => void release(), 200);
      await waiting;
      await expect(operations.isHeld()).resolves.toBe(false);
    });
  });

  describe('a watcher job that races a rename', () => {
    it('does not remove the asset of a file that is being renamed', async () => {
      const s = await setup();
      const asset = await addAsset(s, 'a.jpg');
      const oldPath = asset.originalPath;
      const { sut: library, ctx } = newMediumService(LibraryService, {
        database: defaultDatabase,
        real: [AssetRepository, FileOperationRepository, LibraryRepository, UserRepository],
        mock: [EventRepository, JobRepository, LoggingRepository],
      });
      expect(ctx).toBeInstanceOf(MediumTestContext);

      // the rename holds the lock, has renamed the file, and has not yet committed the row
      const release = await holdLock();
      const removal = library.handleAssetRemoval({ libraryId: s.libraryId, paths: [oldPath] });
      await new Promise((resolve) => setTimeout(resolve, 400));
      await defaultDatabase
        .updateTable('asset')
        .set({ originalPath: path.join(s.folder, 'b.jpg') })
        .where('id', '=', asset.id)
        .execute();
      await release();
      await removal;

      await expect(row(asset.id)).resolves.toBeDefined();
    });
  });
});
