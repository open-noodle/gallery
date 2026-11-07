import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { FilterSection } from '../filter-panel';
import FilterSectionMenu from '../filter-section-menu.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const SECTIONS: FilterSection[] = ['timeline', 'people', 'location'];

const TITLES = { timeline: 'Timeline', people: 'People', location: 'Location' };

// Mirrors filter-panel.svelte's own `sectionToggleLabels`, which deliberately differs from the
// visible title for one section so browser automation cannot confuse it with the asset action.
const TOGGLE_LABELS = { ...TITLES, people: 'People filter section' };

async function renderMenu(overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const onShowAll = vi.fn();
  const result = await render(FilterSectionMenu, {
    sections: SECTIONS,
    visible: new Set<FilterSection>(SECTIONS),
    titles: TITLES,
    toggleLabels: TOGGLE_LABELS,
    hasActiveFilter: () => false,
    onToggle,
    onShowAll,
    ...overrides,
  });
  return { ...result, onToggle, onShowAll };
}

const cog = () => page.getByTestId('section-menu-btn');
const openMenu = () => cog().click();

describe('filter-section-menu', () => {
  it('renders a closed cog and no list', async () => {
    await renderMenu();

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(page.getByTestId('section-menu').query()).toBeNull();
  });

  // svelte-i18n returns the key itself for a missing translation, so without this a typo'd or
  // unregistered key would leave the cog's only accessible name as "filter_manage_sections" and
  // every other test here would still pass.
  it('names the cog from a real translation', async () => {
    await renderMenu();

    await expect.element(cog()).toHaveAccessibleName('Show or hide sections');
  });

  it('opens on click with one row per configured section', async () => {
    await renderMenu();

    await openMenu();

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'true');
    await expect.element(page.getByTestId('section-menu')).toBeInTheDocument();
    for (const section of SECTIONS) {
      await expect.element(page.getByTestId(`section-toggle-${section}`)).toBeInTheDocument();
    }
    // The words are the point of the whole change - assert the visible label, not just the row.
    await expect.element(page.getByTestId('section-toggle-timeline')).toHaveTextContent('Timeline');
  });

  it('drives each row from the visible prop rather than local state', async () => {
    await renderMenu({ visible: new Set<FilterSection>(['timeline']) });

    await openMenu();

    await expect.element(page.getByTestId('section-toggle-timeline')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a row accessible name that differs from its visible title', async () => {
    await renderMenu();

    await openMenu();

    await expect
      .element(page.getByTestId('section-toggle-people'))
      .toHaveAttribute('aria-label', 'People filter section');
  });

  // The wrapper carries clickOutside, whose onOutclick early-returns for clicks inside it. If that
  // guard ever stopped working a row click would fire onToggle AND close the menu.
  it('calls onToggle once per row click', async () => {
    const { onToggle } = await renderMenu();

    await openMenu();
    await page.getByTestId('section-toggle-people').click();

    expect(onToggle).toHaveBeenCalledExactlyOnceWith('people');
  });

  // The premise of the whole design: hiding three sections is three clicks.
  it('stays open across consecutive row clicks', async () => {
    const { onToggle } = await renderMenu();

    await openMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-location').click();

    await expect.element(page.getByTestId('section-menu')).toBeInTheDocument();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('closes on a second cog click', async () => {
    await renderMenu();

    await openMenu();
    await openMenu();

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  // clickOutside listens for mousedown on document, not click.
  it('closes on an outside mousedown', async () => {
    await renderMenu();

    await openMenu();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to the cog', async () => {
    await renderMenu();

    await openMenu();
    (page.getByTestId('section-toggle-people').element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(cog().element());
  });

  // Why clickOutside sits on a wrapper enclosing the cog, not on the popover: the action binds
  // keydown to its own node, so on the popover alone this case would do nothing.
  it('closes on Escape while focus is on the cog itself', async () => {
    await renderMenu();

    await openMenu();
    (cog().element() as HTMLElement).focus();
    await userEvent.keyboard('{Escape}');

    await expect.element(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onShowAll once', async () => {
    const { onShowAll } = await renderMenu();

    await openMenu();
    await page.getByTestId('section-menu-show-all').click();

    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('marks only hidden rows that still hold an active filter', async () => {
    await renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    await openMenu();

    await expect.element(page.getByTestId('section-toggle-dot-people')).toBeInTheDocument();
    // Hidden but not filtering.
    expect(page.getByTestId('section-toggle-dot-location').query()).toBeNull();
  });

  it('marks a filtering section that is still visible with no dot', async () => {
    await renderMenu({
      visible: new Set<FilterSection>(SECTIONS),
      hasActiveFilter: () => true,
    });

    await openMenu();

    expect(page.getByTestId('section-toggle-dot-people').query()).toBeNull();
  });

  // The dot's entire purpose is being visible while the menu is shut.
  it('shows a dot on the cog when any hidden section is filtering, without opening', async () => {
    await renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    await expect.element(page.getByTestId('section-menu-dot')).toBeInTheDocument();
  });

  it('shows no dot on the cog when every filtering section is visible', async () => {
    await renderMenu({ visible: new Set<FilterSection>(SECTIONS), hasActiveFilter: () => true });

    expect(page.getByTestId('section-menu-dot').query()).toBeNull();
  });
});
