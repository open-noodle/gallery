# Games Standings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a shared space's games page a Standings section with two boards — today's daily challenge, and total points across this calendar month's dailies — so players can see each other's scores after they have played.

**Architecture:** One new membership-gated endpoint, `GET /shared-spaces/:spaceId/games/standings`, aggregates guess scores over the space's dailies within the current UTC calendar month. Both it and the existing per-challenge leaderboard are zero-filled from the space's member list and ordered by one shared comparator, so every member appears on both boards. The web games page renders both through a single generalised table component behind a two-tab shell. No migration: every column and index already exists.

**Tech Stack:** NestJS 11 + Kysely + Postgres (server), Vitest + testcontainers (server tests), SvelteKit + Svelte 5 runes + Tailwind 4 (web), Vitest + @testing-library/svelte (web tests), Playwright/supertest (e2e).

**Spec:** `docs/superpowers/specs/2026-08-16-games-standings-design.md`

## Global Constraints

- **Worktree.** All work happens in `/Users/pierre/dev/gallery/.claude/worktrees/photo-guessing-game`. Never `cd` to the main checkout.
- **i18n.** Any commit that adds or edits a user-facing string updates **all ten** maintained locales: `en de fr it nl pl es ru zh_Hans zh_Hant`. Keys are alphabetically sorted, 2-space indent, unescaped Unicode. Run `npx prettier --write i18n/*.json` afterwards — CI checks it.
- **Server imports.** No relative imports; use the `src/` path alias.
- **Formatting.** Prettier, 120 char width, single quotes, trailing commas, semicolons.
- **`make sql` / `mise sql` deletes every generated query file when no database is running.** Run it only against a live stack.
- **Single test file:** `pnpm test -- --run <path>` from `server/` or `web/`. The `--` is required; without it vitest silently ignores the path and runs everything.
- **Commits.** Conventional style, lowercase subject. Never add `Co-Authored-By` or `Generated with` trailers.
- **Every test must be seen to fail first.** A test that passes before the implementation exists is not a test.

---

### Task 1: The shared ordering comparator

Both boards sort the same way, and the rule has one non-obvious step. Isolating it as a pure function makes it testable without mocks and keeps the two services honest.

**Files:**

- Create: `server/src/utils/game-standings.ts`
- Test: `server/src/utils/game-standings.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: `export type StandingsSortable = { name: string; total: number; played: number }` and `export const compareStandings: (a: StandingsSortable, b: StandingsSortable) => number`. Tasks 3 and 4 pass their entries through `Array.prototype.sort(compareStandings)`.

- [ ] **Step 1: Write the failing test**

Create `server/src/utils/game-standings.spec.ts`:

```ts
import { compareStandings, StandingsSortable } from 'src/utils/game-standings';

const entry = (name: string, total: number, played: number): StandingsSortable => ({ name, total, played });

describe('compareStandings', () => {
  it('orders by total, highest first', () => {
    const rows = [entry('Ana', 4200, 5), entry('Ben', 9100, 5), entry('Cara', 700, 5)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana', 'Cara']);
  });

  it('breaks a tie on total by fewer rounds played, which is the better performance', () => {
    const rows = [entry('Ana', 4200, 5), entry('Ben', 4200, 3)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana']);
  });

  it('breaks a full tie by name, so the order is stable across requests', () => {
    const rows = [entry('Cara', 4200, 5), entry('Ana', 4200, 5), entry('Ben', 4200, 5)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ana', 'Ben', 'Cara']);
  });

  it('ranks a member who played and scored nothing ABOVE a member who never played', () => {
    // The case the explicit never-played step exists for: scoreFromError floors at 0, so a real
    // player can hold total 0. Without step 1 the `played` ascending tie-break below would put
    // played:0 first and rank the no-show above the person who turned up.
    const rows = [entry('Ana', 0, 0), entry('Ben', 0, 1)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana']);
  });

  it('keeps every member who never played at the bottom, whatever their name', () => {
    const rows = [entry('Zoe', 0, 0), entry('Ana', 0, 0), entry('Ben', 120, 1)];

    expect(rows.sort(compareStandings).map((row) => row.name)).toEqual(['Ben', 'Ana', 'Zoe']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && pnpm test -- --run src/utils/game-standings.spec.ts
```

Expected: FAIL — `Cannot find module 'src/utils/game-standings'`.

- [ ] **Step 3: Write the implementation**

Create `server/src/utils/game-standings.ts`:

```ts
/**
 * The two shapes a standings row can take, reduced to what the ordering needs.
 *
 * `played` is whichever count means "this person turned up": rounds answered on today's challenge
 * board, dailies played on the monthly one.
 */
export type StandingsSortable = {
  name: string;
  total: number;
  played: number;
};

/**
 * Ordering shared by both boards.
 *
 * The never-played step is NOT redundant with the total comparison that follows it. A guess can
 * legitimately score 0 - `scoreFromError` floors there - so a member who played and scored nothing
 * holds `total: 0, played: 1`, and the `played` ascending tie-break below would rank them BELOW a
 * member who never opened the game at all. Someone who showed up must never sit under someone who
 * did not.
 */
export const compareStandings = (a: StandingsSortable, b: StandingsSortable): number => {
  if ((a.played === 0) !== (b.played === 0)) {
    return a.played === 0 ? 1 : -1;
  }
  if (a.total !== b.total) {
    return b.total - a.total;
  }
  if (a.played !== b.played) {
    // The same points from fewer rounds is the better performance.
    return a.played - b.played;
  }
  return a.name.localeCompare(b.name);
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd server && pnpm test -- --run src/utils/game-standings.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/utils/game-standings.ts server/src/utils/game-standings.spec.ts
git commit -m "feat(game): add the shared standings ordering"
```

---

### Task 2: The monthly aggregate query

**Files:**

- Modify: `server/src/repositories/game.repository.ts` (add a method after `getLeaderboard`, around line 586)
- Modify: `server/src/repositories/game.repository.spec.ts:37` (add the new method to the surface list)
- Modify: `server/test/medium.factory.ts` (register `GameRepository` in the construction switch, around line 573)
- Create: `server/test/medium/specs/repositories/game.repository.spec.ts`
- Modify: `server/src/queries/game.repository.sql` (regenerated, not hand-edited)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `GameRepository.getMonthlyStandings(spaceId: string, monthStart: string, monthEndExclusive: string): Promise<{ userId: string; total: number; daysPlayed: number }[]>`, where both bounds are `YYYY-MM-DD` strings. Task 3 calls it.

**Note:** this task needs a running Postgres. The medium suite uses testcontainers (`pnpm test:medium`), and `mise sql` needs a live dev stack.

- [ ] **Step 1: Register `GameRepository` in the medium factory**

Without this, any medium spec listing it under `real:` dies with `Unable to create repository instance` — the failure points at the spec, not at the factory, which is why this comes first.

In `server/test/medium.factory.ts`, add the import alongside the other repository imports:

```ts
import { GameRepository } from 'src/repositories/game.repository';
```

and add a case to the group that constructs with just the database (the block ending `return new key(db);`, around line 582), keeping alphabetical order:

```ts
    case FacePersonVerdictRepository:
    case GameRepository:
    case IntegrityRepository:
```

- [ ] **Step 2: Write the failing medium test**

Create `server/test/medium/specs/repositories/game.repository.spec.ts`:

```ts
import { Kysely } from 'kysely';
import { AssetRepository } from 'src/repositories/asset.repository';
import { GameRepository } from 'src/repositories/game.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { DB } from 'src/schema';
import { BaseService } from 'src/services/base.service';
import { newMediumService } from 'test/medium.factory';
import { getKyselyDB } from 'test/utils';

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [GameRepository, AssetRepository, UserRepository],
    mock: [LoggingRepository],
  });
  return { ctx, gameRepo: ctx.get(GameRepository) };
};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

describe('GameRepository.getMonthlyStandings', () => {
  /**
   * One challenge with `roundCount` date rounds. `dailyOn` null makes it a player-created
   * challenge, which the aggregate must ignore entirely.
   */
  const newChallenge = async (
    ctx: ReturnType<typeof setup>['ctx'],
    gameRepo: GameRepository,
    options: { spaceId: string; ownerId: string; dailyOn: string | null; roundCount: number },
  ) => {
    const rounds = [];
    for (let index = 0; index < options.roundCount; index++) {
      const { asset } = await ctx.newAsset({ ownerId: options.ownerId });
      rounds.push({
        challengeId: '',
        index,
        type: 'date' as const,
        assetId: asset.id,
        answerLat: null,
        answerLon: null,
        answerDate: new Date('2020-06-15T00:00:00.000Z'),
      });
    }

    const challengeId = await gameRepo.createChallenge(
      {
        spaceId: options.spaceId,
        createdById: null,
        name: options.dailyOn ?? 'Custom',
        dailyOn: options.dailyOn,
        roundCount: options.roundCount,
        scaleKm: 100,
        scaleDays: 30,
      },
      rounds,
    );

    return { challengeId, roundIds: (await gameRepo.getRounds(challengeId)).map((round) => round.id) };
  };

  const guess = (gameRepo: GameRepository, roundId: string, userId: string, score: number) =>
    gameRepo.createGuess({
      roundId,
      userId,
      guessLat: null,
      guessLon: null,
      guessDate: new Date('2020-06-15T00:00:00.000Z'),
      distanceKm: null,
      offsetDays: 0,
      score,
    });

  it('sums a player’s scores across the month’s dailies and counts each daily once', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const first = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 3,
    });
    const second = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-06',
      roundCount: 1,
    });

    // Three rounds of one daily, one round of another: 4 guesses, but only 2 days played.
    await guess(gameRepo, first.roundIds[0], owner.id, 1000);
    await guess(gameRepo, first.roundIds[1], owner.id, 2000);
    await guess(gameRepo, first.roundIds[2], owner.id, 500);
    await guess(gameRepo, second.roundIds[0], owner.id, 400);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 3900, daysPlayed: 2 }]);
  });

  it('excludes player-created challenges, however many points they hold', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const daily = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });
    const custom = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: null,
      roundCount: 1,
    });

    await guess(gameRepo, daily.roundIds[0], owner.id, 100);
    await guess(gameRepo, custom.roundIds[0], owner.id, 5000);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 100, daysPlayed: 1 }]);
  });

  it('treats the month as half-open: the 1st is in, the last day of the previous month is out', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const july31 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-07-31',
      roundCount: 1,
    });
    const august1 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-01',
      roundCount: 1,
    });
    const september1 = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-09-01',
      roundCount: 1,
    });

    await guess(gameRepo, july31.roundIds[0], owner.id, 700);
    await guess(gameRepo, august1.roundIds[0], owner.id, 800);
    await guess(gameRepo, september1.roundIds[0], owner.id, 900);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 800, daysPlayed: 1 }]);
  });

  it('scopes to the space, so another space’s dailies never leak in', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });
    const { space: other } = await ctx.newSharedSpace({ createdById: owner.id });

    const mine = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });
    const theirs = await newChallenge(ctx, gameRepo, {
      spaceId: other.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 1,
    });

    await guess(gameRepo, mine.roundIds[0], owner.id, 300);
    await guess(gameRepo, theirs.roundIds[0], owner.id, 4000);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    expect(rows).toEqual([{ userId: owner.id, total: 300, daysPlayed: 1 }]);
  });

  it('returns one row per player who guessed, and none for a player who did not', async () => {
    const { ctx, gameRepo } = setup();
    const { result: owner } = await ctx.newUser();
    const { result: other } = await ctx.newUser();
    const { space } = await ctx.newSharedSpace({ createdById: owner.id });

    const daily = await newChallenge(ctx, gameRepo, {
      spaceId: space.id,
      ownerId: owner.id,
      dailyOn: '2026-08-05',
      roundCount: 2,
    });

    await guess(gameRepo, daily.roundIds[0], owner.id, 100);
    await guess(gameRepo, daily.roundIds[1], other.id, 250);

    const rows = await gameRepo.getMonthlyStandings(space.id, '2026-08-01', '2026-09-01');

    // No ordering is asserted: the repository deliberately does not sort - it has no names to
    // break ties with. Task 3's service does that.
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ userId: owner.id, total: 100, daysPlayed: 1 });
    expect(rows).toContainEqual({ userId: other.id, total: 250, daysPlayed: 1 });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/game.repository.spec.ts
