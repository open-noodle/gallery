/**
 * RBAC oracle for the viewer-scoped read surfaces: runs every surface that applies resolveViewerScope or the
 * space visibility rules, for a fixed cast of actors over one seeded world, and snapshots what each actor gets back
 * by label. An asset label ends in `*` when that surface reports it as a favourite for that actor, and a call that
 * throws is recorded as `error:<class>`. A refactor of the scope, favourite or album-membership code must leave the
 * snapshot untouched; a deliberate behaviour change updates it with `-u` and says so in its commit.
 */
import { Kysely } from 'kysely';
import { DownloadInfoDto } from 'src/dtos/download.dto.js';
import { FilteredMapMarkerDto } from 'src/dtos/gallery-map.dto.js';
import { MapMarkerDto } from 'src/dtos/map.dto.js';
import { MetadataSearchDto, SearchSuggestionType } from 'src/dtos/search.dto.js';
import { TimeBucketDto } from 'src/dtos/time-bucket.dto.js';
import { AlbumUserRole, AssetStatus, AssetVisibility, MemoryType, SharedLinkType, TimeBucketSize } from 'src/enum.js';
import { FilterSuggestionRepository } from 'src/gallery/repositories/filter-suggestion.repository.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { SpaceAlbumRepository } from 'src/gallery/repositories/space-album.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetEditRepository } from 'src/repositories/asset-edit.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { DownloadRepository } from 'src/repositories/download.repository.js';
import { DuplicateRepository } from 'src/repositories/duplicate.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { FaceIdentityRepository } from 'src/repositories/face-identity.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MapRepository } from 'src/repositories/map.repository.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SearchRepository } from 'src/repositories/search.repository.js';
import { SharedLinkAssetRepository } from 'src/repositories/shared-link-asset.repository.js';
import { SharedLinkRepository } from 'src/repositories/shared-link.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StackRepository } from 'src/repositories/stack.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { ViewRepository } from 'src/repositories/view-repository.js';
import { DB } from 'src/schema/index.js';
import { AlbumService } from 'src/services/album.service.js';
import { AssetService } from 'src/services/asset.service.js';
import { BaseService } from 'src/services/base.service.js';
import { DownloadService } from 'src/services/download.service.js';
import { DuplicateService } from 'src/services/duplicate.service.js';
import { MapService } from 'src/services/map.service.js';
import { MemoryService } from 'src/services/memory.service.js';
import { SearchService } from 'src/services/search.service.js';
import { SharedLinkService } from 'src/services/shared-link.service.js';
import { SharedSpaceService } from 'src/services/shared-space.service.js';
import { StackService } from 'src/services/stack.service.js';
import { TagService } from 'src/services/tag.service.js';
import { TimelineService } from 'src/services/timeline.service.js';
import { ViewService } from 'src/services/view.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory, newUuid } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const TAKEN = new Date('2024-03-15T12:00:00.000Z');

