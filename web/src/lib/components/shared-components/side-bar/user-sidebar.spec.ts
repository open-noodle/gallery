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
  familyAccessManager: {
    granted: false,
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

vi.mock('#lib/managers/family-access-manager.svelte.ts', () => ({
  familyAccessManager: mocks.familyAccessManager,
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
    mocks.authManager.preferences.people.enabled = false;
    mocks.authManager.preferences.people.sidebarWeb = false;
    mocks.familyAccessManager.granted = false;
    mockPage.url = new URL('https://gallery.test/photos');
    sidebarMocks.sidebarModeStore.layout = 'expanded';
    sidebarMocks.sidebarModeStore.hoverExpanded = false;
    sidebarMocks.sidebarModeStore.railExpanded = false;
  });

  // A1: one SidebarNavItem, placed after People. A12: renders nothing at all — not a disabled
  // entry — when the viewer's effective family access is `none`.
  describe('Family nav item', () => {
    const familyLink = () => page.getByRole('link', { name: /family_canvas_nav_item/i }).query();

    it('adds a Family item to the sidebar after People', async () => {
      mocks.authManager.preferences.people.enabled = true;
      mocks.authManager.preferences.people.sidebarWeb = true;
      mocks.familyAccessManager.granted = true;

      await render(UserSidebar);

      const links = page
        .getByRole('link')
        .elements()
        .map((link) => link.textContent?.trim() ?? '');
      const peopleIndex = links.findIndex((text) => /^people$/i.test(text));
      const familyIndex = links.findIndex((text) => /family_canvas_nav_item/i.test(text));

      expect(peopleIndex).toBeGreaterThanOrEqual(0);
      expect(familyIndex).toBeGreaterThan(peopleIndex);
    });

    it('renders the Family sidebar item for a viewer with view access', async () => {
      mocks.familyAccessManager.granted = true;

      await render(UserSidebar);

      expect(familyLink()).toBeInTheDocument();
      expect(familyLink()).toHaveAttribute('href', '/family');
    });

    it('renders no Family sidebar item when the viewer has no family access', async () => {
      mocks.familyAccessManager.granted = false;

      await render(UserSidebar);

      expect(familyLink()).not.toBeInTheDocument();
    });
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
