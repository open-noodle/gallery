import {
  RoutedTo,
  getRoutingStatus,
  type AdminConfigDto,
  type ServerFeaturesDto,
  type StorageRoutingStatusDto,
} from '@immich/sdk';
import { init, register, waitLocale } from 'svelte-i18n';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, type Locator } from 'vitest/browser';
import StorageSettings from './StorageSettings.svelte';

const findOne = async (locator: Locator) => {
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

const findAll = async (locator: Locator) => {
  await vi.waitFor(() => expect(locator.elements().length).toBeGreaterThan(0));
  return locator.elements() as HTMLElement[];
};

const { handleErrorMock } = vi.hoisted(() => ({ handleErrorMock: vi.fn() }));
vi.mock(import('#lib/utils/handle-error.ts'), () => ({ handleError: handleErrorMock }));

const makeStorageConfig = () =>
  ({
    storage: { routing: { originals: 'auto', thumbnails: 'auto', encodedVideo: 'auto' } },
  }) as unknown as AdminConfigDto;

const makeRoutingStatus = (): StorageRoutingStatusDto => ({
  originals: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
  thumbnails: { routedTo: RoutedTo.Disk, misplacedCount: 42 },
  encodedVideo: { routedTo: RoutedTo.Disk, misplacedCount: 0 },
});

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false, s3Configured: true } as Pick<ServerFeaturesDto, 'configFile' | 's3Configured'>,
  systemConfig: {} as AdminConfigDto,
  defaultSystemConfig: {} as AdminConfigDto,
  routingStatus: {} as StorageRoutingStatusDto,
}));

vi.mock(import('#lib/managers/feature-flags-manager.svelte.ts'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('#lib/queries/client.js'), async (importOriginal) => ({
  ...(await importOriginal()),
  createPreloadedQuery: ((optionsFn: () => { queryKey: readonly unknown[] }) => ({
    get data() {
      return optionsFn().queryKey.includes('defaults') ? mocks.defaultSystemConfig : mocks.systemConfig;
    },
  })) as never,
}));

vi.mock(import('@tanstack/svelte-query'), async (importOriginal) => ({
  ...(await importOriginal()),
  createMutation: (() => ({ mutate: vi.fn(), isPending: false })) as never,
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
    register('en-US', () => import('#i18n/en.json'));
    await init({ fallbackLocale: 'en-US' });
    await waitLocale('en-US');
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags = { configFile: false, s3Configured: true };
    mocks.systemConfig = makeStorageConfig();
    mocks.defaultSystemConfig = makeStorageConfig();
    mocks.routingStatus = makeRoutingStatus();
  });

  it('renders the S3 option disabled when s3Configured is false', async () => {
    mocks.featureFlags.s3Configured = false;

    await render(StorageSettings);

    await vi.waitFor(() => expect(page.getByRole('option', { name: 'S3', exact: true }).elements()).toHaveLength(3));

    for (const option of page.getByRole('option', { name: 'S3', exact: true }).elements()) {
      expect(option).toBeDisabled();
    }
    expect(page.getByText('Set IMMICH_S3_BUCKET to enable S3 storage').element()).toBeInTheDocument();
  });

  it('enables the S3 option when s3Configured is true', async () => {
    mocks.featureFlags.s3Configured = true;

    await render(StorageSettings);

    await vi.waitFor(() => expect(page.getByRole('option', { name: 'S3', exact: true }).elements()).toHaveLength(3));

    for (const option of page.getByRole('option', { name: 'S3', exact: true }).elements()) {
      expect(option).not.toBeDisabled();
    }
    expect(page.getByText('Set IMMICH_S3_BUCKET to enable S3 storage').query()).not.toBeInTheDocument();
  });

  it('disables every control when configFile is true', async () => {
    mocks.featureFlags.configFile = true;

    await render(StorageSettings);

    await vi.waitFor(() => expect(page.getByRole('combobox').elements()).toHaveLength(3));

    for (const select of page.getByRole('combobox').elements()) {
      expect(select).toBeDisabled();
    }
  });

  it('interpolates the resolved env backend into the auto label', async () => {
    mocks.routingStatus = {
      ...makeRoutingStatus(),
      thumbnails: { routedTo: RoutedTo.S3, misplacedCount: 0 },
    };

    await render(StorageSettings);

    const autoOption = await findOne(page.getByRole('option', { name: /currently: S3/ }));
    expect(autoOption).toBeInTheDocument();
  });

  it('renders the migrate link only when misplacedCount is greater than zero', async () => {
    await render(StorageSettings);

    const links = await findAll(page.getByRole('link'));
    expect(links).toHaveLength(1);
  });

  it('points the migrate link at the migration page with direction and file types prefilled', async () => {
    await render(StorageSettings);

    const link = await findOne(page.getByRole('link'));
    expect(link).toHaveAttribute(
      'href',
      '/admin/storage-migration?direction=toDisk&fileTypes=thumbnails,previews,fullsize,personThumbnails,profileImages',
    );
  });

  it('does not claim a backend or offer a migrate link when the routing status fetch fails', async () => {
    vi.mocked(getRoutingStatus).mockRejectedValueOnce(new Error('network error'));

    await render(StorageSettings);

    await vi.waitFor(() =>
      expect(handleErrorMock).toHaveBeenCalledWith(expect.any(Error), 'Failed to fetch routing status'),
    );

    expect(page.getByRole('option', { name: 'Follow IMMICH_STORAGE_BACKEND' }).elements()).toHaveLength(3);
    expect(page.getByRole('option', { name: /currently:/ }).elements()).toHaveLength(0);
    expect(page.getByRole('link').query()).not.toBeInTheDocument();
  });
});
