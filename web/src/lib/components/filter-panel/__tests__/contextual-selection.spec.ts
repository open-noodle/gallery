import { buildPersonFilterPatch } from '#lib/utils/filter-target.ts';
import { getPhotosPersonFilterId } from '#lib/utils/photos-filter-options.ts';
import { init, register, waitLocale } from 'svelte-i18n';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import {
  createFilterState,
  type FilterPanelConfig,
  type FilterState,
  type FilterSuggestionsResponse,
} from '../filter-panel';
import FilterPanel from '../filter-panel.svelte';

/**
The panel is the OTHER half of a contextual filter: clicking a metadata value in the asset viewer
has to leave the panel showing the same thing the chip shows. Every case here was reported against
PR #778 as "the results are right but the panel disagrees".

These are deliberately whole-panel tests rather than per-section ones: the bugs all live in the
seam between the id/level a contextual patch produces and the id/level the section renders, and a
section test that hand-feeds `selectedMake` cannot see that seam.
*/

beforeAll(async () => {
  register('en-US', () => import('#i18n/en.json'));
  await init({ fallbackLocale: 'en-US' });
  await waitLocale('en-US');
});

const suggestions = (overrides: Partial<FilterSuggestionsResponse> = {}): FilterSuggestionsResponse => ({
  countries: [],
  cameraMakes: [],
  tags: [],
  people: [],
  ratings: [],
  mediaTypes: [],
  hasUnnamedPeople: false,
  hasFavorites: false,
  hasAssetsInAlbum: false,
  hasAssetsNotInAlbum: false,
  ...overrides,
});

const renderPanel = (config: FilterPanelConfig, filters: Partial<FilterState>, extra: Record<string, unknown> = {}) =>
  render(FilterPanel, {
    config,
    timeBuckets: [],
    filters: { ...createFilterState(), ...filters },
    ...extra,
  });

