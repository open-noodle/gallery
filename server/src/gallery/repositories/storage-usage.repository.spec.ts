import { Kysely } from 'kysely';
import mockfs from 'mock-fs';
import fs, { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StorageUsageRepository } from 'src/gallery/repositories/storage-usage.repository.js';
import { DB } from 'src/schema/index.js';

describe(StorageUsageRepository.name, () => {
  let sut: StorageUsageRepository;

  beforeEach(() => {
    // getFolderSize only walks the filesystem
    sut = new StorageUsageRepository(undefined as unknown as Kysely<DB>);
  });

  afterEach(() => {
    // eslint-disable-next-line import-x/no-named-as-default-member
    mockfs.restore();
    vi.restoreAllMocks();
  });

  describe('getFolderSize', () => {
    it('sums nested file sizes recursively', async () => {
      // eslint-disable-next-line import-x/no-named-as-default-member
      mockfs.restore();
      const testDir = join(tmpdir(), `immich-storage-repo-${Date.now()}`);
      try {
        await mkdir(join(testDir, 'aa'), { recursive: true });
        await writeFile(join(testDir, 'aa/one.jpg'), 'one');
        await mkdir(join(testDir, 'bb'), { recursive: true });
        await writeFile(join(testDir, 'bb/two.jpg'), 'two!!');
        await mkdir(join(testDir, 'empty'), { recursive: true });

        await expect(sut.getFolderSize(testDir)).resolves.toBe(8);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('returns zero when the folder does not exist', async () => {
      mockfs({});

      await expect(sut.getFolderSize('/data/upload/missing')).resolves.toBe(0);
    });

    it('skips files rejected by the filter', async () => {
      // eslint-disable-next-line import-x/no-named-as-default-member
      mockfs.restore();
      const testDir = join(tmpdir(), `immich-storage-filter-${Date.now()}`);
      try {
        await mkdir(join(testDir, 'aa'), { recursive: true });
        await writeFile(join(testDir, 'aa/keep.jpg'), 'one');
        await writeFile(join(testDir, 'aa/skip.jpg'), 'two!!');

        await expect(sut.getFolderSize(testDir, (filename) => filename !== 'skip.jpg')).resolves.toBe(3);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });

    it('ignores files deleted between listing and stat', async () => {
      // Regression for the nightly scan walking a live tree that delete jobs write to: a file
      // can vanish between `opendir` and `stat`. Uses a real temp dir (not mock-fs) because
      // mock-fs does not intercept `fs.promises.opendir`'s async iterator, so a mock-fs-only
      // version of this test would never reach the `stat` call it's meant to exercise.
      // eslint-disable-next-line import-x/no-named-as-default-member
      mockfs.restore();
      const testDir = join(tmpdir(), `immich-storage-enoent-${Date.now()}`);
      try {
        await mkdir(join(testDir, 'aa'), { recursive: true });
        await writeFile(join(testDir, 'aa/one.webp'), 'one');
        const error = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        vi.spyOn(fs, 'stat').mockRejectedValueOnce(error as never);

        await expect(sut.getFolderSize(testDir)).resolves.toBe(0);
      } finally {
        await rm(testDir, { recursive: true, force: true });
      }
    });
  });
});
