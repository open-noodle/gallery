# Mobile photo guessing game

Date: 2026-08-18
Status: designed

## Context

The photo guessing game ships on this branch as a server feature with a web client. Mobile has no
game code at all. This design covers the Flutter client, which the original design listed under
"out of scope for v1" (`2026-08-15-photo-guessing-game-design.md` §11).

Three things are already done and must not be redone:

- **Nine operations across seven routes**, scoring, the per-space daily, monthly standings, and the
  per-space opt-in.
- **The Dart OpenAPI client is generated** — `mobile/openapi/lib/api/games_api.dart` carries all
  nine methods (`getDailyChallenge`, `getChallenges`, `getChallenge`, `guessRound`,
  `getLeaderboard`, `getStandings`, `createChallenge`, `deleteChallenge`, `getRoundImage`), and both
  space DTOs already carry `dailyChallengeEnabled`.
  **`getRoundImage` is deliberately unused.** It returns a `MultipartFile`, which cannot feed an
  `ImageProvider` without buffering the whole body in Dart and bypassing the native image cache.
  Round photos go through `RemoteImageProvider` over a URL instead (see the answer-leak rules).
- **All 51 `game_*` i18n keys exist in all ten maintained locales.**

**This feature therefore requires zero server changes, zero migrations, and no OpenAPI
regeneration.** Everything below is Flutter and i18n. If a task in the implementation plan proposes
a server edit, that is a signal the task is wrong.

What mobile already has to build on:

| Asset                                                        | Why it matters                                                   |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `maplibre_gl ^0.26.0`                                        | Guess and reveal maps, including `addCircle` / `addLine`         |
| `mobile/lib/pages/search/map/map_location_picker.page.dart`  | A working tap-to-drop-a-pin recipe over a bare `MapLibreMap`     |
| `RemoteImageProvider({required url})`                        | Takes an arbitrary URL, so round images need no new loader       |
| `flutter_local_notifications ^17.2.4`, initialised in `main` | The daily reminder needs no new dependency                       |
| `initializeTimeZones()` already called in `main.dart`        | `zonedSchedule` requires it; it is already there                 |
| The notification settings page's permission flow             | The reminder toggle reuses it rather than adding a second prompt |
| `SharedSpaceApiRepository`                                   | The exact shape `GameApiRepository` copies                       |

## Decisions

| Decision               | Choice                                                                          |
| ---------------------- | ------------------------------------------------------------------------------- |
| Scope                  | Full parity with web — play, create, delete, leaderboard, standings, opt-in     |
| Placement              | Daily card in the space top sliver, plus a `Challenges` item in the space kebab |
| Location guess surface | Split, photo over map, map dismissible via ✕                                    |
| Date guess surface     | Month/year wheel picker                                                         |
| Reveal                 | Map-first for location rounds, a separate tick-strip layout for date rounds     |
| Play-flow state        | `GameSessionController`, a Riverpod notifier family keyed by challenge id       |
| Persistence            | None. Network-only; games never touch Drift                                     |
| Daily reminder         | Local scheduled notification — no push infrastructure exists and none is built  |
| Reminder skip rule     | Skip an occurrence if any daily was finished on that occurrence's UTC day       |
| Server changes         | None                                                                            |

### Why the location surface is a dismissible split

Web floats a mini-map over the photo that expands on hover. Touch has no hover, and
`location-round.svelte` concedes it in a comment: on a phone the first tap only expands the map, so
a tap can never be a guess. GeoGuessr's own app ships the split as the resting state and puts a ✕ on
the map so the photo can be inspected full-bleed. That is what this copies.

A fixed split without the ✕ was considered and rejected: it pins the photo at roughly 230 px on a
5.5″ device, which is thin for the road sign or shopfront that usually decides a location round, and
pinch-zooming a 40 % pane is a poor substitute. A two-step flow that reuses `MapLocationPickerPage`
was also rejected — it never shows the photo and the map together, so re-checking a detail costs a
pop, and it adds two taps to every round of every challenge.

### Why the date surface is a wheel picker

The server grades date rounds at month granularity, so the control need only produce a month and a
year. Web's year slider spans fifty-odd years, which on a phone is roughly five pixels per year —
precision by accident. A platform wheel picker is precise, native, and free. Its cost is that it
hides the span of the pool, which is accepted.

