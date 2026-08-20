import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate, latitudeSchema, longitudeSchema } from 'src/validation';
import z from 'zod';

// 'location' | 'date' - mirrors GameRoundType in src/schema/tables/game-round.table.ts, which is a
// plain string union rather than a real enum, so there is nothing to import here.
const GameRoundTypeSchema = z.enum(['location', 'date']).meta({ id: 'GameRoundType' });

// Which kinds of round to build. 'mixed' is the historical behaviour; the other two are an explicit
// request that must be met exactly or refused, never quietly filled with the other kind.
const GameChallengeTypeSchema = z.enum(['mixed', 'location', 'date']).meta({ id: 'GameChallengeType' });
export type GameChallengeType = z.infer<typeof GameChallengeTypeSchema>;

const GameCreateSchema = z
  .object({
    // No .min(1): GameService.create() falls back to a generated name ("Challenge N") when this
    // trims to empty, so rejecting an empty string here would take that fallback away from callers.
    name: z.string().trim().max(100).optional().describe('Challenge name'),
    roundCount: z.int().min(1).max(20).default(5).optional().describe('Number of rounds to generate'),
    type: GameChallengeTypeSchema.default('mixed').optional().describe('Which kinds of round to generate'),
  })
  .meta({ id: 'GameCreateDto' });

// Which libraries beyond the player's own to draw this one game from. Both are optional and
// independent: an omitted toggle keeps the player's stored default rather than being read as
// "off", so overriding one source in the create panel cannot silently switch the other off.
const GameSoloSourcesSchema = z
  .object({
    includePartners: z.boolean().optional().describe("Also draw from partners' photos"),
    includeSpaces: z.boolean().optional().describe('Also draw from shared-space photos'),
  })
  .meta({ id: 'GameSoloSourcesDto' });

// No `name`: a solo challenge is nobody else's to read, so there is nothing to label it for.
// GameService.createSolo generates "Challenge N" for the history list.
const GameSoloCreateSchema = z
  .object({
    roundCount: z.int().min(1).max(20).default(5).optional().describe('Number of rounds to generate'),
    type: GameChallengeTypeSchema.default('mixed').optional().describe('Which kinds of round to generate'),
    // Per-game, and frozen onto the challenge: the stored preference decides what a new game
    // starts from, this decides what THIS game is, and neither can change once it is generated.
    sources: GameSoloSourcesSchema.optional().describe('Override the stored source toggles for this game'),
  })
  .meta({ id: 'GameSoloCreateDto' });

// shared_space.id is a v4 uuid (@PrimaryGeneratedColumn), so this stays uuidv4 - unlike the
// challenge `id` below.
const GameSpaceParamSchema = z.object({
  spaceId: z.uuidv4(),
});

