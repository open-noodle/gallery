import { Type, type PersonResponseDto, type SearchExploreResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import type { Component } from 'svelte';
import TestWrapper from '$lib/components/TestWrapper.svelte';
import { assetFactory } from '@test-data/factories/asset-factory';
import { personFactory } from '@test-data/factories/person-factory';
import ExplorePage from './+page.svelte';

vi.mock('$lib/components/layouts/UserPageLayout.svelte', async () => {
  const { default: MockComponent } = await import('$lib/components/spaces/mock-user-page-layout.test-wrapper.svelte');
  return { default: MockComponent };
});

function makePerson(overrides: Partial<PersonResponseDto> = {}): PersonResponseDto {
  return personFactory.build({
    id: 'person-1',
    name: 'Alice',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  });
}

function renderPage(people: PersonResponseDto[] = [makePerson()], items: SearchExploreResponseDto[] = []) {
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
  it('uses the user profile id for user-primary identity rows', () => {
    renderPage([
      makePerson({
        id: 'identity-1',
        name: 'Alice',
        primaryProfile: { type: Type.UserPerson, id: 'user-person-1' },
      }),
    ]);

    expect(screen.getByRole('link', { name: 'Alice' })).toHaveAttribute(
      'href',
      '/people/user-person-1?previousRoute=%2Fexplore',
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/api/people/user-person-1/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  it('routes a space-primary person to the identity-wide person page and space thumbnail', () => {
    renderPage([
      makePerson({
        id: 'identity-1',
        name: 'Shared Alice',
        primaryProfile: { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' },
      }),
    ]);

    expect(screen.getByRole('link', { name: 'Shared Alice' })).toHaveAttribute(
      'href',
      '/people/space-person-1?previousRoute=%2Fexplore',
    );
    expect(document.querySelector('img')).toHaveAttribute(
      'src',
      '/api/shared-spaces/space-1/people/space-person-1/thumbnail?updatedAt=2026-01-02T00%3A00%3A00.000Z',
    );
  });

  // #867: place tiles used to open the deprecated /search view, which is owner-scoped and cannot
  // show shared-space assets. Send them to the filtered /photos timeline instead.
  it('links a place tile to the photos timeline filtered by that city', () => {
    renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [{ value: 'Cape Town', data: assetFactory.build({ id: 'asset-1' }) }],
        },
      ],
    );

    const link = screen.getByRole('link', { name: /Cape Town/ });
    expect(link).toHaveAttribute('href', '/photos?city=Cape%20Town');
  });

  // #989: the tile linked with `city` alone, so the location filter had no country to nest the
  // city under and rendered it flat beside the country list. The country is already on the
  // representative asset the strip renders — carry it through.
  it('scopes a place tile to the country of its representative asset', () => {
    renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [
            {
              value: 'Cape Town',
              data: assetFactory.build({ id: 'asset-1', exifInfo: { city: 'Cape Town', country: 'South Africa' } }),
            },
          ],
        },
      ],
    );

    const link = screen.getByRole('link', { name: /Cape Town/ });
    expect(link).toHaveAttribute('href', '/photos?city=Cape%20Town&country=South%20Africa');
  });

  // Reverse geocoding can resolve a city without a country. Falling back to the city-only link
  // keeps the tile working (as an orphaned selection) rather than emitting `country=`.
  it('falls back to a city-only link when the asset has no country', () => {
    renderPage(
      [],
      [
        {
          fieldName: 'exifInfo.city',
          items: [
            {
              value: 'Cape Town',
              data: assetFactory.build({ id: 'asset-1', exifInfo: { city: 'Cape Town', country: null } }),
            },
          ],
        },
      ],
    );

    expect(screen.getByRole('link', { name: /Cape Town/ })).toHaveAttribute('href', '/photos?city=Cape%20Town');
  });
});
