import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UPLOAD_SESSION_MAX_OPEN } from 'src/constants';
import { StorageCore } from 'src/cores/storage.core';
import { AssetMediaStatus } from 'src/dtos/asset-media-response.dto';
import { UploadSessionCreateDto } from 'src/dtos/upload-session.dto';
import { StorageFolder } from 'src/enum';
import { UploadSessionService } from 'src/services/upload-session.service';
import { fromChecksum } from 'src/utils/request';
import { sessionPaths, writeState } from 'src/utils/upload-session-store';
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

describe(UploadSessionService.name, () => {
  let sut: UploadSessionService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    vi.mocked(writeState).mockReset();
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
});
