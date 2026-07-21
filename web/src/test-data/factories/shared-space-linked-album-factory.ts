import { faker } from '@faker-js/faker';
import { AssetOrder, type SharedSpaceLinkedAlbumDto } from '@immich/sdk';
import { Sync } from 'factory.ts';

export const sharedSpaceLinkedAlbumFactory = Sync.makeFactory<SharedSpaceLinkedAlbumDto>({
  id: Sync.each(() => faker.string.uuid()),
  albumName: Sync.each(() => faker.commerce.product()),
  description: '',
  albumThumbnailAssetId: null,
  assetCount: Sync.each((i) => i % 5),
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  updatedAt: Sync.each(() => faker.date.past().toISOString()),
  shared: false,
  hasSharedLink: false,
  isActivityEnabled: true,
  order: AssetOrder.Desc,
  ownerId: Sync.each(() => faker.string.uuid()),
  showInTimeline: true,
  addedById: Sync.each(() => faker.string.uuid()),
  linkedAt: Sync.each(() => faker.date.recent().toISOString()),
});
