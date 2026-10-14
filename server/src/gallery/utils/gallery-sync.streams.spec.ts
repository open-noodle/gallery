import { Writable } from 'node:stream';
import { SyncEntityType, SyncRequestType } from 'src/enum.js';
import { GallerySyncRepository } from 'src/gallery/repositories/gallery-sync.repository.js';
import { GallerySyncStreams } from 'src/gallery/utils/gallery-sync.streams.js';
import { SYNC_TYPES_ORDER } from 'src/services/sync.service.js';
import { fromAck } from 'src/utils/sync.js';
import { makeStream } from 'test/utils.js';

// Upstream Immich v3.3.1's sync enums. Everything else in SyncRequestType / SyncEntityType is Gallery's.
const upstreamRequestTypes = new Set<string>([
  'AlbumsV1',
  'AlbumsV2',
  'AlbumUsersV1',
  'AlbumToAssetsV1',
  'AlbumAssetsV1',
  'AlbumAssetsV2',
  'AlbumAssetExifsV1',
  'AssetsV1',
  'AssetsV2',
  'AssetExifsV1',
  'AssetEditsV1',
  'AssetMetadataV1',
  'AssetOcrV1',
  'AuthUsersV1',
  'AuthUsersV2',
  'MemoriesV1',
  'MemoriesV2',
  'MemoryToAssetsV1',
  'MemoryToAssetsV2',
  'PartnersV1',
  'PartnerAssetsV1',
  'PartnerAssetsV2',
  'PartnerAssetExifsV1',
  'PartnerStacksV1',
  'StacksV1',
  'UsersV1',
  'PeopleV1',
  'AssetFacesV1',
  'AssetFacesV2',
  'AssetFacesV3',
  'UserMetadataV1',
]);

const upstreamEntityTypes = new Set<string>([
  'AuthUserV1',
  'AuthUserV2',
  'UserV1',
  'UserDeleteV1',
  'AssetV1',
  'AssetV2',
  'AssetDeleteV1',
  'AssetExifV1',
  'AssetEditV1',
  'AssetEditDeleteV1',
  'AssetMetadataV1',
  'AssetMetadataDeleteV1',
  'AssetOcrV1',
  'AssetOcrDeleteV1',
  'PartnerV1',
  'PartnerDeleteV1',
  'PartnerAssetV1',
  'PartnerAssetV2',
  'PartnerAssetBackfillV1',
  'PartnerAssetBackfillV2',
  'PartnerAssetDeleteV1',
  'PartnerAssetExifV1',
  'PartnerAssetExifBackfillV1',
  'PartnerStackBackfillV1',
  'PartnerStackDeleteV1',
  'PartnerStackV1',
  'AlbumV1',
  'AlbumV2',
  'AlbumDeleteV1',
  'AlbumUserV1',
  'AlbumUserBackfillV1',
  'AlbumUserDeleteV1',
  'AlbumAssetCreateV1',
  'AlbumAssetCreateV2',
  'AlbumAssetUpdateV1',
  'AlbumAssetUpdateV2',
  'AlbumAssetBackfillV1',
  'AlbumAssetBackfillV2',
  'AlbumAssetExifCreateV1',
  'AlbumAssetExifUpdateV1',
  'AlbumAssetExifBackfillV1',
  'AlbumToAssetV1',
  'AlbumToAssetDeleteV1',
  'AlbumToAssetBackfillV1',
  'MemoryV1',
  'MemoryV2',
  'MemoryDeleteV1',
  'MemoryToAssetV1',
  'MemoryToAssetV2',
  'MemoryToAssetDeleteV1',
  'StackV1',
  'StackDeleteV1',
  'PersonV1',
  'PersonDeleteV1',
  'AssetFaceV1',
  'AssetFaceV2',
  'AssetFaceV3',
  'AssetFaceDeleteV1',
  'UserMetadataV1',
  'UserMetadataDeleteV1',
  'SyncAckV1',
  'SyncResetV1',
  'SyncCompleteV1',
]);

