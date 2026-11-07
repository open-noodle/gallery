import { ReleaseChannel, type AdminConfigDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import NewVersionCheckSettings from './NewVersionCheckSettings.svelte';

// eslint-disable-next-line unicorn/no-unnecessary-parameters
const makeConfig = (enabled = true, channel = ReleaseChannel.Stable) =>
  ({
    newVersionCheck: { enabled, channel },
  }) as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: { newVersionCheck: { enabled: true, channel: 'stable' } },
  defaultSystemConfig: { newVersionCheck: { enabled: true, channel: 'stable' } },
  saveConfig: vi.fn(),
}));

vi.mock(import('#lib/managers/feature-flags-manager.svelte.js'), () => ({
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
  createMutation: (() => ({ mutate: mocks.saveConfig, isPending: false })) as never,
}));

describe('NewVersionCheckSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
  });

  it('does not render the release-channel selector (fork override makes it a no-op, LOW #6)', async () => {
    await render(NewVersionCheckSettings);

    expect(page.getByText('admin.version_check_channel', { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText('admin.release_channel_stable', { exact: true }).query()).not.toBeInTheDocument();
    expect(page.getByText('admin.release_channel_release_candidate', { exact: true }).query()).not.toBeInTheDocument();
  });

  it('still renders and saves the version-check enabled toggle', async () => {
    await render(NewVersionCheckSettings);

    const toggle = page.getByRole('switch', { name: 'admin.version_check_enabled_description', exact: true }).element();
    expect(toggle).toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      newVersionCheck: { enabled: false, channel: ReleaseChannel.Stable },
    });
  });
});
