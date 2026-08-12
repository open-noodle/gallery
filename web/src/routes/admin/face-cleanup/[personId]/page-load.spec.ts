import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

describe('face cleanup guided review page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
  });

  it('gates the route behind the admin authenticate check', async () => {
    const url = new URL('https://gallery.test/admin/face-cleanup/person-1');

    await load({ url, params: { personId: 'person-1' } } as never);

    expect(authenticate).toHaveBeenCalledWith(url, { admin: true });
  });

  it('carries the personId param through and titles the page — no API calls of its own', async () => {
    const result = await load({
      url: new URL('https://gallery.test/admin/face-cleanup/person-1'),
      params: { personId: 'person-1' },
    } as never);

    expect(result).toEqual({
      personId: 'person-1',
      meta: { title: 'admin.face_cleanup_review_title' },
    });
  });
});
