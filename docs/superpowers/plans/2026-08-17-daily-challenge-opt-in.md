# Daily Challenge Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the daily challenge opt-in per shared space — prompt an editor on first visit to a space's Challenges page, and let them turn it off and on again afterwards.

**Architecture:** One nullable boolean on `shared_space` carries three states (`null` never asked, `true` on, `false` declined). The write path reuses the existing `PUT /shared-spaces/:id` endpoint, whose per-field role escalation already defaults to Editor. `GameService.getDaily` gains a guard ahead of the lookup, because the lookup is what generates the daily. The web page reads the setting from the space it already loads and renders one of three things where the daily card goes.

**Tech Stack:** NestJS 11, Kysely, `@immich/sql-tools`, Zod DTOs, SvelteKit + Svelte 5 runes, `@immich/ui`, Vitest, Playwright/supertest e2e.

**Spec:** `docs/superpowers/specs/2026-08-17-daily-challenge-opt-in-design.md`

## Global Constraints

- **Scoped test commands differ per package.** `server/` and `web/`: `pnpm test --run <path>`. **`e2e/`: `pnpm test <path>`** — that package's `test` script is already `vitest --run`, so adding `--run` dies with `Expected a single value for option "--run"`. Never use `pnpm test -- --run <path>`; the `--` makes pnpm swallow the path filter and silently run the whole suite green.
- **Read the `Test Files` line, never the exit code.** A medium-test run without `packages/sdk/dist` built exits 0 with mass collection failures. Build it first: `cd packages/sdk && pnpm build`.
- **`dailyChallengeEnabled` must NEVER be added to `isOwnerOnlySettingsUpdate`** in `shared-space.service.ts`. Leaving it out is what makes the setting editor-writable.
- **`dailyChallengeEnabled` must NEVER be mapped with `?? true`.** The two lines above it in `mapSpace` use that idiom legitimately; copying it collapses `null` into `true` and makes the prompt unreachable. `tsc` cannot catch this.
- Every test must be able to fail. No assertion that passes on an empty array, and none that is subsumed by a stronger assertion directly above it.
- eslint (`--max-warnings 0`) and prettier are **separate** CI gates; passing one does not imply the other.
- i18n: all ten maintained locales (`en de fr it nl pl es ru zh_Hans zh_Hant`) in the **same commit**, keys inserted in alphabetical position, then `npx prettier --write i18n/*.json`.
- Commit messages carry no `Co-Authored-By` and no "Generated with" trailer.

---

### Task 1: Schema column and migration

**Files:**

- Modify: `server/src/schema/tables/shared-space.table.ts:77-78`
- Create: `server/src/schema/migrations-gallery/1793000000000-AddSpaceDailyChallengeEnabled.ts`
- Modify: `server/src/database.ts:288` — **`SharedSpace` there is a HAND-WRITTEN type**, not
  `Selectable<SharedSpaceTable>`, so a new column does not reach it automatically. Several row types in
  that file are hand-maintained the same way; adding a column to any of their tables means editing both.
- Modify: `server/test/small.factory.ts:401` — returns `SharedSpace`, so it cannot compile until the
  line above is done

**Interfaces:**

- Produces: `SharedSpaceTable.dailyChallengeEnabled: boolean | null`, read by every later task. `getById` uses `selectAll()`, so no repository change is needed anywhere.

- [ ] **Step 1: Add the column to the table definition**

In `server/src/schema/tables/shared-space.table.ts`, directly after the `petsEnabled` column:

```ts
  // Tri-state on purpose: null = nobody has been asked yet, true = on, false = an editor declined.
  // A `default` here would erase the distinction between "never asked" and "said no", which is the
  // only thing that makes the first-visit prompt appear exactly once.
  @Column({ type: 'boolean', nullable: true })
  dailyChallengeEnabled!: boolean | null;
```

- [ ] **Step 2: Write the migration**

Create `server/src/schema/migrations-gallery/1793000000000-AddSpaceDailyChallengeEnabled.ts`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Nullable with no default: null means "no editor has been asked whether this space wants a daily
  // challenge yet", which is what the Challenges page keys its one-time prompt off.
  await sql`ALTER TABLE "shared_space" ADD COLUMN "dailyChallengeEnabled" boolean`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`ALTER TABLE "shared_space" DROP COLUMN IF EXISTS "dailyChallengeEnabled"`.execute(db);
}
```

No `migration_overrides` row: this is a plain column with no index and no expression, so the
declarative schema expresses it completely. (Contrast `1792000000000`, whose partial unique index
needed one and drifted on every boot without it.)

- [ ] **Step 3: Update the test factory**

`server/test/small.factory.ts` builds a complete `SharedSpace`, so tsc fails until the new column is
present. Add after `petsEnabled: true,`:

```ts
  dailyChallengeEnabled: null,
```

`null` rather than `true`: a freshly built space in a test should be in the same un-asked state a
freshly created real space is in.

- [ ] **Step 4: Build the SDK so medium tests can run**

```bash
cd packages/sdk && pnpm build
```

- [ ] **Step 5: Run the schema-drift medium test**

```bash
cd server && pnpm test:medium --run test/medium/specs/schema-drift.spec.ts
```

Expected: `Test Files 1 passed (1)`. Read that line — an exit code of 0 with collection failures is
not a pass. A drift report naming `dailyChallengeEnabled` means the column definition and the
migration disagree; fix the migration to match the decorator, not the other way round.

- [ ] **Step 6: Typecheck**

```bash
cd server && pnpm check
```

Expected: clean. If `small.factory.ts` still errors, Step 3 was skipped.

- [ ] **Step 7: Commit**

```bash
git add server/src/schema/tables/shared-space.table.ts server/src/schema/migrations-gallery/1793000000000-AddSpaceDailyChallengeEnabled.ts server/test/small.factory.ts
git commit -m "feat(spaces): add a tri-state daily challenge setting column"
```

---

### Task 2: Expose the setting through the space API

**Files:**

- Modify: `server/src/dtos/shared-space.dto.ts:30` (update DTO) and `:94` (response DTO)
- Modify: `server/src/services/shared-space.service.ts:327` (payload), `:3540-3558` (`mapSpace`)
- Test: `server/src/services/shared-space.service.spec.ts`

**Interfaces:**

- Consumes: `SharedSpaceTable.dailyChallengeEnabled` from Task 1.
- Produces: `SharedSpaceUpdateDto.dailyChallengeEnabled?: boolean` and
  `SharedSpaceResponseDto.dailyChallengeEnabled?: boolean | null`. Task 3 regenerates clients from
  these; Tasks 7 and 8 read the response field; Task 4 reads the column directly.

- [ ] **Step 1: Write the failing tests**

Append to the `update` describe block in `server/src/services/shared-space.service.spec.ts`:

```ts
it('lets an EDITOR turn the daily challenge on', async () => {
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1' }));
  mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);
  mocks.sharedSpace.update.mockResolvedValue(factory.sharedSpace({ id: 'space-1', dailyChallengeEnabled: true }));

  await sut.update(authStub, 'space-1', { dailyChallengeEnabled: true });

  expect(mocks.sharedSpace.update).toHaveBeenCalledWith('space-1', { dailyChallengeEnabled: true });
});

