import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AuthDto } from 'src/dtos/auth.dto';
import {
  GameChallengeDetailResponseDto,
  GameChallengeListItemResponseDto,
  GameChallengeResponseDto,
  GameCreateDto,
  GameGuessDto,
  GameGuessResponseDto,
  GameLeaderboardResponseDto,
  GameRoundParamDto,
  GameSpaceParamDto,
} from 'src/dtos/game.dto';
import { ApiTag, Permission } from 'src/enum';
import { Auth, Authenticated } from 'src/middleware/auth.guard';
import { GameService } from 'src/services/game.service';
import { UUIDParamDto } from 'src/validation';

@ApiTags(ApiTag.Games)
@Controller()
export class GameController {
  constructor(private service: GameService) {}

  @Post('shared-spaces/:spaceId/games')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
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
  @Authenticated({ permission: Permission.SharedSpaceRead })
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

  @Get('games/:id')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @Endpoint({
    summary: 'Get a photo guessing challenge',
    description: 'Get challenge detail. Round answers are withheld until the caller has guessed that round.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getChallenge(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<GameChallengeDetailResponseDto> {
    return this.service.get(auth, id);
  }

  @Post('games/:id/rounds/:index/guess')
  @Authenticated({ permission: Permission.SharedSpaceRead })
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

  @Get('games/:id/leaderboard')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @Endpoint({
    summary: 'Get a challenge leaderboard',
    description: 'Get per-player totals for a challenge.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getLeaderboard(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<GameLeaderboardResponseDto> {
    return this.service.leaderboard(auth, id);
  }

  @Delete('games/:id')
  @Authenticated({ permission: Permission.SharedSpaceUpdate })
  @HttpCode(HttpStatus.NO_CONTENT)
  @Endpoint({
    summary: 'Delete a photo guessing challenge',
    description: 'Permanently delete a challenge, cascading its rounds and guesses.',
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  deleteChallenge(@Auth() auth: AuthDto, @Param() { id }: UUIDParamDto): Promise<void> {
    return this.service.delete(auth, id);
  }
}
