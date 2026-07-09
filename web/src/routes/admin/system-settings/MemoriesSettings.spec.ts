import type { SystemConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
import MemoriesSettings from './MemoriesSettings.svelte';

const makeConfig = (retentionDays = 365) =>
  ({
    memories: { retentionDays, birthday: true, recentTrips: true, types: {} },
  }) as SystemConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: { memories: { retentionDays: 365, birthday: true, recentTrips: true, types: {} } } as SystemConfigDto,
  defaultSystemConfig: {
    memories: { retentionDays: 365, birthday: true, recentTrips: true, types: {} },
  } as SystemConfigDto,
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
      return mocks.systemConfig as SystemConfigDto;
    },
    get defaultValue() {
      return mocks.defaultSystemConfig as SystemConfigDto;
    },
    cloneValue: mocks.cloneValue,
    cloneDefaultValue: mocks.cloneDefaultValue,
  } as never,
}));

vi.mock(import('$lib/services/system-config.service'), () => ({
  handleSystemConfigSave: vi.fn(),
}));

describe('MemoriesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
    mocks.cloneValue.mockImplementation(() => structuredClone(mocks.systemConfig));
    mocks.cloneDefaultValue.mockImplementation(() => structuredClone(mocks.defaultSystemConfig));
  });

  it('renders the retention input from the memories config', () => {
    render(MemoriesSettings);

    const input = screen.getByRole('spinbutton') as HTMLInputElement;

    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(365);
    expect(screen.getByText('admin.memory_retention_setting')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_retention_setting_description')).toBeInTheDocument();
  });

  it('renders a switch per memory type, defaulting unset types to enabled', () => {
    mocks.systemConfig = makeConfig();
    mocks.systemConfig.memories.types = { birthday: false };

    render(MemoriesSettings);

    expect(screen.getByText('admin.memory_type_on_this_day_setting')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_type_birthday_setting')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_type_recent_trip_setting')).toBeInTheDocument();
    // unset → defaults to enabled; explicitly false → off
    expect(screen.getByRole('switch', { name: 'admin.memory_type_on_this_day_setting' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'admin.memory_type_birthday_setting' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'admin.memory_type_recent_trip_setting' })).toBeChecked();
  });

  it('saves updated memory type toggles without touching retention', async () => {
    const user = userEvent.setup();
    render(MemoriesSettings);

    await user.click(screen.getByRole('switch', { name: 'admin.memory_type_birthday_setting' }));
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith({
      memories: {
        retentionDays: 365,
        birthday: true,
        recentTrips: true,
        types: { on_this_day: true, birthday: false, recent_trip: true },
      },
    });
  });
});
