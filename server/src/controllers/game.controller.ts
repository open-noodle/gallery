import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Next, Param, Post, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NextFunction, Response } from 'express';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GameChallengeDetailResponseDto,
  GameChallengeListItemResponseDto,
  GameChallengeResponseDto,
  GameCreateDto,
  GameDailyResponseDto,
  GameGuessDto,
  GameGuessResponseDto,
  GameLeaderboardResponseDto,
  GameRoundParamDto,
  GameSpaceParamDto,
  GameStandingsResponseDto,
} from 'src/dtos/game.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated, FileResponse } from 'src/middleware/auth.guard';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { GameService } from 'src/services/game.service';
import { sendFile } from 'src/utils/file';
// Challenge ids are v7 uuids (game_challenge.id is @PrimaryGeneratedUuidV7Column), so these routes
// take UUIDv7ParamDto - UUIDParamDto validates v4 and would reject every real id with a 400.
import { UUIDv7ParamDto } from 'src/validation';

@ApiTags(ApiTag.Games)
@Controller()
export class GameController {
  constructor(
    private service: GameService,
    private logger: LoggingRepository,
  ) {
    this.logger.setContext(GameController.name);
  }

  @Post('shared-spaces/:spaceId/games')
  @Authenticated({ permission: Permission.GameCreate })
  @Endpoint({
    summary: 'Create a photo guessing challenge',
    description: "Generate and freeze a new challenge from a shared space's own photos.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  createChallenge(
    @Auth() auth: AuthDto,
    @Param() { spaceId }: GameSpaceParamDto,
    @Body() dto: GameCreateDto,
  ): Promise<GameChallengeResponseDto> {
    return this.service.create(auth, spaceId, dto);
  }

  @Get('shared-spaces/:spaceId/games')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: 'List photo guessing challenges',
    description: "List a shared space's challenges along with the caller's progress on each.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getChallenges(
    @Auth() auth: AuthDto,
    @Param() { spaceId }: GameSpaceParamDto,
  ): Promise<GameChallengeListItemResponseDto[]> {
    return this.service.list(auth, spaceId);
  }

  @Get('shared-spaces/:spaceId/games/daily')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: "Get the space's daily challenge",
    description:
      "Get today's daily challenge for a shared space, generating it on first read. Returns a null challenge when the space has no photos usable for one.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getDailyChallenge(@Auth() auth: AuthDto, @Param() { spaceId }: GameSpaceParamDto): Promise<GameDailyResponseDto> {
    return this.service.getDaily(auth, spaceId);
  }

  @Get('shared-spaces/:spaceId/games/standings')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: "Get the space's monthly standings",
    description:
      "Per-player totals across this UTC calendar month's daily challenges. Custom challenges never contribute. Membership-gated, like the daily.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getStandings(@Auth() auth: AuthDto, @Param() { spaceId }: GameSpaceParamDto): Promise<GameStandingsResponseDto> {
    return this.service.standings(auth, spaceId);
  }

  @Get('games/:id')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: 'Get a photo guessing challenge',
    description: 'Get challenge detail. Round answers are withheld until the caller has guessed that round.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getChallenge(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<GameChallengeDetailResponseDto> {
    return this.service.get(auth, id);
  }

  @Post('games/:id/rounds/:index/guess')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: 'Submit a round guess',
    description: 'Submit a guess for one round of a challenge and receive the score and the answer.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  guessRound(
    @Auth() auth: AuthDto,
    @Param() { id, index }: GameRoundParamDto,
    @Body() dto: GameGuessDto,
  ): Promise<GameGuessResponseDto> {
    return this.service.guess(auth, id, index, dto);
  }

  @Get('games/:id/rounds/:index/image')
  @FileResponse()
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: 'Get a round image',
    description:
      "Serve a round's photo as a generic, EXIF-free preview keyed by (challenge, round index). Never discloses the underlying asset id or original filename.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  async getRoundImage(
    @Auth() auth: AuthDto,
    @Param() { id, index }: GameRoundParamDto,
    @Res() res: Response,
    @Next() next: NextFunction,
  ): Promise<void> {
    await sendFile(res, next, () => this.service.getRoundImage(auth, id, index), this.logger);
  }

  @Get('games/:id/leaderboard')
  @Authenticated({ permission: Permission.GameRead })
  @Endpoint({
    summary: 'Get a challenge leaderboard',
    description: 'Get per-player totals for a challenge.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getLeaderboard(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<GameLeaderboardResponseDto> {
    return this.service.leaderboard(auth, id);
  }

  @Delete('games/:id')
  @Authenticated({ permission: Permission.GameDelete })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a photo guessing challenge',
    description: 'Permanently delete a challenge, cascading its rounds and guesses.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteChallenge(@Auth() auth: AuthDto, @Param() { id }: UUIDv7ParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }
}
