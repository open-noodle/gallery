import { OutputInfo } from 'sharp';
import type { RawImageInfo } from 'src/types.js';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetFileType, AssetType } from 'src/enum.js';
import { MediaService } from 'src/services/media.service.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { getForGenerateThumbnail } from 'test/mappers.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// The thumbnail jobs with an image colour adjustment (asset_image_adjust, src/gallery/utils/image-adjust.ts).
const rawBuffer = Buffer.from('raw image data');

describe('MediaService (image adjust)', () => {
  let sut: MediaService;
  let mocks: ServiceMocks;
  let rawInfo: RawImageInfo;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(MediaService));
    rawInfo = { width: 100, height: 100, channels: 3 };
    mocks.person.getFaces.mockResolvedValue([]);
    mocks.ocr.getByAssetId.mockResolvedValue([]);
    mocks.media.decodeImage.mockResolvedValue({ data: rawBuffer, info: rawInfo as OutputInfo });
    mocks.media.getImageMetadata.mockResolvedValue({ width: 100, height: 100, isTransparent: false });
  });

  const adjust = { exposure: 20, contrast: 0, saturation: 0, invert: true };

  it('should generate the edited files for an image whose only edit is the adjustment', async () => {
    const asset = AssetFactory.from().exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.imageAdjust.getForRender.mockResolvedValue(adjust);
    mocks.media.generateThumbhash.mockResolvedValue(factory.buffer());

    await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

    expect(mocks.media.generateThumbnail).toHaveBeenCalledTimes(3);
    expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
      { data: rawBuffer, info: rawInfo },
      expect.objectContaining({ edits: [], adjust }),
      expect.stringContaining('preview_edited.jpeg'),
    );
    expect(mocks.media.generateThumbhash).toHaveBeenCalledWith(
      { data: rawBuffer, info: rawInfo },
      expect.objectContaining({ adjust }),
    );
    expect(mocks.asset.upsertFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ type: AssetFileType.Preview, isEdited: true })]),
    );
  });

  it('should apply the adjustment together with crop, rotate and mirror', async () => {
    const asset = AssetFactory.from().exif().edit({ action: AssetEditAction.Rotate }).build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.imageAdjust.getForRender.mockResolvedValue(adjust);

    await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

    expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
      { data: rawBuffer, info: rawInfo },
      expect.objectContaining({ edits: [expect.objectContaining({ action: 'rotate' })], adjust }),
      expect.stringContaining('thumbnail_edited.webp'),
    );
  });

  it('should read the adjustment through getForRender, which keeps the asset marked edited', async () => {
    // Removing an image's last crop/rotate/mirror clears isEdited through Immich's trigger; see the medium spec.
    const asset = AssetFactory.from().exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.imageAdjust.getForRender.mockResolvedValue(adjust);

    await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

    expect(mocks.imageAdjust.getForRender).toHaveBeenCalledWith(asset.id);
  });

  it('should not adjust the original (unedited) thumbnails', async () => {
    const asset = AssetFactory.from().exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));
    mocks.imageAdjust.getForRender.mockResolvedValue(adjust);

    await sut.handleGenerateThumbnails({ id: asset.id });

    expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ adjust: undefined }),
      expect.stringContaining('preview.jpeg'),
    );
    expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ adjust }),
      expect.stringContaining('preview_edited.jpeg'),
    );
  });

  it('should not look up an adjustment for a video', async () => {
    const asset = AssetFactory.from({ type: AssetType.Video }).exif().build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(asset));

    await sut.handleAssetEditThumbnailGeneration({ id: asset.id });

    expect(mocks.imageAdjust.getForRender).not.toHaveBeenCalled();
  });
});