it('still requires OWNER when the daily setting is sent alongside an owner-only one', async () => {
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1' }));
  mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Editor } as any);

  // Mixed payload: adding a field beside petsEnabled must not lower the bar for petsEnabled.
  await expect(sut.update(authStub, 'space-1', { dailyChallengeEnabled: true, petsEnabled: false })).rejects.toThrow(
    ForbiddenException,
  );
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
});

it('rejects a VIEWER turning the daily challenge on', async () => {
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1' }));
  mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Viewer } as any);

  await expect(sut.update(authStub, 'space-1', { dailyChallengeEnabled: true })).rejects.toThrow(ForbiddenException);
  expect(mocks.sharedSpace.update).not.toHaveBeenCalled();
});

it('maps a never-asked space to null rather than defaulting it on', async () => {
  // The two lines above this field in mapSpace use `?? true` because their columns default to true.
  // Copying that idiom here would opt every space in and the first-visit prompt would never render.
  // tsc cannot see that mistake, so this test is the only thing guarding it.
  mocks.sharedSpace.getById.mockResolvedValue(factory.sharedSpace({ id: 'space-1', dailyChallengeEnabled: null }));
  mocks.sharedSpace.getMember.mockResolvedValue({ role: SharedSpaceRole.Owner, lastViewedAt: null } as any);
  mocks.sharedSpace.getMembers.mockResolvedValue([]);
  mocks.sharedSpace.getAssetCount.mockResolvedValue(0);
  mocks.sharedSpace.getRecentAssets.mockResolvedValue([]);

  const result = await sut.get(authStub, 'space-1');

  expect(result.dailyChallengeEnabled).toBeNull();
});
```

- [ ] **Step 2: Run them to verify they fail**

```bash
cd server && pnpm test --run src/services/shared-space.service.spec.ts
```

Expected: the first two fail (the DTO has no such field, so tsc/vitest reject the payload), the third
fails with `undefined` rather than `null`.

- [ ] **Step 3: Add the DTO fields**

In `server/src/dtos/shared-space.dto.ts`, after the `petsEnabled` line in the **update** schema (`:30`):

```ts
    dailyChallengeEnabled: z.boolean().optional().describe('Enable the daily challenge for this space'),
```

and after `petsEnabled` in the **response** schema (`:94`):

```ts
    dailyChallengeEnabled: z
      .boolean()
      .nullable()
      .optional()
      .describe('Whether the daily challenge is enabled; null when nobody has been asked yet'),
```

`nullable` on the response is load-bearing — `null` is the state the prompt keys off.

- [ ] **Step 4: Accept the field in the update payload**

In `server/src/services/shared-space.service.ts`, after the `petsEnabled` block (`:327`):

```ts
if (dto.dailyChallengeEnabled !== undefined) {
  updatePayload.dailyChallengeEnabled = dto.dailyChallengeEnabled;
}
```

Do **not** touch `isOwnerOnlySettingsUpdate` on line 287. The default minimum role is already Editor;
adding this field there would silently make the whole feature owner-only.

- [ ] **Step 5: Map it out, without the `??` idiom**

In `mapSpace`, add to the inline parameter type beside `petsEnabled?: boolean;`:

```ts
    dailyChallengeEnabled?: boolean | null;
```

and to the returned object, after the `petsEnabled` line:

```ts
      // NOT `?? true`, unlike the two lines above: their columns default to true, this one is
      // tri-state and null is a meaningful value the web page branches on.
      dailyChallengeEnabled: space.dailyChallengeEnabled ?? null,
```

- [ ] **Step 6: Run the tests**

```bash
cd server && pnpm test --run src/services/shared-space.service.spec.ts
```

Expected: PASS, including every pre-existing test in the file. If pre-existing assertions now fail on
an unexpected `dailyChallengeEnabled: null` key, they are whole-object `toEqual`s — extend them with
the new field rather than loosening them to `objectContaining`.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/shared-space.dto.ts server/src/services/shared-space.service.ts server/src/services/shared-space.service.spec.ts
git commit -m "feat(spaces): let editors read and write the daily challenge setting"
```

---

### Task 3: Regenerate the API spec and clients

**Files:**

- Modify (generated): `open-api/immich-openapi-specs.json`, `packages/sdk/src/fetch-client.ts`, `mobile/openapi/**`

**Interfaces:**

- Consumes: the DTO changes from Task 2.
- Produces: `dailyChallengeEnabled` on the SDK's `SharedSpaceResponseDto` and `SharedSpaceUpdateDto`, which Tasks 7 and 8 import.

- [ ] **Step 1: Build the server and sync the spec**

```bash
cd server && pnpm build && node ./dist/bin/sync-open-api.js
```

Run the steps by hand like this rather than `mise open-api`: from a worktree that task's `//server:*`
prerequisites resolve against the MAIN checkout and would regenerate from the wrong source.

- [ ] **Step 2: Regenerate the TypeScript SDK**

Use the **canonical flag set**, copied from `mise.toml`'s `[tasks.open-api-typescript]` (the source of
truth) — not a bare `oazapfts --optimistic`:

```bash
cd .. && npx oazapfts --optimistic --argumentStyle=object --useEnumType --allSchemas open-api/immich-openapi-specs.json packages/sdk/src/fetch-client.ts
```

**All three extra flags are load-bearing.** Dropping `--useEnumType` alone re-emits every enum in the
SDK as an inline string-literal union instead of a TS `enum` — a ~2,700-line diff that compiles but
breaks every `SomeEnum.Member` reference in `web/` and `mobile/`. The correct regen for a single added
field is a handful of lines; if your diff is thousands, you used the wrong flags, so check the diff size
before committing rather than after.

- [ ] **Step 3: Regenerate the Dart client**

```bash
cd open-api && bash ./bin/generate-dart-sdk.sh
```

Needs Java (JDK 21 works). Dart model files show as `Bin N -> M bytes` with no textual diff because
`.gitattributes` marks them `-diff`; verify content with grep, not `git diff`:

```bash
grep -rl "dailyChallengeEnabled" mobile/openapi/lib/model/ | head
```

- [ ] **Step 4: Confirm the field reached the SDK**

```bash
grep -n "dailyChallengeEnabled" packages/sdk/src/fetch-client.ts
```

Expected: two hits (update and response types).

- [ ] **Step 5: Verify the regen is stable**

Run Steps 1-3 again. A correct run is byte-identical to what you just produced; a diff means something
regenerated from stale input.

- [ ] **Step 6: Commit**