const findByTestId = async (testId: string) => {
  const locator = page.getByTestId(testId);
  await expect.element(locator).toBeInTheDocument();
  return locator.element() as HTMLElement;
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('the panel reflects a contextual PERSON filter', () => {
  beforeEach(() => localStorage.clear());

  const PERSON_UUID = 'aaaaaaaa-0000-4000-8000-000000000001';

  // The exact pair that was broken: the viewer emits the patch, the surface builds its options with
  // getPhotosPersonFilterId. If the two disagree the named row stays unticked and a SECOND row
  // appears next to it labelled with the raw id — which is what the report showed.
  it('ticks the NAMED row for the token the viewer emits, and renders no raw-id row', async () => {
    const patch = buildPersonFilterPatch(new URL('https://g.test/photos/asset-1'), { id: PERSON_UUID })!;
    const optionId = getPhotosPersonFilterId({
      id: PERSON_UUID,
      primaryProfile: { type: 'user-person', id: PERSON_UUID },
    });

    await renderPanel(
      {
        sections: ['people'],
        suggestionsProvider: () => Promise.resolve(suggestions({ people: [{ id: optionId, name: 'Bob' }] })),
        providers: {},
      },
      { personIds: patch.personIds },
    );

    await expect.element(page.getByTestId(`people-item-${optionId}`)).toMatchTextContent('Bob');
    const row = page.getByTestId(`people-item-${optionId}`).element();
    expect(row).toMatchTextContent('Bob');
    expect(row.className).toContain('font-medium');
    expect(page.getByTestId(`people-item-${PERSON_UUID}`).query()).toBeNull();
    expect(page.getByText(PERSON_UUID).query()).toBeNull();
  });

  // A space person seen off the Space is the case the suggestions response can genuinely miss (it
  // ranks a user-person profile first when the viewer owns one), so the name banked at click time is
  // the only label there is. It must still reach the row.
  it('names an orphaned row from the banked name rather than showing the token', async () => {
    const token = 'space-person:bbbbbbbb-0000-4000-8000-000000000002';

    await renderPanel(
      {
        sections: ['people'],
        suggestionsProvider: () =>
          Promise.resolve(suggestions({ people: [{ id: `person:${PERSON_UUID}`, name: 'Someone else' }] })),
        providers: {},
      },
      { personIds: [token] },
      { personNames: new Map([[token, 'Alice']]) },
    );

    const row = await findByTestId(`people-item-${token}`);
    expect(row).toMatchTextContent('Alice');
    expect(page.getByText(token).query()).toBeNull();
  });
});

describe('the panel reflects a contextual CAMERA filter', () => {
  beforeEach(() => localStorage.clear());

  const cameraConfig = (models: Record<string, string[]>): FilterPanelConfig => ({
    sections: ['camera'],
    suggestionsProvider: () => Promise.resolve(suggestions({ cameraMakes: ['Apple', 'Canon'] })),
    providers: { cameraModels: (make: string) => Promise.resolve(models[make] ?? []) },
  });

  // Reported: the chip reads "Canon Canon EOS R6" but the panel only ever showed "Canon" — the make
  // was never expanded, so the model row it should have ticked was not even rendered.
  it('expands the selected make and ticks the selected model', async () => {
    await renderPanel(cameraConfig({ Canon: ['Canon EOS R5', 'Canon EOS R6'] }), {
      make: 'Canon',
      model: 'Canon EOS R6',
    });

    const model = await findByTestId('camera-model-Canon EOS R6');
    expect(model.className).toContain('font-medium');
    expect(model.querySelector('.bg-immich-primary')).not.toBeNull();

    // The sibling model is rendered too — the drill-down is a real, browsable level, not a lone row.
    expect(page.getByTestId('camera-model-Canon EOS R5').element()).toBeInTheDocument();
    // Only ONE make is expanded.
    expect(page.getByTestId('camera-model-iPhone 15').query()).toBeNull();
  });

  it('leaves a make-only filter collapsed and ticked on the make row', async () => {
    await renderPanel(cameraConfig({ Canon: ['Canon EOS R5', 'Canon EOS R6'] }), { make: 'Canon' });

    const make = await findByTestId('camera-make-Canon');
    await settle();

    expect(make.querySelector('.bg-immich-primary')).not.toBeNull();
    expect(page.getByTestId('camera-model-Canon EOS R6').query()).toBeNull();
  });

  // The model list is narrowed by the rest of the filter set, so a model that is legitimately
  // filtered by can be absent from it. It must still show as the selection rather than vanish.
  it('keeps a selected model that the narrowed model list no longer contains', async () => {
    await renderPanel(cameraConfig({ Canon: ['Canon EOS R5'] }), { make: 'Canon', model: 'Canon EOS R6' });

    const model = await findByTestId('camera-model-Canon EOS R6');
    expect(model.querySelector('.bg-immich-primary')).not.toBeNull();
  });

  // The auto-expand effect reads the SAME state a make click is in the middle of changing: the click
  // sets the expansion locally and clears the model through the parent. If the effect ran against
  // the stale selection it would snap the expansion back to the old make and the click would appear
  // to do nothing.
  it('follows a click to another make instead of snapping back to the selected one', async () => {
    await renderPanel(cameraConfig({ Canon: ['Canon EOS R6'], Apple: ['iPhone 15'] }), {
      make: 'Canon',
      model: 'Canon EOS R6',
    });

    await findByTestId('camera-model-Canon EOS R6');
    await userEvent.click(page.getByTestId('camera-make-Apple'));
    await settle();

    expect(page.getByTestId('camera-model-iPhone 15').element()).toBeInTheDocument();
    expect(page.getByTestId('camera-model-Canon EOS R6').query()).toBeNull();
  });
});

/**
Reported as "the city chip is right but the panel only checks the country". The city path is
actually fine (see the ticked-city cases below); what was reported is the STATE path.

The viewer's location row renders city / state / country as three buttons, and plenty of places
carry the same word at two levels — Prague's EXIF is city "Prague", state "Prague", country "Czech
Republic" — so the middle button looks identical to the top one. It emits `{state, country}`,
which the chip renders correctly as "Prague, Czech Republic" and the server filters correctly,
but which the panel has no level for at all: it showed a lone ticked country. The filter was
invisible there, unremovable there, and silently AND-ed onto the next country or city clicked.
*/
describe('the panel reflects a contextual STATE filter', () => {
  beforeEach(() => localStorage.clear());

  const locationConfig = (cities: Record<string, string[]> = {}): FilterPanelConfig => ({
    sections: ['location'],
    suggestionsProvider: () => Promise.resolve(suggestions({ countries: ['Czech Republic', 'Germany'] })),
    providers: { cities: (country: string) => Promise.resolve(cities[country] ?? []) },
  });

  it('renders the state as a ticked row under its country', async () => {
    await renderPanel(locationConfig({ 'Czech Republic': ['Prague', 'Brno'] }), {
      country: 'Czech Republic',
      state: 'Prague',
    });

    const row = await findByTestId('location-state-Prague');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row.querySelector('.bg-immich-primary')).not.toBeNull();
  });

  // The dot belongs to the deepest selection. A ticked country next to a ticked state would read as
  // "the whole country", which is not what is being filtered.
  it('does not also tick the country while a state is selected', async () => {
    await renderPanel(locationConfig({ 'Czech Republic': ['Prague'] }), { country: 'Czech Republic', state: 'Prague' });

    await findByTestId('location-state-Prague');
    const country = page.getByTestId('location-country-Czech Republic').element();
    expect(country.querySelector('.bg-immich-primary')).toBeNull();
  });

  it('clears the state when its row is clicked, keeping the country', async () => {
    const onFiltersChange = vi.fn();
    await renderPanel(
      locationConfig({ 'Czech Republic': ['Prague'] }),
      { country: 'Czech Republic', state: 'Prague' },
      { onFiltersChange },
    );

    await userEvent.click(page.getByTestId('location-state-Prague'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Czech Republic', state: undefined, city: undefined }),
    );
  });

  // A state with no country can only arrive by URL, and it still has to be visible and clearable.
  it('renders a country-less state at the top level and clears it on click', async () => {
    const onFiltersChange = vi.fn();
    await renderPanel(locationConfig(), { state: 'Prague' }, { onFiltersChange });

    await userEvent.click(page.getByTestId('location-state-Prague'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ country: undefined, state: undefined, city: undefined }),
    );
  });

  // The three fields are ONE chip and one filter (getActiveFilterCount counts them once), so picking
  // a new country or city replaces the group. Leaving the old state behind would AND an invisible
  // predicate onto the new selection and usually return nothing.
  it('drops the stale state when another country is picked', async () => {
    const onFiltersChange = vi.fn();
    await renderPanel(locationConfig(), { country: 'Czech Republic', state: 'Prague' }, { onFiltersChange });

    await userEvent.click(page.getByTestId('location-country-Germany'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Germany', state: undefined, city: undefined }),
    );
  });

  it('drops the stale state when a city is picked', async () => {
    const onFiltersChange = vi.fn();
    await renderPanel(
      locationConfig({ 'Czech Republic': ['Prague', 'Brno'] }),
      { country: 'Czech Republic', state: 'Prague' },
      { onFiltersChange },
    );

    await userEvent.click(page.getByTestId('location-city-Brno'));

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ country: 'Czech Republic', city: 'Brno', state: undefined }),
    );
  });

  // The collapsed panel's "something is filtered" dot reads hasActiveFilter, which only knew about
  // city and country — so a state-only filter looked like no filter at all from the outside too.
  it('marks the location section active for a state-only filter', async () => {
    await renderPanel(
      {
        sections: ['location', 'rating'],
        suggestionsProvider: () => Promise.resolve(suggestions({ countries: ['Czech Republic'] })),
        providers: {},
      },
      { state: 'Prague' },
    );

    // The section toggles live inside the cog's popover since #912, so open it before reaching for
    // one — the same `openSectionMenu` step filter-panel.spec.ts grew for its own toggle tests.
    await userEvent.click(page.getByTestId('section-menu-btn'));

    await userEvent.click(page.getByTestId('section-toggle-location'));
    expect(page.getByTestId('section-toggle-dot-location').element()).toBeInTheDocument();
  });

  // The healthy path this bug was mistaken for — pinned here so a regression in it is unambiguous.
  it('still ticks a contextual CITY under its country', async () => {
    await renderPanel(locationConfig({ 'Czech Republic': ['Prague', 'Brno'] }), {
      country: 'Czech Republic',
      city: 'Prague',
    });

    const city = await findByTestId('location-city-Prague');
    expect(city.querySelector('.bg-immich-primary')).not.toBeNull();
    expect(page.getByTestId('location-state-Prague').query()).toBeNull();
  });
});