```

Expected: FAIL — `gameRepo.getMonthlyStandings is not a function`.

If instead it fails with `Unable to create repository instance`, Step 1 was not applied.

- [ ] **Step 4: Write the implementation**

In `server/src/repositories/game.repository.ts`, insert after `getLeaderboard` (which ends at line 586) and before the `deleteChallenge` comment:

```ts
  /**
   * Per-player totals across a space's DAILY challenges within one month.
   *
   * The bounds are half-open - `[monthStart, monthEndExclusive)` - so no daily can be claimed by
   * two months and no `23:59:59` boundary has to be written down anywhere. Both are `YYYY-MM-DD`
   * and are cast to `date` for the same reason `getDailyChallenge` does it: the column reads back
   * as a Date while the caller holds a UTC calendar day as a string.
   *
   * `dailyOn IS NOT NULL` is what excludes player-created challenges. It is redundant against the
   * range comparisons (a NULL fails both) and kept anyway, because it is the line that states the
   * rule - a later edit that loosens the range must not silently start counting custom challenges.
   *
   * Deliberately unordered: ties are broken by player NAME, which lives in the member list this
   * repository knows nothing about. GameService sorts.
   */
  @GenerateSql({ params: [DummyValue.UUID, DummyValue.STRING, DummyValue.STRING] })
  async getMonthlyStandings(
    spaceId: string,
    monthStart: string,
    monthEndExclusive: string,
  ): Promise<{ userId: string; total: number; daysPlayed: number }[]> {
    const rows = await this.db
      .selectFrom('game_guess')
      .innerJoin('game_round', 'game_round.id', 'game_guess.roundId')
      .innerJoin('game_challenge', 'game_challenge.id', 'game_round.challengeId')
      .where('game_challenge.spaceId', '=', spaceId)
      .where('game_challenge.dailyOn', 'is not', null)
      .where('game_challenge.dailyOn', '>=', sql<Date>`${monthStart}::date`)
      .where('game_challenge.dailyOn', '<', sql<Date>`${monthEndExclusive}::date`)
      .groupBy('game_guess.userId')
      .select('game_guess.userId as userId')
      .select((eb) => eb.fn.sum<string>('game_guess.score').as('total'))
      .select((eb) => eb.fn.count<string>('game_round.challengeId').distinct().as('daysPlayed'))
      .execute();

    return rows.map((row) => ({
      userId: row.userId,
      total: Number(row.total),
      daysPlayed: Number(row.daysPlayed),
    }));
  }
```

`sql` is already imported in this file (used by `getDailyChallenge`); confirm rather than re-add it.

- [ ] **Step 5: Run the medium test to verify it passes**

```bash
cd server && pnpm test:medium -- --run test/medium/specs/repositories/game.repository.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Add the method to the repository surface guard**

In `server/src/repositories/game.repository.spec.ts`, add `'getMonthlyStandings',` to the array after `'getLeaderboard',` (line 37).

```bash
cd server && pnpm test -- --run src/repositories/game.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Regenerate the SQL query file**

Requires a running dev database — `mise sql` **deletes every query file** if there is none.

```bash
mise dev            # in another terminal, if the stack is not already up
mise sql
git diff --stat server/src/queries/game.repository.sql
```

Expected: a `-- GameRepository.getMonthlyStandings` block added, nothing else removed. If the diff deletes other blocks, the database was not reachable — restore with `git checkout server/src/queries/` and retry.

- [ ] **Step 8: Commit**

```bash
git add server/src/repositories/game.repository.ts server/src/repositories/game.repository.spec.ts \
        server/test/medium.factory.ts server/test/medium/specs/repositories/game.repository.spec.ts \
        server/src/queries/game.repository.sql
