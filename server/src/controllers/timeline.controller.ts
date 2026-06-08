import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  TimeBucketAssetDto,
  TimeBucketAssetResponseDto,
  TimeBucketCoverDto,
  TimeBucketCoverResponseDto,
  TimeBucketDto,
} from 'src/dtos/time-bucket.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { TimelineService } from 'src/services/timeline.service';

@ApiTags(ApiTag.Timeline)
@Controller('timeline')
export class TimelineController {
  constructor(private service: TimelineService) {}

  @Get('buckets')
  @Authenticated({ permission: Permission.AssetRead, sharedLink: true })
  @Endpoint({
    summary: 'Get time buckets',
    description: 'Retrieve a list of all minimal time buckets.',
    history: new HistoryBuilder().added('v1').internal('v1'),
  })
  getTimeBuckets(@Auth() auth: AuthDto, @Query() dto: TimeBucketDto) {
    return this.service.getTimeBuckets(auth, dto);
  }

  @Get('bucket')
  @Authenticated({ permission: Permission.AssetRead, sharedLink: true })
  @ApiOkResponse({ type: TimeBucketAssetResponseDto })
  @Header('Content-Type', 'application/json')
  @Endpoint({
    summary: 'Get time bucket',
    description: 'Retrieve a string of all asset ids in a given time bucket.',
    history: new HistoryBuilder().added('v1').internal('v1'),
  })
  getTimeBucket(@Auth() auth: AuthDto, @Query() dto: TimeBucketAssetDto) {
    return this.service.getTimeBucket(auth, dto);
  }

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