const seed = async () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      AlbumUserRepository,
      AssetEditRepository,
      AssetFavoriteRepository,
      AssetRepository,
      GalleryAssetRepository,
      ConfigRepository,
      CryptoRepository,
      DatabaseRepository,
      DownloadRepository,
      DuplicateRepository,
      FaceIdentityRepository,
      FilterSuggestionRepository,
      MapRepository,
      MemoryRepository,
      PartnerRepository,
      PersonRepository,
      SearchRepository,
      SharedLinkAssetRepository,
      SharedLinkRepository,
      SharedSpaceRepository,
      SpaceAlbumRepository,
      StackRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
      ViewRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });

  const labels = new Map<string, string>();
  const label = <T extends string>(name: string, id: T) => {
    labels.set(id, name);
    return id;
  };

  const newUser = async (name: string) => {
    const { user } = await ctx.newUser();
    label(name, user.id);
    return user;
  };
  const owner = await newUser('owner');
  const partner = await newUser('partner');
  const spaceEditor = await newUser('spaceEditor');
  const spaceViewer = await newUser('spaceViewer');
  const spaceViewerOff = await newUser('spaceViewerOff');
  const albumEditor = await newUser('albumEditor');
  const albumViewer = await newUser('albumViewer');
  const stranger = await newUser('stranger');

  await ctx.newPartner({ sharedById: owner.id, sharedWithId: partner.id, inTimeline: true });
  const { space } = await ctx.newSharedSpace({ createdById: owner.id });
  label('space', space.id);
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: owner.id, role: 'owner' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceEditor.id, role: 'editor' });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: spaceViewer.id, role: 'viewer' });
  await ctx.newSharedSpaceMember({
    spaceId: space.id,
    userId: spaceViewerOff.id,
    role: 'viewer',
    showInTimeline: false,
  });
  const { library } = await ctx.newLibrary({ ownerId: owner.id });
  await ctx.newSharedSpaceLibrary({ spaceId: space.id, libraryId: library.id });

  const assets: Record<string, string> = {};
  const newAsset = async (
    name: string,
    dto: { ownerId?: string; visibility?: AssetVisibility; trashed?: boolean; libraryId?: string } = {},
  ) => {
    const { trashed, ...rest } = dto;
    const id = label(name, newUuid());
    await ctx.newAsset({
      id,
      ownerId: owner.id,
      originalPath: `/oracle/${name}/${name}.jpg`,
      fileCreatedAt: TAKEN,
      fileModifiedAt: TAKEN,
      localDateTime: TAKEN,
      ...(trashed && { deletedAt: TAKEN, status: AssetStatus.Trashed }),
      ...rest,
    });
    await ctx.newExif({
      assetId: id,
      city: `city-${name}`,
      state: `state-${name}`,
      country: `country-${name}`,
      make: `make-${name}`,
      model: `model-${name}`,
      latitude: 10,
      longitude: 10,
      fileSizeInByte: 1000,
    });
    assets[name] = id;
    return id;
  };

  const ownAsset = await newAsset('ownAsset');
  const ownArchived = await newAsset('ownArchived', { visibility: AssetVisibility.Archive });
  await newAsset('ownHidden', { visibility: AssetVisibility.Hidden });
  await newAsset('ownLocked', { visibility: AssetVisibility.Locked });
  await newAsset('ownTrashed', { trashed: true });
  const dupAsset = await newAsset('dupAsset');
  const dupAsset2 = await newAsset('dupAsset2');
  const stackAsset = await newAsset('stackAsset');
  const spaceAsset = await newAsset('spaceAsset');
  const spaceArchived = await newAsset('spaceArchived', { visibility: AssetVisibility.Archive });
  const spaceHidden = await newAsset('spaceHidden', { visibility: AssetVisibility.Hidden });
  const spaceLocked = await newAsset('spaceLocked', { visibility: AssetVisibility.Locked });
  const spaceTrashed = await newAsset('spaceTrashed', { trashed: true });
  const petAsset = await newAsset('petAsset');
  const libraryAsset = await newAsset('libraryAsset', { libraryId: library.id });
  const albumSpaceAsset = await newAsset('albumSpaceAsset');
  const editorAsset = await newAsset('editorAsset', { ownerId: spaceEditor.id });
  const contributedAsset = await newAsset('contributedAsset', { ownerId: spaceEditor.id });
  const strangerAsset = await newAsset('strangerAsset', { ownerId: stranger.id });

  for (const assetId of [spaceAsset, spaceArchived, spaceHidden, spaceLocked, spaceTrashed, petAsset, editorAsset]) {
    await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId });
  }

  const duplicateId = newUuid();
  await ctx.database.updateTable('asset').set({ duplicateId }).where('id', 'in', [dupAsset, dupAsset2]).execute();
  const { stack } = await ctx.newStack({ ownerId: owner.id }, [stackAsset, ownAsset]);
  label('stack', stack.id);

  const { album: ownAlbum } = await ctx.newAlbum({ ownerId: owner.id }, [ownAsset, ownArchived]);
  label('ownAlbum', ownAlbum.id);
  await ctx.newAlbumUser({ albumId: ownAlbum.id, userId: albumViewer.id, role: AlbumUserRole.Viewer });
  await ctx.newAlbumUser({ albumId: ownAlbum.id, userId: albumEditor.id, role: AlbumUserRole.Editor });
  const { album: spaceAlbum } = await ctx.newAlbum({ ownerId: owner.id }, [albumSpaceAsset]);
  label('spaceAlbum', spaceAlbum.id);
  await ctx.newSharedSpaceAlbum({ spaceId: space.id, albumId: spaceAlbum.id });
  await ctx.newAlbumSpaceAsset({
    albumId: spaceAlbum.id,
    assetId: contributedAsset,
    spaceId: space.id,
    addedById: spaceEditor.id,
  });
  await ctx.newSharedSpaceAlbumHidden({ spaceId: space.id, albumId: spaceAlbum.id, userId: spaceEditor.id });

  const { person: pet } = await ctx.newPerson({ ownerId: owner.id, name: 'Rex', type: 'pet', species: 'dog' });
  label('pet', pet.personGroupId);
  await ctx.newAssetFace({ assetId: petAsset, personGroupId: pet.personGroupId });
  const { person: human } = await ctx.newPerson({ ownerId: owner.id, name: 'Ann' });
  label('human', human.personGroupId);
  await ctx.newAssetFace({ assetId: spaceAsset, personGroupId: human.personGroupId });

  const newTag = async (name: string, userId: string, assetIds: string[]) => {
    const { tag } = await ctx.newTag({ userId, value: name });
    label(name, tag.id);
    await ctx.newTagAsset({ tagIds: [tag.id], assetIds });
    return tag.id;
  };
  const tagOwn = await newTag('tagOwn', owner.id, [ownAsset]);
  const tagSpace = await newTag('tagSpace', owner.id, [spaceAsset, spaceLocked, libraryAsset]);
  await newTag('tagEditor', spaceEditor.id, [editorAsset]);

  const newMemory = async (name: string, ownerId: string, assetIds: string[], rule = false) => {
    const { memory } = await ctx.newMemory(
      rule ? { ownerId, type: MemoryType.Rule, data: { ruleId: 'season_recap', dedupeKey: name } } : { ownerId },
    );
    label(name, memory.id);
    for (const assetId of assetIds) {
      await ctx.newMemoryAsset({ memoryId: memory.id, assetId });
    }
    return memory.id;
  };
  const memOwner = await newMemory('memOwner', owner.id, [ownAsset, ownArchived, spaceAsset]);
  const memViewer = await newMemory('memViewer', spaceViewer.id, [spaceAsset, spaceArchived, libraryAsset, petAsset]);
  // A rule memory, which a stock client cannot decode (F5).
  await newMemory('memRule', owner.id, [ownAsset], true);
  // An Immich birthday memory, which every client here can decode (OD-3).
  const { memory: memBirthday } = await ctx.newMemory({
    ownerId: owner.id,
    type: MemoryType.Birthday,
    data: { personId: pet.personGroupId, personName: 'Rex', year: 2020 },
  });
  label('memBirthday', memBirthday.id);
  await ctx.newMemoryAsset({ memoryId: memBirthday.id, assetId: ownAsset });

  const newLink = async (name: string, dto: Parameters<typeof ctx.newSharedLink>[0]) => {
    const { sharedLink } = await ctx.newSharedLink(dto);
    label(name, sharedLink.id);
    return sharedLink.id;
  };
  const albumLink = await newLink('albumLink', { userId: owner.id, type: SharedLinkType.Album, albumId: ownAlbum.id });
  const individualLink = await newLink('individualLink', {
    userId: owner.id,
    type: SharedLinkType.Individual,
    assetIds: [ownAsset, ownArchived],
  });
  const spaceLink = await newLink('spaceLink', {
    userId: owner.id,
    type: SharedLinkType.Individual,
    spaceId: space.id,
    assetIds: [spaceAsset, editorAsset],
  });
  const spaceAlbumLink = await newLink('spaceAlbumLink', {
    userId: owner.id,
    type: SharedLinkType.Album,
    albumId: spaceAlbum.id,
    spaceId: space.id,
  });

  const favorites: Array<[string, string[]]> = [
    [owner.id, [ownAsset, spaceAsset, editorAsset, contributedAsset, ownArchived, dupAsset]],
    [partner.id, [ownAsset, dupAsset2]],
    [spaceEditor.id, [editorAsset, spaceAsset]],
    [spaceViewer.id, [spaceAsset, spaceArchived, albumSpaceAsset, libraryAsset]],
    [spaceViewerOff.id, [spaceAsset]],
    [albumViewer.id, [ownAsset]],
    [stranger.id, [strangerAsset]],
  ];
  await ctx.database
    .insertInto('asset_favorite')
    .values(favorites.flatMap(([userId, assetIds]) => assetIds.map((assetId) => ({ userId, assetId }))))
    .execute();

  const link = (id: string, dto: { albumId?: string; spaceId?: string }) =>
    factory.auth({ user: { id: owner.id }, sharedLink: { id, showExif: true, ...dto } });
  const actors = {
    owner: user(owner.id),
    ownerElevated: user(owner.id, true),
    partner: user(partner.id),
    spaceEditor: user(spaceEditor.id),
    spaceViewer: user(spaceViewer.id),
    spaceViewerOff: user(spaceViewerOff.id),
    albumEditor: user(albumEditor.id),
    albumViewer: user(albumViewer.id),
    stranger: user(stranger.id),
    // The owner through a stock Immich or third-party client (AuthService.authenticate marks it).
    stockOwner: { ...user(owner.id), stockClient: true as const },
    albumLink: link(albumLink, { albumId: ownAlbum.id }),
    individualLink: link(individualLink, {}),
    spaceLink: link(spaceLink, { spaceId: space.id }),
    spaceAlbumLink: link(spaceAlbumLink, { albumId: spaceAlbum.id, spaceId: space.id }),
  };

  return {
    ctx,
    labels,
    actors,
    assets,
    ids: {
      owner: owner.id,
      space: space.id,
      ownAlbum: ownAlbum.id,
      spaceAlbum: spaceAlbum.id,
      tagOwn,
      tagSpace,
      pet: pet.personGroupId,
      memories: { memOwner, memViewer },
      links: { albumLink, individualLink, spaceLink, spaceAlbumLink },
    },
  };
};

