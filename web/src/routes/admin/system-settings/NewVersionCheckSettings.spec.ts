import type { AdminConfigDto } from '@immich/sdk';
import { ReleaseChannel } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NewVersionCheckSettings from './NewVersionCheckSettings.svelte';

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

vi.mock(import('$lib/managers/feature-flags-manager.svelte'), () => ({
  featureFlagsManager: {
    get value() {
      return mocks.featureFlags;
    },
  } as never,
}));

vi.mock(import('$lib/queries/client'), () => ({
  createPreloadedQuery: ((optionsFn: () => { queryKey: readonly unknown[] }) => ({
    get data() {
      return optionsFn().queryKey[1] === 'defaults' ? mocks.defaultSystemConfig : mocks.systemConfig;
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

  it('does not render the release-channel selector (fork override makes it a no-op, LOW #6)', () => {
    render(NewVersionCheckSettings);

    expect(screen.queryByText('admin.version_check_channel')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.release_channel_stable')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.release_channel_release_candidate')).not.toBeInTheDocument();
  });

  it('still renders and saves the version-check enabled toggle', async () => {
    const user = userEvent.setup();
    render(NewVersionCheckSettings);

    const toggle = screen.getByRole('switch', { name: 'admin.version_check_enabled_description' });
    expect(toggle).toBeChecked();

    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      newVersionCheck: { enabled: false, channel: ReleaseChannel.Stable },
    });
  });
});
