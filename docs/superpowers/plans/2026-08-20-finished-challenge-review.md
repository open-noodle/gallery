# Finished Challenge Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make re-opening a played challenge show the rounds — each photo, how close you were, what it scored — with the full reveal one tap away, instead of a bare total.

**Architecture:** One optional `guess` object on the existing round-detail DTO, projected from a guess row the service already loads. Mobile then maps a finished round onto `RoundResult` (the struct the reveal already consumes) through a single factory, renders a list of rows on both finished screens, and pushes a route that reuses `RoundReveal` verbatim.

**Tech Stack:** NestJS 11 + Zod DTOs + Kysely, Vitest (server, e2e), Flutter 3.44.8 + Riverpod + auto_route, `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-08-20-finished-challenge-review-design.md`

## Global Constraints

- **This lands on `feat/photo-guessing-game`, which has not merged.** No migration: there is no schema change anywhere in this plan. Every column already exists.
- **Flutter is pinned to 3.44.8** in `mobile/mise.toml`. Never call a bare `flutter` or `dart` — the mise global pin is a different version and pub solve fails on the SDK constraint. Read the pin, then invoke the binary directly:

  ```bash
  ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test
  ```

  Do **not** use `mise run` or `mise exec` from this worktree: both resolve against the outermost repo root, so they run the _main_ checkout's tasks and toolchain.

