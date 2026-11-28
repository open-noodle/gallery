import { BadRequestException, ConflictException } from '@nestjs/common';
import { AssetRenameTargetState, AssetStatus, ChecksumAlgorithm, JobName } from 'src/enum.js';
import { AssetRenameService } from 'src/gallery/services/asset-rename.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const LIBRARY_ID = newUuid();

const subject = (ownerId: string, overrides: Record<string, unknown> = {}) => ({
  id: newUuid(),
  ownerId,
  libraryId: LIBRARY_ID as string | null,
  isExternal: true,
  originalPath: '/data/photos/IMG_0007.JPEG',
  originalFileName: 'IMG_0007.JPEG',
  checksum: Buffer.from('path:/data/photos/IMG_0007.JPEG'),
  checksumAlgorithm: ChecksumAlgorithm.sha1Path,
  livePhotoVideoId: null as string | null,
  ...overrides,
});

const row = (overrides: Record<string, unknown>) => ({
  id: newUuid(),
  originalPath: '/data/photos/Beach.jpg',
  checksum: Buffer.from('sha1:path:/data/photos/Beach.jpg'),
  status: AssetStatus.Active,
  isOffline: false,
  ...overrides,
});

describe(AssetRenameService.name, () => {
  let sut: AssetRenameService;
  let mocks: ServiceMocks;
  let auth: ReturnType<typeof AuthFactory.create>;
  let rows: ReturnType<typeof subject>[];
  let onDisk: Set<string>;
  let inodes: Map<string, number>;

  const stillRow = () => rows[0];
  const moveOnDisk = (from: string, to: string) => {
    onDisk.delete(from);
    onDisk.add(to);
    return Promise.resolve();
  };

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetRenameService));
    auth = AuthFactory.create();
    rows = [subject(auth.user.id)];
    onDisk = new Set([stillRow().originalPath]);
    inodes = new Map();

    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([stillRow().id]));
    mocks.fileOperation.getRenameSubjects.mockImplementation((ids: string[]) =>
      Promise.resolve(rows.filter(({ id }) => ids.includes(id))),
    );
    mocks.fileOperation.getSidecarPaths.mockResolvedValue([]);
    mocks.fileOperation.getAtPaths.mockResolvedValue([]);
    mocks.fileOperation.applyRename.mockResolvedValue(true);
    mocks.fileOperation.setFileNames.mockResolvedValue();
    mocks.fileOperation.tryRun.mockImplementation(async (callback: () => Promise<unknown>) => ({
      acquired: true as const,
      result: await callback(),
    }));
    mocks.library.get.mockResolvedValue({
      id: LIBRARY_ID,
      importPaths: ['/data/photos'],
      exclusionPatterns: ['**/excluded*'],
    } as never);
    mocks.crypto.hashSha1.mockImplementation((value: string | Buffer) => Buffer.from(`sha1:${value}`));
    mocks.crypto.randomUUID.mockReturnValue('probe-uuid');
    mocks.storage.checkFileExists.mockImplementation((file: string) => Promise.resolve(onDisk.has(file)));
    mocks.storage.stat.mockImplementation((file: string) =>
      Promise.resolve({ ino: inodes.get(file) ?? file.length, dev: 1 } as never),
    );
    mocks.storage.createFile.mockResolvedValue();
    mocks.storage.unlink.mockResolvedValue();
    mocks.storage.rename.mockImplementation(moveOnDisk);
    mocks.job.queueAll.mockResolvedValue();
  });

  const renameOnDisk = (fileName: string, extra: Record<string, unknown> = {}) =>
    sut.rename(auth, stillRow().id, { fileName, renameOnDisk: true, ...extra });

  describe('rename, name only', () => {
    it('changes the name Gallery shows, with the extension normalized, and never touches the disk', async () => {
      await expect(sut.rename(auth, stillRow().id, { fileName: 'Beach 2006-08' })).resolves.toEqual({
        originalFileName: 'Beach 2006-08.jpg',
        originalPath: '/data/photos/IMG_0007.JPEG',
      });

      expect(mocks.fileOperation.setFileNames).toHaveBeenCalledWith([
        { id: stillRow().id, originalFileName: 'Beach 2006-08.jpg' },
      ]);
      expect(mocks.fileOperation.tryRun).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.fileOperation.applyRename).not.toHaveBeenCalled();
    });

    it('renames the motion video of a live photo with its own extension', async () => {
      const motion = subject(auth.user.id, {
        originalPath: '/data/photos/IMG_0007.MOV',
        originalFileName: 'IMG_0007.MOV',
      });
      stillRow().livePhotoVideoId = motion.id;
      rows.push(motion);

      await sut.rename(auth, stillRow().id, { fileName: 'Beach' });

      expect(mocks.fileOperation.setFileNames).toHaveBeenCalledWith([
        { id: stillRow().id, originalFileName: 'Beach.jpg' },
        { id: motion.id, originalFileName: 'Beach.mov' },
      ]);
    });

    it('renames an upload-managed asset the same way', async () => {
      Object.assign(stillRow(), { isExternal: false, libraryId: null, originalPath: '/data/upload/ab/cd/x.jpg' });

      await sut.rename(auth, stillRow().id, { fileName: 'Beach' });

      expect(mocks.fileOperation.setFileNames).toHaveBeenCalledWith([
        { id: stillRow().id, originalFileName: 'Beach.jpg' },
      ]);
    });

    it('refuses to rename an upload-managed asset on disk', async () => {
      Object.assign(stillRow(), { isExternal: false, libraryId: null });

      await expect(renameOnDisk('Beach')).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.fileOperation.setFileNames).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it.each(['', '.hidden', 'a/b', String.raw`a\b`, 'a\0b'])('refuses the name %j', async (fileName) => {
      await expect(sut.rename(auth, stillRow().id, { fileName })).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.fileOperation.setFileNames).not.toHaveBeenCalled();
    });

    it('refuses a caller who does not hold the asset', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.rename(auth, stillRow().id, { fileName: 'Beach' })).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.fileOperation.getRenameSubjects).not.toHaveBeenCalled();
      expect(mocks.fileOperation.setFileNames).not.toHaveBeenCalled();
    });

    it('refuses an asset of another owner even when the access check lets it through', async () => {
      stillRow().ownerId = newUuid();

      await expect(sut.rename(auth, stillRow().id, { fileName: 'Beach' })).rejects.toThrow('Only the owner');

      expect(mocks.fileOperation.setFileNames).not.toHaveBeenCalled();
    });
  });

  describe('rename on disk', () => {
    it('renames the file, normalizes the extension, and moves the row to the new path and checksum', async () => {
      await expect(renameOnDisk('Beach 2006-08')).resolves.toEqual({
        originalFileName: 'Beach 2006-08.jpg',
        originalPath: '/data/photos/Beach 2006-08.jpg',
      });

      expect(mocks.storage.rename).toHaveBeenCalledExactlyOnceWith(
        '/data/photos/IMG_0007.JPEG',
        '/data/photos/Beach 2006-08.jpg',
      );
      expect(mocks.fileOperation.applyRename).toHaveBeenCalledWith({
        replaced: [],
        renames: [
          {
            id: stillRow().id,
            oldPath: '/data/photos/IMG_0007.JPEG',
            originalPath: '/data/photos/Beach 2006-08.jpg',
            originalFileName: 'Beach 2006-08.jpg',
            checksum: Buffer.from('sha1:path:/data/photos/Beach 2006-08.jpg'),
          },
        ],
        sidecars: [],
      });
      expect(mocks.job.queueAll).toHaveBeenCalledWith([]);
    });

    it('keeps the checksum of an asset whose checksum is not a path checksum', async () => {
      stillRow().checksumAlgorithm = ChecksumAlgorithm.sha1File;

      await renameOnDisk('Beach');

      const plan = mocks.fileOperation.applyRename.mock.calls[0][0];
      expect(plan.renames[0].checksum).toBeUndefined();
    });

    it('moves both sidecar conventions with the file', async () => {
      onDisk.add('/data/photos/IMG_0007.JPEG.xmp');
      onDisk.add('/data/photos/IMG_0007.xmp');
      mocks.fileOperation.getSidecarPaths.mockResolvedValue([
        { assetId: stillRow().id, path: '/data/photos/IMG_0007.JPEG.xmp' },
      ]);

      await renameOnDisk('Beach');

      expect(mocks.storage.rename.mock.calls).toEqual([
        ['/data/photos/IMG_0007.JPEG', '/data/photos/Beach.jpg'],
        ['/data/photos/IMG_0007.JPEG.xmp', '/data/photos/Beach.jpg.xmp'],
        ['/data/photos/IMG_0007.xmp', '/data/photos/Beach.xmp'],
      ]);
      expect(mocks.fileOperation.applyRename.mock.calls[0][0].sidecars).toEqual([
        { assetId: stillRow().id, oldPath: '/data/photos/IMG_0007.JPEG.xmp', newPath: '/data/photos/Beach.jpg.xmp' },
        { assetId: stillRow().id, oldPath: '/data/photos/IMG_0007.xmp', newPath: '/data/photos/Beach.xmp' },
      ]);
    });

    it('renames both files of a live photo and each sidecar once', async () => {
      const motion = subject(auth.user.id, {
        originalPath: '/data/photos/IMG_0007.MOV',
        originalFileName: 'IMG_0007.MOV',
      });
      stillRow().livePhotoVideoId = motion.id;
      rows.push(motion);
      onDisk.add(motion.originalPath);
      onDisk.add('/data/photos/IMG_0007.xmp');

      await expect(renameOnDisk('Beach')).resolves.toEqual({
        originalFileName: 'Beach.jpg',
        originalPath: '/data/photos/Beach.jpg',
      });

      expect(mocks.storage.rename.mock.calls).toEqual([
        ['/data/photos/IMG_0007.JPEG', '/data/photos/Beach.jpg'],
        ['/data/photos/IMG_0007.xmp', '/data/photos/Beach.xmp'],
        ['/data/photos/IMG_0007.MOV', '/data/photos/Beach.mov'],
      ]);
      const plan = mocks.fileOperation.applyRename.mock.calls[0][0];
      expect(plan.renames.map(({ id, originalPath }) => [id, originalPath])).toEqual([
        [stillRow().id, '/data/photos/Beach.jpg'],
        [motion.id, '/data/photos/Beach.mov'],
      ]);
    });

    it('refuses the whole live photo when either new name is taken', async () => {
      const motion = subject(auth.user.id, {
        originalPath: '/data/photos/IMG_0007.MOV',
        originalFileName: 'IMG_0007.MOV',
      });
      stillRow().livePhotoVideoId = motion.id;
      rows.push(motion);
      onDisk.add(motion.originalPath);
      onDisk.add('/data/photos/Beach.mov');

      await expect(renameOnDisk('Beach')).rejects.toBeInstanceOf(ConflictException);

      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.fileOperation.applyRename).not.toHaveBeenCalled();
    });

    it('changes nothing when the name is the one the file already has', async () => {
      stillRow().originalPath = '/data/photos/Beach.jpg';
      stillRow().originalFileName = 'Beach.jpg';
      onDisk = new Set(['/data/photos/Beach.jpg']);

      await expect(renameOnDisk('Beach')).resolves.toMatchObject({ originalPath: '/data/photos/Beach.jpg' });

      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.fileOperation.applyRename).not.toHaveBeenCalled();
    });

    it('allows a case-only rename on a case-insensitive disk, where the target is the file itself', async () => {
      stillRow().originalPath = '/data/photos/beach.jpg';
      stillRow().originalFileName = 'beach.jpg';
      onDisk = new Set(['/data/photos/beach.jpg', '/data/photos/Beach.jpg']);
      inodes.set('/data/photos/beach.jpg', 42);
      inodes.set('/data/photos/Beach.jpg', 42);

      await renameOnDisk('Beach');

      expect(mocks.storage.rename).toHaveBeenCalledWith('/data/photos/beach.jpg', '/data/photos/Beach.jpg');
    });

    it('refuses a name that the library would exclude', async () => {
      await expect(renameOnDisk('excluded copy')).rejects.toThrow('excluded from the library');

      expect(mocks.fileOperation.tryRun).not.toHaveBeenCalled();
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('refuses while another file operation holds the lock', async () => {
      mocks.fileOperation.tryRun.mockResolvedValue({ acquired: false });

      await expect(renameOnDisk('Beach')).rejects.toThrow('Another file operation is running');

      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('refuses when the file is missing on disk', async () => {
      onDisk.clear();

      await expect(renameOnDisk('Beach')).rejects.toThrow('missing on disk');

      expect(mocks.fileOperation.applyRename).not.toHaveBeenCalled();
    });

    it.each([
      ['EROFS', 'read-only'],
      ['EACCES', 'permission'],
      ['ENOSPC', 'no space'],
    ])('refuses a folder the probe cannot write to (%s)', async (code, message) => {
      mocks.storage.createFile.mockRejectedValue(Object.assign(new Error(code), { code }));

      await expect(renameOnDisk('Beach')).rejects.toThrow(new RegExp(message));

      expect(mocks.storage.rename).not.toHaveBeenCalled();
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });

    it('probes with a hidden .xmp file in the folder and removes it', async () => {
      await renameOnDisk('Beach');

      expect(mocks.storage.createFile).toHaveBeenCalledWith(
        '/data/photos/.gallery-write-probe-probe-uuid.xmp',
        expect.any(Buffer),
      );
      expect(mocks.storage.unlink).toHaveBeenCalledWith('/data/photos/.gallery-write-probe-probe-uuid.xmp');
    });

    it('still renames when the probe file cannot be removed', async () => {
      mocks.storage.unlink.mockRejectedValue(new Error('busy'));

      await expect(renameOnDisk('Beach')).resolves.toBeDefined();
    });

    it('puts a renamed file back when a later rename fails', async () => {
      onDisk.add('/data/photos/IMG_0007.xmp');
      mocks.storage.rename.mockImplementation((from: string, to: string) =>
        from.endsWith('.xmp') && to.endsWith('Beach.xmp')
          ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
          : moveOnDisk(from, to),
      );

      await expect(renameOnDisk('Beach')).rejects.toBeInstanceOf(ConflictException);

      expect(onDisk).toEqual(new Set(['/data/photos/IMG_0007.JPEG', '/data/photos/IMG_0007.xmp']));
      expect(mocks.fileOperation.applyRename).not.toHaveBeenCalled();
    });

    it('puts the files back when the row changed meanwhile', async () => {
      mocks.fileOperation.applyRename.mockResolvedValue(false);

      await expect(renameOnDisk('Beach')).rejects.toThrow('changed while it was renamed');

      expect(onDisk).toEqual(new Set(['/data/photos/IMG_0007.JPEG']));
      expect(mocks.job.queueAll).not.toHaveBeenCalled();
    });

    it('puts the files back and rethrows when the database update fails', async () => {
      mocks.fileOperation.applyRename.mockRejectedValue(new Error('db down'));

      await expect(renameOnDisk('Beach')).rejects.toThrow('db down');

      expect(onDisk).toEqual(new Set(['/data/photos/IMG_0007.JPEG']));
    });
  });

  describe('the name at the new path', () => {
    it('reports free when nothing holds it', async () => {
      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Free,
      });
    });

    it('reports exists for a file on disk, and refuses', async () => {
      onDisk.add('/data/photos/Beach.jpg');

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Exists,
      });
      await expect(renameOnDisk('Beach')).rejects.toMatchObject({
        response: { state: AssetRenameTargetState.Exists },
      });
      expect(mocks.storage.rename).not.toHaveBeenCalled();
    });

    it('reports exists for a sidecar already at the new name', async () => {
      onDisk.add('/data/photos/Beach.jpg.xmp');
      onDisk.add('/data/photos/IMG_0007.JPEG.xmp');

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Exists,
      });
    });

    it('reports exists for a row that is neither trashed nor offline, even without a file', async () => {
      mocks.fileOperation.getAtPaths.mockResolvedValue([row({})] as never);

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Exists,
      });
      await expect(renameOnDisk('Beach')).rejects.toBeInstanceOf(ConflictException);
    });

    it('ignores the asset itself', async () => {
      mocks.fileOperation.getAtPaths.mockResolvedValue([row({ id: stillRow().id })] as never);

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Free,
      });
    });

    it('looks the new path up by path and by path checksum, in the asset library', async () => {
      await sut.check(auth, stillRow().id, { fileName: 'Beach' });

      expect(mocks.fileOperation.getAtPaths).toHaveBeenCalledWith(
        LIBRARY_ID,
        ['/data/photos/Beach.jpg'],
        [Buffer.from('sha1:path:/data/photos/Beach.jpg')],
      );
    });

    describe('an offline item', () => {
      const ghost = row({ isOffline: true });

      it('reports offline, and the rename sets it aside and queues its deletion without touching its file', async () => {
        mocks.fileOperation.getAtPaths.mockResolvedValue([ghost] as never);

        await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
          state: AssetRenameTargetState.Offline,
        });
        await renameOnDisk('Beach');

        const plan = mocks.fileOperation.applyRename.mock.calls[0][0];
        expect(plan.replaced).toEqual([
          {
            id: ghost.id,
            originalPath: `/data/photos/Beach.jpg.replaced-${ghost.id}`,
            checksum: expect.any(Buffer),
          },
        ]);
        expect(plan.replaced[0].checksum).not.toEqual(ghost.checksum);
        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.AssetDelete, data: { id: ghost.id, deleteOnDisk: false } },
        ]);
      });

      it('does not queue the deletion when the rename fails', async () => {
        mocks.fileOperation.getAtPaths.mockResolvedValue([ghost] as never);
        mocks.fileOperation.applyRename.mockResolvedValue(false);

        await expect(renameOnDisk('Beach')).rejects.toBeInstanceOf(ConflictException);

        expect(mocks.job.queueAll).not.toHaveBeenCalled();
      });

      it('treats an item that is being deleted the same way', async () => {
        mocks.fileOperation.getAtPaths.mockResolvedValue([row({ status: AssetStatus.Deleted })] as never);

        await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
          state: AssetRenameTargetState.Offline,
        });
      });
    });

    describe('a trashed item', () => {
      const trashed = row({ status: AssetStatus.Trashed, isOffline: true });

      it('reports trashed, and the rename needs the confirmation', async () => {
        mocks.fileOperation.getAtPaths.mockResolvedValue([trashed] as never);

        await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
          state: AssetRenameTargetState.Trashed,
        });
        await expect(renameOnDisk('Beach')).rejects.toMatchObject({
          response: { state: AssetRenameTargetState.Trashed },
        });
        expect(mocks.storage.rename).not.toHaveBeenCalled();
        expect(mocks.job.queueAll).not.toHaveBeenCalled();
      });

      it('renames and queues its deletion once the user confirmed', async () => {
        mocks.fileOperation.getAtPaths.mockResolvedValue([trashed] as never);

        await renameOnDisk('Beach', { deleteTrashed: true });

        expect(mocks.storage.rename).toHaveBeenCalled();
        expect(mocks.fileOperation.applyRename.mock.calls[0][0].replaced).toHaveLength(1);
        expect(mocks.job.queueAll).toHaveBeenCalledWith([
          { name: JobName.AssetDelete, data: { id: trashed.id, deleteOnDisk: false } },
        ]);
      });

      it('reports the worst of the states in a live photo pair', async () => {
        const motion = subject(auth.user.id, {
          originalPath: '/data/photos/IMG_0007.MOV',
          originalFileName: 'IMG_0007.MOV',
        });
        stillRow().livePhotoVideoId = motion.id;
        rows.push(motion);
        mocks.fileOperation.getAtPaths.mockResolvedValue([
          row({ isOffline: true }),
          row({ originalPath: '/data/photos/Beach.mov', status: AssetStatus.Trashed }),
        ] as never);

        await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
          state: AssetRenameTargetState.Trashed,
        });
      });
    });
  });

  describe('check', () => {
    it('reports free for a file that is not on disk to begin with', async () => {
      Object.assign(stillRow(), { isExternal: false, libraryId: null });

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).resolves.toEqual({
        state: AssetRenameTargetState.Free,
      });
      expect(mocks.fileOperation.getAtPaths).not.toHaveBeenCalled();
    });

    it('refuses an invalid name', async () => {
      await expect(sut.check(auth, stillRow().id, { fileName: 'a/b' })).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses a caller who does not hold the asset', async () => {
      mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set());

      await expect(sut.check(auth, stillRow().id, { fileName: 'Beach' })).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
