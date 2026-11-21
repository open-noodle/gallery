import { OutputInfo } from 'sharp';
import { AssetEditAction } from 'src/dtos/editing.dto.js';
import { AssetFileType } from 'src/enum.js';
import { MediaService } from 'src/services/media.service.js';
import type { RawImageInfo } from 'src/types.js';
import { AssetFactory } from 'test/factories/asset.factory.js';
import { getForGenerateThumbnail } from 'test/mappers.js';
import { factory } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// The edit job for a photo that has versions (asset-version-look.ts): its edited files are rendered from its newest
// edit, another file of the same shot, and stay the photo's own files.
const rawBuffer = Buffer.from('raw image data');

describe('MediaService (the picture of a photo with versions)', () => {
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
    mocks.media.generateThumbhash.mockResolvedValue(factory.buffer());
  });

  /** A photo with one edit behind it, written after the photo's own file. */
  const withEdit = (photo: ReturnType<AssetFactory['build']>, edit: ReturnType<AssetFactory['build']>) => {
    mocks.assetJob.getForGenerateThumbnailJob.mockImplementation((id) =>
      Promise.resolve(getForGenerateThumbnail(id === edit.id ? edit : photo)),
    );
    mocks.assetVersion.hasVersions.mockResolvedValue(true);
    mocks.assetVersion.getVersions.mockResolvedValue([
      { id: edit.id, kind: 'edit', fileModifiedAt: new Date('2026-10-01T10:00:00Z') },
    ] as never);
    mocks.assetVersion.getPhoto.mockResolvedValue({
      id: photo.id,
      originalFileName: 'DSC_1.JPG',
      fileModifiedAt: new Date('2026-08-17T20:59:04Z'),
    } as never);
  };

  it('renders the edited files from the newest edit, as the photo’s own files', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' }).exif().build();
    const edit = AssetFactory.from({ originalPath: '/photos/DSC_1-Edit.jpg' }).exif().build();
    withEdit(photo, edit);

    await sut.handleAssetEditThumbnailGeneration({ id: photo.id });

    // decoded from the edit's file
    expect(mocks.media.decodeImage).toHaveBeenCalledWith('/photos/DSC_1-Edit.jpg', expect.anything());
    expect(mocks.media.decodeImage).not.toHaveBeenCalledWith('/photos/DSC_1.JPG', expect.anything());
    // written as the photo's edited preview, thumbnail and full-size image
    expect(mocks.media.generateThumbnail).toHaveBeenCalledTimes(3);
    expect(mocks.media.generateThumbnail).toHaveBeenCalledWith(
      { data: rawBuffer, info: rawInfo },
      expect.objectContaining({ edits: [] }),
      expect.stringMatching(new RegExp(`${photo.id}_preview_edited`)),
    );
    expect(mocks.asset.upsertFiles).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ assetId: photo.id, type: AssetFileType.Preview, isEdited: true }),
      ]),
    );
    // recorded once the picture exists: what it was rendered from, that file's date, and the picture's size
    expect(mocks.assetVersion.setLook).toHaveBeenCalledWith(
      photo.id,
      { id: edit.id, modifiedAt: new Date('2026-10-01T10:00:00Z') },
      { width: 100, height: 100 },
    );
    expect(mocks.assetVersion.clearLook).not.toHaveBeenCalled();
  });

  it('records nothing when the render fails, so the picture is seen as outdated and rendered again', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' }).exif().build();
    const edit = AssetFactory.from({ originalPath: '/photos/DSC_1-Edit.jpg' }).exif().build();
    withEdit(photo, edit);
    mocks.media.generateThumbnail.mockRejectedValue(new Error('cannot write'));

    await expect(sut.handleAssetEditThumbnailGeneration({ id: photo.id })).rejects.toThrow('cannot write');

    expect(mocks.assetVersion.setLook).not.toHaveBeenCalled();
  });

  it('records the look only once the files are registered: a failure to store them leaves it as it was', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' }).exif().build();
    const edit = AssetFactory.from({ originalPath: '/photos/DSC_1-Edit.jpg' }).exif().build();
    withEdit(photo, edit);
    mocks.asset.upsertFiles.mockRejectedValueOnce(new Error('database gone'));

    await expect(sut.handleAssetEditThumbnailGeneration({ id: photo.id })).rejects.toThrow('database gone');
    expect(mocks.assetVersion.setLook).not.toHaveBeenCalled();

    // and when they are stored, after them
    await sut.handleAssetEditThumbnailGeneration({ id: photo.id });
    const [stored] = mocks.asset.upsertFiles.mock.invocationCallOrder.slice(-1);
    const [recorded] = mocks.assetVersion.setLook.mock.invocationCallOrder;
    expect(recorded).toBeGreaterThan(stored);
  });

  it('renders the new edit when a pairing gave the photo one during its reset, and keeps its edited files', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' })
      .exif()
      .file({ type: AssetFileType.Preview, isEdited: true, path: '/thumbs/preview_edited.jpeg' })
      .build();
    const edit = AssetFactory.from({ originalPath: '/photos/DSC_1-Edit.jpg' }).exif().build();
    withEdit(photo, edit);
    // the job first finds nothing to show; under the photo's lock the reset finds the new edit and is refused
    mocks.assetVersion.hasVersions.mockResolvedValueOnce(false).mockResolvedValue(true);
    mocks.assetVersion.clearLook.mockResolvedValue('refused');

    await sut.handleAssetEditThumbnailGeneration({ id: photo.id });

    expect(mocks.media.decodeImage).toHaveBeenCalledWith('/photos/DSC_1-Edit.jpg', expect.anything());
    expect(mocks.assetVersion.setLook).toHaveBeenCalledWith(
      photo.id,
      { id: edit.id, modifiedAt: new Date('2026-10-01T10:00:00Z') },
      { width: 100, height: 100 },
    );
    // the edited preview is replaced by the new render, not removed
    expect(mocks.asset.deleteFiles).not.toHaveBeenCalled();
  });

  it('fails and leaves the edited files alone when the picture changes again after a refused reset', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' })
      .exif()
      .file({ type: AssetFileType.Preview, isEdited: true, path: '/thumbs/preview_edited.jpeg' })
      .build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(photo));
    // nothing to show when the job looks, an edit under the lock, and nothing again after it
    mocks.assetVersion.hasVersions.mockResolvedValue(false);
    mocks.assetVersion.clearLook.mockResolvedValue('refused');

    await expect(sut.handleAssetEditThumbnailGeneration({ id: photo.id })).rejects.toThrow('changed while');

    expect(mocks.asset.deleteFiles).not.toHaveBeenCalled();
    expect(mocks.assetVersion.setLook).not.toHaveBeenCalled();
  });

  it('lets edits made in Gallery’s own editor win: they apply to the photo’s own file', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' })
      .exif()
      .edit({ action: AssetEditAction.Rotate })
      .build();
    const edit = AssetFactory.from({ originalPath: '/photos/DSC_1-Edit.jpg' }).exif().build();
    withEdit(photo, edit);

    await sut.handleAssetEditThumbnailGeneration({ id: photo.id });

    expect(mocks.media.decodeImage).toHaveBeenCalledWith('/photos/DSC_1.JPG', expect.anything());
    expect(mocks.media.decodeImage).not.toHaveBeenCalledWith('/photos/DSC_1-Edit.jpg', expect.anything());
    // the look is kept for when those edits are removed
    expect(mocks.assetVersion.setLook).not.toHaveBeenCalled();
    expect(mocks.assetVersion.clearLook).not.toHaveBeenCalled();
  });

  it('shows the photo’s own file again when no edit is left behind it: the look goes, and so do the edited files', async () => {
    const photo = AssetFactory.from({ originalPath: '/photos/DSC_1.JPG' })
      .exif()
      .file({ type: AssetFileType.Preview, isEdited: true, path: '/thumbs/preview_edited.jpeg' })
      .build();
    mocks.assetJob.getForGenerateThumbnailJob.mockResolvedValue(getForGenerateThumbnail(photo));
    mocks.assetVersion.hasVersions.mockResolvedValue(false);

    await sut.handleAssetEditThumbnailGeneration({ id: photo.id });

    expect(mocks.assetVersion.clearLook).toHaveBeenCalledWith(photo.id, expect.any(Function));
    // the question it asks again under the photo's lock: still nothing to show
    const nothingToShow = mocks.assetVersion.clearLook.mock.calls[0][1]!;
    expect(await nothingToShow()).toBe(true);
    mocks.assetVersion.hasVersions.mockResolvedValue(true);
    mocks.assetVersion.getVersions.mockResolvedValue([
      { id: 'edit', kind: 'edit', fileModifiedAt: new Date('2026-10-01T10:00:00Z') },
    ] as never);
    mocks.assetVersion.getPhoto.mockResolvedValue({
      id: photo.id,
      originalFileName: 'DSC_1.JPG',
      fileModifiedAt: new Date('2026-08-17T20:59:04Z'),
    } as never);
    expect(await nothingToShow()).toBe(false);
    expect(mocks.assetVersion.setLook).not.toHaveBeenCalled();
    expect(mocks.asset.deleteFiles).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ path: '/thumbs/preview_edited.jpeg' })]),
    );
  });
});
