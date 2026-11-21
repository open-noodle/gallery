import { PeopleSortBy, peopleViewSettings } from '#lib/gallery/stores/preferences.store.ts';
import { Route } from '#lib/route.ts';
import { factory } from '#test/unit/factories.ts';
import { test } from '#test/unit/fixtures.ts';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import Page from './+page.svelte';
import { load } from './+page.ts';

const people = [
  factory.person({ id: 'alice', name: 'Alice', numberOfAssets: 2, isFavorite: false, isHidden: false }),
  factory.person({ id: 'bob', name: 'Bob', numberOfAssets: 20, isFavorite: false, isHidden: false }),
  factory.person({ id: 'zoe', name: 'Zoe', numberOfAssets: 1, isFavorite: true, isHidden: false }),
];
const visibilityIds = () =>
  [...document.querySelectorAll<HTMLElement>('[data-testid^="visibility-person-"]')].map((el) => el.dataset.testid);

test.beforeEach(async ({ data, router }) => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
  data.addPeople(people);
  await router.goto(`${Route.people()}/manage`);
});

test.afterEach(() => {
  peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount });
});

test('uses counts and favorites before mapping to visibility tiles', async ({ render }) => {
  await render(Page, load);
  await vi.waitFor(() =>
    expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-bob', 'visibility-person-alice']),
  );
  peopleViewSettings.set({ sortBy: PeopleSortBy.Name });
  await vi.waitFor(() =>
    expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-alice', 'visibility-person-bob']),
  );
});

test('keeps staged visibility toggles in place', async ({ render }) => {
  await render(Page, load);
  await page.getByTestId('visibility-person-zoe').click();
  await expect.element(page.getByTestId('visibility-person-zoe')).toHaveAttribute('aria-pressed', 'true');
  expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-bob', 'visibility-person-alice']);
});

test('sorts a newly fetched page alongside existing rows with hidden people last', async ({ api, render, settle }) => {
  const extra = [
    factory.person({ id: 'dave', name: 'Dave', numberOfAssets: 100, isFavorite: false, isHidden: false }),
    factory.person({ id: 'hidden', name: 'Aaron', numberOfAssets: 200, isFavorite: true, isHidden: true }),
  ];
  let release = () => {};
  const secondPage = new Promise<void>((resolve) => (release = resolve));
  api.on({
    getAllPeople: async ({ params = {} }) => {
      if (params.page === 2) {
        await secondPage;
        return { json: { people: extra, total: 5, hidden: 1, hasNextPage: false } };
      }
      return { json: { people, total: 5, hidden: 1, hasNextPage: true } };
    },
  });
  await render(Page, load);
  await vi.waitFor(() =>
    expect(visibilityIds()).toEqual(['visibility-person-zoe', 'visibility-person-bob', 'visibility-person-alice']),
  );
  release();
  await page.getByTestId('visibility-person-alice').hover();
  await settle();
  await vi.waitFor(() =>
    expect(visibilityIds()).toEqual([
      'visibility-person-zoe',
      'visibility-person-dave',
      'visibility-person-bob',
      'visibility-person-alice',
      'visibility-person-hidden',
    ]),
  );
  expect(api.getAllPeople).toHaveBeenCalledWith({ params: { withHidden: true, page: 2 } });
});
