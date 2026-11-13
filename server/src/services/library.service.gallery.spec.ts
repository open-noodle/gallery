import { Stats } from 'node:fs';
import { AssetStatus } from 'src/enum.js';
import { LibraryService } from 'src/services/library.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe('external library outage safety', () => {
  const library = factory.library({ importPaths: ['/photos'] });
  const asset = AssetFactory.create({ libraryId: library.id, originalPath: '/photos/image.jpg', isExternal: true });
  let sut: LibraryService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(LibraryService));
    mocks.library.get.mockResolvedValue(library);
    mocks.asset.getByLibraryIdAndOriginalPath.mockResolvedValue(asset);
    mocks.assetJob.getForSyncAssets.mockResolvedValue([asset]);
    mocks.storage.stat.mockRejectedValue(new Error('unavailable'));
  });

  it('preserves records and associations when an unlink follows a drive outage', async () => {
    await sut.handleAssetRemoval({ libraryId: library.id, paths: [asset.originalPath] });
    expect(mocks.asset.remove).not.toHaveBeenCalled();
    expect(mocks.asset.updateAll).not.toHaveBeenCalled();
  });

  it('marks a confirmed missing file offline without trashing it', async () => {
    mocks.storage.stat.mockImplementation((path) => {
      return path === '/photos'
        ? Promise.resolve({ isDirectory: () => true } as Stats)
        : Promise.reject(new Error('missing'));
    });
    mocks.storage.checkFileExists.mockResolvedValue(true);
    await sut.handleAssetRemoval({ libraryId: library.id, paths: [asset.originalPath] });
    expect(mocks.asset.remove).not.toHaveBeenCalled();
    expect(mocks.asset.updateAll).toHaveBeenCalledWith([asset.id], { isOffline: true });
  });

  it('ignores a stale unlink when the original is accessible again', async () => {
    mocks.storage.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
    mocks.storage.checkFileExists.mockResolvedValue(true);
    await sut.handleAssetRemoval({ libraryId: library.id, paths: [asset.originalPath] });
    expect(mocks.asset.remove).not.toHaveBeenCalled();
    expect(mocks.asset.updateAll).not.toHaveBeenCalled();
  });

  it('does not start trash expiry when a scheduled scan loses access', async () => {
    await sut.handleSyncAssets({
      libraryId: library.id,
      assetIds: [asset.id],
      importPaths: ['/photos'],
      exclusionPatterns: [],
      totalAssets: 1,
      progressCounter: 1,
    });
    expect(mocks.asset.updateAll).toHaveBeenCalledWith([asset.id], { isOffline: true });
  });

  it('restores the same offline asset when it returns', async () => {
    mocks.assetJob.getForSyncAssets.mockResolvedValue([{ ...asset, isOffline: true }]);
    mocks.storage.stat.mockResolvedValue({ mtime: asset.fileModifiedAt } as Stats);
    await sut.handleSyncAssets({
      libraryId: library.id,
      assetIds: [asset.id],
      importPaths: ['/photos'],
      exclusionPatterns: [],
      totalAssets: 1,
      progressCounter: 1,
    });
    expect(mocks.asset.updateAll).toHaveBeenCalledWith([asset.id], { isOffline: false, deletedAt: null });
  });
  it('does not restore explicitly trashed assets when their drive returns', async () => {
    mocks.assetJob.getForSyncAssets.mockResolvedValue([{ ...asset, isOffline: true, status: AssetStatus.Trashed }]);
    mocks.storage.stat.mockResolvedValue({ mtime: asset.fileModifiedAt } as Stats);
    await sut.handleSyncAssets({
      libraryId: library.id,
      assetIds: [asset.id],
      importPaths: ['/photos'],
      exclusionPatterns: [],
      totalAssets: 1,
      progressCounter: 1,
    });
    expect(mocks.asset.updateAll).toHaveBeenCalledWith([asset.id], { isOffline: false });
  });

  it('does not treat a sibling import path as an accessible root', async () => {
    mocks.library.get.mockResolvedValue({ ...library, importPaths: ['/photo'] });
    mocks.storage.stat.mockResolvedValue({ isDirectory: () => true } as Stats);
    mocks.storage.checkFileExists.mockResolvedValue(true);
    await sut.handleAssetRemoval({ libraryId: library.id, paths: [asset.originalPath] });
    expect(mocks.asset.remove).not.toHaveBeenCalled();
    expect(mocks.asset.updateAll).not.toHaveBeenCalled();
  });
});
