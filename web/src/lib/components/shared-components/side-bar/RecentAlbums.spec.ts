import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import RecentAlbums from '$lib/components/shared-components/side-bar/RecentAlbums.svelte';
import { userInteraction } from '$lib/stores/user.svelte';
import { albumFactory } from '@test-data/factories/album-factory';

const sidebarMocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
}));
vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: sidebarMocks.sidebarModeStore }));

describe('RecentAlbums component', () => {
  beforeEach(() => {
    // This project does not enable `clearMocks`, so call history accumulates across a file and
    // a `toHaveBeenCalledOnce` further down would count every earlier render too.
    vi.clearAllMocks();
    sidebarMocks.sidebarModeStore.layout = 'expanded';
    sidebarMocks.sidebarModeStore.hoverExpanded = false;
    sidebarMocks.sidebarModeStore.railExpanded = false;
    // Module-level cache: the component only fetches when it is unset, so leaving one test's
    // albums behind silently feeds them to the next.
    userInteraction.recentAlbums = undefined;
  });

  // The rail keeps these rows so it holds the expanded sidebar's vertical rhythm; collapsed a
  // row is just its cover thumbnail, centred, as Google Photos' rail shows albums.
  it.each`
    layout        | hoverExpanded | centred  | inset
    ${'rail'}     | ${false}      | ${true}  | ${false}
    ${'rail'}     | ${true}       | ${false} | ${true}
    ${'expanded'} | ${false}      | ${false} | ${true}
  `(
    'centred=$centred for layout=$layout hoverExpanded=$hoverExpanded',
    async ({ layout, hoverExpanded, centred, inset }) => {
      sidebarMocks.sidebarModeStore.layout = layout;
      sidebarMocks.sidebarModeStore.hoverExpanded = hoverExpanded;
      sidebarMocks.sidebarModeStore.railExpanded = hoverExpanded;
      sdkMock.getAllAlbums.mockResolvedValueOnce([albumFactory.build()]);
      render(RecentAlbums);
      await tick();
      await tick();

      const row = screen.getAllByRole('link')[0];
      // Centring is a padding value, never `justify-center`: only a length can be transitioned,
      // and without that the thumbnail snapped to the row's start before sliding right.
      expect(/\bw-12\b/.test(row.className)).toBe(centred);
      expect(/\bps-12\b/.test(row.className)).toBe(inset);
      expect(row.className).not.toContain('justify-center');
    },
  );

  it('sorts albums by most recently updated', async () => {
    const albums = [
      albumFactory.build({ updatedAt: '2024-01-01T00:00:00Z' }),
      albumFactory.build({ updatedAt: '2024-01-09T00:00:01Z' }),
      albumFactory.build({ updatedAt: '2024-01-10T00:00:00Z' }),
      albumFactory.build({ updatedAt: '2024-01-09T00:00:00Z' }),
    ];

    sdkMock.getAllAlbums.mockResolvedValueOnce([...albums]);
    render(RecentAlbums);

    expect(sdkMock.getAllAlbums).toHaveBeenCalledOnce();

    // wtf
    await tick();
    await tick();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute('href', `/albums/${albums[2].id}`);
    expect(links[1]).toHaveAttribute('href', `/albums/${albums[1].id}`);
    expect(links[2]).toHaveAttribute('href', `/albums/${albums[3].id}`);
  });
});
