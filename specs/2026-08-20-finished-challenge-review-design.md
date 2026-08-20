# PhotoGuesser — Reviewing a Finished Challenge

Status: approved, not yet implemented
Scope: server DTO + mobile. Web deliberately deferred (§11).

## 1. What this is

Re-opening a challenge you have already played shows `Completed`, a total, and `Play again`. Nothing
about the rounds: not the photos, not where you guessed, not how close you were. The game you just
spent five rounds on collapses to one number.

This adds a **review**: a per-round list on the finished screen, and the full reveal for any round
you tap. Opening a played challenge lands on that list.

Everything it needs is already persisted. The only reason it cannot be built today is that the
challenge-detail endpoint loads the caller's guesses and then throws most of them away.

## 2. What is already stored, and what is not

| Table        | Columns that matter                                                      |
| ------------ | ------------------------------------------------------------------------ |
| `game_round` | `assetId`, `answerLat`, `answerLon`, `answerDate`                        |
| `game_guess` | `guessLat`, `guessLon`, `guessDate`, `distanceKm`, `offsetDays`, `score` |

`GameChallengeDetailResponseDto` returns, per round and only once the caller has guessed it:
`assetId`, `score`, `answer`. It does **not** return the caller's own guess. Those fields reach a
client exactly once — in the response to the guess that created them — and are then unrecoverable.

`GameService.get` (the challenge-detail endpoint) already fetches them:

```ts
const [rounds, guesses] = await Promise.all([
  this.gameRepository.getRounds(challengeId),
  this.gameRepository.getGuessesForUser(challengeId, auth.user.id),
]);
const guessByRoundId = new Map(guesses.map((guess) => [guess.roundId, guess]));
rounds.map((round) => this.toRoundDetail(round, guessByRoundId.get(round.id)));
```

`toRoundDetail` receives the guess row and projects only `score` from it. So the server work is a
schema field and a projection — no new query, no repository change.

## 3. Server change

Add a guess object to the round detail:

```ts
const GameRoundGuessSchema = z.object({
  lat: z.number().nullable().describe('Guessed latitude, for a location round'),
  lon: z.number().nullable().describe('Guessed longitude, for a location round'),
  date: isoDatetimeToDate.nullable().describe('Guessed date, for a date round'),
  distanceKm: z.number().nullable().describe('Distance from the answer, in km'),
  offsetDays: z.number().nullable().describe('Day offset from the answer'),
});
```

and one optional field on `GameRoundDetailResponseSchema`:

```ts
guess: GameRoundGuessSchema.optional().describe("The caller's own guess - present only once guessed"),
```

`toRoundDetail` gains the projection. `score` stays where it is rather than moving inside `guess`,
so no existing client field changes shape.

### 3.1 This adds no access surface

The invariant that matters is that a player can never see another player's guess, and it holds for
free: the guesses come from `getGuessesForUser(challengeId, auth.user.id)`, so the only guess row
`toRoundDetail` can ever hold is the caller's own. The early return when that row is absent is the
same gate that already withholds `answer` and `assetId` from an unguessed round — the new field
rides on it rather than adding a second rule.

The leaderboard remains the only place another player's numbers appear, and it exposes totals, not
guesses. **A test must pin this** (§10), because "we happen to only load our own row" is exactly the
kind of implicit guarantee a later refactor breaks silently.

### 3.2 Regeneration

`mise open-api` — one task, which chains the server build, the spec sync, the TypeScript SDK and
the Dart client. Java is required for the Dart generator.

Not `make open-api`: that target has been removed and now exits with an error pointing at mise. The
same applies to the checks below — `make check-server` / `make check-web` no longer exist either.
`CLAUDE.md` still documents all three and is stale.

## 4. Mobile: what the player sees

Opening a finished challenge lands on the review. The total and `Play again` stay at the top — they
are still what a solo player wants after a game — and the rounds are the body of the screen.

Each row carries:

- the round's photo, via the existing `getGameRoundImageUrl` (the round-scoped endpoint, not the
  asset one)
- `Round 1 · Place` / `Round 2 · Date`
- how close it was: `412 km off` / `3 days off`
- the round's score
- a chevron, because the row opens something