const GameRoundParamSchema = z.object({
  // A challenge id is a v7 uuid - game_challenge.id is @PrimaryGeneratedUuidV7Column (DEFAULT
  // immich_uuid_v7()), so validating it as v4 rejects every real id with a 400 "Invalid UUID".
  id: z.uuidv7(),
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
    // Nullable because a challenge has exactly one scope: a space OR an owner, never both.
    // Response DTOs are not validated on output, so leaving this non-nullable would not fail on
    // the server - it would emit null against a schema promising a string, and break the
    // GENERATED clients instead. The Dart model would throw at deserialisation.
    spaceId: z.string().nullable().describe('Shared space ID, or null for a solo challenge'),
    ownerId: z.string().nullable().describe('Owning user ID, or null for a shared-space challenge'),
    name: z.string().describe('Challenge name'),
    roundCount: z.number().describe('Number of rounds actually generated (may be less than requested)'),
    scaleKm: z.number().describe('Frozen distance scale used to score location rounds'),
    scaleDays: z.number().describe('Frozen day scale used to score date rounds'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    // A plain YYYY-MM-DD string, not a datetime: the daily is keyed to a UTC CALENDAR day, and
    // parsing it into a Date would reintroduce the timezone question the date column exists to
    // settle.
    dailyOn: z
      .string()
      .meta({ format: 'date' })
      .nullable()
      .describe("The UTC date this is the space's daily challenge for, or null for a player-created one"),
  })
  .meta({ id: 'GameChallengeResponseDto' });

const GameChallengeListItemResponseSchema = GameChallengeResponseSchema.extend({
  closedAt: isoDatetimeToDate.nullable().describe('When this challenge was closed, if at all'),
  answered: z.number().describe('Number of rounds the caller has answered'),
  total: z.number().describe("The caller's total score across answered rounds"),
  // The count of rounds that ARE location rounds, so the client can label the challenge from what
  // it actually contains. Deliberately not a stored "requested type", which would keep claiming
  // 'location' for a challenge the generator could only partly fill.
  locationRoundCount: z.number().describe('How many of the rounds are location rounds'),
}).meta({ id: 'GameChallengeListItemResponseDto' });

// A wrapper rather than a bare nullable challenge: a space with no usable photos has no daily, and
// that is an ordinary state of the page, not an error. Returning 404 would make the client treat a
// normal empty space as a failure.
const GameDailyResponseSchema = z
  .object({
    challenge: GameChallengeListItemResponseSchema.nullable().describe("Today's daily, if one could be generated"),
  })
  .meta({ id: 'GameDailyResponseDto' });

// The withheld shape for a round the caller has not guessed yet carries only index/type - no
// assetId, coordinates, date or filename. GameService.toRoundDetail() is the only place allowed to
// populate assetId/score/answer/guess, and only once a guess exists for the caller.
const GameRoundAnswerSchema = z.object({
  lat: z.number().nullable().describe('Answer latitude, for a location round'),
  lon: z.number().nullable().describe('Answer longitude, for a location round'),
  date: isoDatetimeToDate.nullable().describe('Answer date, for a date round'),
});

const GameRoundGuessSchema = z.object({
  lat: z.number().nullable().describe('Guessed latitude, for a location round'),
  lon: z.number().nullable().describe('Guessed longitude, for a location round'),
  date: isoDatetimeToDate.nullable().describe('Guessed date, for a date round'),
  distanceKm: z.number().nullable().describe('Distance from the answer, in km'),
  offsetDays: z.number().nullable().describe('Day offset from the answer'),
});

const GameRoundDetailResponseSchema = z
  .object({
    index: z.number().describe('Round index (0-based)'),
    type: GameRoundTypeSchema.describe('Round type'),
    assetId: z.string().optional().describe('Round photo asset ID - present only once the caller has guessed'),
    score: z.number().optional().describe("The caller's score for this round - present only once guessed"),
    answer: GameRoundAnswerSchema.optional().describe('The round answer - present only once guessed'),
    guess: GameRoundGuessSchema.optional().describe("The caller's own guess - present only once guessed"),
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

const GameStandingsEntrySchema = z.object({
  userId: z.string().describe('User ID'),
  name: z.string().describe('User name'),
  total: z.number().describe("Total score across the month's daily challenges"),
  daysPlayed: z.number().describe('Number of daily challenges played this month'),
});

// No `average` field: it is total / daysPlayed, and carrying a derived value alongside its own
// inputs only creates a way for the two to disagree. The client divides.
const GameStandingsResponseSchema = z
  .object({
    month: z
      .string()
      .describe('The UTC calendar month these standings cover, as YYYY-MM. The client formats the name.'),
    entries: z.array(GameStandingsEntrySchema).describe('Per-player totals, best first, non-players last'),
  })
  .meta({ id: 'GameStandingsResponseDto' });

// Solo play's answer to the leaderboard: the player's own record, since there is nobody to rank
// them against. Every field is a number and none of them is nullable - a player who has never
// played gets zeroes, so the panel renders the same shape on day one as on day one hundred and has
// no "no data yet" branch to get wrong. All five are COMPUTED from the games on every read, never
// stored, so they cannot drift from the guesses they are derived from.
const GameSoloStatsResponseSchema = z
  .object({
    currentStreak: z.number().describe('Consecutive UTC days of fully played dailies, ending today or yesterday'),
    bestStreak: z.number().describe('The longest such run ever'),
    bestScore: z.number().describe('The highest total scored in a single game'),
    averageScore: z.number().describe('Mean total across games played, rounded to whole points'),
    gamesPlayed: z.number().describe('How many games have at least one guess'),
  })
  .meta({ id: 'GameSoloStatsResponseDto' });

const GameSoloHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).describe('Page number'),
    size: z.coerce.number().int().min(1).max(100).default(20).describe('Number of games per page'),
  })
  .meta({ id: 'GameSoloHistoryQueryDto' });

