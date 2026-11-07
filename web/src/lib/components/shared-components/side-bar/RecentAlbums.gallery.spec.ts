import RecentAlbums from '#lib/components/shared-components/side-bar/RecentAlbums.svelte';
import { albumsQueryKey } from '#lib/queries/album.query.ts';
import { queryClient } from '#lib/queries/client.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const sidebarMocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
}));
vi.mock('#lib/stores/sidebar-mode.svelte.js', () => ({ sidebarModeStore: sidebarMocks.sidebarModeStore }));

describe('RecentAlbums component', () => {
  beforeEach(() => {
    sidebarMocks.sidebarModeStore.layout = 'expanded';
    sidebarMocks.sidebarModeStore.hoverExpanded = false;
    sidebarMocks.sidebarModeStore.railExpanded = false;
    // Module-level cache: the component only fetches when it is unset, so leaving one test's
    // albums behind silently feeds them to the next.
    queryClient.removeQueries({ queryKey: albumsQueryKey });
  });

  // The rail keeps these rows so it holds the expanded sidebar's vertical rhythm; collapsed a
  // row is just its cover thumbnail, centred, as Google Photos' rail shows albums.
  test.for`
    layout        | hoverExpanded | centred  | inset
    ${'rail'}     | ${false}      | ${true}  | ${false}
    ${'rail'}     | ${true}       | ${false} | ${true}
    ${'expanded'} | ${false}      | ${false} | ${true}
  `(
    'centred=$centred for layout=$layout hoverExpanded=$hoverExpanded',
    async ({ layout, hoverExpanded, centred, inset }, { data }) => {
      sidebarMocks.sidebarModeStore.layout = layout;
      sidebarMocks.sidebarModeStore.hoverExpanded = hoverExpanded;
      sidebarMocks.sidebarModeStore.railExpanded = hoverExpanded;
      data.addAlbums(factory.album());
      await render(RecentAlbums);

      await expect.element(page.getByRole('link')).toBeInTheDocument();
      const row = page.getByRole('link').element();
      // Centring is a padding value, never `justify-center`: only a length can be transitioned,
      // and without that the thumbnail snapped to the row's start before sliding right.
      expect(/\bw-12\b/.test(row.className)).toBe(centred);
      expect(/\bps-12\b/.test(row.className)).toBe(inset);
      expect(row.className).not.toContain('justify-center');
    },
  );
});
