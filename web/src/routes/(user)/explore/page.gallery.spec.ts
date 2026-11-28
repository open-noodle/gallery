import { PeopleSortBy, peopleViewSettings } from '#lib/gallery/stores/preferences.store.ts';
import { Route } from '#lib/route.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect } from 'vitest';
import Page from './+page.svelte';
import { load } from './+page.ts';

// Fix the row capacity independently of CSS so this checks sorting before the preview slice.
vi.mock('#lib/components/shared-components/SingleGridRow.svelte', async () => {
  const { default: component } = await import('#lib/gallery/people/__mocks__/preview-row.svelte');
  return { default: component };
});

const people = [
  factory.person({ id: 'alice', name: 'Alice', numberOfAssets: 2, isFavorite: false, isHidden: false }),
  factory.person({ id: 'bob', name: 'Bob', numberOfAssets: 20, isFavorite: false, isHidden: false }),
  factory.person({ id: 'zoe', name: 'Zoe', numberOfAssets: 1, isFavorite: true, isHidden: false }),
];
const previewNames = () => [...document.querySelectorAll('a.text-center > p')].map((p) => p.textContent?.trim());

test.beforeEach(async ({ api, data, router }) => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
  data.addPeople(people);
  api.on({ getExploreData: () => ({ json: [] }) });
  await router.goto(Route.explore());
});

test.afterEach(() => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
});

test('sorts by photo count before slicing the preview, keeping favorites first', async ({ api, render }) => {
  await render(Page, load);
  await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Bob']));
  expect(api.getAllPeople).toHaveBeenCalledWith({ params: { withHidden: false, withSharedSpaces: true } });
  expect(people.map(({ name }) => name)).toEqual(['Alice', 'Bob', 'Zoe']);
});

test('reacts to the saved name preference', async ({ render }) => {
  await render(Page, load);
  peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
  await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Alice']));
});

test('falls back to photo count for an unknown saved sort', async ({ render }) => {
  peopleViewSettings.set({ sortBy: 'unknown' as PeopleSortBy });
  await render(Page, load);
  await vi.waitFor(() => expect(previewNames()).toEqual(['Zoe', 'Bob']));
});