Tapping a row opens that round's full reveal — the map with both pins for a location round, the two
dates for a date round — with `Done` returning to the list.

## 5. Reuse, and the one new widget

The reveal already exists and already renders exactly this. `RoundReveal` takes a `RoundResult`:

```dart
class RoundResult {
  final GameRoundType type;
  final int score;
  final double? distanceKm;
  final int? offsetDays;
  final GameRoundDetailResponseDtoAnswer? answer;
  final ({double lat, double lon})? guess;
  final DateTime? guessDate;
}
```

Every field of that is on a finished round once §3 lands. So:

- **`RoundResult.fromRound(GameRoundDetailResponseDto)`** — a factory, and the single place that maps
  a stored round onto the reveal's shape. Today the same struct is assembled inline in
  `GameSessionController` from a mix of the guess response and a refetch; that call site moves onto
  the factory as part of this work, so there is one mapping rather than two that can drift.
- **`RoundReviewList`** — the only genuinely new widget. A list of rows over
  `challenge.rounds`, skipping any round with no guess (see §7).
- **`RoundReveal`** gains an optional label for its advance button. It hardcodes
  `game_next_round`; in review mode that button reads `done` and pops.

### 5.1 Routing

A new `GameRoundReviewRoute(challengeId, index)`, pushed from the finished screen.

It must **not** carry `_duplicateGuard`. That is not a hypothetical: the guard compares route names,
which are argument-independent const strings, and it silently cancelled `Play again` for exactly
that reason (fixed in `1c531f08b82`). This route is pushed from `GamePlayPage`, a different name, so
the guard would not misfire today — but a review route that can open another round from within
itself is one obvious iteration away, and at that point it would. Leave it off, like `FolderRoute`.

## 6. Where it mounts

Both endings, since both have the same hole:

- `_SoloCompleted` — total, `Play again`, then the list.
- `_Completed` (space) — the leaderboard keeps the top of the screen, the list goes beneath it. A
  space challenge's ending answers "how did I do against everyone", and this adds "and what did I
  actually get wrong".

## 7. Partially played challenges

A challenge can be abandoned halfway: rounds after the last guess have no `guess`, no `answer` and
no `assetId`. The list shows only guessed rounds. It does not render a placeholder row for the rest,
because there is nothing to show and nothing to tap, and a greyed row that rejects taps reads as a
bug.

`firstUnansweredIndex` already identifies the boundary and needs no change.

## 8. The 409 fix that falls out

`GameSessionController`'s 409 recovery path — the one that runs when a guess was already recorded,
typically after a retry — currently reveals with `guess == null`, because the client cannot recover
its own guess from the server. `RoundResult`'s doc comment says so:

> `[guess]` is null in two cases … on the 409 recovery path, where that request never reached the
> server so there is no guess of ours to plot

Once the detail carries the guess, that path can populate it from the refetch, and the recovery
reveal stops being visibly poorer than the normal one. This is the same missing field, so it is in
scope here rather than a follow-up — but it is a distinct behaviour with its own test.

## 9. i18n

The list gets its own copy rather than borrowing the reveal's. The reveal's strings are full
sentences written for a screen with room — `You were 412 km away` — and they read badly in a 46dp
list row next to a thumbnail and a score. They stay exactly as they are, in the reveal.

Reused as-is:

| Need                         | Key           |
| ---------------------------- | ------------- |
| Round score                  | `game_points` |
| Reveal button in review mode | `done`        |

Six new keys, landing in all ten maintained locales in the same commit — `en` plus `de`, `fr`, `it`,
`nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant` — each matching that file's existing register, then
`npx prettier --write i18n/*.json`:

