import { createRawSnippet, tick } from 'svelte';
import { init, register, waitLocale } from 'svelte-i18n';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { ALL_FILTER_SECTIONS, createFilterState, type FilterPanelConfig, type FilterSection } from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

describe('FilterPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders an expanded section with no surface fill or hard divider', async () => {
    await render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
    });
    const section = page.getByTestId('filter-section-timeline').element();
    expect(section.className).not.toContain('bg-subtle');
    expect(section.className).not.toContain('border-b');
  });

  it('should render configured sections only', async () => {
    await render(FilterPanel, {
      props: {
        config: {
          sections: ['people', 'rating'],
          providers: {},
        },
        timeBuckets: [],
      },
    });
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-location')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
  });

  it("renders a surface's own block above the sections, even with every section hidden", async () => {
    const top = createRawSnippet(() => ({ render: () => '<div data-testid="panel-top">top</div>' }));
    await render(FilterPanel, {
      props: { config: { sections: ['rating'], providers: {} }, timeBuckets: [], top },
    });

    const rating = page.getByTestId('filter-section-rating').element();
    expect(
      page.getByTestId('panel-top').element().compareDocumentPosition(rating) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    localStorage.setItem('hidden-sections', JSON.stringify({ selected: [], known: ['rating'] }));
    const hidden = await render(FilterPanel, {
      props: { config: { sections: ['rating'], providers: {} }, timeBuckets: [], top, storageKey: 'hidden-sections' },
    });
    await tick();
    const hiddenContainer = page.elementLocator(hidden.container);
    await expect.element(hiddenContainer.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    await expect.element(hiddenContainer.getByTestId('panel-top')).toBeInTheDocument();
  });

  it('should hide sections not in config', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-location')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-tags')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-media')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('should collapse to icon strip', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['people', 'location'], providers: {} },
        timeBuckets: [],
      },
    });
    await page.getByTestId('collapse-panel-btn').click();
    await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
    await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
  });

  it('should expand from collapsed state', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['people'], providers: {} },
        timeBuckets: [],
      },
    });
    // Collapse first
    await page.getByTestId('collapse-panel-btn').click();
    await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
    // Expand
    await page.getByTestId('expand-panel-btn').click();
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
    await expect.element(page.getByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });

  it('should update filters when month is clicked in timeline picker', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
      },
    });
    await page.getByTestId('year-btn-2023').click();
    await page.getByTestId('month-btn-6').click();
    await page.getByTestId('collapse-panel-btn').click();
    await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
  });

  it('should update filters when year is clicked in timeline picker', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['timeline'], providers: {} },
        timeBuckets: [
          { timeBucket: '2023-06-01', count: 100 },
          { timeBucket: '2023-08-01', count: 200 },
        ],
      },
    });
    await page.getByTestId('year-btn-2023').click();
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('should render with externally-provided filters state', async () => {
    const filters = createFilterState();
    filters.mediaType = 'image';
    await render(FilterPanel, {
      props: {
        config: { sections: ['media'], providers: {} },
        timeBuckets: [],
        filters,
      },
    });
    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
  });

  it('should call onFiltersChange when filters are changed inside the panel', async () => {
    const onFiltersChange = vi.fn();

    await render(FilterPanel, {
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

    await page.getByTestId('location-country-Germany').click();

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ country: 'Germany', city: undefined }));
  });

  it('clears locationPresence when a country is chosen', async () => {
    const onFiltersChange = vi.fn();
    const filters = { ...createFilterState(), locationPresence: 'noGps' as const };

    await render(FilterPanel, {
      props: {
        config: {
          sections: ['location'],
          providers: {
            locations: () => Promise.resolve([{ value: 'Germany', type: 'country' as const }]),
            cities: () => Promise.resolve([]),
          },
        },
        timeBuckets: [],
        filters,
        onFiltersChange,
      },
    });

    // The location group is replaced wholesale in BOTH directions — the LocationFilter row test
    // only covers presence-replaces-country; a country click must equally drop locationPresence.
    await userEvent.click(page.getByTestId('location-country-Germany'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Germany', locationPresence: undefined }),
    );
  });

  it('clears country/city/state when a presence row is chosen', async () => {
    const onFiltersChange = vi.fn();
    const filters = { ...createFilterState(), country: 'Germany' };

    await render(FilterPanel, {
      props: {
        config: {
          sections: ['location'],
          // suggestionsProvider (rather than providers.locations) because hasNoGpsAssets has to be
          // true for the row to render unselected — providers.locations never touches that flag.
          suggestionsProvider: () =>
            Promise.resolve({
              countries: ['Germany'],
              cameraMakes: [],
              tags: [],
              people: [],
              ratings: [],
              mediaTypes: [],
              hasUnnamedPeople: false,
              hasNoGpsAssets: true,
              hasNoPlaceNameAssets: false,
            }),
          providers: {},
        },
        timeBuckets: [],
        filters,
        onFiltersChange,
      },
    });

    // The reverse direction of the pair above: a presence row must equally drop country/city/state,
    // not just record itself alongside a stale country — otherwise the query carries a contradictory
    // country + locationPresence pair the server rejects.
    await userEvent.click(page.getByTestId('location-presence-noGps'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({
        country: undefined,
        city: undefined,
        state: undefined,
        locationPresence: 'noGps',
      }),
    );
  });

  it('should update filters when has-no-album is selected', async () => {
    const onFiltersChange = vi.fn();

    await render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        onFiltersChange,
      },
    });

    await page.getByTestId('albums-none').click();

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ isNotInAlbum: true }));
  });

  it('should show active state for has-no-album when collapsed', async () => {
    const filters = { ...createFilterState(), isNotInAlbum: true };

    await render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
      },
    });

    await page.getByTestId('collapse-panel-btn').click();

    expect(page.getByTestId('collapsed-icon-strip').element().querySelector('.bg-immich-primary')).toBeTruthy();
  });

  it('should select has-album and clear has-no-album (mutual exclusivity)', async () => {
    const onFiltersChange = vi.fn();
    // Start with "Has no album" already active to prove selecting "Has album" clears it.
    const filters = { ...createFilterState(), isNotInAlbum: true };

    await render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
        onFiltersChange,
      },
    });

    await page.getByTestId('albums-has').click();

    const updated = onFiltersChange.mock.calls.at(-1)![0];
    expect(updated.isInAlbum).toBe(true);
    expect(updated.isNotInAlbum).toBeUndefined();
  });

  it('should show active state for has-album when collapsed', async () => {
    const filters = { ...createFilterState(), isInAlbum: true };

    await render(FilterPanel, {
      props: {
        config: { sections: ['albums' as FilterSection], providers: {} },
        timeBuckets: [],
        filters,
      },
    });

    await page.getByTestId('collapse-panel-btn').click();

    expect(page.getByTestId('collapsed-icon-strip').element().querySelector('.bg-immich-primary')).toBeTruthy();
  });

  it('should work without onFiltersChange callback', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  describe('collapsed state persistence', () => {
    const COLLAPSED_KEY = 'gallery-filter-collapsed';

    beforeEach(() => {
      localStorage.clear();
    });

    it('should start expanded when no localStorage entry exists (first visit)', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating', 'media'], providers: {} },
          timeBuckets: [],
        },
      });
      await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
      await expect.element(page.getByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
    });

    it('should start collapsed when localStorage has true', async () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating', 'media'], providers: {} },
          timeBuckets: [],
        },
      });
      await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
      await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
    });

    it('should persist collapsed state to localStorage when user collapses', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
        },
      });
      await page.getByTestId('collapse-panel-btn').click();
      expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(true);
    });

    it('should persist expanded state to localStorage when user expands', async () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
        },
      });
      await page.getByTestId('expand-panel-btn').click();
      expect(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? 'null')).toBe(false);
    });

    it('should not persist collapsed state when persistCollapsed is false', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      await page.getByTestId('collapse-panel-btn').click();
      expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
    });

    it('should always start expanded when persistCollapsed is false regardless of localStorage', async () => {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(true));
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
    });

    it('should still allow in-session collapse when persistCollapsed is false', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['rating'], providers: {} },
          timeBuckets: [],
          persistCollapsed: false,
        },
      });
      await page.getByTestId('collapse-panel-btn').click();
      await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
      await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
      // But nothing written to localStorage
      expect(localStorage.getItem(COLLAPSED_KEY)).toBeNull();
    });
  });

  it('animates the panel width via a persistent shell with a reduced-motion guard', async () => {
    await render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [] },
    });
    const shell = page.getByTestId('filter-panel-shell').element();
    expect(shell.className).toContain('transition-[width]');
    expect(shell.className).toContain('motion-reduce:transition-none');
    expect(shell.className).toContain('w-64');

    await page.getByTestId('collapse-panel-btn').click();
    expect(shell.className).toContain('w-12');
    expect(shell.className).not.toContain('w-64');
  });

  it('collapses to zero width in externalToggle mode (space reclaimed, still animatable)', async () => {
    await render(FilterPanel, {
      props: { config: { sections: ['timeline'], providers: {} }, timeBuckets: [], externalToggle: true },
    });
    const shell = page.getByTestId('filter-panel-shell').element();
    expect(shell.className).toContain('w-64');

    await page.getByTestId('collapse-panel-btn').click();

    // Stays mounted (so the width transition animates) but at w-0 — no built-in button, and the panel
    // content is inert while hidden. The page supplies its own header filter button.
    expect(shell.className).toContain('w-0');
    expect(shell.className).not.toContain('w-64');
    await expect.element(page.getByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
    expect(page.getByTestId('discovery-panel').element().hasAttribute('inert')).toBe(true);
  });

  // Built-in collapse unmounts the panel body, taking any open menu with it. externalToggle does
  // not - the panel stays mounted at w-0, clipped and inert - so an open menu survives the
  // collapse and is still open on reopen unless it is explicitly closed.
  it('closes an open section menu when collapsed in externalToggle mode', async () => {
    const { rerender } = await render(FilterPanel, {
      props: {
        config: { sections: ['timeline', 'people'], providers: {} },
        timeBuckets: [],
        externalToggle: true,
        collapsed: false,
      },
    });

    await page.getByTestId('section-menu-btn').click();
    await expect.element(page.getByTestId('section-menu')).toBeInTheDocument();

    await rerender({
      config: { sections: ['timeline', 'people'], providers: {} },
      timeBuckets: [],
      externalToggle: true,
      collapsed: true,
    });

    await expect.element(page.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
  });

  describe('emptyText prop', () => {
    it('should show generic empty text for people section when no people', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['people'], providers: { people: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await expect.element(page.getByTestId('people-empty')).toHaveTextContent('No people found');
    });

    it('should show generic empty text for location section when no locations', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['location'], providers: { locations: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await expect.element(page.getByTestId('location-empty')).toHaveTextContent('No locations found');
    });

    it('should show generic empty text for camera section when no cameras', async () => {
      await render(FilterPanel, {
        props: {
          config: { sections: ['camera'], providers: { cameras: () => Promise.resolve([]) } },
          timeBuckets: [],
        },
      });
      await expect.element(page.getByTestId('camera-empty')).toHaveTextContent('No cameras found');
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

    await render(FilterPanel, { props: { config, timeBuckets: [], filters } });

    await expect.element(page.getByTestId('camera-make-Canon')).toBeInTheDocument();

    const peopleButton = page.getByTestId('filter-section-people').getByRole('button');
    await expect.element(peopleButton).not.toBeDisabled();
    await expect.element(peopleButton).not.toMatchTextContent(/\(0\)/);
  });
});

describe('hidden prop', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('should render nothing when hidden is true', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating', 'media'], providers: {} },
        timeBuckets: [],
        hidden: true,
      },
    });
    await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
  });

  it('should render panel when hidden is false', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        hidden: false,
      },
    });
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('should render panel by default when hidden is not provided', async () => {
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
      },
    });
    await expect.element(page.getByTestId('discovery-panel')).toBeInTheDocument();
  });

  it('should render nothing when hidden and collapsed in localStorage', async () => {
    localStorage.setItem('gallery-filter-collapsed', JSON.stringify(true));
    await render(FilterPanel, {
      props: {
        config: { sections: ['rating'], providers: {} },
        timeBuckets: [],
        hidden: true,
      },
    });
    await expect.element(page.getByTestId('discovery-panel')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('collapsed-icon-strip')).not.toBeInTheDocument();
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
    await page.getByTestId('section-menu-btn').click();
  }

  beforeEach(() => {
    localStorage.clear();
  });

  // --- Rendering ---

  // The cog replaces the old icon row. It is gated exactly as that row was, on the page having
  // configured sections at all.
  it('renders the section cog when sections are configured', async () => {
    await renderPanel(['people', 'rating']);

    await expect.element(page.getByTestId('section-menu-btn')).toBeInTheDocument();
  });

  it('renders no section cog when the config has no sections', async () => {
    await renderPanel([]);

    await expect.element(page.getByTestId('section-menu-btn')).not.toBeInTheDocument();
  });

  it('renders no section cog once the panel is collapsed', async () => {
    await renderPanel(['people', 'rating']);

    await page.getByTestId('collapse-panel-btn').click();

    await expect.element(page.getByTestId('section-menu-btn')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();
  });

  // Boundary of the gate: one section is still enough to warrant the control, and hiding it
  // leaves the panel on its empty state rather than blank.
  it('renders the cog for a single configured section and lands on the empty state when hidden', async () => {
    await renderPanel(['people']);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();

    await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
  });

  // Two independent routes back from "everything hidden"; neither may shadow the other.
  it('restores every section from the menu reset', async () => {
    await renderPanel(['people', 'rating']);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-rating').click();
    await page.getByTestId('section-menu-show-all').click();

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('restores every section from the empty-state link', async () => {
    await renderPanel(['people', 'rating']);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-rating').click();
    await page.getByTestId('show-all-sections').click();

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  // Show all with nothing hidden must not toggle anything off, and must leave the menu usable.
  it('leaves everything visible when Show all is used with nothing hidden', async () => {
    await renderPanel(['people', 'rating']);

    await openSectionMenu();
    await page.getByTestId('section-menu-show-all').click();

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('section-menu')).toBeInTheDocument();
  });

  // The toggles MOVED - they are not also still sitting in the header. Without this, leaving the old
  // row in place would satisfy every other test in this file: they all find a toggle either way, and
  // a strict locator only fails on duplicate testids.
  it('keeps the section toggles out of the DOM until the menu is opened', async () => {
    await renderPanel(['people', 'rating']);

    await expect.element(page.getByTestId('section-toggle-people')).not.toBeInTheDocument();

    await openSectionMenu();

    await expect.element(page.getByTestId('section-toggle-people')).toBeInTheDocument();
  });

  // The aggregate dot is the only thing on screen saying "something is filtering out of sight" while
  // the menu is shut, so it is asserted with the menu closed. `personIds` is the field the existing
  // per-section dot tests at `:660-684` use.
  it('shows a dot on the cog when a hidden section still holds a filter', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    await renderPanel(['people', 'rating'], filters);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    page
      .getByTestId('section-menu-btn')
      .element()
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    await expect.element(page.getByTestId('section-menu-btn')).toHaveAttribute('aria-expanded', 'false');
    await expect.element(page.getByTestId('section-menu-dot')).toBeInTheDocument();
  });

  it('shows no dot on the cog when the hidden section holds no filter', async () => {
    await renderPanel(['people', 'rating']);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();

    await expect.element(page.getByTestId('section-menu-dot')).not.toBeInTheDocument();
  });

  // Derived, not latched: showing the section again clears the cue.
  it('clears the cog dot when the hidden section is shown again', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    await renderPanel(['people', 'rating'], filters);

    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-menu-dot')).toBeInTheDocument();

    await page.getByTestId('section-toggle-people').click();

    await expect.element(page.getByTestId('section-menu-dot')).not.toBeInTheDocument();
  });

  it('should list every configured section in the menu', async () => {
    await renderPanel();
    await openSectionMenu();
    for (const section of allSections) {
      await expect.element(page.getByTestId(`section-toggle-${section}`)).toBeInTheDocument();
    }
  });

  it('should keep favorites section toggle label distinct from asset favorite action', async () => {
    await renderPanel(['favorites']);
    await openSectionMenu();

    const favoritesToggle = page.getByTestId('section-toggle-favorites').element();
    expect(favoritesToggle).toHaveAttribute('aria-label', 'Starred filter section');
  });

  // Test 2
  it('should not render toggle icons for unconfigured sections', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await expect.element(page.getByTestId('section-toggle-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-location')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-camera')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-tags')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-timeline')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-media')).not.toBeInTheDocument();
  });

  // Test 3
  it('should show all sections visible by default when no localStorage value', async () => {
    await renderPanel();
    for (const section of allSections) {
      await expect.element(page.getByTestId(`filter-section-${section}`)).toBeInTheDocument();
    }
  });

  // --- Toggle Interaction ---

  // Test 6
  it('should hide section from DOM when active icon is clicked', async () => {
    await renderPanel();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
  });

  // Test 7
  it('should restore section to DOM when inactive icon is clicked', async () => {
    await renderPanel();
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
  });

  // Test 8
  it('should not affect other sections when one is toggled', async () => {
    await renderPanel();
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-location')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-camera')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  // Test 9
  it('should allow multiple sections to be hidden simultaneously', async () => {
    await renderPanel();
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-location').click();
    await page.getByTestId('section-toggle-camera').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-location')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-tags')).toBeInTheDocument();
  });

  // Test 10
  it('should return to original state after rapid double-click', async () => {
    await renderPanel();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
  });

  // Test 11
  it('should trigger all-hidden state when single section is hidden', async () => {
    await renderPanel(['rating']);
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await openSectionMenu();
    await page.getByTestId('section-toggle-rating').click();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
  });

  // --- All-Hidden Empty State ---

  // Test 12
  it('should show empty state with "Show all" link when all sections hidden', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-rating').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
  });

  // Test 13
  it('should restore all sections when "Show all" is clicked', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-rating').click();
    await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
    await page.getByTestId('show-all-sections').click();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('show-all-sections')).not.toBeInTheDocument();
  });

  // Test 14
  it('should update all toggle icons to active/pressed after "Show all"', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await page.getByTestId('section-toggle-rating').click();
    await page.getByTestId('show-all-sections').click();
    // The empty-state link sits outside the menu, so a real click on it is an outside click that
    // closes the menu; reopen it to read the toggles.
    await expect.element(page.getByTestId('section-menu')).not.toBeInTheDocument();
    await openSectionMenu();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('section-toggle-rating')).toHaveAttribute('aria-pressed', 'true');
  });

  // --- Active-but-Hidden Indicator ---

  // Test 15
  it('should show dot indicator on hidden section with active filter', async () => {
    const filters = createFilterState();
    filters.personIds = ['person-1'];
    await renderPanel(['people', 'rating'], filters);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-toggle-dot-people')).toBeInTheDocument();
  });

  // Test 16
  it('should not show dot indicator on hidden section without active filter', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-toggle-dot-people')).not.toBeInTheDocument();
  });

  // Test 17
  it('should show dot on timeline section with selectedYear when hidden', async () => {
    const filters = createFilterState();
    filters.selectedYear = 2023;
    await renderPanel(['timeline', 'rating'], filters);
    await openSectionMenu();
    await page.getByTestId('section-toggle-timeline').click();
    await expect.element(page.getByTestId('section-toggle-dot-timeline')).toBeInTheDocument();
  });

  // --- Accessibility ---

  // Test 18
  it('should set aria-pressed="true" on visible section toggle icons', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'true');
    await expect.element(page.getByTestId('section-toggle-rating')).toHaveAttribute('aria-pressed', 'true');
  });

  // Test 19
  it('should set aria-pressed="false" on hidden section toggle icons', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'false');
    await expect.element(page.getByTestId('section-toggle-rating')).toHaveAttribute('aria-pressed', 'true');
  });

  // Test 20
  it('should update aria-pressed correctly after toggle click', async () => {
    await renderPanel(['people']);
    await openSectionMenu();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'false');
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('section-toggle-people')).toHaveAttribute('aria-pressed', 'true');
  });

  // --- localStorage Persistence ---

  // Test 21
  it('should write updated visibility to localStorage when section is toggled', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).toContain('rating');
    expect(stored.selected).not.toContain('people');
  });

  // Test 22
  it('should read localStorage on mount and restore visibility', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['rating']));
    await renderPanel(['people', 'rating']);
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('should add favorites to legacy visible-section preferences without unhiding known hidden sections', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people']));

    await renderPanel(['people', 'rating', 'favorites']);

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-favorites')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
  });

  it('should add favorites to empty legacy visible-section preferences without unhiding all known sections', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));

    await renderPanel(['people', 'rating', 'favorites']);

    await expect.element(page.getByTestId('filter-section-favorites')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
  });

  it('should fall back to all visible when legacy visible-section preferences only contain unknown sections', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['obsolete-section']));

    await renderPanel(['people', 'rating', 'favorites']);

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-favorites')).toBeInTheDocument();
  });

  it('should add sections missing from stored known-section metadata without unhiding known hidden sections', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        selected: ['people'],
        known: ['people', 'rating', 'favorites'],
      }),
    );

    await renderPanel(['people', 'rating', 'favorites', 'media']);

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-favorites')).not.toBeInTheDocument();
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

    it('reveals the newly introduced text section to a user with a pre-fix stored set', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: [...PRE_FIX_MAP_SECTIONS], known: [...PRE_FIX_MAP_SECTIONS] }),
      );

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-text')).toBeInTheDocument();
    });

    it('reveals the text section without un-hiding sections the user deliberately hid', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ selected: ['timeline', 'people'], known: [...PRE_FIX_MAP_SECTIONS] }),
      );

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-text')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-albums')).not.toBeInTheDocument();
    });

    it('shows every section to a user who has never opened the panel', async () => {
      await renderPanel([...ALL_FILTER_SECTIONS]);

      for (const section of ALL_FILTER_SECTIONS) {
        await expect.element(page.getByTestId(`filter-section-${section}`)).toBeInTheDocument();
      }
    });

    it('does not re-introduce the text section once the user has hidden it post-fix', async () => {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          selected: ALL_FILTER_SECTIONS.filter((section) => section !== 'text'),
          known: [...ALL_FILTER_SECTIONS],
        }),
      );

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-text')).not.toBeInTheDocument();
    });
  });

  // #797: two people on the same version saw different filter category lists. Which sections a
  // user sees is a per-browser ledger, and it could silently diverge from the app's section list.
  describe('#797 stored-ledger divergence', () => {
    // What a browser stored before #447 replaced the bare array with { selected, known }: the
    // sections that existed at the time. Everything added since must still be revealed.
    const PRE_LEDGER_STORED: FilterSection[] = ['timeline', 'people', 'location', 'camera', 'tags', 'rating', 'media'];

    it('reveals every section added since the ledger format to a browser on legacy storage', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(PRE_LEDGER_STORED));

      await renderPanel([...ALL_FILTER_SECTIONS]);

      for (const section of ALL_FILTER_SECTIONS) {
        await expect.element(page.getByTestId(`filter-section-${section}`)).toBeInTheDocument();
      }
    });

    it('reveals sections added since the ledger without un-hiding ones hidden back then', async () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(['timeline', 'people']));

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-favorites')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-albums')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-text')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    });

    // Album detail and the album asset picker share one storage key but offer different section
    // lists (detail drops 'albums'). Visiting detail must not erase the picker's record.
    it('keeps a hidden section hidden after a surface that does not offer it rewrites the ledger', async () => {
      const picker = await renderPanel([...ALL_FILTER_SECTIONS]);
      await openSectionMenu();
      await page.getByTestId('section-toggle-albums').click();
      await picker.unmount();

      const detail = await renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));
      await tick();
      await detail.unmount();

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-albums')).not.toBeInTheDocument();
    });

    it('keeps a visible section visible after a surface that does not offer it rewrites the ledger', async () => {
      const detail = await renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));
      await openSectionMenu();
      await page.getByTestId('section-toggle-camera').click();
      await detail.unmount();

      await renderPanel([...ALL_FILTER_SECTIONS]);

      await expect.element(page.getByTestId('filter-section-albums')).toBeInTheDocument();
      await expect.element(page.getByTestId('filter-section-camera')).not.toBeInTheDocument();
    });

    it('offers to show all sections when every section this surface renders is hidden', async () => {
      const picker = await renderPanel([...ALL_FILTER_SECTIONS]);
      await openSectionMenu();
      for (const section of ALL_FILTER_SECTIONS) {
        if (section !== 'albums') {
          await page.getByTestId(`section-toggle-${section}`).click();
        }
      }
      await picker.unmount();

      await renderPanel(ALL_FILTER_SECTIONS.filter((section) => section !== 'albums'));

      await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
    });
  });

  // Test 23
  it('should show only stored sections when localStorage has partial list', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people']));
    await renderPanel();
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-location')).not.toBeInTheDocument();
  });

  // Test 24
  it('should ignore stale/unknown section names in localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(['people', 'nonexistent', 'foobar']));
    await renderPanel(['people', 'rating']);
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
  });

  // Test 25
  it('should fall back to all-visible default when localStorage has invalid JSON', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json!!!');
    await renderPanel(['people', 'rating']);
    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  // Test 26
  it('should use the correct localStorage key', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem('some-other-key')).toBeNull();
  });

  // --- State Preservation ---

  // Test 27
  it('should preserve visibility state across panel collapse/expand cycle', async () => {
    await renderPanel(['people', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-people').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();

    // Collapse
    await page.getByTestId('collapse-panel-btn').click();
    await expect.element(page.getByTestId('collapsed-icon-strip')).toBeInTheDocument();

    // Expand
    await page.getByTestId('expand-panel-btn').click();
    await expect.element(page.getByTestId('filter-section-people')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  // Test 28
  it('should still allow filter interactions on visible sections (regression)', async () => {
    await renderPanel(['timeline', 'rating']);
    await openSectionMenu();
    await page.getByTestId('section-toggle-rating').click();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();
    // Timeline should still work
    await expect.element(page.getByTestId('filter-section-timeline')).toBeInTheDocument();
    await page.getByTestId('year-btn-2023').click();
    await expect.element(page.getByTestId('filter-section-timeline')).toBeInTheDocument();
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

  it('should default all sections to expanded on first visit', async () => {
    await renderPanel(['people', 'rating']);
    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
  });

  it('should persist collapsed section to localStorage when header is clicked', async () => {
    await renderPanel(['people', 'rating']);
    const peopleHeader = page.getByTestId('filter-section-people').element().querySelector('button')!;
    await page.elementLocator(peopleHeader).click();
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).not.toContain('people');
    expect(stored.selected).toContain('rating');
  });

  it('should restore collapsed sections from localStorage on mount', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    await renderPanel(['people', 'rating']);
    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    expect(peopleContent).toBeNull();
    expect(ratingContent).toBeTruthy();
  });

  it('should expand favorites for legacy expanded-section preferences without expanding known collapsed sections', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['people']));

    await renderPanel(['people', 'rating', 'favorites']);

    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    const favoritesContent = page
      .getByTestId('filter-section-favorites')
      .element()
      .querySelector('.filter-section-content');

    expect(peopleContent).toBeTruthy();
    expect(favoritesContent).toBeTruthy();
    expect(ratingContent).toBeNull();
  });

  it('should fall back to all expanded when legacy expanded-section preferences only contain unknown sections', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['obsolete-section']));

    await renderPanel(['people', 'rating', 'favorites']);

    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    const favoritesContent = page
      .getByTestId('filter-section-favorites')
      .element()
      .querySelector('.filter-section-content');

    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
    expect(favoritesContent).toBeTruthy();
  });

  it('should expand newly introduced sections from stored known-section metadata', async () => {
    localStorage.setItem(
      EXPANDED_KEY,
      JSON.stringify({
        selected: ['people'],
        known: ['people', 'rating', 'favorites'],
      }),
    );

    await renderPanel(['people', 'rating', 'favorites', 'media']);

    const mediaContent = page.getByTestId('filter-section-media').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    const favoritesContent = page
      .getByTestId('filter-section-favorites')
      .element()
      .querySelector('.filter-section-content');

    expect(mediaContent).toBeTruthy();
    expect(ratingContent).toBeNull();
    expect(favoritesContent).toBeNull();
  });

  it('should keep all sections collapsed when localStorage has empty array', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([]));
    await renderPanel(['people', 'rating']);
    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    expect(peopleContent).toBeNull();
    expect(ratingContent).toBeNull();
  });

  it('should ignore unknown section types in localStorage', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['people', 'nonexistent']));
    await renderPanel(['people', 'rating']);
    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
  });

  it('should fall back to all-expanded when localStorage has invalid JSON', async () => {
    localStorage.setItem(EXPANDED_KEY, 'not-valid-json!!!');
    await renderPanel(['people', 'rating']);
    const peopleContent = page.getByTestId('filter-section-people').element().querySelector('.filter-section-content');
    const ratingContent = page.getByTestId('filter-section-rating').element().querySelector('.filter-section-content');
    expect(peopleContent).toBeTruthy();
    expect(ratingContent).toBeTruthy();
  });

  it('should expand a collapsed section when header is clicked again', async () => {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(['rating']));
    await renderPanel(['people', 'rating']);
    const peopleHeader = page.getByTestId('filter-section-people').element().querySelector('button')!;
    await page.elementLocator(peopleHeader).click();
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}') as { selected: string[] };
    expect(stored.selected).toContain('people');
    expect(stored.selected).toContain('rating');
  });

  describe('text filter section', () => {
    it('renders the text section with three inputs when configured', async () => {
      await render(FilterPanel, {
        props: { config: { sections: ['text'], providers: {} }, timeBuckets: [] },
      });

      await expect.element(page.getByTestId('filter-section-text')).toBeInTheDocument();
      await expect.element(page.getByTestId('text-filter-description')).toBeInTheDocument();
      await expect.element(page.getByTestId('text-filter-filename')).toBeInTheDocument();
      await expect.element(page.getByTestId('text-filter-ocr')).toBeInTheDocument();
    });

    it('does not render the text section when not configured', async () => {
      await render(FilterPanel, {
        props: { config: { sections: ['rating'], providers: {} }, timeBuckets: [] },
      });

      await expect.element(page.getByTestId('filter-section-text')).not.toBeInTheDocument();
    });

    it('emits onFiltersChange with the typed description after the debounce', async () => {
      vi.useFakeTimers();
      try {
        const onFiltersChange = vi.fn();
        await render(FilterPanel, {
          props: { config: { sections: ['text'], providers: {} }, timeBuckets: [], onFiltersChange },
        });

        const input = page.getByTestId('text-filter-description').element() as HTMLInputElement;
        input.value = 'beach';
        input.dispatchEvent(new Event('input', { bubbles: true }));
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
  // deterministic, matching every sibling test in unified-suggestions.spec.ts. Note the retrying
  // `expect.element` / `vi.waitFor` do NOT advance Vitest's fake clock, so the state must already be
  // correct before they run — they are kept below only as defensive assertion wrappers, not as the
  // thing doing the waiting.
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

    await render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    // The sibling assertion matters: without it a panel that rendered nothing would pass.
    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();

    // The section toggles live inside the cog's popover, so it has to be opened to see them.
    await page.getByTestId('section-menu-btn').click();
    await expect.element(page.getByTestId('section-toggle-rating')).not.toBeInTheDocument();
    await expect.element(page.getByTestId('section-toggle-media')).toBeInTheDocument();
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

    const { rerender } = await render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(1));

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    // Discrete (non-temporal) filter changes debounce at 50ms.
    await vi.advanceTimersByTimeAsync(50);

    // first(), not a strict single match: the section was open before this fetch, so its collapse
    // plays an outro transition — the now-stale content (with its own buttons) can still be in the
    // DOM, marked inert, at the instant this assertion runs. The header button is always rendered first.
    const button = page.getByTestId('filter-section-favorites').getByRole('button').first();
    await expect.element(button).toBeDisabled();
    await expect.element(button).toMatchTextContent(/\(0\)/);
  });

  it('never writes availability into the stored ledger', async () => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    await render(FilterPanel, { props: { config, timeBuckets: [], storageKey: 'test-key' } });
    await vi.advanceTimersByTimeAsync(0);
    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();

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

    const { rerender } = await render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await expect.element(page.getByTestId('filter-section-rating')).not.toBeInTheDocument();

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    await vi.advanceTimersByTimeAsync(50);

    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('calls baselineProvider once when it mounts with filters applied', async () => {
    const suggestionsProvider = vi.fn().mockResolvedValue(availableEverything);
    const baselineProvider = vi.fn().mockResolvedValue(availableEverything);
    const config = { sections: ['rating'] as FilterSection[], suggestionsProvider, baselineProvider };

    await render(FilterPanel, { props: { config, timeBuckets: [], filters: { ...createFilterState(), rating: 5 } } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(baselineProvider).toHaveBeenCalledTimes(1));
    // The baseline is a SEPARATE hook, never a second suggestionsProvider call: spec §4.5 explains
    // why reusing the provider corrupts the query-mode pages.
    expect(suggestionsProvider).toHaveBeenCalledTimes(1);
  });

  it('calls no baseline provider when it mounts clean', async () => {
    const suggestionsProvider = vi.fn().mockResolvedValue(availableEverything);
    const baselineProvider = vi.fn().mockResolvedValue(availableEverything);
    const config = { sections: ['rating'] as FilterSection[], suggestionsProvider, baselineProvider };

    await render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    await vi.waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(1));
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

    await render(FilterPanel, {
      props: { config, timeBuckets: [], filters: { ...createFilterState(), personIds: ['p'] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('hides nothing when no baselineProvider is configured at all', async () => {
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    await render(FilterPanel, {
      props: { config, timeBuckets: [], filters: { ...createFilterState(), personIds: ['p'] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('keeps the previous facets when a later refetch rejects', async () => {
    const suggestionsProvider = vi
      .fn()
      .mockResolvedValueOnce(availableEverything)
      .mockRejectedValue(new Error('network blip'));
    const config = { sections: ['rating', 'media'] as FilterSection[], suggestionsProvider };
    const filters = { ...createFilterState() };

    const { rerender } = await render(FilterPanel, { props: { config, timeBuckets: [], filters } });
    await vi.advanceTimersByTimeAsync(0);
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();

    await rerender({ config, timeBuckets: [], filters: { ...filters, personIds: ['p'] } });
    await vi.advanceTimersByTimeAsync(50);
    await vi.waitFor(() => expect(suggestionsProvider).toHaveBeenCalledTimes(2));

    // §4.6 at panel level: a rejection must leave `current` and `baseline` untouched, not blank the
    // panel. Slice 4 made the surfaces reject instead of resolving empty precisely so this holds.
    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-media')).toBeInTheDocument();
  });

  it('greys the timeline while it has no buckets, and restores it when they arrive', async () => {
    const config = {
      sections: ['timeline', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue(availableEverything),
    };

    // Every query-mode surface passes through timeBuckets: [] before its first facet response.
    const { rerender } = await render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    // first(), not a strict single match: while disabled the section is collapsed (one button, the
    // header), but once it re-enables below its content expands and the year-grid buttons join it,
    // so a single-match locator would throw. The header is always rendered first.
    const button = page.getByTestId('filter-section-timeline').getByRole('button').first();
    await expect.element(button).toBeDisabled();
    await expect.element(button).toMatchTextContent(/\(0\)/);

    await rerender({ config, timeBuckets: [{ timeBucket: '2024-01-01', count: 3 }] });

    // `isOpen` is derived, not stored, so it must recover on its own. No provider round-trip is
    // involved here — availability recomputes synchronously off the new `timeBuckets` prop — so no
    // further timer advance is needed.
    await expect.element(button).toBeEnabled();
  });

  it('keeps a section with an active filter visible even when its facet is empty', async () => {
    const config = {
      sections: ['rating'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    await render(FilterPanel, { props: { config, timeBuckets: [], filters: { ...createFilterState(), rating: 5 } } });
    await vi.advanceTimersByTimeAsync(0);

    await expect.element(page.getByTestId('filter-section-rating')).toBeInTheDocument();
  });

  it('offers the show-all hint when every AVAILABLE section is user-hidden', async () => {
    // The user hid `media`; `rating` is unavailable. Nothing renders, so the hint must appear —
    // but `visibleSections` still contains `rating`, so a `.size === 0` check would miss it.
    localStorage.setItem('test-key', JSON.stringify({ selected: ['rating'], known: ['rating', 'media'] }));
    const config = {
      sections: ['rating', 'media'] as FilterSection[],
      suggestionsProvider: vi.fn().mockResolvedValue({ ...availableEverything, ratings: [] }),
    };

    await render(FilterPanel, { props: { config, timeBuckets: [], storageKey: 'test-key' } });
    await vi.advanceTimersByTimeAsync(0);

    // This file's top-level `beforeAll` loads the real en-US locale (unlike specs that skip that
    // bootstrap and get raw i18n keys back from `$t()`), so the hint's actual text is "Show all" —
    // asserting on the stable testid instead of either string keeps this immune to copy changes.
    await expect.element(page.getByTestId('show-all-sections')).toBeInTheDocument();
  });

  it('leaves the legacy providers path ungated', async () => {
    const config = {
      sections: ['people', 'camera'] as FilterSection[],
      providers: { people: vi.fn().mockResolvedValue([]), cameras: vi.fn().mockResolvedValue([]) },
    };

    await render(FilterPanel, { props: { config, timeBuckets: [] } });
    await vi.advanceTimersByTimeAsync(0);

    await expect.element(page.getByTestId('filter-section-people')).toBeInTheDocument();
    await expect.element(page.getByTestId('filter-section-camera')).toBeInTheDocument();
  });
});
