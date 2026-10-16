import { editAsset, getAssetAdjust, removeAssetAdjust, removeAssetEdits, updateAssetAdjust } from '@immich/sdk';
import { imageAdjustFilter } from '$lib/gallery/edit/image-adjust';
import { ImageAdjustManager, withImageAdjust } from '$lib/gallery/edit/image-adjust-manager.svelte';
import type { EditToolManager } from '$lib/managers/edit/edit-manager.svelte';
import { waitForWebsocketEvent } from '$lib/stores/websocket';
import { assetFactory } from '@test-data/factories/asset-factory';

vi.mock('@immich/sdk');
vi.mock('$lib/stores/websocket', () => ({ waitForWebsocketEvent: vi.fn() }));

const waitForEditReady = vi.mocked(waitForWebsocketEvent);

const stored = { exposure: 15, contrast: -5, saturation: 40, invert: true };

const transformTool = (overrides: Partial<EditToolManager> = {}): EditToolManager => ({
  onActivate: vi.fn(),
  onDeactivate: vi.fn(),
  resetAllChanges: vi.fn(),
  hasChanges: false,
  canReset: false,
  edits: [],
  ...overrides,
});

describe('imageAdjustFilter', () => {
  it('is empty for a neutral adjustment', () => {
    expect(imageAdjustFilter({ exposure: 0, contrast: 0, saturation: 0, invert: false })).toBe('');
  });

  it('orders the functions as the server renders them: saturate, invert, brightness, contrast', () => {
    expect(imageAdjustFilter({ exposure: 20, contrast: 30, saturation: -50, invert: true })).toBe(
      'saturate(0.5) invert(1) brightness(1.2) contrast(1.3)',
    );
  });
});

describe(ImageAdjustManager.name, () => {
  let manager: ImageAdjustManager;

  beforeEach(() => {
    vi.resetAllMocks();
    manager = new ImageAdjustManager();
  });

  it('loads the stored adjustment without counting it as a change', async () => {
    vi.mocked(getAssetAdjust).mockResolvedValue(stored);

    await manager.load('asset-1');

    expect(manager.current).toEqual(stored);
    expect(manager.hasChanges).toBe(false);
    expect(manager.canReset).toBe(true);
  });

  it('counts a slider move as a change, and moving it back as none', async () => {
    vi.mocked(getAssetAdjust).mockResolvedValue(stored);
    await manager.load('asset-1');

    manager.exposure = 30;
    expect(manager.hasChanges).toBe(true);

    manager.exposure = 15;
    expect(manager.hasChanges).toBe(false);
  });

  it('falls back to neutral when the adjustment cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getAssetAdjust).mockRejectedValue(new Error('offline'));

    await manager.load('asset-1');

    expect(manager.current).toEqual({ exposure: 0, contrast: 0, saturation: 0, invert: false });
  });

  it('saves nothing when nothing changed', async () => {
    await expect(manager.save('asset-1')).resolves.toBe(false);
    expect(updateAssetAdjust).not.toHaveBeenCalled();
    expect(removeAssetAdjust).not.toHaveBeenCalled();
  });

  it('puts a changed adjustment', async () => {
    manager.invert = true;

    await expect(manager.save('asset-1')).resolves.toBe(true);

    expect(updateAssetAdjust).toHaveBeenCalledWith({
      id: 'asset-1',
      assetImageAdjustDto: { exposure: 0, contrast: 0, saturation: 0, invert: true },
    });
    expect(manager.hasChanges).toBe(false);
  });

  it('deletes the adjustment once everything is back at neutral', async () => {
    vi.mocked(getAssetAdjust).mockResolvedValue(stored);
    await manager.load('asset-1');

    manager.resetAllChanges();
    await manager.save('asset-1');

    expect(removeAssetAdjust).toHaveBeenCalledWith({ id: 'asset-1' });
    expect(updateAssetAdjust).not.toHaveBeenCalled();
  });

  it('previews the current values', () => {
    manager.saturation = -100;
    expect(manager.filter).toBe('saturate(0)');
  });

  it('returns to the sliders and neutral values on reset', () => {
    manager.mode = 'crop';
    manager.contrast = 10;

    manager.reset();

    expect(manager.mode).toBe('edit');
    expect(manager.canReset).toBe(false);
    expect(manager.hasChanges).toBe(false);
  });
});

