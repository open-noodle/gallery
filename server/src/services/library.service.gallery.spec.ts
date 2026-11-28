import { JobStatus } from 'src/enum.js';
import { LibraryService } from 'src/services/library.service.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// A file rename (src/gallery/services/asset-rename.service.ts) runs in the API while the watcher's jobs run in a
// microservice, so the jobs wait for the file-operation lock instead of racing the rename.
describe('LibraryService watcher jobs during a file rename', () => {
  let sut: LibraryService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(LibraryService));
  });

  it('waits for the rename before it imports a file', async () => {
    const order: string[] = [];
    mocks.fileOperation.waitUntilIdle.mockImplementation(() => {
      order.push('idle');
      return Promise.resolve();
    });
    mocks.library.get.mockImplementation(() => {
      order.push('library');
      return Promise.resolve(void 0);
    });

    await expect(sut.handleSyncFiles({ libraryId: factory.uuid(), paths: ['/data/photo.jpg'] })).resolves.toBe(
      JobStatus.Failed,
    );

    expect(order).toEqual(['idle', 'library']);
  });

  it('waits for the rename before it removes the asset of a deleted file', async () => {
    const order: string[] = [];
    mocks.fileOperation.waitUntilIdle.mockImplementation(() => {
      order.push('idle');
      return Promise.resolve();
    });
    mocks.asset.getByLibraryIdAndOriginalPath.mockImplementation(() => {
      order.push('lookup');
      return Promise.resolve(void 0);
    });

    await sut.handleAssetRemoval({ libraryId: factory.uuid(), paths: ['/data/photo.jpg'] });

    expect(order).toEqual(['idle', 'lookup']);
  });
});