git commit -m "feat(game): aggregate a space's daily scores over a month"
```

---

### Task 3: The standings endpoint

**Files:**

- Modify: `server/src/dtos/game.dto.ts` (add schemas after `GameLeaderboardResponseSchema`, around line 137, and the exported class at the end)
- Modify: `server/src/services/game.service.ts` (add `utcMonthBounds` near `utcDateKey` at line ~101, and `standings()` after `leaderboard()` at line ~689)
- Modify: `server/src/controllers/game.controller.ts` (add a route after `getDailyChallenge`, line 76)
- Test: `server/src/services/game.service.spec.ts` (new `describe('standings')` block)

**Interfaces:**

- Consumes: `compareStandings` (Task 1), `GameRepository.getMonthlyStandings` (Task 2).
- Produces: `GET /shared-spaces/:spaceId/games/standings` returning `GameStandingsResponseDto { month: string; entries: Array<{ userId: string; name: string; total: number; daysPlayed: number }> }`. Task 5 turns this into the SDK function `getStandings({ spaceId })`; Tasks 9-10 consume it.

- [ ] **Step 1: Write the failing service test**

Append to `server/src/services/game.service.spec.ts`, inside the top-level `describe(GameService.name, ...)` block (after the `daily challenge` describe):

```ts
describe('standings', () => {
  const members = [
    { userId: 'user-1', name: 'Ana' },
    { userId: 'user-2', name: 'Ben' },
    { userId: 'user-3', name: 'Cara' },
  ];

  it('rejects a caller who is not a member of the space', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue(void 0);
    await expect(sut.standings(authStub, 'space-1')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('zero-fills every member who has not played, and puts them last', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.sharedSpace.getMembers.mockResolvedValue(members as any);
    mocks.game.getMonthlyStandings.mockResolvedValue([{ userId: 'user-2', total: 4200, daysPlayed: 2 }]);

    const result = await sut.standings(authStub, 'space-1');

    expect(result.entries).toEqual([
      { userId: 'user-2', name: 'Ben', total: 4200, daysPlayed: 2 },
      { userId: 'user-1', name: 'Ana', total: 0, daysPlayed: 0 },
      { userId: 'user-3', name: 'Cara', total: 0, daysPlayed: 0 },
    ]);
  });

  it('ranks a member who played and scored nothing above a member who never played', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.sharedSpace.getMembers.mockResolvedValue([members[0], members[1]] as any);
    mocks.game.getMonthlyStandings.mockResolvedValue([{ userId: 'user-2', total: 0, daysPlayed: 1 }]);

    const result = await sut.standings(authStub, 'space-1');

    expect(result.entries.map((entry) => entry.name)).toEqual(['Ben', 'Ana']);
  });

  it('drops an aggregate row for someone who has left the space', async () => {
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.sharedSpace.getMembers.mockResolvedValue([members[0]] as any);
    mocks.game.getMonthlyStandings.mockResolvedValue([
      { userId: 'user-1', total: 100, daysPlayed: 1 },
      { userId: 'departed-user', total: 9000, daysPlayed: 9 },
    ]);

    const result = await sut.standings(authStub, 'space-1');

    expect(result.entries).toEqual([{ userId: 'user-1', name: 'Ana', total: 100, daysPlayed: 1 }]);
  });

  it('queries the current UTC calendar month as a half-open range and reports it', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T12:00:00.000Z'));
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.sharedSpace.getMembers.mockResolvedValue([]);
    mocks.game.getMonthlyStandings.mockResolvedValue([]);

    const result = await sut.standings(authStub, 'space-1');

    expect(mocks.game.getMonthlyStandings).toHaveBeenCalledWith('space-1', '2026-08-01', '2026-09-01');
    expect(result.month).toBe('2026-08');
    vi.useRealTimers();
  });

  it('rolls the exclusive bound into the next year in December', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-12-31T23:59:00.000Z'));
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
    mocks.sharedSpace.getMembers.mockResolvedValue([]);
    mocks.game.getMonthlyStandings.mockResolvedValue([]);

    await sut.standings(authStub, 'space-1');

    expect(mocks.game.getMonthlyStandings).toHaveBeenCalledWith('space-1', '2026-12-01', '2027-01-01');
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && pnpm test -- --run src/services/game.service.spec.ts -t standings
```

Expected: FAIL — `sut.standings is not a function`.

- [ ] **Step 3: Add the DTO**

In `server/src/dtos/game.dto.ts`, after `GameLeaderboardResponseSchema` (line ~137):

```ts
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
```

and with the other exported classes at the end of the file:

```ts
export class GameStandingsResponseDto extends createZodDto(GameStandingsResponseSchema) {}
```

- [ ] **Step 4: Add the month helper and the service method**

In `server/src/services/game.service.ts`, after `utcDateKey` (line ~101):

```ts
/**
 * The current UTC calendar month as `{ key: 'YYYY-MM', start: 'YYYY-MM-DD', endExclusive:
 * 'YYYY-MM-DD' }`.
 *
 * UTC for the same reason `utcDateKey` is: one space's members can sit in different timezones, and
 * a per-viewer month would give them different boards. `Date.UTC` with a month index of 12 rolls
 * into January of the next year on its own, so December needs no special case.
 */
const utcMonthBounds = (now: Date) => {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const asDay = (date: number) => new Date(date).toISOString().slice(0, 10);
  return {
    key: now.toISOString().slice(0, 7),
    start: asDay(Date.UTC(year, month, 1)),
    endExclusive: asDay(Date.UTC(year, month + 1, 1)),
  };
};
```

Add the imports at the top of the file:

```ts
import { GameStandingsResponseDto } from 'src/dtos/game.dto'; // add to the existing dtos import block
import { compareStandings } from 'src/utils/game-standings';
```

Then, after `leaderboard()` (which ends at line ~689):

```ts
  /**
   * The space's monthly standings: total points across THIS UTC calendar month's dailies.
   *
   * Dailies only, because they are the only level field - every member gets the identical
   * challenge, one attempt each - while custom challenges are created on demand by editors and
   * scored on a per-challenge frozen scale. See the design doc for the whole argument.
   *
   * Zero-filled from the member list so the board shows the space, not just the people who have
   * played, and so an aggregate row belonging to someone who has since left the space is dropped
   * rather than rendered under a placeholder name.
   */
  async standings(auth: AuthDto, spaceId: string): Promise<GameStandingsResponseDto> {
    await this.requireMember(spaceId, auth.user.id);

    const month = utcMonthBounds(new Date());
    const [rows, members] = await Promise.all([
      this.gameRepository.getMonthlyStandings(spaceId, month.start, month.endExclusive),
      this.sharedSpaceRepository.getMembers(spaceId),
    ]);

    const rowByUserId = new Map(rows.map((row) => [row.userId, row]));

    const entries = members
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        total: rowByUserId.get(member.userId)?.total ?? 0,
        daysPlayed: rowByUserId.get(member.userId)?.daysPlayed ?? 0,
      }))
      .sort((a, b) => compareStandings({ ...a, played: a.daysPlayed }, { ...b, played: b.daysPlayed }));

    return { month: month.key, entries };
  }
```

- [ ] **Step 5: Add the controller route**

In `server/src/controllers/game.controller.ts`, add `GameStandingsResponseDto` to the dto import block, then insert after `getDailyChallenge` (line 76):

```ts
  @Get('shared-spaces/:spaceId/games/standings')
  @Authenticated({ permission: Permission.SharedSpaceRead })
  @Endpoint({
    summary: "Get the space's monthly standings",
    description:
      "Per-player totals across this UTC calendar month's daily challenges. Custom challenges never contribute. Membership-gated, like the daily.",
    history: new HistoryBuilder().added('v1').beta('v1'),
  })
  getStandings(@Auth() auth: AuthDto, @Param() { spaceId }: GameSpaceParamDto): Promise<GameStandingsResponseDto> {
    return this.service.standings(auth, spaceId);
  }
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
cd server && pnpm test -- --run src/services/game.service.spec.ts
```

Expected: PASS, including the 6 new `standings` tests and every pre-existing one.

- [ ] **Step 7: Type-check**

```bash
cd server && pnpm check
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add server/src/dtos/game.dto.ts server/src/services/game.service.ts \
        server/src/services/game.service.spec.ts server/src/controllers/game.controller.ts
