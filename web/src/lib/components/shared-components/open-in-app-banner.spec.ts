import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pageState, userStore } = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return {
    pageState: { url: { pathname: '/photos/550e8400-e29b-41d4-a716-446655440000' } },
    userStore: writable<{ id: string } | null>({ id: 'user-1' }),
  };
});

vi.mock('@immich/ui', async () => {
  const actual = await vi.importActual<typeof import('@immich/ui')>('@immich/ui');
  return { ...actual, IconButton: actual.Button };
});

vi.mock('$app/navigation', () => ({
  afterNavigate: vi.fn(),
}));

vi.mock('$lib/stores/user.store', () => ({ user: userStore }));

vi.mock('$app/state', () => ({ page: pageState }));

import OpenInAppBanner from './open-in-app-banner.svelte';

describe('OpenInAppBanner', () => {
  beforeEach(() => {
    userStore.set({ id: 'user-1' });
    pageState.url.pathname = '/photos/550e8400-e29b-41d4-a716-446655440000';
    localStorage.clear();
    Object.defineProperty(navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      configurable: true,
    });
    Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
  });

  it('renders the banner when all gates pass', async () => {
    render(OpenInAppBanner);
    await tick();
    expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: 'open_in_app_banner_open' });
    expect(openLink).toHaveAttribute('href', expect.stringMatching(/^immich:\/\/asset\?id=/));
  });

  it('renders nothing when path does not match a deep-link route', async () => {
    pageState.url.pathname = '/admin/users';
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
  });
});
