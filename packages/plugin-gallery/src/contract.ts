export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';

export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

export type GalleryMethodArgs = {
  addToSpace: { assetId: string; spaceIds: string[] };
  addToSpaceAlbum: { assetId: string; spaceId: string; albumName: string };
};