- **Never run `make sql` / `mise sql` in this plan.** No decorated repository query changes. Running it without a reachable database **deletes every file in `server/src/queries/`**.
- **i18n: six new keys, ten locales, same commit.** `en` plus `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant`. German/Italian/Spanish address the user informally (`du`/`tu`/`tú`); French and Russian formally (`vous`/`вы`). Every locale except `fr` leaves "Space" untranslated; `fr` uses "espace". Keys are alphabetically sorted — insert in place, then `npx prettier --write i18n/*.json`.
- **Exact user-facing copy** (English), fixed by an approved mockup — do not paraphrase:

  | Key                        | English                                             |
  | -------------------------- | --------------------------------------------------- |
  | `game_review_your_rounds`  | Your rounds                                         |
  | `game_review_round`        | Round {index}                                       |
  | `game_review_type_place`   | Place                                               |
  | `game_review_type_date`    | Date                                                |
  | `game_review_distance_off` | {distance} off                                      |
  | `game_review_days_off`     | {count, plural, one {# day off} other {# days off}} |

- **Every optional field on the round-detail DTO is `Optional<T?>` in Dart, and `.value` THROWS** (`Absent.value => throw StateError('No value present')`). Always `.orElse(null)`. This applies to the new `guess` exactly as it already does to `score` and `answer`.
- Mobile gates, all run unpiped from `mobile/`: `flutter test`, `dart analyze --fatal-infos`, and `dart format --set-exit-if-changed` over **`lib` only** (CI does not gate `test/`, and formatting it churns ~40 unrelated files).

---

### Task 1: Server — project the caller's guess onto the round detail

**Files:**

- Modify: `server/src/dtos/game.dto.ts` (near `GameRoundDetailResponseSchema`, ~line 125)
- Modify: `server/src/services/game.service.ts:1160` (`toRoundDetail`)
- Test: `server/src/services/game.service.spec.ts` (beside the existing withholding test at ~line 488)

**Interfaces:**

- Consumes: `GameGuessRow` (`guessLat`, `guessLon`, `guessDate`, `distanceKm`, `offsetDays`, `score`), already passed into `toRoundDetail`.
- Produces: `GameRoundDetailResponseDto.guess?: { lat, lon, date, distanceKm, offsetDays }` — consumed by Tasks 2, 3, 4.

- [ ] **Step 1: Write the failing tests**

In `server/src/services/game.service.spec.ts`, alongside the existing `withholds the answer for a round the caller has not guessed`:

```ts
it('returns the caller own guess for a guessed location round', async () => {
  // Arrange exactly as the neighbouring getChallengeDetail tests do, with a location
  // round the caller has guessed.
  const result = await sut.getChallengeDetail(auth, challenge.id);

  expect(result.rounds[0].guess).toEqual({
    lat: 38.72,
    lon: -9.14,
    date: null,
    distanceKm: 412.3,
    offsetDays: null,
  });
});

it('returns the caller own guess for a guessed date round', async () => {
  const result = await sut.getChallengeDetail(auth, challenge.id);

  // The inverse column pair. A projection that copies lat/lon into a date round, or
  // offsetDays into a location round, passes any test that only checks `guess` is set.
  expect(result.rounds[0].guess).toEqual({
    lat: null,
    lon: null,
    date: new Date('2024-06-01T00:00:00.000Z'),
    distanceKm: null,
    offsetDays: 3,
  });
});

it('withholds the guess for a round the caller has not guessed', async () => {
  const result = await sut.getChallengeDetail(auth, challenge.id);

  expect(result.rounds[1].guess).toBeUndefined();
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `cd server && pnpm test -- --run src/services/game.service.spec.ts`
Expected: FAIL. The first two on `Object literal may only specify known properties` / `guess` being `undefined`; the third passes already (the field does not exist) — that is fine, it is a regression guard, not the red one.

- [ ] **Step 3: Add the schema**

In `server/src/dtos/game.dto.ts`, above `GameRoundDetailResponseSchema`:

```ts
const GameRoundGuessSchema = z.object({
  lat: z.number().nullable().describe('Guessed latitude, for a location round'),
  lon: z.number().nullable().describe('Guessed longitude, for a location round'),
  date: isoDatetimeToDate.nullable().describe('Guessed date, for a date round'),
  distanceKm: z.number().nullable().describe('Distance from the answer, in km'),
  offsetDays: z.number().nullable().describe('Day offset from the answer'),
});
```

and one field inside `GameRoundDetailResponseSchema`, after `answer`:

```ts
guess: GameRoundGuessSchema.optional().describe("The caller's own guess - present only once guessed"),
```

- [ ] **Step 4: Project it**

In `server/src/services/game.service.ts`, `toRoundDetail` — add to the returned object only, leaving the `if (!guess) return { index, type };` early return untouched:

```ts
      guess: {
        lat: guess.guessLat,
        lon: guess.guessLon,
        date: guess.guessDate,
        distanceKm: guess.distanceKm,
        offsetDays: guess.offsetDays,
      },
```

`score` stays where it is rather than moving inside `guess`, so no existing client field changes shape.

- [ ] **Step 5: Run the tests and verify they pass**

Run: `cd server && pnpm test -- --run src/services/game.service.spec.ts`
Expected: PASS, whole file.

- [ ] **Step 6: Type-check and lint**

Run: `make check-server`, then `cd server && pnpm lint && npx prettier --check .`
Expected: clean. `pnpm lint` is eslint only — the prettier check is separate and has been missed before.

- [ ] **Step 7: Commit**

```bash
git add server/src/dtos/game.dto.ts server/src/services/game.service.ts server/src/services/game.service.spec.ts
git commit -m "feat(game): return the caller's own guess on a played round"
```

---

### Task 2: Server — pin cross-user isolation

The spec's §3.1 invariant. It lands before any client can read the field.

**Files:**

- Test: `server/src/services/game.service.spec.ts`
- Test: `e2e/src/specs/server/api/game.e2e-spec.ts` (~line 375, the existing withholding test)

**Interfaces:**

- Consumes: `GameRoundDetailResponseDto.guess` from Task 1.
- Produces: nothing consumed downstream.

- [ ] **Step 1: Extend the existing e2e positive control**

In `e2e/src/specs/server/api/game.e2e-spec.ts`, the block after `// Positive control: once a round IS guessed...` already proves the answer appears. Add to it, after the guess is submitted and the detail refetched:

```ts
// The guess comes back too, and matches what was actually submitted.
expect(guessedRound.guess).toEqual({
  lat: 38.72,
  lon: -9.14,
  date: null,
  distanceKm: expect.any(Number),
  offsetDays: null,
});
```

**Do not touch** the structural assertion above it:

```ts
expect(Object.keys(round).toSorted((a, b) => a.localeCompare(b))).toEqual(['index', 'type']);
```

That exact-key check already fails if `guess` is ever attached outside the early return, so unguessed-round leakage is covered without a new test.

- [ ] **Step 2: Write the isolation test**

In the same e2e file, a space challenge with two members who guess the same round differently:

```ts
it('never returns another player guess', async () => {
  // Both members guess round 0 with different coordinates.
  await request(app)
    .post(`/games/${challenge.id}/rounds/0/guess`)
    .set('Authorization', `Bearer ${alice.accessToken}`)
    .send({ lat: 38.72, lon: -9.14 });
  await request(app)
    .post(`/games/${challenge.id}/rounds/0/guess`)
    .set('Authorization', `Bearer ${bob.accessToken}`)
    .send({ lat: 51.51, lon: -0.13 });

  const asAlice = await request(app).get(`/games/${challenge.id}`).set('Authorization', `Bearer ${alice.accessToken}`);

  expect(asAlice.body.rounds[0].guess.lat).toBe(38.72);
  // Bob's guess must appear nowhere in Alice's payload, under any key.
  expect(JSON.stringify(asAlice.body)).not.toContain('51.51');
});
```

- [ ] **Step 3: Run them**

Run: `cd e2e && pnpm test -- src/specs/server/api/game.e2e-spec.ts`
Expected: PASS. The isolation test passes against the unmodified tree because `getGuessesForUser(challengeId, auth.user.id)` is already user-scoped. That is expected — Step 4 is what makes it trustworthy.

Note: `e2e`'s test script already includes `--run`; adding another `--run` crashes it.

- [ ] **Step 4: Prove the isolation test can fail**

Temporarily widen the service to load every guess for the challenge instead of the caller's:

```ts
// TEMPORARY - revert immediately after observing the failure
const guesses = await this.gameRepository.getGuesses(challengeId);
```

(If no such repository method exists, drop the `auth.user.id` filter inline in a scratch edit.)

Run the isolation test again. Expected: FAIL on `not.toContain('51.51')`.
Then **revert the edit** with `git checkout -- server/src/services/game.service.ts` and re-run to confirm green.

A guard that has never been observed failing is not a guard. Do this once, here.

- [ ] **Step 5: Commit**

```bash
git add e2e/src/specs/server/api/game.e2e-spec.ts
git commit -m "test(game): pin that a round detail carries only the caller's own guess"
```

---

### Task 3: Regenerate the API clients

**Files:**

- Modify: `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, `mobile/openapi/**`

**Interfaces:**

- Produces: `GameRoundDetailResponseDtoGuess` (Dart class) and `Optional<GameRoundDetailResponseDtoGuess?> guess` on `GameRoundDetailResponseDto` — consumed by Tasks 4 onward.

- [ ] **Step 1: Regenerate**

```bash
cd server && pnpm build && cd ..
cd server && pnpm sync:open-api && cd ..
make open-api
```

Java is required for the Dart generator.

- [ ] **Step 2: Verify the generated Dart shape**

Run: `grep -n "guess" mobile/openapi/lib/model/game_round_detail_response_dto.dart`
Expected: a field declared `Optional<GameRoundDetailResponseDtoGuess?> guess;` defaulting to `const Optional.absent()`.

If it generated as a plain nullable instead, stop — the rest of the plan assumes `Optional`, and every `.orElse(null)` below would be wrong.

- [ ] **Step 3: Check the web gate**

Run: `make check-web`
Expected: clean. No web source changes here, but the SDK regen rewrites web's generated types and this is the only gate that would catch a break.

- [ ] **Step 4: Commit**

```bash
git add open-api mobile/openapi
git commit -m "chore(open-api): regenerate for the round-detail guess field"
```

---

### Task 4: Mobile — `RoundResult.fromRound`

**Files:**

- Modify: `mobile/lib/providers/game/game_session.provider.dart` (`RoundResult`, ~line 18; the inline construction at ~line 222)
- Test: `mobile/test/providers/game/game_session_test.dart`

**Interfaces:**

- Consumes: `GameRoundDetailResponseDto.guess` from Task 3.
- Produces: `RoundResult.fromRound(GameRoundDetailResponseDto round)` → `RoundResult` — consumed by Tasks 6 and 7.

- [ ] **Step 1: Write the failing tests**

```dart
group('RoundResult.fromRound', () {
  test('maps a guessed location round', () {
    final result = RoundResult.fromRound(
      GameRoundDetailResponseDto(
        index: 0,
        type: GameRoundType.location,
        assetId: const Optional.present('asset-1'),
        score: const Optional.present(1842),
        answer: Optional.present(GameRoundDetailResponseDtoAnswer(lat: 41.15, lon: -8.61, date: null)),
        guess: Optional.present(
          GameRoundDetailResponseDtoGuess(lat: 38.72, lon: -9.14, date: null, distanceKm: 412.3, offsetDays: null),
        ),
      ),
    );

    expect(result.type, GameRoundType.location);
    expect(result.score, 1842);
    expect(result.guess?.lat, 38.72);
    expect(result.distanceKm, 412.3);
    expect(result.guessDate, isNull);
  });

  test('maps a guessed date round', () {
    final result = RoundResult.fromRound(
      GameRoundDetailResponseDto(
        index: 1,
        type: GameRoundType.date,
        assetId: const Optional.present('asset-2'),
        score: const Optional.present(2410),
        answer: Optional.present(
          GameRoundDetailResponseDtoAnswer(lat: null, lon: null, date: DateTime.utc(2024, 6, 4)),
        ),
        guess: Optional.present(
          GameRoundDetailResponseDtoGuess(
            lat: null,
            lon: null,
            date: DateTime.utc(2024, 6, 1),
            distanceKm: null,
            offsetDays: 3,
          ),
        ),
      ),
    );

    expect(result.guess, isNull);
    expect(result.guessDate, DateTime.utc(2024, 6, 1));
    expect(result.offsetDays, 3);
  });

  // guessDate is `timestamp with time zone` and arrives as a full ISO instant, so it must survive
  // as one — unlike `dailyOn`, which is date-only and must NOT be converted. Getting those two
  // confused has already shipped twice on this branch. The assertion is on `isUtc` rather than on
  // a rendered string because CI runs UTC, where a wrong conversion is invisible; Task 10 runs the
  // game tests once under a non-UTC TZ to cover the rendering side.
  test('keeps the guessed date as the instant it arrived as', () {
    final result = RoundResult.fromRound(
      GameRoundDetailResponseDto(
        index: 1,
        type: GameRoundType.date,
        score: const Optional.present(2410),
        guess: Optional.present(
          GameRoundDetailResponseDtoGuess(
            lat: null,
            lon: null,
            date: DateTime.utc(2024, 6, 1, 12, 30),
            distanceKm: null,
            offsetDays: 3,
          ),
        ),
      ),
    );

    expect(result.guessDate!.isUtc, isTrue);
    expect(result.guessDate, DateTime.utc(2024, 6, 1, 12, 30));
  });

  // Absent, NOT present(null): `.value` on an Absent THROWS, and only the absent form
  // reproduces the wire shape of an unguessed round. A factory that reads `.value`
  // errors here instead of failing an assertion.
  test('tolerates an unguessed round, whose fields are absent', () {
    final result = RoundResult.fromRound(
      const GameRoundDetailResponseDto(index: 2, type: GameRoundType.location),
    );

    expect(result.score, 0);
    expect(result.guess, isNull);
    expect(result.answer, isNull);
  });
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/providers/game/game_session_test.dart`
Expected: FAIL — `Member not found: 'RoundResult.fromRound'`.

- [ ] **Step 3: Implement the factory**

In `game_session.provider.dart`, on `RoundResult`:

```dart
  /// The single mapping from a stored round onto the reveal's shape.
  ///
  /// Every field here is `Optional<T?>` on the wire and `.value` THROWS when absent, so each read
  /// goes through `.orElse(null)`. An unguessed round yields a result with nulls throughout rather
  /// than an exception, which is what lets a partially played challenge render at all.
  factory RoundResult.fromRound(GameRoundDetailResponseDto round) {
    final guess = round.guess.orElse(null);
    final lat = guess?.lat;
    final lon = guess?.lon;

    return RoundResult(
      type: round.type,
      score: round.score.orElse(null)?.toInt() ?? 0,
      distanceKm: guess?.distanceKm?.toDouble(),
      offsetDays: guess?.offsetDays?.toInt(),
      answer: round.answer.orElse(null),
      guess: lat != null && lon != null ? (lat: lat.toDouble(), lon: lon.toDouble()) : null,
      guessDate: guess?.date,
    );
  }
```

- [ ] **Step 4: Run the tests and verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Route the live guess path through the factory**

The inline `RoundResult(...)` at ~line 222 builds the same struct from the guess response plus a refetch. Keep the guess-response values (they are authoritative for the round just played) but take everything else from the factory, so there is one mapping rather than two that can drift:

```dart
        result: RoundResult.fromRound(round!).copyWithGuess(
          score: score,
          distanceKm: distanceKm,
          offsetDays: offsetDays,
          guess: guess,
          guessDate: guessDate,
        ),
```

Add the matching `copyWithGuess` to `RoundResult`, taking each field as nullable and falling back to the existing value. Keep the existing null-round fallback (`round?.score...`) behaviour: if `round` is null, construct as before.

- [ ] **Step 6: Run the full session tests**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/providers/game/`
Expected: PASS, unchanged behaviour for the live path.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/providers/game/game_session.provider.dart mobile/test/providers/game/game_session_test.dart
git commit -m "feat(mobile): map a stored round onto the reveal's shape in one place"
```

---

### Task 5: Mobile — the five i18n keys

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: the six keys in the Global Constraints table — consumed by Tasks 6 and 7.

- [ ] **Step 1: Add the keys in alphabetical position**

They sort between `game_review_...` neighbours — i.e. after `game_points` and before `game_round_count`. Suggested translations, matching each file's existing register and its own term for the daily challenge:

| Locale    | your_rounds  | round           | type_place | type_date | distance_off             | days_off                                                                                               |
| --------- | ------------ | --------------- | ---------- | --------- | ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `en`      | Your rounds  | Round {index}   | Place      | Date      | {distance} off           | {count, plural, one {# day off} other {# days off}}                                                    |
| `de`      | Deine Runden | Runde {index}   | Ort        | Datum     | {distance} daneben       | {count, plural, one {# Tag daneben} other {# Tage daneben}}                                            |
| `fr`      | Vos manches  | Manche {index}  | Lieu       | Date      | {distance} d'écart       | {count, plural, one {# jour d'écart} other {# jours d'écart}}                                          |
| `it`      | I tuoi round | Round {index}   | Luogo      | Data      | {distance} di scarto     | {count, plural, one {# giorno di scarto} other {# giorni di scarto}}                                   |
| `nl`      | Jouw rondes  | Ronde {index}   | Plaats     | Datum     | {distance} ernaast       | {count, plural, one {# dag ernaast} other {# dagen ernaast}}                                           |
| `pl`      | Twoje rundy  | Runda {index}   | Miejsce    | Data      | {distance} różnicy       | {count, plural, one {# dzień różnicy} few {# dni różnicy} many {# dni różnicy} other {# dnia różnicy}} |
| `es`      | Tus rondas   | Ronda {index}   | Lugar      | Fecha     | {distance} de diferencia | {count, plural, one {# día de diferencia} other {# días de diferencia}}                                |
| `ru`      | Ваши раунды  | Раунд {index}   | Место      | Дата      | {distance} мимо          | {count, plural, one {# день мимо} few {# дня мимо} many {# дней мимо} other {# дня мимо}}              |
| `zh_Hans` | 你的回合     | 第 {index} 回合 | 地点       | 日期      | 相差 {distance}          | 相差 {count} 天                                                                                        |
| `zh_Hant` | 你的回合     | 第 {index} 回合 | 地點       | 日期      | 相差 {distance}          | 相差 {count} 天                                                                                        |

Polish and Russian need `one`/`few`/`many`/`other`; the CLDR rules differ from English's two forms, and a two-form entry renders wrongly at 2–4 days.

- [ ] **Step 2: Format and verify**

```bash
npx prettier --write i18n/*.json
grep -c "game_review_" i18n/en.json i18n/de.json i18n/fr.json i18n/it.json i18n/nl.json i18n/pl.json i18n/es.json i18n/ru.json i18n/zh_Hans.json i18n/zh_Hant.json
```

Expected: `6` for every file.

- [ ] **Step 3: Regenerate the mobile translation code**

`mobile/lib/generated/` is gitignored, so this is a local build step, not a commit:

```bash
cd mobile
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart run easy_localization:generate -S ../i18n
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart run bin/generate_keys.dart
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart format lib/generated/codegen_loader.g.dart lib/generated/translations.g.dart
```

Verify: `grep -c "game_review_your_rounds" lib/generated/translations.g.dart` → `1`.

- [ ] **Step 4: Commit**

```bash
git add i18n
git commit -m "i18n(game): add the round-review strings"
```

---

### Task 6: Mobile — `RoundReviewList`

**Files:**

- Create: `mobile/lib/presentation/widgets/games/round_review_list.widget.dart`
- Test: `mobile/test/presentation/widgets/games/round_review_list_test.dart`

**Interfaces:**

- Consumes: `RoundResult.fromRound` (Task 4), the keys from Task 5, `getGameRoundImageUrl(challengeId, index)`, `formatDistanceKm(double)`, `formatGameScore(num)`.
- Produces: `RoundReviewList({required String challengeId, required List<GameRoundDetailResponseDto> rounds, required void Function(int index) onRoundTap})` — consumed by Task 8.

- [ ] **Step 1: Write the failing tests**

`mobile/test/presentation/widgets/games/round_review_list_test.dart`, pumped with `pumpConsumerWidget` (it wires EasyLocalization, so `.t()` resolves) and a Store initialised as in `daily_challenge_card_test.dart` — `getGameRoundImageUrl` reads `StoreKey.serverEndpoint` and throws otherwise.

```dart
testWidgets('renders one row per guessed round', (tester) async {
  await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)]);

  expect(find.byKey(const Key('round-review-row-0')), findsOneWidget);
  expect(find.byKey(const Key('round-review-row-1')), findsOneWidget);
});

testWidgets('skips a round that was never guessed', (tester) async {
  await pump(tester, rounds: [_guessedLocation(0), _unguessed(1)]);

  expect(find.byKey(const Key('round-review-row-0')), findsOneWidget);
  expect(find.byKey(const Key('round-review-row-1')), findsNothing);
});

testWidgets('a location round shows the distance, a date round the day offset', (tester) async {
  await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)]);

  expect(find.text('412 km off'), findsOneWidget);
  expect(find.text('3 days off'), findsOneWidget);
});

// The heading is the only thing that would otherwise render over nothing.
testWidgets('a challenge with nothing guessed renders no section at all', (tester) async {
  await pump(tester, rounds: [_unguessed(0), _unguessed(1)]);

  expect(find.byKey(const Key('round-review-list')), findsNothing);
});

// A space challenge stays open while other members are still playing, so `closedAt` says nothing
// about whether THIS caller is done. The list keys off their own guesses and nothing else.
testWidgets('lists the caller rounds on a challenge that is still open', (tester) async {
  await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)], closedAt: null);

  expect(find.byKey(const Key('round-review-list')), findsOneWidget);
  expect(find.byKey(const Key('round-review-row-0')), findsOneWidget);
});

testWidgets('tapping a row reports that round index', (tester) async {
  final tapped = <int>[];
  await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)], onRoundTap: tapped.add);

  await tester.tap(find.byKey(const Key('round-review-row-1')));
  await tester.pumpAndSettle();

  expect(tapped, [1]);
});

// getRoundImage 404s for a deleted asset AND for one that is merely no longer eligible —
// trashed, removed from the space, moved to the locked folder. The row must survive it.
testWidgets('a round whose photo no longer resolves still renders its row', (tester) async {
  await pump(tester, rounds: [_guessedLocation(0, assetId: null)]);

  expect(tester.takeException(), isNull);
  expect(find.byKey(const Key('round-review-row-0')), findsOneWidget);
  expect(find.text('412 km off'), findsOneWidget);
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/presentation/widgets/games/round_review_list_test.dart`
Expected: FAIL — the widget does not exist.

- [ ] **Step 3: Implement the widget**

```dart
/// The rounds of a finished challenge, newest game's own order, one row each.
///
/// Only guessed rounds appear: a round with no guess has no photo, no answer and no score, so a
/// placeholder row would be untappable and read as a bug. When nothing was guessed the whole
/// section disappears rather than leaving a heading over an empty list.
class RoundReviewList extends StatelessWidget {
  const RoundReviewList({
    super.key,
    required this.challengeId,
    required this.rounds,
    required this.onRoundTap,
  });

  final String challengeId;
  final List<GameRoundDetailResponseDto> rounds;
  final void Function(int index) onRoundTap;

  @override
  Widget build(BuildContext context) {
    // `score` is the answered marker and is `Optional<num?>` — `.value` THROWS, so this must stay
    // `.orElse(null)`. A score of 0 is a real result and counts as guessed.
    final played = rounds.where((round) => round.score.orElse(null) != null).toList();
    if (played.isEmpty) return const SizedBox.shrink();

    return Column(
      key: const Key('round-review-list'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(4, 24, 4, 8),
          child: Text(
            'game_review_your_rounds'.t(context: context),
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ),
        for (final round in played)
          _ReviewRow(
            key: Key('round-review-row-${round.index.toInt()}'),
            challengeId: challengeId,
            round: round,
            onTap: () => onRoundTap(round.index.toInt()),
          ),
      ],
    );
  }
}
```

and the row itself:

```dart
class _ReviewRow extends StatelessWidget {
  const _ReviewRow({super.key, required this.challengeId, required this.round, required this.onTap});

  final String challengeId;
  final GameRoundDetailResponseDto round;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final index = round.index.toInt();
    final result = RoundResult.fromRound(round);
    final isLocation = result.type == GameRoundType.location;

    final miss = isLocation
        ? 'game_review_distance_off'.t(
            context: context,
            args: {'distance': formatDistanceKm(result.distanceKm ?? 0)},
          )
        : 'game_review_days_off'.t(context: context, args: {'count': '${result.offsetDays ?? 0}'});

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      leading: ClipRRect(
        borderRadius: BorderRadius.circular(9),
        // getRoundImage 404s for a deleted asset and for one that is merely no longer eligible,
        // so this WILL fail for older challenges. Same recovery the live reveal already uses:
        // RoundPhotoPlaceholder. The row's real content is the miss and the score.
        child: SizedBox(
          width: 46,
          height: 46,
          child: Image(
            image: RemoteImageProvider(url: getGameRoundImageUrl(challengeId, index)),
            fit: BoxFit.cover,
            errorBuilder: (_, _, _) => const RoundPhotoPlaceholder(),
          ),
        ),
      ),
      title: Text(
        '${'game_review_round'.t(context: context, args: {'index': '${index + 1}'})} · '
        '${(isLocation ? 'game_review_type_place' : 'game_review_type_date').t(context: context)}',
        maxLines: 1,
        overflow: TextOverflow.ellipsis,
      ),
      subtitle: Text(miss, maxLines: 1, overflow: TextOverflow.ellipsis),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(formatGameScore(result.score), style: Theme.of(context).textTheme.labelLarge),
          const Icon(Icons.chevron_right),
        ],
      ),
      onTap: onTap,
    );
  }
}
```

The row title uses `game_review_round`, not the existing `game_round_progress`
(`Round {current} of {total}`) — repeating "of 5" on all five rows is noise the list does not need.

- [ ] **Step 4: Run the tests and verify they pass**

Run the same command. Expected: PASS, all six.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/games/round_review_list.widget.dart mobile/test/presentation/widgets/games/round_review_list_test.dart
git commit -m "feat(mobile): list the rounds of a finished challenge"
```

---

### Task 7: Mobile — the review route and `RoundReveal`'s review mode

**Files:**

- Create: `mobile/lib/pages/games/game_round_review.page.dart`
- Modify: `mobile/lib/presentation/widgets/games/round_reveal.widget.dart:82-86`
- Modify: `mobile/lib/routing/router.dart` (beside `GamePlayRoute`, ~line 174)
- Test: `mobile/test/routing/router_test.dart`, `mobile/test/presentation/widgets/games/round_reveal_test.dart`

**Interfaces:**

- Consumes: `RoundResult.fromRound` (Task 4), `gameSessionProvider`.
- Produces: `GameRoundReviewRoute({required String challengeId, required int index})` — consumed by Task 8.

- [ ] **Step 1: Write the failing route test**

In `mobile/test/routing/router_test.dart`, in the existing `AppRouter duplicate guard` group:

```dart
// The review route opens one round from a list that can itself sit on the reveal's own back
// stack, so a future iteration opening another round FROM the reveal is one step away — and at
// that point a name-based guard would cancel it silently, exactly as it did for Play again.
test('GameRoundReviewRoute can push itself, for round-to-round review', () {
  expect(guardsOf('GameRoundReviewRoute').whereType<DuplicateGuard>(), isEmpty);
});
```

- [ ] **Step 2: Write the failing reveal test**

In `round_reveal_test.dart`:

```dart
testWidgets('review mode offers Done instead of Next round', (tester) async {
  var popped = 0;
  await pump(tester, reviewing: true, onNext: () => popped++);

  expect(find.text('Done'), findsOneWidget);
  expect(find.text('Next round'), findsNothing);

  await tester.tap(find.byKey(const Key('round-reveal-next')));
  await tester.pumpAndSettle();
  expect(popped, 1);
});
```

- [ ] **Step 3: Run both and verify they fail**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/routing/router_test.dart test/presentation/widgets/games/round_reveal_test.dart`
Expected: FAIL — no such route; no `reviewing` parameter.

- [ ] **Step 4: Add the reveal's review mode**

In `round_reveal.widget.dart`, add `this.reviewing = false` to the constructor and `final bool reviewing;`, then swap the label:

```dart
            child: Text((reviewing ? 'done' : 'game_next_round').t(context: context)),
```

- [ ] **Step 5: Add the page and register the route**

```dart
/// One round of a finished challenge, re-opened read-only.
///
/// Reuses the live reveal rather than a second rendering of the same facts: everything it needs is
/// on the round once the caller has guessed it, and `RoundResult.fromRound` is the one mapping.
@RoutePage()
class GameRoundReviewPage extends ConsumerWidget {
  const GameRoundReviewPage({super.key, required this.challengeId, required this.index});

  final String challengeId;
  final int index;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(gameSessionProvider(challengeId));
    final rounds = session.valueOrNull?.challenge.rounds;
    final round = rounds != null && index < rounds.length ? rounds[index] : null;

    return Scaffold(
      appBar: AppBar(title: Text('game_play'.t(context: context))),
      body: round == null
          ? const Center(child: CircularProgressIndicator())
          : RoundReveal(
              challengeId: challengeId,
              index: index,
              result: RoundResult.fromRound(round),
              reviewing: true,
              onNext: () => unawaited(context.router.maybePop()),
            ),
    );
  }
}
```

In `router.dart`, beside `GamePlayRoute` — note the guard list:

```dart
    // No _duplicateGuard, for the same reason GamePlayRoute and FolderRoute omit it: see the
    // comment above.
    AutoRoute(page: GameRoundReviewRoute.page, guards: [_authGuard]),
```

Then regenerate the router: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart run build_runner build --delete-conflicting-outputs` (this is the one task that needs it — `router.gr.dart` is committed).

- [ ] **Step 6: Run both tests and verify they pass**

Run the same command as Step 3. Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/pages/games/game_round_review.page.dart mobile/lib/presentation/widgets/games/round_reveal.widget.dart mobile/lib/routing/router.dart mobile/lib/routing/router.gr.dart mobile/test/routing/router_test.dart mobile/test/presentation/widgets/games/round_reveal_test.dart
git commit -m "feat(mobile): open one round of a finished challenge in the reveal"
```

---

### Task 8: Mobile — mount the review on both endings

**Files:**

- Modify: `mobile/lib/pages/games/game_play.page.dart` (`_SoloCompleted` ~line 248, `_Completed` ~line 155)
- Test: `mobile/test/presentation/pages/games/game_play_page_test.dart`

**Interfaces:**

- Consumes: `RoundReviewList` (Task 6), `GameRoundReviewRoute` (Task 7).

- [ ] **Step 1: Write the failing tests**

```dart
testWidgets('a finished solo game lists its rounds under the score', (tester) async {
  await pump(tester, /* a finished solo challenge with two guessed rounds */);

  expect(find.byKey(const Key('solo-score-total')), findsOneWidget);
  expect(find.byKey(const Key('round-review-list')), findsOneWidget);
});

