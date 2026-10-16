import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import { TimeBucketCoverDto, TimeBucketCoverResponseDto } from 'src/dtos/time-bucket.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { TimelineService } from 'src/services/timeline.service.js';

@ApiTags(ApiTag.Timeline)
@Controller('timeline')
export class GalleryTimelineController {
  constructor(private service: TimelineService) {}

  @Get('bucket-covers')
  @Authenticated({ permission: Permission.AssetRead, sharedLink: true })
  @ApiOkResponse({ type: [TimeBucketCoverResponseDto] })
  @Endpoint({
    summary: 'Get time bucket covers',
    description: 'Resolve representative cover assets for the requested time buckets.',
    history: new HistoryBuilder().added('v1').internal('v1'),
  })
  getTimeBucketCovers(@Auth() auth: AuthDto, @Query() dto: TimeBucketCoverDto) {
    return this.service.getTimeBucketCovers(auth, dto);
  }
}
