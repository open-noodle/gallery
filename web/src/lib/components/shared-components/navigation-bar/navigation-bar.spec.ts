import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import NavigationBar from '$lib/components/shared-components/navigation-bar/NavigationBar.svelte';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    railOverlayOpen: false,
    toggleRailOverlay: vi.fn(),
  },
  sidebarStore: { isOpen: false, toggle: vi.fn() },
  // Real default: `false` under jsdom/happy-dom's static `matchMedia` mock in test-data/setup.ts.
  // Tests that need to simulate a specific viewport (e.g. the >=850px regression guard below)
  // set this explicitly.
  mediaQueryManager: { isFullSidebar: false },
}));

vi.mock('$lib/stores/sidebar-mode.svelte', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('$lib/stores/sidebar.svelte', () => ({ sidebarStore: mocks.sidebarStore }));
vi.mock('$lib/stores/media-query-manager.svelte', () => ({ mediaQueryManager: mocks.mediaQueryManager }));

// NavigationBar pulls in the search trigger, notification and account panels, the avatar
// and theme button, and calls notificationManager.refresh() on mount - a network call.
// Everything not under test is stubbed out so this spec exercises only the sidebar wiring.
vi.mock('$lib/stores/notification-manager.svelte', () => ({
  notificationManager: { notifications: [], refresh: vi.fn().mockResolvedValue(undefined) },
}));

// `ActionButton`'s `action` prop is required (not optional) and immediately destructures
// it in `isEnabled`, so `Cast: undefined` crashes on mount. `$if: () => false` mirrors the
// real cast action's own gating and keeps it hidden without touching NavigationBar's markup.
vi.mock('$lib/services/app.service', () => ({
  getGlobalActions: () => ({ Cast: { title: 'Cast', onAction: vi.fn(), $if: () => false } }),
}));

vi.mock('$lib/managers/global-search-manager.svelte', () => ({ globalSearchManager: { open: vi.fn() } }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: { authenticated: true, user: { name: 'Test', email: 'test@example.com' } },
}));