let world: Awaited<ReturnType<typeof seed>>;

type Auth = ReturnType<typeof factory.auth>;

const me = (auth: Auth) => auth.user.id;
const user = (id: string, hasElevatedPermission = false) =>
  factory.auth({ user: { id }, session: { hasElevatedPermission } });

const name = (id: string) => world.labels.get(id) ?? 'unknown';
const sorted = (values: Iterable<string>) => [...values].toSorted();
const labelsOf = (items: Array<{ id: string }>) => sorted(items.map(({ id }) => name(id)));
const assetList = (items: Array<{ id: string; isFavorite?: boolean }>) =>
  sorted(items.map(({ id, isFavorite }) => `${name(id)}${isFavorite ? '*' : ''}`));
// Fixture strings carry the asset label (`city-<label>`, `/oracle/<label>/...`), so they map back to labels.
const fromFixture = (value: string | null) =>
  value?.replaceAll(/^(city|state|country|make|model)-|^\/oracle\/|\/$/g, '');
const relabel = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return world.labels.get(value) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => relabel(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relabel(item)]));
  }
  return value;
};

const attempt = async <T>(fn: () => Promise<T>, map: (value: T) => unknown) => {
  try {
    return map(await fn());
  } catch (error) {
    return `error:${(error as Error).constructor.name}`;
  }
};