```bash
git add open-api packages/sdk mobile/openapi
git commit -m "chore(game): regenerate the API spec and clients for the daily setting"
```

---

### Task 4: Gate daily generation on the setting

**Files:**

- Modify: `server/src/services/game.service.ts:495-499`
- Test: `server/src/services/game.service.spec.ts:605-703`

**Interfaces:**

- Consumes: `SharedSpaceTable.dailyChallengeEnabled` (Task 1) via `this.sharedSpaceRepository.getById(spaceId)`, which already exists and uses `selectAll()`.
- Produces: no new signature. `getDaily` keeps returning `GameDailyResponseDto`.

- [ ] **Step 1: Keep the existing daily tests alive**

The guard reads a space that the existing tests never stub, so all six tests in the
`describe('daily challenge')` block would fail on the guard rather than on their own subject. Add to
that block's `beforeEach` (`server/src/services/game.service.spec.ts:608`), after the fake-timer setup:

```ts
// The daily is opt-in; every test in this block is about a space that has opted in.
mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: true } as any);
```

- [ ] **Step 2: Write the failing tests**

Append inside the same `describe('daily challenge')` block:

```ts
it.each([
  { state: null as boolean | null, label: 'nobody has been asked' },
  { state: false as boolean | null, label: 'an editor declined' },
])('generates nothing when $label', async ({ state }) => {
  stockPools(mocks);
  mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: state } as any);

  const result = await sut.getDaily(authStub, 'space-1');

  expect(result).toEqual({ challenge: null });
  // The assertion that matters: a guard placed AFTER the lookup would satisfy the line above
  // while still generating today's daily.
  expect(mocks.game.createChallenge).not.toHaveBeenCalled();
  expect(mocks.game.getDailyChallenge).not.toHaveBeenCalled();
});

it('returns no daily when the space is deleted between the membership check and the read', async () => {
  stockPools(mocks);
  mocks.sharedSpace.getById.mockResolvedValue(void 0);

  // requireMember already passed, so this is a race, not an authorization failure - a 500 would
  // be wrong for a page that is about to redirect anyway.
  await expect(sut.getDaily(authStub, 'space-1')).resolves.toEqual({ challenge: null });
  // BOTH mock assertions are load-bearing, the getDailyChallenge one especially: `game` is automocked
  // with strict:false, so an unstubbed lookup returns undefined rather than throwing. Without this
  // line the test still passes when the guard is moved to just AFTER the lookup - the exact
  // mis-placement this task exists to prevent. The same is true of the it.each pair above: their
  // `resolves.toEqual({ challenge: null })` passes even with NO guard at all, because generateDaily's
  // own re-read is unstubbed and yields undefined. The not.toHaveBeenCalled() checks are the only
  // assertions in these three tests that can actually fail on a mis-placed guard.
  expect(mocks.game.getDailyChallenge).not.toHaveBeenCalled();
  expect(mocks.game.createChallenge).not.toHaveBeenCalled();
});
```

Then add this one to the **`describe('guess')`** block instead (`:255`), because it reuses that block's
`challengeStub` and `beforeEach`:

```ts
it('still scores a guess on a daily whose space has since turned the daily off', async () => {
  // Disabling stops generation and hides the card; it must not snatch away a game someone is
  // part-way through. `guess` gates on membership only, and that is deliberate - do not "fix"
  // this into a rejection when reading the opt-in code.
  mocks.sharedSpace.getById.mockResolvedValue({ dailyChallengeEnabled: false } as any);
  mocks.game.getRound.mockResolvedValue({
    id: 'round-1',
    challengeId: 'challenge-1',
    index: 0,
    type: 'location',
    answerLat: 52.5,
    answerLon: 13.4,
    answerDate: null,
  } as any);
  mocks.game.createGuess.mockImplementation((guess: any) => guess);

  const result = await sut.guess(authStub, 'challenge-1', 0, { lat: 52.5, lon: 13.4 });

  expect(result.score).toBe(5000);
});
```

That block already stubs `mocks.game.getChallenge` and the membership in its own `beforeEach`, and the
three mocks used here (`getChallenge`, `getRound`, `createGuess`) are the complete set the file's other
guess tests use.

- [ ] **Step 3: Run them to verify they fail**

```bash
cd server && pnpm test --run src/services/game.service.spec.ts
```

Expected: the two `generates nothing` cases and the deleted-space case FAIL (there is no guard yet, so
a daily is generated and returned). The guess test should already PASS — it documents behaviour the
guard must not change. Note that in your output: a test that passes before and after is only
meaningful here because it would fail if someone later added a gate to `guess`.

- [ ] **Step 4: Add the guard**

In `server/src/services/game.service.ts`, replace the opening of `getDaily`:

```ts
  async getDaily(auth: AuthDto, spaceId: string): Promise<GameDailyResponseDto> {
    await this.requireMember(spaceId, auth.user.id);

    // The daily is opt-in per space, and this guard sits AHEAD of the lookup because the lookup is
    // what generates it. `?.` and `!== true` in one expression cover all three of: nobody asked yet,
    // an editor declined, and the space was deleted between the membership check and here.
    const space = await this.sharedSpaceRepository.getById(spaceId);
    if (space?.dailyChallengeEnabled !== true) {
      return { challenge: null };
    }

    const dailyOn = utcDateKey(new Date());
```

Leave the rest of the method untouched.

- [ ] **Step 5: Run the tests**

```bash
cd server && pnpm test --run src/services/game.service.spec.ts
```

Expected: PASS, all of them — the six pre-existing daily tests included. If those six fail, Step 1 was
skipped.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/game.service.ts server/src/services/game.service.spec.ts
git commit -m "feat(game): generate the daily only for spaces that opted in"
```

---

### Task 5: Add the prompt and toggle strings

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: seven keys used by Tasks 7 and 8: `game_daily_decline`, `game_daily_enable`, `game_daily_enable_description`, `game_daily_enable_title`, `game_daily_toggle_failed`, `game_daily_turn_off`, `game_daily_turn_on`.

- [ ] **Step 1: Insert the keys, alphabetically, in every file**

All seven sort between the existing `game_daily_challenge` and `game_daily_next_in`, except
`game_daily_toggle_failed`, `game_daily_turn_off` and `game_daily_turn_on`, which sort after
`game_daily_played` and before `game_daily_unavailable`. Insert in place; do not append. Line numbers
differ per file (`pl` and `ru` are offset), so locate by key, not by line.

`en.json`:

```json
  "game_daily_decline": "No thanks",
  "game_daily_enable": "Enable",
  "game_daily_enable_description": "Play one shared challenge a day with this space. Scores count toward the monthly leaderboard.",
  "game_daily_enable_title": "Turn on the daily challenge?",
  "game_daily_toggle_failed": "Could not change the daily challenge setting",
  "game_daily_turn_off": "Turn off daily challenge",
  "game_daily_turn_on": "Turn on daily challenge",