// Written out one by one on purpose: vi.mock is hoisted to the top of the module and
// needs a literal path, so a loop over an array of paths silently fails to mock anything.
vi.mock('$lib/components/global-search/global-search-input-trigger.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/navigation-bar/NotificationPanel.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/navigation-bar/AccountInfoPanel.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/UserAvatar.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

vi.mock('$lib/components/shared-components/ThemeButton.svelte', async () => {
  const module = await import('@test-data/mocks/noop-component.svelte');
  return { default: module.default };
});

// NavigationBar mounts real @immich/ui IconButtons (menu, search, upload, notifications),
// which resolve a bits-ui Tooltip against a "Tooltip.Provider" context. TestWrapper supplies
// it (see other *.spec.ts files rendering real IconButton-based trees).
type NavigationBarProps = { railAware?: boolean };

const renderNavigationBar = (props: NavigationBarProps = {}) =>
  render(TestWrapper as Component<{ component: typeof NavigationBar; componentProps: NavigationBarProps }>, {
    component: NavigationBar,
    componentProps: props,
  });

const menuButton = () => screen.getByRole('button', { name: /main_menu/i });

// Cross-checks the real Logo component's own rendered class, not just the wrapper span's
// test-facing `data-variant` - a mutation that changes only Logo's `variant` prop while
// leaving the sibling attribute untouched must still fail here. Logo's `variant="icon"`
// applies `aspect-square`; `variant="inline"` does not (see Logo.svelte's `variantClasses`).
const expectLogoImg = (variant: 'icon' | 'inline') => {
  const logoImg = screen.getByTestId('navbar-logo').querySelector('img');
  if (variant === 'icon') {
    expect(logoImg).toHaveClass('aspect-square');
  } else {
    expect(logoImg).not.toHaveClass('aspect-square');
  }
};

describe('NavigationBar sidebar integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarModeStore.layout = 'expanded';
    mocks.mediaQueryManager.isFullSidebar = false;
  });

  // Spec coverage 25.
  it.each`
    layout        | hidden
    ${'expanded'} | ${true}
    ${'rail'}     | ${false}
    ${'overlay'}  | ${false}
  `('menu button hidden=$hidden for $layout', ({ layout, hidden }) => {
    mocks.sidebarModeStore.layout = layout;

    renderNavigationBar({ railAware: true });

    const button = menuButton();
    expect(button.dataset.hidden !== undefined).toBe(hidden);
    // The actual visibility mechanism, not just its test-facing echo: `data-hidden` and the
    // `hidden` class are two independent attributes on the same element, both driven from
    // `menuButtonHidden` - assert the real class too, or a mutation that decouples them
    // would pass silently.
    expect(button.classList.contains('hidden')).toBe(hidden);
  });

  // Spec coverage 26: rail must route to the real toggle, not upstream's open-only one.
  it('toggles the rail overlay rather than sidebarStore in rail mode', () => {
    mocks.sidebarModeStore.layout = 'rail';

    renderNavigationBar({ railAware: true });
    menuButton().click();

    expect(mocks.sidebarModeStore.toggleRailOverlay).toHaveBeenCalledOnce();
    expect(mocks.sidebarStore.toggle).not.toHaveBeenCalled();
  });

  it('falls back to sidebarStore.toggle below 850px', () => {
    mocks.sidebarModeStore.layout = 'overlay';

    renderNavigationBar({ railAware: true });
    menuButton().click();

    expect(mocks.sidebarStore.toggle).toHaveBeenCalledOnce();
    expect(mocks.sidebarModeStore.toggleRailOverlay).not.toHaveBeenCalled();
  });

  // Spec coverage 27: 4rem cannot hold the hamburger and the logo together. Rail takes 9rem
  // rather than the overlay's 8rem because there the hamburger claims the rail's own 5rem, so
  // 5rem + the 3rem logo fills 8rem exactly and the logo would butt against the search field.
  it.each`
    layout        | column      | columnClass
    ${'overlay'}  | ${'narrow'} | ${'grid-cols-[--spacing(32)_auto]'}
    ${'rail'}     | ${'rail'}   | ${'grid-cols-[--spacing(36)_auto]'}
    ${'expanded'} | ${'wide'}   | ${'grid-cols-[--spacing(64)_auto]'}
  `('navbar first column is $column for $layout', ({ layout, column, columnClass }) => {
    mocks.sidebarModeStore.layout = layout;

    renderNavigationBar({ railAware: true });

    const grid = screen.getByTestId('navbar-grid');
    expect(grid).toHaveAttribute('data-column', column);
    // The literal Tailwind class actually applied, not just the semantic label above - a
    // mutation that swaps which class maps to which label would otherwise pass unnoticed.
    expect(grid).toHaveClass(columnClass);
  });

  // The rail's hamburger takes the rail's own 5rem so the logo next to it starts exactly where
  // the content panel starts, and so the hamburger shares a centre line with the rail icons
  // directly beneath it. The other two layouts must keep the hamburger inline beside the logo:
  // the sub-850px overlay has no content edge to align to, and the expanded layout hides the
  // hamburger, so a 5rem reservation would just be a hole in front of the logo.
  it.each`
    layout        | slot        | slotClass
    ${'rail'}     | ${'rail'}   | ${'flex w-20 shrink-0 justify-center'}
    ${'overlay'}  | ${'inline'} | ${'contents'}
    ${'expanded'} | ${'inline'} | ${'contents'}
  `('hamburger slot is $slot for $layout', ({ layout, slot, slotClass }) => {
    mocks.sidebarModeStore.layout = layout;

    renderNavigationBar({ railAware: true });

    const menuSlot = screen.getByTestId('navbar-menu-slot');
    expect(menuSlot).toHaveAttribute('data-slot', slot);
    expect(menuSlot.className).toBe(slotClass);
  });

  // The row's own inset is the other half of that pairing: in the rail it has to be zero, or the
  // 5rem hamburger slot starts 1rem late and carries the logo 1rem past the content edge.
  it.each`
    layout        | inset
    ${'rail'}     | ${false}
    ${'overlay'}  | ${true}
    ${'expanded'} | ${true}
  `('row inset present=$inset for $layout', ({ layout, inset }) => {
    mocks.sidebarModeStore.layout = layout;

    renderNavigationBar({ railAware: true });

    const row = screen.getByTestId('navbar-menu-slot').parentElement!;
    expect(/\bmx-4\b/.test(row.className)).toBe(inset);
  });

  // Spec coverage 28.
  it.each`
    layout        | variant
    ${'overlay'}  | ${'icon'}
    ${'rail'}     | ${'icon'}
    ${'expanded'} | ${'inline'}
  `('logo variant is $variant for $layout', ({ layout, variant }) => {
    mocks.sidebarModeStore.layout = layout;

    renderNavigationBar({ railAware: true });

    expect(screen.getByTestId('navbar-logo')).toHaveAttribute('data-variant', variant);
    expectLogoImg(variant);
  });

  // Spec coverage 30: AdminPageLayout renders this same NavigationBar but never passes
  // `railAware`, and its own sidebar is bound only to `sidebarStore.isOpen` (pinned open
  // above 850px) with no rail concept. Without the flag, a hamburger that suddenly appears
  // and calls `toggleRailOverlay()` would be a functionally inert, newly-visible button on
  // every Admin page whenever `sidebarModeStore.layout` resolves to `rail` (the default
  // `auto` mode, common laptop widths 850-1279px). Simulate exactly that: the store resolves
  // 'rail' (as it would at 900px in auto mode), but the real viewport is >=850px, so the
  // pre-rail behaviour must win.
  it('keeps the old viewport-only behaviour without railAware, even at a rail-resolving layout', () => {
    mocks.sidebarModeStore.layout = 'rail';
    mocks.mediaQueryManager.isFullSidebar = true;

    renderNavigationBar();
    menuButton().click();

    const button = menuButton();
    expect(button.dataset.hidden !== undefined).toBe(true);
    expect(button.classList.contains('hidden')).toBe(true);
    expect(mocks.sidebarStore.toggle).toHaveBeenCalledOnce();
    expect(mocks.sidebarModeStore.toggleRailOverlay).not.toHaveBeenCalled();

    const grid = screen.getByTestId('navbar-grid');
    expect(grid).toHaveAttribute('data-column', 'wide');
    expect(grid).toHaveClass('grid-cols-[--spacing(64)_auto]');

    expect(screen.getByTestId('navbar-logo')).toHaveAttribute('data-variant', 'inline');
    expectLogoImg('inline');
  });
});

