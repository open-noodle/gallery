import { BadRequestException, ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { DiskStorageBackend } from 'src/backends/disk-storage.backend';
import { UPLOAD_SESSION_MAX_OPEN, UPLOAD_SESSION_TTL_MS } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { UploadSessionCreateDto } from 'src/dtos/upload-session.dto';
import { DatabaseLock, StorageFolder } from 'src/enum';
import { AssetMediaService } from 'src/services/asset-media.service';
import { StorageService } from 'src/services/storage.service';
import { UploadSessionService } from 'src/services/upload-session.service';
import { ASSET_CHECKSUM_CONSTRAINT } from 'src/utils/database';
import { fromChecksum } from 'src/utils/request';
import {
  claimFinalize,
  committedOffset,
  finalizeClaimPath,
  readState,
  sessionPaths,
  UploadSessionState,
  writeChunkAt,
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

  beforeAll(() => {
    // Initialize the disk backend for StorageService so that AssetMediaService.uploadAsset's
    // internal writeBackend resolution works when finalize hands off to it for real.
    (StorageService as any).diskBackend = new DiskStorageBackend('/data');
  });

  beforeEach(() => {
    vi.mocked(writeState).mockReset();
    vi.mocked(readState).mockReset();
    vi.mocked(committedOffset).mockReset();
    vi.mocked(claimFinalize).mockReset();
    vi.mocked(writeChunkAt).mockReset();
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

  describe('appendChunk', () => {
    const owner = 'owner-1';
    let dataPath: string;

    beforeEach(() => {
      const folder = StorageCore.getNestedFolder(StorageFolder.Upload, owner, 'session-1');
      dataPath = sessionPaths(folder, 'session-1', '.jpg').data;
    });

    const setupSession = (overrides: Partial<UploadSessionState> = {}) => {
      const state = makeState({ userId: owner, sharedLinkId: null, originalName: 'a.jpg', size: 10, ...overrides });
      vi.mocked(readState).mockResolvedValue(state);
      return state;
    };

    it('throws when Upload-Offset is missing', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession();

      await expect(
        sut.appendChunk(auth, 'session-1', undefined as unknown as number, Buffer.from('x')),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(readState).not.toHaveBeenCalled();
    });

    it.each([-1, 1.5, NaN])('throws for a negative or non-integer Upload-Offset (%s)', async (offset) => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession();

      await expect(sut.appendChunk(auth, 'session-1', offset, Buffer.from('x'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(readState).not.toHaveBeenCalled();
    });

    it('throws 409 carrying the actual offset when the client is ahead', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession();
      vi.mocked(committedOffset).mockResolvedValue(2);

      const error: ConflictException = await sut
        .appendChunk(auth, 'session-1', 5, Buffer.from('hello'))
        .catch((error_) => error_);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ offset: 2 }));
      expect(writeChunkAt).not.toHaveBeenCalled();
    });

    it('throws 409 carrying the actual offset when the client replays an already-committed chunk', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession();
      vi.mocked(committedOffset).mockResolvedValue(5);

      const error: ConflictException = await sut
        .appendChunk(auth, 'session-1', 0, Buffer.from('hello'))
        .catch((error_) => error_);

      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ offset: 5 }));
      expect(writeChunkAt).not.toHaveBeenCalled();
    });

    it('throws and writes nothing when the chunk would exceed Upload-Length', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 10 });
      vi.mocked(committedOffset).mockResolvedValue(5);

      await expect(sut.appendChunk(auth, 'session-1', 5, Buffer.alloc(6))).rejects.toBeInstanceOf(BadRequestException);
      expect(writeChunkAt).not.toHaveBeenCalled();
    });

    it('throws for a zero-byte chunk', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession();
      vi.mocked(committedOffset).mockResolvedValue(0);

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.alloc(0))).rejects.toBeInstanceOf(BadRequestException);
      expect(writeChunkAt).not.toHaveBeenCalled();
    });

    it('rejects a body longer than the remaining length without writing it', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 10 });
      vi.mocked(committedOffset).mockResolvedValue(8);

      // The stream should have been capped at size - offset (2 bytes) by the controller; if a
      // longer buffer reaches the service regardless, it must still be rejected rather than
      // silently truncated.
      await expect(sut.appendChunk(auth, 'session-1', 8, Buffer.alloc(20))).rejects.toBeInstanceOf(BadRequestException);
      expect(writeChunkAt).not.toHaveBeenCalled();
    });

    it('is idempotent for a duplicated chunk at the same offset: the later one gets 409 once the first commits', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 20 });
      vi.mocked(committedOffset).mockResolvedValueOnce(0).mockResolvedValueOnce(5);

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).resolves.toEqual({ offset: 5 });

      const error: ConflictException = await sut
        .appendChunk(auth, 'session-1', 0, Buffer.from('hello'))
        .catch((error_) => error_);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ offset: 5 }));
    });

    it('resumes from the true on-disk offset after a partial write', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 20 });
      // The client believes it committed 10 bytes, but a crash mid-write only landed 7.
      vi.mocked(committedOffset).mockResolvedValueOnce(7);

      const error: ConflictException = await sut
        .appendChunk(auth, 'session-1', 10, Buffer.from('rest-of-file'))
        .catch((error_) => error_);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ offset: 7 }));

      vi.mocked(committedOffset).mockResolvedValueOnce(7);
      await expect(sut.appendChunk(auth, 'session-1', 7, Buffer.from('rest'))).resolves.toEqual({ offset: 11 });
      expect(writeChunkAt).toHaveBeenCalledWith(dataPath, 7, Buffer.from('rest'));
    });

    it('accepts chunks of unequal size', async () => {
      // size is deliberately larger than the sum of both chunks so neither append finalizes —
      // this test is purely about the offset/writeChunkAt bookkeeping across unequal chunk sizes.
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 16 });

      vi.mocked(committedOffset).mockResolvedValueOnce(0);
      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.alloc(10))).resolves.toEqual({ offset: 10 });
      expect(writeChunkAt).toHaveBeenCalledWith(dataPath, 0, expect.any(Buffer));

      vi.mocked(committedOffset).mockResolvedValueOnce(10);
      await expect(sut.appendChunk(auth, 'session-1', 10, Buffer.alloc(5))).resolves.toEqual({ offset: 15 });
      expect(writeChunkAt).toHaveBeenCalledWith(dataPath, 10, expect.any(Buffer));
    });

    it('writes with writeChunkAt positionally at the given offset', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 20 });
      vi.mocked(committedOffset).mockResolvedValue(3);

      await sut.appendChunk(auth, 'session-1', 3, Buffer.from('abcde'));

      expect(writeChunkAt).toHaveBeenCalledWith(dataPath, 3, Buffer.from('abcde'));
    });
  });

  describe('appendChunk — finalize', () => {
    const owner = 'owner-1';
    let dataPath: string;
    let statePath: string;

    const finalizedAsset = Object.freeze({ id: 'asset-1' }) as any;

    const setupSession = (overrides: Partial<UploadSessionState> = {}, dtoOverrides: Record<string, unknown> = {}) => {
      const state = makeState({
        userId: owner,
        sharedLinkId: null,
        originalName: 'a.jpg',
        size: 10,
        dto: {
          filename: 'a.jpg',
          fileCreatedAt: '2026-09-08T10:00:00.000Z',
          fileModifiedAt: '2026-09-08T10:00:00.000Z',
          ...dtoOverrides,
        },
        ...overrides,
      });
      vi.mocked(readState).mockResolvedValue(state);
      return state;
    };

    beforeEach(() => {
      const folder = StorageCore.getNestedFolder(StorageFolder.Upload, owner, 'session-1');
      dataPath = sessionPaths(folder, 'session-1', '.jpg').data;
      statePath = sessionPaths(folder, 'session-1', '').state;

      vi.mocked(claimFinalize).mockResolvedValue(true);
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('deadbeef', 'hex'));
      mocks.asset.create.mockResolvedValue(finalizedAsset);
    });

    it('final chunk computes sha1, claims finalize, and calls uploadAsset with a verbatim originalName', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5, originalName: 'ünïcödé 名前.jpg' }, { filename: 'ünïcödé 名前.jpg' });
      vi.mocked(committedOffset).mockResolvedValue(0);

      const spy = vi.spyOn(AssetMediaService.prototype, 'uploadAsset');

      const result = await sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'));

      expect(result).toEqual({ id: 'asset-1', status: AssetMediaStatus.CREATED });
      expect(claimFinalize).toHaveBeenCalledWith(statePath);
      expect(mocks.crypto.hashFile).toHaveBeenCalledWith(dataPath);

      const uploadPath = sessionPaths(
        StorageCore.getNestedFolder(StorageFolder.Upload, owner, 'session-1'),
        'session-1',
        '.jpg',
      ).data;
      expect(spy).toHaveBeenCalledWith(
        auth,
        expect.anything(),
        expect.objectContaining({
          uuid: 'session-1',
          originalPath: uploadPath,
          originalName: 'ünïcödé 名前.jpg',
          size: 5,
        }),
        undefined,
      );

      // the .finalizing marker is removed once the asset is created
      expect(mocks.storage.unlink).toHaveBeenCalledWith(finalizeClaimPath(statePath));
    });

    it('writes the inline sidecar and passes it as the sidecarFile argument', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5 }, { sidecar: '<xmp>hello</xmp>' });
      vi.mocked(committedOffset).mockResolvedValue(0);

      const spy = vi.spyOn(AssetMediaService.prototype, 'uploadAsset');

      await sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'));

      expect(mocks.storage.createOrOverwriteFile).toHaveBeenCalledWith(
        expect.stringContaining('session-1.xmp'),
        Buffer.from('<xmp>hello</xmp>', 'utf8'),
      );
      expect(spy).toHaveBeenCalledWith(
        auth,
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          uuid: 'session-1',
          originalName: 'a.jpg.xmp',
          size: Buffer.from('<xmp>hello</xmp>', 'utf8').length,
        }),
      );
    });

    it('only one of two concurrent finalizers proceeds; the loser gets 404', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5 });
      vi.mocked(committedOffset).mockResolvedValue(0);
      vi.mocked(claimFinalize).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const [first, second] = await Promise.allSettled([
        sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello')),
        sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello')),
      ]);

      expect(first.status).toBe('fulfilled');
      expect(second.status).toBe('rejected');
      if (second.status === 'rejected') {
        expect(second.reason).toBeInstanceOf(NotFoundException);
      }
    });

    it('throws and deletes the data file when the declared checksum does not match', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5, checksum: Buffer.from('cafebabe', 'hex').toString('hex') });
      vi.mocked(committedOffset).mockResolvedValue(0);
      mocks.crypto.hashFile.mockResolvedValue(Buffer.from('deadbeef', 'hex'));

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).rejects.toBeInstanceOf(
        BadRequestException,
      );

      expect(mocks.storage.unlink).toHaveBeenCalledWith(dataPath);
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('propagates the uploadAsset error when livePhotoVideoId is invalid', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5 }, { livePhotoVideoId: 'not-a-real-asset' });
      vi.mocked(committedOffset).mockResolvedValue(0);
      mocks.asset.getById.mockResolvedValue(undefined);

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.storage.unlink).not.toHaveBeenCalledWith(finalizeClaimPath(statePath));
    });

    it('propagates the uploadAsset quota rejection when quota was consumed between create and finalize', async () => {
      const auth = factory.auth({ user: { id: owner, quotaSizeInBytes: 10, quotaUsageInBytes: 8 } });
      setupSession({ size: 5 });
      vi.mocked(committedOffset).mockResolvedValue(0);

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('propagates the rejection when the admin lowers the user quota mid-upload', async () => {
      const auth = factory.auth({ user: { id: owner, quotaSizeInBytes: 3, quotaUsageInBytes: 0 } });
      setupSession({ size: 5 });
      vi.mocked(committedOffset).mockResolvedValue(0);

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.asset.create).not.toHaveBeenCalled();
    });

    it('returns the DUPLICATE response uploadAsset produces for identical bytes', async () => {
      const auth = factory.auth({ user: { id: owner } });
      setupSession({ size: 5 });
      vi.mocked(committedOffset).mockResolvedValue(0);

      const constraintError = new Error('unique key violation') as Error & { constraint_name: string };
      constraintError.constraint_name = ASSET_CHECKSUM_CONSTRAINT;
      mocks.asset.create.mockRejectedValue(constraintError);
      mocks.asset.getUploadAssetIdByChecksum.mockResolvedValue('existing-asset-id');

      await expect(sut.appendChunk(auth, 'session-1', 0, Buffer.from('hello'))).resolves.toEqual({
        id: 'existing-asset-id',
        status: AssetMediaStatus.DUPLICATE,
      });

      // finalize resolved (even though it was a duplicate, not a new asset), so the marker
      // should still be cleaned up.
      expect(mocks.storage.unlink).toHaveBeenCalledWith(finalizeClaimPath(statePath));
    });
  });

  describe('handleUploadSessionCleanup', () => {
    const oldMtime = new Date(Date.now() - UPLOAD_SESSION_TTL_MS - 1000);
    const freshMtime = new Date(Date.now() - 1000);
    let root: string;

    beforeEach(() => {
      root = StorageCore.getBaseFolder(StorageFolder.Upload);
      mocks.database.withLock.mockImplementation(async (_lock, fn) => fn());
    });

    it('deletes a session older than the TTL along with its data file', async () => {
      const statePath = sessionPaths(root, 'session-1', '').state;
      const dataPath = sessionPaths(root, 'session-1', '.jpg').data;

      mocks.storage.readdirWithTypes.mockImplementation((folder) =>
        Promise.resolve(folder === root ? [fakeDirent('session-1.session.json')] : []),
      );
      mocks.storage.stat.mockResolvedValue({ mtime: oldMtime } as any);
      vi.mocked(readState).mockResolvedValue(makeState({ originalName: 'photo.jpg' }));

      await sut.handleUploadSessionCleanup();

      expect(mocks.storage.unlink).toHaveBeenCalledWith(statePath);
      expect(mocks.storage.unlink).toHaveBeenCalledWith(dataPath);
    });

    it('leaves a session younger than the TTL untouched', async () => {
      mocks.storage.readdirWithTypes.mockImplementation((folder) =>
        Promise.resolve(folder === root ? [fakeDirent('session-1.session.json')] : []),
      );
      mocks.storage.stat.mockResolvedValue({ mtime: freshMtime } as any);
      vi.mocked(readState).mockResolvedValue(makeState({ originalName: 'photo.jpg' }));

      await sut.handleUploadSessionCleanup();

      expect(mocks.storage.unlink).not.toHaveBeenCalled();
    });

    it('also reclaims a .finalizing session left by a crashed finalizer', async () => {
      const finalizingPath = finalizeClaimPath(sessionPaths(root, 'session-2', '').state);
      const dataPath = sessionPaths(root, 'session-2', '.mp4').data;

      mocks.storage.readdirWithTypes.mockImplementation((folder) =>
        Promise.resolve(folder === root ? [fakeDirent('session-2.session.json.finalizing')] : []),
      );
      mocks.storage.stat.mockResolvedValue({ mtime: oldMtime } as any);
      vi.mocked(readState).mockResolvedValue(makeState({ originalName: 'clip.mp4' }));

      await sut.handleUploadSessionCleanup();

      expect(mocks.storage.unlink).toHaveBeenCalledWith(finalizingPath);
      expect(mocks.storage.unlink).toHaveBeenCalledWith(dataPath);
    });

    it('runs under DatabaseLock.UploadSessionCleanup', async () => {
      mocks.storage.readdirWithTypes.mockResolvedValue([]);

      await sut.handleUploadSessionCleanup();

      expect(mocks.database.withLock).toHaveBeenCalledWith(DatabaseLock.UploadSessionCleanup, expect.any(Function));
    });

    it('continues sweeping when one session fails to delete', async () => {
      const dataPath1 = sessionPaths(root, 'session-1', '.jpg').data;
      const statePath2 = sessionPaths(root, 'session-2', '').state;
      const dataPath2 = sessionPaths(root, 'session-2', '.jpg').data;

      mocks.storage.readdirWithTypes.mockImplementation((folder) =>
        Promise.resolve(
          folder === root ? [fakeDirent('session-1.session.json'), fakeDirent('session-2.session.json')] : [],
        ),
      );
      mocks.storage.stat.mockResolvedValue({ mtime: oldMtime } as any);
      vi.mocked(readState).mockResolvedValue(makeState({ originalName: 'photo.jpg' }));
      mocks.storage.unlink.mockImplementation((path: string) =>
        path === dataPath1 ? Promise.reject(new Error('disk error')) : Promise.resolve(),
      );

      await sut.handleUploadSessionCleanup();

      expect(mocks.storage.unlink).toHaveBeenCalledWith(statePath2);
      expect(mocks.storage.unlink).toHaveBeenCalledWith(dataPath2);
    });
  });
});
