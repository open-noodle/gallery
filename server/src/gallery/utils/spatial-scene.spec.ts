import { galleryMachineLearningDefaults } from 'src/gallery/dtos/config.dto.js';
import { FaceBox, isSpatialSceneEnabled, isSpatialSceneOffered } from 'src/gallery/utils/spatial-scene.js';

const config = galleryMachineLearningDefaults.spatialScene;
const flat = { boundarySharpness: 0.004, edgeDensity: 0.001, foregroundRatio: 0.4 };
const face = (height: number, overrides: Partial<FaceBox> = {}): FaceBox => ({
  boundingBoxY1: 100,
  boundingBoxY2: 100 + height,
  imageHeight: 1000,
  deletedAt: null,
  isVisible: true,
  ...overrides,
});

describe('isSpatialSceneOffered', () => {
  it('offers a photo with a sharp subject outline', () => {
    expect(isSpatialSceneOffered({ ...flat, boundarySharpness: 0.09 }, config, [])).toBe(true);
  });

  it('offers a photo of many sharp edges, such as a forest', () => {
    expect(isSpatialSceneOffered({ ...flat, edgeDensity: 0.05 }, config, [])).toBe(true);
  });

  it('does not offer a flat photo', () => {
    expect(isSpatialSceneOffered(flat, config, [])).toBe(false);
  });

  it('does not offer a sharp photo whose foreground fills the frame, such as a wall', () => {
    expect(isSpatialSceneOffered({ ...flat, boundarySharpness: 0.2, foregroundRatio: 0.8 }, config, [])).toBe(false);
  });

  it('offers a photo with a face of 3% of its height or more, whatever its depth', () => {
    expect(isSpatialSceneOffered({ ...flat, foregroundRatio: 0.82 }, config, [face(30)])).toBe(true);
    expect(isSpatialSceneOffered(flat, config, [face(29)])).toBe(false);
  });

  it('ignores deleted and invisible faces', () => {
    expect(isSpatialSceneOffered(flat, config, [face(300, { deletedAt: new Date() })])).toBe(false);
    expect(isSpatialSceneOffered(flat, config, [face(300, { isVisible: false })])).toBe(false);
    expect(isSpatialSceneOffered(flat, config, [face(300, { imageHeight: 0 })])).toBe(false);
  });

  it('ignores faces when minFaceHeight is 0', () => {
    expect(isSpatialSceneOffered(flat, { ...config, minFaceHeight: 0 }, [face(500)])).toBe(false);
  });

  it('offers every photo with a depth map in "all" mode', () => {
    expect(isSpatialSceneOffered(flat, { ...config, offer: 'all' }, [])).toBe(true);
  });
});

describe('isSpatialSceneEnabled', () => {
  it('needs both machine learning and Spatial Scene on', () => {
    expect(isSpatialSceneEnabled({ enabled: true, spatialScene: { enabled: true } })).toBe(true);
    expect(isSpatialSceneEnabled({ enabled: false, spatialScene: { enabled: true } })).toBe(false);
    expect(isSpatialSceneEnabled({ enabled: true, spatialScene: { enabled: false } })).toBe(false);
  });
});
