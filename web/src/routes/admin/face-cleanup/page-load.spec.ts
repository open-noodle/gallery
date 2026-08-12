import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

describe('face cleanup dashboard page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
    sdkMock.searchUsersAdmin.mockResolvedValue([]);
    sdkMock.getLatestScan.mockResolvedValue(null as never);
  });

  it('gates the route behind the admin authenticate check', async () => {
    const url = new URL('https://gallery.test/admin/face-cleanup');

    await load({ url } as never);

    expect(authenticate).toHaveBeenCalledWith(url, { admin: true });
  });

  it('loads the user list and latest scan, and titles the page', async () => {
    const users = [{ id: 'user-1' }];
    const scan = { id: 'scan-1', status: 'completed' };
    sdkMock.searchUsersAdmin.mockResolvedValue(users as never);
    sdkMock.getLatestScan.mockResolvedValue(scan as never);

    const result = await load({ url: new URL('https://gallery.test/admin/face-cleanup') } as never);

    expect(sdkMock.searchUsersAdmin).toHaveBeenCalledWith({ withDeleted: true });
    expect(result).toEqual({
      users,
      scan,
      meta: { title: 'admin.face_cleanup' },
    });
  });

  // A rejecting getLatestScan means "never scanned" (dashboard already treats a resolved null the same
  // way) — the load must not itself reject and take the whole page down with it.
  it('swallows a failed latest-scan fetch into a null scan rather than rejecting the load', async () => {
    sdkMock.getLatestScan.mockRejectedValue(new Error('network down'));

    await expect(load({ url: new URL('https://gallery.test/admin/face-cleanup') } as never)).resolves.toMatchObject({
      scan: null,
    });
  });
});