// The bar goes compact in step with the sidebar: the full-width search trigger is spent from
// the same width `auto` mode stops showing the expanded sidebar and starts showing the rail.
// That is one number living in two files, and neither knows about the other - a breakpoint
// utility here, a MediaQuery over there - so it is asserted rather than assumed.
describe('NavigationBar search trigger', () => {
  const readSource = (relative: string) =>
    readFileSync(path.resolve(expect.getState().testPath!, '../../../../../', relative), 'utf8');

  const searchTrigger = () => screen.getByTestId('navbar-search-trigger');
  const searchButton = () => screen.getByRole('button', { name: /go_to_search/i });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarModeStore.layout = 'expanded';
    mocks.mediaQueryManager.isFullSidebar = false;
  });

  it('swaps the trigger for the magnifier at the width the sidebar becomes a rail', () => {
    renderNavigationBar({ railAware: true });

    // The breakpoint is read back off the markup rather than hard-coded, so the lookup below
    // resolves whichever one the component actually uses.
    const breakpoint = /\b(?<name>[a-z\d]+):block\b/.exec(searchTrigger().className)!.groups!.name;
    const width = new RegExp(String.raw`--breakpoint-${breakpoint}:\s*(?<px>\d+)px`).exec(readSource('app.css'))!
      .groups!.px;
    const railThreshold = /min-width:\s*(?<px>\d+)px/.exec(readSource('lib/stores/sidebar-media.svelte.ts'))!.groups!
      .px;

    expect(width).toBe(railThreshold);
  });

  // Complementary, both ways: one of the two is always reachable and never both at once. A
  // mutation that moved only one of the pair would otherwise leave a width with no search at
  // all, or with two.
  it('shows exactly one of the trigger and the magnifier at any width', () => {
    renderNavigationBar({ railAware: true });

    const breakpoint = /\b(?<name>[a-z\d]+):block\b/.exec(searchTrigger().className)!.groups!.name;

    // classList rather than a substring: a bare `hidden` and the `xl:hidden` that has to be
    // there are the same word, and only exact tokens tell them apart.
    expect([...searchTrigger().classList]).toContain('hidden');
    expect([...searchButton().classList]).toContain(`${breakpoint}:hidden`);
    expect([...searchButton().classList]).not.toContain('hidden');
  });

  // The action row has to span the bar while the trigger is gone: `justify-between` with a
  // single child parks it at the start, which would leave the icons beside the logo with the
  // rest of the bar empty after them.
  it('spans the action row across the bar until the trigger returns', () => {
    renderNavigationBar({ railAware: true });

    const breakpoint = /\b(?<name>[a-z\d]+):block\b/.exec(searchTrigger().className)!.groups!.name;
    const actions = searchButton().closest('section')!;

    expect(actions.className).toContain('w-full');
    expect(actions.className).toContain(`${breakpoint}:w-auto`);
  });

  // Small screens get the same mark as everything else. Upstream pinned them at the old 3rem,
  // which after the bar was thinned left it biggest exactly where the bar is tightest.
  it('renders the mark at one size at every width', () => {
    renderNavigationBar({ railAware: true });

    const logoImg = screen.getByTestId('navbar-logo').querySelector('img')!;
    expect(logoImg).toHaveClass('h-10');
    expect(logoImg.className).not.toMatch(/:h-/);
  });
});