testWidgets('a finished space game lists its rounds under the leaderboard', (tester) async {
  await pump(tester, /* a finished space challenge with a leaderboard */);

  expect(find.byKey(const Key('game-leaderboard-row-u1')), findsOneWidget);
  expect(find.byKey(const Key('round-review-list')), findsOneWidget);
});

testWidgets('tapping a round opens its review', (tester) async {
  final router = FakeStackRouter();
  await pump(tester, router: router, /* finished solo challenge */);

  await tester.tap(find.byKey(const Key('round-review-row-0')));
  await tester.pumpAndSettle();

  expect(router.pushed.single, isA<GameRoundReviewRoute>());
});
```

- [ ] **Step 2: Run them and verify they fail**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/presentation/pages/games/game_play_page_test.dart`
Expected: FAIL — no `round-review-list` in either ending.

- [ ] **Step 3: Mount it**

In `_SoloCompleted`'s `ListView`, after the `Play again` button; in `_Completed`'s `ListView`, after the leaderboard rows. Both:

```dart
        RoundReviewList(
          challengeId: challenge.id,
          rounds: challenge.rounds,
          onRoundTap: (index) =>
              unawaited(context.pushRoute(GameRoundReviewRoute(challengeId: challenge.id, index: index))),
        ),
```

`_Completed` currently receives only `leaderboard`, `roundCount` and `currentUserId` — give it the `challenge` it needs, from `state.challenge` at the call site in `_body`.

