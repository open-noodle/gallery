import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpaceTabs from './space-tabs.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/spaces/s1') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const base = { spaceId: 's1', photoCount: 35, albumCount: 4, memberCount: 3 };

describe('SpaceTabs', () => {
  beforeEach(() => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
  });

  it('renders Photos, Albums, Map, Members but hides People when face recognition is off', () => {
    render(SpaceTabs, { ...base, faceRecognitionEnabled: false });
    expect(screen.getByTestId('space-tab-photos')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-albums')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-map')).toBeInTheDocument();
    expect(screen.getByTestId('space-tab-members')).toBeInTheDocument();
    expect(screen.queryByTestId('space-tab-people')).not.toBeInTheDocument();
  });

  it('shows the People tab when face recognition is on', () => {
    render(SpaceTabs, { ...base, faceRecognitionEnabled: true });
    expect(screen.getByTestId('space-tab-people')).toBeInTheDocument();
  });

  it('renders count badges only when greater than zero', () => {
    render(SpaceTabs, { spaceId: 's1', photoCount: 35, albumCount: 0, memberCount: 1 });
    expect(screen.getByTestId('space-tab-photos')).toHaveTextContent('35');
    // albumCount 0 → no badge text
    expect(screen.getByTestId('space-tab-albums')).not.toHaveTextContent('0');
  });

  it('marks Photos active on the index route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-photos')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('space-tab-members')).not.toHaveAttribute('aria-current');
  });

  it('marks Members active on the members route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/members');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-members')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('space-tab-photos')).not.toHaveAttribute('aria-current');
  });

  it('points the Map tab at the filtered global map and never marks it current', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1');
    render(SpaceTabs, base);
    const map = screen.getByTestId('space-tab-map');
    expect(map).toHaveAttribute('href', '/map?spaceId=s1');
    expect(map).not.toHaveAttribute('aria-current');
  });

  // #767a — the Map tab used to be a hard-coded `/map?spaceId=<id>`, so every active filter and
  // the search term were dropped on the way to the map. The Photos tab URL-backs both.
  it('carries the space filters and the search query to the map', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/photos?q=ski&make=Apple&people=space-person%3Ap1');
    render(SpaceTabs, base);
    const href = screen.getByTestId('space-tab-map').getAttribute('href') ?? '';
    expect(href).toContain('spaceId=s1');
    expect(href).toContain('q=ski');
    expect(href).toContain('make=Apple');
    expect(href).toContain('people=space-person%3Ap1');
  });

  it('does not carry another tab’s query params to the map', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/albums?make=Apple');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-map')).toHaveAttribute('href', '/map?spaceId=s1');
  });

  it('renders an Activity tab linking to the activity route', () => {
    render(SpaceTabs, base);
    const activity = screen.getByTestId('space-tab-activity');
    expect(activity).toHaveAttribute('href', '/spaces/s1/activity');
  });

  it('marks the Activity tab active on the activity route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/activity');
    render(SpaceTabs, base);
    expect(screen.getByTestId('space-tab-activity')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('space-tab-members')).not.toHaveAttribute('aria-current');
  });

  it('renders the Activity tab regardless of faceRecognitionEnabled', () => {
    render(SpaceTabs, { ...base, faceRecognitionEnabled: false });
    expect(screen.getByTestId('space-tab-activity')).toBeInTheDocument();
    render(SpaceTabs, { ...base, faceRecognitionEnabled: true });
    expect(screen.getAllByTestId('space-tab-activity')).toHaveLength(2);
  });

  it('hides the Libraries tab for a non-admin', () => {
    render(SpaceTabs, { ...base, isAdmin: false });
    expect(screen.queryByTestId('space-tab-libraries')).not.toBeInTheDocument();
  });

  it('shows the Libraries tab with an href and badge for an admin', () => {
    render(SpaceTabs, { ...base, isAdmin: true, libraryCount: 2 });
    const libraries = screen.getByTestId('space-tab-libraries');
    expect(libraries).toHaveAttribute('href', '/spaces/s1/libraries');
    expect(libraries).toHaveTextContent('2');
  });

  it('marks the Libraries tab active on the libraries route', () => {
    mockPage.url = new URL('https://gallery.test/spaces/s1/libraries');
    render(SpaceTabs, { ...base, isAdmin: true });
    expect(screen.getByTestId('space-tab-libraries')).toHaveAttribute('aria-current', 'page');
  });
});