### Why the reveal is map-first

`round-result.svelte` documents a flaw it could not fix: `Map.svelte` draws every marker with the
same icon, so the guess pin and the answer pin are visually identical, and two guesses within ~35 px
collapse into a single cluster badge — worst exactly when the player did best. Mobile is not bound by
`Map.svelte` and uses two `addCircle` annotations in different colours plus an `addLine` between
them. Circles rather than symbols because `MapMarkers.addMarkerAtLatLng` hardcodes one shared
`assets/location-pin.png` image id, so two symbol markers would reproduce the same flaw.

### Why the play flow gets a controller

The flow's state is genuinely awkward, and web handles it with page-local `$state` plus long
explanatory comments. Housing it in a Riverpod notifier makes each sharp edge a plain unit test
against a fake repository rather than a pumped, routed page — which matters here, because
widget-only coverage of state logic is the shape that has produced false-green mobile tests in this
repo before.

## Architecture

### New files

```
mobile/lib/repositories/game_api.repository.dart
mobile/lib/providers/game/game.provider.dart              daily / challenges / detail / standings
mobile/lib/providers/game/game_session.provider.dart      GameSessionController
mobile/lib/providers/game/daily_reminder.provider.dart    scheduling side effects
mobile/lib/utils/game_format.dart                         pure helpers ported from web
mobile/lib/utils/daily_reminder_schedule.dart             pure scheduling policy
mobile/lib/pages/library/spaces/games/space_games.page.dart
mobile/lib/pages/library/spaces/games/game_play.page.dart
mobile/lib/presentation/widgets/games/daily_challenge_card.widget.dart
mobile/lib/presentation/widgets/games/daily_challenge_prompt.widget.dart
mobile/lib/presentation/widgets/games/challenge_card.widget.dart
mobile/lib/presentation/widgets/games/challenge_create_sheet.widget.dart
mobile/lib/presentation/widgets/games/standings_section.widget.dart
mobile/lib/presentation/widgets/games/location_round.widget.dart
mobile/lib/presentation/widgets/games/date_round.widget.dart
mobile/lib/presentation/widgets/games/round_reveal.widget.dart
```

### Edited files

| File                                                         | Change                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `utils/image_url_builder.dart`                               | Add `getGameRoundImageUrl(challengeId, index)`           |
| `repositories/shared_space_api.repository.dart`              | `update` gains a `dailyChallengeEnabled` parameter       |
| `presentation/widgets/spaces/space_detail_kebab.widget.dart` | A `Challenges` item                                      |
| `presentation/widgets/spaces/space_top_sliver.widget.dart`   | The daily card slot and its height reservation           |
| `pages/library/spaces/space_detail.page.dart`                | Wire the kebab item and pass the tri-state to the sliver |
| `routing/router.dart`                                        | `SpaceGamesRoute`, `GamePlayRoute`                       |
| `domain/models/settings_key.dart`                            | Three reminder keys                                      |
| `widgets/settings/notification_setting.dart`                 | The reminder toggle and time picker                      |
| `main.dart`                                                  | `onDidReceiveNotificationResponse` for the reminder tap  |
| `i18n/*.json` (ten locales)                                  | Five new reminder keys                                   |

### Layering

`GameApiRepository extends ApiRepository`, copying `SharedSpaceApiRepository` exactly — including
the lazy `_apiService.gamesApi` getter. Capturing the API object once pins the repository to a stale
`ApiClient` if it is first read before login, because `ApiService.setEndpoint()` reassigns those
fields.

Providers are plain Riverpod over that repository. Nothing is written to Drift, nothing is synced,
and no game state survives process death beyond what the server itself records.

### Pure helpers ported from web

`web/src/lib/utils/game.ts` is a set of small functions where nearly every one encodes a bug someone
already hit. They are ported to `game_format.dart` **with their reasoning**, not reimplemented:

| Helper                 | The bug it encodes                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `wrapLongitude`        | Panning across the antimeridian yields 200 or −230; the server 400s outside ±180      |
| `formatStandingsMonth` | Formatting a UTC month in local time shows the previous month west of Greenwich       |
| `competitionRanks`     | Index-plus-one invents a winner out of a tie; ranks must read 1, 2, 2, 4              |
| `shouldShowStandings`  | The `null` branch is not redundant — an un-asked space can already hold daily history |
| `formatDistanceKm`     | Metres matter for a near miss; decimals are noise at continental scale                |
| `scorePercent`         | Clamped so a bad value cannot overflow the bar                                        |
| `timeUntilNextDaily`   | Counted to the next **UTC** midnight, matching `dailyOn`                              |

## The play flow

`GameSessionController` is an `AsyncNotifier` family keyed by challenge id, holding:

```
challenge, currentIndex, phase (guessing | revealing | finished), result?, submitting
```

Four behaviours it owns:

1. **The resume index is computed once**, from the initial payload, as the first round with no
   `score`. It is never recomputed. The round just answered becomes scored on the post-guess
   refetch, so recomputing would skip straight past its own reveal.
2. **Revealing requires a refetch.** `guessRound` returns `score` / `distanceKm` / `offsetDays` but
   deliberately not the answer, so the controller refetches the challenge and reads `answer` off the
   now-unlocked round.
3. **409 is a recovery path, not an error.** A duplicate guess refetches and reveals the answer
   without a guess pin, rather than surfacing a failure.
4. **`submitting` is a real guard.** A double tap must produce exactly one call; the second would
   409 and overwrite a complete reveal with a degraded one.

On finishing the last round the controller loads the leaderboard, and — if the challenge is the
daily — writes `SettingsKey.gameDailyLastPlayed` with that daily's `dailyOn` UTC date and asks
`daily_reminder.provider.dart` to re-evaluate. A custom challenge writes nothing: only dailies
satisfy the reminder.

## Surfaces

### Location round

Photo on top, map below, both live. A ✕ on the map collapses it to a strip so the photo is
near-full-bleed; tapping the strip restores the split. A round/score HUD sits over the photo.

The map is a bare `MapLibreMap` inside `MapThemeOverride`, following `MapLocationPickerPage` —
explicitly **not** `DriftMap`, which fetches and renders asset markers and would paint the space's
geotagged photos onto the guessing surface. This is an answer-leak rule, not a preference.

Guess is disabled until a pin exists, and the emitted longitude passes through `wrapLongitude`.

### Date round

A month/year wheel over the photo. The year range is `1970 → year(challenge.createdAt)`, matching
web's `GAME_MIN_YEAR`. Submitting sends the 1st of the chosen month at **midnight UTC** — a
local-midnight `DateTime` lands in the previous month at a boundary, which is a wrong answer for a
player who guessed right.

### Reveal

- **Location:** the map takes the screen with two differently coloured circles and a line between
  them, camera fitted to both. Score, bar and distance sit in a bottom card with `Next round`.
- **Date:** a tick strip carrying the guess marker and the answer marker, with both labelled, under
  the score.

### The Challenges page

Reached from the space kebab. Composition mirrors web: daily hero, a standings section tabbed
`Today` / `This month`, then the custom challenge list with create behind a `+` for editors.

**The two boards come from different endpoints.** `This month` is `getStandings`. `Today` is the
**daily challenge's own leaderboard** — `getLeaderboard(dailyId)` — so it exists only when the space
has a daily today. When it does not, there are no tabs at all and the monthly board renders alone.
Following `standings-section.svelte`, the section opens on `Today` whenever a daily exists.

**Neither board is sorted on the client.** `GameService` already applies `compareStandings` to both
(`game.service.ts:725` for the leaderboard, `:759` for the monthly board), and the DTOs say so —
"Per-player totals, highest first" and "best first, non-players last". The client renders in the
order received. Re-sorting would at best duplicate the server and at worst break the rule that rank
depends on: a member who played and scored zero must still outrank one who never turned up, which
sorting by total alone destroys.

The only ranking work on the client is `competitionRanks` over the received totals, so a tie reads
`1, 2, 2, 4` rather than inventing a winner.

Entry `name` comes from the DTO. **The member list is needed only for avatars**
(`sharedSpaceMembersProvider`), and an entry whose member is missing is skipped rather than rendered
without one — the member list is the stale side of that pair, not the board.

