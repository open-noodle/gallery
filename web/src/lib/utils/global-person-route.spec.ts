import { Type, updatePerson, updateSpacePerson, type PersonResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';
import { getPersonActions, updatePersonName } from '$lib/services/person.service';
import {
  getGlobalPersonHref,
  getGlobalPersonThumbnailUrl,
  getSpacePersonThumbnailUrl,
  getSpaceProfile,
} from '$lib/utils/global-person-route';
import { getPhotosPersonFilterThumbnailUrl } from '$lib/utils/photos-filter-options';

vi.mock('@immich/ui', async (orig) => ({
  ...(await orig<typeof import('@immich/ui')>()),
  toastManager: { primary: vi.fn(), danger: vi.fn() },
}));

vi.mock('@immich/sdk', async (orig) => ({
  ...(await orig<typeof import('@immich/sdk')>()),
  updatePerson: vi.fn(),
  updateSpacePerson: vi.fn(),
}));

const updatedAt = '2026-01-02T00:00:00.000Z';
const v = `?updatedAt=${encodeURIComponent(updatedAt)}`;
const person = (overrides: Partial<PersonResponseDto> = {}) =>
  ({ id: 'person-1', name: 'Ada', isHidden: false, isFavorite: false, updatedAt, ...overrides }) as PersonResponseDto;
const spaceProfile = { type: Type.SpacePerson, id: 'space-person-1', spaceId: 'space-1' };
const spaceRef = { spaceId: 'space-1', id: 'space-person-1' };
const personalThumb = `/api/people/person-1/thumbnail`;
const spaceThumb = `/api/shared-spaces/space-1/people/space-person-1/thumbnail`;

describe('person scope: which id and which thumbnail', () => {
  it.each([
    { name: 'personal, no profile', row: person(), ref: undefined, url: personalThumb + v },
    {
      name: 'personal, user-person primaryProfile',
      row: person({ id: 'row-1', primaryProfile: { type: Type.UserPerson, id: 'person-1' } }),
      ref: undefined,
      url: personalThumb + v,
    },
    {
      name: 'personal, spacePersonId outside a space',
      row: person({ spacePersonId: 'space-person-1' }),
      ref: undefined,
      url: personalThumb + v,
    },
    {
      name: 'personal, inside a space without spacePersonId',
      row: person(),
      spaceId: 'space-1',
      ref: undefined,
      url: personalThumb + v,
    },
    {
      name: 'space, via primaryProfile',
      row: person({ primaryProfile: spaceProfile }),
      ref: spaceRef,
      url: spaceThumb + v,
    },
    {
      name: 'space, via spacePersonId inside a space',
      row: person({ spacePersonId: 'space-person-1' }),
      spaceId: 'space-1',
      ref: spaceRef,
      url: spaceThumb + v,
    },
  ])('$name', ({ row, spaceId, ref, url }) => {
    expect(getSpaceProfile(row, spaceId)).toEqual(ref);
    expect(getGlobalPersonThumbnailUrl(row, { spaceId })).toBe(url);
  });

  it.each([
    {
      name: 'space-person row, its own spaceId',
      url: getSpacePersonThumbnailUrl({ ...spaceRef, updatedAt }),
      expected: spaceThumb + v,
    },
    {
      name: 'filter row, space primaryProfile',
      url: getPhotosPersonFilterThumbnailUrl({ id: 'space-person:space-person-1', primaryProfile: spaceProfile }),
      expected: spaceThumb,
    },
    {
      name: 'filter row, user primaryProfile',
      url: getPhotosPersonFilterThumbnailUrl({
        id: 'person:person-1',
        primaryProfile: { type: Type.UserPerson, id: 'person-1' },
      }),
      expected: personalThumb,
    },
    {
      name: 'filter row, bare person token',
      url: getPhotosPersonFilterThumbnailUrl({ id: 'person:person-1' }),
      expected: personalThumb,
    },
    {
      name: 'filter row inside a space, raw id',
      url: getPhotosPersonFilterThumbnailUrl({ id: 'space-person-1' }, 'space-1'),
      expected: spaceThumb,
    },
  ])('$name', ({ url, expected }) => {
    expect(url).toBe(expected);
  });

  it('routes both scopes to the person page by profile id', () => {
    expect(getGlobalPersonHref(person({ primaryProfile: spaceProfile }), '/explore')).toBe(
      '/people/space-person-1?previousRoute=%2Fexplore',
    );
  });
});

describe('person scope: which action', () => {
  const $t = ((key: string) => key) as unknown as MessageFormatter;
  const spaceWrite = (dto: object) => ({ id: 'space-1', personId: 'space-person-1', sharedSpacePersonUpdateDto: dto });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updatePerson).mockResolvedValue(person());
    vi.mocked(updateSpacePerson).mockResolvedValue({ ...spaceRef, name: 'Bea', isHidden: true } as never);
  });

  const personal = {
    endpoint: updatePerson,
    other: updateSpacePerson,
    hide: { id: 'person-1', personUpdateDto: { isHidden: true } },
    rename: { id: 'person-1', personUpdateDto: { name: 'Bea' } },
  };
  const space = {
    endpoint: updateSpacePerson,
    other: updatePerson,
    hide: spaceWrite({ isHidden: true }),
    rename: spaceWrite({ name: 'Bea' }),
  };

  it.each([
    { scope: 'personal', row: person(), favorite: true, unfavorite: false, ...personal },
    { scope: 'personal favorite', row: person({ isFavorite: true }), favorite: false, unfavorite: true, ...personal },
    { scope: 'space', row: person({ primaryProfile: spaceProfile }), favorite: false, unfavorite: false, ...space },
    {
      scope: 'space favorite',
      row: person({ primaryProfile: spaceProfile, isFavorite: true }),
      favorite: false,
      unfavorite: false,
      ...space,
    },
  ])('$scope: hide, favorite and edit target', async ({ row, favorite, unfavorite, endpoint, other, hide, rename }) => {
    const { HidePerson, Favorite, Unfavorite } = getPersonActions($t, row);

    expect(Favorite.$if?.()).toBe(favorite);
    expect(Unfavorite.$if?.()).toBe(unfavorite);
    expect(HidePerson.$if?.()).toBe(true);
    await HidePerson.onAction({ action: HidePerson, event: new Event('click') });
    expect(endpoint).toHaveBeenCalledExactlyOnceWith(hide);

    vi.mocked(endpoint).mockClear();
    await updatePersonName(row, 'Bea');
    expect(endpoint).toHaveBeenCalledExactlyOnceWith(rename);
    expect(other).not.toHaveBeenCalled();
  });
});
