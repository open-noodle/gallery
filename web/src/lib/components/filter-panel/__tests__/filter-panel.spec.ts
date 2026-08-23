import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { tick } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import type { FilterPanelConfig, FilterSection } from '../filter-panel';
import { ALL_FILTER_SECTIONS, createFilterState } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

beforeAll(async () => {
  register('en-US', () => import('$i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('FilterPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders an expanded section with no surface fill or hard divider', () => {
    const { getByTestId } = render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
    });
    const section = getByTestId('filter-section-timeline');
    expect(section.className).not.toContain('bg-subtle');
    expect(section.className).not.toContain('border-b');
  });

  it('should render configured sections only', () => {
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: {
          sections: ['people', 'rating'],
          providers: {},
        },
        timeBuckets: [],
      },
    });
    expect(queryByTestId('filter-section-people')).toBeTruthy();
    expect(queryByTestId('filter-section-rating')).toBeTruthy();
    expect(queryByTestId('filter-section-location')).toBeNull();
    expect(queryByTestId('filter-section-camera')).toBeNull();
  });

  it('should hide sections not in config', () => {
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    expect(queryByTestId('filter-section-people')).toBeNull();
    expect(queryByTestId('filter-section-location')).toBeNull();
    expect(queryByTestId('filter-section-camera')).toBeNull();
    expect(queryByTestId('filter-section-tags')).toBeNull();
    expect(queryByTestId('filter-section-media')).toBeNull();
    expect(queryByTestId('filter-section-rating')).toBeTruthy();
  });

  it('should collapse to icon strip', async () => {
    const { getByTestId, queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['people', 'location'], providers: {} },
        timeBuckets: [],
      },
    });
    const collapseBtn = getByTestId('collapse-panel-btn');
    await fireEvent.click(collapseBtn);
    expect(queryByTestId('collapsed-icon-strip')).toBeTruthy();
    expect(queryByTestId('discovery-panel')).toBeNull();
  });

  it('should expand from collapsed state', async () => {
    const { getByTestId, queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['people'], providers: {} },
        timeBuckets: [],
      },
    });
    // Collapse first
    await fireEvent.click(getByTestId('collapse-panel-btn'));
    expect(queryByTestId('collapsed-icon-strip')).toBeTruthy();
    // Expand
    await fireEvent.click(getByTestId('expand-panel-btn'));
    expect(queryByTestId('discovery-panel')).toBeTruthy();
    expect(queryByTestId('collapsed-icon-strip')).toBeNull();
  });

  it('should update filters when month is clicked in timeline picker', async () => {
    const { getByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
      },
    });
    await fireEvent.click(getByTestId('year-btn-2023'));
    await fireEvent.click(getByTestId('month-btn-6'));
    await fireEvent.click(getByTestId('collapse-panel-btn'));
    expect(getByTestId('collapsed-icon-strip')).toBeTruthy();
  });

  it('should update filters when year is clicked in timeline picker', async () => {
    const { getByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
      },
    });
    await fireEvent.click(getByTestId('year-btn-2023'));
    expect(getByTestId('discovery-panel')).toBeTruthy();
  });

  it('should render with externally-provided filters state', () => {
    const filters = createFilterState();
    filters.mediaType = 'image';
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['media'], providers: {} },
        timeBuckets: [],
        filters,
      },
    });
    expect(queryByTestId('filter-section-media')).toBeTruthy();
  });

  it('should call onFiltersChange when filters are changed inside the panel', async () => {
    const onFiltersChange = vi.fn();

    render(FilterPanel, {
      props: {
        config: {
          sections: ['location'],
          providers: {
            locations: () => Promise.resolve([{ value: 'Germany', type: 'country' as const }]),
            cities: () => Promise.resolve([]),
          },
        },
        timeBuckets: [],
        onFiltersChange,
      },
    });

    await fireEvent.click(await screen.findByTestId('location-country-Germany'));

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ country: 'Germany', city: undefined }));
  });

  it('should update filters when has-no-album is selected', async () => {
    const onFiltersChange = vi.fn();

    render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        onFiltersChange,
      },
    });

    await fireEvent.click(screen.getByTestId('albums-none'));

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ isNotInAlbum: true }));
  });

  it('should show active state for has-no-album when collapsed', async () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
      },
    });

    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));

    expect(screen.getByTestId('collapsed-icon-strip').querySelector('.bg-immich-primary')).toBeTruthy();
  });

  it('should select has-album and clear has-no-album (mutual exclusivity)', async () => {
    const onFiltersChange = vi.fn();
    // Start with "Has no album" already active to prove selecting "Has album" clears it.
    const filters = { ...createFilterState(), isNotInAlbum: true };

    render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
        onFiltersChange,
      },
    });

    await fireEvent.click(screen.getByTestId('albums-has'));

    const updated = onFiltersChange.mock.calls.at(-1)![0];
    expect(updated.isInAlbum).toBe(true);
    expect(updated.isNotInAlbum).toBeUndefined();
  });

  it('should show active state for has-album when collapsed', async () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
      },
    });

    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));

    expect(screen.getByTestId('collapsed-icon-strip').querySelector('.bg-immich-primary')).toBeTruthy();
  });

  it('should work without onFiltersChange callback', () => {
    const { queryByTestId } = render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    expect(queryByTestId('filter-section-rating')).toBeTruthy();
  });

  describe('collapsed state persistence', () => {
    const COLLAPSED_KEY = 'gallery-filter-collapsed';

    beforeEach(() => {
      localStorage.clear();
    });

    it('should start expanded when no localStorage entry exists (first visit)', () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['rating', 'media'], providers: {} },
          timeBuckets: [],
        },
      });
      expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
      expect(screen.queryByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
    });

    it('should start collapsed when localStorage has true', () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      render(FilterPanel, {
        props: {
          config: { sections: ['rating', 'media'], providers: {} },
          timeBuckets: [],
        },
      });
      expect(screen.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
      expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
    });

    it('should persist collapsed state to localStorage when user collapses', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
        },
      });
      await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
      expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(true);
    });

    it('should persist expanded state to localStorage when user expands', async () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
        },
      });
      await fireEvent.click(screen.getByTestId('expand-panel-btn'));
      expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(false);
    });

    it('should not persist collapsed state when persistCollapsed is false', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
      expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
    });

    it('should always start expanded when persistCollapsed is false regardless of localStorage', () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
    });

    it('should still allow in-session collapse when persistCollapsed is false', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
      expect(screen.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
      expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
      // But nothing written to localStorage
      expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
    });
  });

  it('animates the panel width via a persistent shell with a reduced-motion guard', async () => {
    const { getByTestId } = render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
    });
    const shell = getByTestId('filter-panel-shell');
    expect(shell.className).toContain('transition-[width]');
    expect(shell.className).toContain('motion-reduce:transition-none');
    expect(shell.className).toContain('w-64');

    await fireEvent.click(getByTestId('collapse-panel-btn'));
    expect(shell.className).toContain('w-12');
    expect(shell.className).not.toContain('w-64');
  });

  it('collapses to zero width in externalToggle mode (space reclaimed, still animatable)', async () => {
    const { getByTestId, queryByTestId } = render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [], externalToggle: true },
    });
    const shell = getByTestId('filter-panel-shell');
    expect(shell.className).toContain('w-64');

    await fireEvent.click(getByTestId('collapse-panel-btn'));

    // Stays mounted (so the width transition animates) but at w-0 — no built-in button, and the panel
    // content is inert while hidden. The page supplies its own header filter button.
    expect(shell.className).toContain('w-0');
    expect(shell.className).not.toContain('w-64');
    expect(queryByTestId('collapsed-icon-strip')).toBeNull();
    expect(getByTestId('discovery-panel').hasAttribute('inert')).toBe(true);
  });

  // Built-in collapse unmounts the panel body, taking any open menu with it. externalToggle does
  // not - the panel stays mounted at w-0, clipped and inert - so an open menu survives the
  // collapse and is still open on reopen unless it is explicitly closed.
  it('closes an open section menu when collapsed in externalToggle mode', async () => {
    const { rerender } = render(FilterPanel, {
      props: {
        config: { sections: ['timeline', 'people'], providers: {} },
        timeBuckets: [],
        externalToggle: true,
        collapsed: false,
      },
    });

    await fireEvent.click(screen.getByTestId('section-menu-btn'));
    expect(screen.getByTestId('section-menu')).toBeTruthy();

    await rerender({
      config: { sections: ['timeline', 'people'], providers: {} },
      timeBuckets: [],
      externalToggle: true,
      collapsed: true,
    });

    expect(screen.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
  });

  describe('emptyText prop', () => {
    it('should show generic empty text for people section when no people', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['people'], providers: { people: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId('people-empty')).toHaveTextContent('No people found');
      });
    });

    it('should show generic empty text for location section when no locations', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['location'], providers: { locations: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId('location-empty')).toHaveTextContent('No locations found');
      });
    });

    it('should show generic empty text for camera section when no cameras', async () => {
      render(FilterPanel, {
        props: {
          config: { sections: ['camera'], providers: { cameras: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await waitFor(() => {
        expect(screen.getByTestId('camera-empty')).toHaveTextContent('No cameras found');
      });
    });
  });

  it('keeps empty sections enabled when only a section-local filter is active (#858 §3.3)', async () => {
    // Only a camera make is set — a section-local dimension. The People section is empty but must
    // stay enabled, exactly as before #858 widened FilterContext.
    const filters = { ...createFilterState(), make: 'Canon' };
    const config: FilterPanelConfig = {
      sections: ['people', 'camera'],
      providers: {
        people: vi.fn().mockResolvedValue([]),
        cameras: vi.fn().mockResolvedValue([{ value: 'Canon', type: 'make' as const }]),
      },
    };

    render(FilterPanel, { props: { config, timeBuckets: [], filters } });

    await waitFor(() => {
      expect(screen.getByTestId('camera-make-Canon')).toBeTruthy();
    });

    const peopleButton = within(screen.getByTestId('filter-section-people')).getByRole('button');
    expect(peopleButton).not.toBeDisabled();
    expect(peopleButton.textContent).not.toContain('(0)');
  });
});

describe('hidden prop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should render nothing when hidden is true', () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
        hidden: true,
      },
    });
    expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });

  it('should render panel when hidden is false', () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        hidden: false,
      },
    });
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('should render panel by default when hidden is not provided', () => {
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    expect(screen.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('should render nothing when hidden and collapsed in localStorage', () => {
    localStorage.setItem('gallery-filter-collapsed', JSON.stringify(true));
    render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        hidden: true,
      },
    });
    expect(screen.queryByTestId('discovery-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });
});

describe('Section Selector', () => {
  const STORAGE_KEY = 'gallery-filter-visible-sections';
  const allSections: FilterSection[] = [
    'timeline',
    'people',
    'location',
    'camera',
    'tags',
    'rating',
    'media',
    'favorites',
  ];

  function renderPanel(sections: FilterSection[] = [...allSections], filters?: ReturnType<typeof createFilterState>) {
    return render(FilterPanel, {
      props: {
        config: { sections: [...sections], providers: {} },
        timeBuckets: sections.includes('timeline')
          ? [
              { timeBucket: '2023-06-01', count: 100 },
              { timeBucket: '2023-08-01', count: 200 },
            ]
          : [],
        ...(filters && { filters }),
      },
    });
  }

  // The section toggles now live inside the cog's popover, so anything that clicks or queries one
  // has to open it first.
  async function openSectionMenu() {
    await fireEvent.click(screen.getByTestId('section-menu-btn'));
  }

  beforeEach(() => {
    localStorage.clear();
  });

  // --- Rendering ---

  // The cog replaces the old icon row. It is gated exactly as that row was, on the page having
  // configured sections at all.
  it('renders the section cog when sections are configured', () => {
    renderPanel(['people', 'rating']);

    expect(screen.getByTestId('section-menu-btn')).toBeTruthy();
  });

  it('renders no section cog when the config has no sections', () => {
    renderPanel([]);

    expect(screen.queryByTestId('section-menu-btn')).toBeNull();
  });

  it('renders no section cog once the panel is collapsed', async () => {
    renderPanel(['people', 'rating']);

    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));

    expect(screen.queryByTestId('section-menu-btn')).toBeNull();
    expect(screen.getByTestId('collapsed-icon-strip')).toBeTruthy();
  });

  // Boundary of the gate: one section is still enough to warrant the control, and hiding it
  // leaves the panel on its empty state rather than blank.
  it('renders the cog for a single configured section and lands on the empty state when hidden', async () => {
    renderPanel(['people']);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));

    expect(screen.getByTestId('show-all-sections')).toBeTruthy();
  });

  // Two independent routes back from "everything hidden"; neither may shadow the other.
  it('restores every section from the menu reset', async () => {
    renderPanel(['people', 'rating']);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    await fireEvent.click(screen.getByTestId('section-menu-show-all'));

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  it('restores every section from the empty-state link', async () => {
    renderPanel(['people', 'rating']);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    await fireEvent.click(screen.getByTestId('show-all-sections'));

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  // Show all with nothing hidden must not toggle anything off, and must leave the menu usable.
  it('leaves everything visible when Show all is used with nothing hidden', async () => {
    renderPanel(['people', 'rating']);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-menu-show-all'));

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
    expect(screen.getByTestId('section-menu')).toBeTruthy();
  });

  // The toggles MOVED - they are not also still sitting in the header. Without this, leaving the old
  // row in place would satisfy every other test in this file: they all find a toggle either way, and
  // testing-library only throws on duplicate testids.
  it('keeps the section toggles out of the DOM until the menu is opened', async () => {
    renderPanel(['people', 'rating']);

    expect(screen.queryByTestId('section-toggle-people')).toBeNull();

    await openSectionMenu();

    expect(screen.getByTestId('section-toggle-people')).toBeTruthy();
  });

  // The aggregate dot is the only thing on screen saying "something is filtering out of sight" while
  // the menu is shut, so it is asserted with the menu closed. `personIds` is the field the existing
  // per-section dot tests at `:660-684` use.
  it('shows a dot on the cog when a hidden section still holds a filter', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    renderPanel(['people', 'rating'], filters);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.keyDown(screen.getByTestId('section-menu-btn'), { key: 'Escape' });

    expect(screen.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('section-menu-dot')).toBeTruthy();
  });

  it('shows no dot on the cog when the hidden section holds no filter', async () => {
    renderPanel(['people', 'rating']);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));

    expect(screen.queryByTestId('section-menu-dot')).toBeNull();
  });

  // Derived, not latched: showing the section again clears the cue.
  it('clears the cog dot when the hidden section is shown again', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    renderPanel(['people', 'rating'], filters);

    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('section-menu-dot')).toBeTruthy();

    await fireEvent.click(screen.getByTestId('section-toggle-people'));

    expect(screen.queryByTestId('section-menu-dot')).toBeNull();
  });

  it('should list every configured section in the menu', async () => {
    renderPanel();
    await openSectionMenu();
    for (const section of allSections) {
      expect(screen.getByTestId(`section-toggle-${section}`)).toBeTruthy();
    }
  });

  it('should keep favorites section toggle label distinct from asset favorite action', async () => {
    renderPanel(['favorites']);
    await openSectionMenu();

    const favoritesToggle = screen.getByTestId('section-toggle-favorites');
    expect(favoritesToggle).toHaveAttribute('aria-label', 'Starred filter section');
  });

  // Test 2
  it('should not render toggle icons for unconfigured sections', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    expect(screen.getByTestId('section-toggle-people')).toBeTruthy();
    expect(screen.getByTestId('section-toggle-rating')).toBeTruthy();
    expect(screen.queryByTestId('section-toggle-location')).toBeNull();
    expect(screen.queryByTestId('section-toggle-camera')).toBeNull();
    expect(screen.queryByTestId('section-toggle-tags')).toBeNull();
    expect(screen.queryByTestId('section-toggle-timeline')).toBeNull();
    expect(screen.queryByTestId('section-toggle-media')).toBeNull();
  });

  // Test 3
  it('should show all sections visible by default when no localStorage value', () => {
    renderPanel();
    for (const section of allSections) {
      expect(screen.getByTestId(`filter-section-${section}`)).toBeTruthy();
    }
  });

  // --- Toggle Interaction ---

  // Test 6
  it('should hide section from DOM when active icon is clicked', async () => {
    renderPanel();
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
  });

  // Test 7
  it('should restore section to DOM when inactive icon is clicked', async () => {
    renderPanel();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
  });

  // Test 8
  it('should not affect other sections when one is toggled', async () => {
    renderPanel();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.getByTestId('filter-section-location')).toBeTruthy();
    expect(screen.getByTestId('filter-section-camera')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  // Test 9
  it('should allow multiple sections to be hidden simultaneously', async () => {
    renderPanel();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-location'));
    await fireEvent.click(screen.getByTestId('section-toggle-camera'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.queryByTestId('filter-section-location')).toBeNull();
    expect(screen.queryByTestId('filter-section-camera')).toBeNull();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
    expect(screen.getByTestId('filter-section-tags')).toBeTruthy();
  });

  // Test 10
  it('should return to original state after rapid double-click', async () => {
    renderPanel();
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
  });

  // Test 11
  it('should trigger all-hidden state when single section is hidden', async () => {
    renderPanel(['rating']);
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    expect(screen.getByTestId('show-all-sections')).toBeTruthy();
  });

  // --- All-Hidden Empty State ---

  // Test 12
  it('should show empty state with "Show all" link when all sections hidden', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    expect(screen.getByTestId('show-all-sections')).toBeTruthy();
  });

  // Test 13
  it('should restore all sections when "Show all" is clicked', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    expect(screen.getByTestId('show-all-sections')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('show-all-sections'));
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
    expect(screen.queryByTestId('show-all-sections')).toBeNull();
  });

  // Test 14
  it('should update all toggle icons to active/pressed after "Show all"', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    await fireEvent.click(screen.getByTestId('show-all-sections'));
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('section-toggle-rating').getAttribute('aria-pressed')).toBe('true');
  });

  // --- Active-but-Hidden Indicator ---

  // Test 15
  it('should show dot indicator on hidden section with active filter', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    renderPanel(['people', 'rating'], filters);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('section-toggle-dot-people')).toBeTruthy();
  });

  // Test 16
  it('should not show dot indicator on hidden section without active filter', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.queryByTestId('section-toggle-dot-people')).toBeNull();
  });

  // Test 17
  it('should show dot on timeline section with selectedYear when hidden', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2023;
    renderPanel(['timeline', 'rating'], filters);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-timeline'));
    expect(screen.getByTestId('section-toggle-dot-timeline')).toBeTruthy();
  });

  // --- Accessibility ---

  // Test 18
  it('should set aria-pressed="true" on visible section toggle icons', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('section-toggle-rating').getAttribute('aria-pressed')).toBe('true');
  });

  // Test 19
  it('should set aria-pressed="false" on hidden section toggle icons', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('section-toggle-rating').getAttribute('aria-pressed')).toBe('true');
  });

  // Test 20
  it('should update aria-pressed correctly after toggle click', async () => {
    renderPanel(['people']);
    await openSectionMenu();
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.getByTestId('section-toggle-people').getAttribute('aria-pressed')).toBe('true');
  });

  // --- localStorage Persistence ---

  // Test 21
  it('should write updated visibility to localStorage when section is toggled', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).toContain('rating');
    expect(stored.selected).not.toContain('people');
  });

  // Test 22
  it('should read localStorage on mount and restore visibility', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['rating']));
    renderPanel(['people', 'rating']);
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  it('should add favorites to legacy visible-section preferences without unhiding known hidden sections', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people']));

    renderPanel(['people', 'rating', 'favorites']);

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-favorites')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
  });

  it('should add favorites to empty legacy visible-section preferences without unhiding all known sections', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));

    renderPanel(['people', 'rating', 'favorites']);

    expect(screen.getByTestId('filter-section-favorites')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
  });

  it('should fall back to all visible when legacy visible-section preferences only contain unknown sections', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['obsolete-section']));

    renderPanel(['people', 'rating', 'favorites']);

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
    expect(screen.getByTestId('filter-section-favorites')).toBeTruthy();
  });

  it('should add sections missing from stored known-section metadata without unhiding known hidden sections', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selected: ['people'],
        known: ['people', 'rating', 'favorites'],
      }),
    );

    renderPanel(['people', 'rating', 'favorites', 'media']);

    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-media')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    expect(screen.queryByTestId('filter-section-favorites')).toBeNull();
  });

  // #802 upgrade path: a returning Map user already has a stored section set whose `known` list
  // is the pre-fix nine. The fix only reaches them if 'text' is treated as newly introduced — and
  // it must not silently un-hide sections they deliberately turned off.
  describe('#802 text section upgrade path', () => {
    const PRE_FIX_MAP_SECTIONS: FilterSection[] = [
      'timeline',
      'people',
      'location',
      'camera',
      'tags',
      'rating',
      'media',
      'favorites',
      'albums',
    ];

    it('reveals the newly introduced text section to a user with a pre-fix stored set', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: [...PRE_FIX_MAP_SECTIONS], known: [...PRE_FIX_MAP_SECTIONS] }),
      );

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.getByTestId('filter-section-text')).toBeTruthy();
    });

    it('reveals the text section without un-hiding sections the user deliberately hid', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: ['timeline', 'people'], known: [...PRE_FIX_MAP_SECTIONS] }),
      );

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.getByTestId('filter-section-text')).toBeTruthy();
      expect(screen.getByTestId('filter-section-people')).toBeTruthy();
      expect(screen.queryByTestId('filter-section-camera')).toBeNull();
      expect(screen.queryByTestId('filter-section-albums')).toBeNull();
    });

    it('shows every section to a user who has never opened the panel', () => {
      renderPanel([...ALL_FILTER_SECTIONS]);

      for (const section of ALL_FILTER_SECTIONS) {
        expect(screen.getByTestId(`filter-section-${section}`)).toBeTruthy();
      }
    });

    it('does not re-introduce the text section once the user has hidden it post-fix', () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          selected: ALL_FILTER_SECTIONS.filter((section) => section !== 'text'),
          known: [...ALL_FILTER_SECTIONS],
        }),
      );

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.queryByTestId('filter-section-text')).toBeNull();
    });
  });

  // #797: two people on the same version saw different filter category lists. Which sections a
  // user sees is a per-browser ledger, and it could silently diverge from the app's section list.
  describe('#797 stored-ledger divergence', () => {
    // What a browser stored before #447 replaced the bare array with { selected, known }: the
    // sections that existed at the time. Everything added since must still be revealed.
    const PRE_LEDGER_STORED: FilterSection[] = ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'];

    it('reveals every section added since the ledger format to a browser on legacy storage', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(PRE_LEDGER_STORED));

      renderPanel([...ALL_FILTER_SECTIONS]);

      for (const section of ALL_FILTER_SECTIONS) {
        expect(screen.getByTestId(`filter-section-${section}`)).toBeTruthy();
      }
    });

    it('reveals sections added since the ledger without un-hiding ones hidden back then', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['timeline', 'people']));

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.getByTestId('filter-section-favorites')).toBeTruthy();
      expect(screen.getByTestId('filter-section-albums')).toBeTruthy();
      expect(screen.getByTestId('filter-section-text')).toBeTruthy();
      expect(screen.queryByTestId('filter-section-camera')).toBeNull();
      expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    });

    // Album detail and the album asset picker share one storage key but offer different section
    // lists (detail drops 'albums'). Visiting detail must not erase the picker's record.
    it('keeps a hidden section hidden after a surface that does not offer it rewrites the ledger', async () => {
      const picker = renderPanel([...ALL_FILTER_SECTIONS]);
      await openSectionMenu();
      await fireEvent.click(screen.getByTestId('section-toggle-albums'));
      picker.unmount();

      const detail = renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));
      await tick();
      detail.unmount();

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.queryByTestId('filter-section-albums')).toBeNull();
    });

    it('keeps a visible section visible after a surface that does not offer it rewrites the ledger', async () => {
      const detail = renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));
      await openSectionMenu();
      await fireEvent.click(screen.getByTestId('section-toggle-camera'));
      detail.unmount();

      renderPanel([...ALL_FILTER_SECTIONS]);

      expect(screen.getByTestId('filter-section-albums')).toBeTruthy();
      expect(screen.queryByTestId('filter-section-camera')).toBeNull();
    });

    it('offers to show all sections when every section this surface renders is hidden', async () => {
      const picker = renderPanel([...ALL_FILTER_SECTIONS]);
      await openSectionMenu();
      for (const section of ALL_FILTER_SECTIONS) {
        if (section !== 'albums') {
          await fireEvent.click(screen.getByTestId(`section-toggle-${section}`));
        }
      }
      picker.unmount();

      renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));

      expect(screen.getByTestId('show-all-sections')).toBeTruthy();
    });
  });

  // Test 23
  it('should show only stored sections when localStorage has partial list', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people']));
    renderPanel();
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    expect(screen.queryByTestId('filter-section-location')).toBeNull();
  });

  // Test 24
  it('should ignore stale/unknown section names in localStorage', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people', 'nonexistent', 'foobar']));
    renderPanel(['people', 'rating']);
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
  });

  // Test 25
  it('should fall back to all-visible default when localStorage has invalid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
    renderPanel(['people', 'rating']);
    expect(screen.getByTestId('filter-section-people')).toBeTruthy();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  // Test 26
  it('should use the correct localStorage key', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem('some-other-key')).toBeNull();
  });

  // --- State Preservation ---

  // Test 27
  it('should preserve visibility state across panel collapse/expand cycle', async () => {
    renderPanel(['people', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-people'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();

    // Collapse
    await fireEvent.click(screen.getByTestId('collapse-panel-btn'));
    expect(screen.getByTestId('collapsed-icon-strip')).toBeTruthy();

    // Expand
    await fireEvent.click(screen.getByTestId('expand-panel-btn'));
    expect(screen.queryByTestId('filter-section-people')).toBeNull();
    expect(screen.getByTestId('filter-section-rating')).toBeTruthy();
  });

  // Test 28
  it('should still allow filter interactions on visible sections (regression)', async () => {
    renderPanel(['timeline', 'rating']);
    await openSectionMenu();
    await fireEvent.click(screen.getByTestId('section-toggle-rating'));
    expect(screen.queryByTestId('filter-section-rating')).toBeNull();
    // Timeline should still work
    expect(screen.getByTestId('filter-section-timeline')).toBeTruthy();
    await fireEvent.click(screen.getByTestId('year-btn-2023'));
    expect(screen.getByTestId('filter-section-timeline')).toBeTruthy();
  });
});

