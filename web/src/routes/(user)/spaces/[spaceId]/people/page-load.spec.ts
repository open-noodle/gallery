import { SharedSpaceRole } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { PeopleFilterBy, PeopleSortBy, peopleViewSettings } from '$lib/stores/preferences.store';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

describe('space people page load', () => {
  const space = {
    id: 'space-1',
    name: 'Test Space',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdById: 'owner-user-id',
    faceRecognitionEnabled: true,
  };

  const members = [
    {
      userId: 'current-user-id',
      email: 'user@example.com',
      name: 'Current User',
      role: SharedSpaceRole.Editor,
      showInTimeline: false,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const linkedAlbums = [
    {
      albumId: 'a1',
      albumName: 'Trip',
      assetCount: 2,
      showInTimeline: true,
      addedById: null,
      albumThumbnailAssetId: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  const people = [
    {
      id: 'person-1',
      spaceId: 'space-1',
      name: 'Alice',
      thumbnailPath: '',
      isHidden: false,
      birthDate: null,
      representativeFaceId: null,
      representativeFaceSource: 'auto',
      faceCount: 3,
      assetCount: 4,
      alias: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      type: 'person',
    },
  ];

  const peopleStatistics = {
    total: 12,
    hidden: 2,
    detectedFaceCount: 1980,
  };

  const makeEvent = (overrides: { spaceId?: string } = {}) => ({
    url: new URL(`https://gallery.test/spaces/${overrides.spaceId ?? 'space-1'}/people`),
    params: { spaceId: overrides.spaceId ?? 'space-1' },
    parent: vi.fn().mockResolvedValue({ space, members, linkedAlbums }),
  });

  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getSpacePeople.mockResolvedValue(people as never);
    sdkMock.getSpacePeopleStatistics.mockResolvedValue(peopleStatistics);
    peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount, filterBy: PeopleFilterBy.All });
  });

  it('authenticates and loads space people with overview statistics', async () => {
    const event = makeEvent();
    await expect(load(event as never)).resolves.toEqual({
      people,
      peopleStatistics,
      hasSpacePeople: true,
    });

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(event.parent).toHaveBeenCalled();
    // space + members no longer fetched by the page loader — they come from the layout
    expect(sdkMock.getSpace).not.toHaveBeenCalled();
    expect(sdkMock.getMembers).not.toHaveBeenCalled();
    expect(sdkMock.getSpacePeople).toHaveBeenCalledWith({ id: 'space-1', limit: 100 });
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledWith({ id: 'space-1' });
    expect(sdkMock.getSpacePeopleFaceStatistics).not.toHaveBeenCalled();
  });

  it('keeps the space people list when overview statistics fail', async () => {
    sdkMock.getSpacePeopleStatistics.mockRejectedValue(new Error('stats unavailable'));

    await expect(load(makeEvent() as never)).resolves.toEqual({
      people,
      peopleStatistics: null,
      hasSpacePeople: true,
    });
  });

  // The tab used to load unfiltered and re-apply the persisted filter in onMount, so refreshing
  // under a Pets filter painted the whole people list for one round trip before narrowing to pets.
  it('applies a persisted Pets filter to the first request', async () => {
    peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount, filterBy: PeopleFilterBy.Pets });
    const filtered = { total: 3, hidden: 0, detectedFaceCount: 40 };
    sdkMock.getSpacePeopleStatistics.mockImplementation((query: { $type?: string }) =>
      Promise.resolve(query.$type ? filtered : peopleStatistics),
    );

    const result = await load(makeEvent() as never);

    expect(sdkMock.getSpacePeople).toHaveBeenCalledWith({ id: 'space-1', limit: 100, $type: 'pet' });
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledWith({ id: 'space-1', $type: 'pet' });
    expect(result.peopleStatistics).toEqual(filtered);
    // The filtered queries already found people, so the gate is answered without a second request.
    expect(result.hasSpacePeople).toBe(true);
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledTimes(1);
  });

  // The show/hide screen is the one place a misdetected species bucket can be corrected, so a Pets
  // filter matching nothing must not hide it — that, and only that, is worth a second request.
  it('spends one extra statistics request only when the active filter matches nothing', async () => {
    peopleViewSettings.set({ sortBy: PeopleSortBy.PhotoCount, filterBy: PeopleFilterBy.Pets });
    sdkMock.getSpacePeople.mockResolvedValue([] as never);
    sdkMock.getSpacePeopleStatistics.mockImplementation((query: { $type?: string }) =>
      Promise.resolve(query.$type ? { total: 0, hidden: 0, detectedFaceCount: 0 } : peopleStatistics),
    );

    const result = await load(makeEvent() as never);

    expect(result.hasSpacePeople).toBe(true);
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledWith({ id: 'space-1' });
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledTimes(2);
  });

  it('reports no people when the space is genuinely empty', async () => {
    sdkMock.getSpacePeople.mockResolvedValue([] as never);
    sdkMock.getSpacePeopleStatistics.mockResolvedValue({ total: 0, hidden: 0, detectedFaceCount: 0 });

    const result = await load(makeEvent() as never);

    expect(result.hasSpacePeople).toBe(false);
    // No filter is active, so the single statistics call already answered the gate.
    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledTimes(1);
  });

  it('does not spend a second statistics request under the All filter', async () => {
    await load(makeEvent() as never);

    expect(sdkMock.getSpacePeopleStatistics).toHaveBeenCalledTimes(1);
    expect(sdkMock.getSpacePeople).toHaveBeenCalledWith({ id: 'space-1', limit: 100 });
  });

  it('still rejects when the people list fails', async () => {
    const error = new Error('people unavailable');
    sdkMock.getSpacePeople.mockRejectedValue(error);

    await expect(load(makeEvent() as never)).rejects.toThrow(error);
  });

  it('redirects to Photos when face recognition is disabled', async () => {
    const event = {
      ...makeEvent(),
      parent: vi.fn().mockResolvedValue({ space: { ...space, faceRecognitionEnabled: false }, members, linkedAlbums }),
    };

    await expect(load(event as never)).rejects.toMatchObject({ status: 307 });

    // people APIs should not be called when redirecting
    expect(sdkMock.getSpacePeople).not.toHaveBeenCalled();
  });
});
