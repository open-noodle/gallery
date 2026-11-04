import { IntegrityReport } from 'src/enum.js';
import { IntegrityService } from 'src/services/integrity.service.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

// Spatial Scene writes `<id>_depth.png` beside the asset files in the thumbnail folder; the untracked-files scan
// counts those as tracked (src/gallery/repositories/spatial-scene.repository.ts getPathsByPaths).
describe('IntegrityService.handleUntrackedFiles with Spatial Scene depth maps', () => {
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

  it('should report an untracked file in the thumbnail folder', async () => {
    const orphan = '/data/thumbs/user-id/as/se/orphan.webp';

    await sut.handleUntrackedFiles({ type: 'asset_file', paths: [orphan] });

    expect(mocks.integrityReport.create).toHaveBeenCalledWith([{ type: IntegrityReport.UntrackedFile, path: orphan }]);
  });
});