```

`de.json` — informal `du`, and this file's word for a challenge is **Herausforderung**, space stays `Space`:

```json
  "game_daily_decline": "Nein danke",
  "game_daily_enable": "Aktivieren",
  "game_daily_enable_description": "Spiele täglich eine gemeinsame Herausforderung in diesem Space. Die Punkte zählen für die monatliche Bestenliste.",
  "game_daily_enable_title": "Tägliche Herausforderung aktivieren?",
  "game_daily_toggle_failed": "Die Einstellung für die tägliche Herausforderung konnte nicht geändert werden",
  "game_daily_turn_off": "Tägliche Herausforderung deaktivieren",
  "game_daily_turn_on": "Tägliche Herausforderung aktivieren",
```

`fr.json` — formal `vous`, challenge is **défi**, and this file uses the French **espace** (lowercase), not `Space`:

```json
  "game_daily_decline": "Non merci",
  "game_daily_enable": "Activer",
  "game_daily_enable_description": "Jouez un défi partagé par jour dans cet espace. Les points comptent pour le classement mensuel.",
  "game_daily_enable_title": "Activer le défi du jour ?",
  "game_daily_toggle_failed": "Impossible de modifier le réglage du défi du jour",
  "game_daily_turn_off": "Désactiver le défi du jour",
  "game_daily_turn_on": "Activer le défi du jour",
```

`it.json` — informal `tu`, challenge is **sfida**, space stays `Space`:

```json
  "game_daily_decline": "No, grazie",
  "game_daily_enable": "Attiva",
  "game_daily_enable_description": "Gioca una sfida condivisa al giorno in questo Space. I punti contano per la classifica mensile.",
  "game_daily_enable_title": "Attivare la sfida del giorno?",
  "game_daily_toggle_failed": "Impossibile modificare l'impostazione della sfida del giorno",
  "game_daily_turn_off": "Disattiva la sfida del giorno",
  "game_daily_turn_on": "Attiva la sfida del giorno",
```

`nl.json` — challenge is **uitdaging**, space stays `Space`:

```json
  "game_daily_decline": "Nee, bedankt",
  "game_daily_enable": "Inschakelen",
  "game_daily_enable_description": "Speel elke dag één gedeelde uitdaging in deze Space. Punten tellen mee voor het maandelijkse klassement.",
  "game_daily_enable_title": "Dagelijkse uitdaging inschakelen?",
  "game_daily_toggle_failed": "Kon de instelling voor de dagelijkse uitdaging niet wijzigen",
  "game_daily_turn_off": "Dagelijkse uitdaging uitschakelen",
  "game_daily_turn_on": "Dagelijkse uitdaging inschakelen",
```

`pl.json` — challenge is **wyzwanie**, space stays `Space`:

```json
  "game_daily_decline": "Nie, dziękuję",
  "game_daily_enable": "Włącz",
  "game_daily_enable_description": "Graj w jedno wspólne wyzwanie dziennie w tym Space. Punkty liczą się do miesięcznego rankingu.",
  "game_daily_enable_title": "Włączyć codzienne wyzwanie?",
  "game_daily_toggle_failed": "Nie udało się zmienić ustawienia codziennego wyzwania",
  "game_daily_turn_off": "Wyłącz codzienne wyzwanie",
  "game_daily_turn_on": "Włącz codzienne wyzwanie",
```

`es.json` — informal `tú`, challenge is **reto**, space stays `Space`:

```json
  "game_daily_decline": "No, gracias",
  "game_daily_enable": "Activar",
  "game_daily_enable_description": "Juega un reto compartido al día en este Space. Los puntos cuentan para la clasificación mensual.",
  "game_daily_enable_title": "¿Activar el reto diario?",
  "game_daily_toggle_failed": "No se pudo cambiar la configuración del reto diario",
  "game_daily_turn_off": "Desactivar el reto diario",
  "game_daily_turn_on": "Activar el reto diario",
```

`ru.json` — formal `вы`, challenge is **вызов**, space stays `Space`:

```json
  "game_daily_decline": "Нет, спасибо",
  "game_daily_enable": "Включить",
  "game_daily_enable_description": "Играйте в один общий вызов в день в этом Space. Очки идут в зачёт месячной таблицы лидеров.",
  "game_daily_enable_title": "Включить ежедневный вызов?",
  "game_daily_toggle_failed": "Не удалось изменить настройку ежедневного вызова",
  "game_daily_turn_off": "Отключить ежедневный вызов",
  "game_daily_turn_on": "Включить ежедневный вызов",
```

`zh_Hans.json`:

```json
  "game_daily_decline": "不用了",
  "game_daily_enable": "启用",
  "game_daily_enable_description": "每天在此 Space 玩一个共享挑战。得分计入月度排行榜。",
  "game_daily_enable_title": "启用每日挑战？",
  "game_daily_toggle_failed": "无法更改每日挑战设置",
  "game_daily_turn_off": "关闭每日挑战",
  "game_daily_turn_on": "启用每日挑战",
```

`zh_Hant.json`:

```json
  "game_daily_decline": "不用了",
  "game_daily_enable": "啟用",
  "game_daily_enable_description": "每天在此 Space 玩一個共享挑戰。得分計入月度排行榜。",
  "game_daily_enable_title": "啟用每日挑戰？",
  "game_daily_toggle_failed": "無法變更每日挑戰設定",
  "game_daily_turn_off": "關閉每日挑戰",
  "game_daily_turn_on": "啟用每日挑戰",
```

- [ ] **Step 2: Verify every file got all seven**

```bash
for f in en de fr it nl pl es ru zh_Hans zh_Hant; do
  printf '%s: ' "$f"
  grep -c '"game_daily_decline"\|"game_daily_enable"\|"game_daily_enable_description"\|"game_daily_enable_title"\|"game_daily_toggle_failed"\|"game_daily_turn_off"\|"game_daily_turn_on"' "i18n/$f.json"
