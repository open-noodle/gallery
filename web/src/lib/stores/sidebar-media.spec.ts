import { sidebarMedia } from '$lib/stores/sidebar-media.svelte';

const mocks = vi.hoisted(() => ({ mediaQueryManager: { isFullSidebar: false } }));

vi.mock('$lib/stores/media-query-manager.svelte', () => ({ mediaQueryManager: mocks.mediaQueryManager }));

describe('sidebarMedia', () => {
  beforeEach(() => {
    mocks.mediaQueryManager.isFullSidebar = false;
  });

  it('mirrors isFullSidebar from the upstream media query manager', () => {
    expect(sidebarMedia.isFullSidebar).toBe(false);
    mocks.mediaQueryManager.isFullSidebar = true;
    expect(sidebarMedia.isFullSidebar).toBe(true);
  });
});
