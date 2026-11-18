import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import SpaceTabs from './space-tabs.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/spaces/s1') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const mockFeatureFlags = vi.hoisted(() => ({ map: true }));
vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: { value: mockFeatureFlags },
}));

const base = { spaceId: 's1', photoCount: 35, albumCount: 4, memberCount: 3 };

describe('SpaceTabs', () => {
  beforeEach(() => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    mockFeatureFlags.map = true;
  });

  // #1046 — with the map feature off, /map redirects to /photos: the tab would bounce the user out
  // of the Space instead of showing a map.
  it('hides the Map tab when the map feature is disabled', async () => {
    mockFeatureFlags.map = false;
    await render(SpaceTabs, base);
    expect(page.getByTestId('space-tab-photos').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-members').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-map').query()).not.toBeInTheDocument();
  });

  it('renders Photos, Albums, Map, Members but hides People when face recognition is off', async () => {
    await render(SpaceTabs, { ...base, faceRecognitionEnabled: false });
    expect(page.getByTestId('space-tab-photos').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-albums').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-map').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-members').element()).toBeInTheDocument();
    expect(page.getByTestId('space-tab-people').query()).not.toBeInTheDocument();
  });

  it('shows the People tab when face recognition is on', async () => {
    await render(SpaceTabs, { ...base, faceRecognitionEnabled: true });
    expect(page.getByTestId('space-tab-people').element()).toBeInTheDocument();
  });

  it('renders count badges only when greater than zero', async () => {
    await render(SpaceTabs, { spaceId: 's1', photoCount: 35, albumCount: 0, memberCount: 1 });
    expect(page.getByTestId('space-tab-photos').element()).toMatchTextContent('35');
    // albumCount 0 → no badge text
    expect(page.getByTestId('space-tab-albums').element()).not.toMatchTextContent('0');
  });

  it('marks Photos active on the index route', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    await render(SpaceTabs, base);
    expect(page.getByTestId('space-tab-photos').element()).toHaveAttribute('aria-current', 'page');
    expect(page.getByTestId('space-tab-members').element()).not.toHaveAttribute('aria-current');
  });

  it('marks Members active on the members route', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/members');
    await render(SpaceTabs, base);
    expect(page.getByTestId('space-tab-members').element()).toHaveAttribute('aria-current', 'page');
    expect(page.getByTestId('space-tab-photos').element()).not.toHaveAttribute('aria-current');
  });

  it('points the Map tab at the filtered global map and never marks it current', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    await render(SpaceTabs, base);
    const map = page.getByTestId('space-tab-map').element();
    expect(map).toHaveAttribute('href', '/map?spaceId=s1');
    expect(map).not.toHaveAttribute('aria-current');
  });

  // #767a — the Map tab used to be a hard-coded `/map?spaceId=<id>`, so every active filter and
  // the search term were dropped on the way to the map. The Photos tab URL-backs both.
  it('carries the space filters and the search query to the map', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/photos?q=ski&make=Apple&people=space-person%3Ap1');
    await render(SpaceTabs, base);
    const href = page.getByTestId('space-tab-map').element().getAttribute('href') ?? '';
    expect(href).toContain('spaceId=s1');
    expect(href).toContain('q=ski');
    expect(href).toContain('make=Apple');
    expect(href).toContain('people=space-person%3Ap1');
  });

  it('does not carry another tab’s query params to the map', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/albums?make=Apple');
    await render(SpaceTabs, base);
    expect(page.getByTestId('space-tab-map').element()).toHaveAttribute('href', '/map?spaceId=s1');
  });

  it('renders an Activity tab linking to the activity route', async () => {
    await render(SpaceTabs, base);
    const activity = page.getByTestId('space-tab-activity').element();
    expect(activity).toHaveAttribute('href', '/spaces/s1/activity');
  });

  it('marks the Activity tab active on the activity route', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/activity');
    await render(SpaceTabs, base);
    expect(page.getByTestId('space-tab-activity').element()).toHaveAttribute('aria-current', 'page');
    expect(page.getByTestId('space-tab-members').element()).not.toHaveAttribute('aria-current');
  });

  it('renders the Activity tab regardless of faceRecognitionEnabled', async () => {
    await render(SpaceTabs, { ...base, faceRecognitionEnabled: false });
    expect(page.getByTestId('space-tab-activity').element()).toBeInTheDocument();
    await render(SpaceTabs, { ...base, faceRecognitionEnabled: true });
    expect(page.getByTestId('space-tab-activity').elements()).toHaveLength(2);
  });

  it('renders a Games tab linking to the games route', async () => {
    await render(SpaceTabs, base);
    await expect.element(page.getByTestId('space-tab-games')).toHaveAttribute('href', '/spaces/s1/games');
  });

  it('marks the Games tab active on the games route', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/games');
    await render(SpaceTabs, base);
    await expect.element(page.getByTestId('space-tab-games')).toHaveAttribute('aria-current', 'page');
    await expect.element(page.getByTestId('space-tab-activity')).not.toHaveAttribute('aria-current');
  });

  it('hides the Libraries tab for a non-admin', async () => {
    await render(SpaceTabs, { ...base, isAdmin: false });
    expect(page.getByTestId('space-tab-libraries').query()).not.toBeInTheDocument();
  });

  it('shows the Libraries tab with an href and badge for an admin', async () => {
    await render(SpaceTabs, { ...base, isAdmin: true, libraryCount: 2 });
    const libraries = page.getByTestId('space-tab-libraries').element();
    expect(libraries).toHaveAttribute('href', '/spaces/s1/libraries');
    expect(libraries).toMatchTextContent('2');
  });

  it('marks the Libraries tab active on the libraries route', async () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/libraries');
    await render(SpaceTabs, { ...base, isAdmin: true });
    expect(page.getByTestId('space-tab-libraries').element()).toHaveAttribute('aria-current', 'page');
  });
});
