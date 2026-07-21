import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import UserSidebar from '$lib/components/shared-components/side-bar/UserSidebar.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/photos') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const mocks = vi.hoisted(() => ({
  authManager: {
    preferences: {
      folders: { enabled: false, sidebarWeb: false },
      memories: { enabled: true },
      people: { enabled: false, sidebarWeb: false },
      recentlyAdded: { sidebarWeb: false },
      sharedLinks: { enabled: false, sidebarWeb: false },
      tags: { enabled: false, sidebarWeb: false },
    },
  },
  featureFlagsManager: {
    value: {
      map: false,
      search: false,
      trash: false,
    },
  },
}));

vi.mock('$lib/components/sidebar/sidebar.svelte', async () => {
  const module = await import('@test-data/mocks/sidebar.stub.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/BottomInfo.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/RecentAlbums.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/recent-spaces.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: mocks.authManager,
}));

vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mocks.featureFlagsManager,
}));

vi.mock('@immich/ui', async () => {
  const navbarGroup = await import('@test-data/mocks/navbar-group.stub.svelte');
  const navbarItem = await import('@test-data/mocks/navbar-item.stub.svelte');
  return {
    NavbarGroup: navbarGroup.default,
    NavbarItem: navbarItem.default,
  };
});

describe('UserSidebar', () => {
  beforeEach(() => {
    mocks.authManager.preferences.memories.enabled = true;
    mockPage.url = new URL('https://gallery.test/photos');
  });

  // The Spaces row expands into the individual spaces (and their albums), which highlight
  // themselves. NavbarItem's default `pathname.startsWith('/spaces')` would keep the Spaces
  // heading lit at the same time, showing two selected rows at once.
  describe('Spaces selected state', () => {
    const spacesLink = () => screen.getByRole('link', { name: /^spaces$/i });

    it('marks Spaces selected on the spaces list page', () => {
      mockPage.url = new URL('https://gallery.test/spaces');

      render(UserSidebar);

      expect(spacesLink()).toHaveAttribute('data-active', 'true');
    });

    it('does not mark Spaces selected once a space is open', () => {
      mockPage.url = new URL('https://gallery.test/spaces/space-1');

      render(UserSidebar);

      expect(spacesLink()).toHaveAttribute('data-active', 'false');
    });

    it('does not mark Spaces selected once a space album is open', () => {
      mockPage.url = new URL('https://gallery.test/spaces/space-1/albums/album-1');

      render(UserSidebar);

      expect(spacesLink()).toHaveAttribute('data-active', 'false');
    });
  });

  it('shows a memories link under Library when memories are enabled', () => {
    render(UserSidebar);

    expect(screen.getByRole('link', { name: /^memories$/i })).toHaveAttribute('href', '/memories');
  });

  it('hides the memories link when memories are disabled', () => {
    mocks.authManager.preferences.memories.enabled = false;

    render(UserSidebar);

    expect(screen.queryByRole('link', { name: /^memories$/i })).not.toBeInTheDocument();
  });
});
