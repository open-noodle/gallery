# PhotoGuesser Solo Play Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user play the photo guessing game alone — a personal daily plus unlimited free play — from a top-level entry on web and mobile, without belonging to any shared space.

**Architecture:** `GameService` stops knowing what a shared space is. Candidate fetching and asset eligibility move behind a `ChallengePool` strategy with two implementations, `SpacePool` and `PersonalPool`. `game_challenge` gains a nullable `ownerId` alongside its now-nullable `spaceId`, with a CHECK enforcing exactly one. Two thin controllers keep the two authorization models apart: membership for spaces, ownership for solo.

**Tech Stack:** NestJS 11 + Kysely + PostgreSQL 14, SvelteKit with Svelte 5 runes, Flutter with Riverpod and auto_route, Vitest, Playwright, `flutter test`.

**Spec:** `docs/superpowers/specs/2026-08-19-photoguesser-solo-design.md`

**Depends on:** `docs/superpowers/plans/2026-08-19-photoguesser-perf-fixes.md` — Tasks 3 and 4 of that plan produce the two-stage shape and `spaceAssetIdUnion` that `PersonalPool` mirrors. Do not start Task 4 here until that plan is complete.

## Global Constraints

- This lands on top of **PR #1000, unmerged**. The schema change in Task 1 is a **new** fork migration in `server/src/schema/migrations-gallery/`, because #1000's own migrations are already written and re-editing them would break RC databases that have run them.
- **`PhotoGuesser` is a proper noun and is never translated.** All nine locale files (`de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`) carry the identical literal.
- Every user-facing string change updates **all nine locales in the same commit**, alphabetically sorted, then `npx prettier --write i18n/*.json`.
- **The visibility floor is non-negotiable:** `deletedAt IS NULL AND type = 'IMAGE' AND visibility = 'timeline'`, ANDed **outside** any read-arm OR, in both candidate selection and round-image resolution. Never inherited from `spaceVisibilityGate`, `checkPartnerAccess`, or `checkAlbumAccess` — each of those admits a class the game must exclude.

- **Do not name a visibility helper in a comment near a space read.** The guard at
  `server/src/utils/shared-space-album-scope.guard.spec.ts:428` tests `VIS_GATE_MARKER` (`:269`)
  against **raw source lines** within a window of each space read, with no comment stripping. So a
  comment containing `spaceVisibilityGate`, `AssetVisibility.Timeline`, `reviewableAssetVisibility`,
  or any other alternative in that regex marks the read as "visibility covered" **even when the real
  gate has been deleted**. The perf plan hit this for real: a suggested comment ending
  "…`spaceVisibilityGate` explicitly admits it" kept the guard green through a mutation that removed
  both visibility clauses. This plan adds `eligibleSoloAsset` — a new space-and-visibility read whose
  explanatory comments sit right beside it — so the trap is live here. Describe the behaviour in
  prose ("archived assets are admitted by the space helpers, so the floor is applied here") without
  writing the identifier. Also register any new space-read helper in the guard's `SPACE_HELPER` list,
  or the guard cannot see the read at all.
- **Shared albums (`album_user`) are not a read arm.** Own, partner (`inTimeline = true`), and shared space only.
- Sample size is **4,000** (`LOCATION_SAMPLE_SIZE`), measured. Do not change it.
- Regenerate SQL with **`mise sql`**, which **requires a running database** — without one it deletes every file in `server/src/queries/`.
- Test commands, which differ per package: server/web `pnpm test -- --run <path>` (the path is required); e2e `pnpm test <path>` (**never** add `--run`); mobile `flutter test <path>` after `dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart`.
- Mobile uses Flutter pinned in `mobile/mise.toml`. **Read the pin**, do not assume a version.
- Every new test must be **proven red before being committed green**. Where a test characterizes existing behaviour, prove red by temporary mutation and say so in the commit.

---

## File Structure

**Server — new**

| File                                                                  | Responsibility                                                           |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `src/schema/migrations-gallery/1794000000000-AddSoloGameChallenge.ts` | Nullable scope, ownerId, frozen source flags, CHECK, two partial indexes |
| `src/services/game/challenge-pool.ts`                                 | The `ChallengePool` interface and its shared types                       |
| `src/services/game/space-pool.ts`                                     | `SpacePool` — membership scope, wraps the existing repository methods    |
| `src/services/game/personal-pool.ts`                                  | `PersonalPool` — own + optional partner + optional space arms            |
| `src/controllers/game-solo.controller.ts`                             | Solo routes, ownership-gated                                             |
| `src/utils/game-solo-eligibility.ts`                                  | `eligibleSoloAsset` — the read-arm composition and the visibility floor  |

**Server — modified**

`src/schema/tables/game-challenge.table.ts`, `src/repositories/game.repository.ts`, `src/services/game.service.ts`, `src/controllers/game.controller.ts`, `src/dtos/game.dto.ts`, `src/dtos/user-preferences.dto.ts`, `src/utils/preferences.ts`, `src/types.ts`, `src/enum.ts`, `src/services/queue.service.ts`.

**Web — new**

`src/routes/(user)/photoguesser/+page.svelte` and `+page.ts`, `.../[challengeId=id]/+page.svelte` and `+page.ts`, `src/lib/components/games/game-play.svelte` (extracted), `solo-stats.svelte`, `solo-history.svelte`.

**Mobile — new**

`lib/pages/games/photo_guesser.page.dart`, `lib/providers/game/solo_game.provider.dart`, `lib/repositories/solo_game_api.repository.dart`. `lib/pages/library/spaces/games/game_play.page.dart` moves to `lib/pages/games/game_play.page.dart`.

---

### Task 1: Schema — a challenge that belongs to a user

**Files:**

- Create: `server/src/schema/migrations-gallery/1794000000000-AddSoloGameChallenge.ts`
- Modify: `server/src/schema/tables/game-challenge.table.ts`
- Test: `server/test/medium/specs/migrations/game-challenge-scope.migration.spec.ts` (create)

**Interfaces:**

- Produces: `game_challenge.ownerId: string | null`, `game_challenge.includePartners: boolean`, `game_challenge.includeSpaces: boolean`, and `game_challenge.spaceId: string | null`. Every later task depends on these names.

- [x] **Step 1: Write the failing medium test**

Create `server/test/medium/specs/migrations/game-challenge-scope.migration.spec.ts`. Medium tests run against a real Postgres via testcontainers — these constraints cannot be proven against a mock, and a nullable `spaceId` silently breaks the daily uniqueness rule, so a real database is the only honest check.

```ts
import { Kysely } from 'kysely';
import { DB } from 'src/schema';
import { getKyselyDB } from 'test/utils';
import { beforeAll, describe, expect, it } from 'vitest';

describe('game_challenge scope constraints', () => {
  let db: Kysely<DB>;

  beforeAll(async () => {
    db = await getKyselyDB();
  });

  const insertChallenge = (values: Record<string, unknown>) =>
    db
      .insertInto('game_challenge' as never)
      .values({ name: 'c', roundCount: 5, scaleKm: 100, scaleDays: 365, ...values } as never)
      .execute();

  it('rejects a challenge with neither a space nor an owner', async () => {
    await expect(insertChallenge({ spaceId: null, ownerId: null })).rejects.toThrow(/game_challenge_scope_chk/);
  });

  it('rejects a challenge with both a space and an owner', async () => {
    const { spaceId, userId } = await seedSpaceAndUser(db);
    await expect(insertChallenge({ spaceId, ownerId: userId })).rejects.toThrow(/game_challenge_scope_chk/);
  });

  it('rejects a second daily for the same owner and date', async () => {
    const { userId } = await seedSpaceAndUser(db);
    await insertChallenge({ spaceId: null, ownerId: userId, dailyOn: '2026-08-19' });

    // Without a SECOND partial unique index this passes: Postgres treats NULLs as distinct, so
    // the existing (spaceId, dailyOn) index does not constrain rows whose spaceId is NULL, and a
    // user would silently get two divergent dailies for one day.
    await expect(insertChallenge({ spaceId: null, ownerId: userId, dailyOn: '2026-08-19' })).rejects.toThrow(
      /game_challenge_owner_daily_uq/,
    );
  });

  it('still rejects a second daily for the same space and date', async () => {
    const { spaceId } = await seedSpaceAndUser(db);
    await insertChallenge({ spaceId, ownerId: null, dailyOn: '2026-08-19' });
    await expect(insertChallenge({ spaceId, ownerId: null, dailyOn: '2026-08-19' })).rejects.toThrow(
      /game_challenge_daily_uq/,
    );
  });

  it('allows two solo challenges for one owner when neither is a daily', async () => {
    const { userId } = await seedSpaceAndUser(db);
    await insertChallenge({ spaceId: null, ownerId: userId, dailyOn: null });
    await expect(insertChallenge({ spaceId: null, ownerId: userId, dailyOn: null })).resolves.toBeDefined();
  });
});
```

