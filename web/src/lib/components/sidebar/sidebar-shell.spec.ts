import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import SidebarShell from '$lib/components/sidebar/sidebar-shell.svelte';
import { sidebarModeStore } from '$lib/stores/sidebar-mode.svelte';

const mocks = vi.hoisted(() => ({
  sidebarMedia: { isFullSidebar: true, isWideSidebar: false },
  sidebarStore: { isOpen: true, reset: vi.fn() },
  beforeNavigate: vi.fn(),
  // Deliberately not the real 'top-menu-button': the shell has to resolve the id through
  // the constant rather than hard-coding it. Mocked rather than imported because a .ts
  // file cannot name a .svelte module export - `declare module '*.svelte'` types only the
  // default export, so `tsc --noEmit` rejects it.
  menuButtonId: 'test-menu-button',
}));

vi.mock('$lib/stores/sidebar-media.svelte', () => ({ sidebarMedia: mocks.sidebarMedia }));
vi.mock('$lib/stores/sidebar.svelte', () => ({ sidebarStore: mocks.sidebarStore }));
vi.mock('$app/navigation', () => ({ beforeNavigate: mocks.beforeNavigate }));
vi.mock('$lib/components/shared-components/navigation-bar/NavigationBar.svelte', () => ({
  menuButtonId: mocks.menuButtonId,
}));

const nav = () => screen.getByTestId('sidebar-parent');