done
```

Expected: `7` for all ten. Any other number means a key was missed or duplicated.

- [ ] **Step 3: Format and check**

```bash
npx prettier --write i18n/*.json && npx prettier --check i18n/*.json
```

- [ ] **Step 4: Commit**

```bash
git add i18n
git commit -m "feat(i18n): add the daily challenge opt-in strings"
```

---

### Task 6: Standings visibility helper

**Files:**

- Modify: `web/src/lib/utils/game.ts` (append, following the file's `export const name = (…) =>` style)
- Test: `web/src/lib/utils/game.spec.ts` (append)

**Interfaces:**

- Produces: `shouldShowStandings(dailyChallengeEnabled: boolean | null | undefined, entries: { daysPlayed: number }[]): boolean`, imported by Task 8.

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/utils/game.spec.ts`:

```ts
describe('shouldShowStandings', () => {
  it('hides the board while nobody has been asked, even when earlier play left scores', () => {
    // A space where a daily was generated during RC testing arrives un-asked WITH history. Showing a
    // populated board directly under a prompt asking whether to switch the feature on reads as a
    // contradiction, so the prompt wins. Nothing is deleted - the board returns once answered.
    expect(shouldShowStandings(null, [{ daysPlayed: 3 }])).toBe(false);
  });

  it('hides the board for a never-asked empty space', () => {
    expect(shouldShowStandings(null, [{ daysPlayed: 0 }])).toBe(false);
  });

  it('shows the board whenever the daily is on, even before anyone plays', () => {
    expect(shouldShowStandings(true, [{ daysPlayed: 0 }])).toBe(true);
  });

  it('keeps the board after the daily is switched off, if members earned something', () => {
    expect(shouldShowStandings(false, [{ daysPlayed: 0 }, { daysPlayed: 2 }])).toBe(true);
  });

  it('hides the board for a declined space nobody played in', () => {
    expect(shouldShowStandings(false, [{ daysPlayed: 0 }, { daysPlayed: 0 }])).toBe(false);
  });

  it('hides the board rather than throwing when there are no entries at all', () => {
    expect(shouldShowStandings(false, [])).toBe(false);
  });

  it('treats an absent field as never-asked', () => {
    // The SDK types the response field as optional, so undefined reaches this helper in practice.
    expect(shouldShowStandings(undefined, [{ daysPlayed: 5 }])).toBe(false);
  });
});
```

Add `shouldShowStandings` to the existing `$lib/utils/game` import at the top of the spec.

- [ ] **Step 2: Run them to verify they fail**

```bash
cd web && pnpm test --run src/lib/utils/game.spec.ts
```

Expected: FAIL — `shouldShowStandings is not a function`.

- [ ] **Step 3: Implement it**

Append to `web/src/lib/utils/game.ts`:

```ts
/**
 * Whether the monthly standings section belongs on the page.
 *
 * The null branch is not redundant with the others: an un-asked space can already hold daily history
 * (any space where a daily was generated before this setting existed), and the prompt asking whether
 * to turn the feature on must not sit above a populated board. Answering the prompt brings it back,
 * because disabling never deletes anything.
 */
export const shouldShowStandings = (
  dailyChallengeEnabled: boolean | null | undefined,
  entries: { daysPlayed: number }[],
): boolean => {
  if (dailyChallengeEnabled === null || dailyChallengeEnabled === undefined) {
    return false;
  }
  return dailyChallengeEnabled || entries.some((entry) => entry.daysPlayed > 0);
};
```

- [ ] **Step 4: Run the tests**

```bash
cd web && pnpm test --run src/lib/utils/game.spec.ts
```

Expected: PASS, with the file's pre-existing tests still green.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/utils/game.ts web/src/lib/utils/game.spec.ts
git commit -m "feat(web): add a standings visibility rule for the opt-in daily"
```

---

### Task 7: The first-visit prompt component

**Files:**

- Create: `web/src/lib/components/games/daily-challenge-prompt.svelte`
- Test: `web/src/lib/components/games/daily-challenge-prompt.spec.ts`

**Interfaces:**

- Consumes: the i18n keys from Task 5.
- Produces: a component with props `{ pending: boolean; onEnable: () => void; onDecline: () => void }`, mounted by Task 8. Testids: `daily-prompt`, `daily-prompt-enable`, `daily-prompt-decline`.

- [ ] **Step 1: Write the failing test**

Create `web/src/lib/components/games/daily-challenge-prompt.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import DailyChallengePrompt from '$lib/components/games/daily-challenge-prompt.svelte';

describe('DailyChallengePrompt', () => {
  // No locale is registered in this file, so $t() returns the raw key and IGNORES interpolation
  // values entirely. Assertions here can only prove which key was chosen, never the copy.
  it('offers both an enable and a decline action', () => {
    render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline: vi.fn() });

    expect(screen.getByTestId('daily-prompt-enable')).toBeInTheDocument();
    expect(screen.getByTestId('daily-prompt-decline')).toBeInTheDocument();
  });

  it('calls onEnable when enabled', async () => {
    const onEnable = vi.fn();
    render(DailyChallengePrompt, { pending: false, onEnable, onDecline: vi.fn() });

    await userEvent.click(screen.getByTestId('daily-prompt-enable'));

    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it('calls onDecline when declined', async () => {
    const onDecline = vi.fn();
    render(DailyChallengePrompt, { pending: false, onEnable: vi.fn(), onDecline });

    await userEvent.click(screen.getByTestId('daily-prompt-decline'));

    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('disables both buttons while the enable is in flight', async () => {
    // Enabling triggers generation on the reload - candidate queries plus CLIP prompts, seconds not
    // milliseconds. Without this the button looks broken on the one click that matters most, and a
    // second click would fire a second update.
    const onEnable = vi.fn();
    render(DailyChallengePrompt, { pending: true, onEnable, onDecline: vi.fn() });

    expect(screen.getByTestId('daily-prompt-enable')).toBeDisabled();
    expect(screen.getByTestId('daily-prompt-decline')).toBeDisabled();

    await userEvent.click(screen.getByTestId('daily-prompt-enable'));
    expect(onEnable).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd web && pnpm test --run src/lib/components/games/daily-challenge-prompt.spec.ts
```

Expected: FAIL — the component does not exist.

- [ ] **Step 3: Write the component**

Create `web/src/lib/components/games/daily-challenge-prompt.svelte`:

```svelte
<script lang="ts">
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';

  interface Props {
    /** True while the enable/decline write and the page reload it triggers are in flight. */
    pending: boolean;
    onEnable: () => void;
    onDecline: () => void;
  }

  let { pending, onEnable, onDecline }: Props = $props();
</script>

<section
  class="flex flex-col gap-3 rounded-3xl border border-gray-300 p-6 dark:border-gray-700"
  data-testid="daily-prompt"
>
  <h2 class="text-lg font-semibold">{$t('game_daily_enable_title')}</h2>
  <p class="max-w-lg text-sm text-gray-600 dark:text-gray-300">{$t('game_daily_enable_description')}</p>

  <div class="flex gap-2">
    <!-- Enabling generates the daily on the reload, so both buttons lock for the whole round trip. -->
    <Button size="small" disabled={pending} onclick={onEnable} data-testid="daily-prompt-enable">
      {$t('game_daily_enable')}
    </Button>
    <Button
      size="small"
      variant="outline"
      disabled={pending}
      onclick={onDecline}
      data-testid="daily-prompt-decline"
    >
      {$t('game_daily_decline')}
    </Button>
  </div>
</section>
```

Use `variant="outline"` rather than `ghost` for the decline button: `@immich/ui`'s `ghost` renders
theme-coloured ink, which disappears against a photo backdrop elsewhere on this page.

- [ ] **Step 4: Run the tests**

```bash
cd web && pnpm test --run src/lib/components/games/daily-challenge-prompt.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/components/games/daily-challenge-prompt.svelte web/src/lib/components/games/daily-challenge-prompt.spec.ts
git commit -m "feat(web): add the daily challenge opt-in prompt"
```

