import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

describe('face cleanup resolutions page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
  });

  it('gates the route behind the admin authenticate check', async () => {
    const url = new URL('https://gallery.test/admin/face-cleanup/resolutions');

    await load({ url } as never);

    expect(authenticate).toHaveBeenCalledWith(url, { admin: true });
  });

  it('titles the page — the list itself is fetched client-side', async () => {
    const result = await load({ url: new URL('https://gallery.test/admin/face-cleanup/resolutions') } as never);

    expect(result).toEqual({ meta: { title: 'admin.face_cleanup_resolutions_title' } });
  });
});
