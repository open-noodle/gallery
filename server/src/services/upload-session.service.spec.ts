import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UPLOAD_SESSION_MAX_OPEN } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { UploadSessionCreateDto } from 'src/dtos/upload-session.dto';
import { StorageFolder } from 'src/enum';
import { UploadSessionService } from 'src/services/upload-session.service';
import { fromChecksum } from 'src/utils/request';
import {
  committedOffset,
  readState,
  sessionPaths,
  UploadSessionState,
  writeState,
} from 'src/utils/upload-session-store';
import { factory } from 'test/small.factory';
import { newTestService, ServiceMocks } from 'test/utils';

vi.mock('src/utils/upload-session-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('src/utils/upload-session-store')>();
  return {
    ...actual,
    writeState: vi.fn(),
    readState: vi.fn(),
    claimFinalize: vi.fn(),
    writeChunkAt: vi.fn(),
    committedOffset: vi.fn(),
  };
});

const validDto: UploadSessionCreateDto = {
  filename: 'IMG_1234.jpg',
  size: 1024,
  fileCreatedAt: new Date('2026-09-08T10:00:00.000Z'),
  fileModifiedAt: new Date('2026-09-08T10:00:00.000Z'),
} as UploadSessionCreateDto;

const fakeDirent = (name: string, isDirectory = false) =>
  ({
    name,
    isDirectory: () => isDirectory,
  }) as any;

const makeState = (overrides: Partial<UploadSessionState> = {}): UploadSessionState => ({
  userId: 'user-1',
  sharedLinkId: null,
  size: 1024,
  originalName: 'a.jpg',
  createdAt: '2026-09-08T10:00:00.000Z',
  dto: {},
  ...overrides,
});

