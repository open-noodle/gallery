import '#lib/gallery/__mocks__/sdk.mock.ts';
import { sdkMock } from '#lib/gallery/__mocks__/sdk.mock.ts';
import type { PartnerResponseDto } from '@immich/sdk';
import { beforeEach, describe, expect, it } from 'vitest';

// Loaded after sdk.mock.ts registers its vi.mock, so the module (and these enums) come from the mocked
// @immich/sdk; a static value import would link the real one first.
const { AssetVisibility, PartnerDirection } = await import('@immich/sdk');
type Visibility = (typeof AssetVisibility)[keyof typeof AssetVisibility];
const { pickSpaceShareableAssetIds, resolveSpaceShareableAssetIds } = await import('./space-shareable-assets');

const partner = (id: string) => ({ id }) as PartnerResponseDto;

// Truth table of the server's requireSpaceShareAccess (server/src/gallery/utils/access-grants.ts):
// owner → any visibility; partner (shares with the caller) → timeline or hidden only; anyone else → never.
// Locked never reaches a search collector, but the rule is spelled out for every visibility.
type Owner = 'me' | 'partner' | 'stranger';
const TRUTH: Record<Owner, Record<Visibility, boolean>> = {
  me: {
    [AssetVisibility.Timeline]: true,
    [AssetVisibility.Hidden]: true,
    [AssetVisibility.Archive]: true,
    [AssetVisibility.Locked]: true,
  },
  partner: {
    [AssetVisibility.Timeline]: true,
    [AssetVisibility.Hidden]: true,
    [AssetVisibility.Archive]: false,
    [AssetVisibility.Locked]: false,
  },
  stranger: {
    [AssetVisibility.Timeline]: false,
    [AssetVisibility.Hidden]: false,
    [AssetVisibility.Archive]: false,
    [AssetVisibility.Locked]: false,
  },
};
const OWNER_IDS: Record<Owner, string> = { me: 'me', partner: 'p1', stranger: 'x1' };

beforeEach(() => {
  vi.resetAllMocks();
});

describe('pickSpaceShareableAssetIds', () => {
  const cases = (Object.keys(TRUTH) as Owner[]).flatMap((owner) =>
    Object.values(AssetVisibility).map((visibility) => ({ owner, visibility, expected: TRUTH[owner][visibility] })),
  );

  it.each(cases)('$owner + $visibility → shareable: $expected', ({ owner, visibility, expected }) => {
    const ids = pickSpaceShareableAssetIds([{ id: 'a', ownerId: OWNER_IDS[owner], visibility }], 'me', new Set(['p1']));
    expect(ids).toEqual(expected ? ['a'] : []);
  });

  it('keeps the input order across a mixed selection', () => {
    const ids = pickSpaceShareableAssetIds(
      [
        { id: '1', ownerId: 'p1', visibility: AssetVisibility.Timeline },
        { id: '2', ownerId: 'x1', visibility: AssetVisibility.Timeline },
        { id: '3', ownerId: 'me', visibility: AssetVisibility.Archive },
        { id: '4', ownerId: 'p1', visibility: AssetVisibility.Archive },
        { id: '5', ownerId: 'me', visibility: AssetVisibility.Timeline },
      ],
      'me',
      new Set(['p1']),
    );
    expect(ids).toEqual(['1', '3', '5']);
  });

  it('returns nothing without a signed-in user', () => {
    expect(
      pickSpaceShareableAssetIds(
        [{ id: 'a', ownerId: 'me', visibility: AssetVisibility.Timeline }],
        undefined,
        new Set(['me']),
      ),
    ).toEqual([]);
  });

  it('returns nothing for an empty selection', () => {
    expect(pickSpaceShareableAssetIds([], 'me', new Set())).toEqual([]);
  });
});

describe('resolveSpaceShareableAssetIds', () => {
  it('does not load partners when every asset is the caller’s', async () => {
    const ids = await resolveSpaceShareableAssetIds(
      [
        { id: '1', ownerId: 'me', visibility: AssetVisibility.Timeline },
        { id: '2', ownerId: 'me', visibility: AssetVisibility.Archive },
      ],
      'me',
    );
    expect(ids).toEqual(['1', '2']);
    expect(sdkMock.getPartners).not.toHaveBeenCalled();
  });

  it('loads the users who share with the caller and keeps their timeline assets', async () => {
    sdkMock.getPartners.mockResolvedValue([partner('p1')]);
    const ids = await resolveSpaceShareableAssetIds(
      [
        { id: '1', ownerId: 'me', visibility: AssetVisibility.Timeline },
        { id: '2', ownerId: 'p1', visibility: AssetVisibility.Timeline },
        { id: '3', ownerId: 'x1', visibility: AssetVisibility.Timeline },
      ],
      'me',
    );
    expect(sdkMock.getPartners).toHaveBeenCalledExactlyOnceWith({ direction: PartnerDirection.SharedWith });
    expect(ids).toEqual(['1', '2']);
  });

  it('leaves partner assets out when the partner list cannot be loaded', async () => {
    sdkMock.getPartners.mockRejectedValue(new Error('offline'));
    const ids = await resolveSpaceShareableAssetIds(
      [
        { id: '1', ownerId: 'me', visibility: AssetVisibility.Timeline },
        { id: '2', ownerId: 'p1', visibility: AssetVisibility.Timeline },
      ],
      'me',
    );
    expect(ids).toEqual(['1']);
  });

  it('returns nothing and loads nothing without a signed-in user', async () => {
    const ids = await resolveSpaceShareableAssetIds(
      [{ id: '1', ownerId: 'p1', visibility: AssetVisibility.Timeline }],
      undefined,
    );
    expect(ids).toEqual([]);
    expect(sdkMock.getPartners).not.toHaveBeenCalled();
  });
});
