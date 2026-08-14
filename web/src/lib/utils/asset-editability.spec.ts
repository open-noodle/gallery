import { describe, expect, it } from 'vitest';
import { canEditAsset } from './asset-editability';

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
