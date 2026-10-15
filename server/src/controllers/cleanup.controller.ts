import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthDto } from 'src/dtos/auth.dto.js';
import { Endpoint, HistoryBuilder } from 'src/decorators.js';
import {
  CleanupCalendarQueryDto,
  CleanupCalendarResponseDto,
  CleanupCommitDto,
  CleanupCommitResponseDto,
  CleanupCountParamDto,
  CleanupCountResponseDto,
  CleanupDecisionDeleteDto,
  CleanupInSpacesDto,
  CleanupInSpacesResponseDto,
  CleanupMonthDayParamDto,
  CleanupQueuePageDto,
  CleanupQueueParamDto,
  CleanupQueueQueryDto,
  CleanupRewindAssetsResponseDto,
  CleanupRewindYearParamDto,
  CleanupRewindYearsResponseDto,
  CleanupTrashResponseDto,
} from 'src/dtos/cleanup.dto.js';
import { ApiTag, Permission } from 'src/enum.js';
import { Auth, Authenticated } from 'src/middleware/auth.guard.js';
import { CleanupService } from 'src/services/cleanup.service.js';

@ApiTags(ApiTag.Cleanup)
@Controller('cleanup')
export class CleanupController {
  constructor(private service: CleanupService) {}

  // Route order: `:queue/count` must be declared before `:queue`, or Nest would match `count` as a
  // `:queue` value on the list route instead.
  @Get('queues/:queue/count')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get a cleanup queue count',
    description:
      'Return the count and total size of a cleanup queue, honouring the same filters as the list route so the hub can show a matching count per card.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupQueueCount(
    @Auth() auth: AuthDto,
    @Param() { queue }: CleanupCountParamDto,
    @Query() dto: CleanupQueueQueryDto,
  ): Promise<CleanupCountResponseDto> {
    return this.service.getQueueCount(auth, queue, dto);
  }

  @Get('trash')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get cleanup trash totals',
    description: 'Return the count and total size of the caller’s trashed assets that are not in an external library.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupTrash(@Auth() auth: AuthDto): Promise<CleanupTrashResponseDto> {
    return this.service.getTrash(auth);
  }

  @Get('calendar')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get the cleanup calendar',
    description: 'Return per-day asset counts and review state for every calendar date, plus the review streak.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupCalendar(
    @Auth() auth: AuthDto,
    @Query() { tz }: CleanupCalendarQueryDto,
  ): Promise<CleanupCalendarResponseDto> {
    return this.service.getCalendar(auth, tz);
  }

  @Get('rewind/:monthDay')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get rewind years for a date',
    description: 'Return the years, newest first, that have assets on this calendar date.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupRewindYears(
    @Auth() auth: AuthDto,
    @Param() { monthDay }: CleanupMonthDayParamDto,
  ): Promise<CleanupRewindYearsResponseDto> {
    return this.service.getRewindYears(auth, monthDay);
  }

  @Get('rewind/:monthDay/:year')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get rewind assets for a date and year',
    description: 'Return the assets on this calendar date in this year.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupRewindAssets(
    @Auth() auth: AuthDto,
    @Param() { monthDay, year }: CleanupRewindYearParamDto,
  ): Promise<CleanupRewindAssetsResponseDto> {
    return this.service.getRewindAssets(auth, monthDay, year);
  }

  @Get('queues/:queue')
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get a cleanup queue page',
    description: 'Return a keyset page of a cleanup queue, using cursor-based pagination.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupQueue(
    @Auth() auth: AuthDto,
    @Param() { queue }: CleanupQueueParamDto,
    @Query() dto: CleanupQueueQueryDto,
  ): Promise<CleanupQueuePageDto> {
    return this.service.getQueue(auth, queue, dto);
  }

  @Post('commit')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.CleanupUpdate })
  @Endpoint({
    summary: 'Commit cleanup decisions',
    description:
      'Trash, favourite and keep the given asset ids for a queue, skipping ids the caller cannot act on instead of failing the whole batch, and optionally mark a rewind date reviewed.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  commitCleanup(@Auth() auth: AuthDto, @Body() dto: CleanupCommitDto): Promise<CleanupCommitResponseDto> {
    return this.service.commit(auth, dto);
  }

  @Delete('decisions')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Authenticated({ permission: Permission.CleanupUpdate })
  @Endpoint({
    summary: 'Delete cleanup decisions',
    description: 'Remove a keep decision for the given asset ids in a queue.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  deleteCleanupDecisions(@Auth() auth: AuthDto, @Body() dto: CleanupDecisionDeleteDto): Promise<void> {
    return this.service.deleteDecisions(auth, dto);
  }

  @Post('in-spaces')
  @HttpCode(HttpStatus.OK)
  @Authenticated({ permission: Permission.CleanupRead })
  @Endpoint({
    summary: 'Get which cleanup assets are in a shared space',
    description: 'Return the subset of the given asset ids, owned by the caller, that belong to any shared space.',
    history: new HistoryBuilder().added('v3.3.0').alpha('v3.3.0'),
  })
  getCleanupAssetsInSpaces(
    @Auth() auth: AuthDto,
    @Body() dto: CleanupInSpacesDto,
  ): Promise<CleanupInSpacesResponseDto> {
    return this.service.getAssetsInSpaces(auth, dto);
  }
}
