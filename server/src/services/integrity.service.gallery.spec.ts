import { IntegrityReport } from 'src/enum.js';
import { IntegrityService } from 'src/services/integrity.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Spatial Scene writes `<id>_depth.png`, and video face detection `<id>_faces/<faceId>.jpeg`, beside the asset files
// in the thumbnail folder; the untracked-files scan counts those as tracked (GalleryBaseService
// getGalleryThumbnailFolderPaths).
describe('IntegrityService.handleUntrackedFiles with fork files in the thumbnail folder', () => {
  let sut: IntegrityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(IntegrityService));
    mocks.integrityReport.getAssetPathsByPaths.mockResolvedValue([]);
    mocks.integrityReport.getPersonThumbnailPathsByPaths.mockResolvedValue([]);
    mocks.integrityReport.getAssetFilePathsByPaths.mockResolvedValue([]);
  });

  it('should not report a Spatial Scene depth map in the thumbnail folder', async () => {
    const depthMap = '/data/thumbs/user-id/as/se/asset-id_depth.png';
    mocks.spatialScene.getPathsByPaths.mockResolvedValue([{ path: depthMap }]);

    await sut.handleUntrackedFiles({ type: 'asset_file', paths: [depthMap] });

    expect(mocks.spatialScene.getPathsByPaths).toHaveBeenCalledWith([depthMap]);
    expect(mocks.integrityReport.create).not.toHaveBeenCalled();
  });

  it('should not report the best frame of a video face in the thumbnail folder', async () => {
    const frame = '/data/thumbs/user-id/as/se/asset-id_faces/face-id.jpeg';
    mocks.videoFace.getPathsByPaths.mockResolvedValue([{ path: frame }]);

    await sut.handleUntrackedFiles({ type: 'asset_file', paths: [frame] });

    expect(mocks.videoFace.getPathsByPaths).toHaveBeenCalledWith([frame]);
    expect(mocks.integrityReport.create).not.toHaveBeenCalled();
  });

  it('should report an untracked file in the thumbnail folder', async () => {
    const orphan = '/data/thumbs/user-id/as/se/orphan.webp';

    await sut.handleUntrackedFiles({ type: 'asset_file', paths: [orphan] });

    expect(mocks.integrityReport.create).toHaveBeenCalledWith([{ type: IntegrityReport.UntrackedFile, path: orphan }]);
  });
});

// The Data Saver copy is `<id>_ds.mp4` beside the encoded videos; the untracked-files scan counts it as tracked
// (src/gallery/repositories/data-saver-video.repository.ts getPathsByPaths).
describe('IntegrityService.handleUntrackedFiles with Data Saver copies', () => {
  let sut: IntegrityService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    ({ sut, mocks } = newTestService(IntegrityService));
    mocks.integrityReport.getAssetPathsByPaths.mockResolvedValue([]);
    mocks.integrityReport.getPersonThumbnailPathsByPaths.mockResolvedValue([]);
    mocks.integrityReport.getAssetFilePathsByPaths.mockResolvedValue([]);
  });

  it('should not report a Data Saver copy in the encoded-video folder', async () => {
    const copy = '/data/encoded-video/user-id/as/se/asset-id_ds.mp4';
    mocks.dataSaverVideo.getPathsByPaths.mockResolvedValue([{ path: copy }]);

    await sut.handleUntrackedFiles({ type: 'asset_file', paths: [copy] });

    expect(mocks.dataSaverVideo.getPathsByPaths).toHaveBeenCalledWith([copy]);
    expect(mocks.integrityReport.create).not.toHaveBeenCalled();
  });
});
