import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import UserSidebar from '$lib/components/shared-components/side-bar/UserSidebar.svelte';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/photos') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const mocks = vi.hoisted(() => ({
  authManager: {
    isDemo: false,
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

vi.mock('$lib/components/sidebar/sidebar-shell.svelte', async () => {
  const module = await import('@test-data/mocks/sidebar-shell.stub.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/BottomInfo.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/side-bar/rail-storage.svelte', async () => {
  const module = await import('@test-data/mocks/rail-storage.stub.svelte');
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

vi.mock('$lib/components/sidebar/sidebar-nav-item.svelte', async () => {
  const module = await import('@test-data/mocks/sidebar-nav-item.stub.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/sidebar/sidebar-nav-group.svelte', async () => {
  const module = await import('@test-data/mocks/navbar-group.stub.svelte');
  return { default: module.default };
});

const sidebarMocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: sidebarMocks.sidebarModeStore }));

describe('UserSidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.authManager.isDemo = false;
    mocks.authManager.preferences.memories.enabled = true;
    mocks.featureFlagsManager.value.map = false;
    mockPage.url = new URL('https://gallery.test/photos');
    sidebarMocks.sidebarModeStore.layout = 'expanded';
    sidebarMocks.sidebarModeStore.hoverExpanded = false;
    sidebarMocks.sidebarModeStore.railExpanded = false;
  });

  // The Spaces row expands into the individual spaces (and their albums), which highlight
  // themselves. SidebarNavItem's default `pathname.startsWith('/spaces')` would keep the
  // Spaces heading lit at the same time, showing two selected rows at once.
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

  // Rail mode collapses to icons only, so BottomInfo's full storage bar is swapped for the
  // compact RailStorage indicator; hovering/focusing floats the rail back open first.
  //
  // RecentAlbums and RecentSpaces are mocked to the same generic noop-component stub as
  // BottomInfo (they're always rendered by sidebar-nav-item.stub.svelte's unconditional
  // `{#if items}`), so their two instances are a fixed baseline in every case below;
  // BottomInfo's presence is read off the count on top of that baseline, not off `getBy`,
  // which would throw on the pre-existing multiple matches.
  describe('bottom storage indicator', () => {
    it('renders the compact rail storage indicator when collapsed to a rail', () => {
      sidebarMocks.sidebarModeStore.layout = 'rail';
      sidebarMocks.sidebarModeStore.hoverExpanded = false;
      sidebarMocks.sidebarModeStore.railExpanded = false;

      render(UserSidebar);

      expect(screen.getByTestId('rail-storage-stub')).toBeInTheDocument();
      expect(screen.getAllByTestId('noop-component')).toHaveLength(2);
    });

    it('renders BottomInfo when the rail is hover-expanded', () => {
      sidebarMocks.sidebarModeStore.layout = 'rail';
      sidebarMocks.sidebarModeStore.hoverExpanded = true;
      sidebarMocks.sidebarModeStore.railExpanded = true;

      render(UserSidebar);

      expect(screen.queryByTestId('rail-storage-stub')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('noop-component')).toHaveLength(3);
    });

    it('renders BottomInfo in the expanded layout', () => {
      sidebarMocks.sidebarModeStore.layout = 'expanded';

      render(UserSidebar);

      expect(screen.queryByTestId('rail-storage-stub')).not.toBeInTheDocument();
      expect(screen.getAllByTestId('noop-component')).toHaveLength(3);
    });
  });
});
