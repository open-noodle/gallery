import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { pageState, userStore, navState } = await vi.hoisted(async () => {
  const { writable } = await import('svelte/store');
  return {
    pageState: { url: { pathname: '/photos/550e8400-e29b-41d4-a716-446655440000' } },
    userStore: writable<{ id: string } | null>({ id: 'user-1' }),
    navState: { callback: undefined as ((nav: { type: string }) => void) | undefined },
  };
});

vi.mock('@immich/ui', async () => {
  const actual = await vi.importActual<typeof import('@immich/ui')>('@immich/ui');
  return { ...actual, IconButton: actual.Button };
});

vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (nav: { type: string }) => void) => {
    navState.callback = cb;
  },
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

  it('appears after auth resolves (auth-late race)', async () => {
    userStore.set(null);
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();

    userStore.set({ id: 'user-1' });
    await tick();
    expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
  });

  it('does not hide on the initial enter-fire of afterNavigate', async () => {
    render(OpenInAppBanner);
    await tick();
    expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();

    navState.callback!({ type: 'enter' });
    await tick();
    expect(screen.getByRole('region', { name: /mobile app suggestion/i })).toBeInTheDocument();
  });

  it('hides on subsequent navigation', async () => {
    render(OpenInAppBanner);
    await tick();
    navState.callback!({ type: 'link' });
    await tick();
    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
  });

  it('dismiss writes localStorage with ~30 day expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));

    render(OpenInAppBanner);
    await tick();

    const dismiss = screen.getByRole('button', { name: 'open_in_app_banner_dismiss' });
    await fireEvent.click(dismiss);
    await tick();

    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();

    const stored = localStorage.getItem('gallery.openInApp.dismissedUntil');
    expect(stored).toBe('2026-05-16T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('does not render when dismissal is in the future', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    localStorage.setItem('gallery.openInApp.dismissedUntil', future);
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: /mobile app suggestion/i })).not.toBeInTheDocument();
  });
});
