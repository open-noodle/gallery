import UserSidebar from '#lib/components/shared-components/side-bar/UserSidebar.svelte';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const mockPage = vi.hoisted(() => ({ url: new URL('https://gallery.test/photos') }));
vi.mock('$app/state', () => ({ page: mockPage }));

const mocks = vi.hoisted(() => ({
  authManager: {
    preferences: {
      folders: { enabled: false, sidebarWeb: false },
      memories: { enabled: true, sidebarWeb: true },
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

vi.mock('#lib/components/sidebar/sidebar-shell.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/sidebar-shell.stub.svelte');
  return { default: module.default };
});

vi.mock('#lib/components/shared-components/side-bar/BottomInfo.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: module.default };
});

vi.mock('#lib/components/shared-components/side-bar/rail-storage.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/rail-storage.stub.svelte');
  return { default: module.default };
});

vi.mock('#lib/components/shared-components/side-bar/RecentAlbums.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: module.default };
});

vi.mock('#lib/components/shared-components/side-bar/recent-spaces.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/noop-component.svelte');
  return { default: module.default };
});

vi.mock('#lib/managers/auth-manager.svelte.js', () => ({
  authManager: mocks.authManager,
}));

vi.mock('#lib/managers/feature-flags-manager.svelte.js', () => ({
  featureFlagsManager: mocks.featureFlagsManager,
}));

vi.mock('#lib/components/sidebar/sidebar-nav-item.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/sidebar-nav-item.stub.svelte');
  return { default: module.default };
});

vi.mock('#lib/components/sidebar/sidebar-nav-group.svelte', async () => {
  const module = await import('#lib/gallery/__mocks__/navbar-group.stub.svelte');
  return { default: module.default };
});

const sidebarMocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
}));

vi.mock('#lib/stores/sidebar-mode.svelte.js', () => ({ sidebarModeStore: sidebarMocks.sidebarModeStore }));

describe('UserSidebar', () => {
  beforeEach(() => {
    mocks.authManager.preferences.memories.enabled = true;
    mocks.authManager.preferences.memories.sidebarWeb = true;
    // The mocks object is shared across the whole file, so anything a test flips has to be put
    // back here or it leaks into every test after it.
    mocks.authManager.preferences.people.enabled = false;
    mocks.authManager.preferences.people.sidebarWeb = false;
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
    const spacesLink = () => page.getByRole('link', { name: /^spaces$/i });

    it('marks Spaces selected on the spaces list page', async () => {
      mockPage.url = new URL('https://gallery.test/spaces');

      await render(UserSidebar);

      await expect.element(spacesLink()).toHaveAttribute('data-active', 'true');
    });

    it('does not mark Spaces selected once a space is open', async () => {
      mockPage.url = new URL('https://gallery.test/spaces/space-1');

      await render(UserSidebar);

      await expect.element(spacesLink()).toHaveAttribute('data-active', 'false');
    });

    it('does not mark Spaces selected once a space album is open', async () => {
      mockPage.url = new URL('https://gallery.test/spaces/space-1/albums/album-1');

      await render(UserSidebar);

      await expect.element(spacesLink()).toHaveAttribute('data-active', 'false');
    });
  });

  // PhotoGuesser is a top-level destination, not a Library shelf: it browses the library by place
  // and date the way Map and People do, so it belongs in that run of rows rather than under the
  // Library heading. $t() returns the raw key in this environment, hence the lowercase names.
  describe('PhotoGuesser', () => {
    const photoGuesserLink = () => page.getByRole('link', { name: /^photoguesser$/i });

    it('links to the PhotoGuesser landing page', async () => {
      await render(UserSidebar);

      await expect.element(photoGuesserLink()).toHaveAttribute('href', '/photoguesser');
    });

    it('sits between Map and People', async () => {
      mocks.featureFlagsManager.value.map = true;
      mocks.authManager.preferences.people.enabled = true;
      mocks.authManager.preferences.people.sidebarWeb = true;
      // Memories moved into this same run of top-level rows, between PhotoGuesser and People.
      // Switch it off so the map -> photoguesser -> people run is contiguous and the adjacency
      // assertions below still mean something.
      mocks.authManager.preferences.memories.sidebarWeb = false;

      await render(UserSidebar);

      await expect.element(photoGuesserLink()).toBeInTheDocument();
      const titles = page
        .getByRole('link')
        .elements()
        .map((link) => link.textContent);
      expect(titles.indexOf('photoguesser')).toBe(titles.indexOf('map') + 1);
      expect(titles.indexOf('people')).toBe(titles.indexOf('photoguesser') + 1);
    });

    // PhotoGuesser needs no reverse-geocoding and works from capture dates alone, so an instance
    // with the map feature switched off must still reach it.
    it('is not gated on the map feature flag', async () => {
      mocks.featureFlagsManager.value.map = false;

      await render(UserSidebar);

      await expect.element(photoGuesserLink()).toBeInTheDocument();
    });
  });

  it('shows a memories link under Library when memories are enabled and the sidebar is on', async () => {
    mocks.authManager.preferences.memories.enabled = true;
    mocks.authManager.preferences.memories.sidebarWeb = true;

    await render(UserSidebar);

    await expect.element(page.getByRole('link', { name: /^memories$/i })).toHaveAttribute('href', '/memories');
  });

  it('hides the memories link when memories are disabled, even with the sidebar on', async () => {
    mocks.authManager.preferences.memories.enabled = false;
    mocks.authManager.preferences.memories.sidebarWeb = true;

    await render(UserSidebar);

    await expect.element(page.getByRole('link', { name: /^memories$/i })).not.toBeInTheDocument();
  });

  it('hides the memories link when the sidebar preference is off, even with memories enabled', async () => {
    mocks.authManager.preferences.memories.enabled = true;
    mocks.authManager.preferences.memories.sidebarWeb = false;

    await render(UserSidebar);

    await expect.element(page.getByRole('link', { name: /^memories$/i })).not.toBeInTheDocument();
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
    it('renders the compact rail storage indicator when collapsed to a rail', async () => {
      sidebarMocks.sidebarModeStore.layout = 'rail';
      sidebarMocks.sidebarModeStore.hoverExpanded = false;
      sidebarMocks.sidebarModeStore.railExpanded = false;

      await render(UserSidebar);

      await expect.element(page.getByTestId('rail-storage-stub')).toBeInTheDocument();
      expect(page.getByTestId('noop-component').elements()).toHaveLength(2);
    });

    it('renders BottomInfo when the rail is hover-expanded', async () => {
      sidebarMocks.sidebarModeStore.layout = 'rail';
      sidebarMocks.sidebarModeStore.hoverExpanded = true;
      sidebarMocks.sidebarModeStore.railExpanded = true;

      await render(UserSidebar);

      await expect.element(page.getByTestId('rail-storage-stub')).not.toBeInTheDocument();
      expect(page.getByTestId('noop-component').elements()).toHaveLength(3);
    });

    it('renders BottomInfo in the expanded layout', async () => {
      sidebarMocks.sidebarModeStore.layout = 'expanded';

      await render(UserSidebar);

      await expect.element(page.getByTestId('rail-storage-stub')).not.toBeInTheDocument();
      expect(page.getByTestId('noop-component').elements()).toHaveLength(3);
    });
  });
});
