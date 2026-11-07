import SidebarNavItem from '#lib/components/sidebar/sidebar-nav-item.svelte';
import { reactiveProps } from '#lib/gallery/__mocks__/reactive-props.svelte.ts';
import { mdiImageMultiple } from '@mdi/js';
import { createRawSnippet } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';

const mocks = vi.hoisted(() => ({
  sidebarModeStore: {
    layout: 'expanded' as 'overlay' | 'rail' | 'expanded',
    hoverExpanded: false,
    railExpanded: false,
  },
  page: { url: new URL('https://gallery.test/photos') },
}));

vi.mock('#lib/stores/sidebar-mode.svelte.js', () => ({ sidebarModeStore: mocks.sidebarModeStore }));
vi.mock('$app/state', () => ({ page: mocks.page }));

const setLayout = (layout: 'overlay' | 'rail' | 'expanded', hoverExpanded = false) => {
  mocks.sidebarModeStore.layout = layout;
  mocks.sidebarModeStore.hoverExpanded = hoverExpanded;
  mocks.sidebarModeStore.railExpanded = hoverExpanded;
};

describe('sidebar-nav-item', () => {
  beforeEach(() => {
    setLayout('expanded');
    mocks.page.url = new URL('https://gallery.test/photos');
  });

  const link = () => page.getByRole('link', { name: /photos/i }).element();

  it('keeps the label in the accessibility tree when collapsed', async () => {
    setLayout('rail');

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    // Spec coverage 18. The label must stay mounted, so assert on the accessible NAME,
    // not on text presence - `getByText` would pass in both states and could never fail.
    expect(link()).toHaveAccessibleName(/photos/i);
    // The accessible-name assertion above also passes off the `title="Photos"` tooltip
    // attribute rail mode adds, so it alone would not notice the label `<span>` being
    // deleted. Assert the span node itself is still there, scoped to the link.
    expect(page.elementLocator(link()).getByText('Photos', { exact: true }).element()).toBeInTheDocument();
  });

  it('marks itself collapsed only in rail mode', async () => {
    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).toHaveAttribute('data-collapsed', 'false');
  });

  it('marks itself collapsed in rail mode', async () => {
    setLayout('rail');

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-collapsed', 'true');
  });

  it('expands while hover-expanded even though layout is rail', async () => {
    setLayout('rail', true);

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-collapsed', 'false');
  });

  // The navbar hamburger widens the panel through `railOverlayOpen`, not hover. A row keyed off
  // hover alone stayed collapsed inside it, so tapping the hamburger opened a full-width panel
  // showing nothing but icons until the pointer happened to wander in - which is also the only
  // route a touch user has.
  it('expands when the navbar hamburger opens the rail overlay', async () => {
    mocks.sidebarModeStore.layout = 'rail';
    mocks.sidebarModeStore.hoverExpanded = false;
    mocks.sidebarModeStore.railExpanded = true;

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-collapsed', 'false');
  });

  // The active pill is the link itself, so in the rail it is a 3rem indicator centred in the
  // 5rem band - but the icon inside is not. The expanded `ps-*` leads the icon in for the label,
  // and the label stays mounted at zero width when collapsed, so its `gap-4` still occupies space
  // after the icon. Both push the icon right of the pill's centre. With no visible label to
  // lead, the icon has to centre instead. Assert the classes that decide it rather than measured
  // pixel positions, which shift with fonts and the viewport.
  it('centres the icon in the active pill when collapsed', async () => {
    setLayout('rail');

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    // Padding, never `justify-center`: `justify-content` is not an animatable property, so
    // dropping it on expand snapped the icon to the row's start and the padding animation then
    // carried it right - the icon appeared to pop in from the far left. Keeping both states a
    // single length means the expand is one continuous glide.
    expect(link().className).not.toContain('justify-center');
    expect(link().className).toMatch(/ps-\[[\d.]+rem\]/);
  });

  // The other half of the pairing: centring must be scoped to the collapsed rail, or the
  // expanded sidebar loses the icon-then-label reading order the layout depends on.
  it('leads with the icon and gaps the label when expanded', async () => {
    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link().className).toContain('ps-7');
    expect(link().className).toContain('gap-4');
    expect(link().className).not.toContain('justify-center');
  });

  // The pill used to be `w-full`, which ran it flush to the sidebar's start edge while the panel's
  // reserved scrollbar gutter left a gap at the other - the ends visibly disagreed. It now carries
  // the same 0.75rem margin at both ends (Google Photos' inset at this sidebar width) and gives
  // that width back, so the two ends match and nothing overflows the panel. The margin comes out
  // of the padding rather than being added to it - `ps-7` above, not `ps-10` - because the icon's
  // distance is measured from the sidebar, not from the pill.
  it('insets the expanded pill equally at both ends', async () => {
    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link().className).toContain('mx-3');
    expect(link().className).toContain('w-[calc(100%-1.5rem)]');
    expect(link().className).not.toMatch(/\bw-full\b/);
  });

  it('adds a tooltip only when collapsed', async () => {
    setLayout('rail');
    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).toHaveAttribute('title', 'Photos');
  });

  it('omits the tooltip when expanded', async () => {
    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });
    expect(link()).not.toHaveAttribute('title');
  });

  // Spec coverage 17.
  it('reports the isActive override verdict', async () => {
    await render(SidebarNavItem, {
      title: 'Photos',
      href: '/photos',
      icon: mdiImageMultiple,
      isActive: () => false,
    });

    expect(link()).toHaveAttribute('data-active', 'false');
  });

  it('falls back to a prefix match when no isActive override is given', async () => {
    mocks.page.url = new URL('https://gallery.test/photos/123');

    await render(SidebarNavItem, { title: 'Photos', href: '/photos', icon: mdiImageMultiple });

    expect(link()).toHaveAttribute('data-active', 'true');
  });

  // Spec coverage 15, inverted: the rail keeps the sub-tree. Dropping those rows made the rail
  // shorter than the sidebar it expands into, so every row below an expanded Spaces or Albums
  // jumped on hover. The rows collapse to their own thumbnails instead - the treatment Google
  // Photos' rail uses - which keeps both states on the same vertical rhythm.
  it('keeps the sub-tree in rail mode', async () => {
    setLayout('rail');

    await render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    expect(page.getByTestId('subtree').element()).toBeInTheDocument();
  });

  // ...but only when it is actually expanded: the rail must not force sub-trees open.
  it('hides a collapsed sub-tree in rail mode', async () => {
    setLayout('rail');

    await render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: false,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    expect(page.getByTestId('subtree').query()).not.toBeInTheDocument();
  });

  // The chevron is absolutely positioned, so with no start inset it sat against the sidebar's
  // edge, ~11px in. `inset-s-3` gives it room - and lines it up with the pill's own 0.75rem
  // margin, so it no longer overhangs the pill's rounded start cap; the space rows' own chevrons
  // then step further in at `inset-s-8`, so a parent caret never sits directly above its children's.
  it('insets the sub-tree chevron from the sidebar edge', async () => {
    await render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      items: createRawSnippet(() => ({ render: () => `<span>recent</span>` })),
    });

    const chevron = page.getByRole('button', { name: /expand|collapse/i }).element();
    expect(chevron.className).toContain('inset-s-3');
  });

  it('shows the sub-tree when expanded', async () => {
    await render(SidebarNavItem, {
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    expect(page.getByTestId('subtree').element()).toBeInTheDocument();
  });

  // Spec coverage 24: long DE/NL/PL labels must clip rather than widen the panel.
  it('truncates the label instead of wrapping', async () => {
    await render(SidebarNavItem, {
      title: 'Zuletzt hinzugefügte Fotos und Videos',
      href: '/recently-added',
      icon: mdiImageMultiple,
    });

    const label = page.getByText('Zuletzt hinzugefügte Fotos und Videos', { exact: true }).element();
    expect(label.className).toContain('truncate');
  });

  // Spec coverage 16: hiding is render-time only. Collapsing to the rail must not
  // write `false` back into the persisted recentAlbumsDropdown / recentSpacesDropdown flag.
  it('does not clobber the bound expanded flag when collapsed', async () => {
    setLayout('rail');
    // `reactiveProps` (not a plain object, and not `$state(...)` inline - this is a plain
    // `.spec.ts` file, which the Svelte plugin does not compile, so `$state` would throw
    // `rune_outside_svelte`). Svelte's bindable-prop write-back only engages for an
    // imperatively mounted component when the props object carries `STATE_SYMBOL`, i.e. was
    // created via `$state(...)` - see `reactive-props.svelte.ts` for the full mechanism. A
    // plain object here would make this assertion pass unconditionally, whether or not the
    // component actually clobbers the bound flag.
    const props = reactiveProps({
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    await render(SidebarNavItem, props);

    expect(props.expanded).toBe(true);
  });

  // Upstream NavbarItem renders a chevron button (aria-label 'expand'/'collapse') that
  // toggles the bindable `expanded` flag - this is the control recentAlbumsDropdown /
  // recentSpacesDropdown are bound through in UserSidebar. `reactiveProps` is required here
  // for the same reason as above: a plain object would never observe the write-back.
  it('flips the bound expanded flag when the expand/collapse control is clicked', async () => {
    const props = reactiveProps({
      title: 'Albums',
      href: '/albums',
      icon: mdiImageMultiple,
      expanded: true,
      items: createRawSnippet(() => ({ render: () => `<span data-testid="subtree">recent</span>` })),
    });

    await render(SidebarNavItem, props);

    await userEvent.click(page.getByRole('button', { name: /collapse/i }));

    expect(props.expanded).toBe(false);
  });
});
