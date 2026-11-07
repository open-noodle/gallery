import SidebarNavGroup from '#lib/components/sidebar/sidebar-nav-group.svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
}));

vi.mock('#lib/stores/sidebar-mode.svelte.js', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('@immich/ui', async () => {
  const navbarGroup = await import('#lib/gallery/__mocks__/navbar-group.stub.svelte');
  return { NavbarGroup: navbarGroup.default };
});

describe('sidebar-nav-group', () => {
  beforeEach(() => {
    mocks.sidebarModeStore.layout = 'expanded';
    mocks.sidebarModeStore.hoverExpanded = false;
    mocks.sidebarModeStore.railExpanded = false;
  });

  it('renders the text header when expanded', async () => {
    await render(SidebarNavGroup, { title: 'Library' });

    expect(page.getByText('Library', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByTestId('sidebar-group-divider').query()).not.toBeInTheDocument();
  });

  // A bare rule is 47px shorter than the header it replaced, so every row below a group jumped
  // that far the moment the rail collapsed - and back again on hover. The header stays mounted
  // to hold the group's height; only its ink is swapped for a rule.
  it('renders a divider instead of the header in rail mode', async () => {
    mocks.sidebarModeStore.layout = 'rail';

    await render(SidebarNavGroup, { title: 'Library' });

    expect(page.getByTestId('sidebar-group-divider').element()).toBeInTheDocument();
    const reserved = page.getByText('Library', { exact: true }).element().closest('[aria-hidden="true"]');
    // Hidden from sight and from assistive tech, but still occupying its box.
    expect(reserved).toHaveClass('invisible');
  });

  it('restores the header while hover-expanded', async () => {
    mocks.sidebarModeStore.layout = 'rail';
    mocks.sidebarModeStore.hoverExpanded = true;
    mocks.sidebarModeStore.railExpanded = true;

    await render(SidebarNavGroup, { title: 'Library' });

    expect(page.getByText('Library', { exact: true }).element()).toBeInTheDocument();
    expect(page.getByTestId('sidebar-group-divider').query()).not.toBeInTheDocument();
  });
});
