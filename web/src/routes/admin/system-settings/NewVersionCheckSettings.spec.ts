import type { AdminConfigDto } from '@immich/sdk';
import { ReleaseChannel } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
import NewVersionCheckSettings from './NewVersionCheckSettings.svelte';

const makeConfig = (enabled = true, channel = ReleaseChannel.Stable) =>
  ({
    newVersionCheck: { enabled, channel },
  }) as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: { newVersionCheck: { enabled: true, channel: 'stable' } },
  defaultSystemConfig: { newVersionCheck: { enabled: true, channel: 'stable' } },
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
      return mocks.systemConfig as AdminConfigDto;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig as AdminConfigDto;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
}));

describe('NewVersionCheckSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
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

    expect(handleSystemConfigSave).toHaveBeenCalledWith({
      newVersionCheck: { enabled: false, channel: ReleaseChannel.Stable },
    });
  });
});
