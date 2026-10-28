import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

describe('face cleanup dissolved page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
  });

  it('gates the route behind the admin authenticate check and titles the page', async () => {
    const url = new URL('https://gallery.test/admin/face-cleanup/dissolved');

    const result = await load({ url } as never);

    expect(authenticate).toHaveBeenCalledWith(url, { admin: true });
    expect(result).toEqual({ meta: { title: 'admin.face_cleanup_dissolved' } });
  });
});
