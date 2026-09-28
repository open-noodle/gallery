import { Colorspace, ImageFormat, ImagePresetPosition, type AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
import ImageSettings from './ImageSettings.svelte';

// Gallery-fork: derived image presets (image.presets). See specs/2026-09-22-derived-image-presets-design.md.

const makeConfig = (presets: AdminConfigDto['image']['presets'] = {}) =>
  ({
    image: {
      thumbnail: { format: ImageFormat.Webp, size: 250, quality: 80, progressive: false },
      preview: { format: ImageFormat.Jpeg, size: 1440, quality: 80, progressive: false },
      fullsize: { enabled: false, format: ImageFormat.Jpeg, quality: 80, progressive: false },
      colorspace: Colorspace.P3,
      extractEmbedded: false,
      presets,
    },
  }) as AdminConfigDto;

const landscape = {
  aspectRatio: '16:9',
  widths: [1600, 1280, 960, 640, 320],
  position: ImagePresetPosition.Center,
  format: ImageFormat.Webp,
  quality: 80,
};

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  cloneValue: vi.fn(),
  cloneDefaultValue: vi.fn(),
}));

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('$lib/managers/system-config-manager.svelte'), () => ({
  systemConfigManager: {
    get value() {
      return mocks.systemConfig;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
}));

// Every accordion renders open, so the preset card is reachable without driving the
// query-string-backed accordion manager (whose open() calls goto()).
vi.mock(import('$lib/managers/accordion-manager.svelte'), () => ({
  accordionManager: { isOpen: () => true, open: vi.fn(), close: vi.fn() } as never,
}));

vi.mock('@immich/ui', async (original) => {
  const mod = await original<typeof import('@immich/ui')>();
  return {
    ...mod,
    // Replace IconButton with a plain button to avoid the Tooltip.Provider context requirement
    IconButton: mod.Button,
  };
});

// SettingInputField labels via `for={label}` / `id={label}`, which happy-dom does not treat as an
// association, so reach the new-preset input by its id (the untranslated key under test).
const getNameInput = () => document.querySelector<HTMLInputElement>(String.raw`#admin\.image_preset_name`)!;

describe('ImageSettings – derived image presets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('shows the empty state when no presets are configured', () => {
    render(ImageSettings);

    expect(screen.getByText('admin.image_presets_empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'admin.image_preset_add' })).toBeDisabled();
  });

  it('renders a configured preset with its fields', () => {
    mocks.systemConfig = makeConfig({ landscape });
    render(ImageSettings);

    const card = screen.getByTestId('image-preset-landscape');
    expect(within(card).getByText('landscape')).toBeInTheDocument();
    expect(within(card).getByDisplayValue('16:9')).toBeInTheDocument();
    expect(within(card).getByDisplayValue('1600, 1280, 960, 640, 320')).toBeInTheDocument();
    expect(within(card).getByDisplayValue('80')).toBeInTheDocument();
    expect(screen.queryByText('admin.image_presets_empty')).not.toBeInTheDocument();
  });

  it('adds a preset with sensible defaults and saves it', async () => {
    const user = userEvent.setup();
    render(ImageSettings);

    const addButton = screen.getByRole('button', { name: 'admin.image_preset_add' });
    const nameInput = getNameInput();
    await user.type(nameInput, 'square');
    expect(addButton).toBeEnabled();
    await user.click(addButton);

    const card = screen.getByTestId('image-preset-square');
    expect(within(card).getByDisplayValue('16:9')).toBeInTheDocument();
    expect(nameInput).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({
          presets: {
            square: {
              aspectRatio: '16:9',
              widths: [1600, 1280, 960, 640, 320],
              position: ImagePresetPosition.Center,
              format: ImageFormat.Webp,
              quality: 80,
            },
          },
        }),
      }),
    );
  });

  it('refuses names that are not URL-safe slugs or already exist', async () => {
    mocks.systemConfig = makeConfig({ landscape });
    const user = userEvent.setup();
    render(ImageSettings);

    const addButton = screen.getByRole('button', { name: 'admin.image_preset_add' });
    const nameInput = getNameInput();

    await user.type(nameInput, 'Blog Hero');
    expect(addButton).toBeDisabled();
    expect(screen.getByText('admin.image_preset_name_invalid')).toBeInTheDocument();

    await user.clear(nameInput);
    await user.type(nameInput, 'landscape');
    expect(addButton).toBeDisabled();
  });

  it('folds the widths text back into the payload, dropping junk and duplicates', async () => {
    mocks.systemConfig = makeConfig({ landscape });
    const user = userEvent.setup();
    render(ImageSettings);

    const widths = within(screen.getByTestId('image-preset-landscape')).getByDisplayValue('1600, 1280, 960, 640, 320');
    await user.clear(widths);
    await user.type(widths, '1600, abc, 1600; 800 8');

    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({
        image: expect.objectContaining({
          presets: { landscape: expect.objectContaining({ widths: [1600, 800] }) },
        }),
      }),
    );
  });

  it('flags a malformed aspect ratio and an empty width list', async () => {
    mocks.systemConfig = makeConfig({ landscape });
    const user = userEvent.setup();
    render(ImageSettings);

    const card = screen.getByTestId('image-preset-landscape');
    const aspect = within(card).getByDisplayValue('16:9');
    await user.clear(aspect);
    await user.type(aspect, '16x9');
    expect(within(card).getByText('admin.image_preset_aspect_ratio_invalid')).toBeInTheDocument();

    const widths = within(card).getByDisplayValue('1600, 1280, 960, 640, 320');
    await user.clear(widths);
    expect(within(card).getByText('admin.image_preset_widths_invalid')).toBeInTheDocument();
  });

  it('removes a preset from the payload', async () => {
    mocks.systemConfig = makeConfig({ landscape });
    const user = userEvent.setup();
    render(ImageSettings);

    await user.click(screen.getByRole('button', { name: 'admin.image_preset_remove' }));

    expect(screen.queryByTestId('image-preset-landscape')).not.toBeInTheDocument();
    expect(screen.getByText('admin.image_presets_empty')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({ image: expect.objectContaining({ presets: {} }) }),
    );
  });

  it('disables editing when the config comes from a file', () => {
    mocks.featureFlags.configFile = true;
    mocks.systemConfig = makeConfig({ landscape });
    render(ImageSettings);

    expect(screen.getByRole('button', { name: 'admin.image_preset_remove' })).toBeDisabled();
    expect(getNameInput()).toBeDisabled();
  });
});