describe('Section Accordion Persistence', () => {
  const EXPANDED_KEY = 'gallery-filter-expanded-sections';

  beforeEach(() => {
    localStorage.clear();
  });

  function renderPanel(
    sections: FilterSection[] = ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'],
  ) {
    return render(FilterPanel, {
      props: {
        config: { sections: [...sections], providers: {} },
        timeBuckets: sections.includes('timeline')
          ? [
              { timeBucket: '2023-06-01', count: 100 },
              { timeBucket: '2023-08-01', count: 200 },
            ]
          : [],
      },
    });
  }

  it('should default all sections to expanded on first visit', () => {
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
  });

  it('should persist collapsed section to localStorage when header is clicked', async () => {
    renderPanel(['people', 'rating']);
    const peopleHeader = screen.getByTestId('filter-section-people').querySelector('button')!;
    await fireEvent.click(peopleHeader);
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).not.toContain('people');
    expect(stored.selected).toContain('rating');
  });

  it('should restore collapsed sections from localStorage on mount', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeNull();
    expect(ratingContent).toBeTruthy();
  });

  it('should expand favorites for legacy expanded-section preferences without expanding known collapsed sections', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['people']));

    renderPanel(['people', 'rating', 'favorites']);

    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    const favoritesContent = screen.getByTestId('filter-section-favorites').querySelector('.filter-section-content');

    expect(peopleContent).toBeTruthy();
    expect(favoritesContent).toBeTruthy();
    expect(ratingContent).toBeNull();
  });

  it('should fall back to all expanded when legacy expanded-section preferences only contain unknown sections', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['obsolete-section']));

    renderPanel(['people', 'rating', 'favorites']);

    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    const favoritesContent = screen.getByTestId('filter-section-favorites').querySelector('.filter-section-content');

    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
    expect(favoritesContent).toBeTruthy();
  });

  it('should expand newly introduced sections from stored known-section metadata', () => {
    localStorage.setItem(
      EXPANDED_KEY,
      JSON.stringify({
        selected: ['people'],
        known: ['people', 'rating', 'favorites'],
      }),
    );

    renderPanel(['people', 'rating', 'favorites', 'media']);

    const mediaContent = screen.getByTestId('filter-section-media').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    const favoritesContent = screen.getByTestId('filter-section-favorites').querySelector('.filter-section-content');

    expect(mediaContent).toBeTruthy();
    expect(ratingContent).toBeNull();
    expect(favoritesContent).toBeNull();
  });

  it('should keep all sections collapsed when localStorage has empty array', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([]));
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeNull();
    expect(ratingContent).toBeNull();
  });

  it('should ignore unknown section types in localStorage', () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['people', 'nonexistent']));
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
  });

  it('should fall back to all-expanded when localStorage has invalid JSON', () => {
    localStorage.setItem(EXPANDED_KEY, 'not-valid-json!!!');
    renderPanel(['people', 'rating']);
    const peopleContent = screen.getByTestId('filter-section-people').querySelector('.filter-section-content');
    const ratingContent = screen.getByTestId('filter-section-rating').querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
  });

  it('should expand a collapsed section when header is clicked again', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    renderPanel(['people', 'rating']);
    const peopleHeader = screen.getByTestId('filter-section-people').querySelector('button')!;
    await fireEvent.click(peopleHeader);
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).toContain('people');
    expect(stored.selected).toContain('rating');
  });

  describe('text filter section', () => {
    it('renders the text section with three inputs when configured', () => {
      const { getByTestId } = render(FilterPanel, {
        props: { config: { sections: ['text'], providers: {} }, timeBuckets: [] },
      });

      expect(getByTestId('filter-section-text')).toBeTruthy();
      expect(getByTestId('text-filter-description')).toBeTruthy();
      expect(getByTestId('text-filter-filename')).toBeTruthy();
      expect(getByTestId('text-filter-ocr')).toBeTruthy();
    });

    it('does not render the text section when not configured', () => {
      const { queryByTestId } = render(FilterPanel, {
        props: { config: { sections: ['rating'], providers: {} }, timeBuckets: [] },
      });

      expect(queryByTestId('filter-section-text')).toBeNull();
    });

    it('emits onFiltersChange with the typed description after the debounce', async () => {
      vi.useFakeTimers();
      try {
        const onFiltersChange = vi.fn();
        const { getByTestId } = render(FilterPanel, {
          props: { config: { sections: ['text'], providers: {} }, timeBuckets: [], onFiltersChange },
        });

        await fireEvent.input(getByTestId('text-filter-description'), { target: { value: 'beach' } });
        vi.advanceTimersByTime(300);

        expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ description: 'beach' }));
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

const availableEverything = {
  countries: ['Germany'],
  cameraMakes: ['Canon'],
  tags: [{ id: 't', name: 'Tag' }],
  people: [{ id: 'p', name: 'Alice' }],
  ratings: [5],
  mediaTypes: ['IMAGE', 'VIDEO'],
  hasUnnamedPeople: false,
  hasFavorites: true,
  hasAssetsInAlbum: true,
  hasAssetsNotInAlbum: true,
};

describe('section availability (#910)', () => {
  // Real timers race the unified effect's setTimeout debounce against `render`/`rerender`'s
  // microtask-only flush (`Svelte.tick()`): a rerender can synchronously cancel-and-reschedule a
  // pending 0ms fetch before it ever gets a macrotask turn to fire, silently dropping it. Fake timers
  // plus an explicit `advanceTimersByTimeAsync` after every render/rerender make each fetch
  // deterministic, matching every sibling test in unified-suggestions.spec.ts. Note `waitFor` does NOT
  // self-advance Vitest's fake clock, so the state must already be correct before a `waitFor` runs —
  // it is kept below only as a defensive assertion wrapper, not as the thing doing the waiting.
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hides a structurally unavailable section and its toggle', async () => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    // The sibling assertion matters: without it a panel that rendered nothing would pass.
    await waitFor(() => expect(screen.getByTestId('filter-section-media')).toBeInTheDocument());
    expect(screen.queryByTestId('filter-section-rating')).not.toBeInTheDocument();

    // The section toggles live inside the cog's popover, so it has to be opened to see them.
    await fireEvent.click(screen.getByTestId('section-menu-btn'));
    expect(screen.queryByTestId('section-toggle-rating')).not.toBeInTheDocument();
    expect(screen.getByTestId('section-toggle-media')).toBeInTheDocument();
  });

  it('greys a section the current filters emptied, rather than hiding it', async () => {
    // `favorites` (not `tags`, despite the brief's literal example — see task-2-report.md): `tags`
    // already has a *pre-#910* legacy count formula (`filterContext ? ... tags.length ...` a few
    // lines down) that reads the same `tags` state this fetch also updates, and `filterContext`
    // includes `personIds`. So rerendering with a person filter would grey the tags section via that
    // OLD #858 code path too, passing this test even against pre-#910 code and defeating it as a
    // regression guard. `favorites` has no such legacy formula, so greying it can only come from the
    // new `availability`-driven `count` branch.
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce(availableEverything)
      .mockResolvedValue({ ...availableEverything, hasFavorites: false });
    const config = { sections: ['favorites', 'media'] as FilterSection[], suggestionsProvider };
    const filters = { ...createFilterState() };

    const { rerender } = render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(1));

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    // Discrete (non-temporal) filter changes debounce at 50ms.
    await vi.advanceTimersByTimeAsync(50);

    await waitFor(() => {
      // getAllByRole, not getByRole: the section was open before this fetch, so its collapse plays
      // an outro transition — the now-stale content (with its own buttons) can still be in the DOM,
      // marked inert, at the instant this assertion runs. The header button is always rendered first.
      const [button] = within(screen.getByTestId('filter-section-favorites')).getAllByRole('button');
      expect(button).toBeDisabled();
      expect(button.textContent).toContain('(0)');
    });
  });

  it('never writes availability into the stored ledger', async () => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    render(FilterPanel, { props: { config, timeBuckets: [], storageKey: 'test-key' } });
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(screen.getByTestId('filter-section-media')).toBeInTheDocument());

    const stored = JSON.parse(localStorage.getItem('test-key')!);
    // Both halves matter: `selected` keeps it un-hidden, `known` keeps PR #926 from re-introducing it
    // as a brand-new section on the next load.
    expect(stored.selected).toContain('rating');
    expect(stored.known).toContain('rating');
  });

  it('shows a section again once its facet comes back', async () => {
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce({ ...availableEverything, ratings: [] })
      .mockResolvedValue(availableEverything);
    const config = { sections: ['rating', 'media'] as FilterSection[], suggestionsProvider };
    const filters = { ...createFilterState() };

    const { rerender } = render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(screen.queryByTestId('filter-section-rating')).not.toBeInTheDocument());

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    await vi.advanceTimersByTimeAsync(50);

    await waitFor(() => expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument());
  });

  it('calls baselineProvider once when it mounts with filters applied', async () => {
    const suggestionsProvider = vi.fn().mockResolvedValue(availableEverything);
    const baselineProvider = vi.fn().mockResolvedValue(availableEverything);
    const config = { sections: ['rating'] as FilterSection[], suggestionsProvider, baselineProvider };

    render(FilterPanel, { props: { config, timeBuckets: [], filters: { ...createFilterState(), rating: 5 } } });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(baselineProvider).toHaveBeenCalledTimes(1));
    // The baseline is a SEPARATE hook, never a second suggestionsProvider call: spec §4.5 explains
    // why reusing the provider corrupts the query-mode pages.
    expect(suggestionsProvider).toHaveBeenCalledTimes(1);
  });

  it('calls no baseline provider when it mounts clean', async () => {
    const suggestionsProvider = vi.fn().mockResolvedValue(availableEverything);
    const baselineProvider = vi.fn().mockResolvedValue(availableEverything);
    const config = { sections: ['rating'] as FilterSection[], suggestionsProvider, baselineProvider };

    render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(1));
    // Give any stray request time to land before asserting it did not. The clean-mount response IS
    // the baseline, so a second call would be pure waste.
    await vi.advanceTimersByTimeAsync(100);
    expect(baselineProvider).not.toHaveBeenCalled();
  });

  // The filter is on `people`, NOT on `rating`. That distinction is the whole test: with the filter
  // on the section under assertion, hasActiveFilter short-circuits to 'available' before the code
  // ever reads `baseline`, and the test passes whether or not the failure path works at all.
  it.each([
    ['rejects', () => Promise.reject(new Error('baseline failed'))],
    ['resolves undefined', () => Promise.resolve(undefined)],
  ])('hides nothing when the baseline provider %s', async (_label, baseline) => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
      baselineProvider: vi.fn().mockImplementation(baseline),
    };

    render(FilterPanel, {
      props: { config, timeBuckets: [], filters: { ...createFilterState(), personIds: ['p'] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(screen.getByTestId('filter-section-media')).toBeInTheDocument());
    expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('hides nothing when no baselineProvider is configured at all', async () => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    render(FilterPanel, {
      props: { config, timeBuckets: [], filters: { ...createFilterState(), personIds: ['p'] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(screen.getByTestId('filter-section-media')).toBeInTheDocument());
    expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('keeps the previous facets when a later refetch rejects', async () => {
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce(availableEverything)
      .mockRejectedValue(new Error('network blip'));
    const config = { sections: ['rating', 'media'] as FilterSection[], suggestionsProvider };
    const filters = { ...createFilterState() };

    const { rerender } = render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await waitFor(() => expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument());

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    await vi.advanceTimersByTimeAsync(50);
    await waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(2));

    // §4.6 at panel level: a rejection must leave `current` and `baseline` untouched, not blank the
    // panel. Slice 4 made the surfaces reject instead of resolving empty precisely so this holds.
    expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument();
    expect(screen.getByTestId('filter-section-media')).toBeInTheDocument();
  });

  it('greys the timeline while it has no buckets, and restores it when they arrive', async () => {
    const config = {
      sections: ['timeline', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue(availableEverything),
    };

    // Every query-mode surface passes through timeBuckets: [] before its first facet response.
    const { rerender } = render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => {
      // getAllByRole, not getByRole: while disabled the section is collapsed (one button, the
      // header), but once it re-enables below its content expands and the year-grid buttons join
      // it, so a single-match query would throw. The header is always rendered first.
      const [button] = within(screen.getByTestId('filter-section-timeline')).getAllByRole('button');
      expect(button).toBeDisabled();
      expect(button.textContent).toContain('(0)');
    });

    await rerender({ config, timeBuckets: [{ timeBucket: '2024-01-01', count: 3 }] });

    // `isOpen` is derived, not stored, so it must recover on its own. No provider round-trip is
    // involved here — availability recomputes synchronously off the new `timeBuckets` prop — so no
    // further timer advance is needed.
    await waitFor(() => {
      const [button] = within(screen.getByTestId('filter-section-timeline')).getAllByRole('button');
      expect(button).toBeEnabled();
    });
  });

  it('keeps a section with an active filter visible even when its facet is empty', async () => {
    const config = {
      sections: ['rating'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    render(FilterPanel, { props: { config, timeBuckets: [], filters: { ...createFilterState(), rating: 5 } } });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(screen.getByTestId('filter-section-rating')).toBeInTheDocument());
  });

  it('offers the show-all hint when every AVAILABLE section is user-hidden', async () => {
    // The user hid `media`; `rating` is unavailable. Nothing renders, so the hint must appear —
    // but `visibleSections` still contains `rating`, so a `.size === 0` check would miss it.
    localStorage.setItem('test-key', JSON.stringify({ selected: ['rating'], known: ['rating', 'media'] }));
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    render(FilterPanel, { props: { config, timeBuckets: [], storageKey: 'test-key' } });
    await vi.advanceTimersByTimeAsync(0);

    // This file's top-level `beforeAll` loads the real en-US locale (unlike specs that skip that
    // bootstrap and get raw i18n keys back from `$t()`), so the hint's actual text is "Show all" —
    // asserting on the stable testid instead of either string keeps this immune to copy changes.
    await waitFor(() => expect(screen.getByTestId('show-all-sections')).toBeInTheDocument());
  });

  it('leaves the legacy providers path ungated', async () => {
    const config = {
      sections: ['people', 'camera'] as FilterSection[],
      providers: { people: vi.fn().mockResolvedValue([]), cameras: vi.fn().mockResolvedValue([]) },
    };

    render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    await waitFor(() => expect(screen.getByTestId('filter-section-people')).toBeInTheDocument());
    expect(screen.getByTestId('filter-section-camera')).toBeInTheDocument();
  });
});
