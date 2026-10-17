import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { SmartSearchFacetsDto } from 'src/dtos/search.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import {
  FilterSuggestionsRequestDto,
  FilterSuggestionsResponseDto,
  SmartSearchFacetsResponseDto,
  TagSuggestionRequestDto,
  TagSuggestionResponseDto,
} from 'src/gallery/dtos/search.dto.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { SearchService } from 'src/services/search.service.js';

@ApiTags(ApiTag.Search)
@Controller('search')
export class GallerySearchController {
  constructor(private service: SearchService) {}

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
