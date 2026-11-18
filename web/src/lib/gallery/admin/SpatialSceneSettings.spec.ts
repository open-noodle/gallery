import SpatialSceneSettings from '#lib/gallery/admin/SpatialSceneSettings.svelte';
import { accordionManager } from '#lib/managers/accordion-manager.svelte.ts';
import { MockRouter } from '#test/unit/mocks/router.ts';
import type { AdminConfigDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import type { MockInstance } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// The per-photo choices row (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions").

const mocks = vi.hoisted(() => ({
  getSpatialSceneChoices: vi.fn(),
  clearSpatialSceneChoices: vi.fn(),
}));

vi.mock('@immich/sdk', async (importOriginal) => ({ ...(await importOriginal<object>()), ...mocks }));

const config = (enabled: boolean) =>
  ({
    machineLearning: {
      enabled: true,
      spatialScene: { enabled, modelName: 'depth-anything-v2-small', offer: 'suitable' },
    },
  }) as AdminConfigDto;

const renderSettings = (enabled = true) =>
  render(SpatialSceneSettings, { configToEdit: config(enabled), config: config(enabled), disabled: false });

// showDialog is generic over its result; these tests only answer the confirm dialog.
const spyOnDialog = () =>
  vi.spyOn(modalManager, 'showDialog') as unknown as MockInstance<(...args: unknown[]) => Promise<boolean>>;

const clearButton = () => page.getByRole('button', { name: 'admin.spatial_scene_choices_clear' });

describe('SpatialSceneSettings, per-photo choices', () => {
  // The settings controls read the page URL. Set up for the whole file: a rendered component is cleaned up after
  // afterEach runs, and still reads it then.
  const router = new MockRouter();

  beforeAll(() => router.setup());
  afterAll(() => router.teardown());

  beforeEach(() => {
    vi.resetAllMocks();
    accordionManager.open('spatial-scene');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows how many photos have a choice', async () => {
    mocks.getSpatialSceneChoices.mockResolvedValue({ count: 3 });
    await renderSettings();
    await expect.element(page.getByText('admin.spatial_scene_choices_count')).toBeVisible();
    await expect.element(clearButton()).toBeEnabled();
  });

  it('cannot clear when no photo has a choice', async () => {
    mocks.getSpatialSceneChoices.mockResolvedValue({ count: 0 });
    await renderSettings();
    await expect.element(page.getByText('admin.spatial_scene_choices_count')).toBeVisible();
    await expect.element(clearButton()).toBeDisabled();
  });

  it('cannot clear when the count could not be read', async () => {
    mocks.getSpatialSceneChoices.mockRejectedValue(new Error('403'));
    await renderSettings();
    await expect.element(page.getByText('admin.spatial_scene_choices_description')).toBeVisible();
    await expect.element(clearButton()).toBeDisabled();
  });

  it('can clear while Spatial Scene is off', async () => {
    mocks.getSpatialSceneChoices.mockResolvedValue({ count: 2 });
    await renderSettings(false);
    await expect.element(clearButton()).toBeEnabled();
  });

  it('clears after confirming, and shows none left', async () => {
    mocks.getSpatialSceneChoices.mockResolvedValue({ count: 3 });
    mocks.clearSpatialSceneChoices.mockResolvedValue({ count: 3 });
    const dialog = spyOnDialog().mockResolvedValue(true);
    const success = vi.spyOn(toastManager, 'success').mockImplementation(() => ({}) as never);
    await renderSettings();

    await clearButton().click();

    await vi.waitFor(() => expect(success).toHaveBeenCalledWith('admin.spatial_scene_choices_cleared'));
    expect(dialog).toHaveBeenCalledWith(expect.objectContaining({ confirmColor: 'danger' }));
    expect(mocks.clearSpatialSceneChoices).toHaveBeenCalledOnce();
    await expect.element(clearButton()).toBeDisabled();
  });

  it('clears nothing when the dialog is cancelled', async () => {
    mocks.getSpatialSceneChoices.mockResolvedValue({ count: 3 });
    spyOnDialog().mockResolvedValue(false);
    await renderSettings();

    await clearButton().click();

    await vi.waitFor(() => expect(modalManager.showDialog).toHaveBeenCalled());
    expect(mocks.clearSpatialSceneChoices).not.toHaveBeenCalled();
    await expect.element(clearButton()).toBeEnabled();
  });
});
