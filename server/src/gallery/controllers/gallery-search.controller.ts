import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { ApiTag, Permission } from 'src/enum.js';
import { SearchOptionsRequestDto, SearchOptionsResponseDto } from 'src/gallery/dtos/search.dto.js';
import { GallerySearchService } from 'src/gallery/services/gallery-search.service.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';

// Fork-only search routes. Mounted before SearchController (see src/gallery/index.ts); `/search` has no `:id` route, so
// the order only matters for consistency.
@ApiTags(ApiTag.Search)
@Controller('search')
export class GallerySearchController {
  constructor(private service: GallerySearchService) {}

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
    return this.service.getSearchOptions(auth, dto);
  }
}
