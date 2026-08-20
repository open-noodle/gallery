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

`GameService.getChallengeDetail` already fetches them:

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

`cd server && pnpm build`, then `pnpm sync:open-api`, then `make open-api` for the TypeScript SDK
and the Dart client. Java is required for the Dart generator.

## 4. Mobile: what the player sees

Opening a finished challenge lands on the review. The total and `Play again` stay at the top — they
are still what a solo player wants after a game — and the rounds are the body of the screen.

Each row carries:

- the round's photo, via the existing `getGameRoundImageUrl` (the round-scoped endpoint, not the
  asset one)
- `Round {current} of {total}`
- how close it was: `You were 412 km away` / `You were 3 days off`
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

Almost nothing is new, because the reveal already says these things:

| Need                   | Key                                                  |
| ---------------------- | ---------------------------------------------------- |
| Row title              | `game_round_progress` — `Round {current} of {total}` |
| Distance miss          | `game_you_were_away` — `You were {distance} away`    |
| Date miss              | `game_you_were_off` — `You were {offset} off`        |
| Round score            | `game_points`                                        |
| Reveal button (review) | `done`                                               |

One new key: a heading for the list, `game_review_your_rounds` ("Your rounds"). Per `CLAUDE.md` it
lands in all ten maintained locales in the same commit — `en` plus `de`, `fr`, `it`, `nl`, `pl`,
`es`, `ru`, `zh_Hans`, `zh_Hant` — matching each file's existing register and its own word for a
space, then `npx prettier --write i18n/*.json`.

The round's **type** deliberately gets no new string. `game_type_location` / `game_type_date` are
"Places" / "Dates", plural because they label a challenge type rather than one round; putting
"Places" on a single row reads oddly. The distance line already implies the type — a round that
reports kilometres is a place round — so the row shows the miss and omits the type entirely.

## 10. Testing

Server:

- `toRoundDetail` emits `guess` for a guessed round and omits it for an unguessed one.
- Location rounds carry `lat`/`lon`/`distanceKm` with `date`/`offsetDays` null; date rounds the
  inverse. The two round types genuinely populate different columns, and a projection that copies
  the wrong pair is invisible to a test that only checks presence.
- **The anti-leakage test (§3.1):** two players guess the same round differently; each one's detail
  returns their own guess and never the other's. This is the test that must exist even though the
  current query shape makes it pass trivially.

Mobile:

- `RoundResult.fromRound` for both round types, and for an unguessed round.
- `RoundReviewList`: renders one row per guessed round, skips unguessed ones, shows distance for a
  location round and the day offset for a date round.
- Tapping a row pushes `GameRoundReviewRoute` with that round's index — asserted against a real
  route table, not only a `FakeStackRouter`, since a fake router cannot see a guard. (See
  `mobile/test/routing/router_test.dart`.)
- `RoundReveal` in review mode shows `done` and pops rather than advancing.
- The 409 recovery reveal now plots a guess.

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
