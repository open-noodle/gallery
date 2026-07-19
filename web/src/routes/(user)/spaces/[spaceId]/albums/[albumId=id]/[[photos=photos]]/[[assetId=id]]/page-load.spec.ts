import {
  SharedSpaceRole,
  type AlbumResponseDto,
  type SharedSpaceMemberResponseDto,
  type SharedSpaceResponseDto,
} from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate } = vi.hoisted(() => ({
  authenticate: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));

const space: SharedSpaceResponseDto = {
  id: 'space-1',
  name: 'Test Space',
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: 'owner-user-id',
} as SharedSpaceResponseDto;

const members: SharedSpaceMemberResponseDto[] = [
  {
    userId: 'current-user-id',
    email: 'user@example.com',
    name: 'Current User',
    role: SharedSpaceRole.Editor,
    showInTimeline: false,
    joinedAt: '2026-01-01T00:00:00.000Z',
  } as SharedSpaceMemberResponseDto,
];

const linkedAlbums = [
  {
    id: 'album-1',
    albumName: 'Vacation',
    assetCount: 5,
    albumThumbnailAssetId: null,
    showInTimeline: true,
    addedById: null,
    linkedAt: '2026-01-01T00:00:00.000Z',
    albumUsers: [],
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: false,
  },
];

const album = {
  id: 'album-1',
  albumName: 'Vacation',
  assetCount: 5,
  shared: false,
  albumUsers: [],
  hasSharedLink: false,
  isActivityEnabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
} as unknown as AlbumResponseDto;

const makeEvent = (overrides: { linkedAlbums?: typeof linkedAlbums } = {}) => ({
  url: new URL('https://gallery.test/spaces/space-1/albums/album-1'),
  params: { spaceId: 'space-1', albumId: 'album-1' },
  parent: vi.fn().mockResolvedValue({
    space,
    members,
    linkedAlbums: overrides.linkedAlbums ?? linkedAlbums,
  }),
});

describe('space album detail page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    sdkMock.getAlbumInfo.mockResolvedValue(album as never);
  });

  it('calls authenticate, reads linkedAlbums from parent(), calls getAlbumInfo, returns album + meta', async () => {
    const event = makeEvent();

    const result = await load(event as never);

    expect(authenticate).toHaveBeenCalledWith(event.url);
    expect(event.parent).toHaveBeenCalled();
    // Must NOT call the individual space/members/albums SDK methods (they come from layout)
    expect(sdkMock.getSpace).not.toHaveBeenCalled();
    expect(sdkMock.getMembers).not.toHaveBeenCalled();
    expect(sdkMock.getSharedSpaceAlbums).not.toHaveBeenCalled();
    expect(sdkMock.getAlbumInfo).toHaveBeenCalledWith({ id: 'album-1' });

    expect(result).toEqual({
      album,
      meta: { title: 'Vacation' },
    });
  });

  it('redirects to /spaces/:id/albums and does NOT call getAlbumInfo when album is not linked to this space', async () => {
    const event = makeEvent({ linkedAlbums: [] });
    sdkMock.getAlbumInfo.mockResolvedValue(album as never); // would succeed if called — but must NOT be called

    let thrown: unknown;
    try {
      await load(event as never);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/spaces/space-1/albums');
    expect(sdkMock.getAlbumInfo).not.toHaveBeenCalled();
  });

  it('redirects when the album is present in the space but for a different albumId', async () => {
    const event = makeEvent({ linkedAlbums: [{ ...linkedAlbums[0], id: 'other-album' }] });

    let thrown: unknown;
    try {
      await load(event as never);
    } catch (error) {
      thrown = error;
    }

    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/spaces/space-1/albums');
    expect(sdkMock.getAlbumInfo).not.toHaveBeenCalled();
  });
});
