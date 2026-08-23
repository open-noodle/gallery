import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { canEditAsset, canEditSpacePeople, resolveEditableAssetIds } from './asset-editability';

const space = (canWrite: boolean, memberIds: string[]) => ({
  canWrite,
  members: memberIds.map((userId) => ({ userId })),
});

describe('canEditAsset', () => {
  it('W-1: trusts a server canEdit of true', () => {
    expect(canEditAsset({ ownerId: 'bob', canEdit: true }, { userId: 'anna' })).toBe(true);
  });

  it('W-3: trusts a server canEdit of false even for the owner', () => {
    expect(canEditAsset({ ownerId: 'anna', canEdit: false }, { userId: 'anna' })).toBe(false);
  });

  it('W-5: falls back to ownership when canEdit is absent', () => {
    expect(canEditAsset({ ownerId: 'anna' }, { userId: 'anna' })).toBe(true);
  });

  it('W-6: falls back to the space derivation for a non-owner editor', () => {
    expect(canEditAsset({ ownerId: 'bob' }, { userId: 'anna', space: space(true, ['anna', 'bob']) })).toBe(true);
  });

  it('W-7: denies when the asset owner is not a space member', () => {
    expect(canEditAsset({ ownerId: 'carol' }, { userId: 'anna', space: space(true, ['anna', 'bob']) })).toBe(false);
  });

  it('W-15: denies when the caller cannot write to the space', () => {
    expect(canEditAsset({ ownerId: 'bob' }, { userId: 'anna', space: space(false, ['anna', 'bob']) })).toBe(false);
  });

  it('W-8: denies a non-owner with no space context', () => {
    expect(canEditAsset({ ownerId: 'bob' }, { userId: 'anna' })).toBe(false);
  });

  it('W-16: denies when there is no authenticated user (shared link)', () => {
    expect(canEditAsset({ ownerId: 'bob' })).toBe(false);
  });
});

describe('canEditSpacePeople', () => {
  it('W-20: true for a non-owner space editor with an explicit spaceId and server canEdit true', () => {
    expect(canEditSpacePeople({ ownerId: 'bob', canEdit: true }, { userId: 'anna', spaceId: 'space-1' })).toBe(true);
  });

  it('W-21: true using the asset-resolved space when no explicit spaceId is given', () => {
    expect(canEditSpacePeople({ ownerId: 'bob', canEdit: true, resolvedSpaceId: 'space-1' }, { userId: 'anna' })).toBe(
      true,
    );
  });

  it('W-22: false for the owner even when canEdit is true and a space is present (never widen isOwner)', () => {
    expect(canEditSpacePeople({ ownerId: 'anna', canEdit: true }, { userId: 'anna', spaceId: 'space-1' })).toBe(false);
  });

  it('W-23: false with no effective space at all, even when canEdit is true', () => {
    expect(canEditSpacePeople({ ownerId: 'bob', canEdit: true }, { userId: 'anna' })).toBe(false);
  });

  it('W-24: false when canEdit is false, even with a space present', () => {
    expect(canEditSpacePeople({ ownerId: 'bob', canEdit: false }, { userId: 'anna', spaceId: 'space-1' })).toBe(false);
  });

  it('W-25: false with no authenticated user (shared link) when canEdit is not server-provided', () => {
    expect(canEditSpacePeople({ ownerId: 'bob' }, { spaceId: 'space-1' })).toBe(false);
  });
});

describe('resolveEditableAssetIds', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns [] without calling the server when there are no assets', async () => {
    const result = await resolveEditableAssetIds([], { userId: 'anna' });

    expect(result).toEqual([]);
    expect(sdkMock.getEditableAssets).not.toHaveBeenCalled();
  });

  it('trusts the server response on success (#734)', async () => {
    sdkMock.getEditableAssets.mockResolvedValue({ editableAssetIds: ['a1'] });

    const result = await resolveEditableAssetIds(
      [
        { id: 'a1', ownerId: 'bob' },
        { id: 'a2', ownerId: 'carol' },
      ],
      {
        userId: 'anna',
      },
    );

    expect(result).toEqual(['a1']);
    expect(sdkMock.getEditableAssets).toHaveBeenCalledWith({ assetEditableDto: { assetIds: ['a1', 'a2'] } });
  });

  it('falls back to canEditAsset (space derivation) when the request rejects, without throwing (W-13)', async () => {
    sdkMock.getEditableAssets.mockRejectedValue(new Error('offline'));

    const result = await resolveEditableAssetIds(
      [
        { id: 'mine', ownerId: 'anna' },
        { id: 'editable', ownerId: 'bob' },
        { id: 'not-editable', ownerId: 'carol' },
      ],
      { userId: 'anna', space: space(true, ['anna', 'bob']) },
    );

    expect(result).toEqual(['mine', 'editable']);
  });
});