Add a `seedSpaceAndUser` helper in the same file that inserts one `user` row and one `shared_space` row using `mediumFactory` from `server/test/medium.factory.ts`, following the pattern of the nearest existing medium spec.

- [x] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/migrations/game-challenge-scope.migration.spec.ts`
Expected: FAIL. The first two cases fail because no CHECK exists; the third fails because the second index does not exist and the insert succeeds.

- [x] **Step 3: Update the declarative table**

In `server/src/schema/tables/game-challenge.table.ts`: make `spaceId` nullable, add `ownerId`, add the two boolean flags, add the `@Check`, and split the daily index in two.

```ts
@Check({
  name: 'game_challenge_scope_chk',
  expression: `num_nonnulls("spaceId", "ownerId") = 1`,
})
@Index({
  name: 'game_challenge_daily_uq',
  columns: ['spaceId', 'dailyOn'],
  unique: true,
  where: '"spaceId" IS NOT NULL AND "dailyOn" IS NOT NULL',
})
// Postgres treats NULLs as distinct in a unique index, so once spaceId is nullable the index
// above stops constraining solo rows entirely. Without this second index the lazy-generation
// race - which the first index exists to LOSE - starts winning twice, and one user gets two
// divergent dailies for the same UTC day.
@Index({
  name: 'game_challenge_owner_daily_uq',
  columns: ['ownerId', 'dailyOn'],
  unique: true,
  where: '"ownerId" IS NOT NULL AND "dailyOn" IS NOT NULL',
})
export class GameChallengeTable {
  // ...
  @ForeignKeyColumn(() => SharedSpaceTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    index: true,
    nullable: true,
  })
  spaceId!: string | null;

  // A solo challenge is personal and has no other stakeholder, so it dies with its owner -
  // unlike createdById, which is SET NULL precisely so deleting one member does not destroy a
  // shared space's challenges. A solo challenge leaves createdById NULL rather than setting
  // both: two FK actions firing on one row for one deletion event is a trap, and the authorship
  // is already carried here.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true, nullable: true })
  ownerId!: string | null;

  // Frozen at generation, for the same reason scaleKm/scaleDays are: re-resolving eligibility
  // from live preferences would 404 every round image of a game in flight the moment the player
  // toggled a source off.
  @Column({ type: 'boolean', default: false })
  includePartners!: Generated<boolean>;

  @Column({ type: 'boolean', default: false })
  includeSpaces!: Generated<boolean>;
```

- [x] **Step 4: Write the migration**

Create `server/src/schema/migrations-gallery/1794000000000-AddSoloGameChallenge.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "spaceId" DROP NOT NULL`.execute(db);

  await sql`ALTER TABLE "game_challenge" ADD COLUMN "ownerId" uuid`.execute(db);
  await sql`ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "user" ("id") ON UPDATE CASCADE ON DELETE CASCADE`.execute(db);
  await sql`CREATE INDEX "game_challenge_ownerId_idx" ON "game_challenge" ("ownerId")`.execute(db);

  await sql`ALTER TABLE "game_challenge" ADD COLUMN "includePartners" boolean NOT NULL DEFAULT false`.execute(db);
  await sql`ALTER TABLE "game_challenge" ADD COLUMN "includeSpaces" boolean NOT NULL DEFAULT false`.execute(db);

  await sql`ALTER TABLE "game_challenge" ADD CONSTRAINT "game_challenge_scope_chk"
    CHECK (num_nonnulls("spaceId", "ownerId") = 1)`.execute(db);

  // The existing index is REPLACED, not supplemented: its WHERE clause gains an explicit
  // "spaceId" IS NOT NULL so the two indexes describe disjoint row sets. The override row below
  // stores the statement VERBATIM and the schema comparer matches on that string, so the DROP,
  // the CREATE and the override payload must be edited together or the server logs schema drift
  // on every boot.
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_daily_uq"`.execute(db);

  await sql`CREATE UNIQUE INDEX "game_challenge_daily_uq" ON "game_challenge" ("spaceId", "dailyOn") WHERE ("spaceId" IS NOT NULL AND "dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_daily_uq', '{"type":"index","name":"game_challenge_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_daily_uq\\" ON \\"game_challenge\\" (\\"spaceId\\", \\"dailyOn\\") WHERE (\\"spaceId\\" IS NOT NULL AND \\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );

  await sql`CREATE UNIQUE INDEX "game_challenge_owner_daily_uq" ON "game_challenge" ("ownerId", "dailyOn") WHERE ("ownerId" IS NOT NULL AND "dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_owner_daily_uq', '{"type":"index","name":"game_challenge_owner_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_owner_daily_uq\\" ON \\"game_challenge\\" (\\"ownerId\\", \\"dailyOn\\") WHERE (\\"ownerId\\" IS NOT NULL AND \\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_owner_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_owner_daily_uq"`.execute(db);

  await sql`DELETE FROM "migration_overrides" WHERE "name" = 'index_game_challenge_daily_uq';`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_daily_uq"`.execute(db);
  await sql`CREATE UNIQUE INDEX "game_challenge_daily_uq" ON "game_challenge" ("spaceId", "dailyOn") WHERE ("dailyOn" IS NOT NULL);`.execute(
    db,
  );
  await sql`INSERT INTO "migration_overrides" ("name", "value") VALUES ('index_game_challenge_daily_uq', '{"type":"index","name":"game_challenge_daily_uq","sql":"CREATE UNIQUE INDEX \\"game_challenge_daily_uq\\" ON \\"game_challenge\\" (\\"spaceId\\", \\"dailyOn\\") WHERE (\\"dailyOn\\" IS NOT NULL);"}'::jsonb);`.execute(
    db,
  );

  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT IF EXISTS "game_challenge_scope_chk"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "includeSpaces"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "includePartners"`.execute(db);
  await sql`DROP INDEX IF EXISTS "game_challenge_ownerId_idx"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP CONSTRAINT IF EXISTS "game_challenge_ownerId_fkey"`.execute(db);
  await sql`ALTER TABLE "game_challenge" DROP COLUMN IF EXISTS "ownerId"`.execute(db);

  // Only safe because down() implies no solo challenges are wanted; delete them first so the
  // NOT NULL can be restored.
  await sql`DELETE FROM "game_challenge" WHERE "spaceId" IS NULL`.execute(db);
  await sql`ALTER TABLE "game_challenge" ALTER COLUMN "spaceId" SET NOT NULL`.execute(db);
}
```

- [x] **Step 5: Run the medium test to verify it passes**

Run: `cd server && pnpm test:medium -- --run test/medium/specs/migrations/game-challenge-scope.migration.spec.ts`
Expected: PASS, 5 tests.

If a failure set looks unrelated to your change, re-run the file alone and then the suite with `--no-file-parallelism` before believing it — medium runs shift their failure set under DB contention.

- [x] **Step 6: Verify no schema drift**

Start the server against a migrated database and confirm the boot log contains no schema-drift warning. A mismatch between the `CREATE UNIQUE INDEX` statements and the override payloads shows up here and nowhere else.

- [x] **Step 7: Commit**

```bash
git add server/src/schema/tables/game-challenge.table.ts \
        server/src/schema/migrations-gallery/1794000000000-AddSoloGameChallenge.ts \
        server/test/medium/specs/migrations/game-challenge-scope.migration.spec.ts
git commit -m "feat(game): let a challenge belong to a user instead of a space

spaceId becomes nullable, ownerId is added with ON DELETE CASCADE, and a
CHECK enforces exactly one scope.

The daily index has to be replaced rather than supplemented: Postgres treats
NULLs as distinct, so once spaceId is nullable the existing index stops
constraining solo rows and one user could get two divergent dailies for the
same day. Proven by a medium test, because a mock cannot show this."
```

---

### Task 2: Make `spaceId` nullable through the API and fix the call sites

`GameChallengeResponseSchema` declares `spaceId: z.string()`. Response DTOs are **not validated on output**, so a solo challenge does not fail loudly — the server silently emits `null` against a schema promising a string, and the damage lands in the generated clients.

**Files:**

- Modify: `server/src/dtos/game.dto.ts:52`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte:208`
- Regenerate: `open-api/immich-openapi-specs.json`, the TS SDK, `mobile/openapi/`
- Test: `e2e/src/specs/server/api/game.e2e-spec.ts`

**Interfaces:**

- Consumes: `ownerId` from Task 1.
- Produces: `GameChallengeResponseDto.spaceId: string | null` and `GameChallengeResponseDto.ownerId: string | null`. Every client task depends on these being nullable.

- [ ] **Step 1: Write the failing test**

Add to `e2e/src/specs/server/api/game.e2e-spec.ts`:

There is **no HTTP route serving the OpenAPI JSON** — `misc.ts:325` mounts Swagger UI at `/doc` and `misc.ts:329` writes the artifact to `open-api/immich-openapi-specs.json`. That checked-in file is what the TypeScript and Dart generators actually read, so it is the right thing to assert against. This belongs as a server unit test, not an e2e.

Create `server/src/dtos/game-scope-contract.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// vitest runs with cwd at server/ - same convention as game.repository.spec.ts.
const SPEC = join(process.cwd(), '../open-api/immich-openapi-specs.json');

describe('game challenge scope contract', () => {
  it('declares spaceId and ownerId as nullable so a solo challenge is representable', () => {
    // This checked-in file is the contract the Dart and TypeScript clients are GENERATED from.
    // A non-nullable spaceId here means the Dart model deserialises into a non-nullable String
    // and throws on a solo challenge - the server itself stays quiet, because response DTOs are
    // not validated on output. The failure lands in the client, far from the cause.
    const spec = JSON.parse(readFileSync(SPEC, 'utf8'));
    const challenge = spec.components.schemas.GameChallengeResponseDto;

    // zod-to-openapi emits a nullable string as `type: ['string', 'null']`.
    expect([challenge.properties.spaceId.type].flat(), 'spaceId must accept null for a solo challenge').toContain(
      'null',
    );
    expect([challenge.properties.ownerId.type].flat(), 'ownerId must accept null for a space challenge').toContain(
      'null',
    );
  });
});
```

If the emitted shape turns out to be `anyOf: [{type: 'string'}, {type: 'null'}]` rather than a type array, adjust the assertion to match what `pnpm sync:open-api` actually produces — but assert on nullability either way, never delete the test.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/dtos/game-scope-contract.spec.ts`
Expected: FAIL — `spaceId.type` is `"string"`, not `["string","null"]`.

- [ ] **Step 3: Write minimal implementation**

In `server/src/dtos/game.dto.ts`, inside `GameChallengeResponseSchema`:

```ts
    // Nullable because a challenge has exactly one scope: a space OR an owner, never both.
    // Response DTOs are not validated on output, so leaving this non-nullable would not fail on
    // the server - it would emit null against a schema promising a string, and break the
    // GENERATED clients instead. The Dart model would throw at deserialisation.
    spaceId: z.string().nullable().describe('Shared space ID, or null for a solo challenge'),
    ownerId: z.string().nullable().describe('Owning user ID, or null for a shared-space challenge'),
```

- [ ] **Step 4: Regenerate the clients**

```bash
cd server && pnpm build && pnpm sync:open-api
cd .. && make open-api
```

- [ ] **Step 5: Fix every call site the change breaks**

TypeScript surfaces the web ones. `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte:208` calls `Route.viewSpaceGames({ id: challenge.spaceId })` on the back button — that route only exists for a space challenge:

```svelte
  {#if challenge.spaceId}
    <Button onclick={() => void goto(Route.viewSpaceGames({ id: challenge.spaceId! }))}>
      {$t('back')}
    </Button>
  {/if}
```

Dart has no analyzer signal for this — the generated model simply changes shape. Grep for it:

```bash
grep -rn "\.spaceId" mobile/lib/pages/library/spaces/games/ mobile/lib/providers/game/ mobile/lib/repositories/game_api.repository.dart
```

Resolve each hit to handle a null.

- [ ] **Step 6: Run the checks**

Run: `cd server && pnpm test -- --run src/dtos/game-scope-contract.spec.ts`
Run: `cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts`
Run: `make check-web`
Run: `cd mobile && dart analyze --fatal-infos`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/game.dto.ts server/src/dtos/game-scope-contract.spec.ts open-api/ \
        web/src mobile/openapi mobile/lib
git commit -m "feat(game): make challenge scope nullable in the API contract

spaceId was a non-nullable string in the response schema. Response DTOs are
not validated on output, so a solo challenge would have emitted null against
that schema silently - and broken the generated Dart model at
deserialisation rather than failing on the server.

Adds ownerId alongside it, regenerates both clients, and branches the one
live non-null call site (the play page's back button)."
```

---

### Task 3: Extract the `ChallengePool` strategy, with `SpacePool` only

A pure refactor: behaviour must not change, and the existing game tests are the proof. Do this before `PersonalPool` exists so that any behavioural drift is attributable to the refactor alone.

**Files:**

- Create: `server/src/services/game/challenge-pool.ts`, `server/src/services/game/space-pool.ts`
- Modify: `server/src/services/game.service.ts`
- Test: `server/src/services/game/space-pool.spec.ts` (create)

**Interfaces:**

- Consumes: `GameRepository` methods unchanged.
- Produces:

```ts
export interface ChallengePool {
  seedKey(): Promise<string>;
  challengeCount(): Promise<number>;
  locationCandidates(limit: number, seed: string, scenePrompts?: ScenePromptEmbeddings): Promise<GameCandidate[]>;
  dateCandidates(limit: number, seed: string): Promise<GameCandidate[]>;
  resolveRoundAsset(assetId: string): Promise<{ previewPath: string } | undefined>;
  recentlyUsedAssetIds(lookback: number): Promise<string[]>;
  noRoundsMessage(type: GameChallengeType): string;
}
```

Task 4 implements the same interface as `PersonalPool`. Task 6 consumes `GameService.generateChallenge(pool, …)`.

- [ ] **Step 1: Write the failing test**

Create `server/src/services/game/space-pool.spec.ts`:

```ts
import { SpacePool } from 'src/services/game/space-pool';
import { describe, expect, it, vi } from 'vitest';

const repository = () =>
  ({
    getChallengesForSpace: vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]),
    getLocationCandidates: vi.fn().mockResolvedValue([]),
    getDateCandidates: vi.fn().mockResolvedValue([]),
    getEligibleRoundAsset: vi.fn().mockResolvedValue({ previewPath: '/p' }),
    getRecentlyUsedAssetIds: vi.fn().mockResolvedValue([]),
  }) as any;

