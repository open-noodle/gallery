import type { AssetResponseDto } from 'src/dtos/asset-response.dto.js';
import { galleryMachineLearningDefaults } from 'src/gallery/dtos/config.dto.js';
import { applyAssetResponseOverlay } from 'src/gallery/utils/asset-response-overlay.js';
import { factory } from 'test/small.factory.js';

// The Spatial Scene half of the overlay (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"). A shared-link
// session returns right after it, so these cases need no other dependency.

const sharp = { boundarySharpness: 0.09, edgeDensity: 0.013, foregroundRatio: 0.3 };
const flat = { boundarySharpness: 0.004, edgeDensity: 0.001, foregroundRatio: 0.4 };

const resolve = async ({
  enabled = true,
  scene,
  offer = null,
}: {
  enabled?: boolean;
  scene?: Record<string, unknown>;
  offer?: boolean | null;
}) => {
  const spatialScene = { get: vi.fn().mockResolvedValue(scene), getOffer: vi.fn().mockResolvedValue(offer) };
  const data = {} as AssetResponseDto;
  await applyAssetResponseOverlay(
    {
      spatialScene,
      getConfig: () =>
        Promise.resolve({
          machineLearning: {
            enabled: true,
            spatialScene: { ...galleryMachineLearningDefaults.spatialScene, enabled },
          },
        }),
    } as any,
    { auth: factory.auth({ sharedLink: {} }), id: 'asset-1', data, faces: [] },
  );
  return { data, spatialScene };
};

describe('applyAssetResponseOverlay, Spatial Scene', () => {
  it('reports neither the button nor a choice while Spatial Scene is off', async () => {
    const { data, spatialScene } = await resolve({ enabled: false, scene: { ...sharp, offered: true } });
    expect(data.spatialScene).toBe(false);
    expect(data.spatialSceneChoice).toBeUndefined();
    expect(spatialScene.get).not.toHaveBeenCalled();
  });

  it('decides automatically without a choice', async () => {
    await expect(resolve({ scene: { ...sharp, offered: null } })).resolves.toMatchObject({
      data: { spatialScene: true, spatialSceneChoice: null },
    });
    await expect(resolve({ scene: { ...flat, offered: null } })).resolves.toMatchObject({
      data: { spatialScene: false, spatialSceneChoice: null },
    });
  });

  it('reports when the depth map was made, for the depth map URL', async () => {
    const createdAt = new Date('2026-11-17T10:00:00.000Z');
    const { data } = await resolve({ scene: { ...sharp, offered: null, createdAt } });
    expect(data.spatialSceneDepthMapCreatedAt).toBe('2026-11-17T10:00:00.000Z');
  });

  it('follows the choice and reports it', async () => {
    await expect(resolve({ scene: { ...flat, offered: true } })).resolves.toMatchObject({
      data: { spatialScene: true, spatialSceneChoice: true },
    });
    await expect(resolve({ scene: { ...sharp, offered: false } })).resolves.toMatchObject({
      data: { spatialScene: false, spatialSceneChoice: false },
    });
  });

  it('reports a choice made before the depth map, without the button', async () => {
    const { data } = await resolve({ scene: undefined, offer: true });
    expect(data).toMatchObject({ spatialScene: false, spatialSceneChoice: true });
    expect(data.spatialSceneDepthMapCreatedAt).toBeUndefined();
  });
});
