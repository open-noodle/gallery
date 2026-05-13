import { faker } from '@faker-js/faker';
import { AlbumUserRole, AssetOrder, type AlbumResponseDto } from '@immich/sdk';
import { Sync } from 'factory.ts';
import { userFactory } from './user-factory';

export const albumFactory = Sync.makeFactory<AlbumResponseDto>({
  albumName: Sync.each(() => faker.commerce.product()),
  description: '',
  albumThumbnailAssetId: null,
  assetCount: Sync.each((index) => index % 5),
  createdAt: Sync.each(() => faker.date.past().toISOString()),
  updatedAt: Sync.each(() => faker.date.past().toISOString()),
  id: Sync.each(() => faker.string.uuid()),
  shared: false,
  albumUsers: Sync.each(() => [{ user: userFactory.build(), role: AlbumUserRole.Owner }]),
  hasSharedLink: false,
  isActivityEnabled: true,
  order: AssetOrder.Desc,
});
