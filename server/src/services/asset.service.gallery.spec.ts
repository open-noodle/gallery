import { BadRequestException } from '@nestjs/common';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetType, JobName } from 'src/enum.js';
import { AssetService } from 'src/services/asset.service.js';
import { authStub } from 'test/fixtures/auth.stub.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Gallery's hooks in AssetService (rule 8: fork tests of upstream code sit beside it, not in upstream's spec).
describe('AssetService (Gallery)', () => {
  let sut: AssetService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(AssetService));
  });

  const editable = () => {
    const assetId = newUuid();
    mocks.access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
    mocks.asset.getForEdit.mockResolvedValue({
      type: AssetType.Image,
      livePhotoVideoId: null,
      originalPath: '/data/DSC_1.JPG',
      originalFileName: 'DSC_1.JPG',
      exifImageWidth: 6000,
      exifImageHeight: 4000,
      orientation: null,
      projectionType: null,
    });
    mocks.assetEdit.replaceAll.mockResolvedValue([]);
    return assetId;
  };

  /** The photo's own file, and what is behind it. */
  const behind = (assetId: string, versions: Array<{ id: string; kind: string; fileModifiedAt: Date }>) => {
    mocks.assetVersion.hasVersions.mockResolvedValue(versions.length > 0);
    mocks.assetVersion.getVersions.mockResolvedValue(versions as never);
    mocks.assetVersion.getPhoto.mockResolvedValue({
      id: assetId,
      originalFileName: 'DSC_1.JPG',
      fileModifiedAt: new Date('2026-08-17T20:59:04Z'),
    } as never);
  };

  // Asset versions (src/gallery/utils/asset-version-look.ts): the editor works on the photo's own file.
  describe('editAsset on a photo with versions', () => {
    const rotate = { edits: [{ action: AssetEditAction.Rotate as const, parameters: { angle: 90 } }] };

    it('refuses to crop or rotate a photo that shows an edit made elsewhere, and saves nothing', async () => {
      const assetId = editable();
      behind(assetId, [{ id: newUuid(), kind: 'edit', fileModifiedAt: new Date('2026-10-01T10:00:00Z') }]);

      await expect(sut.editAsset(authStub.admin, assetId, rotate)).rejects.toThrow(
        new BadRequestException(
          'This photo shows an edit made in another program, so it cannot be cropped or rotated here',
        ),
      );

      expect(mocks.assetEdit.replaceAll).not.toHaveBeenCalled();
      expect(mocks.job.queue).not.toHaveBeenCalled();
    });

    it('still edits a photo that shows its own file: one with only a RAW behind it, or with no versions', async () => {
      const withRaw = editable();
      behind(withRaw, [{ id: newUuid(), kind: 'raw', fileModifiedAt: new Date('2026-08-17T20:59:04Z') }]);
      await sut.editAsset(authStub.admin, withRaw, rotate);
      expect(mocks.assetEdit.replaceAll).toHaveBeenCalledWith(withRaw, rotate.edits);

      const plain = editable();
      behind(plain, []);
      await sut.editAsset(authStub.admin, plain, rotate);
      expect(mocks.assetEdit.replaceAll).toHaveBeenCalledWith(plain, rotate.edits);
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.AssetEditThumbnailGeneration, data: { id: plain } });
    });

    it('still removes edits from a photo that shows an edit made elsewhere', async () => {
      const assetId = editable();
      behind(assetId, [{ id: newUuid(), kind: 'edit', fileModifiedAt: new Date('2026-10-01T10:00:00Z') }]);
      mocks.asset.getById.mockResolvedValue({ id: assetId } as never);

      await sut.removeAssetEdits(authStub.admin, assetId);

      expect(mocks.assetEdit.replaceAll).toHaveBeenCalledWith(assetId, []);
    });
  });
});