describe(SpacePool.name, () => {
  it('keeps the exact seed key the space game already uses', async () => {
    // Byte-for-byte, not merely "some stable string": the seed drives which slice of a large
    // space the candidate queries return, so changing its shape silently re-rolls every future
    // challenge in every existing space.
    const pool = new SpacePool(repository(), 'space-1');
    expect(await pool.seedKey()).toBe('space-1');
    expect(await pool.challengeCount()).toBe(2);
  });

  it('phrases the no-rounds failure in terms of the space', async () => {
    const pool = new SpacePool(repository(), 'space-1');
    expect(pool.noRoundsMessage('location')).toContain('GPS');
    expect(pool.noRoundsMessage('location')).toContain('space');
    expect(pool.noRoundsMessage('date')).toContain('capture date');
  });

  it('scopes every repository call to its space', async () => {
    const repo = repository();
    const pool = new SpacePool(repo, 'space-1');

    await pool.locationCandidates(200, 'space-1:2');
    await pool.dateCandidates(200, 'space-1:2');
    await pool.resolveRoundAsset('asset-1');
    await pool.recentlyUsedAssetIds(3);

    expect(repo.getLocationCandidates).toHaveBeenCalledWith('space-1', 200, 'space-1:2', undefined);
    expect(repo.getDateCandidates).toHaveBeenCalledWith('space-1', 200, 'space-1:2');
    expect(repo.getEligibleRoundAsset).toHaveBeenCalledWith('space-1', 'asset-1');
    expect(repo.getRecentlyUsedAssetIds).toHaveBeenCalledWith('space-1', 3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && pnpm test -- --run src/services/game/space-pool.spec.ts`
Expected: FAIL — `Cannot find module 'src/services/game/space-pool'`.

- [ ] **Step 3: Write the interface and `SpacePool`**

Create `server/src/services/game/challenge-pool.ts` with the interface above plus re-exports of `GameCandidate` and `ScenePromptEmbeddings`.

Create `server/src/services/game/space-pool.ts`:

```ts
/**
 * The shared-space scope. Every method is a thin delegation to the space-scoped repository
 * queries, which is the point: this class exists so GameService stops naming a space, not to add
 * behaviour. Any logic that appears here should be examined for whether it belongs in the
 * scope-blind generator instead.
 */
export class SpacePool implements ChallengePool {
  constructor(
    private repository: GameRepository,
    private spaceId: string,
  ) {}

  // Byte-for-byte the string GameService.create built before this refactor. The seed decides
  // which slice of a large space the candidate queries return, so a different shape here silently
  // re-rolls every future challenge in every existing space.
  seedKey = async () => this.spaceId;

  challengeCount = async () => (await this.repository.getChallengesForSpace(this.spaceId))?.length ?? 0;

  locationCandidates = (limit: number, seed: string, scenePrompts?: ScenePromptEmbeddings) =>
    this.repository.getLocationCandidates(this.spaceId, limit, seed, scenePrompts);

  dateCandidates = (limit: number, seed: string) => this.repository.getDateCandidates(this.spaceId, limit, seed);

  resolveRoundAsset = (assetId: string) => this.repository.getEligibleRoundAsset(this.spaceId, assetId);

  recentlyUsedAssetIds = (lookback: number) => this.repository.getRecentlyUsedAssetIds(this.spaceId, lookback);

  noRoundsMessage = (type: GameChallengeType) => SPACE_NO_ROUNDS_MESSAGE[type];
}
```

Move the existing `NO_ROUNDS_MESSAGE` map from `game.service.ts` into this file as `SPACE_NO_ROUNDS_MESSAGE`, unchanged.

- [ ] **Step 4: Rewire `GameService` to take a pool**

Change `generateChallenge` to accept `pool: ChallengePool` instead of `spaceId: string`, replacing each `this.gameRepository.getXxx(spaceId, …)` with `pool.xxx(…)`. `GameService.create` builds `new SpacePool(this.gameRepository, spaceId)` and composes the seed as `` `${await pool.seedKey()}:${count}` ``. `getRoundImage` uses `pool.resolveRoundAsset`.

Do not change generation logic, ordering, or constants.

- [ ] **Step 5: Run the full game suite to verify no behaviour changed**

Run: `cd server && pnpm test -- --run src/services/game/space-pool.spec.ts src/services/game.service.spec.ts src/repositories/game.repository.spec.ts`
Run: `cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts src/specs/server/api/game-visibility-negatives.e2e-spec.ts`
Expected: all PASS with **no test edits**. Needing to change an existing assertion means the refactor changed behaviour — investigate rather than update the test.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/game/ server/src/services/game.service.ts
git commit -m "refactor(game): put candidate selection behind a ChallengePool strategy

GameService no longer names a shared space during generation. SpacePool is a
thin delegation to the existing space-scoped queries and keeps the seed key
byte-for-byte identical, so existing challenges reproduce exactly.

Pure refactor: the whole game suite passes unedited."
```

---

### Task 4: `PersonalPool` and the solo eligibility predicate

**Files:**

- Create: `server/src/utils/game-solo-eligibility.ts`, `server/src/services/game/personal-pool.ts`
- Modify: `server/src/repositories/game.repository.ts` (solo candidate queries)
- Test: `server/src/repositories/game.repository.spec.ts`, `e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts`

**Interfaces:**

- Consumes: `ChallengePool` (Task 3), `LOCATION_SAMPLE_SIZE` and `spaceAssetIdUnion` (perf-fixes plan).
- Produces: `eligibleSoloAsset(eb, { userId, withPartners, withSpaces })` and `PersonalPool`.

- [ ] **Step 1: Write the failing e2e tests**

Add to `e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts` a `describe('solo pool')` block covering the read arms. These are the cases where an upstream helper would admit the asset on its own:

```ts
describe('solo pool read arms', () => {
  let player: LoginResponseDto;
  let partner: LoginResponseDto;

  /**
   * Start a solo challenge as `player` with the given source toggles, asking for `roundCount`
   * rounds, and return the asset ids actually drawn. The generator returns a SHORTER challenge
   * rather than reaching for an ineligible photo, so asking for more rounds than there are
   * eligible photos is what makes an over-inclusive pool visible.
   */
  const soloAssetIds = async (
    roundCount: number,
    sources: { includePartners: boolean; includeSpaces: boolean },
  ): Promise<string[]> => {
    const created = await request(app)
      .post('/games/solo')
      .set('Authorization', `Bearer ${player.accessToken}`)
      .send({ roundCount, sources });
    expect(created.status).toBe(201);

    const detail = await request(app)
      .get(`/games/${created.body.id}`)
      .set('Authorization', `Bearer ${player.accessToken}`);
    for (const round of detail.body.rounds) {
      await request(app)
        .post(`/games/${created.body.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${player.accessToken}`)
        .send({ date: new Date('2020-01-01').toISOString() });
    }

    const played = await request(app)
      .get(`/games/${created.body.id}`)
      .set('Authorization', `Bearer ${player.accessToken}`);
    return played.body.rounds.map((round: { assetId: string }) => round.assetId);
  };

  it('never draws a partner asset when the partner is hidden from the timeline', async () => {
    // The partner arm must respect partner.inTimeline, matching timeline and search. The
    // access-layer checkPartnerAccess deliberately does NOT consult it, so composing from that
    // helper would silently widen the pool.
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine.png' } });
    const theirs = await utils.createAsset(partner.accessToken, { assetData: { filename: 'solo-partner.png' } });
    await utils.createPartner(partner.accessToken, player.userId);
    await updatePartner(
      { id: partner.userId, partnerUpdateDto: { inTimeline: false } },
      { headers: asBearerAuth(player.accessToken) },
    );

    const drawn = await soloAssetIds(2, { includePartners: true, includeSpaces: false });

    expect(drawn).toEqual([mine.id]);
    expect(drawn, 'the partner arm ignored partner.inTimeline').not.toContain(theirs.id);
  });

  it('never draws a partner asset whose visibility is hidden', async () => {
    // checkPartnerAccess admits `hidden`; the game's own floor must exclude it.
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine2.png' } });
    const theirs = await utils.createAsset(partner.accessToken, { assetData: { filename: 'solo-hidden.png' } });
    await utils.createPartner(partner.accessToken, player.userId);
    await updatePartner(
      { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
      { headers: asBearerAuth(player.accessToken) },
    );
    await updateAssets(
      { assetBulkUpdateDto: { ids: [theirs.id], visibility: AssetVisibility.Hidden } },
      { headers: asBearerAuth(partner.accessToken) },
    );

    const drawn = await soloAssetIds(2, { includePartners: true, includeSpaces: false });

    expect(drawn).toEqual([mine.id]);
  });

  it('never draws a locked asset from an album linked to a space the player belongs to', async () => {
    // spaceAlbumAssetExists is an arm the predicate DOES use, and it carries no visibility gate
    // of its own - the timeline floor is the only thing excluding this asset.
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine3.png' } });
    const { lockedId } = await spaceLinkedAlbumWithLockedAsset('solo-locked-album');

    const drawn = await soloAssetIds(2, { includePartners: false, includeSpaces: true });

    expect(drawn).toEqual([mine.id]);
    expect(drawn, 'a LOCKED asset reached the pool through the space-album arm').not.toContain(lockedId);
  });

  it('never draws an archived asset from a shared space', async () => {
    // spaceVisibilityGate admits `archive` by design.
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine4.png' } });
    const { archivedId } = await spaceWithArchivedAsset('solo-archived-space');

    const drawn = await soloAssetIds(2, { includePartners: false, includeSpaces: true });

    expect(drawn).toEqual([mine.id]);
    expect(drawn).not.toContain(archivedId);
  });

  it('never draws an asset shared with the player only through a shared album', async () => {
    // album_user is deliberately not a read arm at all - no composable predicate exists for it,
    // and no other listing surface in the product includes it.
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine5.png' } });
    const { sharedId } = await albumSharedWithPlayer('solo-shared-album');

    const drawn = await soloAssetIds(2, { includePartners: true, includeSpaces: true });

    expect(drawn).toEqual([mine.id]);
    expect(drawn, 'album_user became a read arm').not.toContain(sharedId);
  });

  it('draws own photos only when both source toggles are off', async () => {
    const mine = await utils.createAsset(player.accessToken, { assetData: { filename: 'solo-mine6.png' } });
    const theirs = await utils.createAsset(partner.accessToken, { assetData: { filename: 'solo-off.png' } });
    await utils.createPartner(partner.accessToken, player.userId);
    await updatePartner(
      { id: partner.userId, partnerUpdateDto: { inTimeline: true } },
      { headers: asBearerAuth(player.accessToken) },
    );

    const drawn = await soloAssetIds(2, { includePartners: false, includeSpaces: false });

    expect(drawn).toEqual([mine.id]);
    expect(drawn).not.toContain(theirs.id);
  });
});
```

Add the three fixture helpers (`spaceLinkedAlbumWithLockedAsset`, `spaceWithArchivedAsset`, `albumSharedWithPlayer`) in the same file, each creating a fresh space/album owned by a third user, adding `player` as a member, and setting the visibility via `updateAssets` as the asset owner — the pattern at `shared-space-visibility-negatives.e2e-spec.ts:96-106`.

**Import the partner and user operations from the SDK, not from `utils`.** `e2e/src/utils.ts` wraps only `createPartner` (line 678) and `updateMyPreferences` (line 681); there is **no** `utils.updatePartner`, `utils.removePartner`, `utils.deleteUser` or `utils.runJob`. Use the generated functions directly, the same way `shared-space-visibility-negatives.e2e-spec.ts` imports `updateAssets`:

```ts
import {
  AssetVisibility,
  LoginResponseDto,
  ManualJobName,
  createJob,
  deleteUserAdmin,
  removePartner,
  updateAssets,
  updatePartner,
} from '@immich/sdk';
import { app, asBearerAuth, utils } from 'src/utils';
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd e2e && pnpm test src/specs/server/api/game-visibility-negatives.e2e-spec.ts`
Expected: FAIL — `POST /games/solo` does not exist yet, so every case 404s. That is a legitimate red; the cases go green once Task 6 wires the route, and they are written here so the predicate is developed against them.

- [ ] **Step 3: Write the eligibility predicate**

Create `server/src/utils/game-solo-eligibility.ts`:

```ts
/**
 * Assets a user may be shown as a round, for the solo pool.
 *
 * The visibility floor is ANDed OUTSIDE the read-arm OR, and it is written here rather than
 * inherited, because every existing read helper admits a class the game must exclude:
 *   - spaceVisibilityGate  -> visibility IN (archive, timeline)   admits ARCHIVED
 *   - checkPartnerAccess   -> visibility IN (timeline, hidden)    admits HIDDEN
 *   - checkAlbumAccess     -> no visibility clause at all         admits LOCKED
 *
 * Shared albums (album_user) are NOT an arm. No composable predicate exists for them - the
 * authoritative definition of read access is an id-list checker, unusable as a WHERE clause - and
 * no other listing surface in the product includes them either.
 */
export const eligibleSoloAsset = (
  eb: ExpressionBuilder<DB, keyof DB>,
  { userId, withPartners, withSpaces }: { userId: string; withPartners: boolean; withSpaces: boolean },
): Expression<SqlBool> => {
  const arms: Expression<SqlBool>[] = [eb('asset.ownerId', '=', asUuid(userId))];

  if (withPartners) {
    // inTimeline is honoured, matching timeline and search rather than map: the user's per-partner
    // preference already expresses "show me their photos", and the game should not override it.
    arms.push(
      eb.exists(
        eb
          .selectFrom('partner')
          .select(sql`1`.as('one'))
          .whereRef('partner.sharedById', '=', 'asset.ownerId')
          .where('partner.sharedWithId', '=', asUuid(userId))
          .where('partner.inTimeline', '=', true),
      ),
    );
  }

  if (withSpaces) {
    arms.push(
      eb.or(
        spaceAssetPathBranches(eb, {
          correlateAssetId: 'asset.id',
          correlateLibraryId: 'asset.libraryId',
          scope: { memberUserId: userId },
          requireShowInTimeline: true,
        }),
      ),
    );
  }

  return eb.and([
    eb('asset.deletedAt', 'is', null),
    eb('asset.type', '=', AssetType.Image),
    // The single clause excluding archive, hidden and locked. Outside the OR, always.
    eb('asset.visibility', '=', AssetVisibility.Timeline),
    eb.or(arms),
  ]);
};
```

- [ ] **Step 4: Add the solo repository queries**

Add `getSoloLocationCandidates`, `getSoloDateCandidates`, `getSoloEligibleRoundAsset` and `getSoloRecentlyUsedAssetIds` to `GameRepository`, mirroring the two-stage shape from the perf-fixes plan with `eligibleSoloAsset` in place of the space union. Decorate each with `@GenerateSql` so it lands in the generated file and the shape guards can see it.

- [ ] **Step 5: Extend the SQL shape guards**

Add to `describe('generated query shape')` in `server/src/repositories/game.repository.spec.ts`:

```ts
it('keeps the solo pool behind the timeline visibility floor and off shared albums', () => {
  const sql = readGeneratedSql();

  for (const method of ['getSoloLocationCandidates', 'getSoloDateCandidates', 'getSoloEligibleRoundAsset']) {
    const block = queryBlock(sql, method).replaceAll(/\s+/g, ' ');

    expect(
      block,
      `GameRepository.${method} lost the timeline visibility floor. That single clause is what\n` +
        `excludes archived, hidden and LOCKED assets, and none of the read arms exclude them on\n` +
        `their own.`,
    ).toContain('"asset"."visibility" =');

    expect(
      block,
      `GameRepository.${method} references album_user. Shared albums are deliberately NOT a read\n` +
        `arm for the game pool - see design section 7.`,
    ).not.toContain('album_user');
  }
});

it('samples before ranking in the solo pool too', () => {
  const block = queryBlock(readGeneratedSql(), 'getSoloLocationCandidates').replaceAll(/\s+/g, ' ');
  const stageOne = block.slice(block.indexOf('with "sample"'), block.indexOf('from "sample"'));
  expect(block).toContain('with "sample"');
  expect(stageOne, 'stage 1 must not touch the vector column').not.toContain('smart_search');
});
```

- [ ] **Step 6: Write `PersonalPool`**

Create `server/src/services/game/personal-pool.ts` implementing `ChallengePool` against those four queries, with `seedKey = async () => \`user:${this.userId}\``and solo-phrased`noRoundsMessage` that mentions the source toggles as a remedy.

- [ ] **Step 7: Regenerate and run**

Run: `mise sql`
Run: `cd server && pnpm test -- --run src/repositories/game.repository.spec.ts src/services/game/`
Expected: PASS. The e2e cases from Step 1 stay red until Task 6.

- [ ] **Step 8: Measure the toggles-on case — spec open question 1**

Every performance figure in the spec is **own-library-only**, where `asset.ownerId` is indexed and stage 1 is a cheap index scan. With `withPartners` or `withSpaces` on, the arms become an `OR` that defeats that index, and stage 1 may regress to a full scan — the exact failure `SpacePool` already had to solve with `spaceAssetIdUnion`. The spec flags this as unmeasured; measure it here rather than shipping on an assumption.

Against a database with a real library, `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` the generated `getSoloLocationCandidates` block in all four combinations:

| `withPartners` | `withSpaces` | Buffers | Warm |
| -------------- | ------------ | ------- | ---- |
| false          | false        |         |      |
| true           | false        |         |      |
| false          | true         |         |      |
| true           | true         |         |      |

Baseline to beat: the own-only case measured at ~51,000 buffers and 117–154 ms.

If any combination shows a `Seq Scan on asset` feeding the sample CTE, or buffers climbing into the hundreds of thousands, restructure stage 1 as a `UNION` of the three id sources — own, partner, space — exactly as `spaceAssetIdUnion` does for a space, and re-measure. Record the final numbers in spec §4.3 and resolve open question 1.

- [ ] **Step 9: Commit**

```bash
git add server/src/utils/game-solo-eligibility.ts server/src/services/game/personal-pool.ts \
        server/src/repositories/game.repository.ts server/src/repositories/game.repository.spec.ts \
        server/src/queries/game.repository.sql e2e/src/specs/server/api/game-visibility-negatives.e2e-spec.ts
git commit -m "feat(game): add the personal candidate pool and its eligibility predicate

Own photos always, partner and shared-space photos behind frozen per-
challenge flags. Shared albums are not an arm: no composable predicate
exists for album_user and no other listing surface includes them.

The timeline visibility floor is written here rather than inherited, because
every existing read helper admits something the game must exclude -
spaceVisibilityGate admits archived, checkPartnerAccess admits hidden, and
checkAlbumAccess gates on nothing at all."
```

---

### Task 5: Game-specific API-key permissions

**Files:**

- Modify: `server/src/enum.ts`, `server/src/controllers/game.controller.ts`
- Test: `e2e/src/specs/server/api/api-key.e2e-spec.ts`

**Interfaces:**

- Produces: `Permission.GameRead`, `Permission.GameCreate`, `Permission.GameDelete`.

- [ ] **Step 1: Write the failing test**

```ts
it('lets a game-scoped API key play without shared-space permissions', async () => {
  const key = await utils.createApiKey(user.accessToken, [Permission.GameRead]);
  const { status } = await request(app).get('/api/games/solo/stats').set('x-api-key', key.secret);
  expect(status, 'a solo game must not require sharedSpace.read').toBe(200);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd e2e && pnpm test src/specs/server/api/api-key.e2e-spec.ts`
Expected: FAIL — `Permission.GameRead` does not exist.

- [ ] **Step 3: Add the permissions and apply them**

In `server/src/enum.ts`, after the `Faces` group and before `Integrity`, keeping alphabetical order:

```ts
  GameCreate = 'game.create',
  GameRead = 'game.read',
  GameDelete = 'game.delete',
```

Swap every `@Authenticated({ permission: Permission.SharedSpaceRead })` in `game.controller.ts` for `Permission.GameRead`, and `SharedSpaceUpdate` for `GameCreate` / `GameDelete` as appropriate. The membership and ownership checks stay in the service — the API-key scope and the ACL are different layers, and conflating them is what made a solo route need a shared-space permission.

- [ ] **Step 4: Run and commit**

Run: `cd e2e && pnpm test src/specs/server/api/api-key.e2e-spec.ts src/specs/server/api/game.e2e-spec.ts`

```bash
git add server/src/enum.ts server/src/controllers/game.controller.ts e2e/src/specs/server/api/api-key.e2e-spec.ts
git commit -m "feat(game): give the game its own API-key permissions

Every game route required sharedSpace.read, which is wrong for solo play.
Membership and ownership checks are unaffected - they live in the service."
```

---

### Task 6: Solo endpoints — free play and the daily

**Files:**

- Create: `server/src/controllers/game-solo.controller.ts`
- Modify: `server/src/services/game.service.ts`, `server/src/dtos/game.dto.ts`, `server/src/controllers/index.ts`
- Test: `e2e/src/specs/server/api/game-solo.e2e-spec.ts` (create)

**Interfaces:**

- Consumes: `PersonalPool` (Task 4), `Permission.Game*` (Task 5).
- Produces: `POST /games/solo`, `GET /games/solo/daily`, and `GameSoloCreateDto { roundCount?, type?, sources? }`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/src/specs/server/api/game-solo.e2e-spec.ts` covering, at minimum:

- a user with no spaces at all can create and play a solo challenge end to end;
- the daily is generated on first read and identical on a second read;
- two concurrent daily reads yield **one** challenge (the `(ownerId, dailyOn)` index);
- a user with zero eligible photos gets a scope-appropriate message, not a space one;
- `roundCount` larger than the available pool yields a shorter challenge, and the response reports the real count;
- an unguessed round leaks no coordinates, date, assetId, or filename.

- [ ] **Step 2: Run to verify they fail**

Run: `cd e2e && pnpm test src/specs/server/api/game-solo.e2e-spec.ts`
Expected: FAIL, 404 on every route.

- [ ] **Step 3: Implement**

Add `GameService.createSolo(auth, dto)` and `getSoloDaily(auth)` building a `PersonalPool` from the user's stored preference (Task 9; until then default both toggles to `false`), freezing `includePartners` / `includeSpaces` onto the row, and reusing `generateChallenge` unchanged. Catch the unique-violation on `game_challenge_owner_daily_uq` and re-read, exactly as the space daily already does for its own constraint.

Create the controller with `Permission.GameCreate` / `GameRead`.

- [ ] **Step 4: Run and commit**

Run: `cd e2e && pnpm test src/specs/server/api/game-solo.e2e-spec.ts src/specs/server/api/game-visibility-negatives.e2e-spec.ts`
Expected: PASS — including the solo read-arm cases written red back in Task 4.

```bash
git add server/src/controllers/game-solo.controller.ts server/src/controllers/index.ts \
        server/src/services/game.service.ts server/src/dtos/game.dto.ts \
        e2e/src/specs/server/api/game-solo.e2e-spec.ts
git commit -m "feat(game): add solo free play and the personal daily"
```

---

### Task 7: Ownership branching on the shared challenge routes

**Files:**

- Modify: `server/src/services/game.service.ts` (`get`, `guess`, `getRoundImage`, `leaderboard`, `delete`)
- Test: `e2e/src/specs/server/api/game-solo.e2e-spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('solo challenge authorization', () => {
  it("404s a stranger on every route of someone else's solo challenge", async () => {
    const challenge = await createSoloChallenge(alice);

    for (const call of [
      request(app).get(`/games/${challenge.id}`),
      request(app).post(`/games/${challenge.id}/rounds/0/guess`).send({ date: new Date().toISOString() }),
      request(app).get(`/games/${challenge.id}/rounds/0/image`),
      request(app).get(`/games/${challenge.id}/leaderboard`),
      request(app).delete(`/games/${challenge.id}`),
    ]) {
      const { status } = await call.set('Authorization', `Bearer ${bob.accessToken}`);
      // 404 and not 403: a 403 confirms the id exists, which is an enumeration leak the space
      // routes already avoid.
      expect(status).toBe(404);
    }
  });

  it('refuses to delete a solo daily, so the streak cannot be re-rolled', async () => {
    const daily = await readSoloDaily(alice);
    const { status } = await request(app)
      .delete(`/games/${daily.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — the routes currently resolve authorization through space membership only, so a solo challenge with a NULL `spaceId` takes an unintended branch.

- [ ] **Step 3: Implement the branch**

Add a private `requireChallengeAccess(auth, challenge)` to `GameService` that dispatches on scope: `spaceId` present → the existing membership check; `ownerId` present → `ownerId === auth.user.id` or `NotFoundException`. Route all five methods through it. Keep the existing daily-deletion refusal and apply it to both scopes.

- [ ] **Step 4: Run and commit**

Run: `cd e2e && pnpm test src/specs/server/api/game-solo.e2e-spec.ts src/specs/server/api/game.e2e-spec.ts`

```bash
git add server/src/services/game.service.ts e2e/src/specs/server/api/game-solo.e2e-spec.ts
git commit -m "feat(game): branch challenge authorization on scope

Space challenges gate on membership, solo challenges on ownership. A
stranger gets 404 rather than 403 - a 403 would confirm the id exists."
```

---

### Task 8: Stats and history

**Files:**

- Modify: `server/src/repositories/game.repository.ts`, `server/src/services/game.service.ts`, `server/src/dtos/game.dto.ts`, `server/src/controllers/game-solo.controller.ts`
- Test: `e2e/src/specs/server/api/game-solo.e2e-spec.ts`, `server/src/utils/game-streak.spec.ts` (create)

**Interfaces:**

- Produces: `GET /games/solo/stats` → `{ currentStreak, bestStreak, bestScore, averageScore, gamesPlayed }`; `GET /games/solo/history?page=&size=` → paged finished challenges.

- [ ] **Step 1: Write the failing streak unit test**

Streak arithmetic is pure and full of off-by-one traps, so it gets a unit test independent of the database. Create `server/src/utils/game-streak.spec.ts`:

```ts
describe('computeStreak', () => {
  it('returns zeroes when nothing has been played', () => {
    expect(computeStreak([], '2026-08-19')).toEqual({ current: 0, best: 0 });
  });

  it('counts consecutive UTC days ending today', () => {
    expect(computeStreak(['2026-08-17', '2026-08-18', '2026-08-19'], '2026-08-19')).toEqual({ current: 3, best: 3 });
  });

  it('keeps the current streak alive when today is not played yet but yesterday was', () => {
    expect(computeStreak(['2026-08-17', '2026-08-18'], '2026-08-19').current).toBe(2);
  });

  it('breaks the current streak after a missed day, but remembers the best', () => {
    expect(computeStreak(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-19'], '2026-08-19')).toEqual({
      current: 1,
      best: 3,
    });
  });

  it('crosses a month boundary', () => {
    expect(computeStreak(['2026-07-31', '2026-08-01'], '2026-08-01').current).toBe(2);
  });

  it('is unaffected by a duplicate date', () => {
    expect(computeStreak(['2026-08-18', '2026-08-18', '2026-08-19'], '2026-08-19').current).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/utils/game-streak.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeStreak` and the repository query**

The repository returns the **distinct `dailyOn` dates of fully completed solo dailies** — every round guessed. A partially played daily scores and appears in history but does not extend the streak; that asymmetry is deliberate and must be expressed in the SQL (`having count(guess) = challenge."roundCount"`), not in the client.

- [ ] **Step 4: Add the e2e coverage**

Cover: zero games returns zeroes rather than nulls; a partially played daily appears in history but does not extend the streak; history paging past the end returns an empty page rather than an error.

- [ ] **Step 5: Run and commit**

```bash
git add server/src/utils/game-streak.ts server/src/utils/game-streak.spec.ts \
        server/src/repositories/game.repository.ts server/src/services/game.service.ts \
        server/src/dtos/game.dto.ts server/src/controllers/game-solo.controller.ts \
        server/src/queries/game.repository.sql e2e/src/specs/server/api/game-solo.e2e-spec.ts
git commit -m "feat(game): add solo stats and history

A daily extends the streak only when every round is guessed. A partially
played daily still scores and still appears in history, so the two numbers
can legitimately disagree."
```

---

### Task 9: The source-toggle user preference

**Files:**

- Modify: `server/src/dtos/user-preferences.dto.ts`, `server/src/utils/preferences.ts`, `server/src/types.ts`
- Test: `server/src/utils/preferences.spec.ts`

**Interfaces:**

- Produces: `preferences.photoGuesser.includePartners` and `.includeSpaces`, both defaulting to `false`.

- [ ] **Step 1: Write the failing test**

```ts
it('defaults PhotoGuesser sources to own photos only', () => {
  // The daily is generated lazily on first read, so the server must know the toggles at that
  // moment. In browser local storage they would diverge per device and two devices would race to
  // generate different dailies, with the unique index picking a winner arbitrarily.
  expect(getPreferences({} as never).photoGuesser).toEqual({ includePartners: false, includeSpaces: false });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server && pnpm test -- --run src/utils/preferences.spec.ts`

- [ ] **Step 3: Implement**

Add the block to `getPreferences` in `preferences.ts` (alongside `sharedLinks`), the `photoGuesser` shape to `UserPreferences` in `types.ts`, and `PhotoGuesserUpdateSchema` / `PhotoGuesserResponseSchema` to `user-preferences.dto.ts` following the `SharedLinks` pair exactly.

- [ ] **Step 4: Regenerate the API and wire `GameService`**

Run `cd server && pnpm build && pnpm sync:open-api && cd .. && make open-api`, then have `createSolo` and `getSoloDaily` read the preference instead of the hardcoded `false` from Task 6.

- [ ] **Step 5: Run and commit**

```bash
git add server/src/dtos/user-preferences.dto.ts server/src/utils/preferences.ts server/src/types.ts \
        server/src/utils/preferences.spec.ts server/src/services/game.service.ts open-api/ mobile/openapi
git commit -m "feat(game): store the PhotoGuesser source toggles as a user preference

Server-side rather than per-device: the daily is generated lazily on first
read, so two devices with different local settings would race to generate
different dailies."
```

---

### Task 10: Prune never-played challenges

**Files:**

- Modify: `server/src/enum.ts` (`JobName`), `server/src/services/queue.service.ts:299-314`, `server/src/services/game.service.ts`
- Test: `server/src/services/game.service.spec.ts`, `server/src/services/queue.service.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('queues the game cleanup with the other database-cleanup jobs', async () => {
  mocks.systemMetadata.get.mockResolvedValue({ nightlyTasks: { databaseCleanup: true } });
  await sut.handleNightlyJobs();
  expect(mocks.job.queueAll).toHaveBeenCalledWith(expect.arrayContaining([{ name: JobName.GameChallengeCleanup }]));
});

it('does not queue the game cleanup when database cleanup is disabled', async () => {
  mocks.systemMetadata.get.mockResolvedValue({ nightlyTasks: { databaseCleanup: false } });
  await sut.handleNightlyJobs();
  expect(mocks.job.queueAll).not.toHaveBeenCalledWith(expect.arrayContaining([{ name: JobName.GameChallengeCleanup }]));
});
```

Plus, in `game.service.spec.ts`, that the handler deletes only challenges with **zero guesses** older than 7 days — a partially played challenge must survive, because pruning it would silently rewrite history and stats the player has already seen.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server && pnpm test -- --run src/services/queue.service.spec.ts src/services/game.service.spec.ts`

- [ ] **Step 3: Implement**

Add `JobName.GameChallengeCleanup`, push it into the `config.nightlyTasks.databaseCleanup` block in `handleNightlyJobs` next to `MemoryCleanup`, and add an `@OnJob({ name: JobName.GameChallengeCleanup, queue: QueueName.BackgroundTask })` handler following `memory.service.ts:196`. The prune covers **both** scopes — an unopened space daily is as much dead weight as a solo one.

- [ ] **Step 4: Run and commit**

```bash
git add server/src/enum.ts server/src/services/queue.service.ts server/src/services/game.service.ts \
        server/src/services/queue.service.spec.ts server/src/services/game.service.spec.ts
git commit -m "feat(game): prune challenges nobody ever played

Zero guesses and older than 7 days, both scopes. Deliberately not 'not
finished': a partially played game still contributes to history and stats."
```

---

### Task 11: i18n keys in all nine locales

**Files:** `i18n/en.json` plus `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`.

- [ ] **Step 1: Add the English keys**

Keys for: stats labels (current streak, best streak, best score, average, games played), history, the two source toggles and their descriptions, free play, start game, play again, and the empty states.

**`photoguesser` as a name is never translated** — where a string embeds the product name, the name stays `PhotoGuesser` in every file.

- [ ] **Step 2: Translate into the other eight**

Match each file's existing register: `de` / `it` / `es` address the user informally (`du` / `tu` / `tú`), `fr` / `ru` formally (`vous` / `вы`). Reuse the word each file already uses for a concept rather than inventing a synonym — look up the nearest existing key first.

- [ ] **Step 3: Format and verify**

```bash
npx prettier --write i18n/*.json
git diff --stat i18n/
```

Expected: exactly ten files changed, with the same number of added keys in each.

- [ ] **Step 4: Commit**

```bash
git add i18n/
git commit -m "feat(i18n): add the PhotoGuesser strings

PhotoGuesser is a proper noun and stays untranslated in all nine locales, so
the docs slug, marketing page, app copy and URL agree."
```

---

### Task 12: Web — extract the play loop

A pure refactor of the space play page, done before the solo page exists so drift is attributable.

**Files:**

- Create: `web/src/lib/components/games/game-play.svelte`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/[challengeId=id]/+page.svelte`
- Test: existing `game-play-page.spec.ts` must pass **unedited**

- [ ] **Step 1: Extract, keeping the space page's behaviour identical**

`game-play.svelte` owns round rendering, guess submission, and progress; the end-of-game panel is a snippet prop so the space route passes a leaderboard and the solo route (Task 13) passes a score summary.

- [ ] **Step 2: Run the existing suite**

Run: `cd web && pnpm test -- --run spaces/.*games`
Expected: PASS with no test edits. Needing an edit means behaviour changed.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/components/games/game-play.svelte "web/src/routes/(user)/spaces"
git commit -m "refactor(web): extract the game play loop from the space route

The end-of-game panel becomes a snippet so solo can pass a score summary
where the space passes a leaderboard. Existing tests pass unedited."
```

---

### Task 13: Web — the PhotoGuesser surface

**Files:**

- Create: `web/src/routes/(user)/photoguesser/+page.svelte`, `+page.ts`, `[challengeId=id]/+page.svelte`, `[challengeId=id]/+page.ts`, `web/src/lib/components/games/solo-stats.svelte`, `solo-history.svelte`
- Modify: `web/src/lib/route.ts`, `web/src/lib/components/shared-components/side-bar/UserSidebar.svelte`
- Test: co-located `.spec.ts` for each new component and page load

- [ ] **Step 1: Write the failing tests**

Cover: the sidebar row renders between Map and People and links to `/photoguesser`; the landing page shows the daily card, a start-free-play control, stats, and history; stats renders zeroes rather than blanks for a new user; **the play route 404s a space challenge id** and vice versa.

Use `getBy*` for presence — `queryBy*` passes whether or not the element exists, which makes the assertion untestable. This suite does **not** clear mocks between tests, so reset any shared mock inside each test that depends on call counts.

- [ ] **Step 2: Run to verify they fail**

Run: `cd web && pnpm test -- --run photoguesser`

- [ ] **Step 3: Implement**

Add `Route.photoGuesser()` and `Route.viewPhotoGuesserGame({ challengeId })`; add the `SidebarNavItem` after Map using `mdiMapMarkerQuestionOutline` / `mdiMapMarkerQuestion`; build the landing and play routes on `game-play.svelte`.

- [ ] **Step 4: Run the checks and commit**

Run: `cd web && pnpm test -- --run photoguesser games/`
Run: `make check-web`

```bash
git add web/src
git commit -m "feat(web): add the PhotoGuesser surface

Top-level sidebar entry, landing page with the daily, free play, stats and
history, and a play route reusing the extracted play loop. A cross-scope
challenge id 404s rather than silently redirecting."
```

---

### Task 14: Mobile — the PhotoGuesser surface

**Files:**

- Create: `mobile/lib/pages/games/photo_guesser.page.dart`, `mobile/lib/providers/game/solo_game.provider.dart`, `mobile/lib/repositories/solo_game_api.repository.dart`
- Move: `mobile/lib/pages/library/spaces/games/game_play.page.dart` → `mobile/lib/pages/games/game_play.page.dart`
- Modify: `mobile/lib/routing/router.dart`, `mobile/lib/presentation/pages/drift_library.page.dart`
- Test: `mobile/test/pages/photo_guesser_page_test.dart`

- [ ] **Step 1: Generate the prerequisites**

```bash
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
```

Use the Flutter version pinned in `mobile/mise.toml`. `dart analyze` is **not** a substitute for `flutter test` — generated-code compile errors only surface when a test actually compiles.

- [ ] **Step 2: Write the failing widget test**

Cover: the Library page shows a PhotoGuesser card that routes to the new page; the landing page shows the daily and a free-play control; a user with no spaces still sees the full surface. Prove each red by flipping the condition under test before implementing.

- [ ] **Step 3: Run, implement, re-run**

Run: `flutter test test/pages/photo_guesser_page_test.dart`

- [ ] **Step 4: Commit**

```bash
git add mobile/lib mobile/test
git commit -m "feat(mobile): add the PhotoGuesser surface

game_play.page.dart moves out of the spaces tree - it is no longer
space-only."
```

---

### Task 15: Mobile — stop one daily suppressing the other's reminder

`recordDailyCompleted` writes a **single** `gameDailyLastPlayed`, and `dailyReminderOccurrences` skips any day matching it. With a personal daily added, finishing a space daily would suppress the reminder for an unplayed solo daily and vice versa — costing the player a streak they were never reminded to defend.

**Files:**

- Modify: `mobile/lib/utils/daily_reminder_schedule.dart`, `mobile/lib/providers/game/daily_reminder.provider.dart`, `mobile/lib/domain/models/config/games_config.dart`, `mobile/lib/domain/models/settings_key.dart`
- Test: `mobile/test/utils/daily_reminder_schedule_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
test('still reminds when the space daily is played but the solo daily is not', () {
  // One global lastPlayed date meant either daily suppressed the other. The streak is computed
  // server-side per scope, so the player loses a streak they were never reminded to defend.
  final occurrences = dailyReminderOccurrences(
    now: DateTime(2026, 8, 19, 9),
    minuteOfDay: 18 * 60,
    enabled: true,
    permissionGranted: true,
    hasOptedInSpace: true,
    soloDailyEnabled: true,
    spaceLastPlayed: '2026-08-19',
    soloLastPlayed: null,
  );
  expect(occurrences.first.day, 19);
});

test('skips the day only when every enabled source is played', () {
  final occurrences = dailyReminderOccurrences(
    now: DateTime(2026, 8, 19, 9),
    minuteOfDay: 18 * 60,
    enabled: true,
    permissionGranted: true,
    hasOptedInSpace: true,
    soloDailyEnabled: true,
    spaceLastPlayed: '2026-08-19',
    soloLastPlayed: '2026-08-19',
  );
  expect(occurrences.first.day, 20);
});

test('reminds a user with no spaces at all, when the solo daily is on', () {
  // Today hasOptedInSpace gates everything, so these users can never be reminded.
  final occurrences = dailyReminderOccurrences(
    now: DateTime(2026, 8, 19, 9),
    minuteOfDay: 18 * 60,
    enabled: true,
    permissionGranted: true,
    hasOptedInSpace: false,
    soloDailyEnabled: true,
    spaceLastPlayed: null,
    soloLastPlayed: null,
  );
  expect(occurrences, isNotEmpty);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd mobile && flutter test test/utils/daily_reminder_schedule_test.dart`
Expected: FAIL — the function takes `hasOptedInSpace` and a single `lastPlayedDate`.

- [ ] **Step 3: Implement**

Split `lastPlayedDate` into `spaceLastPlayed` and `soloLastPlayed`, split `SettingsKey.gameDailyLastPlayed` into two keys, gate on `hasOptedInSpace || soloDailyEnabled`, and skip a day only when every enabled source is played for it. Keep the existing per-space behaviour on the space side: still not a per-space map, because reading a space daily generates it as a side effect.

Update the existing tests in the file that pass `hasOptedInSpace` / `lastPlayedDate`, and route a tapped notification to the solo daily when enabled.

- [ ] **Step 4: Run and commit**

Run: `cd mobile && flutter test test/utils/ test/providers/game/`
Run: `cd mobile && dart analyze --fatal-infos && dart format --set-exit-if-changed .`

```bash
git add mobile/lib mobile/test
git commit -m "fix(mobile): stop one daily suppressing the other's reminder

One global gameDailyLastPlayed meant finishing a space daily silently
suppressed the solo daily's reminder, costing a streak the player was never
reminded to defend. Also un-gates the reminder for users with no spaces,
who could never receive one before."
```

---

### Task 16: Full solo playthrough, and the remaining edge cases

**Files:** `e2e/src/specs/server/api/game-solo.e2e-spec.ts`

- [ ] **Step 1: Write the walkthrough**

Extend `e2e/src/specs/server/api/game-solo.e2e-spec.ts` with `start -> detail -> round image -> guess every round -> stats -> history`, asserting the daily appears in history, the streak reaches 1, and the round image serves without disclosing the asset id or filename.

- [ ] **Step 2: Cover the edge cases no earlier task claimed**

Spec §14.3 lists fifteen cases. Eleven are covered by Tasks 1, 4, 6, 7 and 8. These five have no home yet, and each is a real behaviour someone will hit:

```ts
it('handles a library smaller than the 4,000-row sample', async () => {
  // Stage 1's LIMIT is an upper bound, not a target. A three-photo library must produce a
  // three-round challenge, not an empty one.
  const drawn = await soloAssetIds(3, { includePartners: false, includeSpaces: false });
  expect(drawn).toHaveLength(3);
});

it('lets the request body override the stored source preference for one game', async () => {
  // The preference drives the DAILY, which is generated lazily server-side. Free play may
  // override per game, and doing so must not mutate the preference - otherwise starting one
  // wide game silently rewrites every future daily.
  await utils.updateMyPreferences(player.accessToken, {
    photoGuesser: { includePartners: false, includeSpaces: false },
  });

  await soloAssetIds(2, { includePartners: true, includeSpaces: false });

  const after = await getMyPreferences(player);
  expect(after.photoGuesser.includePartners, 'free play mutated the stored preference').toBe(false);
});

it('keeps a round scoreable after the partner revokes sharing mid-game', async () => {
  // Frozen flags keep the challenge coherent, but the round IMAGE must re-resolve eligibility
  // live - the photo is genuinely no longer readable. Same contract the space game has for a
  // photo removed from a space: the round survives its photo.
  const { challengeId, roundIndex } = await startSoloGameOverPartnerPhoto();
  await removePartner({ id: player.userId }, { headers: asBearerAuth(partner.accessToken) });

  const image = await request(app)
    .get(`/games/${challengeId}/rounds/${roundIndex}/image`)
    .set('Authorization', `Bearer ${player.accessToken}`);
  expect(image.status).toBe(404);

  const guess = await request(app)
    .post(`/games/${challengeId}/rounds/${roundIndex}/guess`)
    .set('Authorization', `Bearer ${player.accessToken}`)
    .send({ date: new Date('2020-01-01').toISOString() });
  expect(guess.status, 'the round must stay scoreable from its frozen answer').toBe(201);
});

it('keeps a daily keyed to its own dailyOn when play crosses UTC midnight', async () => {
  // dailyOn is frozen at generation. A game started at 23:58 UTC and finished at 00:03 counts
  // for the day it was GENERATED for, not the day it was finished - otherwise the streak
  // silently skips a day for anyone who plays late.
  const daily = await readSoloDaily(player);
  expect(daily.dailyOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await playEveryRound(player, daily.id);
  const stats = await readSoloStats(player);
  expect(stats.currentStreak).toBe(1);

  const again = await readSoloDaily(player);
  expect(again.challenge.id, 'the daily must not re-roll').toBe(daily.id);
});

it('removes a solo challenge, its rounds and its guesses when the owner is deleted', async () => {
  // ownerId is ON DELETE CASCADE, unlike createdById which is SET NULL so that deleting one
  // member cannot destroy a shared space's challenges.
  const doomed = await utils.userSetup(admin.accessToken, createUserDto.create('solo-doomed'));
  const challenge = await createSoloChallenge(doomed);

  await deleteUserAdmin(
    { id: doomed.userId, userAdminDeleteDto: { force: true } },
    { headers: asBearerAuth(admin.accessToken) },
  );
  await createJob({ jobCreateDto: { name: ManualJobName.UserCleanup } }, { headers: asBearerAuth(admin.accessToken) });
  await utils.waitForQueueFinish(admin.accessToken, 'backgroundTask');

  const { status } = await request(app)
    .get(`/games/${challenge.id}`)
    .set('Authorization', `Bearer ${admin.accessToken}`);
  expect(status).toBe(404);
});
```

The cross-scope 404 is covered on the web side in Task 13; assert it server-side here too, since the route is what actually enforces it:

```ts
it('404s a space challenge id on a solo route and vice versa', async () => {
  const spaceChallenge = await createSpaceChallenge();
  const solo = await createSoloChallenge(player);

  // A solo challenge is not a space challenge, whatever the URL claims.
  const asSpace = await request(app)
    .get(`/shared-spaces/${spaceId}/games`)
    .set('Authorization', `Bearer ${player.accessToken}`);
  expect(asSpace.body.map((c: { id: string }) => c.id)).not.toContain(solo.id);

  const inHistory = await request(app).get('/games/solo/history').set('Authorization', `Bearer ${player.accessToken}`);
  expect(
    inHistory.body.items.map((c: { id: string }) => c.id),
    'a space challenge leaked into solo history',
  ).not.toContain(spaceChallenge.id);
});
```

- [ ] **Step 3: Run the whole game surface**

```bash
cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts \
                    src/specs/server/api/game-solo.e2e-spec.ts \
                    src/specs/server/api/game-visibility-negatives.e2e-spec.ts
```

- [ ] **Step 4: Commit**

```bash
git add e2e/src/specs/server/api/game-solo.e2e-spec.ts
git commit -m "test(game): cover a full solo playthrough end to end"
```

---

## Done when

- [ ] `cd server && pnpm test -- --run src/services/game src/repositories/game.repository.spec.ts src/utils/game-streak.spec.ts src/utils/preferences.spec.ts` passes
- [ ] `cd server && pnpm test:medium -- --run test/medium/specs/migrations/game-challenge-scope.migration.spec.ts` passes
- [ ] `cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts src/specs/server/api/game-solo.e2e-spec.ts src/specs/server/api/game-visibility-negatives.e2e-spec.ts` passes
- [ ] `cd web && pnpm test -- --run photoguesser games/` passes
- [ ] `cd mobile && flutter test` passes, and `dart analyze --fatal-infos` and `dart format --set-exit-if-changed .` are clean
- [ ] `make check-all` and `make lint-all` pass
- [ ] Ten i18n files changed with matching key counts
- [ ] The server boots against a migrated database with no schema-drift warning
- [ ] A user in **no** shared space can reach PhotoGuesser, play the daily, and see a streak of 1 — on both web and mobile

## Follow-up, not in this plan

The README's upstream-comparison section and the marketing site need a PhotoGuesser entry in seven locales via the `launch-new-feature` flow, and `docs/docs/features/` needs a page. That is launch work; it is real, and it is the step that tends to get forgotten.
