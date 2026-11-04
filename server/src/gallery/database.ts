import { projectedDuration } from 'src/gallery/utils/projected-duration.js';

// Fork row types and column sets, merged into upstream's src/database.ts with one re-export and one spread into
// `columns`.

export type SharedSpace = {
  id: string;
  name: string;
  description: string | null;
  createdById: string;
  thumbnailAssetId: string | null;
  color: string | null;
  thumbnailCropY: number | null;
  faceRecognitionEnabled: boolean;
  petsEnabled: boolean;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createId: string;
  updateId: string;
};

export type SharedSpaceMember = {
  spaceId: string;
  userId: string;
  role: string;
  joinedAt: Date;
  showInTimeline: boolean;
  sharePersonMetadata: boolean;
  lastViewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createId: string;
  updateId: string;
};

export type SharedSpaceAsset = {
  spaceId: string;
  assetId: string;
  addedById: string | null;
  addedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  createId: string;
  updateId: string;
};

export type SharedSpaceActivity = {
  id: string;
  spaceId: string;
  userId: string | null;
  type: string;
  data: Record<string, unknown>;
  createdAt: Date;
};

export type SharedSpacePerson = {
  id: string;
  spaceId: string;
  name: string;
  representativeFaceId: string | null;
  representativeFaceSource: 'auto' | 'manual';
  isHidden: boolean;
  type: string;
  birthDate: string | null;
  faceCount: number;
  assetCount: number;
  createdAt: Date;
  updatedAt: Date;
  updateId: string;
  identityId: string | null;
  nameSource: string;
  nameSourceProfileType: string | null;
  nameSourceProfileId: string | null;
  nameSourceUpdatedAt: Date | null;
  birthDateSource: string;
  birthDateSourceProfileType: string | null;
  birthDateSourceProfileId: string | null;
  birthDateSourceUpdatedAt: Date | null;
  personalPersonId?: string | null;
  personalName?: string | null;
  personalThumbnailPath?: string | null;
  personalBirthDate?: Date | null;
};

export type SharedSpacePersonFace = {
  personId: string;
  assetFaceId: string;
};

export type SharedSpacePersonAlias = {
  personId: string;
  userId: string;
  alias: string;
};

export type SharedSpaceLibrary = {
  spaceId: string;
  libraryId: string;
  addedById: string | null;
  createdAt: Date;
  updatedAt: Date;
  createId: string;
  updateId: string;
};

export type UserGroup = {
  id: string;
  name: string;
  color: string | null;
  origin: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  createId: string;
  updateId: string;
};

export type UserGroupMember = {
  groupId: string;
  userId: string;
  addedAt: Date;
};

/** Spread into `columns` in src/database.ts. */
export const galleryColumns = {
  syncSharedSpaceAsset: [
    'asset.id',
    'asset.ownerId',
    'asset.originalFileName',
    'asset.thumbhash',
    'asset.checksum',
    'asset.fileCreatedAt',
    'asset.fileModifiedAt',
    'asset.createdAt',
    'asset.localDateTime',
    'asset.type',
    'asset.deletedAt',
    'asset.visibility',
    projectedDuration,
    'asset.livePhotoVideoId',
    'asset.stackId',
    'asset.libraryId',
    'asset.width',
    'asset.height',
    'asset.isEdited',
  ],
  // syncAsset minus isFavorite — LibraryAssetSync projects the favorite flag separately via
  // favoriteExistsFor(eb, userId) (#763), the per-user asset_favorite overlay: each syncing user
  // sees their OWN favorite state for the row, never another library member's, like the other
  // shared-scope sync column sets above (issue #743 item 1).
  syncLibraryAsset: [
    'asset.id',
    'asset.ownerId',
    'asset.originalFileName',
    'asset.thumbhash',
    'asset.checksum',
    'asset.fileCreatedAt',
    'asset.fileModifiedAt',
    'asset.createdAt',
    'asset.localDateTime',
    'asset.type',
    'asset.deletedAt',
    'asset.visibility',
    projectedDuration,
    'asset.livePhotoVideoId',
    'asset.stackId',
    'asset.libraryId',
    'asset.width',
    'asset.height',
    'asset.isEdited',
  ],
} as const;
