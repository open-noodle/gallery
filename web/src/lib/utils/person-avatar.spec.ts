import type { PersonResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { getRepresentativeThumbnailUrl, resolvePersonAvatar } from '$lib/utils/person-avatar';

const person = (overrides: Partial<PersonResponseDto> = {}): PersonResponseDto =>
  ({
    id: 'person-1',
    name: 'Alice',
    birthDate: null,
    thumbnailPath: '',
    isHidden: false,
    isFavorite: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }) as unknown as PersonResponseDto;

const ASSET_THUMB = '/api/assets/asset-1/thumbnail';

describe('getRepresentativeThumbnailUrl', () => {
  it('returns the owner person thumbnail for the owner outside a space', () => {
    const url = getRepresentativeThumbnailUrl(person(), { isOwner: true });
    expect(url).toContain('/people/person-1/thumbnail');
  });

  it('returns the space person thumbnail for a space member', () => {
    const url = getRepresentativeThumbnailUrl(person({ spacePersonId: 'space-person-1' }), {
      isOwner: false,
      spaceId: 'space-1',
    });
    expect(url).toContain('/shared-spaces/space-1/people/space-person-1/thumbnail');
  });

  it('prefers the space arm over the owner arm when both could apply', () => {
    const url = getRepresentativeThumbnailUrl(person({ spacePersonId: 'space-person-1' }), {
      isOwner: true,
      spaceId: 'space-1',
    });
    expect(url).toContain('/shared-spaces/');
    expect(url).not.toContain('/people/person-1/');
  });

  it('takes the owner arm for the owner inside a space when the person has no space profile', () => {
    // mapPerson never emits spacePersonId, so this is the real shape for an owner in a space.
    const url = getRepresentativeThumbnailUrl(person(), { isOwner: true, spaceId: 'space-1' });
    expect(url).toContain('/people/person-1/thumbnail');
    expect(url).not.toContain('/shared-spaces/');
  });

  it('returns undefined for a viewer who is neither owner nor space member', () => {
    expect(getRepresentativeThumbnailUrl(person(), { isOwner: false })).toBeUndefined();
  });

  it('returns undefined for a non-owner in a space whose person has no space profile', () => {
    // Must not synthesise /shared-spaces/space-1/people/undefined/thumbnail.
    expect(getRepresentativeThumbnailUrl(person(), { isOwner: false, spaceId: 'space-1' })).toBeUndefined();
  });

  it('carries updatedAt as a cache-buster on the owner arm', () => {
    const url = getRepresentativeThumbnailUrl(person({ updatedAt: '2026-02-02T00:00:00.000Z' }), { isOwner: true });
    expect(url).toContain('updatedAt=');
    expect(url).toContain('2026-02-02');
  });

  it('carries updatedAt as a cache-buster on the space arm', () => {
    const url = getRepresentativeThumbnailUrl(
      person({ spacePersonId: 'space-person-1', updatedAt: '2026-02-02T00:00:00.000Z' }),
      { isOwner: false, spaceId: 'space-1' },
    );
    expect(url).toContain('updatedAt=');
    expect(url).toContain('2026-02-02');
  });

  it('omits the updatedAt param when the person has none', () => {
    const url = getRepresentativeThumbnailUrl(person({ updatedAt: undefined }), { isOwner: true });
    expect(url).not.toContain('updatedAt=');
  });
});

describe('resolvePersonAvatar', () => {
  const resolve = (overrides: Partial<Parameters<typeof resolvePersonAvatar>[0]> = {}) =>
    resolvePersonAvatar({
      person: person(),
      isOwner: true,
      hasFaceInAsset: true,
      cropFacesFromAsset: true,
      assetThumbnailUrl: ASSET_THUMB,
      ...overrides,
    });

  it('crops from the asset when the setting is on and the person has a face', () => {
    const avatar = resolve();
    expect(avatar.kind).toBe('assetFace');
    expect(avatar).toHaveProperty('fallbackUrl', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('uses the representative face when the setting is off', () => {
    const avatar = resolve({ cropFacesFromAsset: false });
    expect(avatar.kind).toBe('representative');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('uses the representative face when the person has no face in this asset', () => {
    const avatar = resolve({ hasFaceInAsset: false });
    expect(avatar.kind).toBe('fallback');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('falls back to the asset thumbnail when there is no representative face and no crop', () => {
    const avatar = resolve({ isOwner: false, hasFaceInAsset: false });
    expect(avatar).toEqual({ kind: 'fallback', url: ASSET_THUMB });
  });

  it('KEEPS cropping for a viewer with no reachable representative face even when the setting is off', () => {
    // The regression guard: turning the setting off must not demote an album/partner viewer to
    // the whole-asset thumbnail as every person's avatar.
    const avatar = resolve({ isOwner: false, cropFacesFromAsset: false });
    expect(avatar).toEqual({ kind: 'assetFace', fallbackUrl: ASSET_THUMB });
  });

  it('uses the space representative face for a space member when the setting is off', () => {
    const avatar = resolve({
      person: person({ spacePersonId: 'space-person-1' }),
      isOwner: false,
      spaceId: 'space-1',
      cropFacesFromAsset: false,
    });
    expect(avatar.kind).toBe('representative');
    expect(avatar).toHaveProperty('url', expect.stringContaining('/shared-spaces/space-1/people/space-person-1/'));
  });

  it('uses the owner representative face for the owner inside a space when the setting is off', () => {
    const avatar = resolve({ spaceId: 'space-1', cropFacesFromAsset: false });
    expect(avatar).toHaveProperty('url', expect.stringContaining('/people/person-1/thumbnail'));
  });

  it('degrades a space member with no space profile to the asset thumbnail, never a broken space URL', () => {
    const avatar = resolve({ isOwner: false, spaceId: 'space-1', hasFaceInAsset: false });
    expect(avatar).toEqual({ kind: 'fallback', url: ASSET_THUMB });
  });
});
