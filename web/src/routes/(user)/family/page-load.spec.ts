import { FamilyAccessLevel, FamilyUnionStatus } from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

const runLoad = (url: URL) => load({ url } as never);

describe('family page load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
  });

  it('authenticates and returns the cluster list, root and full graph when granted', async () => {
    const url = new URL('https://gallery.test/family');
    sdkMock.getClusters.mockResolvedValue([{ label: 'Alex', size: 4, rootCandidateId: 'alex' }]);
    sdkMock.getMyRoot.mockResolvedValue({ access: FamilyAccessLevel.Contribute, rootIdentityId: 'alex' });
    sdkMock.getUnions.mockResolvedValue({
      unions: [
        { id: 'u1', status: FamilyUnionStatus.Partnered, startDate: null, endDate: null, partners: [], children: [] },
      ],
      identities: { alex: { name: 'Alex', gender: null, label: "that's you" } },
      hasNextPage: false,
    });

    const result = await runLoad(url);

    expect(authenticate).toHaveBeenCalledWith(url);
    expect(result.granted).toBe(true);
    expect(result.clusters).toEqual([{ label: 'Alex', size: 4, rootCandidateId: 'alex' }]);
    expect(result.rootId).toBe('alex');
    expect(result.canContribute).toBe(true);
    expect(result.unions).toHaveLength(1);
    expect(result.identities).toEqual({ alex: { name: 'Alex', gender: null, label: "that's you" } });
    expect(result.meta).toEqual({ title: 'family_canvas_title' });
  });

  it('aggregates every page of the union graph before returning', async () => {
    const url = new URL('https://gallery.test/family');
    sdkMock.getClusters.mockResolvedValue([]);
    sdkMock.getMyRoot.mockResolvedValue({ access: FamilyAccessLevel.View, rootIdentityId: null });
    sdkMock.getUnions
      .mockResolvedValueOnce({
        unions: [
          { id: 'u1', status: FamilyUnionStatus.Partnered, startDate: null, endDate: null, partners: [], children: [] },
        ],
        identities: { a: { name: 'A', gender: null, label: null } },
        hasNextPage: true,
      })
      .mockResolvedValueOnce({
        unions: [
          { id: 'u2', status: FamilyUnionStatus.Partnered, startDate: null, endDate: null, partners: [], children: [] },
        ],
        identities: { b: { name: 'B', gender: null, label: null } },
        hasNextPage: false,
      });

    const result = await runLoad(url);

    // A6: `view` is read-only — the canvas's editing affordances stay off.
    expect(result.canContribute).toBe(false);
    expect(sdkMock.getUnions).toHaveBeenCalledTimes(2);
    expect(result.unions.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(result.identities).toEqual({
      a: { name: 'A', gender: null, label: null },
      b: { name: 'B', gender: null, label: null },
    });
  });

  // A12: the underlying calls 403 for a viewer whose effective family access is `none`. The
  // load must not throw — the page itself decides what "no access" looks like (nothing).
  it('marks the response as not granted when the caller has no family access', async () => {
    const url = new URL('https://gallery.test/family');
    sdkMock.getClusters.mockRejectedValue(new Error('403 Forbidden'));
    sdkMock.getMyRoot.mockRejectedValue(new Error('403 Forbidden'));

    const result = await runLoad(url);

    expect(result.granted).toBe(false);
    expect(result.canContribute).toBe(false);
    expect(result.clusters).toEqual([]);
    expect(result.unions).toEqual([]);
    expect(result.identities).toEqual({});
    expect(sdkMock.getUnions).not.toHaveBeenCalled();
  });
});
