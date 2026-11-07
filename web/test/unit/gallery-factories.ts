import { factory as mockFactory } from '#test/common/factories.ts';
import {
  AssetOrder,
  UserAvatarColor,
  type PersonResponseDto,
  type SharedSpaceLinkedAlbumDto,
  type SharedSpaceResponseDto,
  type UserResponseDto,
} from '@immich/sdk';

// Gallery's own response builders, merged into upstream's `factory` in `#test/unit/factories.ts`.

let spaceIndex = 0;
let linkedAlbumIndex = 0;

const recently = (index: number) => new Date(Date.UTC(2025, 9, 29) - index * 86_400_000).toISOString();

const sharedSpace = (overrides: Partial<SharedSpaceResponseDto> = {}): SharedSpaceResponseDto => {
  const index = spaceIndex++;
  return {
    id: crypto.randomUUID(),
    name: `Space ${index + 1}`,
    description: null,
    createdById: crypto.randomUUID(),
    createdAt: recently(index + 30),
    updatedAt: recently(index + 30),
    color: UserAvatarColor.Primary,
    thumbnailAssetId: null,
    assetCount: index * 10,
    memberCount: (index % 5) + 1,
    members: [],
    recentAssetIds: [],
    recentAssetThumbhashes: [],
    lastActivityAt: recently(index),
    newAssetCount: 0,
    albumCount: 0,
    lastViewedAt: null,
    ...overrides,
  };
};

const sharedSpaceLinkedAlbum = (overrides: Partial<SharedSpaceLinkedAlbumDto> = {}): SharedSpaceLinkedAlbumDto => {
  const index = linkedAlbumIndex++;
  return {
    id: crypto.randomUUID(),
    albumName: `Album ${index + 1}`,
    description: '',
    albumThumbnailAssetId: null,
    // null means "at the space root", where every album sat before folders existed.
    folderId: null,
    assetCount: index % 5,
    createdAt: recently(index + 30),
    updatedAt: recently(index + 30),
    shared: false,
    hasSharedLink: false,
    isActivityEnabled: true,
    order: AssetOrder.Desc,
    ownerId: crypto.randomUUID(),
    showInTimeline: true,
    hiddenFromMyTimeline: false,
    addedById: crypto.randomUUID(),
    linkedAt: recently(index),
    ...overrides,
  };
};

// A Gallery DTO field upstream's person builder does not set.
const person = (overrides: Partial<PersonResponseDto> = {}): PersonResponseDto =>
  mockFactory.person({ type: 'person', ...overrides });

let userSummaryIndex = 0;

/** A plain `UserResponseDto` (album members, space members), not the admin shape `factory.user` builds. */
const userSummary = (overrides: Partial<UserResponseDto> = {}): UserResponseDto => {
  const index = userSummaryIndex++;
  return {
    id: crypto.randomUUID(),
    email: `user${index + 1}@example.com`,
    name: `User ${index + 1}`,
    profileImagePath: '',
    avatarColor: UserAvatarColor.Primary,
    profileChangedAt: recently(index),
    ...overrides,
  };
};

export const galleryFactory = { sharedSpace, sharedSpaceLinkedAlbum, person, userSummary };
