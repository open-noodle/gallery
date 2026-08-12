import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

describe('face cleanup manual dashboard page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
    sdkMock.searchUsersAdmin.mockResolvedValue([]);
  });

  it('gates the route behind the admin authenticate check', async () => {
    const url = new URL('https://gallery.test/admin/face-cleanup/people');

    await load({ url } as never);

    expect(authenticate).toHaveBeenCalledWith(url, { admin: true });
  });

  it('loads the owner list (drives the owner selector) and titles the page', async () => {
    const users = [{ id: 'user-1' }];
    sdkMock.searchUsersAdmin.mockResolvedValue(users as never);

    const result = await load({ url: new URL('https://gallery.test/admin/face-cleanup/people') } as never);

    expect(sdkMock.searchUsersAdmin).toHaveBeenCalledWith({ withDeleted: true });
    expect(result).toEqual({
      users,
      meta: { title: 'admin.face_cleanup_mode_manual' },
    });
  });
});