### The daily card and the opt-in

The card sits in `SpaceTopSliver` above the albums shelf, in one of four states driven by the
tri-state `dailyChallengeEnabled`:

| Value              | Editor            | Viewer         |
| ------------------ | ----------------- | -------------- |
| `null` (not asked) | The opt-in prompt | Nothing        |
| `true`             | The daily card    | The daily card |
| `false`            | Nothing           | Nothing        |

Reading that field goes through `.orElse(null)` and never `.value` — it is `Optional<bool?>` and
`Absent.value` throws.

Height is reserved from `(dailyChallengeEnabled, canEdit)`, both of which `SpaceDetailPage` already
holds synchronously, rather than from the daily provider's async state. This deliberately avoids
repeating the albums shelf's documented loading-jitter trade-off: a fixed height per state, with a
skeleton while the daily loads.

**A consequence worth naming:** the daily is generated lazily on first read, so putting the card on
the space timeline moves the trigger from "opened the games page" to "opened the space". It only
fires for opted-in spaces, and only the first read of a day does real work, but it is a change in
who pays.

The toggle for an already-answered space lives on the Challenges page and goes through
`SharedSpaceApiRepository.update`, which must keep its `Optional.absent()` discipline so a toggle
never clobbers a field it did not show.

**The Dart field is `Optional<bool?>`, but `null` is not sendable.** The server schema is
`z.boolean().optional()` — optional, not nullable — so `Optional.present(null)` is a 400, exactly as
it already is for `name` / `description` / `color`. There is deliberately no way to write the column
back to "never asked", and none is wanted. Only `absent`, `present(true)` and `present(false)` are
valid.

Permissions come free: `SharedSpaceService.update` defaults to an Editor minimum, and
`dailyChallengeEnabled` is **not** part of its `isOwnerOnlySettingsUpdate` check. Mobile must not
gate the toggle to owners either, or the two clients disagree about who may switch it.

### Create and delete

Create is a bottom sheet with round-count and type segmented controls, editor-only. Delete sits
behind a confirmation dialog, editor-only, and is never offered for the daily — the server refuses
it with a 400 regardless.

## The daily reminder

Web has no equivalent. There is **no push infrastructure in this codebase** — no FCM, no APNs, no
device-token table — and none is built here. The reminder is a local scheduled notification.

### Policy

A pure function, `dailyReminderOccurrences({now, localTimeOfDay, hasOptedInSpace, lastPlayedDate,
horizonDays})`, returns the local `DateTime`s to schedule. Every input is local; the function
performs no I/O.

- **One-shots over a 7-day horizon, refreshed on app foreground and after finishing a daily** —
  not a repeating schedule. A repeating schedule cannot skip a single occurrence, so it would remind
  players about a daily they had already played, which is the usual reason notifications get
  disabled for good. The cost is that reminders lapse if the app is not opened for a week, which is
  accepted. It also keeps well clear of iOS's 64-pending-notification cap.
- **Skip an occurrence when a daily was already finished on that occurrence's UTC day.** One game a
  day is the point; a second reminder has nothing to ask for. In practice only the nearest
  occurrence can ever be skipped, since future days cannot have been played yet.
- **A user-chosen local time, defaulting to 18:00.** Not UTC midnight, which is 1–2 am across
  Europe. Any local time maps to some UTC instant, and whatever daily is current at that instant is
  the one waiting, so no timezone trap exists — provided the copy says "today's daily challenge is
  waiting" and never names a date.
- **`AndroidScheduleMode.inexactAllowWhileIdle`.** A reminder does not need exactness, and exact
  alarms would require `SCHEDULE_EXACT_ALARM` on Android 12+ — a manifest permission carrying Play
  Store policy — for no gain.

### State

One key does the work: `SettingsKey.gameDailyLastPlayed<String?>`, holding a single `YYYY-MM-DD`
(the UTC `dailyOn` of the last daily finished), written when a daily's final round is answered.
Alongside it, `gameDailyReminderEnabled<bool>` and `gameDailyReminderMinuteOfDay<int>`.

