import TestWrapper from '#lib/components/TestWrapper.svelte';
import { factory } from '#test/unit/factories.ts';
import { Type, type PersonResponseDto, type SearchExploreResponseDto } from '@immich/sdk';
import type { Component } from 'svelte';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import ExplorePage from './+page.svelte';

vi.mock('#lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('#lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return factory.person({
    id: 'person-1',
    name: 'Alice',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });
}

async function renderPage(people: PersonResponseDto[] = [makePerson()], items: SearchExploreResponseDto[] = []) {
  const props = {
    data: {
      explore: items,
      people: {
        people,
        total: people.length,
        hidden: 0,
        hasNextPage: false,
      },
      memories: [],
      meta: { title: 'Explore' },
    },
  };

  return render(TestWrapper as Component<{ component: typeof ExplorePage; componentProps: typeof props }>, {
    component: ExplorePage,
    componentProps: props,
  });
}

describe('Explore page', () => {
  it('uses the user profile id for user-primary identity rows', async () => {
    await renderPage([
      makePerson({
        id: 'identity-1',
        name: 'Alice',
        primaryProfile: { type: Type.UserPerson, id: 'user-person-1' },
      }),
    ]);

    expect(page.getByRole('link', { name: 'Alice', exact: true }).element()).toHaveAttribute(
      'href',
      '/people/user-person-1?previousRoute=%2Fexplore',
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/api/people/user-person-1/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  it('routes a space-primary person to the identity-wide person page and space thumbnail', async () => {
    await renderPage([
      makePerson({
        id: 'identity-1',
        name: 'Shared Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
    ]);

    expect(page.getByRole('link', { name: 'Shared Alice', exact: true }).element()).toHaveAttribute(
      'href',
      '/people/space-person-1?previousRoute=%2Fexplore',
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/api/shared-spaces/space-1/people/space-person-1/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  // immich-32238 moved the favorite heart into upstream's PersonIndicator badge. Its "shared with me"
  // icon keys off `otherPeople`, which Gallery always sends empty (person sharing is dormant).
  it('badges a favorite person and leaves others unmarked', async () => {
    await renderPage([
      makePerson({ id: 'person-1', name: 'Alice', isFavorite: true }),
      makePerson({ id: 'person-2', name: 'Bob', isFavorite: false }),
    ]);

    // The badge icons carry their label as an SVG <title> element, which locators' getByTitle (title
    // attribute only) does not see.
    const svgTitles = (text: string) =>
      [...document.querySelectorAll('svg title')].filter((title) => title.textContent === text);
    expect(svgTitles('favorite')).toHaveLength(1);
    expect(page.getByRole('link', { name: /Alice/ }).element()).toContainElement(
      svgTitles('favorite')[0].parentElement as unknown as HTMLElement,
    );
    expect(svgTitles('shared_with_me')).toHaveLength(0);
  });

  // #867: place tiles used to open the deprecated /search view, which is owner-scoped and cannot
  // show shared-space assets. Send them to the filtered /photos timeline instead.
  it('links a place tile to the photos timeline filtered by that city', async () => {
    await renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [{ value: 'Cape Town', data: factory.asset({ id: 'asset-1' }) }],
        },
      ],
    );

    const link = page.getByRole('link', { name: /Cape Town/ }).element();
    expect(link).toHaveAttribute('href', '/photos?city=Cape%20Town');
  });

  // #989: the tile linked with `city` alone, so the location filter had no country to nest the
  // city under and rendered it flat beside the country list. The country is already on the
  // representative asset the strip renders — carry it through.
  it('scopes a place tile to the country of its representative asset', async () => {
    await renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [
            {
              value: 'Cape Town',
              data: factory.asset({ id: 'asset-1', exifInfo: { city: 'Cape Town', country: 'South Africa' } }),
            },
          ],
        },
      ],
    );

    const link = page.getByRole('link', { name: /Cape Town/ }).element();
    expect(link).toHaveAttribute('href', '/photos?city=Cape%20Town&country=South%20Africa');
  });

  // Reverse geocoding can resolve a city without a country. Falling back to the city-only link
  // keeps the tile working (as an orphaned selection) rather than emitting `country=`.
  it('falls back to a city-only link when the asset has no country', async () => {
    await renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [
            {
              value: 'Cape Town',
              data: factory.asset({ id: 'asset-1', exifInfo: { city: 'Cape Town', country: null } }),
            },
          ],
        },
      ],
    );

    expect(page.getByRole('link', { name: /Cape Town/ }).element()).toHaveAttribute('href', '/photos?city=Cape%20Town');
  });
});
