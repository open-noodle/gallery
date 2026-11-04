import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { SmartSearchFacetsDto } from 'src/dtos/search.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import {
  FilterSuggestionsRequestDto,
  FilterSuggestionsResponseDto,
  SearchOptionsRequestDto,
  SearchOptionsResponseDto,
  SmartSearchFacetsResponseDto,
  TagSuggestionRequestDto,
  TagSuggestionResponseDto,
} from 'src/gallery/dtos/search.dto.js';
import { GallerySearchService } from 'src/gallery/services/gallery-search.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { SearchService } from 'src/services/search.service.js';

// Fork-only search routes. Mounted before SearchController (see src/gallery/index.ts); `/search` has no `:id` route, so
// the order only matters for consistency.
@ApiTags(ApiTag.Search)
@Controller('search')
export class GallerySearchController {
  constructor(
    private service: SearchService,
    private gallerySearchService: GallerySearchService,
  ) {}

  @Post('options')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Search filter options with counts',
    description:
      'Returns the filter options (people, tags, places, cameras, ratings, media types, months) with the number of matching assets each would leave, for the same filters and scope the results call takes. Single-choice options ignore their own filter; people and tags keep it. Send `query` or `queryAssetId` to count over smart-search results.',
    history: new HistoryBuilder().added('v2').beta('v2'),
  })
  getSearchOptions(@Auth() auth: AuthDto, @Body() dto: SearchOptionsRequestDto): Promise<SearchOptionsResponseDto> {
    return this.gallerySearchService.getSearchOptions(auth, dto);
  }

  @Post('smart/facets')
  @Authenticated({ permission: Permission.AssetRead })
  @HttpCode(HttpStatus.OK)
  @Endpoint({
    summary: 'Smart asset search facets',
    description: 'Retrieve filter facets and timeline buckets for the full smart-search result set.',
    history: new HistoryBuilder().added('v1'),
  })
  searchSmartFacets(@Auth() auth: AuthDto, @Body() dto: SmartSearchFacetsDto): Promise<SmartSearchFacetsResponseDto> {
    return this.service.searchSmartFacets(auth, dto);
  }

  @Get('suggestions/tags')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Retrieve tag suggestions',
    description: 'Retrieve tags present on assets accessible to the user, with optional space and temporal scoping.',
    history: new HistoryBuilder().added('v1'),
  })
  getTagSuggestions(@Auth() auth: AuthDto, @Query() dto: TagSuggestionRequestDto): Promise<TagSuggestionResponseDto[]> {
    return this.service.getTagSuggestions(auth, dto);
  }

  @Get('suggestions/filters')
  @Authenticated({ permission: Permission.AssetRead })
  @Endpoint({
    summary: 'Retrieve dynamic filter suggestions',
    description:
      'Returns available filter values scoped by all other active filters. Each category excludes its own filter (faceted search).',
    history: new HistoryBuilder().added('v1'),
  })
  getFilterSuggestions(
    @Auth() auth: AuthDto,
    @Query() dto: FilterSuggestionsRequestDto,
  ): Promise<FilterSuggestionsResponseDto> {
    return this.service.getFilterSuggestions(auth, dto);
  }
}
