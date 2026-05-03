import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { SystemConfig } from 'src/dtos/config.dto';
import { mapPerson, PersonResponseDto } from 'src/dtos/person.dto';
import {
  isFullyAlbumConfined,
  isNewShapeRequest,
  FilterSuggestionsRequestDto,
  FilterSuggestionsResponseDto,
  LargeAssetSearchDto,
  mapPlaces,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
  SearchFilter,
  SearchPeopleDto,
  SearchPlacesDto,
  SearchResponseDto,
  SearchStatisticsResponseDto,
  SearchSuggestionRequestDto,
  SearchSuggestionType,
  SmartSearchDto,
  SmartSearchFacetsDto,
  SmartSearchFacetsResponseDto,
  StatisticsSearchDto,
  TagSuggestionRequestDto,
  TagSuggestionResponseDto,
} from 'src/dtos/search.dto';
import { AssetOrder, AssetVisibility, Permission } from 'src/enum';
import { AssetSearchScope } from 'src/repositories/search.repository';
import { BaseService } from 'src/services/base.service';
import { requireElevatedPermission } from 'src/utils/access';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { isSmartSearchEnabled } from 'src/utils/misc';
import { decodeSearchCursor, encodeSearchCursor } from 'src/utils/search-cursor';
import { applyLockedVisibilityPolicy, collectFilterIds } from 'src/utils/search-filter';

// Opt-in env flag for per-phase smart-search timing logs. Set
// GALLERY_SEARCH_TIMING=true to emit one `log`-level line per smart search
// breaking down setup / embedding / spaces / db duration. Captured once at
// module load so toggling requires a server restart (keeps the hot path free
// of env reads).
const searchTimingEnabled = process.env.GALLERY_SEARCH_TIMING === 'true';

type ResolvedSmartSearch = {
  options: Omit<SmartSearchDto, 'page' | 'size' | 'order' | 'visibility'> & {
    embedding: string;
    userIds: string[];
    timelineSpaceIds?: string[];
    maxDistance?: number;
    orderDirection?: SmartSearchDto['order'];
    visibility?: AssetVisibility | 'not-locked';
  };
  embeddingSource: 'cache' | 'ml' | 'asset';
  encodeMs: number;
  timelineSpaceCount: number;
};

type ScopedPersonFilterOptions = {
  personIds?: string[];
  identityIds?: string[];
  spacePersonIds?: string[];
  forceEmptyResult?: boolean;
  withSharedSpaces?: boolean;
  spaceId?: string;
  albumId?: string;
  albumIds?: string[];
  timelineSpaceIds?: string[];
};

@Injectable()
export class SearchService extends BaseService {
  private embeddingCache = new LRUMap<string, string>(100);

