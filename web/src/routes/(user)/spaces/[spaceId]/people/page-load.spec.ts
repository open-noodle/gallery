import { SharedSpaceRole } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
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
  });

  it('authenticates and loads space people with overview statistics', async () => {
    const event = makeEvent();
    await expect(load(event as never)).resolves.toEqual({
      people,
      peopleStatistics,
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
    });
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