| Key                        | English                                             |
| -------------------------- | --------------------------------------------------- |
| `game_review_your_rounds`  | Your rounds                                         |
| `game_review_round`        | Round {index}                                       |
| `game_review_type_place`   | Place                                               |
| `game_review_type_date`    | Date                                                |
| `game_review_distance_off` | {distance} off                                      |
| `game_review_days_off`     | {count, plural, one {# day off} other {# days off}} |

`game_review_round` is `Round {index}` rather than the existing `game_round_progress`
(`Round {current} of {total}`), which would repeat "of 5" on every row of a five-round list.

Two more things about that set are deliberate.

`game_review_type_place` / `game_review_type_date` are **singular**, and separate from the existing
`game_type_location` / `game_type_date`, which are "Places" / "Dates". Those label a challenge's
type; reusing them would put "Places" on a single round.

`game_review_distance_off` interpolates an **already-formatted** distance from `formatDistanceKm`,
which picks metres or kilometres and the decimal precision. The key receives a rendered string, not a
number — the same contract `game_you_were_away` already uses, so translators see a consistent shape.
`game_review_days_off` is ICU-plural instead, matching `game_days_played`, because the day count is a
real number and Polish and Russian need more than a two-form rule.

There is no "tap to revisit" hint. The chevron carries that, and the earlier mockup's version of the
heading was decoration the row does not need.

## 10. Testing

### 10.0 Test-driven, and what "red first" means here

Every piece below is written test-first: a failing test, the smallest change that passes it, then
refactor. Two rules keep that honest rather than ceremonial.

**A test must be proven red before it is committed green.** For a new DTO field the easy "red" is a
compile error — the Dart field does not exist yet — and that proves nothing about the assertion. So
for each test, name the _assertion_ that fails and see it fail, not merely the build.

**The invariant test comes before the feature.** Cross-user isolation (§3.1) is the property this
change could plausibly break, so it is written first even though it starts green (§10.1).

| Slice                        | First failing test                                                    | Red today?                  |
| ---------------------------- | --------------------------------------------------------------------- | --------------------------- |
| Cross-user isolation (§3.1)  | Two players guess one round; each detail carries only their own guess | **No — see §10.1**          |
| Server projection (§3)       | A guessed location round returns `guess.lat/lon/distanceKm`           | Yes — field does not exist  |
| `RoundResult.fromRound` (§5) | A guessed location round maps to a result with a non-null `guess`     | Yes                         |
| `RoundReviewList` (§5)       | One row per guessed round, none for unguessed                         | Yes — widget does not exist |
| Deleted asset (§10.4)        | A guessed round whose photo was deleted still renders its row         | Yes                         |
| Review route (§5.1)          | `GameRoundReviewRoute` is registered without `DuplicateGuard`         | Yes — route does not exist  |
| 409 recovery (§8)            | The recovery reveal plots a guess instead of nothing                  | Yes                         |

### 10.1 The assertions that would pass either way

Three of the tests here are at risk of proving nothing. Each needs deliberate handling.

**Cross-user isolation starts green.** `getGuessesForUser(challengeId, auth.user.id)` is already
user-scoped, so the test passes against the unmodified tree. It is a regression guard, not a red-first
test, and it must still be shown capable of failing: widen that repository call to fetch every guess
for the challenge, watch the test go red, revert. Do that once, before committing it.

**Unguessed-round leakage is already covered — do not duplicate it.**
`e2e/src/specs/server/api/game.e2e-spec.ts` asserts the exact key set of a withheld round:

```ts
expect(Object.keys(round).toSorted(...)).toEqual(['index', 'type']);
```

Attaching `guess` anywhere but inside the existing `if (!guess) return` turns that red on its own.
Leave it exactly as it is; extend only the _positive control_ below it, which currently proves the
answer appears once guessed, to prove `guess` appears too and matches what was submitted.

**A thrown `Absent` is not a red.** Every optional field on this DTO generates as
`Optional<T?>` in Dart, and `.value` **throws** when absent — `answer` and `score` already carry that
warning at their call sites. A mobile assertion that reads the new field with `.value` will throw on
an unguessed round rather than fail an assertion, which reads as an error, not as a meaningful
failure. Every read goes through `.orElse(null)`, and §10.3 pins that directly.

### 10.2 Server

In `game.service.spec.ts`:

- A guessed **location** round returns `guess` with `lat`, `lon`, `distanceKm`, and null
  `date`/`offsetDays`. A guessed **date** round returns the inverse. Both cases are needed: the two
  round types populate genuinely different columns, and a projection that copies the wrong pair
  passes any test that only checks `guess` is present.
- An unguessed round returns no `guess` key at all — asserted structurally, matching the existing
  `toBeUndefined` style at `game.service.spec.ts:518`.
- Cross-user isolation, per §10.1.

In `e2e/src/specs/server/api/game.e2e-spec.ts`: extend the positive control as described above, and
add the two-player isolation case at the API level, since that is where a future repository change
would actually bite.

No repository change means `game.repository.spec.ts` and the medium specs need no new cases. **Do not
run `make sql`** — no decorated query changes, and running it without a live database deletes every
generated query file.

### 10.3 Mobile

`RoundResult.fromRound`:

- Both round types map to the right fields.
- An unguessed round maps to a result with a null `guess` and does not throw. This is the
  `Optional` trap from §10.1 — build the fixture with a genuinely **absent** field, not a null one,
  because `Optional.absent()` and `Optional.present(null)` fail differently and only the former
  reproduces the wire shape.
- A round whose `answer` is absent tolerates it rather than throwing.

`RoundReviewList`:

- One row per guessed round; unguessed rounds produce no row.
- A location round shows the distance, a date round the day offset.
- A challenge with **no** guessed rounds renders no list section at all — not an empty heading over
  nothing.
- Tapping a row pushes `GameRoundReviewRoute` carrying that round's index.

Routing, in `mobile/test/routing/router_test.dart`: the review route is registered without
`DuplicateGuard`, asserted against the **real** route table. A `FakeStackRouter` records pushes
without running guards, so a widget test alone cannot see this — that is exactly how the `Play again`
regression reached a device with a green suite.

`RoundReveal` in review mode shows `done` and pops rather than advancing.

Both endings mount the list: `_SoloCompleted`, and `_Completed` with the list below the leaderboard.

The 409 recovery reveal now plots a guess.

**`guessDate` is an instant, not a calendar day.** It is `timestamp with time zone`, so it behaves
like `createdAt` and must be converted, unlike `dailyOn`, which is date-only and must not be. That
distinction has already produced two shipped bugs on this branch, and CI cannot catch a regression of
either because the runner is UTC, where converting and not converting are identical. The date-round
review test therefore runs under a non-UTC `TZ`.

### 10.4 Edge cases with no existing baseline

| Case                                       | Why it is not hypothetical                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A round's photo no longer resolves**     | `getRoundImage` 404s when the asset was deleted (`assetId` is `ON DELETE SET NULL`) **and also when it still exists but is no longer eligible** — it re-applies the candidate predicate on every request, so trashing the photo, removing it from the space, or moving it to the locked folder all 404 too. The thumbnail URL is keyed by `(challengeId, index)` and is always well-formed, so this is a failed load, not a null URL: every row needs an error fallback, and a review of an older challenge is exactly where it will show up. |
| Challenge abandoned before any guess       | Produces an empty review; §7 says the section disappears, and that needs pinning.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Every round guessed but the challenge open | A challenge is not "closed" just because the caller finished it. The review must key off the caller's guesses, not `closedAt`.                                                                                                                                                                                                                                                                                                                                                                                                                |

### 10.5 Gates

Server `pnpm test` and `pnpm test:medium`, `mise //server:check`, eslint and prettier. The game e2e
specs. Mobile `flutter test`, `dart analyze --fatal-infos`, `dart format` over `lib`. `mise //web:check`
— the SDK regen changes web's generated types even though no web code changes here, and that gate is
the only thing that would catch a break. The six new i18n keys land in all ten locales with
`npx prettier --write i18n/*.json`.

## 11. Out of scope

- **Web.** Its solo ending is the same bare score and `Play again`
  (`web/src/routes/(user)/photoguesser/[challengeId=id]/+page.svelte`), so it has the same gap. The
  server field serves both, and the web review is a follow-up rather than part of this.
- Sharing or exporting a finished game.
- Any change to scoring, or to what the live play loop shows.

## 12. Open questions

None blocking. One judgement call worth revisiting after it ships: whether the space ending should
default to the leaderboard or to your own rounds when a challenge has many players. This spec puts
the leaderboard first; if the review turns out to be what people open it for, that order is cheap to
flip.