A per-space completion map was considered and rejected. Deciding "have I finished them all?" would
require reading every opted-in space's daily on foreground — and `getDailyChallenge` **generates the
daily as a side effect of the read**. That would quietly generate a daily for every opted-in space
every day, in the background where nobody sees it, running the CLIP scene queries for spaces nobody
opened. It is exactly the eager-generation cost the daily's own design chose lazy reads to avoid.

The honest limitation of local-only state: a daily played on web is invisible to mobile, so a
reminder may arrive for something already done.

### Gating and placement

The toggle is local state, always visible on the notification settings page, and never touches the
network — that page must work offline. What is gated is the **scheduling**: nothing is ever
scheduled unless the user is a member of at least one space with `dailyChallengeEnabled == true`.

That is read from the existing `sharedSpacesProvider`, which needs no extra request:
`SharedSpaceRepository.getAllByUserId` uses `selectAll('shared_space')`, so the column is already on
every row of the list response — verified rather than assumed, because a list endpoint that
projected a narrower column set would leave the gate permanently false with nothing to see.

The refresh runs in `daily_reminder.provider.dart` and is driven by three triggers, all of which are
needed:

1. **Cold start**, once the user and spaces list are available. `AppLifeCycleEnum.resumed` does not
   fire on a cold launch, so relying on it alone would leave a freshly-installed or freshly-killed
   app with nothing scheduled until it was backgrounded and reopened.
2. **`AppLifeCycleEnum.resumed`** from `app_life_cycle.provider.dart`, for the returning case.
3. **Finishing a daily**, so the nearest occurrence is dropped without waiting for a resume.

When the last opted-in space is switched off, pending notifications are cancelled on that next run.

**Permission is checked at schedule time, not only at toggle time.** A user can revoke notification
permission in OS settings long after enabling the toggle, so the scheduler treats a denied
permission as "schedule nothing" and the settings row reflects the OS state rather than asserting
reminders are on when the OS will silently drop them.

Permission reuses the flow already on that page rather than adding a second prompt.

### Tap handling

One notification, never one per space — three at 18:00 is spam. Copy is generic: no count and no
space name, because the local record can be stale and a notification that confidently names a count
or a space it got wrong is worse than one that does not. It also avoids a plural form in ten locales.

Tapping routes to the first opted-in space by the spaces list's default sort, or to the spaces list
if that cannot be resolved. This needs an `onDidReceiveNotificationResponse` handler in `main.dart`,
which currently has none — a small edit to a shared file, and therefore rebase surface.

## Answer-leak rules

Carried unchanged from the server design §6. These are correctness requirements, not preferences:

1. Round images are requested **only** by `(challengeId, index)`, never by asset id. One helper,
   `getGameRoundImageUrl`, so no call site can reach for `/assets/:id`.
2. No guess or reveal map may load asset markers. `DriftMap` is forbidden on both surfaces.
3. Answers are read only from a refetched challenge. The client never derives or caches an answer
   for an unguessed round.

## Testing

Written test-first, in the Given/When/Then form, with each unit's edge cases enumerated before its
implementation exists. Two rules this repo has learned the hard way apply throughout:

- **Every test is proven red before it is trusted green** — by flipping the condition under test.
  Mobile widget tests here have produced false greens.
- **`dart analyze --fatal-infos` and `dart format` are both CI gates**, so neither is deferred.

Local run (mirrors CI): Flutter **3.44.8**, pinned in `mobile/mise.toml`. From `mobile/`:
`flutter pub get`, then `dart run easy_localization:generate -S ../i18n && dart run
bin/generate_keys.dart`, then `flutter test <path>`. Drift and OpenAPI generated code is committed,
so `build_runner` is not needed.

### `game_format_test.dart` — pure helpers

