import {
  getRoutingStatus,
  RoutedTo,
  type ServerFeaturesDto,
  type StorageRoutingStatusDto,
  type SystemConfigDto,
} from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import StorageSettings from './StorageSettings.svelte';

const { handleErrorMock } = vi.hoisted(() => ({ handleErrorMock: vi.fn() }));
vi.mock(import('$lib/utils/handle-error'), () => ({ handleError: handleErrorMock }));

const makeStorageConfig = () =>
  ({
    storage: { routing: { originals: 'auto', thumbnails: 'auto', encodedVideo: 'auto' } },
  }) as SystemConfigDto;

const makeRoutingStatus = (): StorageRoutingStatusDto => ({
  originals: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
  thumbnails: { routedTo: RoutedTo.Disk, misplacedCount: 42 },
  encodedVideo: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
});

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false, s3Storage: true } as Pick<ServerFeaturesDto, 'configFile' | 's3Storage'>,
  systemConfig: {} as SystemConfigDto,
  defaultSystemConfig: {} as SystemConfigDto,
  routingStatus: {} as StorageRoutingStatusDto,
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

vi.mock(import('@immich/sdk'), async (importOriginal) => ({
  ...(await importOriginal()),
  getRoutingStatus: vi.fn(() => Promise.resolve(mocks.routingStatus)),
}));

describe('StorageSettings', () => {
  beforeAll(async () => {
    // Load the real en bundle so option/hint text renders as actual English rather than the raw
    // i18n key (global test setup uses fallbackLocale: 'dev', which returns bare keys) — needed to
    // assert the {backend} interpolation actually happened, not just that a key was referenced.
    register('en-US', () => import('$i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags = { configFile: false, s3Storage: true };
    mocks.systemConfig = makeStorageConfig();
    mocks.defaultSystemConfig = makeStorageConfig();
    mocks.routingStatus = makeRoutingStatus();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('renders the S3 option disabled when s3Storage is false', async () => {
    mocks.featureFlags.s3Storage = false;

    render(StorageSettings);

    await waitFor(() => expect(screen.getAllByRole('option', { name: 'S3' })).toHaveLength(3));

    for (const option of screen.getAllByRole('option', { name: 'S3' })) {
      expect(option).toBeDisabled();
    }
    expect(screen.getByText('Set IMMICH_S3_BUCKET to enable S3 storage')).toBeInTheDocument();
  });

  it('enables the S3 option when s3Storage is true', async () => {
    mocks.featureFlags.s3Storage = true;

    render(StorageSettings);

    await waitFor(() => expect(screen.getAllByRole('option', { name: 'S3' })).toHaveLength(3));

    for (const option of screen.getAllByRole('option', { name: 'S3' })) {
      expect(option).not.toBeDisabled();
    }
    expect(screen.queryByText('Set IMMICH_S3_BUCKET to enable S3 storage')).not.toBeInTheDocument();
  });

  it('disables every control when configFile is true', async () => {
    mocks.featureFlags.configFile = true;

    render(StorageSettings);

    await waitFor(() => expect(screen.getAllByRole('combobox')).toHaveLength(3));

    for (const select of screen.getAllByRole('combobox')) {
      expect(select).toBeDisabled();
    }
  });

  it('interpolates the resolved env backend into the auto label', async () => {
    mocks.routingStatus = {
      ...makeRoutingStatus(),
      thumbnails: { routedTo: RoutedTo.S3, misplacedCount: 0 },
    };

    render(StorageSettings);

    const autoOption = await screen.findByRole('option', { name: /currently: S3/ });
    expect(autoOption).toBeInTheDocument();
  });

  it('renders the migrate link only when misplacedCount is greater than zero', async () => {
    render(StorageSettings);

    const links = await screen.findAllByRole('link');
    expect(links).toHaveLength(1);
  });

  it('points the migrate link at the migration page with direction and file types prefilled', async () => {
    render(StorageSettings);

    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute(
      'href',
      '/admin/storage-migration?direction=toDisk&fileTypes=thumbnails,previews,fullsize,personThumbnails,profileImages',
    );
  });

  it('does not claim a backend or offer a migrate link when the routing status fetch fails', async () => {
    vi.mocked(getRoutingStatus).mockRejectedValueOnce(new Error('network error'));

    render(StorageSettings);

    await waitFor(() =>
      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'Failed to fetch routing status'),
    );

    expect(screen.getAllByRole('option', { name: 'Follow IMMICH_STORAGE_BACKEND' })).toHaveLength(3);
    expect(screen.queryAllByRole('option', { name: /currently:/ })).toHaveLength(0);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