describe('withImageAdjust', () => {
  let adjust: ImageAdjustManager;
  const asset = assetFactory.build();

  beforeEach(() => {
    vi.resetAllMocks();
    adjust = new ImageAdjustManager();
    vi.mocked(getAssetAdjust).mockResolvedValue({ exposure: 0, contrast: 0, saturation: 0, invert: false });
    waitForEditReady.mockResolvedValue(undefined as never);
  });

  it('activates both the transform tool and the adjustment', async () => {
    const transform = transformTool();
    vi.mocked(getAssetAdjust).mockResolvedValue(stored);

    await withImageAdjust(transform, adjust).onActivate(asset, []);

    expect(transform.onActivate).toHaveBeenCalledWith(asset, []);
    expect(adjust.current).toEqual(stored);
  });

  it('reports a slider change as an unsaved change of the tool', () => {
    const tool = withImageAdjust(transformTool(), adjust);
    expect(tool.hasChanges).toBe(false);

    adjust.exposure = 5;

    expect(tool.hasChanges).toBe(true);
    expect(tool.canReset).toBe(true);
  });

  it('resets both on reset all', async () => {
    const transform = transformTool();
    adjust.invert = true;

    await withImageAdjust(transform, adjust).resetAllChanges();

    expect(transform.resetAllChanges).toHaveBeenCalled();
    expect(adjust.canReset).toBe(false);
  });

  it('saves crop/rotate/mirror through Immich when the adjustment did not change', async () => {
    const edits = [{ action: 'rotate', parameters: { angle: 90 } }] as EditToolManager['edits'];

    await withImageAdjust(transformTool({ hasChanges: true, edits }), adjust).save!(asset.id);

    expect(editAsset).toHaveBeenCalledWith({ id: asset.id, assetEditsCreateDto: { edits } });
    expect(updateAssetAdjust).not.toHaveBeenCalled();
    // EditManager's own listener waits for this job.
    expect(waitForEditReady).not.toHaveBeenCalled();
  });

  it('keeps Immich behaviour for a save with no changes at all', async () => {
    await withImageAdjust(transformTool(), adjust).save!(asset.id);

    expect(removeAssetEdits).toHaveBeenCalledWith({ id: asset.id });
  });

  it('saves only the adjustment when only the sliders moved', async () => {
    adjust.exposure = 10;

    await withImageAdjust(transformTool(), adjust).save!(asset.id);

    expect(updateAssetAdjust).toHaveBeenCalled();
    expect(editAsset).not.toHaveBeenCalled();
    expect(removeAssetEdits).not.toHaveBeenCalled();
  });

  it('waits for the adjustment job before saving crop/rotate/mirror, then for that job', async () => {
    const order: string[] = [];
    vi.mocked(updateAssetAdjust).mockImplementation(() => {
      order.push('adjust');
      return Promise.resolve(stored);
    });
    vi.mocked(editAsset).mockImplementation(() => {
      order.push('edit');
      return Promise.resolve({ assetId: asset.id, edits: [] });
    });
    waitForEditReady.mockImplementation(() => {
      order.push('wait');
      return Promise.resolve(undefined as never);
    });
    const edits = [{ action: 'rotate', parameters: { angle: 90 } }] as EditToolManager['edits'];
    adjust.invert = true;

    await withImageAdjust(transformTool({ hasChanges: true, edits }), adjust).save!(asset.id);

    expect(order).toEqual(['wait', 'adjust', 'wait', 'edit']);
    expect(waitForEditReady).toHaveBeenCalledWith('AssetEditReadyV2', expect.any(Function), expect.any(Number));
  });

  it('also saves a reset crop/rotate/mirror, which does not count as a change of the transform tool', async () => {
    const rotate = [{ action: 'rotate', parameters: { angle: 90 } }] as EditToolManager['edits'];
    const transform = transformTool({ edits: rotate });
    const tool = withImageAdjust(transform, adjust);
    vi.mocked(getAssetAdjust).mockResolvedValue(stored);
    await tool.onActivate(asset, rotate);

    // Reset changes: the tool's edits are gone, its hasChanges stays false.
    transform.edits = [];
    adjust.resetAllChanges();
    await tool.save!(asset.id);

    expect(removeAssetAdjust).toHaveBeenCalledWith({ id: asset.id });
    expect(removeAssetEdits).toHaveBeenCalledWith({ id: asset.id });
  });

  it('does not re-save crop/rotate/mirror the tool opened with', async () => {
    const rotate = [{ action: 'rotate', parameters: { angle: 90 } }] as EditToolManager['edits'];
    const tool = withImageAdjust(transformTool({ edits: rotate }), adjust);
    await tool.onActivate(asset, [{ id: 'edit-1', action: 'rotate', parameters: { angle: 90 } }] as never);

    adjust.exposure = 10;
    await tool.save!(asset.id);

    expect(updateAssetAdjust).toHaveBeenCalled();
    expect(editAsset).not.toHaveBeenCalled();
  });

  it('does not save crop/rotate/mirror when the adjustment job never finishes', async () => {
    waitForEditReady.mockRejectedValue(new Error('Timeout waiting for event: AssetEditReadyV2'));
    adjust.invert = true;

    await expect(withImageAdjust(transformTool({ hasChanges: true }), adjust).save!(asset.id)).rejects.toThrow(
      'Timeout',
    );

    expect(updateAssetAdjust).toHaveBeenCalled();
    expect(removeAssetEdits).not.toHaveBeenCalled();
  });
});