describe(UploadSessionService.name, () => {
  let sut: UploadSessionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    vi.mocked(writeState).mockReset();
    vi.mocked(readState).mockReset();
    vi.mocked(committedOffset).mockReset();
    ({ sut, mocks } = newTestService(UploadSessionService));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('create', () => {
    it('throws when the caller has no upload access', async () => {
      const auth = factory.auth({ sharedLink: {} }); // allowUpload defaults to false

      await expect(sut.create(auth, validDto)).rejects.toBeInstanceOf(UnauthorizedException);
      expect(mocks.asset.getUploadAssetIdByChecksum).not.toHaveBeenCalled();
    });

    it('throws for an unsupported file type', async () => {
      const auth = factory.auth();
      const dto = { ...validDto, filename: 'notes.txt' };

      await expect(sut.create(auth, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.asset.getUploadAssetIdByChecksum).not.toHaveBeenCalled();
    });

    it('throws when the declared size exceeds the remaining quota', async () => {
      const auth = factory.auth({ user: { quotaSizeInBytes: 100, quotaUsageInBytes: 50 } });
      const dto = { ...validDto, size: 100 };

      await expect(sut.create(auth, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.storage.readdirWithTypes).not.toHaveBeenCalled();
      expect(mocks.asset.getUploadAssetIdByChecksum).not.toHaveBeenCalled();
    });

    it('throws when the per-user open-session cap is exceeded', async () => {
      const auth = factory.auth();
      const entries = Array.from({ length: UPLOAD_SESSION_MAX_OPEN }, (_, i) => fakeDirent(`s${i}.session.json`));
      mocks.storage.readdirWithTypes.mockResolvedValue(entries);

      await expect(sut.create(auth, validDto)).rejects.toBeInstanceOf(BadRequestException);

      const expectedFolder = StorageCore.getFolderLocation(StorageFolder.Upload, auth.user.id);
      expect(mocks.storage.readdirWithTypes).toHaveBeenCalledWith(expectedFolder);
      expect(mocks.asset.getUploadAssetIdByChecksum).not.toHaveBeenCalled();
    });

    it('returns DUPLICATE without creating a session when the checksum is already known', async () => {
      const auth = factory.auth();
      const dto = { ...validDto, checksum: 'aabbccddeeff00112233445566778899aabbccdd' };
      mocks.asset.getUploadAssetIdByChecksum.mockResolvedValue('existing-asset-id');

      await expect(sut.create(auth, dto)).resolves.toEqual({
        id: 'existing-asset-id',
        status: AssetMediaStatus.DUPLICATE,
      });

      expect(mocks.asset.getUploadAssetIdByChecksum).toHaveBeenCalledWith(auth.user.id, fromChecksum(dto.checksum!));
      expect(mocks.storage.mkdirSync).not.toHaveBeenCalled();
      expect(writeState).not.toHaveBeenCalled();
    });

    it('throws when the sidecar is not valid UTF-8', async () => {
      const auth = factory.auth();
      const dto = { ...validDto, sidecar: '\u{D800}' };

      await expect(sut.create(auth, dto)).rejects.toBeInstanceOf(BadRequestException);
      expect(writeState).not.toHaveBeenCalled();
    });

    it('stores inline sidecar content in the session state', async () => {
      const auth = factory.auth();
      const dto = { ...validDto, sidecar: '<xmp>hello</xmp>' };

      await sut.create(auth, dto);

      expect(writeState).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ dto: expect.objectContaining({ sidecar: dto.sidecar }) }),
      );
    });

    it('creates a session, mkdirs the folder, and returns offset 0', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-08T10:00:00.000Z'));

      const auth = factory.auth();

      const result = await sut.create(auth, validDto);

      const expectedFolder = StorageCore.getNestedFolder(StorageFolder.Upload, auth.user.id, 'random-uuid');
      const expectedStatePath = sessionPaths(expectedFolder, 'random-uuid', '.jpg').state;

      expect(mocks.storage.mkdirSync).toHaveBeenCalledWith(expectedFolder);
      expect(writeState).toHaveBeenCalledWith(
        expectedStatePath,
        expect.objectContaining({
          userId: auth.user.id,
          sharedLinkId: null,
          size: validDto.size,
          originalName: validDto.filename,
          checksum: undefined,
          dto: expect.objectContaining({ filename: validDto.filename }),
        }),
      );

      expect(result).toEqual({
        id: 'random-uuid',
        offset: 0,
        expiresAt: new Date('2026-09-09T10:00:00.000Z').toISOString(),
      });
    });
  });

  describe('getOffset', () => {
    it('throws 404 for an unknown session', async () => {
      const auth = factory.auth();
      vi.mocked(readState).mockResolvedValue(undefined);

      await expect(sut.getOffset(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when the recorded owner differs from the caller (ownership-check branch)', async () => {
      // Exercises the `state.userId !== auth.user.id` clause directly: readState is stubbed to
      // return a "found" session regardless of path, with a mismatched recorded owner. See the
      // companion test below for the realistic path-derivation case a genuine different user hits.
      const auth = factory.auth({ user: { id: 'me' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'someone-else', sharedLinkId: null }));

      await expect(sut.getOffset(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it("does not find a session id looked up from another real user's folder", async () => {
      // Unlike the test above (which forces readState to "find" a mismatched-owner session),
      // this models what actually happens in production: the folder is derived from the
      // CALLER's auth.user.id (StorageCore.getNestedFolder), so a different real user's lookup
      // computes a DIFFERENT statePath than the one the session was written under. readState at
      // that wrong path returns undefined, and the request 404s via the `!state` branch before
      // any ownership field is even compared. A stray shared-link resolves auth.user.id to the
      // LINK OWNER's id (see spec §8 row 44 tests), so this "wrong folder" case is specific to
      // two distinct real user accounts, not to a shared link.
      const ownerAuth = factory.auth({ user: { id: 'owner-1' } });
      const strangerAuth = factory.auth({ user: { id: 'stranger-1' } });
      const ownerFolder = StorageCore.getNestedFolder(StorageFolder.Upload, 'owner-1', 'session-1');
      const ownerStatePath = sessionPaths(ownerFolder, 'session-1', '').state;
      const ownerState = makeState({ userId: 'owner-1', sharedLinkId: null, size: 1024 });

      vi.mocked(readState).mockImplementation((path) =>
        Promise.resolve(path === ownerStatePath ? ownerState : undefined),
      );
      vi.mocked(committedOffset).mockResolvedValue(0);

      await expect(sut.getOffset(strangerAuth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
      // Sanity check: the mock does model a real, findable session — the owner themself can read it.
      await expect(sut.getOffset(ownerAuth, 'session-1')).resolves.toEqual({ offset: 0, size: 1024 });
    });

    it('throws 404 for a shared-link session opened under a different link', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'owner-1', sharedLinkId: 'link-A' }));

      await expect(sut.getOffset(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    // Spec §8 row 44 — all four auth-kind combinations, not just the two failing directions.
    it('succeeds for a user-token session continued with the same user token', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'owner-1', sharedLinkId: null, size: 2048 }));
      vi.mocked(committedOffset).mockResolvedValue(512);

      await expect(sut.getOffset(auth, 'session-1')).resolves.toEqual({ offset: 512, size: 2048 });
    });

    it('succeeds for a shared-link session continued under the same link', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' }, sharedLink: { id: 'link-A' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'owner-1', sharedLinkId: 'link-A', size: 2048 }));
      vi.mocked(committedOffset).mockResolvedValue(256);

      await expect(sut.getOffset(auth, 'session-1')).resolves.toEqual({ offset: 256, size: 2048 });
    });

    it('throws 404 when a user-token session is continued with a shared link', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' }, sharedLink: { id: 'link-A' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'owner-1', sharedLinkId: null }));

      await expect(sut.getOffset(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 when a shared-link session is continued with a user token', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' } });
      vi.mocked(readState).mockResolvedValue(makeState({ userId: 'owner-1', sharedLinkId: 'link-A' }));

      await expect(sut.getOffset(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('reads the state and data paths derived from the caller folder and session id', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' } });
      const state = makeState({ userId: 'owner-1', sharedLinkId: null, originalName: 'photo.png', size: 999 });
      vi.mocked(readState).mockResolvedValue(state);
      vi.mocked(committedOffset).mockResolvedValue(0);

      await sut.getOffset(auth, 'session-1');

      const folder = StorageCore.getNestedFolder(StorageFolder.Upload, 'owner-1', 'session-1');
      const expectedStatePath = sessionPaths(folder, 'session-1', '').state;
      const expectedDataPath = sessionPaths(folder, 'session-1', '.png').data;

      expect(readState).toHaveBeenCalledWith(expectedStatePath);
      expect(committedOffset).toHaveBeenCalledWith(expectedDataPath);
    });
  });

  describe('abort', () => {
    it('throws 404 for an unknown or foreign session', async () => {
      const auth = factory.auth();
      vi.mocked(readState).mockResolvedValue(undefined);

      await expect(sut.abort(auth, 'session-1')).rejects.toBeInstanceOf(NotFoundException);
      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });

    it('unlinks both the data file and the state file', async () => {
      const auth = factory.auth({ user: { id: 'owner-1' } });
      const state = makeState({ userId: 'owner-1', sharedLinkId: null, originalName: 'video.mp4' });
      vi.mocked(readState).mockResolvedValue(state);

      await sut.abort(auth, 'session-1');

      const folder = StorageCore.getNestedFolder(StorageFolder.Upload, 'owner-1', 'session-1');
      const expectedStatePath = sessionPaths(folder, 'session-1', '').state;
      const expectedDataPath = sessionPaths(folder, 'session-1', '.mp4').data;

      expect(mocks.storage.unlink).toHaveBeenCalledWith(expectedDataPath);
      expect(mocks.storage.unlink).toHaveBeenCalledWith(expectedStatePath);
      expect(mocks.storage.unlink).toHaveBeenCalledTimes(2);
    });
  });
});
