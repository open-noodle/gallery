import type { AdminConfigDto } from '@immich/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import MemoriesSettings from './MemoriesSettings.svelte';

// eslint-disable-next-line unicorn/no-unnecessary-parameters
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

describe('MemoriesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.featureFlags.configFile = false;
    mocks.systemConfig = makeConfig();
    mocks.defaultSystemConfig = makeConfig();
  });

  it('renders the retention input from the memories config', async () => {
    await render(MemoriesSettings);

    // Number inputs render in declaration order: retention, theme distance, dormancy.
    const [input] = page.getByRole('spinbutton').elements() as HTMLInputElement[];

    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveValue(365);
    expect(page.getByText('admin.memory_retention_setting', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('admin.memory_retention_setting_description', { exact: true }).element()).toBeInTheDocument();
  });

  it('renders the themed threshold and person-throwback dormancy inputs from the memories config', async () => {
    await render(MemoriesSettings);

    const [, themeDistance, dormancy] = page.getByRole('spinbutton').elements() as HTMLInputElement[];

    expect(themeDistance).toHaveValue(0.75);
    expect(themeDistance).toHaveAttribute('max', '2');
    expect(dormancy).toHaveValue(6);
    expect(dormancy).toHaveAttribute('min', '1');
    expect(page.getByText('admin.memory_theme_max_distance_setting', { exact: true }).element()).toBeInTheDocument();
    expect(
      page.getByText('admin.memory_person_throwback_dormancy_setting', { exact: true }).element(),
    ).toBeInTheDocument();
  });

  it('disables a type-specific knob when its memory type is turned off', async () => {
    await render(MemoriesSettings);

    const [, themeDistance, dormancy] = page.getByRole('spinbutton').elements() as HTMLInputElement[];
    expect(themeDistance).toBeEnabled();

    await userEvent.click(page.getByRole('switch', { name: 'admin.memory_type_themed_setting', exact: true }));

    // Only the disabled type's own knob is gated; the other type's stays editable.
    expect(themeDistance).toBeDisabled();
    expect(dormancy).toBeEnabled();
  });

  it('saves an edited themed threshold and dormancy window', async () => {
    await render(MemoriesSettings);

    const [, themeDistance, dormancy] = page.getByRole('spinbutton').elements() as HTMLInputElement[];
    await userEvent.clear(themeDistance);
    await userEvent.type(themeDistance, '0.8');
    await userEvent.clear(dormancy);
    await userEvent.type(dormancy, '12');
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        memories: expect.objectContaining({ themeMaxDistance: 0.8, personThrowbackDormancyMonths: 12 }),
      }),
    );
  });

  // Mirrors MEMORY_TYPE_METADATA in server/src/gallery/services/memory-rules/memory-type.metadata.ts.
  // Guards against the UI list drifting out of sync with the server registry — a type missing
  // here is a type no admin can ever turn off.
  const ALL_MEMORY_TYPE_KEYS = [
    'on_this_day',
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

  it('renders a switch for every server-registered memory type', async () => {
    await render(MemoriesSettings);

    for (const key of ALL_MEMORY_TYPE_KEYS) {
      expect(
        page.getByRole('switch', { name: `admin.memory_type_${key}_setting`, exact: true }).element(),
      ).toBeInTheDocument();
    }
    expect(page.getByRole('switch').elements()).toHaveLength(ALL_MEMORY_TYPE_KEYS.length);
  });

  it('renders a switch per memory type, defaulting unset types to enabled', async () => {
    mocks.systemConfig = makeConfig();
    mocks.systemConfig.memories.types = { month_recap: false };

    await render(MemoriesSettings);

    expect(page.getByText('admin.memory_type_on_this_day_setting', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('admin.memory_type_month_recap_setting', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByText('admin.memory_type_recent_trip_setting', { exact: true }).element()).toBeInTheDocument();
    // unset → defaults to enabled; explicitly false → off
    expect(
      page.getByRole('switch', { name: 'admin.memory_type_on_this_day_setting', exact: true }).element(),
    ).toBeChecked();
    expect(
      page.getByRole('switch', { name: 'admin.memory_type_month_recap_setting', exact: true }).element(),
    ).not.toBeChecked();
    expect(
      page.getByRole('switch', { name: 'admin.memory_type_recent_trip_setting', exact: true }).element(),
    ).toBeChecked();
  });

  it('saves updated memory type toggles without touching retention', async () => {
    await render(MemoriesSettings);

    await userEvent.click(page.getByRole('switch', { name: 'admin.memory_type_month_recap_setting', exact: true }));
    await userEvent.click(page.getByRole('button', { name: 'save', exact: true }));

    expect(mocks.saveConfig).toHaveBeenCalledWith({
      memories: {
        retentionDays: 365,
        birthday: true,
        recentTrips: true,
        themeMaxDistance: 0.75,
        personThrowbackDormancyMonths: 6,
        types: {
          on_this_day: true,
          recent_trip: true,
          month_recap: false,
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