// A history row, not a challenge: no `spaceId`/`ownerId` (every row here is the caller's own solo
// game) and no scale fields, which mean something to the scorer and nothing to a list.
const GameSoloHistoryItemResponseSchema = z
  .object({
    id: z.string().describe('Challenge ID'),
    name: z.string().describe('Challenge name'),
    // A plain YYYY-MM-DD string, for the same reason GameChallengeResponseDto's is: the daily is
    // keyed to a UTC calendar day, and parsing it into a Date reintroduces the timezone question
    // the date column exists to settle.
    dailyOn: z
      .string()
      .meta({ format: 'date' })
      .nullable()
      .describe('The UTC date this was the daily for, or null for a free-play game'),
    createdAt: isoDatetimeToDate.describe('Creation date'),
    roundCount: z.number().describe('Number of rounds in the challenge'),
    answered: z.number().describe('Number of rounds the player answered'),
    total: z.number().describe('Total score across the rounds they answered'),
  })
  .meta({ id: 'GameSoloHistoryItemResponseDto' });

// `hasNextPage` rather than a total count: the client only needs to know whether to offer another
// page, and a count would cost a second aggregate over every game the player has ever played.
// Paging past the end is an empty page, not an error - it is what a client that keeps a stale page
// number does, and there is nothing wrong with the request.
const GameSoloHistoryResponseSchema = z
  .object({
    items: z.array(GameSoloHistoryItemResponseSchema).describe('Games played, newest first'),
    hasNextPage: z.boolean().describe('Whether another page follows this one'),
  })
  .meta({ id: 'GameSoloHistoryResponseDto' });

export class GameCreateDto extends createZodDto(GameCreateSchema) {}
export class GameSoloCreateDto extends createZodDto(GameSoloCreateSchema) {}
export class GameSpaceParamDto extends createZodDto(GameSpaceParamSchema) {}
export class GameRoundParamDto extends createZodDto(GameRoundParamSchema) {}
export class GameGuessDto extends createZodDto(GameGuessSchema) {}
export class GameChallengeResponseDto extends createZodDto(GameChallengeResponseSchema) {}
export class GameChallengeListItemResponseDto extends createZodDto(GameChallengeListItemResponseSchema) {}
export class GameDailyResponseDto extends createZodDto(GameDailyResponseSchema) {}
export class GameRoundDetailResponseDto extends createZodDto(GameRoundDetailResponseSchema) {}
export class GameChallengeDetailResponseDto extends createZodDto(GameChallengeDetailResponseSchema) {}
export class GameGuessResponseDto extends createZodDto(GameGuessResponseSchema) {}
export class GameLeaderboardResponseDto extends createZodDto(GameLeaderboardResponseSchema) {}
export class GameStandingsResponseDto extends createZodDto(GameStandingsResponseSchema) {}
export class GameSoloStatsResponseDto extends createZodDto(GameSoloStatsResponseSchema) {}
export class GameSoloHistoryQueryDto extends createZodDto(GameSoloHistoryQuerySchema) {}
export class GameSoloHistoryItemResponseDto extends createZodDto(GameSoloHistoryItemResponseSchema) {}
export class GameSoloHistoryResponseDto extends createZodDto(GameSoloHistoryResponseSchema) {}
