import { PeopleSortBy, peopleViewSettings } from '#lib/gallery/stores/preferences.store.ts';
import { factory } from '#test/unit/factories.ts';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Explore from '../../../routes/(user)/explore/+page.svelte';
import Manage from './__mocks__/manage-page.svelte';

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: component } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: component };
});
vi.mock('#lib/components/shared-components/SingleGridRow.svelte', async () => {
  const { default: component } = await import('./__mocks__/preview-row.svelte');
  return { default: component };
});

const people = [
  factory.person({ id: 'alice', name: 'Alice', numberOfAssets: 2, isFavorite: false, isHidden: false }),
  factory.person({ id: 'bob', name: 'Bob', numberOfAssets: 20, isFavorite: false, isHidden: false }),
  factory.person({ id: 'zoe', name: 'Zoe', numberOfAssets: 1, isFavorite: true, isHidden: false }),
];
const response = { people, total: people.length, hidden: 0, hasNextPage: false };
const exploreData = { people: response, explore: [], memories: [], meta: { title: 'Explore' } };
const previewNames = () => [...document.querySelectorAll('a.text-center > p')].map((p) => p.textContent?.trim());
const visibilityIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="visibility-person-"]')].map((el) => el.dataset.testid);

beforeEach(() => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
});

afterEach(() => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
});

describe('Explore people order', () => {
  it('sorts by photo count before slicing the preview, keeping favorites first', async () => {
    await render(Explore, { data: exploreData });
    await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Bob']));
    expect(people.map(({ name }) => name)).toEqual(['Alice', 'Bob', 'Zoe']);
  });

  it('reacts to the saved name preference', async () => {
    await render(Explore, { data: exploreData });
    peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
    await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Alice']));
  });

  it('falls back to photo count for an unknown saved sort', async () => {
    peopleViewSettings.set({ sortBy: 'unknown' as PeopleSortBy });
    await render(Explore, { data: exploreData });
    await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Bob']));
  });
});

describe('Show and hide people order', () => {
  it('uses counts and favorites before mapping to visibility tiles', async () => {
    await render(Manage, { data: { people: response } });
    await vi.waitFor(() =>
      expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-bob', 'visibility-person-alice']),
    );
    peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
    await vi.waitFor(() =>
      expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-alice', 'visibility-person-bob']),
    );
  });

  it('keeps staged visibility toggles in place', async () => {
    await render(Manage, { data: { people: response } });
    await page.getByTestId('visibility-person-zoe').click();
    await expect.element(page.getByTestId('visibility-person-zoe')).toHaveAttribute('aria-pressed', 'true');
    expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-bob', 'visibility-person-alice']);
  });

  it('sorts new data alongside existing rows with hidden people last', async () => {
    const { rerender } = await render(Manage, { data: { people: response } });
    const extra = factory.person({
      id: 'hidden',
      name: 'Aaron',
      numberOfAssets: 100,
      isFavorite: true,
      isHidden: true,
    });
    await rerender({ data: { people: { ...response, people: [...people, extra], total: 4, hidden: 1 } } });
    await vi.waitFor(() =>
      expect(visibilityIds()).toEqual([
        'visibility-person-zoe',
        'visibility-person-bob',
        'visibility-person-alice',
        'visibility-person-hidden',
      ]),
    );
  });
});