// Every selector in gallery-theme.css whose rule carries `declaration`. Read from the
// stylesheet rather than restated here so these tests track the theme instead of a copy of it.
// Read off disk, not imported: Vite's CSS pipeline serves `?raw` on a .css file as an empty
// string. Anchored to the test's own path because `process.cwd()` depends on where the runner
// was launched from and `import.meta.url` is not a file: URL under Vite's transform.
const themeSelectorsDeclaring = (declaration: string) => {
  const themePath = path.resolve(expect.getState().testPath!, '../../../../styles/gallery-theme.css');
  // Comments stripped whole-file before the comma split: the theme documents each rule above
  // it, and a comment containing a comma would otherwise survive as an unparseable selector.
  const css = readFileSync(themePath, 'utf8').replaceAll(/\/\*[\S\s]*?\*\//g, '');
  return [...css.matchAll(/(?<selectors>[^{}]+)\{(?<body>[^{}]*)\}/g)]
    .filter((rule) => rule.groups!.body.includes(declaration))
    .flatMap((rule) => rule.groups!.selectors.split(','))
    .map((selector) => selector.trim())
    .filter(Boolean);
};

describe('sidebar-shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarMedia.isFullSidebar = true;
    mocks.sidebarMedia.isWideSidebar = false;
    mocks.sidebarStore.isOpen = true;
    sidebarModeStore.mode = 'rail';
    sidebarModeStore.resetTransient();
  });

  it('reports the rail layout', () => {
    render(SidebarShell);
    expect(nav()).toHaveAttribute('data-layout', 'rail');
  });

  // The two props are the component's whole public surface, and `ariaLabel` is its only
  // accessible name. Kept in its own render: real focusable children change what the
  // focus trap would grab, which the trap tests below depend on.
  it('renders its children and exposes the aria label', () => {
    const children = createRawSnippet(() => ({
      render: () => `<button type="button">Photos</button>`,
    }));

    render(SidebarShell, { ariaLabel: 'Primary', children });

    expect(screen.getByRole('navigation', { name: 'Primary' })).toBe(nav());
    expect(screen.getByRole('button', { name: 'Photos' })).toBeInTheDocument();
  });

  // Spec coverage 12. Upstream isOpen is permanently true above 850px, so a shell that
  // consulted it would render a permanently expanded rail.
  it('ignores upstream isOpen in rail mode', () => {
    mocks.sidebarStore.isOpen = true;

    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 6.
  it('expands on pointerenter and collapses on pointerleave', async () => {
    render(SidebarShell);

    await fireEvent.pointerEnter(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.pointerLeave(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 7: the grid slot must stay at rail width so the timeline never re-lays-out.
  // The nav is the grid item, so the no-reflow property is that *its own box* is unchanged
  // by hover - only the absolutely-positioned panel inside it grows. Assert the nav's class
  // list directly: any width utility that tracks expansion would widen the slot.
  it('does not resize its own grid slot while hover-expanded', async () => {
    render(SidebarShell);
    const collapsed = nav().className;

    await fireEvent.pointerEnter(nav());

    // Guards against a vacuous pass: the hover has to have actually taken effect.
    expect(nav()).toHaveAttribute('data-expanded', 'true');
    expect(nav().className).toBe(collapsed);
    // Deliberately not "the nav has no `w-` utility at all": a width that is constant per
    // layout is fine and Task 8 may add one. What must never happen is a width that
    // tracks expansion, which is exactly what the invariance above forbids.
  });

  // `focusout` bubbles, so it fires on the nav for focus moving *between* rows as well as for
  // focus leaving. Sharing one flag with the pointer let the focus half clobber the pointer
  // half: clicking a row collapsed the rail and the following `focusin` re-expanded it (a
  // visible flicker), and when no `focusin` followed - focus falling to <body> because the
  // focused row was unmounted, which is what collapsing a sub-tree or re-rendering after
  // navigation does - the rail stayed collapsed under a pointer that had never left.
  it('stays expanded when focus leaves while the pointer is still inside', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    // No relatedTarget: focus fell to <body>, e.g. the focused row was just unmounted.
    await fireEvent.focusOut(nav());

    expect(nav()).toHaveAttribute('data-expanded', 'true');
  });

  it('stays expanded while focus moves between rows', async () => {
    const children = createRawSnippet(() => ({
      render: () => `<div><button type="button">Photos</button><button type="button">Albums</button></div>`,
    }));
    render(SidebarShell, { children });
    const [, albums] = screen.getAllByRole('button');
    await fireEvent.focusIn(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.focusOut(nav(), { relatedTarget: albums });

    expect(nav()).toHaveAttribute('data-expanded', 'true');
  });

  // Clicking a row - a sub-tree chevron especially - leaves focus sitting on it, and nothing
  // takes it away until the user clicks elsewhere. With focus counted on its own that pinned the
  // rail open after the pointer had left. A pointer leaving is a mouse user done with the rail,
  // so it drops the focus half too. Keyboard users never fire this: they never had a pointer in.
  it('collapses when the pointer leaves even though a click left focus inside', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());
    await fireEvent.focusIn(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.pointerLeave(nav());

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // The other half: expansion is the union of the two inputs, so it must survive until both
  // are gone - and still collapse once they are, or the rail would pin open.
  it('collapses only once both the pointer and focus have left', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());
    await fireEvent.focusIn(nav());

    await fireEvent.focusOut(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.pointerLeave(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 8.
  it('expands on focusin and collapses on focusout', async () => {
    render(SidebarShell);

    await fireEvent.focusIn(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.focusOut(nav());
    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 9.
  it('collapses on Escape', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());

    await fireEvent.keyDown(nav(), { key: 'Escape' });

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });

  // Spec coverage 10.
  it('dismisses the rail overlay on outside click', async () => {
    render(SidebarShell);
    sidebarModeStore.toggleRailOverlay();
    // A bare $state write is flushed to the DOM in a microtask, so the precondition
    // below only reads the new value after an explicit tick.
    await tick();
    expect(nav()).toHaveAttribute('data-expanded', 'true');

    await fireEvent.mouseDown(document.body);

    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  // The shell replaces upstream Sidebar, which dismissed the sub-850px overlay on both
  // Escape and outside click. That overlay is modal, so both must keep working.
  it.each([
    ['Escape', (element: HTMLElement) => fireEvent.keyDown(element, { key: 'Escape' })],
    ['outside click', () => fireEvent.mouseDown(document.body)],
  ])('closes the sub-850px overlay on %s', async (_, dismiss) => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = true;
    render(SidebarShell);

    await dismiss(nav());

    expect(mocks.sidebarStore.reset).toHaveBeenCalled();
  });

  // Closing the overlay makes this nav inert while focus is still inside it (on the focus
  // trap's backup sentinel). Deactivating the trap does not destroy the action, so nothing
  // else puts focus back - the keyboard user would land on <body>.
  it('returns focus to the navbar menu button when the overlay closes', async () => {
    const menuButton = document.createElement('button');
    menuButton.id = mocks.menuButtonId;
    document.body.append(menuButton);
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = true;
    render(SidebarShell);
    await tick();
    expect(nav().contains(document.activeElement)).toBe(true);

    await fireEvent.keyDown(nav(), { key: 'Escape' });

    expect(document.activeElement).toBe(menuButton);
    menuButton.remove();
  });

  // Spec coverage 11.
  it('registers a beforeNavigate handler that clears only the overlay flag', () => {
    render(SidebarShell);
    expect(mocks.beforeNavigate).toHaveBeenCalled();

    sidebarModeStore.pointerInside = true;
    sidebarModeStore.toggleRailOverlay();

    const handler = mocks.beforeNavigate.mock.calls[0][0] as () => void;
    handler();

    expect(sidebarModeStore.railOverlayOpen).toBe(false);
    // The pointer is still over the rail after clicking a link, so hover survives.
    expect(sidebarModeStore.hoverExpanded).toBe(true);
  });

  // Upstream Sidebar closed the mobile overlay from onMount, which fired on every
  // navigation because UserPageLayout remounts per page. Without this the overlay would
  // stay open on top of the page the user just navigated to.
  it('closes the sub-850px overlay on navigation', () => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = true;
    render(SidebarShell);

    const handler = mocks.beforeNavigate.mock.calls[0][0] as () => void;
    handler();

    expect(mocks.sidebarStore.reset).toHaveBeenCalled();
  });

  // Spec coverage 13.
  it('never marks itself inert in rail mode', () => {
    render(SidebarShell);
    expect((nav() as HTMLElement).inert).toBe(false);
  });

  // Spec coverage 13. A hover-expanded rail is not modal, so the trap must stay inactive.
  // An active trap pulls focus to its first tabbable node - the backup sentinel when the
  // shell has no children - which is what makes activity observable at all.
  it.each([
    ['stays out of the way in rail mode', true, false],
    ['traps focus in the open sub-850px overlay', false, true],
  ])('%s', async (_, isFullSidebar, trapped) => {
    mocks.sidebarMedia.isFullSidebar = isFullSidebar;
    mocks.sidebarStore.isOpen = true;

    render(SidebarShell);
    await tick();

    expect(nav().contains(document.activeElement)).toBe(trapped);
  });

  // Spec coverage 14: the sub-850px overlay keeps today's modal behaviour.
  it('is inert when hidden below 850px', () => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = false;

    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-layout', 'overlay');
    expect((nav() as HTMLElement).inert).toBe(true);
  });

  it('is not inert when the sub-850px overlay is open', () => {
    mocks.sidebarMedia.isFullSidebar = false;
    mocks.sidebarStore.isOpen = true;

    render(SidebarShell);

    expect((nav() as HTMLElement).inert).toBe(false);
  });

  // Spec coverage 3. The reset runs in an $effect, which flushes in a post-render
  // microtask - await tick() explicitly rather than relying on rerender() to flush it.
  it('clears transient flags when the layout leaves rail', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());
    expect(sidebarModeStore.hoverExpanded).toBe(true);

    sidebarModeStore.mode = 'expanded';
    await tick();

    expect(sidebarModeStore.hoverExpanded).toBe(false);
    expect(sidebarModeStore.railOverlayOpen).toBe(false);
  });

  // Guards the resurface case: returning to rail must not restore a stale hover state.
  it('does not restore stale hover state when returning to rail', async () => {
    render(SidebarShell);
    await fireEvent.pointerEnter(nav());

    sidebarModeStore.mode = 'expanded';
    await tick();
    sidebarModeStore.mode = 'rail';
    await tick();

    expect(nav()).toHaveAttribute('data-expanded', 'false');
  });
});

describe('sidebar-shell direction and motion', () => {
  // Not `nav().firstElementChild`: focusTrap inserts its sentinel <div>s as the first and
  // last children of the container, so the first child is a class-less sentinel and every
  // className assertion against it would pass vacuously.
  const panel = () => screen.getByTestId('sidebar-panel');

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sidebarMedia.isFullSidebar = true;
    mocks.sidebarMedia.isWideSidebar = false;
    mocks.sidebarStore.isOpen = true;
    sidebarModeStore.mode = 'rail';
    sidebarModeStore.resetTransient();
  });

  // Spec coverage 23: the rail is anchored with a logical inset property, so the same
  // static class list is correct in both writing directions - there is no JS-level `dir`
  // branch here for a test to exercise. Setting `document.documentElement.dir` does not
  // change which classes this component emits, so real RTL placement is verified in e2e,
  // not here.
  it('anchors the panel to the inline-start with a logical inset utility', () => {
    render(SidebarShell);

    // `inset-s-0` is this codebase's canonical inset-inline-start utility.
    expect(panel().className).toContain('inset-s-0');
    expect(panel().className).not.toMatch(/\b(?:left|right)-0\b/);
  });

  // The fork's two-tone theme paints the sidebar surface itself, with unlayered rules in
  // gallery-theme.css that beat the panel's own `bg-light` utility. That coupling is to the
  // DOM shape: this shell moved the visible surface off the `<nav id="sidebar">` onto an inner
  // panel that covers it, so a chrome rule naming only `#sidebar` paints an element the user
  // can no longer see and leaves the panel showing `bg-light` - which in dark mode resolves to
  // the darker *content* surface, not the chrome. happy-dom has no cascade to assert a colour
  // against, so assert the selector reaches the panel instead.
  it('exposes the painted surface to the fork chrome rule', () => {
    render(SidebarShell);

    const selectors = themeSelectorsDeclaring('background-color: var(--gallery-chrome)');
    // Guards the parse: an empty or mis-split list would make the `.some` below false-y for
    // reasons that have nothing to do with the panel.
    expect(selectors).toContain('#sidebar');
    expect(selectors.some((selector) => panel().matches(selector))).toBe(true);
  });

  // The collapsed rail is 5rem, matching the Material navigation rail Google Photos uses.
  // This has to stay in lockstep with UserPageLayout's `rail` grid column (spacing * 20): the
  // panel is absolutely positioned inside the nav, so a wider panel would overhang the column
  // and a narrower one would leave a strip of bare page showing through.
  it('sizes the collapsed rail to the navigation-rail width', () => {
    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-expanded', 'false');
    expect(panel().className).toContain('w-20');
  });

  // Rows centre their icons with a fixed start padding, which only lands on the rail's middle
  // if it is measured from the rail's own edge. So nothing may sit in front of it: no padding
  // on the panel, and no start-side gutter. `both-edges` did exactly that and put every icon
  // ~8px left of centre - the reservation is the platform's scrollbar width (11px here, ~4px
  // with macOS overlay scrollbars), so no fixed padding can compensate for it.
  it('leaves the panel start edge clear so the rows can centre against it', () => {
    render(SidebarShell);

    expect(panel().className).not.toMatch(/\b(?:ps|pe|px)-\d/);
    const gutters = themeSelectorsDeclaring('scrollbar-gutter: stable both-edges');
    expect(gutters.some((selector) => panel().matches(selector))).toBe(false);
  });

  // No gutter on the panel either, and this one is about the other end. The rows inset their
  // pills with their own symmetric margin; a reserved gutter stacks on top of that at the end
  // only, so the pill would sit 0.75rem from the start edge and 0.75rem + a scrollbar from the
  // end - lopsided again, and worse wherever scrollbars are classic rather than overlay.
  // Without the reservation a scrollbar just narrows the panel's content box, so the pill keeps
  // its 0.75rem from whichever edge it meets. `#sidebar` must keep the rule regardless: /tags
  // and /folders opt out of the rail and still render upstream Sidebar.svelte, where the nav
  // itself is the scroller and the rows have no margin of their own.
  it('leaves the panel end edge to the scrollbar rather than reserving a gutter', () => {
    render(SidebarShell);

    const selectors = themeSelectorsDeclaring('scrollbar-gutter: stable');
    expect(selectors).toContain('#sidebar');
    expect(panel().className).toContain('overflow-y-auto');
    expect(selectors.some((selector) => panel().matches(selector))).toBe(false);
  });

  // A collapsed rail overflows readily - a long Spaces/Albums list runs past the viewport even
  // as bare icons - but its scrollbar is unusable, because reaching for it expands the rail:
  // the bar the pointer was aimed at is replaced by a 16rem panel before the drag can start.
  // Only the paint is dropped, never the overflow. `scrollbar-hidden` is `scrollbar-width: none`,
  // so the panel stays a scroll container and tabbing to a row below the fold still scrolls it
  // into view - `overflow-y-hidden` would have taken that away. classList tokens rather than a
  // substring: `immich-scrollbar` and `scrollbar-hidden` share a stem.
  it('hides the scrollbar while collapsed without making the panel unscrollable', () => {
    render(SidebarShell);

    expect(nav()).toHaveAttribute('data-expanded', 'false');
    expect(panel().classList.contains('scrollbar-hidden')).toBe(true);
    expect(panel().classList.contains('immich-scrollbar')).toBe(false);
    expect(panel().className).toContain('overflow-y-auto');
  });

  // The other half of that pair. At full width the pointer is already inside the panel and the
  // bar is a target it can actually hit, so it comes back. Both routes to full width are
  // asserted - transient hover and the permanently-expanded layout - because they reach it
  // through different conditions and a fix keyed to only one of them would leave the other bare.
  it('restores the scrollbar once the panel is at full width', async () => {
    render(SidebarShell);

    await fireEvent.pointerEnter(nav());

    expect(nav()).toHaveAttribute('data-expanded', 'true');
    expect(panel().classList.contains('immich-scrollbar')).toBe(true);
    expect(panel().classList.contains('scrollbar-hidden')).toBe(false);

    sidebarModeStore.mode = 'expanded';
    await tick();

    expect(nav()).toHaveAttribute('data-layout', 'expanded');
    expect(panel().classList.contains('immich-scrollbar')).toBe(true);
    expect(panel().classList.contains('scrollbar-hidden')).toBe(false);
  });

  // Spec coverage 22. Assert the pairing, not just the opt-out: a bare
  // `motion-reduce:transition-none` with nothing to suppress would be dead markup.
  it('opts out of the width transition under reduced motion', () => {
    render(SidebarShell);

    expect(panel().className).toContain('transition-[width]');
    expect(panel().className).toContain('motion-reduce:transition-none');
  });
});