  async searchPerson(auth: AuthDto, dto: SearchPeopleDto): Promise<PersonResponseDto[]> {
    if (dto.withSharedSpaces) {
      const { machineLearning } = await this.getConfig({ withCache: false });
      return this.faceIdentityRepository.searchAccessiblePeople(auth.user.id, {
        name: dto.name,
        withHidden: dto.withHidden,
        limit: 50,
        minimumFaceCount: machineLearning.facialRecognition.minFaces,
      });
    }

    const people = await this.personRepository.getByName(auth.user.id, dto.name, { withHidden: dto.withHidden });
    return people.map((person) => mapPerson(person));
  }

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  async getExploreData(auth: AuthDto) {
    const options = { maxFields: 12, minAssetsPerField: 5 };

    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const cityAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      cities.items.map(({ data }) => data),
      auth.user.id,
    );
    const cityItems = cityAssets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));

    const recents = await this.assetRepository.getRecentlyCreatedAssetIds(auth.user.id, options.maxFields);
    const recentAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      recents.items.map((item) => item.data),
      auth.user.id,
    );
    const recentItems = recentAssets.map((asset) => ({
      value: asset.createdAt.toISOString(),
      data: mapAsset(asset, { auth }),
    }));

    return [
      { fieldName: cities.fieldName, items: cityItems },
      { fieldName: recents.fieldName, items: recentItems },
    ];
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchMetadataV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    let checksum: Buffer | undefined;
    if (dto.checksum) {
      const encoding = dto.checksum.length === 28 ? 'base64' : 'hex';
      checksum = Buffer.from(dto.checksum, encoding);
    }

    let userIds: string[] | undefined;

    if (dto.albumIds && dto.albumIds.length > 0) {
      await this.requireAccess({ auth, ids: dto.albumIds, permission: Permission.AlbumRead });
    } else if (auth.sharedLink) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    } else {
      userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    }

    const page = dto.page ?? 1;
    const size = dto.size;
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...resolvedDto,
        checksum,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
        userIds,
        viewingUserId: auth.user.id,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null });
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchStatisticsV3(auth, dto);
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });

    return await this.searchRepository.searchStatistics({
      ...resolvedDto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    if (isNewShapeRequest(dto)) {
      return this.searchRandomV3(auth, dto);
    }

    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    const items = await this.searchRepository.searchRandom(dto.size, {
      ...resolvedDto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    if (dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth, dto.visibility);
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    const items = await this.searchRepository.searchLargeAssets(dto.size, {
      ...resolvedDto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
      viewingUserId: auth.user.id,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    if (isNewShapeRequest(dto)) {
      return this.searchSmartV3(auth, dto);
    }

    const t0 = performance.now();
    const { options, embeddingSource, encodeMs, timelineSpaceCount } = await this.resolveSmartSearch(auth, dto, {
      includeOrder: true,
    });
    const tResolved = performance.now();
    const page = dto.page ?? 1;
    const size = dto.size;

    const { hasNextPage, items } = await this.searchRepository.searchSmart({ page, size }, options);
    const tDb = performance.now();

    if (searchTimingEnabled) {
      this.logger.log(
        `searchSmart total=${(tDb - t0).toFixed(0)}ms ` +
          `resolve=${(tResolved - t0).toFixed(0)}ms(src=${embeddingSource}${
            embeddingSource === 'ml' ? `,encode=${encodeMs.toFixed(0)}ms` : ''
          },spaces=${timelineSpaceCount}) ` +
          `db=${(tDb - tResolved).toFixed(0)}ms(rows=${items.length}) ` +
          `query="${dto.query?.slice(0, 60) ?? ''}" size=${size}`,
      );
    }

    return this.mapResponse(items, { auth }, { nextPage: hasNextPage ? (page + 1).toString() : null });
  }

  async searchSmartFacets(auth: AuthDto, dto: SmartSearchFacetsDto): Promise<SmartSearchFacetsResponseDto> {
    const t0 = performance.now();
    const { options, embeddingSource, encodeMs, timelineSpaceCount } = await this.resolveSmartSearch(auth, dto, {
      includeOrder: false,
    });
    const tResolved = performance.now();

    const result = await this.searchRepository.getSmartSearchFacets(options);
    const tDb = performance.now();

    if (searchTimingEnabled) {
      this.logger.log(
        `searchSmartFacets total=${(tDb - t0).toFixed(0)}ms ` +
          `resolve=${(tResolved - t0).toFixed(0)}ms(src=${embeddingSource}${
            embeddingSource === 'ml' ? `,encode=${encodeMs.toFixed(0)}ms` : ''
          }) ` +
          `spaces=${timelineSpaceCount} ` +
          `db=${(tDb - tResolved).toFixed(0)}ms(total=${result.total}) ` +
          `query="${dto.query?.slice(0, 60) ?? ''}"`,
      );
    }

    return { ...result, people: result.people.toSorted((a, b) => a.name.localeCompare(b.name)) };
  }

  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const assets = await this.searchRepository.getAssetsByCity(userIds);
    return assets.map((asset) => mapAsset(asset));
  }

  async getSearchSuggestions(auth: AuthDto, dto: SearchSuggestionRequestDto) {
    if (dto.albumId && dto.spaceId) {
      throw new BadRequestException('Cannot use albumId with spaceId');
    }

    if (dto.albumId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use albumId with withSharedSpaces');
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    } else if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth);

    let timelineSpaceIds: string[] | undefined;
    if (dto.withSharedSpaces || dto.albumId) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    const suggestions = await this.getSuggestions(userIds, resolvedDto);
    if (dto.includeNull) {
      suggestions.push(null);
    }
    return suggestions;
  }

  async getTagSuggestions(auth: AuthDto, dto: TagSuggestionRequestDto): Promise<TagSuggestionResponseDto[]> {
    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth);

    let timelineSpaceIds: string[] | undefined;
    if (dto.withSharedSpaces) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    return this.searchRepository.getAccessibleTags(userIds, { ...dto, timelineSpaceIds });
  }

  async getFilterSuggestions(auth: AuthDto, dto: FilterSuggestionsRequestDto): Promise<FilterSuggestionsResponseDto> {
    if (dto.albumId && dto.spaceId) {
      throw new BadRequestException('Cannot use albumId with spaceId');
    }

    if (dto.albumId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use albumId with withSharedSpaces');
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.albumId) {
      await this.requireAccess({ auth, permission: Permission.AlbumRead, ids: [dto.albumId] });
    } else if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    const userIds = await this.getUserIdsToSearch(auth);

    let timelineSpaceIds: string[] | undefined;
    if (dto.withSharedSpaces || dto.albumId) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    return await this.searchRepository.getFilterSuggestions(userIds, resolvedDto);
  }

  private getSuggestions(
    userIds: string[],
    dto: SearchSuggestionRequestDto & ScopedPersonFilterOptions,
  ): Promise<Array<string | null>> {
    switch (dto.type) {
      case SearchSuggestionType.COUNTRY: {
        return this.searchRepository.getCountries(userIds, dto);
      }
      case SearchSuggestionType.STATE: {
        return this.searchRepository.getStates(userIds, dto);
      }
      case SearchSuggestionType.CITY: {
        return this.searchRepository.getCities(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MAKE: {
        return this.searchRepository.getCameraMakes(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_MODEL: {
        return this.searchRepository.getCameraModels(userIds, dto);
      }
      case SearchSuggestionType.CAMERA_LENS_MODEL: {
        return this.searchRepository.getCameraLensModels(userIds, dto);
      }
      default: {
        return Promise.resolve([]);
      }
    }
  }

  private async searchMetadataV3(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);

    const { offset } = decodeSearchCursor(dto.cursor);
    const size = dto.size;
    const { hasNextPage, items } = await this.searchRepository.searchMetadataV3(
      { take: size, skip: offset },
      {
        filter,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
        order: dto.orderBy,
      },
      scope,
    );

    return this.mapResponse(items, { auth }, { nextCursor: hasNextPage ? encodeSearchCursor(offset + size) : null });
  }

  private async searchStatisticsV3(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    return this.searchRepository.searchStatisticsV3({ filter }, scope);
  }

  private async searchRandomV3(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    const { filter, scope } = await this.resolveSearchScopeV3(auth, dto);
    const items = await this.searchRepository.searchRandomV3(
      dto.size,
      {
        filter,
        withExif: dto.withExif,
        withPeople: dto.withPeople,
        withStacked: dto.withStacked,
      },
      scope,
    );
    return items.map((item) => mapAsset(item, { auth }));
  }

  private async searchSmartV3(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    const { machineLearning } = await this.getConfig({ withCache: false });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search is not enabled');
    }

    const [{ filter, scope }, embedding] = await Promise.all([
      this.resolveSearchScopeV3(auth, dto),
      this.resolveEmbedding(auth, dto, machineLearning),
    ]);

    // no cursor until a rank-aware pagination strategy for smart search is decided
    const { items } = await this.searchRepository.searchSmartV3(
      { take: dto.size },
      { filter, withExif: dto.withExif, embedding },
      scope,
    );

    return this.mapResponse(items, { auth });
  }

  private async resolveSearchScopeV3(
    auth: AuthDto,
    dto: { filter?: SearchFilter },
  ): Promise<{ filter: SearchFilter; scope: AssetSearchScope }> {
    const filter = dto.filter ?? {};
    const effectiveFilter = applyLockedVisibilityPolicy(auth, filter);

    const fullyConfined = isFullyAlbumConfined(filter);
    // a shared link visitor does not have a universe, so there every branch must be confined
    if (auth.sharedLink && !fullyConfined) {
      throw new BadRequestException('Shared link access is only allowed in combination with an albumIds filter');
    }

    const albumIds = collectFilterIds(filter, 'albumIds');
    const [userIds] = await Promise.all([
      // a fully confined filter searches albums only, so the unused universe can skip the partner lookup
      fullyConfined ? [auth.user.id] : this.getUserIdsToSearch(auth),
      albumIds.length > 0 ? this.requireAccess({ auth, ids: albumIds, permission: Permission.AlbumRead }) : undefined,
    ]);

    return { filter: effectiveFilter, scope: { userIds, lockedOwnerId: auth.user.id, viewingUserId: auth.user.id } };
  }

  private async resolveEmbedding(
    auth: AuthDto,
    dto: SmartSearchDto,
    machineLearning: SystemConfig['machineLearning'],
  ): Promise<string> {
    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      let embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        this.embeddingCache.set(key, embedding);
      }
      return embedding;
    }

    if (dto.queryAssetId) {
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      // Fork: searchRepository.getEmbedding returns the embedding directly (string | null),
      // not upstream's { embedding } row — see search.repository.ts.
      const assetEmbedding = await this.searchRepository.getEmbedding(dto.queryAssetId);
      if (!assetEmbedding) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }
      return assetEmbedding;
    }

    throw new BadRequestException('Either `query` or `queryAssetId` must be set');
  }

  private async resolveSmartSearch(
    auth: AuthDto,
    dto: SmartSearchDto | SmartSearchFacetsDto,
    options: { includeOrder: boolean },
  ): Promise<ResolvedSmartSearch> {
    if ('visibility' in dto && dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    // Cached read — the uncached path runs class-transformer + class-validator over
    // the full nested SystemConfigDto, which is ~1-3s per call on slower CPUs and
    // dominates smart-search latency. Cache invalidates on ConfigUpdate.
    const { machineLearning } = await this.getConfig({ withCache: true });
    if (!isSmartSearchEnabled(machineLearning)) {
      throw new BadRequestException('Smart search is not enabled');
    }

    let embedding: string | undefined;
    let encodeMs = 0;
    let embeddingSource: 'cache' | 'ml' | 'asset' = 'cache';
    if (dto.query) {
      const key = machineLearning.clip.modelName + dto.query + dto.language;
      embedding = this.embeddingCache.get(key);
      if (!embedding) {
        embeddingSource = 'ml';
        const tEncodeStart = performance.now();
        embedding = await this.machineLearningRepository.encodeText(dto.query, {
          modelName: machineLearning.clip.modelName,
          language: dto.language,
        });
        encodeMs = performance.now() - tEncodeStart;
        this.embeddingCache.set(key, embedding);
      }
    } else if (dto.queryAssetId) {
      embeddingSource = 'asset';
      await this.requireAccess({ auth, permission: Permission.AssetRead, ids: [dto.queryAssetId] });
      const assetEmbedding = await this.searchRepository.getEmbedding(dto.queryAssetId);
      if (!assetEmbedding) {
        throw new BadRequestException(`Asset ${dto.queryAssetId} has no embedding`);
      }
      embedding = assetEmbedding;
    } else {
      throw new BadRequestException('Either `query` or `queryAssetId` must be set');
    }

    let timelineSpaceIds: string[] | undefined;
    if (dto.withSharedSpaces || !!('albumIds' in dto && dto.albumIds?.length)) {
      const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
      if (spaceRows.length > 0) {
        timelineSpaceIds = spaceRows.map((row) => row.spaceId);
      }
    }

    const visibility = 'visibility' in dto ? dto.visibility : undefined;
    const resolvedOptions = await this.resolveScopedPersonFilters(auth, {
      ...dto,
      timelineSpaceIds,
      userIds: await this.getUserIdsToSearch(auth, visibility),
      viewingUserId: auth.user.id,
      embedding,
      maxDistance: machineLearning.clip.maxDistance,
      visibility: visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
    });

    if (options.includeOrder) {
      Object.assign(resolvedOptions, { orderDirection: 'order' in dto ? dto.order : undefined });
    }

    return {
      options: resolvedOptions,
      embeddingSource,
      encodeMs,
      timelineSpaceCount: timelineSpaceIds?.length ?? 0,
    };
  }

  private async getUserIdsToSearch(auth: AuthDto, visibility?: AssetVisibility): Promise<string[]> {
    // Locked assets are personal. Never include partner IDs, regardless of elevated session.
    if (visibility === AssetVisibility.Locked) {
      return [auth.user.id];
    }
    const partnerIds = await getMyPartnerIds({
      userId: auth.user.id,
      repository: this.partnerRepository,
      timelineEnabled: true,
    });
    return [auth.user.id, ...partnerIds];
  }

  private async getTimelineSpaceIds(auth: AuthDto, withSharedSpaces?: boolean): Promise<string[] | undefined> {
    if (!withSharedSpaces) {
      return;
    }

    const spaceRows = await this.sharedSpaceRepository.getSpaceIdsForTimeline(auth.user.id);
    return spaceRows.length > 0 ? spaceRows.map((row) => row.spaceId) : undefined;
  }

  private async resolveScopedPersonFilters<T extends ScopedPersonFilterOptions>(
    auth: AuthDto,
    dto: T,
  ): Promise<T & ScopedPersonFilterOptions> {
    const tokens = dto.personIds?.filter(Boolean) ?? [];
    const hasScopedTokens = tokens.some((token) => token.includes(':'));
    const isGlobalSharedScope = dto.withSharedSpaces || !!dto.albumId || !!dto.albumIds?.length;
    const shouldResolve = tokens.length > 0 && (isGlobalSharedScope || hasScopedTokens);

    if (!shouldResolve) {
      return dto;
    }

    const resolution = await this.faceIdentityRepository.resolveScopedPersonTokens({
      userId: auth.user.id,
      tokens,
      scope: {
        withSharedSpaces: isGlobalSharedScope,
        timelineSpaceIds: dto.timelineSpaceIds,
        spaceId: dto.spaceId,
      },
    });

    return {
      ...dto,
      personIds: resolution.legacyPersonIds,
      identityIds: resolution.identityIds,
      spacePersonIds: [...new Set([...(dto.spacePersonIds ?? []), ...resolution.legacySpacePersonIds])],
      forceEmptyResult: dto.forceEmptyResult || resolution.hasInaccessibleToken,
    };
  }

  private mapResponse(
    assets: MapAsset[],
    options: AssetMapOptions,
    page: { nextPage?: string | null; nextCursor?: string | null } = {},
  ): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => mapAsset(asset, options)),
        facets: [],
        nextPage: page.nextPage ?? null,
        nextCursor: page.nextCursor ?? null,
      },
    };
  }
}