/**
Reported as a nice-to-have: after a contextual TAG filter the list "does not scroll to or visually
highlight the selected tag — with thousands of tags the active tag is effectively invisible".

The cause is truncation, not scrolling: both lists render a short head (10 tags, 5 people) until
"show more" is pressed, and neither reserves a slot for what is actually selected. Hoisting the
selection is better than scrolling to it — it needs no measurement, survives a re-fetch, and puts
selected-and-listed entries next to the already-top-pinned orphans rather than in two places.
*/
describe('the panel keeps a selected entry visible in a long list', () => {
  beforeEach(() => localStorage.clear());

  const tags = Array.from({ length: 40 }, (_, index) => ({
    id: `tag-${String(index).padStart(2, '0')}`,
    name: `Tag ${String(index).padStart(2, '0')}`,
  }));
  const people = Array.from({ length: 40 }, (_, index) => ({
    id: `person-${String(index).padStart(2, '0')}`,
    name: `Person ${String(index).padStart(2, '0')}`,
  }));

  it('hoists a selected tag from beyond the visible head', async () => {
    await renderPanel(
      {
        sections: ['tags'],
        suggestionsProvider: () => Promise.resolve(suggestions({ tags })),
        providers: {},
      },
      { tagIds: ['tag-30'] },
    );

    await vi.waitFor(() => expect(page.getByTestId(/^tags-item-/).elements()).toHaveLength(10));
    const row = await findByTestId('tags-item-tag-30');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(row.querySelector('.bg-immich-primary')).not.toBeNull();

    // It is hoisted, not appended: it is the first row of the list.
    const rendered = page.getByTestId(/^tags-item-/).elements();
    expect(rendered[0]).toBe(row);
    // And it does not cost an unselected row its slot — the head still shows 10.
    expect(rendered).toHaveLength(10);
  });

  it('hoists every selected tag, and keeps the show-more count honest', async () => {
    await renderPanel(
      {
        sections: ['tags'],
        suggestionsProvider: () => Promise.resolve(suggestions({ tags })),
        providers: {},
      },
      { tagIds: ['tag-30', 'tag-35'] },
    );

    await expect.element(page.getByTestId('tags-show-more')).toBeInTheDocument();
    expect(page.getByTestId('tags-item-tag-30').element()).toBeInTheDocument();
    expect(page.getByTestId('tags-item-tag-35').element()).toBeInTheDocument();
    expect(page.getByTestId('tags-show-more').element()).toMatchTextContent(/\b30\b/);
  });

  it('hoists a selected person from beyond the visible head', async () => {
    await renderPanel(
      {
        sections: ['people'],
        suggestionsProvider: () => Promise.resolve(suggestions({ people })),
        providers: {},
      },
      { personIds: ['person-30'] },
    );

    await vi.waitFor(() => expect(page.getByTestId(/^people-item-/).elements()).toHaveLength(5));
    const row = await findByTestId('people-item-person-30');
    expect(row.querySelector('.bg-immich-primary')).not.toBeNull();

    const rendered = page.getByTestId(/^people-item-/).elements();
    expect(rendered[0]).toBe(row);
    expect(rendered).toHaveLength(5);
  });

  it('leaves an unfiltered list in its original order', async () => {
    await renderPanel(
      {
        sections: ['tags'],
        suggestionsProvider: () => Promise.resolve(suggestions({ tags })),
        providers: {},
      },
      {},
    );

    await findByTestId('tags-item-tag-00');
    const rendered = page.getByTestId(/^tags-item-/).elements();
    expect(rendered.map((row) => (row as HTMLElement).dataset.testid)).toEqual(
      tags.slice(0, 10).map((tag) => `tags-item-${tag.id}`),
    );
  });
});
