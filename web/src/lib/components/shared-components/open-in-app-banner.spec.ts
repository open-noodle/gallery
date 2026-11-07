import { authManager } from '#lib/managers/auth-manager.svelte.ts';
import { factory } from '#test/unit/factories.ts';
import { tick } from 'svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import OpenInAppBanner from './open-in-app-banner.svelte';

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

vi.mock('@immich/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@immich/ui')>();
  return { ...actual, IconButton: actual.Button };
});

vi.mock('$app/navigation', async () => ({
  ...(await import('#test/unit/mocks/app-navigation.ts')),
  afterNavigate: (cb: (nav: { type: string }) => void) => {
    navState.callback = cb;
  },
}));

vi.mock('$app/state', async () => ({ ...(await import('#test/unit/mocks/app-state.svelte.ts')), page: pageState }));

const banner = () => page.getByRole('region', { name: 'open_in_app_banner_aria_label' });

const setUser = (id: string | null) => {
  if (id === null) {
    authManager.reset();
  } else {
    authManager.setUser(factory.user({ id }));
    authManager.setPreferences(factory.preferences());
  }
};

describe('OpenInAppBanner', () => {
  beforeEach(() => {
    setUser('user-1');
    pageState.url.pathname = '/photos/550e8400-e29b-41d4-a716-446655440000';
    localStorage.clear();
    Object.defineProperties(navigator, {
      userAgent: {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
        configurable: true,
      },
      maxTouchPoints: { value: 5, configurable: true },
    });
  });

  it('renders the banner when all gates pass', async () => {
    await render(OpenInAppBanner);
    await tick();
    await expect.element(banner()).toBeInTheDocument();
    const openLink = page.getByRole('link', { name: 'open_in_app_banner_open' });
    await expect.element(openLink).toHaveAttribute('href', expect.stringMatching(/^immich:\/\/asset\?id=/));
  });

  it('renders nothing when path does not match a deep-link route', async () => {
    pageState.url.pathname = '/admin/users';
    await render(OpenInAppBanner);
    await tick();
    expect(banner().query()).toBeNull();
  });

  it('appears after auth resolves (auth-late race)', async () => {
    setUser(null);
    await render(OpenInAppBanner);
    await tick();
    expect(banner().query()).toBeNull();

    setUser('user-1');
    await tick();
    await expect.element(banner()).toBeInTheDocument();
  });

  it('does not hide on the initial enter-fire of afterNavigate', async () => {
    await render(OpenInAppBanner);
    await tick();
    await expect.element(banner()).toBeInTheDocument();

    navState.callback!({ type: 'enter' });
    await tick();
    await expect.element(banner()).toBeInTheDocument();
  });

  it('hides on subsequent navigation away from the deep-link route', async () => {
    await render(OpenInAppBanner);
    await tick();
    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: ASSET_VIEWER_TARGET,
      to: { route: { id: '/(user)/search' }, params: {} },
    });
    await tick();
    expect(banner().query()).toBeNull();
  });

  it('keeps banner visible when navigating between asset-viewer routes (swipe between photos)', async () => {
    await render(OpenInAppBanner);
    await tick();
    await expect.element(banner()).toBeInTheDocument();

    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: ASSET_VIEWER_TARGET,
      to: {
        route: { id: '/(user)/photos/[[assetId=id]]' },
        params: { assetId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
      },
    });
    await tick();
    await expect.element(banner()).toBeInTheDocument();
  });

  it('re-arms cold-entry when auth resolves after a prior navigation', async () => {
    setUser(null);
    await render(OpenInAppBanner);
    await tick();

    // A pre-auth nav fires (e.g. OAuth callback redirect) — would normally clear coldEntry.
    (navState.callback as (nav: Nav) => void)({
      type: 'link',
      from: { route: { id: '/(user)/auth/login' }, params: {} },
      to: ASSET_VIEWER_TARGET,
    });
    await tick();
    expect(banner().query()).toBeNull();

    // Now auth resolves — banner should still appear.
    setUser('user-1');
    await tick();
    await expect.element(banner()).toBeInTheDocument();
  });

  it('dismiss writes localStorage with ~30 day expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-16T12:00:00Z'));

    await render(OpenInAppBanner);
    await tick();

    const dismiss = page.getByRole('button', { name: 'open_in_app_banner_dismiss' }).element() as HTMLElement;
    dismiss.click();
    await tick();

    expect(banner().query()).toBeNull();

    const stored = localStorage.getItem('gallery.openInApp.dismissedUntil');
    expect(stored).toBe('2026-05-16T12:00:00.000Z');

    vi.useRealTimers();
  });

  it('does not render when dismissal is in the future', async () => {
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    localStorage.setItem('gallery.openInApp.dismissedUntil', future);
    await render(OpenInAppBanner);
    await tick();
    expect(banner().query()).toBeNull();
  });
});
