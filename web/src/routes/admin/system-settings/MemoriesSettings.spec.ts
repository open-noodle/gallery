import type { AdminConfigDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSystemConfigSave } from '$lib/services/system-config.service';
import MemoriesSettings from './MemoriesSettings.svelte';

const makeConfig = (retentionDays = 365) =>
  ({
    memories: {
      retentionDays,
      birthday: true,
      recentTrips: true,
      types: {},
      themeMaxDistance: 0.75,
      personThrowbackDormancyMonths: 6,
    },
  }) as AdminConfigDto;

const mocks = vi.hoisted(() => ({
  featureFlags: { configFile: false },
  systemConfig: {
    memories: {
      retentionDays: 365,
      birthday: true,
      recentTrips: true,
      types: {},
      themeMaxDistance: 0.75,
      personThrowbackDormancyMonths: 6,
    },
  } as AdminConfigDto,
  defaultSystemConfig: {
    memories: {
      retentionDays: 365,
      birthday: true,
      recentTrips: true,
      types: {},
      themeMaxDistance: 0.75,
      personThrowbackDormancyMonths: 6,
    },
  } as AdminConfigDto,
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

    // Number inputs render in declaration order: retention, theme distance, dormancy.
    const [input] = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(365);
    expect(screen.getByText('admin.memory_retention_setting')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_retention_setting_description')).toBeInTheDocument();
  });

  it('renders the themed threshold and person-throwback dormancy inputs from the memories config', () => {
    render(MemoriesSettings);

    const [, themeDistance, dormancy] = screen.getAllByRole('spinbutton') as HTMLInputElement[];

    expect(themeDistance).toHaveValue(0.75);
    expect(themeDistance).toHaveAttribute('max', '2');
    expect(dormancy).toHaveValue(6);
    expect(dormancy).toHaveAttribute('min', '1');
    expect(screen.getByText('admin.memory_theme_max_distance_setting')).toBeInTheDocument();
    expect(screen.getByText('admin.memory_person_throwback_dormancy_setting')).toBeInTheDocument();
  });

  it('disables a type-specific knob when its memory type is turned off', async () => {
    const user = userEvent.setup();
    render(MemoriesSettings);

    const [, themeDistance, dormancy] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    expect(themeDistance).toBeEnabled();

    await user.click(screen.getByRole('switch', { name: 'admin.memory_type_themed_setting' }));

    // Only the disabled type's own knob is gated; the other type's stays editable.
    expect(themeDistance).toBeDisabled();
    expect(dormancy).toBeEnabled();
  });

  it('saves an edited themed threshold and dormancy window', async () => {
    const user = userEvent.setup();
    render(MemoriesSettings);

    const [, themeDistance, dormancy] = screen.getAllByRole('spinbutton') as HTMLInputElement[];
    await user.clear(themeDistance);
    await user.type(themeDistance, '0.8');
    await user.clear(dormancy);
    await user.type(dormancy, '12');
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(handleSystemConfigSave).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: expect.objectContaining({ themeMaxDistance: 0.8, personThrowbackDormancyMonths: 12 }),
      }),
    );
  });

  // Mirrors MEMORY_TYPE_METADATA in server/src/services/memory-rules/memory-type.metadata.ts.
  // Guards against the UI list drifting out of sync with the server registry — a type missing
  // here is a type no admin can ever turn off.
  const ALL_MEMORY_TYPE_KEYS = [
    'on_this_day',
    'birthday',
    'recent_trip',
    'month_recap',
    'favorites_throwback',
    'on_this_day_place',
    'season_recap',
    'people_together',
    'video_moments',
    'trip_anniversary',
    'themed',
    'person_throwback',
  ];

  it('renders a switch for every server-registered memory type', () => {
    render(MemoriesSettings);

    for (const key of ALL_MEMORY_TYPE_KEYS) {
      expect(screen.getByRole('switch', { name: `admin.memory_type_${key}_setting` })).toBeInTheDocument();
    }
    expect(screen.getAllByRole('switch')).toHaveLength(ALL_MEMORY_TYPE_KEYS.length);
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
        themeMaxDistance: 0.75,
        personThrowbackDormancyMonths: 6,
        types: {
          on_this_day: true,
          birthday: false,
          recent_trip: true,
          month_recap: true,
          favorites_throwback: true,
          on_this_day_place: true,
          season_recap: true,
          people_together: true,
          video_moments: true,
          trip_anniversary: true,
          themed: true,
          person_throwback: true,
        },
      },
    });
  });
});
