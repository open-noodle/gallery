import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { authenticate } from '$lib/utils/auth';
import { load } from './+layout';

vi.mock('$lib/utils/auth', () => ({ authenticate: vi.fn().mockResolvedValue(undefined) }));

describe('space [spaceId] +layout.ts load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkMock.getSpace.mockResolvedValue({ id: 's1', name: 'Trip' } as never);
    sdkMock.getMembers.mockResolvedValue([{ userId: 'u1', role: 'owner' }] as never);
    sdkMock.getSharedSpaceAlbums.mockResolvedValue([{ albumId: 'a1' }, { albumId: 'a2' }] as never);
  });

  it('authenticates and loads space, members and linked albums', async () => {
    const url = new URL('https://gallery.test/spaces/s1');
    const result = await load({ url, params: { spaceId: 's1' } } as never);

    expect(authenticate).toHaveBeenCalledWith(url);
    expect(sdkMock.getSpace).toHaveBeenCalledWith({ id: 's1' });
    expect(sdkMock.getMembers).toHaveBeenCalledWith({ id: 's1' });
    expect(sdkMock.getSharedSpaceAlbums).toHaveBeenCalledWith({ id: 's1' });
    expect(result.space).toEqual({ id: 's1', name: 'Trip' });
    expect(result.members).toHaveLength(1);
    expect(result.linkedAlbums).toHaveLength(2);
  });

  it('redirects to the spaces list when the space is gone or access was revoked (404/403)', async () => {
    sdkMock.getSpace.mockRejectedValue({ status: 404 });
    const url = new URL('https://gallery.test/spaces/s1');
    await expect(load({ url, params: { spaceId: 's1' } } as never)).rejects.toMatchObject({ status: 302 });
  });
});
