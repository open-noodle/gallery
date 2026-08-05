import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import type { FilterSection } from '../filter-panel';
import FilterSectionMenu from '../filter-section-menu.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const SECTIONS: FilterSection[] = ['timeline', 'people', 'location'];

const TITLES = { timeline: 'Timeline', people: 'People', location: 'Location' };

// Mirrors filter-panel.svelte's own `sectionToggleLabels`, which deliberately differs from the
// visible title for one section so browser automation cannot confuse it with the asset action.
const TOGGLE_LABELS = { ...TITLES, people: 'People filter section' };

function renderMenu(overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const onShowAll = vi.fn();
  const result = render(FilterSectionMenu, {
    props: {
      sections: SECTIONS,
      visible: new Set<FilterSection>(SECTIONS),
      titles: TITLES,
      toggleLabels: TOGGLE_LABELS,
      hasActiveFilter: () => false,
      onToggle,
      onShowAll,
      ...overrides,
    },
  });
  return { ...result, onToggle, onShowAll };
}

const cog = () => screen.getByTestId('section-menu-btn');
const openMenu = () => fireEvent.click(cog());

describe('filter-section-menu', () => {
  it('renders a closed cog and no list', () => {
    renderMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('section-menu')).toBeNull();
  });

  // svelte-i18n returns the key itself for a missing translation, so without this a typo'd or
  // unregistered key would leave the cog's only accessible name as "filter_manage_sections" and
  // every other test here would still pass.
  it('names the cog from a real translation', () => {
    renderMenu();

    expect(cog()).toHaveAccessibleName('Show or hide sections');
  });

  it('opens on click with one row per configured section', async () => {
    renderMenu();

    await openMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('section-menu')).toBeTruthy();
    for (const section of SECTIONS) {
      expect(screen.getByTestId(`section-toggle-${section}`)).toBeTruthy();
    }
    // The words are the point of the whole change - assert the visible label, not just the row.
    expect(screen.getByTestId('section-toggle-timeline')).toHaveTextContent('Timeline');
  });

  it('drives each row from the visible prop rather than local state', async () => {
    renderMenu({ visible: new Set<FilterSection>(['timeline']) });

    await openMenu();

    expect(screen.getByTestId('section-toggle-timeline')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps a row accessible name that differs from its visible title', async () => {
    renderMenu();

    await openMenu();

    expect(screen.getByTestId('section-toggle-people')).toHaveAttribute('aria-label', 'People filter section');
  });

  // The wrapper carries clickOutside, whose onOutclick early-returns for clicks inside it. If that
  // guard ever stopped working a row click would fire onToggle AND close the menu.
  it('calls onToggle once per row click', async () => {
    const { onToggle } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));

    expect(onToggle).toHaveBeenCalledExactlyOnceWith('people');
  });

  // The premise of the whole design: hiding three sections is three clicks.
  it('stays open across consecutive row clicks', async () => {
    const { onToggle } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-location'));

    expect(screen.getByTestId('section-menu')).toBeTruthy();
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('closes on a second cog click', async () => {
    renderMenu();

    await openMenu();
    await openMenu();

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  // clickOutside listens for mousedown on document, not click.
  it('closes on an outside mousedown', async () => {
    renderMenu();

    await openMenu();
    await fireEvent.mouseDown(document.body);

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to the cog', async () => {
    renderMenu();

    await openMenu();
    const row = screen.getByTestId('section-toggle-people');
    row.focus();
    await fireEvent.keyDown(row, { key: 'Escape' });

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(cog());
  });

  // Why clickOutside sits on a wrapper enclosing the cog, not on the popover: the action binds
  // keydown to its own node, so on the popover alone this case would do nothing.
  it('closes on Escape while focus is on the cog itself', async () => {
    renderMenu();

    await openMenu();
    cog().focus();
    await fireEvent.keyDown(cog(), { key: 'Escape' });

    expect(cog()).toHaveAttribute('aria-expanded', 'false');
  });

  it('calls onShowAll once', async () => {
    const { onShowAll } = renderMenu();

    await openMenu();
    await fireEvent.click(screen.getByTestId('section-menu-show-all'));

    expect(onShowAll).toHaveBeenCalledOnce();
  });

  it('marks only hidden rows that still hold an active filter', async () => {
    renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    await openMenu();

    expect(screen.getByTestId('section-toggle-dot-people')).toBeTruthy();
    // Hidden but not filtering.
    expect(screen.queryByTestId('section-toggle-dot-location')).toBeNull();
  });

  it('marks a filtering section that is still visible with no dot', async () => {
    renderMenu({
      visible: new Set<FilterSection>(SECTIONS),
      hasActiveFilter: () => true,
    });

    await openMenu();

    expect(screen.queryByTestId('section-toggle-dot-people')).toBeNull();
  });

  // The dot's entire purpose is being visible while the menu is shut.
  it('shows a dot on the cog when any hidden section is filtering, without opening', () => {
    renderMenu({
      visible: new Set<FilterSection>(['timeline']),
      hasActiveFilter: (section: FilterSection) => section === 'people',
    });

    expect(screen.getByTestId('section-menu-dot')).toBeTruthy();
  });

  it('shows no dot on the cog when every filtering section is visible', () => {
    renderMenu({ visible: new Set<FilterSection>(SECTIONS), hasActiveFilter: () => true });

    expect(screen.queryByTestId('section-menu-dot')).toBeNull();
  });
});