| Scenario                                                                         | Expectation                       |
| -------------------------------------------------------------------------------- | --------------------------------- |
| Given a longitude of 200, When wrapped                                           | −160                              |
| Given −230, When wrapped                                                         | 130                               |
| Given exactly 180 / −180 / 0, When wrapped                                       | Unchanged, and within ±180        |
| Given 540 (a full extra turn), When wrapped                                      | Within ±180                       |
| Given a distance below 1 km, When formatted                                      | Metres, no decimals               |
| Given 0 km                                                                       | `0 m`, never `0.0 km`             |
| Given a distance between 1 and 10 km                                             | One decimal                       |
| Given a distance above 10 km                                                     | Rounded, grouped separators       |
| Given a negative score, When converted to a percent                              | 0, not negative                   |
| Given a score above the maximum                                                  | 100, not above                    |
| Given an empty totals list, When ranked                                          | Empty, no throw                   |
| Given all-equal totals                                                           | Every rank is 1                   |
| Given totals producing a tie in second                                           | 1, 2, 2, 4 — never 1, 2, 3, 4     |
| Given a `YYYY-MM` month, When formatted                                          | The UTC month, not the local one  |
| Given `dailyChallengeEnabled` null or absent, When deciding standings visibility | Hidden, even with entries         |
| Given it false with entries that have `daysPlayed > 0`                           | Shown — disabling deletes nothing |
| Given it false with no played entries                                            | Hidden                            |
| Given a time just before UTC midnight, When counting to the next daily           | Approaches zero, never negative   |

### `game_session_test.dart` — the play state machine

Against a fake `GameApiRepository`, no widget tree.

| Given                                               | When                 | Then                                                                                     |
| --------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------- |
| A challenge with no rounds answered                 | Loaded               | `currentIndex` 0, phase `guessing`                                                       |
| Rounds 0–2 answered                                 | Loaded               | `currentIndex` 3                                                                         |
| Every round answered                                | Loaded               | Phase `finished`, leaderboard fetched                                                    |
| Phase `guessing`                                    | A guess is submitted | Exactly one `guessRound` call; phase `revealing`; result carries the refetched answer    |
| A guess already in flight                           | A second guess fires | Still exactly one call — the guard is real, not styling                                  |
| The server answers 409                              | A guess is submitted | Phase `revealing` with an answer and no guess pin; no error shown                        |
| The post-guess refetch scores the current round     | The refetch lands    | `currentIndex` does not move                                                             |
| Phase `revealing`, rounds remain                    | Next                 | Index advances, phase `guessing`                                                         |
| Phase `revealing` on the final round                | Next                 | Phase `finished`, leaderboard fetched                                                    |
| The network fails on guess                          | A guess is submitted | Phase stays `guessing`, `submitting` false, error surfaced                               |
| The challenge is the daily and its last round lands | Completion           | `gameDailyLastPlayed` is written with the daily's UTC date                               |
| The challenge is custom and its last round lands    | Completion           | `gameDailyLastPlayed` is **not** written                                                 |
| Phase `revealing`, rounds remain                    | Next fires twice     | The index advances by exactly one — a double tap must not skip a round                   |
| A challenge whose `rounds` list is empty            | Loaded               | Phase `finished`, no index out of range, no throw                                        |
| A round whose asset was deleted server-side         | Guessed              | Scored from the frozen answer; the reveal renders without the photo rather than erroring |
| The challenge refetch itself fails after a guess    | The refetch rejects  | The score is still shown, degraded; the session is not left stuck in `guessing`          |

### `daily_reminder_schedule_test.dart` — the scheduling policy

| Given                                                         | Then                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------- |
| Reminders disabled                                            | No occurrences                                                       |
| Enabled but no opted-in space                                 | No occurrences                                                       |
| Enabled, opted in, never played, time not yet passed today    | 7 occurrences, the first today                                       |
| Enabled, opted in, the local time already passed today        | The first occurrence is tomorrow                                     |
| `lastPlayedDate` equals the UTC date of the first occurrence  | That occurrence is dropped; 6 remain                                 |
| `lastPlayedDate` is an earlier date                           | Nothing is dropped                                                   |
| A viewer at UTC−10 whose 18:00 falls on the following UTC day | The comparison uses that following UTC date                          |
| A viewer at UTC+13                                            | The comparison uses the same UTC date                                |
| A local time that DST skips or repeats                        | No throw; the sequence stays strictly increasing                     |
| `horizonDays` of 0                                            | No occurrences                                                       |
| Any result                                                    | Every occurrence is in the future                                    |
| Notification permission denied                                | No occurrences, whatever the toggle says                             |
| `lastPlayedDate` is in the future (clock skew)                | Treated as not-today; nothing beyond the matching day is dropped     |
| `lastPlayedDate` is unparseable or empty                      | Treated as never played, no throw                                    |
| The device timezone changes between two calls                 | Occurrences are recomputed against the new zone, not the old offsets |

