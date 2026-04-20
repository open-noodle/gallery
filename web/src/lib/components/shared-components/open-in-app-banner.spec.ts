import { fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Nav = {
  type: string;
  from?: { route?: { id?: string | null }; params?: Record<string, string> | null } | null;
  to?: { route?: { id?: string | null }; params?: Record<string, string> | null } | null;
};

const { pageState, navState } = vi.hoisted(() => ({
  pageState: { url: { pathname: '/photos/550e8400-e29b-41d4-a716-446655440000' } },
  navState: { callback: undefined as ((nav: { type: string }) => void) | undefined },
}));

const ASSET_VIEWER_TARGET = {
  route: { id: '/(user)/photos/[[assetId=id]]' },
  params: { assetId: '550e8400-e29b-41d4-a716-446655440000' },
};

vi.mock('@immich/ui', async () => {
  const actual = await vi.importActual<typeof import('@immich/ui')>('@immich/ui');
  return { ...actual, IconButton: actual.Button };
});

vi.mock('$app/navigation', () => ({
  afterNavigate: (cb: (nav: { type: string }) => void) => {
    navState.callback = cb;
  },
}));

vi.mock('$app/state', () => ({ page: pageState }));

import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';
import OpenInAppBanner from './open-in-app-banner.svelte';

const setUser = (id: string | null) => {
  if (id === null) {
    authManager.reset();
  } else {
    authManager.setUser(userAdminFactory.build({ id }));
    authManager.setPreferences(preferencesFactory.build());
  }
};

describe('OpenInAppBanner', () => {
  beforeEach(() => {
    setUser('user-1');
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
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();
    const openLink = screen.getByRole('link', { name: 'open_in_app_banner_open' });
    expect(openLink).toHaveAttribute('href', expect.stringMatching(/^immich:\/\/asset\?id=/));
  });

  it('renders nothing when path does not match a deep-link route', async () => {
    pageState.url.pathname = '/admin/users';
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();
  });

  it('appears after auth resolves (auth-late race)', async () => {
    setUser(null);
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();

    setUser('user-1');
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();
  });

  it('does not hide on the initial enter-fire of afterNavigate', async () => {
    render(OpenInAppBanner);
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();

    navState.callback!({ type: 'enter' });
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();
  });

  it('hides on subsequent navigation away from the deep-link route', async () => {
    render(OpenInAppBanner);
    await tick();
    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: ASSET_VIEWER_TARGET,
      to: { route: { id: '/(user)/search' }, params: {} },
    });
    await tick();
    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();
  });

  it('keeps banner visible when navigating between asset-viewer routes (swipe between photos)', async () => {
    render(OpenInAppBanner);
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();

    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: ASSET_VIEWER_TARGET,
      to: {
        route: { id: '/(user)/photos/[[assetId=id]]' },
        params: { assetId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      },
    });
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();
  });

  it('re-arms cold-entry when auth resolves after a prior navigation', async () => {
    setUser(null);
    render(OpenInAppBanner);
    await tick();

    // A pre-auth nav fires (e.g. OAuth callback redirect) — would normally clear coldEntry.
    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: { route: { id: '/(user)/auth/login' }, params: {} },
      to: ASSET_VIEWER_TARGET,
    });
    await tick();
    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();

    // Now auth resolves — banner should still appear.
    setUser('user-1');
    await tick();
    expect(screen.getByRole('region', { name: 'open_in_app_banner_aria_label' })).toBeInTheDocument();
  });

  it('dismiss writes localStorage with ~30 day expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));

    render(OpenInAppBanner);
    await tick();

    const dismiss = screen.getByRole('button', { name: 'open_in_app_banner_dismiss' });
    await fireEvent.click(dismiss);
    await tick();

    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();

    const stored = localStorage.getItem('gallery.openInApp.dismissedUntil');
    expect(stored).toBe('2026-05-16T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('does not render when dismissal is in the future', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    localStorage.setItem('gallery.openInApp.dismissedUntil', future);
    render(OpenInAppBanner);
    await tick();
    expect(screen.queryByRole('region', { name: 'open_in_app_banner_aria_label' })).not.toBeInTheDocument();
  });
});