git commit -m "feat(game): add the monthly standings endpoint"
```

---

### Task 4: Zero-fill the per-challenge leaderboard

The existing board shows only players and labels a departed member with a hardcoded English `'Unknown'`. Both boards must show the same set of people, or `Kim —` appears on one tab and vanishes on the other.

**Files:**

- Modify: `server/src/services/game.service.ts:670-689` (`leaderboard`)
- Test: `server/src/services/game.service.spec.ts` (new `describe('leaderboard')` block)

**Interfaces:**

- Consumes: `compareStandings` (Task 1) — already imported by Task 3.
- Produces: no signature change. `GameLeaderboardResponseDto.entries` now contains one entry per current member, ordered by `compareStandings`, and never contains a non-member.

- [ ] **Step 1: Write the failing test**

Append to `server/src/services/game.service.spec.ts`, inside the top-level describe:

```ts
describe('leaderboard', () => {
  const challenge = {
    id: 'challenge-1',
    spaceId: 'space-1',
    roundCount: 5,
    dailyOn: null,
  };

  beforeEach(() => {
    mocks.game.getChallenge.mockResolvedValue(challenge as any);
    mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);
  });

  it('includes every member, zero-filling the ones who have not played, last', async () => {
    mocks.sharedSpace.getMembers.mockResolvedValue([
      { userId: 'user-1', name: 'Ana' },
      { userId: 'user-2', name: 'Ben' },
    ] as any);
    mocks.game.getLeaderboard.mockResolvedValue([{ userId: 'user-2', total: 4200, answered: 5 }]);

    const result = await sut.leaderboard(authStub, 'challenge-1');

    expect(result.entries).toEqual([
      { userId: 'user-2', name: 'Ben', total: 4200, answered: 5 },
      { userId: 'user-1', name: 'Ana', total: 0, answered: 0 },
    ]);
  });

  it('drops a departed member rather than naming them "Unknown"', async () => {
    mocks.sharedSpace.getMembers.mockResolvedValue([{ userId: 'user-1', name: 'Ana' }] as any);
    mocks.game.getLeaderboard.mockResolvedValue([
      { userId: 'user-1', total: 100, answered: 1 },
      { userId: 'departed-user', total: 4900, answered: 5 },
    ]);

    const result = await sut.leaderboard(authStub, 'challenge-1');

    expect(result.entries).toEqual([{ userId: 'user-1', name: 'Ana', total: 100, answered: 1 }]);
    expect(JSON.stringify(result)).not.toContain('Unknown');
  });

  it('breaks a tie on points in favour of the player who used fewer rounds', async () => {
    mocks.sharedSpace.getMembers.mockResolvedValue([
      { userId: 'user-1', name: 'Ana' },
      { userId: 'user-2', name: 'Ben' },
    ] as any);
    mocks.game.getLeaderboard.mockResolvedValue([
      { userId: 'user-1', total: 4200, answered: 5 },
      { userId: 'user-2', total: 4200, answered: 3 },
    ]);

    const result = await sut.leaderboard(authStub, 'challenge-1');

    expect(result.entries.map((entry) => entry.name)).toEqual(['Ben', 'Ana']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd server && pnpm test -- --run src/services/game.service.spec.ts -t leaderboard
```

Expected: FAIL — the first test returns one entry (only `user-2`), not two.

- [ ] **Step 3: Rewrite `leaderboard`**

Replace the body of `leaderboard` in `server/src/services/game.service.ts` (lines 670-689):

```ts
  /**
   * Today's-challenge board: one entry per CURRENT member, zero-filled.
   *
   * Members who have not played are included rather than omitted, so this board and the monthly
   * standings show the same people - a member who is absent from one tab and present on the other
   * reads as a bug. Rows belonging to someone who has left the space are dropped; they used to
   * render under a hardcoded English 'Unknown'.
   */
  async leaderboard(auth: AuthDto, challengeId: string): Promise<GameLeaderboardResponseDto> {
    const challenge = await this.loadChallenge(challengeId);
    await this.requireMember(challenge.spaceId, auth.user.id);

    const [rows, members] = await Promise.all([
      this.gameRepository.getLeaderboard(challengeId),
      this.sharedSpaceRepository.getMembers(challenge.spaceId),
    ]);

    const rowByUserId = new Map(rows.map((row) => [row.userId, row]));

    const entries = members
      .map((member) => ({
        userId: member.userId,
        name: member.name,
        total: rowByUserId.get(member.userId)?.total ?? 0,
        answered: rowByUserId.get(member.userId)?.answered ?? 0,
      }))
      .sort((a, b) => compareStandings({ ...a, played: a.answered }, { ...b, played: b.answered }));

    return { entries };
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd server && pnpm test -- --run src/services/game.service.spec.ts
```

Expected: PASS. If a pre-existing test asserted the old player-only shape, update it to the new one and say so in the commit body.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/game.service.ts server/src/services/game.service.spec.ts
git commit -m "fix(game): show every member on a challenge leaderboard"
```

---

### Task 5: Regenerate the OpenAPI spec and clients

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `packages/sdk/src/fetch-client.ts`
- Modify: `mobile/openapi/**` (generated Dart)

**Interfaces:**

- Consumes: the DTO and route from Task 3.
- Produces: `getStandings({ spaceId }): Promise<GameStandingsResponseDto>` and the `GameStandingsResponseDto` type, importable from `@immich/sdk`. Every web task depends on this.

- [ ] **Step 1: Build the server and sync the spec**

```bash
cd server && pnpm build && pnpm sync:open-api
```

- [ ] **Step 2: Regenerate both clients**

Run from the **worktree** root. Use the bare task name — `mise //:open-api` resolves against the main checkout, not this worktree.

```bash
mise open-api
```

The Dart generator needs Java on PATH. If it is missing, run `mise open-api-typescript` to unblock the web work and note the Dart client as outstanding — do not hand-edit `mobile/openapi/`.

- [ ] **Step 3: Verify the generated surface**

```bash
grep -n "export function getStandings" packages/sdk/src/fetch-client.ts
grep -n "GameStandingsResponseDto" packages/sdk/src/fetch-client.ts | head -3
git status --short | head -20
```

Expected: `getStandings` exists, the DTO type exists, and the changed files are all generated artifacts.

- [ ] **Step 4: Commit**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore(game): regenerate the API spec and clients"
```

---

### Task 6: The i18n keys

Five keys, ten locales, one commit — a locale left behind renders the raw key on that user's screen.

The section title reuses the existing `game_leaderboard` ("Leaderboard") rather than adding a "Standings" key. The design doc names the section `Standings`; shipping both words for one thing inside one feature is worse than the small deviation, and `game_leaderboard` is already translated in all ten locales.

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: the keys `game_standings_today`, `game_standings_month`, `game_days_played`, `game_average_points`, `game_not_played`. Tasks 8-10 use them.

- [ ] **Step 1: Add the keys to `en.json`**

Insert alphabetically among the existing `game_*` keys (`i18n/en.json:1904-1941`):

```json
  "game_average_points": "avg {score}",
  "game_days_played": "{count, plural, one {# day} other {# days}}",
  "game_not_played": "Not played",
  "game_standings_month": "This month",
  "game_standings_today": "Today",
```

- [ ] **Step 2: Add the same keys to the nine other locales**

Insert each block alphabetically into its own file. Register follows each file's existing convention.

`de.json`:

```json
  "game_average_points": "Ø {score}",
  "game_days_played": "{count, plural, one {# Tag} other {# Tage}}",
  "game_not_played": "Nicht gespielt",
  "game_standings_month": "Diesen Monat",
  "game_standings_today": "Heute",
```

`fr.json`:

```json
  "game_average_points": "moy. {score}",
  "game_days_played": "{count, plural, one {# jour} other {# jours}}",
  "game_not_played": "Non joué",
  "game_standings_month": "Ce mois-ci",
  "game_standings_today": "Aujourd'hui",
```

`it.json`:

```json
  "game_average_points": "media {score}",
  "game_days_played": "{count, plural, one {# giorno} other {# giorni}}",
  "game_not_played": "Non giocato",
  "game_standings_month": "Questo mese",
  "game_standings_today": "Oggi",
```

`nl.json`:

```json
  "game_average_points": "gem. {score}",
  "game_days_played": "{count, plural, one {# dag} other {# dagen}}",
  "game_not_played": "Niet gespeeld",
  "game_standings_month": "Deze maand",
  "game_standings_today": "Vandaag",
```

`pl.json`:

```json
  "game_average_points": "śr. {score}",
  "game_days_played": "{count, plural, one {# dzień} few {# dni} many {# dni} other {# dnia}}",
  "game_not_played": "Nie zagrano",
  "game_standings_month": "W tym miesiącu",
  "game_standings_today": "Dzisiaj",
```

`es.json`:

```json
  "game_average_points": "med. {score}",
  "game_days_played": "{count, plural, one {# día} other {# días}}",
  "game_not_played": "Sin jugar",
  "game_standings_month": "Este mes",
  "game_standings_today": "Hoy",
```

`ru.json`:

```json
  "game_average_points": "сред. {score}",
  "game_days_played": "{count, plural, one {# день} few {# дня} many {# дней} other {# дня}}",
  "game_not_played": "Не сыграно",
  "game_standings_month": "В этом месяце",
  "game_standings_today": "Сегодня",
```

`zh_Hans.json`:

```json
  "game_average_points": "平均 {score}",
  "game_days_played": "{count} 天",
  "game_not_played": "未参与",
  "game_standings_month": "本月",
  "game_standings_today": "今天",
```

`zh_Hant.json`:

```json
  "game_average_points": "平均 {score}",
  "game_days_played": "{count} 天",
  "game_not_played": "未參與",
  "game_standings_month": "本月",
  "game_standings_today": "今天",
```

- [ ] **Step 3: Format and verify all ten files carry all five keys**

```bash
npx prettier --write i18n/en.json i18n/de.json i18n/fr.json i18n/it.json i18n/nl.json \
                     i18n/pl.json i18n/es.json i18n/ru.json i18n/zh_Hans.json i18n/zh_Hant.json
for f in en de fr it nl pl es ru zh_Hans zh_Hant; do
  printf '%s: %s\n' "$f" "$(grep -c 'game_average_points\|game_days_played\|game_not_played\|game_standings_month\|game_standings_today' i18n/$f.json)"
done
```

Expected: every locale prints `5`.

- [ ] **Step 4: Commit**

```bash
git add i18n
git commit -m "feat(i18n): add the games standings strings"
```

---

### Task 7: Web formatting helpers

Two pure functions the components need, kept out of Svelte so they can be tested directly.

**Files:**

- Modify: `web/src/lib/utils/game.ts` (append)
- Test: `web/src/lib/utils/game.spec.ts` (append)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `competitionRanks(totals: number[]): number[]` — `[9100, 4200, 4200, 100]` → `[1, 2, 2, 4]`.
  - `formatStandingsMonth(month: string, locale?: string): string` — `'2026-08'` → `'August 2026'`.

  Tasks 8 and 9 use both.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/utils/game.spec.ts`:

```ts
describe('competitionRanks', () => {
  it('numbers a strictly descending board 1, 2, 3', () => {
    expect(competitionRanks([9100, 4200, 100])).toEqual([1, 2, 3]);
  });

  it('gives tied totals the same rank and skips the one after, like a race result', () => {
    expect(competitionRanks([9100, 4200, 4200, 100])).toEqual([1, 2, 2, 4]);
  });

  it('ties on the leading position too', () => {
    expect(competitionRanks([4200, 4200, 100])).toEqual([1, 1, 3]);
  });

  it('ties every member of an untouched board at rank 1', () => {
    expect(competitionRanks([0, 0, 0])).toEqual([1, 1, 1]);
  });

  it('returns an empty array for an empty board', () => {
    expect(competitionRanks([])).toEqual([]);
  });
});

describe('formatStandingsMonth', () => {
  it('renders the month name and year from a YYYY-MM key', () => {
    expect(formatStandingsMonth('2026-08', 'en-GB')).toBe('August 2026');
  });

  it('renders in the given locale', () => {
    expect(formatStandingsMonth('2026-08', 'de-DE')).toBe('August 2026');
    expect(formatStandingsMonth('2026-12', 'fr-FR')).toBe('décembre 2026');
  });

  it('reads the month as UTC, so a negative-offset viewer does not see the previous month', () => {
    // '2026-08' parsed as local time in UTC-5 would be 31 July; the helper must not do that.
    expect(formatStandingsMonth('2026-08', 'en-GB')).not.toContain('July');
  });
});
```

Add `competitionRanks` and `formatStandingsMonth` to the existing import from `$lib/utils/game` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd web && pnpm test -- --run src/lib/utils/game.spec.ts
```

Expected: FAIL — `competitionRanks is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `web/src/lib/utils/game.ts`:

```ts
/**
 * Competition ranks - `1, 2, 2, 4` - for a board already sorted best-first.
 *
 * Rank ties on the displayed VALUE only. Two players on 4,200 points share second place even
 * though the ordering put one above the other on a tie-break the board does not show; numbering
 * them 2 and 3 would claim a winner the score does not support.
 */
export const competitionRanks = (totals: number[]): number[] => {
  let lastTotal: number | undefined;
  let lastRank = 0;
  return totals.map((total, index) => {
    if (total !== lastTotal) {
      lastTotal = total;
      lastRank = index + 1;
    }
    return lastRank;
  });
};

/**
 * A `YYYY-MM` standings key as a month name, e.g. `August 2026`.
 *
 * Built with `Date.UTC` rather than `new Date('2026-08')`: the string form is parsed as UTC by
 * spec but formatted in the viewer's zone, so anyone west of Greenwich would be shown the previous
 * month. The server's month is a UTC month; this renders that same month.
 */
export const formatStandingsMonth = (month: string, locale?: string): string => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, monthNumber - 1, 1)),
  );
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd web && pnpm test -- --run src/lib/utils/game.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/game.ts web/src/lib/utils/game.spec.ts
git commit -m "feat(web): add standings rank and month helpers"
```

---

### Task 8: Generalise the leaderboard table

One table renders today's board, the monthly board, and the play page's completed screen. It gains avatars, competition ranks, and a highlight for the viewer's own row.

**Files:**

- Modify: `web/src/lib/components/games/game-leaderboard.svelte` (full rewrite, 37 lines)
- Modify: `web/src/lib/components/games/game-leaderboard.spec.ts` (full rewrite)
- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte:219-221` (call site)

**Interfaces:**

- Consumes: `competitionRanks` (Task 7), the i18n keys (Task 6).
- Produces: `GameLeaderboard` with

  ```ts
  type LeaderboardUser = {
    id: string;
    name: string;
    email: string;
    profileImagePath: string;
    avatarColor: UserAvatarColor;
    profileChangedAt: string;
  };
  type LeaderboardRow = {
    user: LeaderboardUser;
    /** Ranking input only. `value` is the rendered string, which may be '—'. */
    total: number;
    detail: string;
    value: string;
    isMe: boolean;
  };
  type Props = { rows: LeaderboardRow[] };
  ```

  and, exported from the same module, `toAvatarUser(member: SharedSpaceMemberResponseDto): LeaderboardUser`. Task 9 uses both.

  Ranks are computed inside the component and are **not** a prop: they tie on `total`, the raw score, because `value` is an already-formatted string that a caller could render as `'—'`. Callers supply `total` for that and nothing else uses it.

- [ ] **Step 1: Write the failing test**

Replace `web/src/lib/components/games/game-leaderboard.spec.ts` with:

```ts
import { UserAvatarColor } from '@immich/sdk';
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import GameLeaderboard, { toAvatarUser } from '$lib/components/games/game-leaderboard.svelte';

const row = (name: string, total: number, overrides: Record<string, unknown> = {}) => ({
  user: {
    id: name.toLowerCase(),
    name,
    email: `${name.toLowerCase()}@example.com`,
    profileImagePath: '',
    avatarColor: UserAvatarColor.Primary,
    profileChangedAt: '',
  },
  total,
  detail: '5 of 5 rounds answered',
  value: `${total} pts`,
  isMe: false,
  ...overrides,
});

describe('GameLeaderboard', () => {
  it('renders one row per entry, in the order given', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200), row('Cara', 100)] });

    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    expect(screen.getAllByTestId('leaderboard-row').map((el) => el.textContent)).toEqual([
      expect.stringContaining('Ana'),
      expect.stringContaining('Ben'),
      expect.stringContaining('Cara'),
    ]);
  });

  it('numbers tied totals with the same rank and skips the next', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200), row('Cara', 4200), row('Dee', 100)] });

    expect(screen.getAllByTestId('leaderboard-rank').map((el) => el.textContent?.trim())).toEqual(['1', '2', '2', '4']);
  });

  it("marks the viewer's own row so they can find themselves", () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200, { isMe: true })] });

    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[0]).not.toHaveAttribute('data-me', 'true');
    expect(rows[1]).toHaveAttribute('data-me', 'true');
  });

  it('renders an avatar for every row', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100), row('Ben', 4200)] });

    // No profileImagePath, so UserAvatar falls back to the initial.
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('gives the table an accessible name', () => {
    render(GameLeaderboard, { rows: [row('Ana', 9100)] });

    expect(screen.getByRole('table', { name: 'game_leaderboard' })).toBeInTheDocument();
  });
});