### Widget tests

Each proven red first.

- **`location_round_test.dart`** — the split is the default; ✕ collapses the map; tapping the
  collapsed strip restores it; Guess is genuinely disabled until a pin exists; a map tap sets the
  pin; the emitted longitude is wrapped.
- **`date_round_test.dart`** — the wheel's year bounds are `1970 → challenge year`; the emitted
  instant is the 1st of the chosen month at UTC midnight; changing month and year both propagate.
- **`round_reveal_test.dart`** — a location reveal draws two distinguishable annotations and a
  connecting line; a date reveal draws the tick strip with both markers; Next advances.
- **`daily_challenge_card_test.dart`** — all four tri-state cases, and the reserved height is the
  same for played and unplayed so the sliver does not jitter.
- **`space_games_page_test.dart`** — the section opens on `Today` when a daily exists and shows no
  tabs at all when it does not; ranks render 1, 2, 2, 4; a member who has not played renders `—`;
  **rows appear in the order the server sent them**, asserted with a deliberately
  "wrongly-sorted-looking" fixture — a zero-score player above a never-played one — so a client-side
  re-sort fails the test; an entry with no matching member is skipped; create is absent for a
  viewer; delete confirms; delete is not offered for the daily.
- **`space_detail_kebab_test.dart`** — the `Challenges` item is present for viewers and editors
  alike, matching how People and Members are gated.
- **`notification_setting_test.dart`** — the toggle and time persist; disabling cancels pending
  notifications; the toggle renders without any network call.
- **`game_round_image_url_test.dart`** — `getGameRoundImageUrl` builds
  `/games/{id}/rounds/{index}/image` against the stored endpoint and carries no asset id. Paired
  with a **source guard**: no file outside that helper may construct a game round image path. The
  single-helper rule is the answer-leak boundary, so it gets a test rather than a comment.
- **`space_games_opt_in_test.dart`** — an editor toggling on sends `present(true)` and never
  `present(null)`; toggling off sends `present(false)`; every other space field stays `absent`; the
  control is offered to editors, not only owners.
- **Error and offline states** — the daily card, the Challenges page and the play page each render a
  failure state with a retry rather than an empty frame or an indefinite spinner when their request
  rejects. These are the states a flaky connection actually produces, and none of them is reachable
  from the happy-path tests above.

### What is deliberately not tested

`mobile/integration_test/` exists but hosts one background-sync teardown test, not a general
end-to-end harness, and nothing here justifies building one. `mobile/test/medium/` is for Drift, and
this feature never touches Drift. The server's own e2e suite already covers every endpoint this
client calls, including the answer-leakage assertions.

## i18n

Five new keys — the reminder toggle title, its subtitle, the time-picker label, the notification
title and its body — added to all ten maintained locales (`de fr it nl pl es ru zh_Hans zh_Hant` and
`en`) in the same commit, inserted in alphabetical position, then `npx prettier --write i18n/*.json`.

Everything else the feature displays already exists. Month and date names come from `Intl`, not from
keys.

## Out of scope

- **Push notifications.** No infrastructure exists; building FCM and APNs would be a larger project
  than this client, and would require every self-hoster to hold their own credentials.
- **Offline play.** A guess cannot be scored without the server.
- **Past-month standings.** The endpoint has no month parameter, by design.
- **An in-app notification surface.** Mobile does not consume the server's notification stream, and
  this feature is not the reason to build one.
- **Live synchronous lobbies**, out of scope on web too.

## Risks

| Risk                                                                   | Mitigation                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Gesture arbitration in the split — a map pan must not resize the split | Isolated to one widget, and the first thing to check on a real device    |
| `main.dart` edits are rebase surface                                   | Keep the handler to a single delegating call into the reminder provider  |
| Opening a space now triggers daily generation                          | Gated on opt-in; only the first read of a day does real work             |
| A reminder for a daily already played on web                           | Accepted, and stated; the alternative generates dailies nobody asked for |