- [ ] **Step 4: Run the tests and verify they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/pages/games/game_play.page.dart mobile/test/presentation/pages/games/game_play_page_test.dart
git commit -m "feat(mobile): show the round review on both finished screens"
```

---

### Task 9: Mobile — the 409 recovery reveal plots its guess

**Files:**

- Modify: `mobile/lib/providers/game/game_session.provider.dart` (the 409 recovery path)
- Test: `mobile/test/providers/game/game_session_test.dart`

- [ ] **Step 1: Write the failing test**

```dart
// A guess that was already recorded server-side (409) previously revealed with no pin, because
// the client could not recover its own guess. The refetched detail now carries it.
test('the 409 recovery reveal plots the guess the server already had', () async {
  // repository stubbed to throw ApiException(409) on guess, and to return a detail whose
  // round 0 carries guess {lat: 38.72, lon: -9.14, distanceKm: 412.3}.
  await controller.guessLocation(lat: 38.72, lon: -9.14);

  final result = container.read(gameSessionProvider('c1')).valueOrNull?.result;
  expect(result?.guess?.lat, 38.72);
  expect(result?.distanceKm, 412.3);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test test/providers/game/game_session_test.dart`
Expected: FAIL — `result.guess` is null.

- [ ] **Step 3: Implement**

On the 409 path, build the result with `RoundResult.fromRound(round)` and do not override the guess fields — the refetched round is now the authoritative source for them.

- [ ] **Step 4: Update the doc comment**

`RoundResult`'s comment states the 409 path has no guess to plot. That is no longer true. Rewrite it to say the guess is now recovered from the refetch, and that `guess` remains null only on date rounds (which have no lat/lon to plot).

- [ ] **Step 5: Run and verify it passes**

Run the same command. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/providers/game/game_session.provider.dart mobile/test/providers/game/game_session_test.dart
git commit -m "fix(mobile): plot the guess on a 409 recovery reveal"
```

---

### Task 10: Full gate run

- [ ] **Step 1: Server and e2e**

```bash
cd server && pnpm test -- --run && cd ..
make check-server
cd server && pnpm lint && npx prettier --check . && cd ..
cd e2e && pnpm test -- src/specs/server/api/game.e2e-spec.ts && cd ..
```

- [ ] **Step 2: Mobile**

```bash
cd mobile
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart analyze --fatal-infos
~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/dart format --set-exit-if-changed $(find lib -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
```

`lib` only. Formatting `test/` churns ~40 unrelated files that CI does not gate.

Then the game tests once more under a non-UTC zone, which is the only way a date-handling
regression surfaces — CI runs UTC, where converting and not converting are identical:

```bash
TZ=Pacific/Auckland ~/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin/flutter test \
  test/providers/game/ test/presentation/widgets/games/ test/utils/game_format_test.dart
```

- [ ] **Step 3: Web and i18n**

```bash
make check-web
npx prettier --check "i18n/*.json"
```

- [ ] **Step 4: Report**

State the actual numbers — tests passed per suite, and any gate not run — rather than "all green".