/** Runs `run(auth, variant)` for every actor and variant and returns `{ actor: { variant: result } }`. */
const matrix = async <V>(
  variants: Record<string, (auth: Auth) => V>,
  run: (auth: Auth, variant: V) => Promise<unknown>,
) => {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [actor, auth] of Object.entries(world.actors)) {
    result[actor] = {};
    for (const [variant, build] of Object.entries(variants)) {
      result[actor][variant] = await run(auth, build(auth));
    }
  }
  return result;
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  world = await seed();
});

describe('viewer-scope RBAC oracle', () => {
  it('timeline buckets and bucket contents', async () => {
    const sut = world.ctx.getService(TimelineService);
    const { owner, space, ownAlbum, spaceAlbum, tagOwn, tagSpace } = world.ids;
    const variants = {
      personal: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        withPartners: true,
        visibility: AssetVisibility.Timeline,
      }),
      personalPlain: (auth: Auth) => ({ userId: me(auth), visibility: AssetVisibility.Timeline }),
      personalAnyVisibility: (auth: Auth) => ({ userId: me(auth) }),
      favorites: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        isFavorite: true,
        visibility: AssetVisibility.Timeline,
      }),
      notFavorites: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        isFavorite: false,
        visibility: AssetVisibility.Timeline,
      }),
      archive: (auth: Auth) => ({ userId: me(auth), visibility: AssetVisibility.Archive }),
      hidden: (auth: Auth) => ({ userId: me(auth), visibility: AssetVisibility.Hidden }),
      locked: (auth: Auth) => ({ userId: me(auth), visibility: AssetVisibility.Locked }),
      trash: (auth: Auth) => ({ userId: me(auth), isTrashed: true }),
      // Rejected by the service; the repository cell below pins what the query itself returns.
      trashShared: (auth: Auth) => ({ userId: me(auth), isTrashed: true, withSharedSpaces: true }),
      stacked: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        withStacked: true,
        visibility: AssetVisibility.Timeline,
      }),
      tag: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        tagIds: [tagSpace],
        visibility: AssetVisibility.Timeline,
      }),
      // The tag page's single tagId is access-checked (owned or reached through a space); tagIds above are not.
      tagPageOwn: (auth: Auth) => ({ userId: me(auth), tagId: tagOwn, visibility: AssetVisibility.Timeline }),
      tagPageSpace: (auth: Auth) => ({
        userId: me(auth),
        withSharedSpaces: true,
        tagId: tagSpace,
        visibility: AssetVisibility.Timeline,
      }),
      partnerTimeline: () => ({ userId: owner, visibility: AssetVisibility.Timeline }),
      space: () => ({ spaceId: space }),
      spaceFavorites: () => ({ spaceId: space, isFavorite: true }),
      ownAlbum: () => ({ albumId: ownAlbum }),
      ownAlbumFavorites: () => ({ albumId: ownAlbum, isFavorite: true }),
      spaceAlbum: () => ({ albumId: spaceAlbum }),
    };

    const result = await matrix<Partial<TimeBucketDto>>(variants, (auth, dto) =>
      attempt(
        async () => {
          const buckets = await sut.getTimeBuckets(auth, { ...dto, bucketSize: TimeBucketSize.Month });
          const items: Array<{ id: string; isFavorite: boolean }> = [];
          for (const { timeBucket } of buckets) {
            const bucket = JSON.parse(
              await sut.getTimeBucket(auth, { ...dto, bucketSize: TimeBucketSize.Month, timeBucket }),
            ) as { id: string[]; isFavorite: boolean[] };
            items.push(...bucket.id.map((id, index) => ({ id, isFavorite: bucket.isFavorite[index] })));
          }
          return { count: buckets.reduce((sum, { count }) => sum + count, 0), items };
        },
        ({ count, items }) => ({ count, assets: assetList(items) }),
      ),
    );
    expect(result).toMatchSnapshot();
  });

  it('time buckets for trash with shared spaces, below the service check', async () => {
    const sut = world.ctx.getService(TimelineService);
    const assetRepository = world.ctx.get(AssetRepository);
    const variants = {
      trashShared: (auth: Auth) => ({ userId: me(auth), isTrashed: true, withSharedSpaces: true }),
    };
    const result = await matrix<Partial<TimeBucketDto>>(variants, (auth, dto) =>
      attempt(async () => {
        const options = await sut['buildTimeBucketOptions'](auth, { ...dto, bucketSize: TimeBucketSize.Month });
        const items: Array<{ id: string }> = [];
        for (const { timeBucket } of await assetRepository.getTimeBuckets(options, auth)) {
          const { assets } = await assetRepository.getTimeBucket(timeBucket, options, auth);
          items.push(...(JSON.parse(assets) as { id: string[] }).id.map((id) => ({ id })));
        }
        return items;
      }, assetList),
    );
    // Link actors carry the link owner's user id here; the service rejects them before this point.
    expect(result).toMatchSnapshot();
    // Another member's trashed space asset never comes through the shared arm.
    for (const member of ['spaceEditor', 'spaceViewer', 'spaceViewerOff'] as const) {
      expect(result[member].trashShared).toEqual([]);
    }
  });

  it('legacy search: metadata, statistics, random and large assets', async () => {
    const sut = world.ctx.getService(SearchService);
    const { space, ownAlbum, spaceAlbum, tagSpace, pet } = world.ids;
    const variants = {
      default: () => ({}),
      shared: () => ({ withSharedSpaces: true }),
      favorites: () => ({ isFavorite: true }),
      sharedFavorites: () => ({ withSharedSpaces: true, isFavorite: true }),
      sharedNotFavorites: () => ({ withSharedSpaces: true, isFavorite: false }),
      archive: () => ({ withSharedSpaces: true, visibility: AssetVisibility.Archive }),
      hidden: () => ({ visibility: AssetVisibility.Hidden }),
      locked: () => ({ visibility: AssetVisibility.Locked }),
      deleted: () => ({ withDeleted: true }),
      space: () => ({ spaceId: space }),
      spaceFavorites: () => ({ spaceId: space, isFavorite: true }),
      ownAlbum: () => ({ albumIds: [ownAlbum] }),
      spaceAlbum: () => ({ albumIds: [spaceAlbum] }),
      tag: () => ({ withSharedSpaces: true, tagIds: [tagSpace] }),
      pet: () => ({ withSharedSpaces: true, personIds: [pet] }),
    };

    const result = await matrix<Partial<MetadataSearchDto>>(variants, async (auth, dto) => ({
      metadata: await attempt(
        () => sut.searchMetadata(auth, { ...dto, size: 1000 }),
        ({ assets }) => assetList(assets.items),
      ),
      statistics: await attempt(
        () => sut.searchStatistics(auth, dto),
        ({ total }) => total,
      ),
      random: await attempt(() => sut.searchRandom(auth, { ...dto, size: 1000 }), assetList),
      large: await attempt(() => sut.searchLargeAssets(auth, { ...dto, size: 1000, minFileSize: 0 }), assetList),
    }));
    expect(result).toMatchSnapshot();
  });

  // Upstream's structured search (V3): the variants mirror the legacy ones above by name, so adopting V3
  // can be checked against the legacy id sets for the same actor and variant. V3 includes trash by default,
  // so `deleted` asks for the trashed rows only; `space*` record that V3 does not take a space id.
  it('search V3: metadata, statistics and random', async () => {
    const sut = world.ctx.getService(SearchService);
    const { space, ownAlbum, spaceAlbum, tagSpace, pet } = world.ids;
    const variants = {
      default: () => ({ filter: {} }),
      shared: () => ({ withSharedSpaces: true, filter: {} }),
      favorites: () => ({ filter: { isFavorite: { eq: true } } }),
      sharedFavorites: () => ({ withSharedSpaces: true, filter: { isFavorite: { eq: true } } }),
      sharedNotFavorites: () => ({ withSharedSpaces: true, filter: { isFavorite: { eq: false } } }),
      archive: () => ({ withSharedSpaces: true, filter: { visibility: { eq: AssetVisibility.Archive } } }),
      hidden: () => ({ filter: { visibility: { eq: AssetVisibility.Hidden } } }),
      locked: () => ({ filter: { visibility: { eq: AssetVisibility.Locked } } }),
      deleted: () => ({ filter: { trashedAt: { ne: null } } }),
      space: () => ({ spaceId: space, filter: {} }),
      spaceFavorites: () => ({ spaceId: space, filter: { isFavorite: { eq: true } } }),
      ownAlbum: () => ({ filter: { albumIds: { any: [ownAlbum] } } }),
      spaceAlbum: () => ({ filter: { albumIds: { any: [spaceAlbum] } } }),
      tag: () => ({ withSharedSpaces: true, filter: { tagIds: { any: [tagSpace] } } }),
      pet: () => ({ withSharedSpaces: true, filter: { personIds: { any: [pet] } } }),
    };

    const result = await matrix<Partial<MetadataSearchDto>>(variants, async (auth, dto) => ({
      metadata: await attempt(
        () => sut.searchMetadata(auth, { ...dto, size: 1000 }),
        ({ assets }) => assetList(assets.items),
      ),
      statistics: await attempt(
        () => sut.searchStatistics(auth, dto),
        ({ total }) => total,
      ),
      random: await attempt(() => sut.searchRandom(auth, { ...dto, size: 1000 }), assetList),
    }));
    expect(result).toMatchSnapshot();
  });

  it('search suggestions and filter facets', async () => {
    const sut = world.ctx.getService(SearchService);
    const { space, ownAlbum, spaceAlbum } = world.ids;
    const variants = {
      default: () => ({}),
      shared: () => ({ withSharedSpaces: true }),
      sharedFavorites: () => ({ withSharedSpaces: true, isFavorite: true }),
      space: () => ({ spaceId: space }),
      ownAlbum: () => ({ albumId: ownAlbum }),
      spaceAlbum: () => ({ albumId: spaceAlbum }),
    };

    const result = await matrix(variants, async (auth, dto) => ({
      makes: await attempt(
        () => sut.getSearchSuggestions(auth, { ...dto, type: SearchSuggestionType.CAMERA_MAKE }),
        (values) => sorted(values.map((value) => fromFixture(value) ?? 'null')),
      ),
      tags: await attempt(() => sut.getTagSuggestions(auth, dto), labelsOf),
      facets: await attempt(
        () => sut.getFilterSuggestions(auth, dto),
        (facets) =>
          relabel({
            ...facets,
            countries: sorted(facets.countries.map((value) => fromFixture(value)!)),
            cameraMakes: sorted(facets.cameraMakes.map((value) => fromFixture(value)!)),
          }),
      ),
    }));
    expect(result).toMatchSnapshot();
  });

  it('explore and places', async () => {
    const sut = world.ctx.getService(SearchService);
    const assetRepository = world.ctx.get(AssetRepository);
    const result = await matrix({ default: () => ({}) }, async (auth) => ({
      // getExploreData's city strip needs five assets per city; the builder is driven with the same scope here.
      cities: await attempt(
        async () => {
          const { timelineSpaceIds } = await sut.resolveViewerScope(auth, 'search', { withSharedSpaces: true });
          return assetRepository.getAssetIdByCity(auth.user.id, {
            maxFields: 100,
            minAssetsPerField: 1,
            timelineSpaceIds,
          });
        },
        ({ items }) => sorted(items.map(({ data }) => name(data))),
      ),
      explore: await attempt(
        () => sut.getExploreData(auth),
        (fields) =>
          Object.fromEntries(
            fields.map(({ fieldName, items }) => [fieldName, assetList(items.map(({ data }) => data))]),
          ),
      ),
      places: await attempt(() => sut.getAssetsByCity(auth), assetList),
    }));
    expect(result).toMatchSnapshot();
  });

  it('map markers', async () => {
    const mapService = world.ctx.getService(MapService);
    const spaceService = world.ctx.getService(SharedSpaceService);
    const albumService = world.ctx.getService(AlbumService);
    const { space, ownAlbum, spaceAlbum } = world.ids;

    const plain = await matrix<MapMarkerDto>(
      {
        default: () => ({}),
        shared: () => ({ withSharedSpaces: true }),
        partners: () => ({ withPartners: true }),
        sharedAlbums: () => ({ withSharedAlbums: true }),
        favorites: () => ({ isFavorite: true }),
        sharedFavorites: () => ({ withSharedSpaces: true, isFavorite: true }),
        sharedArchived: () => ({ withSharedSpaces: true, isArchived: true }),
      },
      (auth, dto) => attempt(() => mapService.getMapMarkers(auth, dto), labelsOf),
    );
    const filtered = await matrix<FilteredMapMarkerDto>(
      {
        default: () => ({}),
        shared: () => ({ withSharedSpaces: true }),
        sharedFavorites: () => ({ withSharedSpaces: true, isFavorite: true }),
        space: () => ({ spaceId: space }),
        spaceFavorites: () => ({ spaceId: space, isFavorite: true }),
        ownAlbum: () => ({ albumId: ownAlbum }),
        spaceAlbum: () => ({ albumId: spaceAlbum }),
      },
      (auth, dto) => attempt(() => spaceService.getFilteredMapMarkers(auth, dto), labelsOf),
    );
    const scoped = await matrix({ default: () => ({}) }, async (auth) => ({
      ownAlbum: await attempt(() => albumService.getMapMarkers(auth, ownAlbum), labelsOf),
      spaceAlbum: await attempt(() => albumService.getMapMarkers(auth, spaceAlbum), labelsOf),
      space: await attempt(() => spaceService.getMapMarkers(auth, space), labelsOf),
    }));
    expect({ plain, filtered, scoped }).toMatchSnapshot();
  });

  it('memories', async () => {
    const sut = world.ctx.getService(MemoryService);
    const { memOwner, memViewer } = world.ids.memories;
    const result = await matrix({ default: () => ({}) }, async (auth) => ({
      search: await attempt(
        () => sut.search(auth, {}),
        (memories) => Object.fromEntries(memories.map(({ id, assets }) => [name(id), assetList(assets)])),
      ),
      memOwner: await attempt(
        () => sut.get(auth, memOwner),
        ({ assets }) => assetList(assets),
      ),
      memViewer: await attempt(
        () => sut.get(auth, memViewer),
        ({ assets }) => assetList(assets),
      ),
      statistics: await attempt(
        () => sut.statistics(auth, {}),
        (stats) => stats,
      ),
    }));
    expect(result).toMatchSnapshot();
  });

  it('folders', async () => {
    const sut = world.ctx.getService(ViewService);
    const result = await matrix({ default: () => ({}) }, (auth) =>
      attempt(
        async () => {
          const paths = await sut.getUniqueOriginalPaths(auth);
          const assets = [];
          for (const path of paths) {
            assets.push(...(await sut.getAssetsByOriginalPath(auth, path)));
          }
          return { paths, assets };
        },
        ({ paths, assets }) => ({ paths: sorted(paths.map((path) => fromFixture(path)!)), assets: assetList(assets) }),
      ),
    );
    expect(result).toMatchSnapshot();
  });

  it('tags', async () => {
    const sut = world.ctx.getService(TagService);
    const result = await matrix({ default: () => ({}) }, (auth) => attempt(() => sut.getAll(auth), labelsOf));
    expect(result).toMatchSnapshot();
  });

  it('download info', async () => {
    const sut = world.ctx.getService(DownloadService);
    const { owner, space, ownAlbum, spaceAlbum } = world.ids;
    const result = await matrix<DownloadInfoDto>(
      {
        ownAlbum: () => ({ albumId: ownAlbum }),
        spaceAlbum: () => ({ albumId: spaceAlbum }),
        space: () => ({ spaceId: space }),
        me: (auth: Auth) => ({ userId: me(auth) }),
        partnerTimeline: () => ({ userId: owner }),
      },
      (auth, dto) =>
        attempt(
          () => sut.getDownloadInfo(auth, dto),
          ({ archives }) => sorted(archives.flatMap(({ assetIds }) => assetIds.map((id) => name(id)))),
        ),
    );
    expect(result).toMatchSnapshot();
  });

  it('shared links', async () => {
    const sut = world.ctx.getService(SharedLinkService);
    const links = world.ids.links;
    const result: Record<string, unknown> = {};
    for (const [actor, auth] of Object.entries(world.actors)) {
      const entry: Record<string, unknown> = {
        mine: await attempt(
          () => sut.getMine(auth, []),
          ({ assets, album }) => ({ assets: assetList(assets), album: album ? name(album.id) : null }),
        ),
      };
      for (const [linkName, id] of Object.entries(links)) {
        entry[linkName] = await attempt(
          () => sut.get(auth, id),
          ({ assets }) => assetList(assets),
        );
      }
      result[actor] = entry;
    }
    expect(result).toMatchSnapshot();
  });

  it('asset detail, statistics, albums, duplicates and stacks', async () => {
    const assetService = world.ctx.getService(AssetService);
    const albumService = world.ctx.getService(AlbumService);
    const duplicateService = world.ctx.getService(DuplicateService);
    const stackService = world.ctx.getService(StackService);
    const { ownAlbum, spaceAlbum } = world.ids;
    const result: Record<string, unknown> = {};
    for (const [actor, auth] of Object.entries(world.actors)) {
      const detail: string[] = [];
      const canEdit: string[] = [];
      for (const id of Object.values(world.assets)) {
        const asset = await attempt(
          () => assetService.get(auth, id),
          (dto) => dto,
        );
        if ((asset as { canEdit?: boolean }).canEdit) {
          canEdit.push(name(id));
        }
        if (typeof asset === 'object' && asset) {
          detail.push(...assetList([asset as { id: string; isFavorite?: boolean }]));
        }
      }
      result[actor] = {
        detail: sorted(detail),
        canEdit: sorted(canEdit),
        statistics: await attempt(
          () => assetService.getStatistics(auth, {}),
          (stats) => stats,
        ),
        favoriteStatistics: await attempt(
          () => assetService.getStatistics(auth, { isFavorite: true }),
          (stats) => stats,
        ),
        albums: await attempt(
          () => albumService.getAll(auth, {}),
          (albums) => Object.fromEntries(albums.map(({ id, assetCount }) => [name(id), assetCount])),
        ),
        ownAlbum: await attempt(
          () => albumService.get(auth, ownAlbum),
          ({ assetCount }) => assetCount,
        ),
        spaceAlbum: await attempt(
          () => albumService.get(auth, spaceAlbum),
          ({ assetCount }) => assetCount,
        ),
        duplicates: await attempt(
          () => duplicateService.getDuplicates(auth),
          (groups) =>
            groups.map(({ assets }) => assetList(assets)).toSorted((a, b) => a.join(',').localeCompare(b.join(','))),
        ),
        stacks: await attempt(
          () => stackService.search(auth, {}),
          (stacks) =>
            stacks
              .map(({ id, assets }) => ({ stack: name(id), assets: assetList(assets) }))
              .toSorted((a, b) => a.stack.localeCompare(b.stack)),
        ),
      };
    }
    expect(result).toMatchSnapshot();
  });

  // The one write surface here: which assets each actor can put its own tag on through PUT /tags/assets. #734 lets a
  // space Owner/Editor tag a member's space asset (AssetUpdate plus the space edit grant); a viewer, a non-member and
  // a shared link tag nothing. Runs last because it writes; each actor's tag is deleted again.
  it('tag writes', async () => {
    const sut = world.ctx.getService(TagService);
    world.ctx.getMock(EventRepository).emit.mockResolvedValue();
    const result: Record<string, unknown> = {};
    for (const [actor, auth] of Object.entries(world.actors)) {
      const { tag } = await world.ctx.newTag({ userId: me(auth), value: `write-${actor}` });
      const bulk = await attempt(
        () => sut.bulkTagAssets(auth, { tagIds: [tag.id], assetIds: Object.values(world.assets) }),
        ({ count }) => count,
      );
      const tagged = await world.ctx.database
        .selectFrom('tag_asset')
        .select('assetId as id')
        .where('tagId', '=', tag.id)
        .execute();
      result[actor] = { bulk, tagged: labelsOf(tagged) };
      await world.ctx.database.deleteFrom('tag').where('id', '=', tag.id).execute();
    }
    expect(result).toMatchSnapshot();
  });
});