// Kept for wire-contract symmetry with the library family; the metadata stream is never backfilled (enum.ts).
const neverEmitted = new Set<string>([SyncEntityType.SharedSpaceAlbumBackfillV1]);

const forkRequestTypes = Object.values(SyncRequestType).filter((type) => !upstreamRequestTypes.has(type));
const forkEntityTypes = Object.values(SyncEntityType).filter((type) => !upstreamEntityTypes.has(type));

// Every stream method yields one row and every space/library/album has one pending backfill, so each
// handler walks its delete, backfill, update and create branches.
const row = { id: 'row-id', updateId: 'update-id', checksum: Buffer.from('a'), thumbhash: null, duration: null };
const getCreatedAfter = () => Promise.resolve([{ id: 'entity-id', createId: 'create-id' }]);
const getRows = () => makeStream([{ ...row }]);
const subRepository = new Proxy(
  {},
  { get: (_, method: string) => (method === 'getCreatedAfter' ? getCreatedAfter : getRows) },
);
const repository = new Proxy({}, { get: () => subRepository }) as GallerySyncRepository;

// The ack types one handler writes: each row's own type, and the type a SyncAckV1 row acknowledges.
const streamHandler = async (type: SyncRequestType) => {
  const lines: string[] = [];
  const response = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      callback();
    },
  });
  const checkpointMap = Object.fromEntries(
    Object.values(SyncEntityType).map((entityType) => [entityType, { type: entityType, updateId: 'checkpoint-id' }]),
  );
  const handlers = GallerySyncStreams.handlers({
    repository,
    upsertBackfillCheckpoint: () => Promise.resolve(),
    options: { nowId: 'now-id', userId: 'user-id' },
    response,
    checkpointMap,
    sessionId: 'session-id',
  });

  await handlers[type as keyof typeof handlers]();

  return new Set(lines.map((line) => fromAck(JSON.parse(line).ack).type));
};

describe('GallerySyncStreams', () => {
  it('should have exactly one handler for every Gallery sync request type', () => {
    const handlers = GallerySyncStreams.handlers({} as Parameters<typeof GallerySyncStreams.handlers>[0]);

    expect(Object.keys(handlers).toSorted()).toEqual(forkRequestTypes.toSorted());
    for (const type of forkRequestTypes) {
      expect(
        SYNC_TYPES_ORDER.filter((ordered) => ordered === type),
        type,
      ).toHaveLength(1);
    }
  });

  it('should emit every Gallery sync entity type from exactly one handler', async () => {
    const owners = new Map<string, SyncRequestType[]>();
    for (const requestType of forkRequestTypes) {
      for (const entityType of await streamHandler(requestType)) {
        owners.set(entityType, [...(owners.get(entityType) ?? []), requestType]);
      }
    }

    for (const entityType of forkEntityTypes) {
      expect(owners.get(entityType) ?? [], entityType).toHaveLength(neverEmitted.has(entityType) ? 0 : 1);
    }
    // Gallery handlers write no upstream entity type.
    expect(
      owners
        .keys()
        .filter((type) => upstreamEntityTypes.has(type))
        .toArray(),
    ).toEqual([]);
  });

  it('should stream Gallery types after upstream types and the memory types last', () => {
    const order = GallerySyncStreams.order([
      SyncRequestType.AssetsV2,
      SyncRequestType.MemoriesV1,
      SyncRequestType.MemoryToAssetsV1,
      SyncRequestType.AssetEditsV1,
    ]);

    expect(order.slice(0, 2)).toEqual([SyncRequestType.AssetsV2, SyncRequestType.AssetEditsV1]);
    expect(order.slice(-2)).toEqual([SyncRequestType.MemoriesV1, SyncRequestType.MemoryToAssetsV1]);
    expect(order.slice(2, -2).toSorted()).toEqual(forkRequestTypes.toSorted());
  });
});
