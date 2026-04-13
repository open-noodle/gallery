import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted mutable feature-flag object so tests can flip `.search` between runs.
// Must use vi.hoisted so the reference inside vi.mock's factory is resolvable —
// vi.mock is itself hoisted above imports.
const { mockFlags } = vi.hoisted(() => ({
  mockFlags: {
    value: { search: true },
    valueOrUndefined: undefined as { search: boolean } | undefined,
  },
}));
mockFlags.valueOrUndefined = mockFlags.value;
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFlags,
}));

vi.mock('@immich/sdk', async () => {
  const actual = await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk');
  return {
    ...actual,
    searchSmart: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchAssets: vi.fn().mockResolvedValue({ assets: { items: [], nextPage: null } }),
    searchPerson: vi.fn().mockResolvedValue([]),
    searchPlaces: vi.fn().mockResolvedValue([]),
    getAllTags: vi.fn().mockResolvedValue([]),
  };
});

import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
import GlobalSearchTrigger from '../global-search-trigger.svelte';

describe('global-search-trigger + feature flag', () => {
  beforeEach(() => {
    mockFlags.value.search = true;
    mockFlags.valueOrUndefined = mockFlags.value;
    globalSearchManager.close();
    vi.clearAllMocks();
  });

  it('renders a button when flag is on', () => {
    render(GlobalSearchTrigger);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('hides when flag is off', () => {
    mockFlags.value.search = false;
    render(GlobalSearchTrigger);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides gracefully when feature flags are not yet initialized', () => {
    mockFlags.valueOrUndefined = undefined;
    render(GlobalSearchTrigger);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clicking opens the global palette', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(GlobalSearchTrigger);
    await user.click(screen.getByRole('button'));
    expect(globalSearchManager.isOpen).toBe(true);
  });

  it('shows a platform-aware keybind chip (⌘K on Mac, Ctrl+K elsewhere)', () => {
    render(GlobalSearchTrigger);
    // happy-dom's navigator.platform is typically empty or "" → isMac=false → "Ctrl+K".
    // On a Mac-emulating environment either label is valid, so match both.
    const kbd = screen.getByText(/^(⌘K|Ctrl\+K)$/);
    expect(kbd).toBeInTheDocument();
    expect(kbd.tagName).toBe('KBD');
  });

  it('renders the "Quick search" label (visually hidden on small breakpoints)', () => {
    render(GlobalSearchTrigger);
    // i18n fallbackLocale 'dev' → the literal key renders.
    expect(screen.getByText('cmdk_quick_search')).toBeInTheDocument();
  });

  it('has a stable data-testid for navbar regression tests', () => {
    render(GlobalSearchTrigger);
    expect(screen.getByTestId('cmdk-trigger')).toBeInTheDocument();
  });
});