---

### Task 8: Wire the Challenges page

**Files:**

- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/+page.ts`
- Modify: `web/src/routes/(user)/spaces/[spaceId]/games/+page.svelte`
- Test: `web/src/routes/(user)/spaces/[spaceId]/games/page-load.spec.ts` (append)
- Test: `web/src/routes/(user)/spaces/[spaceId]/games/space-games-page.spec.ts` (append)

**Interfaces:**

- Consumes: `shouldShowStandings` (Task 6), `DailyChallengePrompt` (Task 7), the i18n keys (Task 5), and `updateSpace` plus the `dailyChallengeEnabled` response field from the SDK (Task 3).

- [ ] **Step 1: Make both specs able to express an opt-in state**

Three fixture edits first. They are not optional — without them the pre-existing tests in both files
exercise a space whose setting is `undefined`, which the new code reads as "never asked", so the daily
would vanish from tests that are about a space that has it.

In `page-load.spec.ts`, add to the `space` fixture (`:11-16`):

```ts
    dailyChallengeEnabled: true,
```

and widen `makeEvent` (`:73-77`) so a test can vary it:

```ts
const makeEvent = (overrides: { spaceId?: string; space?: Record<string, unknown> } = {}) => ({
  url: new URL(`https://gallery.test/spaces/${overrides.spaceId ?? 'space-1'}/games`),
  params: { spaceId: overrides.spaceId ?? 'space-1' },
  parent: vi.fn().mockResolvedValue({ space: { ...space, ...overrides.space }, members, linkedAlbums }),
});
```

In `space-games-page.spec.ts`, add `dailyChallengeEnabled: true` to `BASE_SPACE`, and add a fifth
parameter to `renderPage` (`:88-96`) so a test can override it:

```ts
function renderPage(
  challenges: GameChallengeListItemResponseDto[],
  role: SharedSpaceRole = SharedSpaceRole.Editor,
  daily: GameChallengeListItemResponseDto | null = null,
  boards: {
    standings?: { month: string; entries: Array<{ userId: string; name: string; total: number; daysPlayed: number }> };
    todayBoard?: { entries: Array<{ userId: string; name: string; total: number; answered: number }> } | null;
  } = {},
  space: Partial<typeof BASE_SPACE> = {},
) {
  const props = {
    data: {
      space: { ...BASE_SPACE, ...space },
      ...
```

- [ ] **Step 2: Write the failing load tests**

Append inside the `describe('space games page load')` block. `sdkMock` and `makeEvent` are already in
scope:

```ts
it('does not ask for the daily or its board when the space has not opted in', async () => {
  // Not merely an optimisation: the first read of the daily is what GENERATES it, so a page that
  // asks for a space which never opted in is asking the server to do the thing this feature exists
  // to prevent.
  const event = makeEvent({ space: { dailyChallengeEnabled: null } });

  await expect(load(event as never)).resolves.toEqual({
    challenges,
    daily: null,
    standings,
    todayBoard: null,
    meta: { title: 'Test Space - Challenges' },
  });

  expect(sdkMock.getDailyChallenge).not.toHaveBeenCalled();
  expect(sdkMock.getLeaderboard).not.toHaveBeenCalled();
  // The challenges list is unaffected: player-created challenges are not opt-in.
  expect(sdkMock.getChallenges).toHaveBeenCalledWith({ spaceId: 'space-1' });
});

it('does not ask for the daily when an editor has declined', async () => {
  const event = makeEvent({ space: { dailyChallengeEnabled: false } });

  await expect(load(event as never)).resolves.toMatchObject({ daily: null, todayBoard: null });

  expect(sdkMock.getDailyChallenge).not.toHaveBeenCalled();
});

it('still asks for the standings when the daily is off, because past scores may remain', async () => {
  const event = makeEvent({ space: { dailyChallengeEnabled: false } });

  await load(event as never);

  expect(sdkMock.getStandings).toHaveBeenCalledWith({ spaceId: 'space-1' });
});
```

- [ ] **Step 3: Write the failing page tests**

Append to `space-games-page.spec.ts`. Note this file **registers the `en-US` locale**, so unlike the
component spec in Task 7 it can assert real English copy:

```ts
describe('daily challenge opt-in', () => {
  it('prompts an editor when nobody has been asked yet', () => {
    renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

    expect(screen.getByTestId('daily-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-challenge')).not.toBeInTheDocument();
  });

  it('never prompts a viewer and gives them no toggle', () => {
    renderPage([], SharedSpaceRole.Viewer, null, {}, { dailyChallengeEnabled: null });

    expect(screen.queryByTestId('daily-prompt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('daily-toggle')).not.toBeInTheDocument();
  });

  it('shows the daily card, not the prompt, once enabled', () => {
    renderPage([], SharedSpaceRole.Editor, makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16' }), {}, { dailyChallengeEnabled: true });

    expect(screen.getByTestId('daily-challenge')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-prompt')).not.toBeInTheDocument();
  });

  it('shows an enabled space's card to a viewer too, without a toggle', () => {
    renderPage([], SharedSpaceRole.Viewer, makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16' }), {}, { dailyChallengeEnabled: true });

    expect(screen.getByTestId('daily-challenge')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-toggle')).not.toBeInTheDocument();
  });

  it('shows neither prompt nor card after a decline, but keeps the way back', () => {
    renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: false });

    expect(screen.queryByTestId('daily-prompt')).not.toBeInTheDocument();
    expect(screen.queryByTestId('daily-challenge')).not.toBeInTheDocument();
    // Without this the decline is a one-way door: no card means no card-mounted control could ever
    // bring it back.
    expect(screen.getByTestId('daily-toggle')).toBeInTheDocument();
  });

  it('writes false when an editor declines', async () => {
    renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

    await fireEvent.click(screen.getByTestId('daily-prompt-decline'));

    // false, not undefined: a decline is a decision. undefined would leave the column null and
    // re-prompt on the next visit, which is the behaviour we deliberately did not build.
    expect(sdkMock.updateSpace).toHaveBeenCalledWith({
      id: BASE_SPACE.id,
      sharedSpaceUpdateDto: { dailyChallengeEnabled: false },
    });
  });

  it('writes true when an editor enables', async () => {
    renderPage([], SharedSpaceRole.Editor, null, {}, { dailyChallengeEnabled: null });

    await fireEvent.click(screen.getByTestId('daily-prompt-enable'));

    expect(sdkMock.updateSpace).toHaveBeenCalledWith({
      id: BASE_SPACE.id,
      sharedSpaceUpdateDto: { dailyChallengeEnabled: true },
    });
  });

  it('hides the standings while the prompt is showing, even with earlier scores', () => {
    // The case a simplification of shouldShowStandings would break: history exists, but a populated
    // board must not sit under a prompt asking whether to switch the feature on.
    renderPage(
      [],
      SharedSpaceRole.Editor,
      null,
      { standings: { month: '2026-08', entries: [{ userId: 'u1', name: 'Ana', total: 900, daysPlayed: 3 }] } },
      { dailyChallengeEnabled: null },
    );

    expect(screen.queryByTestId('standings-section')).not.toBeInTheDocument();
  });

  it('keeps the standings after a decline when members already earned scores', () => {
    renderPage(
      [],
      SharedSpaceRole.Editor,
      null,
      { standings: { month: '2026-08', entries: [{ userId: 'u1', name: 'Ana', total: 900, daysPlayed: 3 }] } },
      { dailyChallengeEnabled: false },
    );

    expect(screen.getByTestId('standings-section')).toBeInTheDocument();
  });
});
```

Replace `DAILY` with the file's own fixture factory (`space-games-page.spec.ts:58`):
`makeChallenge({ id: 'daily-1', dailyOn: '2026-08-16', answered: 0 })` — the same call its existing
daily test already uses at `:149`. The standings section already carries
`data-testid="standings-section"` (`standings-section.svelte:63`), so nothing to add there.

- [ ] **Step 4: Run both specs to verify they fail**

```bash
cd web && pnpm test --run src/routes/\(user\)/spaces/\[spaceId\]/games/page-load.spec.ts
cd web && pnpm test --run src/routes/\(user\)/spaces/\[spaceId\]/games/space-games-page.spec.ts
```

Expected: FAIL. Check the reported file count is 1 in each — a bracketed SvelteKit route path can be
eaten by shell globbing, and a "green" run of 0 files is the worst outcome here.

- [ ] **Step 5: Skip the daily fetches in the load**

Replace the parallel block in `+page.ts`:

```ts
const { space } = await parent();
const dailyEnabled = space.dailyChallengeEnabled === true;

// The daily's first read is what GENERATES it, so a space that never opted in must not ask at all.
// The server refuses anyway; skipping saves this page two requests and keeps the client from
// implying a daily it must not render.
const [challenges, daily, standings] = await Promise.all([
  getChallenges({ spaceId: params.spaceId }),
  dailyEnabled ? getDailyChallenge({ spaceId: params.spaceId }) : Promise.resolve({ challenge: null }),
  getStandings({ spaceId: params.spaceId }),
]);

const todayBoard = daily.challenge ? await getLeaderboard({ id: daily.challenge.id }) : null;

return {
  challenges,
  daily: daily.challenge,
  standings,
  todayBoard,
  meta: { title: `${space.name} - Challenges` },
};
```

Two things to leave alone:

- **Do not add `members` to the return.** `space` and `members` reach the page through the `[spaceId]`
  layout's data, which SvelteKit merges into `data` — the page already reads `data.members`. The
  existing load test asserts the returned object with an exact `toEqual` and comments that these are
  not fetched again here, so returning `members` would break it for no gain.
- **Keep `getStandings` unconditional.** Whether the section renders depends on its own entries, so
  the answer is not knowable without asking for them.

- [ ] **Step 6: Render the three states and the toggle**

In `+page.svelte`, add to the imports:

```ts
import DailyChallengePrompt from '$lib/components/games/daily-challenge-prompt.svelte';
import ButtonContextMenu from '$lib/components/shared-components/context-menu/ButtonContextMenu.svelte';
import MenuOption from '$lib/components/shared-components/context-menu/MenuOption.svelte';
import { shouldShowStandings } from '$lib/utils/game';
import { updateSpace } from '@immich/sdk';
import { invalidateAll } from '$app/navigation';
import { mdiCalendarStarOutline, mdiDotsVertical } from '@mdi/js';
```

Add state and handlers beside the existing ones (`isEditor` is already derived in this file):

```ts
let togglingDaily = $state(false);
const dailyEnabled = $derived(space.dailyChallengeEnabled === true);
const dailyUnanswered = $derived(space.dailyChallengeEnabled === null || space.dailyChallengeEnabled === undefined);
const showStandings = $derived(shouldShowStandings(space.dailyChallengeEnabled, standings.entries));

async function setDailyEnabled(enabled: boolean) {
  togglingDaily = true;
  try {
    await updateSpace({ id: space.id, sharedSpaceUpdateDto: { dailyChallengeEnabled: enabled } });
    // Enabling generates the daily during this reload, which is the slow part the button is
    // disabled for.
    await invalidateAll();
  } catch (error) {
    handleError(error, $t('game_daily_toggle_failed'));
  } finally {
    togglingDaily = false;
  }
}
```

Replace the daily card and standings markup:

```svelte
  {#if isEditor}
    <div class="flex justify-end">
      <ButtonContextMenu icon={mdiDotsVertical} size="medium" title={$t('game_daily_challenge')}>
        <MenuOption
          text={dailyEnabled ? $t('game_daily_turn_off') : $t('game_daily_turn_on')}
          icon={mdiCalendarStarOutline}
          onClick={() => setDailyEnabled(!dailyEnabled)}
        />
      </ButtonContextMenu>
    </div>
  {/if}

  {#if dailyEnabled}
    <DailyChallengeCard
      challenge={daily}
      href={daily ? Route.viewSpaceGame({ spaceId: space.id, challengeId: daily.id }) : ''}
      {now}
    />
  {:else if dailyUnanswered && isEditor}
    <DailyChallengePrompt
      pending={togglingDaily}
      onEnable={() => setDailyEnabled(true)}
      onDecline={() => setDailyEnabled(false)}
    />
  {/if}

  {#if showStandings}
    <StandingsSection
      today={todayBoard && daily ? { entries: todayBoard.entries, roundCount: daily.roundCount } : null}
      month={standings}
      {members}
      currentUserId={authManager.user.id}
    />
  {/if}
```

Add `data-testid="daily-toggle"` to the `ButtonContextMenu`. `DailyChallengeCard` renders only when
the daily is on, so its `game_daily_unavailable` copy — which tells the user to add photos with GPS
data — can no longer appear for a space that simply has not opted in.

- [ ] **Step 7: Run both specs**

```bash
cd web && pnpm test --run src/routes/\(user\)/spaces/\[spaceId\]/games/page-load.spec.ts
cd web && pnpm test --run src/routes/\(user\)/spaces/\[spaceId\]/games/space-games-page.spec.ts
```

Expected: PASS, with every pre-existing test in both files still green. Pre-existing page tests that
assert the daily card renders will need `dailyChallengeEnabled: true` in their space fixture — that is
a fixture update, not a behaviour change, and it is correct: those tests are about a space that has
the daily on.

- [ ] **Step 8: Typecheck and lint**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint
```

`check:svelte` reporting 0 files scanned is a failed run, not a pass — expect ~619 files.

- [ ] **Step 9: Commit**

```bash
git add web/src/routes/\(user\)/spaces/\[spaceId\]/games web/src/lib/components/games
git commit -m "feat(web): prompt for the daily challenge and let editors toggle it"
```

---

### Task 9: End-to-end coverage

**Files:**

- Modify: `e2e/src/specs/server/api/game.e2e-spec.ts`

**Interfaces:**

- Consumes: the deployed guard (Task 4) and the editor-writable field (Tasks 2-3).

- [ ] **Step 1: Confirm the stack is serving this branch**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2285/api/server/version
```

A games route answering 404 rather than 401 means the image predates this work and every test below
would fail on a missing route rather than on behaviour. Rebuild only the server service, and check
first that no other session is mid-run: this stack is shared.

- [ ] **Step 2: Write the failing tests**

Add a helper beside the existing ones:

```ts
const setDailyEnabled = async (spaceId: string, accessToken: string, enabled: boolean) => {
  const { status } = await request(app)
    .put(`/shared-spaces/${spaceId}`)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ dailyChallengeEnabled: enabled });
  expect(status).toBe(200);
};
```

and a describe block:

```ts
describe('daily challenge opt-in', () => {
  it('returns no daily and creates nothing until a space opts in', async () => {
    const { spaceId } = await freshSpaceWithPhotos('daily-optin-unasked', 4);

    const daily = await getDaily(spaceId, viewer.accessToken);
    expect(daily.challenge).toBeNull();

    // The response alone would also be satisfied by a guard placed after the lookup, which would
    // still have generated the challenge. The list is what proves nothing was created.
    const { body } = await request(app)
      .get(`/shared-spaces/${spaceId}/games`)
      .set('Authorization', `Bearer ${viewer.accessToken}`);
    expect(body).toHaveLength(0);
  });

  it('generates the daily once an editor opts in', async () => {
    const { spaceId } = await freshSpaceWithPhotos('daily-optin-enabled', 4);

    await setDailyEnabled(spaceId, editor.accessToken, true);

    const daily = await getDaily(spaceId, viewer.accessToken);
    expect(daily.challenge).not.toBeNull();
  });

  it('rejects a viewer changing the setting', async () => {
    const { spaceId } = await freshSpaceWithPhotos('daily-optin-viewer', 4);

    const { status } = await request(app)
      .put(`/shared-spaces/${spaceId}`)
      .set('Authorization', `Bearer ${viewer.accessToken}`)
      .send({ dailyChallengeEnabled: true });

    expect(status).toBe(403);
  });

  it('keeps the standings board across a disable and re-enable', async () => {
    const { spaceId } = await freshSpaceWithPhotos('daily-optin-roundtrip', 4);
    await setDailyEnabled(spaceId, editor.accessToken, true);

    const daily = await getDaily(spaceId, viewer.accessToken);
    const detail = await getDetail(daily.challenge!.id, viewer.accessToken);
    for (const round of detail.rounds) {
      const { status } = await request(app)
        .post(`/games/${daily.challenge!.id}/rounds/${round.index}/guess`)
        .set('Authorization', `Bearer ${viewer.accessToken}`)
        .send(guessPayloadFor(round, new Date().toISOString()));
      expect(status).toBe(201);
    }

    const earned = (await getStandings(spaceId, viewer.accessToken)).entries.find(
      (entry) => entry.userId === viewer.userId,
    )!;
    // Guard the premise: the default guess date scores zero, which would make every assertion
    // below compare 0 to 0 and prove nothing.
    expect(earned.total).toBeGreaterThan(0);

    await setDailyEnabled(spaceId, editor.accessToken, false);
    const afterDisable = (await getStandings(spaceId, viewer.accessToken)).entries.find(
      (entry) => entry.userId === viewer.userId,
    )!;
    expect(afterDisable.total).toBe(earned.total);
    expect(afterDisable.daysPlayed).toBe(earned.daysPlayed);

    await setDailyEnabled(spaceId, editor.accessToken, true);
    const afterReEnable = (await getStandings(spaceId, viewer.accessToken)).entries.find(
      (entry) => entry.userId === viewer.userId,
    )!;
    expect(afterReEnable.total).toBe(earned.total);
  });
});
```

`guessPayloadFor(round, new Date().toISOString())` uses the second parameter added in the standings
work; a same-month guess scores, whereas the default fixed date scores zero everywhere.

- [ ] **Step 3: Run the spec**

```bash
cd e2e && pnpm test src/specs/server/api/game.e2e-spec.ts
```

No `--run` — this package's `test` script already has it, and adding it crashes. Expected: PASS, with
the file's pre-existing tests still green.

- [ ] **Step 4: Gates**

```bash
cd e2e && npx prettier --check src/specs/server/api/game.e2e-spec.ts && npx eslint src/specs/server/api/game.e2e-spec.ts --max-warnings 0 && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add e2e/src/specs/server/api/game.e2e-spec.ts
git commit -m "test(game): cover the daily challenge opt-in end to end"
```

---

### Task 10: Final gate

- [ ] **Step 1: Server**

```bash
cd server && pnpm check && pnpm lint && pnpm test --run
```

- [ ] **Step 2: Server medium tests**

```bash
cd packages/sdk && pnpm build
cd ../../server && pnpm test:medium --run --no-file-parallelism
```

`--no-file-parallelism` is not optional here. A parallel full-suite run exhausts the test database's
connections and reports 30-70 failures whose set **shifts between identical runs** — none of them real.
Read the `Test Files` line. A single failure in `sync/*.spec.ts` that passes when run alone is a known
pre-existing ordering flake, not this work.

- [ ] **Step 3: Web**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test --run
```

`check:svelte` must report ~619 files; 0 files scanned is a failed run.

- [ ] **Step 4: Formatting**

```bash
cd server && npx prettier --check "src/**/*.ts" "test/**/*.ts"
cd ../web && pnpm format
cd .. && npx prettier --check i18n/*.json docs/superpowers/**/*.md
```

`web`'s `format` script is already `prettier --check .`. Prefer `--check` over `--write` on the server
so the formatter cannot churn files this work never touched.

- [ ] **Step 5: Commit anything the formatters touched**

```bash
git add -A
git commit -m "style: apply formatting to the daily challenge opt-in"
```

Skip if the tree is clean.

---

## Notes for the executor

- **The two ways this feature dies silently**, both called out in the spec: mapping the new field with
  `?? true` (Task 2 Step 5), and adding it to `isOwnerOnlySettingsUpdate` (Task 2 Step 4). Neither is
  caught by `tsc`; each has a test in Task 2 specifically because of that.
- **Order matters at three points.** Task 1 before Task 2 (the column must exist for the row type),
  Task 3 before Tasks 7-8 (the SDK field must exist for the web to read it), Task 5 before Tasks 7-8
  (keys before use). Otherwise the order is the plan's order.
- **Task 4 will break six existing tests unless Step 1 is done first.** They are not wrong; they simply
  predate a guard that reads a space they never stubbed.
