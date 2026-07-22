import { BadRequestException, Injectable } from '@nestjs/common';
import { LRUMap } from 'mnemonist';
import { AssetMapOptions, AssetResponseDto, MapAsset, mapAsset } from 'src/dtos/asset-response.dto';
import { AuthDto } from 'src/dtos/auth.dto';
import { mapPerson, PersonResponseDto } from 'src/dtos/person.dto';
import {
  FilterSuggestionsRequestDto,
  FilterSuggestionsResponseDto,
  LargeAssetSearchDto,
  mapPlaces,
  MetadataSearchDto,
  PlacesResponseDto,
  RandomSearchDto,
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
import { BaseService } from 'src/services/base.service';
import { requireElevatedPermission } from 'src/utils/access';
import { getMyPartnerIds } from 'src/utils/asset.util';
import { isSmartSearchEnabled } from 'src/utils/misc';

// Opt-in env flag for per-phase smart-search timing logs. Set
// GALLERY_SEARCH_TIMING=true to emit one `log`-level line per smart search
// breaking down setup / embedding / spaces / db duration. Captured once at
// module load so toggling requires a server restart (keeps the hot path free
// of env reads).
const searchTimingEnabled = process.env.GALLERY_SEARCH_TIMING === 'true';

const unique = <T>(items: T[]) => [...new Set(items)];

type ResolvedSmartSearch = {
  options: Omit<SmartSearchDto, 'page' | 'size' | 'order' | 'visibility'> & {
    embedding: string;
    // Optional: an `albumIds` scope deliberately leaves this unset so the album access check is the
    // boundary and `albumSharedSpaceScope` re-gates — see resolveSmartSearch.
    userIds?: string[];
    callerId?: string;
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
  visibility?: AssetVisibility | 'not-locked';
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

    const people = await this.personRepository.getByName(auth.user.id, dto.name, {
      withHidden: dto.withHidden,
      hasElevatedPermission: auth.session?.hasElevatedPermission,
    });
    return people.map((person) => mapPerson(person));
  }

  async searchPlaces(dto: SearchPlacesDto): Promise<PlacesResponseDto[]> {
    const places = await this.searchRepository.searchPlaces(dto.name);
    return places.map((place) => mapPlaces(place));
  }

  /**
   * #867: the places strip is scoped like the home timeline (own + timeline-enabled spaces), not
   * like an owner-private surface. Without it a space member saw no tile for a city that only
   * exists on assets shared with them, even though the location filter listed that city and the
   * filtered timeline returned those assets. The recently-added strip below stays owner-scoped — it
   * answers "what did I just add", and /recently-added is itself an owner surface.
   */
  async getExploreData(auth: AuthDto) {
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, true);
    const options = { maxFields: 12, minAssetsPerField: 1, timelineSpaceIds };

    const cities = await this.assetRepository.getAssetIdByCity(auth.user.id, options);
    const cityAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      cities.items.map(({ data }) => data),
    );
    const cityItems = cityAssets.map((asset) => ({ value: asset.exifInfo!.city!, data: mapAsset(asset, { auth }) }));

    const recents = await this.assetRepository.getRecentlyCreatedAssetIds(auth.user.id, options.maxFields);
    const recentAssets = await this.assetRepository.getByIdsWithAllRelationsButStacks(
      recents.items.map((item) => item.data),
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

  /**
   * Fork RBAC (H-1): trash is an owner-private state; a shared-space-scoped search must never enumerate
   * another member's trashed assets. Reject withDeleted / trashedAfter / trashedBefore / isOffline when a
   * space scope (spaceId or withSharedSpaces) is set — mirrors timeBucketChecks (timeline.service.ts) and
   * the caller-proof SQL gate in searchAssetBuilder. trashedAfter/trashedBefore/isOffline implicitly flip
   * withDeleted (searchAssetBuilder :676), so they are rejected too. StatisticsSearchDto has no withDeleted
   * field (optional here → undefined); it is still reachable via the implicit-flip params.
   */
  private rejectTrashParamsForSpaceScope(dto: {
    spaceId?: string;
    withSharedSpaces?: boolean;
    withDeleted?: boolean;
    trashedAfter?: Date;
    trashedBefore?: Date;
    isOffline?: boolean;
  }): void {
    const spaceScope = !!dto.spaceId || !!dto.withSharedSpaces;
    const wantsTrashOrOffline = !!dto.withDeleted || !!dto.trashedAfter || !!dto.trashedBefore || !!dto.isOffline;
    if (spaceScope && wantsTrashOrOffline) {
      throw new BadRequestException('Trashed and offline assets are not available when searching a shared space');
    }
  }

  async searchMetadata(auth: AuthDto, dto: MetadataSearchDto): Promise<SearchResponseDto> {
    this.rejectTrashParamsForSpaceScope(dto);

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
    const size = dto.size || 250;
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, dto.withSharedSpaces || !!dto.albumIds?.length);
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds });
    const { hasNextPage, items } = await this.searchRepository.searchMetadata(
      { page, size },
      {
        ...resolvedDto,
        checksum,
        visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
        userIds,
        orderDirection: dto.order ?? AssetOrder.Desc,
      },
    );

    return this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });
  }

  async searchStatistics(auth: AuthDto, dto: StatisticsSearchDto): Promise<SearchStatisticsResponseDto> {
    this.rejectTrashParamsForSpaceScope(dto);

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
    });
  }

  async searchRandom(auth: AuthDto, dto: RandomSearchDto): Promise<AssetResponseDto[]> {
    this.rejectTrashParamsForSpaceScope(dto);

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
    const items = await this.searchRepository.searchRandom(dto.size || 250, {
      ...resolvedDto,
      userIds,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchLargeAssets(auth: AuthDto, dto: LargeAssetSearchDto): Promise<AssetResponseDto[]> {
    this.rejectTrashParamsForSpaceScope(dto);

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
    const items = await this.searchRepository.searchLargeAssets(dto.size || 250, {
      ...resolvedDto,
      visibility: dto.visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked'),
      userIds,
    });
    return items.map((item) => mapAsset(item, { auth }));
  }

  async searchSmart(auth: AuthDto, dto: SmartSearchDto): Promise<SearchResponseDto> {
    const t0 = performance.now();
    const { options, embeddingSource, encodeMs, timelineSpaceCount } = await this.resolveSmartSearch(auth, dto, {
      includeOrder: true,
    });
    const tResolved = performance.now();
    const page = dto.page ?? 1;
    const size = dto.size || 100;

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

    return this.mapResponse(items, hasNextPage ? (page + 1).toString() : null, { auth });
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

  /** #867: /places is the "view all" of the Explore strip, so it carries the same scope. */
  async getAssetsByCity(auth: AuthDto): Promise<AssetResponseDto[]> {
    const userIds = await this.getUserIdsToSearch(auth);
    const timelineSpaceIds = await this.getTimelineSpaceIds(auth, true);
    const assets = await this.searchRepository.getAssetsByCity(userIds, timelineSpaceIds);
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

    // No dto.visibility to merge with — suggestion request DTOs don't expose an explicit visibility
    // override (unlike search's dto.visibility ?? ...). Resolve the same way search does for the
    // implicit default so suggestions cover the same asset set search would return (LOW #7).
    const visibility = auth.session?.hasElevatedPermission ? undefined : 'not-locked';
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds, visibility });
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

    // See getSearchSuggestions above — same not-locked/elevated resolution (LOW #7).
    const visibility = auth.session?.hasElevatedPermission ? undefined : 'not-locked';
    return this.searchRepository.getAccessibleTags(userIds, { ...dto, timelineSpaceIds, visibility });
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

    // See getSearchSuggestions above — same not-locked/elevated resolution (LOW #7).
    const visibility = auth.session?.hasElevatedPermission ? undefined : 'not-locked';
    const resolvedDto = await this.resolveScopedPersonFilters(auth, { ...dto, timelineSpaceIds, visibility });
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

  private async resolveSmartSearch(
    auth: AuthDto,
    dto: SmartSearchDto | SmartSearchFacetsDto,
    options: { includeOrder: boolean },
  ): Promise<ResolvedSmartSearch> {
    if ('visibility' in dto && dto.visibility === AssetVisibility.Locked) {
      requireElevatedPermission(auth);
    }

    this.rejectTrashParamsForSpaceScope(dto);

    if (dto.spaceId && dto.withSharedSpaces) {
      throw new BadRequestException('Cannot use both spaceId and withSharedSpaces');
    }

    if (dto.spaceId) {
      await this.requireAccess({ auth, permission: Permission.SharedSpaceRead, ids: [dto.spaceId] });
    }

    if (dto.spacePersonIds?.length && !dto.spaceId) {
      throw new BadRequestException('spacePersonIds requires spaceId');
    }

    /**
     * An `albumIds` scope makes the ALBUM the access boundary, exactly as `searchMetadata` already
     * treats it (see the matching branch there): check `AlbumRead` up front, then leave `userIds`
     * unset so `albumSharedSpaceScope` re-gates the rows in the query builder.
     *
     * Keeping the owner-scoping `userIds` here instead was a filter-honesty bug. An album page
     * BROWSES by album access — timeline.service resolves `albumSpaceIds` from plain membership —
     * and shows every member's photos; searching that same album then returned only the caller's
     * own, silently, beside a grid that had just shown everyone's. It also split query mode from
     * browse mode for the same `?album=` filter everywhere else.
     */
    const albumIds = 'albumIds' in dto ? dto.albumIds : undefined;
    const albumScoped = !!albumIds?.length;
    if (albumScoped) {
      await this.requireAccess({ auth, ids: albumIds!, permission: Permission.AlbumRead });
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
    // Annotate so the 'not-locked' literal is preserved through the generic
    // resolveScopedPersonFilters inference (no contextual type widens it to string).
    const resolvedVisibility: AssetVisibility | 'not-locked' | undefined =
      visibility ?? (auth.session?.hasElevatedPermission ? undefined : 'not-locked');
    const resolvedOptions = await this.resolveScopedPersonFilters(auth, {
      ...dto,
      timelineSpaceIds,
      // Undefined under an album scope — the AlbumRead check above is the boundary there, and
      // `albumSharedSpaceScope` in the query builder is what re-gates visibility and trash.
      userIds: albumScoped ? undefined : await this.getUserIdsToSearch(auth, visibility),
      // Always set, unlike userIds: the facets' people list needs the viewer even when nothing is
      // owner-scoped. See SearchEmbeddingOptions.callerId.
      callerId: auth.user.id,
      embedding,
      maxDistance: machineLearning.clip.maxDistance,
      visibility: resolvedVisibility,
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
      personIds: unique(resolution.legacyPersonIds),
      identityIds: unique(resolution.identityIds),
      spacePersonIds: unique([...(dto.spacePersonIds ?? []), ...resolution.legacySpacePersonIds]),
      forceEmptyResult: dto.forceEmptyResult || resolution.hasInaccessibleToken,
    };
  }

  private mapResponse(assets: MapAsset[], nextPage: string | null, options: AssetMapOptions): SearchResponseDto {
    return {
      albums: { total: 0, count: 0, items: [], facets: [] },
      assets: {
        total: assets.length,
        count: assets.length,
        items: assets.map((asset) => mapAsset(asset, options)),
        facets: [],
        nextPage,
      },
    };
  }
}