describe('toAvatarUser', () => {
  it('fills the gaps a member DTO leaves, so UserAvatar always has a full shape', () => {
    const user = toAvatarUser({ userId: 'u1', name: 'Ana', email: 'ana@example.com' } as never);

    expect(user).toEqual({
      id: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      profileImagePath: '',
      avatarColor: UserAvatarColor.Primary,
      profileChangedAt: '',
    });
  });

  it('passes profileChangedAt through, so the profile image cache-buster stays correct', () => {
    const user = toAvatarUser({
      userId: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      profileImagePath: 'upload/profile/u1.jpg',
      avatarColor: 'green',
      profileChangedAt: '2026-08-01T00:00:00.000Z',
    } as never);

    expect(user.profileChangedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(user.profileImagePath).toBe('upload/profile/u1.jpg');
    expect(user.avatarColor).toBe('green');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm test -- --run src/lib/components/games/game-leaderboard.spec.ts
```

Expected: FAIL — no `toAvatarUser` export, and the component still expects `entries`.

- [ ] **Step 3: Rewrite the component**

Replace `web/src/lib/components/games/game-leaderboard.svelte` with:

```svelte
<script lang="ts" module>
  import { UserAvatarColor, type SharedSpaceMemberResponseDto } from '@immich/sdk';

  export type LeaderboardUser = {
    id: string;
    name: string;
    email: string;
    profileImagePath: string;
    avatarColor: UserAvatarColor;
    profileChangedAt: string;
  };

  export type LeaderboardRow = {
    user: LeaderboardUser;
    /** Ranking input, not displayed - `value` is the rendered string, which may be '—'. */
    total: number;
    detail: string;
    value: string;
    isMe: boolean;
  };

  /**
   * A space member as UserAvatar wants them. Same adaptation space-activity-feed.svelte does, with
   * one difference: a member carries a real profileChangedAt, so it is passed through rather than
   * blanked - that value is the profile image's cache-buster, and dropping it serves a stale
   * avatar after someone changes their picture.
   */
  export const toAvatarUser = (member: SharedSpaceMemberResponseDto): LeaderboardUser => ({
    id: member.userId,
    name: member.name,
    email: member.email,
    profileImagePath: member.profileImagePath ?? '',
    avatarColor: (member.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
    profileChangedAt: member.profileChangedAt ?? '',
  });
</script>

<script lang="ts">
  import UserAvatar from '$lib/components/shared-components/UserAvatar.svelte';
  import { competitionRanks } from '$lib/utils/game';
  import { t } from 'svelte-i18n';

  type Props = { rows: LeaderboardRow[] };

  let { rows }: Props = $props();

  // Ranked on the score, not on array position: two players on the same points share a place even
  // though the sort had to put one of them first.
  const ranks = $derived(competitionRanks(rows.map((row) => row.total)));
</script>

<table class="w-full text-start" data-testid="game-leaderboard">
  <!-- sr-only: whichever surface hosts this table already names it visibly, so a second visible
       "Leaderboard" would be redundant - but the table itself still needs an accessible name. -->
  <caption class="sr-only">{$t('game_leaderboard')}</caption>
  <tbody>
    {#each rows as row, index (row.user.id)}
      <tr
        data-testid="leaderboard-row"
        data-me={row.isMe ? 'true' : undefined}
        class="border-b border-gray-200 last:border-0 dark:border-gray-800 {row.isMe
          ? 'bg-primary/10 font-semibold'
          : ''}"
      >
        <td class="w-8 py-2 text-sm text-gray-500 dark:text-gray-400" data-testid="leaderboard-rank">
          {ranks[index]}
        </td>
        <td class="w-10 py-2">
          <div class="size-8">
            <UserAvatar user={row.user} size="full" />
          </div>
        </td>
        <td class="py-2 text-start font-medium">{row.user.name}</td>
        <td class="py-2 text-sm text-gray-500 dark:text-gray-400">{row.detail}</td>
        <td class="py-2 text-end font-semibold">{row.value}</td>
      </tr>
    {/each}
  </tbody>
</table>
```

- [ ] **Step 4: Update the play page call site**

In `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte`, the layout already supplies `data.members` (see `spaces/[spaceId]/+layout.ts`), so the avatars need no extra request.

Add to the script block:

```ts
import GameLeaderboard, { toAvatarUser } from '$lib/components/games/game-leaderboard.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
import type { SharedSpaceMemberResponseDto } from '@immich/sdk';

const memberById = $derived(
  new Map((data.members as SharedSpaceMemberResponseDto[]).map((member) => [member.userId, member])),
);

const leaderboardRows = $derived(
  (leaderboard?.entries ?? []).flatMap((entry) => {
    const member = memberById.get(entry.userId);
    // The server only returns current members, so a miss here means the member list is stale -
    // skip rather than render a nameless avatar.
    if (!member) {
      return [];
    }
    return [
      {
        user: toAvatarUser(member),
        total: entry.total,
        detail:
          entry.answered === 0
            ? $t('game_not_played')
            : $t('game_rounds_answered', { values: { answered: entry.answered, total: challenge.rounds.length } }),
        value: entry.answered === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
        isMe: entry.userId === authManager.user.id,
      },
    ];
  }),
);
```

and replace the render at lines 219-221:

```svelte
          {#if leaderboard}
            <GameLeaderboard rows={leaderboardRows} />
          {/if}
```

(remove the now-unused default `GameLeaderboard` import line if it duplicates the new one).

- [ ] **Step 5: Fix the three things this breaks in the play-page spec**

These are not "may need" — each one is a confirmed break, and the third is a test that keeps passing while testing nothing.

**5a. `authManager.user` throws when unset.** `auth-manager.svelte.ts:28-34` throws `TypeError: AuthManager.user is undefined`, and this spec never sets a user — it mocks `UserPageLayout` precisely to avoid the NavigationBar reading it. Add to the imports and the `beforeEach` (line 87), matching `space-games-page.spec.ts`:

```ts
import { authManager } from '$lib/managers/auth-manager.svelte';
import { preferencesFactory } from '@test-data/factories/preferences-factory';
import { userAdminFactory } from '@test-data/factories/user-factory';

beforeEach(() => {
  vi.resetAllMocks();
  authManager.setUser(userAdminFactory.build({ id: 'current-user-id' }));
  authManager.setPreferences(preferencesFactory.build());
  sdkMock.getChallenge.mockResolvedValue(makeChallenge());
});
```

**5b. `renderPage` passes no members.** It builds `props = { data: { challenge } }` (line 73). SvelteKit merges layout data at runtime, but a directly-rendered component gets only what the test hands it, so `data.members` is `undefined` and `.map` throws. Give it a default that covers the existing fixture:

```ts
function renderPage(
  challenge: GameChallengeDetailResponseDto,
  members: SharedSpaceMemberResponseDto[] = [
    {
      userId: 'u1',
      name: 'Alice',
      email: 'alice@example.com',
      role: SharedSpaceRole.Viewer,
      showInTimeline: false,
      sharePersonMetadata: true,
      joinedAt: '2026-01-01T00:00:00.000Z',
    } as SharedSpaceMemberResponseDto,
  ],
) {
  const props = { data: { challenge, members } };
  return render(TestWrapper as Component<{ component: typeof GamePlayPage; componentProps: typeof props }>, {
    component: GamePlayPage,
    componentProps: props,
  });
}
```

`u1` is the userId the existing leaderboard fixture at line 155 already uses.

**5c. The existing leaderboard assertion is now vacuous.** `data-testid="game-leaderboard"` sits on the `<table>`, which renders even with zero rows — so `getByTestId('game-leaderboard')` would pass even if the member lookup dropped every entry. Strengthen the test at line 148 so it fails when no row renders:

```ts
await waitFor(() => expect(screen.getByTestId('game-leaderboard')).toBeInTheDocument());
expect(screen.getByTestId('leaderboard-row')).toHaveTextContent('Alice');
expect(screen.getByTestId('game-completed')).toHaveTextContent('Completed');
```

Do the same at the second leaderboard assertion (line 455) if it has a non-empty entries fixture.

- [ ] **Step 6: Run the component and play-page tests**

```bash
cd web && pnpm test -- --run src/lib/components/games/game-leaderboard.spec.ts
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/game-play-page.spec.ts"
```

Expected: both PASS, with every pre-existing play-page test still green.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/components/games/game-leaderboard.svelte \
        web/src/lib/components/games/game-leaderboard.spec.ts \
        "web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte" \
        "web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/game-play-page.spec.ts"
git commit -m "feat(web): give the leaderboard avatars, ranks and a you-marker"
```

---

### Task 9: The standings section

**Files:**

- Create: `web/src/lib/components/games/standings-section.svelte`
- Test: `web/src/lib/components/games/standings-section.spec.ts`

**Interfaces:**

- Consumes: `GameLeaderboard` and `toAvatarUser` (Task 8), `competitionRanks` / `formatStandingsMonth` (Task 7), the i18n keys (Task 6).
- Produces: `StandingsSection` with

  ```ts
  type Props = {
    today: { entries: GameLeaderboardEntryDto[]; roundCount: number } | null;
    month: GameStandingsResponseDto;
    members: SharedSpaceMemberResponseDto[];
    currentUserId: string;
  };
  ```

  Task 10 mounts it.

- [ ] **Step 1: Write the failing test**

Do **not** initialise svelte-i18n in this file. Like `game-leaderboard.spec.ts`, it asserts on raw
i18n keys — with no locale registered, `$t('game_days_played')` returns the key itself. That keeps
the assertions about which string the component chose rather than about English copy, which lives in
`en.json` and is Task 6's business.

Create `web/src/lib/components/games/standings-section.spec.ts`:

```ts
import type { SharedSpaceMemberResponseDto } from '@immich/sdk';
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/svelte';
import StandingsSection from '$lib/components/games/standings-section.svelte';

const members = [
  { userId: 'u1', name: 'Ana', email: 'ana@example.com' },
  { userId: 'u2', name: 'Ben', email: 'ben@example.com' },
  { userId: 'u3', name: 'Kim', email: 'kim@example.com' },
] as SharedSpaceMemberResponseDto[];

const base = {
  members,
  currentUserId: 'u2',
  today: {
    roundCount: 5,
    entries: [
      { userId: 'u1', name: 'Ana', total: 21_400, answered: 5 },
      { userId: 'u2', name: 'Ben', total: 18_420, answered: 5 },
      { userId: 'u3', name: 'Kim', total: 0, answered: 0 },
    ],
  },
  month: {
    month: '2026-08',
    entries: [
      { userId: 'u1', name: 'Ana', total: 59_920, daysPlayed: 14 },
      { userId: 'u2', name: 'Ben', total: 48_120, daysPlayed: 12 },
      { userId: 'u3', name: 'Kim', total: 0, daysPlayed: 0 },
    ],
  },
};

describe('StandingsSection', () => {
  it("opens on today's board", () => {
    render(StandingsSection, base);

    expect(screen.getByTestId('standings-tab-today')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('standings-tab-month')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    expect(screen.getByText('game_rounds_answered')).toBeInTheDocument();
  });

  it('swaps to the monthly board and shows days played', async () => {
    render(StandingsSection, base);

    await fireEvent.click(screen.getByTestId('standings-tab-month'));

    expect(screen.getByTestId('standings-tab-month')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
    // A substring match, not an exact one: the monthly detail cell joins the days-played and
    // average keys into one string, so getByText('game_days_played') would find nothing.
    expect(screen.getAllByTestId('leaderboard-row')[0]).toHaveTextContent(/game_days_played.*game_average_points/);
  });

  it('shows a dash for a member who has not played, on either tab', async () => {
    render(StandingsSection, base);

    const kimToday = screen.getAllByTestId('leaderboard-row')[2];
    expect(kimToday).toHaveTextContent('Kim');
    expect(kimToday).toHaveTextContent('—');

    await fireEvent.click(screen.getByTestId('standings-tab-month'));
    expect(screen.getAllByTestId('leaderboard-row')[2]).toHaveTextContent('—');
  });

  it("marks the viewer's own row", () => {
    render(StandingsSection, base);

    const rows = screen.getAllByTestId('leaderboard-row');
    expect(rows[1]).toHaveAttribute('data-me', 'true');
    expect(rows[0]).not.toHaveAttribute('data-me', 'true');
  });

  it('renders the month board alone, with no tabs, when there is no daily today', () => {
    render(StandingsSection, { ...base, today: null });

    expect(screen.queryByTestId('standings-tab-today')).not.toBeInTheDocument();
    expect(screen.queryByTestId('standings-tab-month')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
  });

  it('shows every member at zero on an untouched month rather than an empty state', async () => {
    render(StandingsSection, {
      ...base,
      month: {
        month: '2026-08',
        entries: [
          { userId: 'u1', name: 'Ana', total: 0, daysPlayed: 0 },
          { userId: 'u2', name: 'Ben', total: 0, daysPlayed: 0 },
          { userId: 'u3', name: 'Kim', total: 0, daysPlayed: 0 },
        ],
      },
    });

    await fireEvent.click(screen.getByTestId('standings-tab-month'));

    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd web && pnpm test -- --run src/lib/components/games/standings-section.spec.ts
```

Expected: FAIL — the component file does not exist.

- [ ] **Step 3: Write the component**

Create `web/src/lib/components/games/standings-section.svelte`:

```svelte
<script lang="ts">
  import GameLeaderboard, {
    toAvatarUser,
    type LeaderboardRow,
  } from '$lib/components/games/game-leaderboard.svelte';
  import { formatStandingsMonth } from '$lib/utils/game';
  import type {
    GameLeaderboardResponseDto,
    GameStandingsResponseDto,
    SharedSpaceMemberResponseDto,
  } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  type Props = {
    /** Null when the space has no daily today - then there is only one board, so no tabs. */
    today: { entries: GameLeaderboardResponseDto['entries']; roundCount: number } | null;
    month: GameStandingsResponseDto;
    members: SharedSpaceMemberResponseDto[];
    currentUserId: string;
  };

  let { today, month, members, currentUserId }: Props = $props();

  let tab = $state<'today' | 'month'>('today');

  const memberById = $derived(new Map(members.map((member) => [member.userId, member])));

  /** Both endpoints return exactly the current members, so a miss means a stale member list. */
  const rowFor = (userId: string, total: number, detail: string, value: string): LeaderboardRow[] => {
    const member = memberById.get(userId);
    if (!member) {
      return [];
    }
    return [{ user: toAvatarUser(member), total, detail, value, isMe: userId === currentUserId }];
  };

  const todayRows = $derived(
    (today?.entries ?? []).flatMap((entry) =>
      rowFor(
        entry.userId,
        entry.total,
        entry.answered === 0
          ? $t('game_not_played')
          : $t('game_rounds_answered', { values: { answered: entry.answered, total: today?.roundCount ?? 0 } }),
        entry.answered === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
      ),
    ),
  );

  const monthRows = $derived(
    month.entries.flatMap((entry) =>
      rowFor(
        entry.userId,
        entry.total,
        entry.daysPlayed === 0
          ? $t('game_not_played')
          : `${$t('game_days_played', { values: { count: entry.daysPlayed } })} · ${$t('game_average_points', {
              values: { score: Math.round(entry.total / entry.daysPlayed) },
            })}`,
        entry.daysPlayed === 0 ? '—' : $t('game_points', { values: { score: entry.total } }),
      ),
    ),
  );

  // Falls back to today's board whenever there is a daily, so the section opens on the thing the
  // player just did.
  const rows = $derived(today === null || tab === 'month' ? monthRows : todayRows);
</script>

<section class="flex flex-col gap-3" data-testid="standings-section">
  <div class="flex flex-wrap items-center justify-between gap-2">
    <h2 class="text-lg font-semibold">{$t('game_leaderboard')}</h2>

    {#if today !== null}
      <!-- Same segmented control as challenge-create-panel.svelte: two options do not warrant a
           new widget, and aria-pressed already carries the state. -->
      <div class="flex overflow-hidden rounded-full border border-gray-300 dark:border-gray-700">
        <button
          type="button"
          aria-pressed={tab === 'today'}
          onclick={() => (tab = 'today')}
          data-testid="standings-tab-today"
          class="px-4 py-1.5 text-sm font-semibold transition-colors {tab === 'today'
            ? 'bg-primary text-light'
            : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
        >
          {$t('game_standings_today')}
        </button>
        <button
          type="button"
          aria-pressed={tab === 'month'}
          onclick={() => (tab = 'month')}
          data-testid="standings-tab-month"
          title={formatStandingsMonth(month.month)}
          class="px-4 py-1.5 text-sm font-semibold transition-colors {tab === 'month'
            ? 'bg-primary text-light'
            : 'hover:bg-gray-200 dark:hover:bg-gray-800'}"
        >
          {$t('game_standings_month')}
        </button>
      </div>
    {/if}
  </div>

  <GameLeaderboard {rows} />
</section>
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd web && pnpm test -- --run src/lib/components/games/standings-section.spec.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/standings-section.svelte \
        web/src/lib/components/games/standings-section.spec.ts
git commit -m "feat(web): add the games standings section"
```

---

### Task 10: Wire the section into the games page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/+page.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/+page.svelte` (mount the section between the hero and `Your challenges`)
- Test: `web/src/routes/(user)/spaces/[spaceId]/games/page-load.spec.ts`
- Test: `web/src/routes/(user)/spaces/[spaceId]/games/space-games-page.spec.ts`

**Interfaces:**

- Consumes: `StandingsSection` (Task 9), `getStandings` and `getLeaderboard` from `@immich/sdk` (Task 5).
- Produces: `PageData` gains `standings: GameStandingsResponseDto` and `todayBoard: GameLeaderboardResponseDto | null`.

- [ ] **Step 1: Write the failing page-load test**

`page-load.spec.ts` builds its event with `makeEvent()` (line 73) and asserts the whole return with
`resolves.toEqual({...})`. Two things follow.

First, extend the `beforeEach` (line 79) — it calls `vi.resetAllMocks()`, so every SDK function the
load touches must be re-stubbed there or it returns `undefined`:

```ts
const standings = { month: '2026-08', entries: [] };
const todayBoard = { entries: [] };

beforeEach(() => {
  vi.resetAllMocks();
  sdkMock.getChallenges.mockResolvedValue(challenges as never);
  sdkMock.getDailyChallenge.mockResolvedValue({ challenge: daily } as never);
  sdkMock.getStandings.mockResolvedValue(standings as never);
  sdkMock.getLeaderboard.mockResolvedValue(todayBoard as never);
});
```

Second, the two existing exact-equality assertions (lines 87-91 and 108-112) now describe an
incomplete return and must gain the new fields — `standings` and `todayBoard` in the first,
`standings` and `todayBoard: null` in the second, since a null daily means no board. Update them
rather than switching to `objectContaining`: the exactness is what proves nothing extra leaks into
`PageData`.

Then append:

```ts
it('loads the monthly standings in parallel with the challenges and the daily', async () => {
  await expect(load(makeEvent() as never)).resolves.toMatchObject({ standings });

  expect(sdkMock.getStandings).toHaveBeenCalledWith({ spaceId: 'space-1' });
});

it("loads today's board once the daily's id is known", async () => {
  await expect(load(makeEvent() as never)).resolves.toMatchObject({ todayBoard });

  expect(sdkMock.getLeaderboard).toHaveBeenCalledWith({ id: 'daily-1' });
});

it("skips today's board for a space with no daily, rather than calling with an empty id", async () => {
  sdkMock.getDailyChallenge.mockResolvedValue({ challenge: null } as never);

  await expect(load(makeEvent() as never)).resolves.toMatchObject({ todayBoard: null });

  expect(sdkMock.getLeaderboard).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/games/page-load.spec.ts"
```

Expected: FAIL — `result.standings` is undefined.

- [ ] **Step 3: Extend the page load**

Replace `web/src/routes/(user)/spaces/[spaceId]/games/+page.ts` with:

```ts
import { getChallenges, getDailyChallenge, getLeaderboard, getStandings } from '@immich/sdk';
import { authenticate } from '$lib/utils/auth';
import type { PageLoad } from './$types';

export const load = (async ({ url, params, parent }) => {
  await authenticate(url);
  const { space } = await parent();
  // In parallel: the daily's first read is what GENERATES it, which runs the candidate queries and
  // the CLIP prompts, so serialising it behind the list would add that latency to every page load.
  // The standings join that group - they depend on nothing else on this page.
  const [challenges, daily, standings] = await Promise.all([
    getChallenges({ spaceId: params.spaceId }),
    getDailyChallenge({ spaceId: params.spaceId }),
    getStandings({ spaceId: params.spaceId }),
  ]);

  // The one genuinely serial hop: today's board is keyed by the daily's id, which only exists once
  // the call above has returned (or generated) it. A space with no usable photos has no daily and
  // therefore no board - not an empty one.
  const todayBoard = daily.challenge ? await getLeaderboard({ id: daily.challenge.id }) : null;

  // "Challenges", matching the space-tabs.svelte label for this tab ($t('game_challenges')) - same
  // convention as the sibling Activity/Members pages (space name + the tab's own English label).
  return {
    challenges,
    daily: daily.challenge,
    standings,
    todayBoard,
    meta: { title: `${space.name} - Challenges` },
  };
}) satisfies PageLoad;
```

- [ ] **Step 4: Write the failing page test**

`renderPage` in `space-games-page.spec.ts` (line 87) takes **positional** arguments
`(challenges, role, daily)`. Add a fourth, optional, so every existing call site keeps working
untouched:

```ts
function renderPage(
  challenges: GameChallengeListItemResponseDto[],
  role: SharedSpaceRole = SharedSpaceRole.Editor,
  daily: GameChallengeListItemResponseDto | null = null,
  boards: {
    standings?: { month: string; entries: Array<{ userId: string; name: string; total: number; daysPlayed: number }> };
    todayBoard?: { entries: Array<{ userId: string; name: string; total: number; answered: number }> } | null;
  } = {},
) {
  const props = {
    data: {
      space: BASE_SPACE,
      members: [makeMember(role)],
      challenges,
      daily,
      standings: boards.standings ?? { month: '2026-08', entries: [] },
      todayBoard: boards.todayBoard ?? null,
      meta: { title: 'Test Space - Challenges' },
    },
  };
  return render(TestWrapper as Component<{ component: typeof SpaceGamesPage; componentProps: typeof props }>, {
    component: SpaceGamesPage,
    componentProps: props,
  });
}
```

This file **does** initialise svelte-i18n with the real `en.json` (its `beforeAll`), unlike Task 9's
component spec — so assert on English copy here, not on raw keys. `makeMember` builds a member whose
`userId` is `'current-user-id'`, which is also the id the `beforeEach` gives `authManager`, so a row
for that user is the viewer's own row.

Append:

```ts
describe('standings', () => {
  const entriesFor = (userId: string) => ({
    standings: { month: '2026-08', entries: [{ userId, name: 'Current User', total: 400, daysPlayed: 1 }] },
    todayBoard: { entries: [{ userId, name: 'Current User', total: 400, answered: 5 }] },
  });

  it('renders the standings below the daily hero and above the challenge list', () => {
    renderPage(
      [],
      SharedSpaceRole.Viewer,
      makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16', answered: 5 }),
      entriesFor('current-user-id'),
    );

    const section = screen.getByTestId('standings-section');
    const hero = screen.getByTestId('daily-challenge');
    // Bitmask, not equality: compareDocumentPosition returns a set of flags.
    expect(section.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getAllByTestId('leaderboard-row')).toHaveLength(1);
    expect(screen.getByTestId('leaderboard-row')).toHaveAttribute('data-me', 'true');
  });

  it('still renders the standings when the space has no daily today, without tabs', () => {
    renderPage([], SharedSpaceRole.Viewer, null, {
      standings: {
        month: '2026-08',
        entries: [{ userId: 'current-user-id', name: 'Current User', total: 0, daysPlayed: 0 }],
      },
      todayBoard: null,
    });

    expect(screen.getByTestId('standings-section')).toBeInTheDocument();
    expect(screen.queryByTestId('standings-tab-today')).not.toBeInTheDocument();
    expect(screen.getByTestId('leaderboard-row')).toHaveTextContent('Not played');
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/games/space-games-page.spec.ts"
```

Expected: FAIL — `standings-section` is not in the document.

- [ ] **Step 6: Mount the section**

In `web/src/routes/(user)/spaces/[spaceId]/games/+page.svelte`, add the import:

```ts
import StandingsSection from '$lib/components/games/standings-section.svelte';
```

add the derived values next to the existing ones (around line 34):

```ts
const standings = $derived(data.standings);
const todayBoard = $derived(data.todayBoard);
```

and insert between the `DailyChallengeCard` and the `Your challenges` section (after line 128):

```svelte
  <StandingsSection
    today={todayBoard && daily ? { entries: todayBoard.entries, roundCount: daily.roundCount } : null}
    month={standings}
    {members}
    currentUserId={authManager.user.id}
  />
```

- [ ] **Step 7: Run both test files to verify they pass**

```bash
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/games/page-load.spec.ts"
cd web && pnpm test -- --run "src/routes/(user)/spaces/[spaceId]/games/space-games-page.spec.ts"
```

Expected: both PASS, pre-existing tests included.

- [ ] **Step 8: Run the web gate**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run
```

Expected: clean, all tests pass. `check:svelte` can silently scan 0 files locally — check the file count in its output and treat a zero as a failed run, not a pass.

- [ ] **Step 9: Commit**

```bash
git add "web/src/routes/(user)/spaces/[spaceId]/games"
git commit -m "feat(web): show standings on the games page"
```

---

### Task 11: End-to-end coverage

The gate that matters: it is the only place the real query, the real zero-fill and the real route meet.

**Files:**

- Modify: `e2e/src/specs/server/api/game.e2e-spec.ts`

**Interfaces:**

- Consumes: the deployed route from Task 3 and the leaderboard change from Task 4.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Write the failing e2e tests**

Add a helper next to `getDaily` at the top of the file:

```ts
const getStandings = async (
  spaceId: string,
  accessToken: string,
): Promise<{ month: string; entries: Array<{ userId: string; name: string; total: number; daysPlayed: number }> }> => {
  const { status, body } = await request(app)
    .get(`/shared-spaces/${spaceId}/games/standings`)
    .set('Authorization', `Bearer ${accessToken}`);
  expect(status).toBe(200);
  return body;
};
```

and a new describe block:

```ts
describe('GET /shared-spaces/:spaceId/games/standings', () => {
  it('rejects a non-member', async () => {
    const { spaceId } = await freshSpaceWithPhotos('standings-nonmember', 4);

    const { status } = await request(app)
      .get(`/shared-spaces/${spaceId}/games/standings`)
      .set('Authorization', `Bearer ${nonMember.accessToken}`);

    expect(status).toBe(403);
  });

  it('lists every member of the space, zero-filled, before anyone has played', async () => {
    const { spaceId } = await freshSpaceWithPhotos('standings-zero-fill', 4);

    const standings = await getStandings(spaceId, viewer.accessToken);

    expect(standings.month).toMatch(/^\d{4}-\d{2}$/);
    expect(standings.entries).toHaveLength(3); // owner + editor + viewer
    expect(standings.entries.every((entry) => entry.total === 0 && entry.daysPlayed === 0)).toBe(true);
  });

  it("counts a member's daily score and orders the board by it", async () => {
    const { spaceId } = await freshSpaceWithPhotos('standings-order', 4);
    const daily = await getDaily(spaceId, viewer.accessToken);
    expect(daily.challenge).not.toBeNull();

    // The viewer answers every round; the editor answers one. Both played, so the viewer's
    // higher total must lead - and the owner, who never played, must be last.
    const detail = await getDetail(daily.challenge!.id, viewer.accessToken);
    for (const round of detail.rounds) {
      const { status } = await request(app)
        .post(`/games/${daily.challenge!.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(round));
      expect(status).toBe(201);
    }

    const { status: editorStatus } = await request(app)
      .post(`/games/${daily.challenge!.id}/rounds/0/guess`)
      .set('Authorization', `Bearer ${editor.accessToken}`)
      .send(guessPayloadFor(detail.rounds[0]));
    expect(editorStatus).toBe(201);

    const standings = await getStandings(spaceId, viewer.accessToken);

    expect(standings.entries).toHaveLength(3);
    expect(standings.entries[0].userId).toBe(viewer.userId);
    expect(standings.entries[0].daysPlayed).toBe(1);
    expect(standings.entries[1].userId).toBe(editor.userId);
    // Never played, so last whatever the totals.
    expect(standings.entries[2].userId).toBe(owner.userId);
    expect(standings.entries[2].daysPlayed).toBe(0);
  });

  it('never counts points earned on a player-created challenge', async () => {
    const { spaceId } = await freshSpaceWithPhotos('standings-custom-excluded', 4);
    const challenge = await createChallenge(spaceId, 4);
    const detail = await getDetail(challenge.id, viewer.accessToken);

    for (const round of detail.rounds) {
      await request(app)
        .post(`/games/${challenge.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(round));
    }

    const standings = await getStandings(spaceId, viewer.accessToken);

    expect(standings.entries.every((entry) => entry.total === 0 && entry.daysPlayed === 0)).toBe(true);
  });

  it('puts every member on a challenge leaderboard, played or not', async () => {
    const { spaceId } = await freshSpaceWithPhotos('leaderboard-zero-fill', 4);
    const challenge = await createChallenge(spaceId, 4);
    const detail = await getDetail(challenge.id, viewer.accessToken);

    await request(app)
      .post(`/games/${challenge.id}/rounds/0/guess`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send(guessPayloadFor(detail.rounds[0]));

    const { status, body } = await request(app)
      .get(`/games/${challenge.id}/leaderboard`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);

    expect(status).toBe(200);
    expect(body.entries).toHaveLength(3);
    expect(body.entries[0].userId).toBe(viewer.userId);
    expect(body.entries.map((entry: { name: string }) => entry.name)).not.toContain('Unknown');
  });
});
```

- [ ] **Step 2: Run the e2e suite against a running stack**

```bash
make e2e            # in another terminal, if the e2e stack is not already up
make e2e-api-dev
```

Or, targeting the one file:

```bash
cd e2e && pnpm test -- --run src/specs/server/api/game.e2e-spec.ts
```

Expected: PASS, with the pre-existing game tests unaffected.

If the whole file fails to reach the database, check that a stray process is not holding port 5435 before assuming the code is wrong.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/game.e2e-spec.ts
git commit -m "test(game): cover the standings endpoint end to end"
```

---

### Task 12: Final gate

- [ ] **Step 1: Server**

```bash
cd server && pnpm check && pnpm lint && pnpm test -- --run
```

- [ ] **Step 2: Web**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test -- --run
```

`check:svelte` reporting 0 files scanned is a failed run, not a pass.

- [ ] **Step 3: Formatting**

```bash
cd server && pnpm format
cd ../web && pnpm format
cd .. && npx prettier --check i18n/*.json
```

eslint passing does not imply prettier passing — they are separate CI gates.

- [ ] **Step 4: Commit anything the formatters touched**

```bash
git add -A
git commit -m "style: apply formatting to the standings changes"
```

Skip if the tree is clean.
