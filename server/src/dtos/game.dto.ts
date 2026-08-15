import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate, latitudeSchema, longitudeSchema } from 'src/validation';
import z from 'zod';

// 'location' | 'date' - mirrors GameRoundType in src/schema/tables/game-round.table.ts, which is a
// plain string union rather than a real enum, so there is nothing to import here.
const GameRoundTypeSchema = z.enum(['location', 'date']).meta({ id: 'GameRoundType' });

const GameCreateSchema = z
  .object({
    // No .min(1): GameService.create() falls back to a generated name ("Challenge N") when this
    // trims to empty, so rejecting an empty string here would take that fallback away from callers.
    name: z.string().trim().max(100).optional().describe('Challenge name'),
    roundCount: z.int().min(1).max(20).default(5).optional().describe('Number of rounds to generate'),
  })
  .meta({ id: 'GameCreateDto' });

const GameSpaceParamSchema = z.object({
  spaceId: z.uuidv4(),
});

const GameRoundParamSchema = z.object({
  id: z.uuidv4(),
  index: z.coerce.number().int().min(0),
});

// Both fields are individually optional here; GameService.guess() decides which ones are required
// for a given round's type ('location' needs lat+lon, 'date' needs date) and 400s if the wrong
// shape is submitted for the round. latitudeSchema/longitudeSchema reject an out-of-range guess
// (e.g. lat: 999) and isoDatetimeToDate rejects an unparseable date string - both previously reached
// GameService unvalidated (see task 9 carry-forward notes).
const GameGuessSchema = z
  .object({
    lat: latitudeSchema.optional().describe('Guessed latitude, for a location round'),
    lon: longitudeSchema.optional().describe('Guessed longitude, for a location round'),
    date: isoDatetimeToDate.optional().describe('Guessed date, for a date round'),
  })
  .meta({ id: 'GameGuessDto' });

const GameChallengeResponseSchema = z
  .object({
    id: z.string().describe('Challenge ID'),
    spaceId: z.string().describe('Shared space ID'),
    name: z.string().describe('Challenge name'),
    roundCount: z.number().describe('Number of rounds actually generated (may be less than requested)'),
    scaleKm: z.number().describe('Frozen distance scale used to score location rounds'),
    scaleDays: z.number().describe('Frozen day scale used to score date rounds'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
  })
  .meta({ id: 'GameChallengeResponseDto' });

const GameChallengeListItemResponseSchema = GameChallengeResponseSchema.extend({
  closedAt: isoDatetimeToDate.nullable().describe('When this challenge was closed, if at all'),
  answered: z.number().describe('Number of rounds the caller has answered'),
  total: z.number().describe("The caller's total score across answered rounds"),
}).meta({ id: 'GameChallengeListItemResponseDto' });

// The withheld shape for a round the caller has not guessed yet carries only index/type - no
// assetId, coordinates, date or filename. GameService.toRoundDetail() is the only place allowed to
// populate assetId/score/answer, and only once a guess exists for the caller.
const GameRoundAnswerSchema = z.object({
  lat: z.number().nullable().describe('Answer latitude, for a location round'),
  lon: z.number().nullable().describe('Answer longitude, for a location round'),
  date: isoDatetimeToDate.nullable().describe('Answer date, for a date round'),
});

const GameRoundDetailResponseSchema = z
  .object({
    index: z.number().describe('Round index (0-based)'),
    type: GameRoundTypeSchema.describe('Round type'),
    assetId: z.string().optional().describe('Round photo asset ID - present only once the caller has guessed'),
    score: z.number().optional().describe("The caller's score for this round - present only once guessed"),
    answer: GameRoundAnswerSchema.optional().describe('The round answer - present only once guessed'),
  })
  .meta({ id: 'GameRoundDetailResponseDto' });

const GameChallengeDetailResponseSchema = GameChallengeResponseSchema.extend({
  closedAt: isoDatetimeToDate.nullable().describe('When this challenge was closed, if at all'),
  rounds: z.array(GameRoundDetailResponseSchema).describe('Rounds, with answers withheld until guessed'),
}).meta({ id: 'GameChallengeDetailResponseDto' });

const GameGuessResponseSchema = z
  .object({
    roundId: z.string().describe('Round ID'),
    userId: z.string().describe('User ID'),
    guessLat: z.number().nullable().describe('Guessed latitude'),
    guessLon: z.number().nullable().describe('Guessed longitude'),
    guessDate: isoDatetimeToDate.nullable().describe('Guessed date'),
    distanceKm: z.number().nullable().describe('Distance between the guess and the answer, in km'),
    offsetDays: z.number().nullable().describe('Day offset between the guess and the answer'),
    score: z.number().describe('Score awarded for this guess'),
  })
  .meta({ id: 'GameGuessResponseDto' });

const GameLeaderboardEntrySchema = z.object({
  userId: z.string().describe('User ID'),
  name: z.string().describe('User name'),
  total: z.number().describe('Total score across all guessed rounds'),
  answered: z.number().describe('Number of rounds answered'),
});

const GameLeaderboardResponseSchema = z
  .object({
    entries: z.array(GameLeaderboardEntrySchema).describe('Per-player totals, highest first'),
  })
  .meta({ id: 'GameLeaderboardResponseDto' });

export class GameCreateDto extends createZodDto(GameCreateSchema) {}
export class GameSpaceParamDto extends createZodDto(GameSpaceParamSchema) {}
export class GameRoundParamDto extends createZodDto(GameRoundParamSchema) {}
export class GameGuessDto extends createZodDto(GameGuessSchema) {}
export class GameChallengeResponseDto extends createZodDto(GameChallengeResponseSchema) {}
export class GameChallengeListItemResponseDto extends createZodDto(GameChallengeListItemResponseSchema) {}
export class GameRoundDetailResponseDto extends createZodDto(GameRoundDetailResponseSchema) {}
export class GameChallengeDetailResponseDto extends createZodDto(GameChallengeDetailResponseSchema) {}
export class GameGuessResponseDto extends createZodDto(GameGuessResponseSchema) {}
export class GameLeaderboardResponseDto extends createZodDto(GameLeaderboardResponseSchema) {}
