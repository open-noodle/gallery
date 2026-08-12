import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { createFilterState, type FilterState } from '$lib/components/filter-panel/filter-panel';
import { resolveFilterNames } from '$lib/utils/filter-name-resolution';

// The "fails soft" test below is only non-vacuous if the error-handling module is a NAMED mock we
// can assert against: without this, "shows no toast" would pass against any implementation that
// simply never imports handleError.
const { handleErrorMock } = vi.hoisted(() => ({ handleErrorMock: vi.fn() }));
vi.mock('$lib/utils/handle-error', () => ({
  handleError: handleErrorMock,
  handleErrorAsync: vi.fn(),
  getServerErrorMessage: vi.fn(),
  standardizeError: vi.fn(),
}));

const ALBUM_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const OWNER_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

const emptyNames = () => ({ albumNames: new Map<string, string>(), ownerNames: new Map<string, string>() });
const withFilters = (overrides: Partial<FilterState>): FilterState => ({ ...createFilterState(), ...overrides });

describe('resolveFilterNames', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('resolves an album name by id and fills albumNames', async () => {
    sdkMock.getAlbumInfo.mockResolvedValue({ id: ALBUM_ID, albumName: 'Summer 2026' } as never);
    const names = emptyNames();

    await resolveFilterNames(withFilters({ albumId: ALBUM_ID }), names);

    expect(sdkMock.getAlbumInfo).toHaveBeenCalledWith({ id: ALBUM_ID });
    expect(names.albumNames.get(ALBUM_ID)).toBe('Summer 2026');
  });

  it('resolves an owner name by id and fills ownerNames', async () => {
    sdkMock.getUser.mockResolvedValue({ id: OWNER_ID, name: 'Alice' } as never);
    const names = emptyNames();

    await resolveFilterNames(withFilters({ ownerId: OWNER_ID }), names);

    expect(sdkMock.getUser).toHaveBeenCalledWith({ id: OWNER_ID });
    expect(names.ownerNames.get(OWNER_ID)).toBe('Alice');
  });

  it('fetches at most once per id — a re-render must not refetch', async () => {
    sdkMock.getAlbumInfo.mockResolvedValue({ id: ALBUM_ID, albumName: 'Summer 2026' } as never);
    const names = emptyNames();
    const filters = withFilters({ albumId: ALBUM_ID });

    await resolveFilterNames(filters, names);
    await resolveFilterNames(filters, names);

    expect(sdkMock.getAlbumInfo).toHaveBeenCalledTimes(1);
  });

  it('does not fetch again while a resolution for the same id is still in flight', async () => {
    sdkMock.getAlbumInfo.mockResolvedValue({ id: ALBUM_ID, albumName: 'Summer 2026' } as never);
    const names = emptyNames();
    const filters = withFilters({ albumId: ALBUM_ID });

    await Promise.all([resolveFilterNames(filters, names), resolveFilterNames(filters, names)]);

    expect(sdkMock.getAlbumInfo).toHaveBeenCalledTimes(1);
    expect(names.albumNames.get(ALBUM_ID)).toBe('Summer 2026');
  });

  it('fills a SECOND, different map instance too when its call joins an already in-flight resolution', async () => {
    // Regression for the dedupe cache writing only into the first caller's map: a client-side nav
    // from one surface to another (e.g. /photos?albumId=X -> /map?albumId=X) while the first
    // request is still in flight owns its OWN names map, and must still receive the resolved name.
    sdkMock.getAlbumInfo.mockResolvedValue({ id: ALBUM_ID, albumName: 'Summer 2026' } as never);
    const namesA = emptyNames();
    const namesB = emptyNames();
    const filters = withFilters({ albumId: ALBUM_ID });

    await Promise.all([resolveFilterNames(filters, namesA), resolveFilterNames(filters, namesB)]);

    expect(sdkMock.getAlbumInfo).toHaveBeenCalledTimes(1);
    expect(namesA.albumNames.get(ALBUM_ID)).toBe('Summer 2026');
    expect(namesB.albumNames.get(ALBUM_ID)).toBe('Summer 2026');
  });

  it('does not fetch when the maps already hold the ids', async () => {
    const names = {
      albumNames: new Map([[ALBUM_ID, 'Already Known Album']]),
      ownerNames: new Map([[OWNER_ID, 'Already Known Owner']]),
    };

    await resolveFilterNames(withFilters({ albumId: ALBUM_ID, ownerId: OWNER_ID }), names);

    expect(sdkMock.getAlbumInfo).not.toHaveBeenCalled();
    expect(sdkMock.getUser).not.toHaveBeenCalled();
    expect(names.albumNames.get(ALBUM_ID)).toBe('Already Known Album');
    expect(names.ownerNames.get(OWNER_ID)).toBe('Already Known Owner');
  });

  it('does not fetch when albumId and ownerId are unset', async () => {
    const names = emptyNames();

    await resolveFilterNames(withFilters({}), names);

    expect(sdkMock.getAlbumInfo).not.toHaveBeenCalled();
    expect(sdkMock.getUser).not.toHaveBeenCalled();
  });

  it('fails soft: resolves, leaves the map unmodified, and raises no error toast', async () => {
    sdkMock.getAlbumInfo.mockRejectedValue(new Error('403 Forbidden'));
    const names = emptyNames();

    await expect(resolveFilterNames(withFilters({ albumId: ALBUM_ID }), names)).resolves.toBeUndefined();

    // The chip keeps its `?? id` fallback rather than showing a wrong/empty name.
    expect(names.albumNames.has(ALBUM_ID)).toBe(false);
    expect(handleErrorMock).not.toHaveBeenCalled();
  });

  it('tolerates an undefined response without filling the map', async () => {
    sdkMock.getAlbumInfo.mockResolvedValue(undefined as never);
    sdkMock.getUser.mockResolvedValue(undefined as never);
    const names = emptyNames();

    await expect(
      resolveFilterNames(withFilters({ albumId: ALBUM_ID, ownerId: OWNER_ID }), names),
    ).resolves.toBeUndefined();

    expect(names.albumNames.has(ALBUM_ID)).toBe(false);
    expect(names.ownerNames.has(OWNER_ID)).toBe(false);
  });
});
