import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FeatureSettings from './FeatureSettings.svelte';

const mocks = vi.hoisted(() => ({
  preferences: {} as Record<string, unknown>,
  serverConfig: {} as Record<string, unknown>,
  setPreferences: vi.fn(),
  updateMyPreferences: vi.fn(),
}));

vi.mock(import('$lib/managers/auth-manager.svelte'), () => ({
  authManager: {
    get preferences() {
      return mocks.preferences;
    },
    setPreferences: mocks.setPreferences,
  } as never,
}));

vi.mock(import('$lib/managers/server-config-manager.svelte'), () => ({
  serverConfigManager: {
    get value() {
      return mocks.serverConfig;
    },
  } as never,
}));

vi.mock(import('@immich/sdk'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateMyPreferences: mocks.updateMyPreferences };
});

// SettingAccordion drives open/close through accordionManager (which navigates via goto);
// stub it to keep the memories section open and avoid SvelteKit navigation in tests.
vi.mock(import('$lib/managers/accordion-manager.svelte'), () => ({
  accordionManager: {
    isOpen: (key: string) => key === 'memories',
    open: vi.fn(),
    close: vi.fn(),
  } as never,
}));

describe('FeatureSettings memory types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preferences = {
      memories: { enabled: true, duration: 5, types: { on_this_day: true, birthday: false, recent_trip: true } },
    };
    mocks.serverConfig = { availableMemoryTypes: ['on_this_day', 'birthday', 'recent_trip'] };
    mocks.updateMyPreferences.mockResolvedValue(mocks.preferences);
  });

  it('renders a toggle per available memory type reflecting the preference', () => {
    render(FeatureSettings);

    expect(screen.getByRole('switch', { name: 'memory_type_on_this_day' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_type_birthday' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'memory_type_recent_trip' })).toBeChecked();
  });

  it('saves memory type changes without altering enabled or duration', async () => {
    const user = userEvent.setup();
    render(FeatureSettings);

    await user.click(screen.getByRole('switch', { name: 'memory_type_birthday' }));
    await user.click(screen.getByRole('button', { name: 'save' }));

    expect(mocks.updateMyPreferences).toHaveBeenCalledWith({
      userPreferencesUpdateDto: expect.objectContaining({
        memories: { enabled: true, duration: 5, types: { on_this_day: true, birthday: true, recent_trip: true } },
      }),
    });
  });

  it('does not render a toggle for an unavailable memory type', () => {
    mocks.serverConfig = { availableMemoryTypes: ['on_this_day', 'birthday'] };
    render(FeatureSettings);

    expect(screen.getByRole('switch', { name: 'memory_type_on_this_day' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'memory_type_recent_trip' })).toBeNull();
  });
});
