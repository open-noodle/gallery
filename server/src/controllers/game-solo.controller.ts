import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GameChallengeResponseDto,
  GameDailyResponseDto,
  GameSoloCreateDto,
  GameSoloHistoryQueryDto,
  GameSoloHistoryResponseDto,
  GameSoloStatsResponseDto,
} from 'src/dtos/game.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { GameService } from 'src/services/game.service';

/**
 * Solo play: the routes that take no space at all. A separate controller from GameController
 * rather than more methods on it, because these are the only game routes with no `:spaceId` and
 * no `:id` - every one of them is scoped by the caller alone. The shared `/games/:id` routes
 * (get, guess, round image, leaderboard, delete) serve both scopes and stay where they are.
 */
@ApiTags(ApiTag.Games)
@Controller()
export class GameSoloController {
  constructor(private service: GameService) {}

  @Post('games/solo')
  @Authenticated({ permission: Permission.GameCreate })
  @Endpoint({
    summary: 'Start a solo photo guessing challenge',
    description:
      "Generate and freeze a new challenge from the caller's own photos, plus whichever of partner and shared-space photos they have asked for.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createSoloChallenge(@Auth() auth: AuthDto, @Body() dto: GameSoloCreateDto): Promise<GameChallengeResponseDto> {
    return this.service.createSolo(auth, dto);
  }

  @Get('games/solo/daily')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: "Get the caller's daily challenge",
    description:
      "Get today's personal daily challenge, generating it on first read. Returns a null challenge when the caller has no photos usable for one.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSoloDailyChallenge(@Auth() auth: AuthDto): Promise<GameDailyResponseDto> {
    return this.service.getSoloDaily(auth);
  }

  @Get('games/solo/stats')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: "Get the caller's solo statistics",
    description:
      'Streak, best score, average and games played, computed from the games themselves on every read. A player who has never played gets zeroes, never nulls.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSoloStats(@Auth() auth: AuthDto): Promise<GameSoloStatsResponseDto> {
    return this.service.soloStats(auth);
  }

  @Get('games/solo/history')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: "Get the caller's solo game history",
    description:
      'One page of the games the caller has played, newest first. Paging past the last page returns an empty page rather than an error.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getSoloHistory(@Auth() auth: AuthDto, @Query() dto: GameSoloHistoryQueryDto): Promise<GameSoloHistoryResponseDto> {
    return this.service.soloHistory(auth, dto);
  }
}
