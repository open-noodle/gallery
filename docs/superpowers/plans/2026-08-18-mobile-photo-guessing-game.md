# Mobile Photo Guessing Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the photo guessing game to the Flutter client at full parity with web — play, create, delete, leaderboard, monthly standings, and the per-space daily opt-in.

**Architecture:** A thin `GameApiRepository` over the already-generated `GamesApi`, plain Riverpod providers above it, and a `GameSessionController` holding the play flow's state machine so its sharp edges are unit-testable without a widget tree. Pure formatting and index logic lives in `game_format.dart`. Nothing touches Drift; the feature is network-only.

**Tech Stack:** Flutter 3.44.8, `hooks_riverpod ^2.6.1` (`Notifier` / `FamilyAsyncNotifier` idiom), `maplibre_gl ^0.26.0`, `mocktail ^1.0.5`, generated `openapi` package.

**Spec:** `docs/superpowers/specs/2026-08-18-mobile-photo-guessing-game-design.md`

## Global Constraints

- **Zero server changes.** All nine game operations, both space DTO fields, and all 51 `game_*` i18n keys already exist. A task that edits `server/`, a migration, or the OpenAPI spec is a wrong task.
- **No new i18n keys in this plan.** Every string comes from an existing `game_*` key (or `people` / `members` style shared keys). The reminder's five new keys belong to the follow-on plan.
- **Never read `Optional.value`.** `GameRoundDetailResponseDto.score`, `.answer`, `.assetId`, `GameCreateDto`'s fields and `SharedSpaceResponseDto.dailyChallengeEnabled` are all `Optional<...>`, and `Absent.value` **throws** (`openapi/lib/optional.dart:67`). Always `.orElse(null)`.
- **Never send `Optional.present(null)`** on a space update. The server schema is `z.boolean().optional()` — optional, not nullable — so an explicit null is a 400.
- **Round images only ever by `(challengeId, index)`.** One helper, `getGameRoundImageUrl`. No call site may build the path itself, and no asset id may reach a game surface.
- **No `DriftMap` on any game surface.** It fetches asset markers and would paint the space's geotagged photos onto a guessing map. Use a bare `MapLibreMap` inside `MapThemeOverride`.
- **The server sorts both boards.** `GameService` applies `compareStandings` before responding. The client renders in the order received and never re-sorts.
- **Every test is proven red before it is trusted green.** Mobile widget tests in this repo have produced false greens.
- Both CI gates are hard: `dart analyze --fatal-infos` and `dart format` over `lib` (not `test/`).

### Verified codebase facts (checked 2026-08-18 — trust these over your recollection)

- **`ApiService` has NO `gamesApi` field.** Task 3 Step 0 adds it. `GamesApi` exists in the generated
  `openapi` package and is exported from its barrel, but nothing constructs it.
- **`MapThemeOverride.mapBuilder` is `Widget Function(AsyncValue<String> style)`,** and every caller
  consumes it with the project's `style.widgetWhen(onData: (style) => ...)` extension
  (`lib/extensions/asyncvalue_extensions.dart`), **not** `.when(...)`. Use `widgetWhen`.
- **`addCircle` / `addLine` throw if the style has not loaded.** They call
  `_ensureManagerInitialized`. Capture the controller in `onMapCreated`, then draw in
  `onStyleLoadedCallback` — never straight from `onMapCreated`.
- `OnMapClickCallback` is `void Function(Point<double> point, LatLng coordinates)` (`Point` from
  `dart:math`). `CameraUpdate.newLatLngBounds(bounds, {left, top, right, bottom})`.
- **Widget tests must use `tester.pumpConsumerWidget(...)`** from `test/widget_tester_extensions.dart`,
  which wraps the widget in `EasyLocalization > ProviderScope(overrides:) > MaterialApp > Material`.
  A bare `MaterialApp` leaves easy_localization uninitialised, and `.t()` **swallows the failure and
  returns the raw key**, so assertions on translated text would silently compare against key names.
- **Any test that renders a `RemoteImageProvider` needs `TestUtils.init()`** (installs
  `MockHttpOverrides`) plus `StoreService.init(...)` and
  `Store.put(StoreKey.serverEndpoint, 'http://localhost:0')` in `setUpAll`/`setUp`. See
  `test/presentation/widgets/people/people_grid_test.dart:35-52` for the canonical block, or reuse
  `test/unit/presentation/presentation_context.dart`. Image fetches failing is expected and fine —
  assert on the provider's `url`, never on pixels.
- **`String.t({BuildContext? context, Map<String, Object>? args})`** — named `args`, values
  non-nullable `Object`, substitution via ICU `MessageFormat`. A wrong arg name renders the key name
  rather than throwing, so any test covering a key with placeholders must assert on the **rendered
  text**, not merely on a widget key.
- Exact i18n placeholders: `game_round_progress` → `{current}`,`{total}`; `game_points` → `{score}`;
  `game_rounds_answered` → `{answered}`,`{total}`; `game_daily_next_in` → `{time}`;
  `game_guess_month_year` → `{month}`,`{year}`; `game_you_were_away` → `{distance}` (**pre-formatted,
  unit included**); `game_you_were_off` → `{offset}` (**pre-formatted, unit included**);
  **`game_days_played` → `{count}` and is an ICU plural** (`{count, plural, one {# day} other {# days}}`),
  so pass a number under the key `count`.
- The day unit for `game_you_were_off` comes from the existing generic `cutoff_day` key
  (`{count, plural, one {day} other {days}}`), exactly as web's `round-result.svelte` does it.
- Riverpod 2.6.1 exposes `AsyncNotifierProvider.autoDispose.family` with base class
  `AutoDisposeFamilyAsyncNotifier<State, Arg>` (`build(Arg arg)`, `late final Arg arg`).
- `test/presentation/widgets/spaces/space_detail_kebab_test.dart` **already exists** with a
  `pumpKebab(...)` helper — extend it rather than creating a new file.

### The canonical widget-test harness

Every widget test below shows its assertions in full, but its **pump helper is a sketch**. Replace
the bare `MaterialApp` wrappers with this, adapting the overrides per test:

```dart
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';

import '../../../test_utils.dart';            // depth depends on the test's directory
import '../../../widget_tester_extensions.dart';

late Drift db;

setUpAll(() async {
  TestWidgetsFlutterBinding.ensureInitialized();
  TestUtils.init();                            // installs MockHttpOverrides
  db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
  await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
});

setUp(() async {
  await Store.clear();
  await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
});

tearDownAll(() async {
  await Store.clear();
  await db.close();
});

// ...then, inside each testWidgets:
await tester.pumpConsumerWidget(TheWidget(...), overrides: [someProvider.overrideWith(...)]);
```

`pumpConsumerWidget` wraps in `EasyLocalization > ProviderScope > MaterialApp > Material` and
pump-and-settles for you. The `Store` block is required only for tests whose widget builds a
`RemoteImageProvider` URL — Tasks 6, 7, 8, 11, 12 and 13. Tasks 1, 3, 5 and 10 are pure/provider
tests and need neither.

### Running tests locally

Flutter **3.44.8**, pinned in `mobile/mise.toml`. Do not use `mise run` — it resolves its own Flutter and ignores `PATH`.

```bash
export PATH="$HOME/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin:$PATH"
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test test/path/to/file_test.dart
```

`flutter test <single-file>` prints its results and then **hangs** — `flutter_tester` never exits. The results are already in the output; that is not a failure. The bare full-suite `flutter test` exits normally.

---

## File Structure

| File                                                                       | Responsibility                                                      |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `mobile/lib/utils/game_format.dart`                                        | Pure formatting, ranking and round-index logic. No I/O, no Flutter. |
| `mobile/lib/repositories/game_api.repository.dart`                         | The only place that talks to `GamesApi`.                            |
| `mobile/lib/providers/game/game.provider.dart`                             | Read-only providers: daily, challenge list, standings, leaderboard. |
| `mobile/lib/providers/game/game_session.provider.dart`                     | The play-flow state machine.                                        |
| `mobile/lib/presentation/widgets/games/location_round.widget.dart`         | Split photo/map guess surface.                                      |
| `mobile/lib/presentation/widgets/games/date_round.widget.dart`             | Wheel-picker guess surface.                                         |
| `mobile/lib/presentation/widgets/games/round_reveal.widget.dart`           | Both reveal layouts.                                                |
| `mobile/lib/presentation/widgets/games/standings_section.widget.dart`      | Today / This-month boards.                                          |
| `mobile/lib/presentation/widgets/games/challenge_card.widget.dart`         | One custom challenge tile.                                          |
| `mobile/lib/presentation/widgets/games/challenge_create_sheet.widget.dart` | Round-count and type pickers.                                       |
| `mobile/lib/presentation/widgets/games/daily_challenge_card.widget.dart`   | The timeline hero, all states.                                      |
| `mobile/lib/presentation/widgets/games/daily_challenge_prompt.widget.dart` | The editor opt-in prompt.                                           |
| `mobile/lib/pages/library/spaces/games/game_play.page.dart`                | Hosts the session; renders round or reveal.                         |
| `mobile/lib/pages/library/spaces/games/space_games.page.dart`              | Composes daily hero, standings, list.                               |

---

## Task 1: Pure helpers

**Files:**

- Create: `mobile/lib/utils/game_format.dart`
- Test: `mobile/test/utils/game_format_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `const int kMaxRoundScore = 5000`
  - `double wrapLongitude(double lng)`
  - `String formatDistanceKm(double km)`
  - `int scorePercent(num score)`
  - `String timeUntilNextDaily(DateTime now)`
  - `List<int> competitionRanks(List<num> totals)`
  - `String formatStandingsMonth(String month, {String? locale})`
  - `bool shouldShowStandings(bool? enabled, List<num> daysPlayed)`
  - `int? firstUnansweredIndex(List<GameRoundDetailResponseDto> rounds)` — `null` when every round is answered

- [ ] **Step 1: Write the failing test**

`mobile/test/utils/game_format_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

GameRoundDetailResponseDto _round(int index, {num? score}) => GameRoundDetailResponseDto(
  index: index,
  type: GameRoundType.location,
  score: score == null ? const Optional.absent() : Optional.present(score),
);

void main() {
  group('wrapLongitude', () {
    test('wraps values maplibre produces past the antimeridian', () {
      // The server's longitudeSchema is min(-180).max(180) and 400s outside it.
      expect(wrapLongitude(200), closeTo(-160, 1e-9));
      expect(wrapLongitude(-230), closeTo(130, 1e-9));
    });

    test('leaves in-range values alone', () {
      expect(wrapLongitude(0), 0);
      expect(wrapLongitude(180), closeTo(180, 1e-9));
      expect(wrapLongitude(-180), closeTo(-180, 1e-9));
    });

    test('a full extra turn still lands in range', () {
      expect(wrapLongitude(540).abs(), lessThanOrEqualTo(180));
      expect(wrapLongitude(-540).abs(), lessThanOrEqualTo(180));
    });
  });

  group('formatDistanceKm', () {
    test('uses metres below a kilometre, with no decimals', () {
      expect(formatDistanceKm(0.38), '380 m');
    });

    test('a zero distance is metres, never 0.0 km', () {
      expect(formatDistanceKm(0), '0 m');
    });

    test('one decimal between 1 and 10 km', () {
      expect(formatDistanceKm(4.25), '4.3 km');
    });

    test('rounds above 10 km', () {
      expect(formatDistanceKm(38.4), '38 km');
    });
  });

  group('scorePercent', () {
    test('clamps below zero', () => expect(scorePercent(-10), 0));
    test('clamps above the maximum', () => expect(scorePercent(kMaxRoundScore + 1000), 100));
    test('scales linearly', () => expect(scorePercent(kMaxRoundScore ~/ 2), 50));
  });

  group('competitionRanks', () {
    test('is empty for an empty board', () => expect(competitionRanks(const []), isEmpty));

    test('gives every player rank 1 when all totals tie', () {
      expect(competitionRanks(const [10, 10, 10]), [1, 1, 1]);
    });

    test('numbers a tie 1, 2, 2, 4 rather than inventing a winner', () {
      expect(competitionRanks(const [30, 20, 20, 10]), [1, 2, 2, 4]);
    });
  });

  group('formatStandingsMonth', () {
    test('renders the UTC month, not the local one', () {
      expect(formatStandingsMonth('2026-08', locale: 'en_US'), 'August 2026');
      expect(formatStandingsMonth('2026-01', locale: 'en_US'), 'January 2026');
    });
  });

  group('shouldShowStandings', () {
    test('is hidden while nobody has been asked, even with history', () {
      expect(shouldShowStandings(null, const [3]), isFalse);
    });

    test('is shown when disabled but history exists — disabling deletes nothing', () {
      expect(shouldShowStandings(false, const [3]), isTrue);
    });

    test('is hidden when disabled with no history', () {
      expect(shouldShowStandings(false, const [0, 0]), isFalse);
    });

    test('is shown whenever enabled', () {
      expect(shouldShowStandings(true, const []), isTrue);
    });
  });

  group('timeUntilNextDaily', () {
    test('counts to the next UTC midnight', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 17, 48)), '6h 12m');
    });

    test('never goes negative at the boundary', () {
      expect(timeUntilNextDaily(DateTime.utc(2026, 8, 18, 23, 59, 59)), '0h 0m');
    });
  });

  group('firstUnansweredIndex', () {
    test('is 0 when nothing is answered', () {
      expect(firstUnansweredIndex([_round(0), _round(1)]), 0);
    });

    test('skips answered rounds', () {
      expect(firstUnansweredIndex([_round(0, score: 10), _round(1, score: 0), _round(2)]), 2);
    });

    test('a zero score counts as answered — it is a real result, not a missing one', () {
      expect(firstUnansweredIndex([_round(0, score: 0)]), isNull);
    });

    test('is null when every round is answered', () {
      expect(firstUnansweredIndex([_round(0, score: 5), _round(1, score: 5)]), isNull);
    });

    test('is null for an empty round list', () {
      expect(firstUnansweredIndex(const []), isNull);
    });
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/utils/game_format_test.dart`
Expected: FAIL — `Target of URI doesn't exist: 'package:immich_mobile/utils/game_format.dart'`.

- [ ] **Step 3: Implement**

`mobile/lib/utils/game_format.dart`:

```dart
import 'package:intl/intl.dart';
import 'package:openapi/api.dart';

/// Points a perfect guess earns. Mirrors MAX_ROUND_SCORE on the server.
const int kMaxRoundScore = 5000;

/// Wraps a longitude into the server-accepted [-180, 180] range.
///
/// maplibre does not wrap the longitude it reports, and panning across the antimeridian on a world
/// guessing map routinely yields values like 200 or -230. The server's longitudeSchema is
/// `min(-180).max(180)` and 400s on anything outside it.
double wrapLongitude(double lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/// Human-readable distance. Precision shrinks as distance grows: metres are meaningful for a near
/// miss, decimals are noise at continental scale.
String formatDistanceKm(double km) {
  if (km < 1) {
    return '${(km * 1000).round()} m';
  }
  if (km < 10) {
    return '${km.toStringAsFixed(1)} km';
  }
  return '${NumberFormat.decimalPattern().format(km.round())} km';
}

/// Score as a 0-100 bar width, clamped so a bad value cannot overflow the bar.
int scorePercent(num score) => (100 * score / kMaxRoundScore).round().clamp(0, 100);

/// How long until the next daily, as `6h 12m`.
///
/// Counted to the next UTC midnight, matching the server's `dailyOn` key. Counting to the viewer's
/// local midnight would promise tomorrow's challenge at the wrong hour for everyone outside UTC.
String timeUntilNextDaily(DateTime now) {
  final utc = now.toUtc();
  final nextUtcMidnight = DateTime.utc(utc.year, utc.month, utc.day + 1);
  final minutesLeft = nextUtcMidnight.difference(utc).inMinutes.clamp(0, 1 << 30);
  return '${minutesLeft ~/ 60}h ${minutesLeft % 60}m';
}

/// Competition ranks — `1, 2, 2, 4` — for a board already sorted best-first by the server.
///
/// Ties on the displayed total only. Two players on 4,200 points share second place even though the
/// server's ordering put one above the other on a tie-break the board does not show; numbering them
/// 2 and 3 would claim a winner the score does not support.
List<int> competitionRanks(List<num> totals) {
  final ranks = <int>[];
  num? lastTotal;
  var lastRank = 0;
  for (var i = 0; i < totals.length; i++) {
    if (totals[i] != lastTotal) {
      lastTotal = totals[i];
      lastRank = i + 1;
    }
    ranks.add(lastRank);
  }
  return ranks;
}

/// A `YYYY-MM` standings key as a month name, e.g. `August 2026`.
///
/// Built from a UTC DateTime: the server's month is a UTC month, and formatting it in the viewer's
/// zone would show the previous month to anyone west of Greenwich.
String formatStandingsMonth(String month, {String? locale}) {
  final parts = month.split('-');
  final date = DateTime.utc(int.parse(parts[0]), int.parse(parts[1]), 1);
  return DateFormat.yMMMM(locale).format(date);
}

/// Whether the standings section belongs on the page.
///
/// The null branch is not redundant: an un-asked space can already hold daily history from before
/// the opt-in existed, and the prompt asking whether to turn the feature on must not sit above a
/// populated board. Answering the prompt brings it back, because disabling never deletes anything.
bool shouldShowStandings(bool? enabled, List<num> daysPlayed) {
  if (enabled == null) {
    return false;
  }
  return enabled || daysPlayed.any((days) => days > 0);
}

/// The index of the first round this caller has not answered, or null when the challenge is done.
///
/// A round carries a `score` only once guessed, so `score` is the answered marker. It is
/// `Optional<num?>` and `Absent.value` THROWS — this must stay `.orElse(null)`. A score of 0 is a
/// real result and counts as answered.
int? firstUnansweredIndex(List<GameRoundDetailResponseDto> rounds) {
  for (final round in rounds) {
    if (round.score.orElse(null) == null) {
      return round.index.toInt();
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/utils/game_format_test.dart`
Expected: PASS, 22 tests.

- [ ] **Step 5: Prove the Optional trap is really covered**

Temporarily change `round.score.orElse(null)` to `round.score.value` and re-run. Expected: the
`firstUnansweredIndex` tests throw rather than fail softly — that is the trap being caught. Revert.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/utils/game_format.dart mobile/test/utils/game_format_test.dart
git commit -m "feat(mobile): add the photo guessing game's formatting helpers"
```

---

## Task 2: The round image URL, and the rule that there is only one

**Files:**

- Modify: `mobile/lib/utils/image_url_builder.dart`
- Test: `mobile/test/utils/game_round_image_url_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces: `String getGameRoundImageUrl(String challengeId, int index)`.

- [ ] **Step 1: Write the failing test**

`mobile/test/utils/game_round_image_url_test.dart`:

```dart
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

void main() {
  group('getGameRoundImageUrl', () {
    setUp(() async {
      await Store.put(StoreKey.serverEndpoint, 'https://example.test/api');
    });

    test('is keyed by challenge and round index only', () {
      expect(getGameRoundImageUrl('challenge-1', 0), 'https://example.test/api/games/challenge-1/rounds/0/image');
    });

    test('carries no asset id — the round must not be resolvable back to an asset', () {
      final url = getGameRoundImageUrl('challenge-1', 3);
      expect(url, contains('/games/challenge-1/rounds/3/image'));
      expect(url, isNot(contains('assets')));
    });
  });

  // The single-helper rule IS the answer-leak boundary (spec, answer-leak rules #1). A second call
  // site building this path by hand is how a future change quietly reaches for /assets/:id instead.
  test('no source file outside image_url_builder.dart constructs a game round image path', () {
    final offenders = <String>[];
    for (final entity in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;
      if (entity.path.endsWith('utils/image_url_builder.dart')) continue;
      if (entity.readAsStringSync().contains('/rounds/')) {
        offenders.add(entity.path);
      }
    }
    expect(offenders, isEmpty, reason: 'Use getGameRoundImageUrl instead of building the path');
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/utils/game_round_image_url_test.dart`
Expected: FAIL — `getGameRoundImageUrl` is undefined.

- [ ] **Step 3: Implement**

Append to `mobile/lib/utils/image_url_builder.dart`:

```dart
/// A game round's photo, keyed by challenge + round index only — NEVER by asset id, so the client
/// never learns which asset a round shows until the player has guessed it.
///
/// Kept in one place because that shape is the security property: every caller must go through this
/// rather than build the URL, or a future one will reach for `/assets/:id` and quietly undo it.
/// `game_round_image_url_test.dart` enforces that there is exactly one construction site.
///
/// The generated `GamesApi.getRoundImage` is deliberately not used: it returns a `MultipartFile`,
/// which cannot feed an ImageProvider without buffering the whole body in Dart and bypassing the
/// native image cache. Auth is attached natively by HttpClientManager for any URL on the configured
/// server, so a plain URL through RemoteImageProvider authenticates.
String getGameRoundImageUrl(final String challengeId, final int index) {
  return '${Store.get(StoreKey.serverEndpoint)}/games/$challengeId/rounds/$index/image';
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/utils/game_round_image_url_test.dart`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the guard bites**

Add `// /rounds/` as a comment to any other file under `lib/`, re-run, and confirm the guard test
fails naming that file. Remove it.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/utils/image_url_builder.dart mobile/test/utils/game_round_image_url_test.dart
git commit -m "feat(mobile): add the game round image URL and guard its single call site"
```

---

## Task 3: The API repository

**Files:**

- Modify: `mobile/lib/services/api.service.dart`
- Create: `mobile/lib/repositories/game_api.repository.dart`
- Test: `mobile/test/repositories/game_api_repository_test.dart`

**Interfaces:**

- Consumes: `ApiRepository.checkNull`, `apiServiceProvider`.

> **`ApiService` has no `gamesApi` field yet — verified, `grep -rn "gamesApi" mobile/lib` returns
> nothing.** The generated `GamesApi` class exists in the `openapi` package and is exported from its
> barrel, but nothing constructs it. Step 0 below adds it. This is an edit to an upstream file, so
> keep it to the two lines and place them adjacent to `sharedSpacesApi` to minimise rebase surface.

- [ ] **Step 0: Wire `GamesApi` into `ApiService`**

In `mobile/lib/services/api.service.dart`, beside the other `late` API fields (`sharedSpacesApi` is
around line 39):

```dart
  late GamesApi gamesApi;
```

and beside the matching assignment in the constructor / `setEndpoint` body (around line 82):

```dart
    gamesApi = GamesApi(_apiClient);
```

Both fields are assigned in the same place the existing ones are — find `sharedSpacesApi =
SharedSpacesApi(_apiClient);` and add the line next to it. If that assignment appears in more than
one method, add it to every one, or the repository's lazy getter will hand back a stale client.

- Produces:
  - `final gameApiRepositoryProvider = Provider((ref) => GameApiRepository(ref.watch(apiServiceProvider)))`
  - `Future<GameChallengeListItemResponseDto?> getDaily(String spaceId)`
  - `Future<List<GameChallengeListItemResponseDto>> getChallenges(String spaceId)`
  - `Future<GameChallengeDetailResponseDto> getChallenge(String id)`
  - `Future<GameGuessResponseDto> guessLocation(String id, int index, {required double lat, required double lon})`
  - `Future<GameGuessResponseDto> guessDate(String id, int index, {required DateTime utcMonthStart})`
  - `Future<GameLeaderboardResponseDto> getLeaderboard(String id)`
  - `Future<GameStandingsResponseDto> getStandings(String spaceId)`
  - `Future<GameChallengeResponseDto> createChallenge(String spaceId, {required int roundCount, required GameChallengeType type})`
  - `Future<void> deleteChallenge(String id)`

- [ ] **Step 1: Write the failing test**

`mobile/test/repositories/game_api_repository_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockGamesApi extends Mock implements GamesApi {}

void main() {
  late _MockApiService apiService;
  late _MockGamesApi gamesApi;
  late GameApiRepository repository;

  setUpAll(() {
    registerFallbackValue(GameCreateDto());
  });

  setUp(() {
    apiService = _MockApiService();
    gamesApi = _MockGamesApi();
    when(() => apiService.gamesApi).thenReturn(gamesApi);
    repository = GameApiRepository(apiService);
  });

  test('getDaily returns null when the space has no daily today', () async {
    when(() => gamesApi.getDailyChallenge('space-1')).thenAnswer((_) async => GameDailyResponseDto());

    expect(await repository.getDaily('space-1'), isNull);
  });

  test('a location guess sends lat and lon and leaves date absent', () async {
    when(() => gamesApi.guessRound(any(), any(), any())).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r', userId: 'u', score: 4000),
    );

    await repository.guessLocation('challenge-1', 2, lat: 12.5, lon: -3.25);

    final dto = verify(() => gamesApi.guessRound('challenge-1', 2, captureAny())).captured.single as GameGuessDto;
    expect(dto.lat.orElse(null), 12.5);
    expect(dto.lon.orElse(null), -3.25);
    expect(dto.date.orElse(null), isNull, reason: 'A location guess must not carry a date');
  });

  test('a date guess sends the date and leaves lat/lon absent', () async {
    when(() => gamesApi.guessRound(any(), any(), any())).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r', userId: 'u', score: 3000),
    );

    await repository.guessDate('challenge-1', 0, utcMonthStart: DateTime.utc(2019, 7, 1));

    final dto = verify(() => gamesApi.guessRound('challenge-1', 0, captureAny())).captured.single as GameGuessDto;
    expect(dto.date.orElse(null), DateTime.utc(2019, 7, 1));
    expect(dto.lat.orElse(null), isNull);
    expect(dto.lon.orElse(null), isNull);
  });

  test('createChallenge sends the requested round count and type', () async {
    when(() => gamesApi.createChallenge(any(), any())).thenAnswer(
      (_) async => GameChallengeResponseDto(
        id: 'c',
        spaceId: 'space-1',
        name: 'Challenge 1',
        roundCount: 5,
        locationRoundCount: 3,
        scaleKm: 1,
        scaleDays: 1,
        createdAt: DateTime.utc(2026),
      ),
    );

    await repository.createChallenge('space-1', roundCount: 10, type: GameChallengeType.date);

    final dto = verify(() => gamesApi.createChallenge('space-1', captureAny())).captured.single as GameCreateDto;
    expect(dto.roundCount.orElse(null), 10);
    expect(dto.type.orElse(null), GameChallengeType.date);
  });

  test('a null body from a non-nullable endpoint is an error, not a silent null', () async {
    when(() => gamesApi.getChallenge('missing')).thenAnswer((_) async => null);

    expect(repository.getChallenge('missing'), throwsA(isA<Exception>()));
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/repositories/game_api_repository_test.dart`
Expected: FAIL — `game_api.repository.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/repositories/game_api.repository.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/api.provider.dart';
import 'package:immich_mobile/repositories/api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:openapi/api.dart';

final gameApiRepositoryProvider = Provider((ref) => GameApiRepository(ref.watch(apiServiceProvider)));

/// The only place in the app that talks to [GamesApi].
///
/// Mirrors SharedSpaceApiRepository, including the lazy `_api` getter: `ApiService.setEndpoint()`
/// reassigns the `*Api` fields to new instances tied to a fresh ApiClient, so capturing `gamesApi`
/// once would pin this repository to a stale client if it is first read before login.
class GameApiRepository extends ApiRepository {
  final ApiService _apiService;

  GameApiRepository(this._apiService);

  GamesApi get _api => _apiService.gamesApi;

  /// Today's daily for [spaceId], or null when the space has none.
  ///
  /// Reading this GENERATES the daily server-side if it does not exist yet, so only call it for a
  /// space that has opted in.
  Future<GameChallengeListItemResponseDto?> getDaily(String spaceId) async {
    final response = await checkNull(_api.getDailyChallenge(spaceId));
    return response.challenge;
  }

  /// Custom challenges only — the server excludes dailies from this list.
  Future<List<GameChallengeListItemResponseDto>> getChallenges(String spaceId) async {
    return await checkNull(_api.getChallenges(spaceId));
  }

  Future<GameChallengeDetailResponseDto> getChallenge(String id) async {
    return await checkNull(_api.getChallenge(id));
  }

  /// A location guess. `date` stays absent — sending all three fields would describe a guess of
  /// both kinds at once.
  Future<GameGuessResponseDto> guessLocation(
    String id,
    int index, {
    required double lat,
    required double lon,
  }) async {
    final dto = GameGuessDto(lat: Optional.present(lat), lon: Optional.present(lon));
    return await checkNull(_api.guessRound(id, index, dto));
  }

  /// A date guess. [utcMonthStart] must be the 1st of the guessed month at midnight UTC — the
  /// server grades at month granularity, and a local-midnight DateTime lands in the previous month
  /// at a boundary.
  Future<GameGuessResponseDto> guessDate(String id, int index, {required DateTime utcMonthStart}) async {
    final dto = GameGuessDto(date: Optional.present(utcMonthStart));
    return await checkNull(_api.guessRound(id, index, dto));
  }

  Future<GameLeaderboardResponseDto> getLeaderboard(String id) async {
    return await checkNull(_api.getLeaderboard(id));
  }

  Future<GameStandingsResponseDto> getStandings(String spaceId) async {
    return await checkNull(_api.getStandings(spaceId));
  }

  Future<GameChallengeResponseDto> createChallenge(
    String spaceId, {
    required int roundCount,
    required GameChallengeType type,
  }) async {
    final dto = GameCreateDto(roundCount: Optional.present(roundCount), type: Optional.present(type));
    return await checkNull(_api.createChallenge(spaceId, dto));
  }

  Future<void> deleteChallenge(String id) => _api.deleteChallenge(id);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/repositories/game_api_repository_test.dart`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/repositories/game_api.repository.dart mobile/test/repositories/game_api_repository_test.dart
git commit -m "feat(mobile): add the game API repository"
```

---

## Task 4: Read-only providers

**Files:**

- Create: `mobile/lib/providers/game/game.provider.dart`
- Test: none of its own — these are one-line `FutureProvider`s over Task 3, and Tasks 9–12 cover them through the widgets that read them. Adding a test that a `FutureProvider` calls its repository would assert Riverpod works, not that we do.

**Interfaces:**

- Consumes: `gameApiRepositoryProvider`.
- Produces:
  - `gameDailyProvider` — `FutureProvider.family<GameChallengeListItemResponseDto?, String>` (spaceId)
  - `gameChallengesProvider` — `FutureProvider.family<List<GameChallengeListItemResponseDto>, String>` (spaceId)
  - `gameStandingsProvider` — `FutureProvider.family<GameStandingsResponseDto, String>` (spaceId)
  - `gameLeaderboardProvider` — `FutureProvider.family<GameLeaderboardResponseDto, String>` (challengeId)

- [ ] **Step 1: Implement**

`mobile/lib/providers/game/game.provider.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:openapi/api.dart';

/// Today's daily for a space, or null when it has none.
///
/// Reading this generates the daily server-side, so only watch it for a space whose
/// `dailyChallengeEnabled` is true.
final gameDailyProvider = FutureProvider.family<GameChallengeListItemResponseDto?, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getDaily(spaceId);
});

final gameChallengesProvider = FutureProvider.family<List<GameChallengeListItemResponseDto>, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getChallenges(spaceId);
});

final gameStandingsProvider = FutureProvider.family<GameStandingsResponseDto, String>((ref, spaceId) {
  return ref.watch(gameApiRepositoryProvider).getStandings(spaceId);
});

final gameLeaderboardProvider = FutureProvider.family<GameLeaderboardResponseDto, String>((ref, challengeId) {
  return ref.watch(gameApiRepositoryProvider).getLeaderboard(challengeId);
});
```

- [ ] **Step 2: Confirm the package analyses**

Run: `dart analyze --fatal-infos lib/providers/game/game.provider.dart`
Expected: `No issues found.`

- [ ] **Step 3: Commit**

```bash
git add mobile/lib/providers/game/game.provider.dart
git commit -m "feat(mobile): add the game read providers"
```

---

## Task 5: The play-flow state machine

**Files:**

- Create: `mobile/lib/providers/game/game_session.provider.dart`
- Test: `mobile/test/providers/game/game_session_test.dart`

**Interfaces:**

- Consumes: `gameApiRepositoryProvider`, `firstUnansweredIndex`.
- Produces:
  - `enum GamePhase { guessing, revealing, finished }`
  - `class RoundResult { GameRoundType type; int score; double? distanceKm; int? offsetDays; GameRoundDetailResponseDtoAnswer? answer; ({double lat, double lon})? guess; }`
  - `class GameSessionState { GameChallengeDetailResponseDto challenge; int currentIndex; GamePhase phase; RoundResult? result; bool submitting; GameLeaderboardResponseDto? leaderboard; GameRoundDetailResponseDto? get currentRound; }`
  - `final gameSessionProvider = AsyncNotifierProvider.autoDispose.family<GameSessionController, GameSessionState, String>(GameSessionController.new)`
  - `GameSessionController.guessLocation({required double lat, required double lon})`
  - `GameSessionController.guessDate(DateTime utcMonthStart)`
  - `GameSessionController.next()`
  - `GameSessionController.onDailyCompleted` — a `void Function(DateTime dailyOn)?` hook the reminder plan wires; unset here.

- [ ] **Step 1: Write the failing test**

`mobile/test/providers/game/game_session_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

GameRoundDetailResponseDto _round(int index, {GameRoundType type = GameRoundType.location, num? score, num? lat}) =>
    GameRoundDetailResponseDto(
      index: index,
      type: type,
      score: score == null ? const Optional.absent() : Optional.present(score),
      answer: score == null
          ? const Optional.absent()
          : Optional.present(GameRoundDetailResponseDtoAnswer(lat: lat ?? 1, lon: 2)),
    );

GameChallengeDetailResponseDto _challenge(List<GameRoundDetailResponseDto> rounds, {DateTime? dailyOn}) =>
    GameChallengeDetailResponseDto(
      id: 'challenge-1',
      spaceId: 'space-1',
      name: 'Challenge 1',
      roundCount: rounds.length,
      scaleKm: 100,
      scaleDays: 100,
      createdAt: DateTime.utc(2026, 8, 18),
      dailyOn: dailyOn,
      rounds: rounds,
    );

ProviderContainer _container(GameApiRepository repository) {
  final container = ProviderContainer(overrides: [gameApiRepositoryProvider.overrideWithValue(repository)]);
  addTearDown(container.dispose);
  return container;
}

void main() {
  late _MockGameApiRepository repository;

  setUp(() {
    repository = _MockGameApiRepository();
    when(() => repository.getLeaderboard(any())).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));
  });

  test('starts at round 0 when nothing is answered', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.currentIndex, 0);
    expect(state.phase, GamePhase.guessing);
  });

  test('resumes at the first unanswered round', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer(
      (_) async => _challenge([_round(0, score: 10), _round(1, score: 20), _round(2)]),
    );

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.currentIndex, 2);
  });

  test('a fully answered challenge opens finished, with the leaderboard loaded', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer(
      (_) async => _challenge([_round(0, score: 10)]),
    );

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.phase, GamePhase.finished);
    expect(state.leaderboard, isNotNull);
  });

  test('an empty round list is finished rather than out of range', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([]));

    final container = _container(repository);
    final state = await container.read(gameSessionProvider('challenge-1').future);

    expect(state.phase, GamePhase.finished);
    expect(state.currentRound, isNull);
  });

  test('a guess reveals the answer from the refetch, not from the guess response', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      // The second fetch is the post-guess one, where round 0 has become scored.
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 4200, lat: 48.85), _round(1)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 4200, distanceKm: 38),
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await controller.guessLocation(lat: 48.0, lon: 2.0);
    final state = container.read(gameSessionProvider('challenge-1')).requireValue;

    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 4200);
    expect(state.result!.distanceKm, 38);
    expect(state.result!.answer!.lat, 48.85);
    expect(state.result!.guess, isNotNull);
  });

  test('the resume index does not move when the refetch scores the current round', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 4200), _round(1)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 4200),
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    // Recomputing from the refreshed payload would jump to 1 and skip round 0's own reveal.
    expect(container.read(gameSessionProvider('challenge-1')).requireValue.currentIndex, 0);
  });

  test('a second guess while one is in flight does not reach the server', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 100);
      },
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);

    await Future.wait([controller.guessLocation(lat: 1, lon: 1), controller.guessLocation(lat: 2, lon: 2)]);

    verify(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).called(1);
  });

  test('a 409 duplicate reveals the answer without a guess pin instead of erroring', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 900, lat: 10), _round(1)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon')))
        .thenThrow(ApiException(409, 'Already guessed'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 900);
    expect(state.result!.guess, isNull, reason: 'That request never reached the server');
  });

  test('a network failure leaves the round guessable again', () async {
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async => _challenge([_round(0), _round(1)]));
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon')))
        .thenThrow(Exception('offline'));

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.guessing);
    expect(state.submitting, isFalse);
  });

  test('next advances exactly one round even when tapped twice', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1), _round(1), _round(2)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 1),
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);
    await controller.guessLocation(lat: 1, lon: 1);

    controller.next();
    controller.next();

    expect(container.read(gameSessionProvider('challenge-1')).requireValue.currentIndex, 1);
  });

  test('next on the final round finishes and loads the leaderboard', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge([if (fetches == 1) _round(0) else _round(0, score: 1)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 1),
    );

    final container = _container(repository);
    // Start unanswered so the session opens in `guessing`, then guess and advance.
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier);
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.finished);
    verify(() => repository.getLeaderboard('challenge-1')).called(1);
  });

  test('completing a daily reports its dailyOn date; a custom challenge reports nothing', () async {
    final reported = <DateTime>[];
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      return _challenge(
        [if (fetches == 1) _round(0) else _round(0, score: 1)],
        dailyOn: DateTime.utc(2026, 8, 18),
      );
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 1),
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    final controller = container.read(gameSessionProvider('challenge-1').notifier)..onDailyCompleted = reported.add;
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    expect(reported, [DateTime.utc(2026, 8, 18)]);
  });

  test('a failed post-guess refetch still shows the score rather than sticking in guessing', () async {
    var fetches = 0;
    when(() => repository.getChallenge('challenge-1')).thenAnswer((_) async {
      fetches++;
      if (fetches > 1) throw Exception('offline');
      return _challenge([_round(0), _round(1)]);
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon'))).thenAnswer(
      (_) async => GameGuessResponseDto(roundId: 'r0', userId: 'u', score: 2500, distanceKm: 12),
    );

    final container = _container(repository);
    await container.read(gameSessionProvider('challenge-1').future);
    await container.read(gameSessionProvider('challenge-1').notifier).guessLocation(lat: 1, lon: 1);

    final state = container.read(gameSessionProvider('challenge-1')).requireValue;
    expect(state.phase, GamePhase.revealing);
    expect(state.result!.score, 2500);
    expect(state.result!.answer, isNull, reason: 'The answer was never retrieved');
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/providers/game/game_session_test.dart`
Expected: FAIL — `game_session.provider.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/providers/game/game_session.provider.dart`:

```dart
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

enum GamePhase { guessing, revealing, finished }

/// Everything the reveal needs, assembled from the guess response and the post-guess refetch.
///
/// [guess] is null on the 409 recovery path: that request never reached the server, so there is no
/// guess of ours to plot. The reveal is still informative without it.
class RoundResult {
  final GameRoundType type;
  final int score;
  final double? distanceKm;
  final int? offsetDays;
  final GameRoundDetailResponseDtoAnswer? answer;
  final ({double lat, double lon})? guess;

  const RoundResult({
    required this.type,
    required this.score,
    this.distanceKm,
    this.offsetDays,
    this.answer,
    this.guess,
  });
}

class GameSessionState {
  final GameChallengeDetailResponseDto challenge;
  final int currentIndex;
  final GamePhase phase;
  final RoundResult? result;
  final bool submitting;
  final GameLeaderboardResponseDto? leaderboard;

  const GameSessionState({
    required this.challenge,
    required this.currentIndex,
    required this.phase,
    this.result,
    this.submitting = false,
    this.leaderboard,
  });

  /// Looked up by the round's own `index`, not by array position. Correct either way only because
  /// the server orders rounds over a contiguous 0..N-1 set; looking it up keeps that invariant
  /// local rather than leaning on it silently at every call site.
  GameRoundDetailResponseDto? get currentRound {
    for (final round in challenge.rounds) {
      if (round.index.toInt() == currentIndex) return round;
    }
    return null;
  }

  GameSessionState copyWith({
    GameChallengeDetailResponseDto? challenge,
    int? currentIndex,
    GamePhase? phase,
    RoundResult? result,
    bool? submitting,
    GameLeaderboardResponseDto? leaderboard,
    bool clearResult = false,
  }) => GameSessionState(
    challenge: challenge ?? this.challenge,
    currentIndex: currentIndex ?? this.currentIndex,
    phase: phase ?? this.phase,
    result: clearResult ? null : (result ?? this.result),
    submitting: submitting ?? this.submitting,
    leaderboard: leaderboard ?? this.leaderboard,
  );
}

final gameSessionProvider =
    AsyncNotifierProvider.autoDispose.family<GameSessionController, GameSessionState, String>(
      GameSessionController.new,
    );

class GameSessionController extends AutoDisposeFamilyAsyncNotifier<GameSessionState, String> {
  /// Called with the daily's `dailyOn` when a DAILY challenge is completed. The reminder wires this;
  /// nothing sets it here, and a custom challenge never invokes it.
  void Function(DateTime dailyOn)? onDailyCompleted;

  GameApiRepository get _repository => ref.read(gameApiRepositoryProvider);

  @override
  Future<GameSessionState> build(String challengeId) async {
    final challenge = await _repository.getChallenge(challengeId);
    // Computed ONCE, here. Never recomputed: the round just answered becomes scored on the
    // post-guess refetch, and recomputing would skip straight past its own reveal.
    final index = firstUnansweredIndex(challenge.rounds);

    if (index == null) {
      return GameSessionState(
        challenge: challenge,
        currentIndex: challenge.rounds.length,
        phase: GamePhase.finished,
        leaderboard: await _safeLeaderboard(challengeId),
      );
    }
    return GameSessionState(challenge: challenge, currentIndex: index, phase: GamePhase.guessing);
  }

  Future<GameLeaderboardResponseDto?> _safeLeaderboard(String challengeId) async {
    try {
      return await _repository.getLeaderboard(challengeId);
    } catch (_) {
      // A missing leaderboard must not blank the score the player just earned.
      return null;
    }
  }

  Future<void> guessLocation({required double lat, required double lon}) =>
      _submit((current) => _repository.guessLocation(arg, current, lat: lat, lon: lon), guess: (lat: lat, lon: lon));

  Future<void> guessDate(DateTime utcMonthStart) =>
      _submit((current) => _repository.guessDate(arg, current, utcMonthStart: utcMonthStart));

  Future<void> _submit(
    Future<GameGuessResponseDto> Function(int index) send, {
    ({double lat, double lon})? guess,
  }) async {
    final current = state.valueOrNull;
    // A real guard, not styling: a double tap's second guess would 409 and overwrite a complete
    // reveal with a degraded one.
    if (current == null || current.submitting || current.phase != GamePhase.guessing) return;

    state = AsyncData(current.copyWith(submitting: true));
    try {
      final response = await send(current.currentIndex);
      await _reveal(
        score: response.score.toInt(),
        distanceKm: response.distanceKm?.toDouble(),
        offsetDays: response.offsetDays?.toInt(),
        guess: guess,
      );
    } on ApiException catch (error) {
      if (error.code == 409) {
        // Not a failure: the first guess stands. Re-read it and reveal without our own pin.
        await _reveal(score: null, guess: null);
        return;
      }
      state = AsyncData(state.requireValue.copyWith(submitting: false));
      rethrow;
    } catch (_) {
      state = AsyncData(state.requireValue.copyWith(submitting: false));
    }
  }

  /// The guess response carries score/distance/offset but never the answer, so the answer can only
  /// come from a refetched challenge.
  Future<void> _reveal({
    required int? score,
    double? distanceKm,
    int? offsetDays,
    ({double lat, double lon})? guess,
  }) async {
    final current = state.requireValue;
    GameChallengeDetailResponseDto challenge = current.challenge;
    try {
      challenge = await _repository.getChallenge(arg);
    } catch (_) {
      // Keep the score we already have rather than stranding the player in `guessing`.
    }

    final refreshed = GameSessionState(
      challenge: challenge,
      currentIndex: current.currentIndex,
      phase: GamePhase.revealing,
      submitting: false,
      leaderboard: current.leaderboard,
    );
    final round = refreshed.currentRound;

    state = AsyncData(
      refreshed.copyWith(
        result: RoundResult(
          type: round?.type ?? GameRoundType.location,
          score: score ?? round?.score.orElse(null)?.toInt() ?? 0,
          distanceKm: distanceKm,
          offsetDays: offsetDays,
          answer: round?.answer.orElse(null),
          guess: guess,
        ),
      ),
    );
  }

  void next() {
    final current = state.valueOrNull;
    // Guarding on `revealing` is what makes a double tap advance exactly one round.
    if (current == null || current.phase != GamePhase.revealing) return;

    final nextIndex = current.currentIndex + 1;
    if (nextIndex < current.challenge.rounds.length) {
      state = AsyncData(
        current.copyWith(currentIndex: nextIndex, phase: GamePhase.guessing, clearResult: true),
      );
      return;
    }

    state = AsyncData(current.copyWith(phase: GamePhase.finished, clearResult: true));
    _finish(current.challenge);
  }

  Future<void> _finish(GameChallengeDetailResponseDto challenge) async {
    final dailyOn = challenge.dailyOn;
    if (dailyOn != null) {
      onDailyCompleted?.call(dailyOn);
    }
    final leaderboard = await _safeLeaderboard(arg);
    final current = state.valueOrNull;
    if (leaderboard != null && current != null) {
      state = AsyncData(current.copyWith(leaderboard: leaderboard));
    }
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/providers/game/game_session_test.dart`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the two guards actually bite**

Delete `|| current.submitting` and re-run — the double-guess test must fail with 2 calls. Restore it.
Change `next()`'s guard to `if (current == null)` and re-run — the double-`next` test must fail with
`currentIndex` 2. Restore it.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/providers/game/game_session.provider.dart mobile/test/providers/game/game_session_test.dart
git commit -m "feat(mobile): add the game session state machine"
```

---

## Task 6: The location round

**Files:**

- Create: `mobile/lib/presentation/widgets/games/location_round.widget.dart`
- Test: `mobile/test/presentation/widgets/games/location_round_test.dart`

**Interfaces:**

- Consumes: `getGameRoundImageUrl`, `wrapLongitude`.
- Produces: `LocationRound({required String challengeId, required int index, required int roundNumber, required int roundCount, required void Function({required double lat, required double lon}) onGuess})`, with widget keys `location-round-map`, `location-round-dismiss`, `location-round-strip`, `location-round-guess`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/widgets/games/location_round_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';

void main() {
  Future<void> pump(WidgetTester tester, {void Function({required double lat, required double lon})? onGuess}) {
    return tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: LocationRound(
            challengeId: 'challenge-1',
            index: 1,
            roundNumber: 2,
            roundCount: 5,
            onGuess: onGuess ?? ({required lat, required lon}) {},
          ),
        ),
      ),
    );
  }

  testWidgets('opens as a split, with the map already visible', (tester) async {
    await pump(tester);

    expect(find.byKey(const Key('location-round-map')), findsOneWidget);
    expect(find.byKey(const Key('location-round-strip')), findsNothing);
  });

  testWidgets('the dismiss control collapses the map to a strip', (tester) async {
    await pump(tester);

    await tester.tap(find.byKey(const Key('location-round-dismiss')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('location-round-map')), findsNothing);
    expect(find.byKey(const Key('location-round-strip')), findsOneWidget);
  });

  testWidgets('tapping the strip restores the split', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('location-round-dismiss')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('location-round-strip')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('location-round-map')), findsOneWidget);
  });

  testWidgets('Guess is genuinely disabled until a pin exists', (tester) async {
    var guesses = 0;
    await pump(tester, onGuess: ({required lat, required lon}) => guesses++);

    final button = tester.widget<FilledButton>(find.byKey(const Key('location-round-guess')));
    expect(button.onPressed, isNull, reason: 'Disabled must mean disabled, not just greyed out');

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pump();
    expect(guesses, 0);
  });

  testWidgets('a placed pin enables Guess and emits a wrapped longitude', (tester) async {
    double? emittedLon;
    await pump(tester, onGuess: ({required lat, required lon}) => emittedLon = lon);

    // A longitude past the antimeridian, as maplibre reports it when the map is panned.
    tester.state<LocationRoundState>(find.byType(LocationRound)).debugSetPin(lat: 48.85, lon: 200);
    await tester.pump();

    await tester.tap(find.byKey(const Key('location-round-guess')));
    await tester.pump();

    expect(emittedLon, closeTo(-160, 1e-9));
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/widgets/games/location_round_test.dart`
Expected: FAIL — `location_round.widget.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/games/location_round.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/guess_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// The photo/map split. The map is the resting state, dismissible with the ✕ so a photo that needs
/// a closer look can have nearly the whole screen.
class LocationRound extends StatefulWidget {
  const LocationRound({
    super.key,
    required this.challengeId,
    required this.index,
    required this.roundNumber,
    required this.roundCount,
    required this.onGuess,
  });

  final String challengeId;
  final int index;
  final int roundNumber;
  final int roundCount;
  final void Function({required double lat, required double lon}) onGuess;

  @override
  State<LocationRound> createState() => LocationRoundState();
}

class LocationRoundState extends State<LocationRound> {
  ({double lat, double lon})? _pin;
  bool _mapVisible = true;

  /// Test seam: placing a pin otherwise requires a live MapLibre surface, which a widget test has
  /// no platform view for.
  @visibleForTesting
  void debugSetPin({required double lat, required double lon}) => setState(() => _pin = (lat: lat, lon: lon));

  void _guess() {
    final pin = _pin;
    if (pin == null) return;
    // maplibre does not wrap the longitude it reports; the server 400s outside +/-180.
    widget.onGuess(lat: pin.lat, lon: wrapLongitude(pin.lon));
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          flex: _mapVisible ? 40 : 88,
          child: Stack(
            fit: StackFit.expand,
            children: [
              Image(image: RemoteImageProvider(url: getGameRoundImageUrl(widget.challengeId, widget.index)),
                  fit: BoxFit.cover),
              Positioned(
                top: 8,
                right: 8,
                child: _Hud(roundNumber: widget.roundNumber, roundCount: widget.roundCount),
              ),
            ],
          ),
        ),
        if (_mapVisible)
          Expanded(
            flex: 60,
            child: Stack(
              children: [
                // A bare guess map: never DriftMap, which would fetch and render the space's own
                // geotagged assets onto the surface the answer is hidden on.
                GuessMap(
                  key: const Key('location-round-map'),
                  onTap: (lat, lon) => setState(() => _pin = (lat: lat, lon: lon)),
                ),
                Positioned(
                  top: 8,
                  right: 8,
                  child: IconButton.filled(
                    key: const Key('location-round-dismiss'),
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() => _mapVisible = false),
                  ),
                ),
                Positioned(
                  left: 12,
                  right: 12,
                  bottom: 12,
                  child: FilledButton(
                    key: const Key('location-round-guess'),
                    onPressed: _pin == null ? null : _guess,
                    child: Text('game_guess'.t(context: context)),
                  ),
                ),
              ],
            ),
          )
        else
          GestureDetector(
            key: const Key('location-round-strip'),
            onTap: () => setState(() => _mapVisible = true),
            child: Container(
              height: 44,
              alignment: Alignment.center,
              color: Theme.of(context).colorScheme.surfaceContainer,
              child: Text('game_place_your_pin'.t(context: context)),
            ),
          ),
      ],
    );
  }
}

class _Hud extends StatelessWidget {
  const _Hud({required this.roundNumber, required this.roundCount});

  final int roundNumber;
  final int roundCount;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(color: Colors.black54, borderRadius: BorderRadius.circular(8)),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        child: Text(
          'game_round_progress'.t(
            context: context,
            args: {'current': '$roundNumber', 'total': '$roundCount'},
          ),
          style: const TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}
```

Also create the shared map surface, `mobile/lib/presentation/widgets/games/guess_map.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/widgets/map/map_theme_override.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// A bare guessing map: a MapLibre surface with no marker source of its own.
///
/// Deliberately NOT DriftMap. DriftMap fetches asset markers, which on a guessing surface would
/// paint the space's geotagged photos — including the round's own answer — onto the map.
class GuessMap extends StatefulWidget {
  const GuessMap({super.key, required this.onTap});

  final void Function(double lat, double lon) onTap;

  @override
  State<GuessMap> createState() => _GuessMapState();
}

class _GuessMapState extends State<GuessMap> {
  MapLibreMapController? _controller;
  Symbol? _marker;

  bool _styleLoaded = false;

  @override
  Widget build(BuildContext context) {
    return MapThemeOverride(
      mapBuilder: (style) => style.widgetWhen(
        onData: (styleString) => MapLibreMap(
          styleString: styleString,
          initialCameraPosition: const CameraPosition(target: LatLng(20, 0), zoom: 0.5),
          onMapCreated: (controller) => _controller = controller,
          // Annotation managers are only initialised once the style has loaded; adding a symbol
          // before then throws.
          onStyleLoadedCallback: () => _styleLoaded = true,
          onMapClick: (_, coordinates) async {
            widget.onTap(coordinates.latitude, coordinates.longitude);
            if (!_styleLoaded) return;
            if (_marker == null) {
              _marker = await _controller?.addSymbol(
                SymbolOptions(geometry: coordinates, iconImage: 'mapMarker', iconSize: 0.15, iconAnchor: 'bottom'),
              );
            } else {
              await _controller?.updateSymbol(_marker!, SymbolOptions(geometry: coordinates));
            }
          },
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/presentation/widgets/games/location_round_test.dart`
Expected: PASS, 5 tests.

- [ ] **Step 5: Prove the disabled-button test bites**

Change `onPressed: _pin == null ? null : _guess` to `onPressed: _guess` and re-run. Expected: the
"genuinely disabled" test fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/games/location_round.widget.dart \
        mobile/lib/presentation/widgets/games/guess_map.widget.dart \
        mobile/test/presentation/widgets/games/location_round_test.dart
git commit -m "feat(mobile): add the location round guess surface"
```

---

## Task 7: The date round

**Files:**

- Create: `mobile/lib/presentation/widgets/games/date_round.widget.dart`
- Test: `mobile/test/presentation/widgets/games/date_round_test.dart`

**Interfaces:**

- Consumes: `getGameRoundImageUrl`.
- Produces: `DateRound({required String challengeId, required int index, required int minYear, required int maxYear, required int roundNumber, required int roundCount, required void Function(DateTime utcMonthStart) onGuess})`, key `date-round-guess`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/widgets/games/date_round_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';

void main() {
  Future<DateTime?> pumpAndGuess(WidgetTester tester, {void Function(DateRoundState state)? adjust}) async {
    DateTime? emitted;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DateRound(
            challengeId: 'challenge-1',
            index: 0,
            minYear: 1970,
            maxYear: 2026,
            roundNumber: 1,
            roundCount: 5,
            onGuess: (value) => emitted = value,
          ),
        ),
      ),
    );
    if (adjust != null) {
      adjust(tester.state<DateRoundState>(find.byType(DateRound)));
      await tester.pump();
    }
    await tester.tap(find.byKey(const Key('date-round-guess')));
    await tester.pump();
    return emitted;
  }

  testWidgets('emits the 1st of the chosen month at midnight UTC', (tester) async {
    final emitted = await pumpAndGuess(tester, adjust: (state) => state.debugSelect(year: 2019, month: 7));

    expect(emitted, DateTime.utc(2019, 7, 1));
    expect(emitted!.isUtc, isTrue, reason: 'A local midnight lands in the previous month at a boundary');
  });

  testWidgets('a January guess stays in January rather than sliding to December', (tester) async {
    final emitted = await pumpAndGuess(tester, adjust: (state) => state.debugSelect(year: 2020, month: 1));

    expect(emitted, DateTime.utc(2020, 1, 1));
  });

  testWidgets('offers exactly the challenge year range', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: DateRound(
            challengeId: 'challenge-1',
            index: 0,
            minYear: 1970,
            maxYear: 2026,
            roundNumber: 1,
            roundCount: 5,
            onGuess: (_) {},
          ),
        ),
      ),
    );

    final state = tester.state<DateRoundState>(find.byType(DateRound));
    expect(state.years.first, 1970);
    expect(state.years.last, 2026);
    expect(state.years.length, 57);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/widgets/games/date_round_test.dart`
Expected: FAIL — `date_round.widget.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/games/date_round.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:intl/intl.dart';

/// The date guess surface: a month/year wheel over the photo.
///
/// The server grades a date round at month granularity, so this only has to produce a month and a
/// year — nothing finer.
class DateRound extends StatefulWidget {
  const DateRound({
    super.key,
    required this.challengeId,
    required this.index,
    required this.minYear,
    required this.maxYear,
    required this.roundNumber,
    required this.roundCount,
    required this.onGuess,
  });

  final String challengeId;
  final int index;
  final int minYear;
  final int maxYear;
  final int roundNumber;
  final int roundCount;
  final void Function(DateTime utcMonthStart) onGuess;

  @override
  State<DateRound> createState() => DateRoundState();
}

class DateRoundState extends State<DateRound> {
  late int _year = widget.minYear + (widget.maxYear - widget.minYear) ~/ 2;
  int _month = 7;

  List<int> get years => [for (var y = widget.minYear; y <= widget.maxYear; y++) y];

  /// Test seam: driving two ListWheelScrollViews by gesture is slow and brittle, and the behaviour
  /// under test is what gets EMITTED, not how the wheel scrolls.
  @visibleForTesting
  void debugSelect({required int year, required int month}) => setState(() {
    _year = year;
    _month = month;
  });

  /// Midnight UTC, not local: a local-midnight DateTime lands on the previous or next day depending
  /// on the player's zone, which at a month boundary means the previous or next MONTH — a wrong
  /// answer for a player who guessed right.
  void _guess() => widget.onGuess(DateTime.utc(_year, _month, 1));

  @override
  Widget build(BuildContext context) {
    final monthNames = [
      for (var m = 1; m <= 12; m++) DateFormat.MMMM().format(DateTime.utc(2020, m, 1)),
    ];

    return Stack(
      fit: StackFit.expand,
      children: [
        Image(image: RemoteImageProvider(url: getGameRoundImageUrl(widget.challengeId, widget.index)),
            fit: BoxFit.cover),
        Positioned(
          left: 12,
          right: 12,
          bottom: 12,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              DecoratedBox(
                decoration: BoxDecoration(color: Colors.black87, borderRadius: BorderRadius.circular(12)),
                child: Padding(
                  padding: const EdgeInsets.all(10),
                  child: Column(
                    children: [
                      Text(
                        'game_when_was_this'.t(context: context),
                        style: const TextStyle(color: Colors.white70),
                      ),
                      SizedBox(
                        height: 120,
                        child: Row(
                          children: [
                            Expanded(
                              child: _Wheel(
                                itemCount: 12,
                                initialItem: _month - 1,
                                labelAt: (i) => monthNames[i],
                                onSelected: (i) => setState(() => _month = i + 1),
                              ),
                            ),
                            Expanded(
                              child: _Wheel(
                                itemCount: years.length,
                                initialItem: years.indexOf(_year),
                                labelAt: (i) => '${years[i]}',
                                onSelected: (i) => setState(() => _year = years[i]),
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              FilledButton(
                key: const Key('date-round-guess'),
                onPressed: _guess,
                child: Text(
                  'game_guess_month_year'.t(
                    context: context,
                    args: {'month': monthNames[_month - 1], 'year': '$_year'},
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _Wheel extends StatelessWidget {
  const _Wheel({
    required this.itemCount,
    required this.initialItem,
    required this.labelAt,
    required this.onSelected,
  });

  final int itemCount;
  final int initialItem;
  final String Function(int index) labelAt;
  final void Function(int index) onSelected;

  @override
  Widget build(BuildContext context) {
    return ListWheelScrollView.useDelegate(
      controller: FixedExtentScrollController(initialItem: initialItem),
      itemExtent: 30,
      physics: const FixedExtentScrollPhysics(),
      onSelectedItemChanged: onSelected,
      childDelegate: ListWheelChildBuilderDelegate(
        childCount: itemCount,
        builder: (context, index) => Center(
          child: Text(labelAt(index), style: const TextStyle(color: Colors.white)),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/presentation/widgets/games/date_round_test.dart`
Expected: PASS, 3 tests.

- [ ] **Step 5: Prove the UTC assertion bites**

Change `DateTime.utc(_year, _month, 1)` to `DateTime(_year, _month, 1)` and re-run. Expected: the
`isUtc` assertion fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/games/date_round.widget.dart \
        mobile/test/presentation/widgets/games/date_round_test.dart
git commit -m "feat(mobile): add the date round guess surface"
```

---

## Task 8: The reveal

**Files:**

- Create: `mobile/lib/presentation/widgets/games/round_reveal.widget.dart`
- Test: `mobile/test/presentation/widgets/games/round_reveal_test.dart`

**Interfaces:**

- Consumes: `RoundResult`, `formatDistanceKm`, `scorePercent`.
- Produces: `RoundReveal({required String challengeId, required int index, required RoundResult result, required VoidCallback onNext})`, keys `round-reveal-score`, `round-reveal-map`, `round-reveal-timeline`, `round-reveal-next`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/widgets/games/round_reveal_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:openapi/api.dart';

void main() {
  Future<void> pump(WidgetTester tester, RoundResult result, {VoidCallback? onNext}) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: RoundReveal(challengeId: 'c1', index: 0, result: result, onNext: onNext ?? () {}),
      ),
    ),
  );

  testWidgets('a location reveal shows the map and the distance', (tester) async {
    await pump(
      tester,
      RoundResult(
        type: GameRoundType.location,
        score: 4182,
        distanceKm: 38,
        answer: GameRoundDetailResponseDtoAnswer(lat: 36.9, lon: -4.5),
        guess: (lat: 37.2, lon: -4.1),
      ),
    );

    expect(find.byKey(const Key('round-reveal-map')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-timeline')), findsNothing);
    expect(find.textContaining('38 km'), findsOneWidget);
  });

  testWidgets('a date reveal shows the timeline strip, not a map it has no use for', (tester) async {
    await pump(
      tester,
      RoundResult(
        type: GameRoundType.date,
        score: 3640,
        offsetDays: 150,
        answer: GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2019, 12, 1)),
      ),
    );

    expect(find.byKey(const Key('round-reveal-timeline')), findsOneWidget);
    expect(find.byKey(const Key('round-reveal-map')), findsNothing);
  });

  testWidgets('a 409 recovery renders with no guess pin and does not throw', (tester) async {
    await pump(
      tester,
      RoundResult(
        type: GameRoundType.location,
        score: 900,
        answer: GameRoundDetailResponseDtoAnswer(lat: 10, lon: 20),
      ),
    );

    expect(find.byKey(const Key('round-reveal-score')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Next fires once per tap', (tester) async {
    var taps = 0;
    await pump(
      tester,
      RoundResult(type: GameRoundType.location, score: 10, answer: GameRoundDetailResponseDtoAnswer(lat: 1, lon: 1)),
      onNext: () => taps++,
    );

    await tester.tap(find.byKey(const Key('round-reveal-next')));
    await tester.pump();

    expect(taps, 1);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/widgets/games/round_reveal_test.dart`
Expected: FAIL — `round_reveal.widget.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/games/round_reveal.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/reveal_map.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:intl/intl.dart';
import 'package:openapi/api.dart';

/// The reveal. Location rounds get the map, because what a location reveal has to communicate is
/// spatial; date rounds get a tick strip instead of a map they have no use for.
class RoundReveal extends StatelessWidget {
  const RoundReveal({
    super.key,
    required this.challengeId,
    required this.index,
    required this.result,
    required this.onNext,
  });

  final String challengeId;
  final int index;
  final RoundResult result;
  final VoidCallback onNext;

  @override
  Widget build(BuildContext context) {
    final isLocation = result.type == GameRoundType.location;
    return Column(
      children: [
        Expanded(child: isLocation ? _map() : _photo()),
        _summary(context),
      ],
    );
  }

  Widget _photo() => Image(
    image: RemoteImageProvider(url: getGameRoundImageUrl(challengeId, index)),
    fit: BoxFit.cover,
    color: Colors.black54,
    colorBlendMode: BlendMode.darken,
  );

  Widget _map() => RevealMap(
    key: const Key('round-reveal-map'),
    answer: (lat: result.answer?.lat?.toDouble() ?? 0, lon: result.answer?.lon?.toDouble() ?? 0),
    guess: result.guess,
  );

  Widget _summary(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(12),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'game_points'.t(context: context, args: {'score': '${result.score}'}),
            key: const Key('round-reveal-score'),
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 8),
          LinearProgressIndicator(value: scorePercent(result.score) / 100),
          const SizedBox(height: 8),
          if (result.type == GameRoundType.location && result.distanceKm != null)
            Text('game_you_were_away'.t(
              context: context,
              args: {'distance': formatDistanceKm(result.distanceKm!)},
            ))
          else if (result.type == GameRoundType.date)
            _DateStrip(result: result),
          const SizedBox(height: 12),
          FilledButton(
            key: const Key('round-reveal-next'),
            onPressed: onNext,
            child: Text('game_next_round'.t(context: context)),
          ),
        ],
      ),
    );
  }
}

class _DateStrip extends StatelessWidget {
  const _DateStrip({required this.result});

  final RoundResult result;

  @override
  Widget build(BuildContext context) {
    final answerDate = result.answer?.date;
    // `game_you_were_off` takes a single PRE-FORMATTED {offset} with its unit included, mirroring
    // `game_you_were_away`. The day noun comes from the existing generic `cutoff_day` pluraliser
    // rather than a new key — exactly what web's round-result.svelte does.
    final offsetLabel = result.offsetDays == null
        ? null
        : '${result.offsetDays} ${'cutoff_day'.t(context: context, args: {'count': result.offsetDays!})}';

    return Column(
      key: const Key('round-reveal-timeline'),
      children: [
        if (offsetLabel != null)
          Text('game_you_were_off'.t(context: context, args: {'offset': offsetLabel})),
        if (answerDate != null)
          Text(
            DateFormat.yMMMM().format(answerDate.toUtc()),
            style: Theme.of(context).textTheme.titleMedium,
          ),
      ],
    );
  }
}
```

And `mobile/lib/presentation/widgets/games/reveal_map.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/widgets/map/map_theme_override.dart';
import 'package:maplibre_gl/maplibre_gl.dart';

/// The answer map: the real location, the player's guess, and a line joining them.
///
/// Circles rather than symbols on purpose. `MapMarkers.addMarkerAtLatLng` hardcodes one shared
/// `assets/location-pin.png` image id, so two symbol markers would be visually identical — the flaw
/// `round-result.svelte` documents on web, where a near-miss collapses both pins into one badge.
class RevealMap extends StatefulWidget {
  const RevealMap({super.key, required this.answer, this.guess});

  final ({double lat, double lon}) answer;
  final ({double lat, double lon})? guess;

  @override
  State<RevealMap> createState() => _RevealMapState();
}

class _RevealMapState extends State<RevealMap> {
  MapLibreMapController? _controller;

  /// Drawn from `onStyleLoadedCallback`, never from `onMapCreated`: `addCircle` and `addLine` call
  /// `_ensureManagerInitialized`, which throws while the style is still loading.
  Future<void> _draw() async {
    final controller = _controller;
    if (controller == null) return;
    final answer = LatLng(widget.answer.lat, widget.answer.lon);
    await controller.addCircle(
      CircleOptions(geometry: answer, circleRadius: 8, circleColor: '#EF5350', circleStrokeWidth: 2),
    );

    final guess = widget.guess;
    if (guess == null) {
      await controller.animateCamera(CameraUpdate.newLatLngZoom(answer, 4));
      return;
    }

    final guessPoint = LatLng(guess.lat, guess.lon);
    await controller.addCircle(
      CircleOptions(geometry: guessPoint, circleRadius: 8, circleColor: '#ACCBFA', circleStrokeWidth: 2),
    );
    await controller.addLine(
      LineOptions(geometry: [guessPoint, answer], lineColor: '#FFFFFF', lineWidth: 2),
    );
    await controller.animateCamera(
      CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(
            guess.lat < widget.answer.lat ? guess.lat : widget.answer.lat,
            guess.lon < widget.answer.lon ? guess.lon : widget.answer.lon,
          ),
          northeast: LatLng(
            guess.lat > widget.answer.lat ? guess.lat : widget.answer.lat,
            guess.lon > widget.answer.lon ? guess.lon : widget.answer.lon,
          ),
        ),
        left: 40,
        right: 40,
        top: 40,
        bottom: 40,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MapThemeOverride(
      mapBuilder: (style) => style.widgetWhen(
        onData: (styleString) => MapLibreMap(
          styleString: styleString,
          initialCameraPosition: CameraPosition(target: LatLng(widget.answer.lat, widget.answer.lon), zoom: 3),
          onMapCreated: (controller) => _controller = controller,
          onStyleLoadedCallback: () => unawaited(_draw()),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/presentation/widgets/games/round_reveal_test.dart`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/presentation/widgets/games/round_reveal.widget.dart \
        mobile/lib/presentation/widgets/games/reveal_map.widget.dart \
        mobile/test/presentation/widgets/games/round_reveal_test.dart
git commit -m "feat(mobile): add the round reveal"
```

---

## Task 9: The play page and its route

**Files:**

- Create: `mobile/lib/pages/library/spaces/games/game_play.page.dart`
- Modify: `mobile/lib/routing/router.dart`
- Test: `mobile/test/presentation/pages/games/game_play_page_test.dart`

**Interfaces:**

- Consumes: `gameSessionProvider`, `LocationRound`, `DateRound`, `RoundReveal`, `yearFromDate`.
- Produces: `GamePlayPage({required String challengeId})` + `GamePlayRoute`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/pages/games/game_play_page_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/pages/library/spaces/games/game_play.page.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockGameApiRepository extends Mock implements GameApiRepository {}

GameChallengeDetailResponseDto _challenge(GameRoundType type) => GameChallengeDetailResponseDto(
  id: 'c1',
  spaceId: 's1',
  name: 'Challenge 1',
  roundCount: 1,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  rounds: [GameRoundDetailResponseDto(index: 0, type: type)],
);

Future<void> _pump(WidgetTester tester, GameApiRepository repository) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [gameApiRepositoryProvider.overrideWithValue(repository)],
      child: const MaterialApp(home: GamePlayPage(challengeId: 'c1')),
    ),
  );
  await tester.pump();
}

void main() {
  late _MockGameApiRepository repository;

  setUp(() => repository = _MockGameApiRepository());

  testWidgets('a location round renders the location surface', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _challenge(GameRoundType.location));

    await _pump(tester, repository);

    expect(find.byType(LocationRound), findsOneWidget);
    expect(find.byType(DateRound), findsNothing);
  });

  testWidgets('a date round renders the wheel surface', (tester) async {
    when(() => repository.getChallenge('c1')).thenAnswer((_) async => _challenge(GameRoundType.date));

    await _pump(tester, repository);

    expect(find.byType(DateRound), findsOneWidget);
    expect(find.byType(LocationRound), findsNothing);
  });

  testWidgets('a load failure shows a retry rather than an endless spinner', (tester) async {
    when(() => repository.getChallenge('c1')).thenThrow(Exception('offline'));

    await _pump(tester, repository);
    await tester.pump();

    expect(find.byKey(const Key('game-play-retry')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/pages/games/game_play_page_test.dart`
Expected: FAIL — `game_play.page.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/pages/library/spaces/games/game_play.page.dart`:

```dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/location_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_reveal.widget.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:openapi/api.dart';

/// Minimum year the date wheel offers. The answer is withheld until a round is guessed, so no round
/// in the payload carries a pool date to derive a lower bound from. Fixed, matching web.
const int _kGameMinYear = 1970;

@RoutePage()
class GamePlayPage extends ConsumerWidget {
  const GamePlayPage({super.key, required this.challengeId});

  final String challengeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(gameSessionProvider(challengeId));

    return Scaffold(
      appBar: AppBar(title: Text('game_play'.t(context: context))),
      body: session.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(
          child: FilledButton(
            key: const Key('game-play-retry'),
            onPressed: () => ref.invalidate(gameSessionProvider(challengeId)),
            child: Text('retry'.t(context: context)),
          ),
        ),
        data: (state) => _body(context, ref, state),
      ),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, GameSessionState state) {
    final controller = ref.read(gameSessionProvider(challengeId).notifier);

    if (state.phase == GamePhase.revealing && state.result != null) {
      return RoundReveal(
        challengeId: challengeId,
        index: state.currentIndex,
        result: state.result!,
        onNext: controller.next,
      );
    }

    final round = state.currentRound;
    if (round == null) {
      return Center(child: Text('game_completed'.t(context: context)));
    }

    final roundNumber = state.currentIndex + 1;
    final roundCount = state.challenge.rounds.length;

    if (round.type == GameRoundType.location) {
      return LocationRound(
        challengeId: challengeId,
        index: state.currentIndex,
        roundNumber: roundNumber,
        roundCount: roundCount,
        onGuess: ({required lat, required lon}) => controller.guessLocation(lat: lat, lon: lon),
      );
    }

    return DateRound(
      challengeId: challengeId,
      index: state.currentIndex,
      minYear: _kGameMinYear,
      maxYear: state.challenge.createdAt.toUtc().year,
      roundNumber: roundNumber,
      roundCount: roundCount,
      onGuess: controller.guessDate,
    );
  }
}
```

In `mobile/lib/routing/router.dart`, beside the other space routes:

```dart
AutoRoute(page: GamePlayRoute.page, guards: [_authGuard, _duplicateGuard]),
```

- [ ] **Step 4: Regenerate the router and run the test**

```bash
dart run build_runner build --delete-conflicting-outputs
flutter test test/presentation/pages/games/game_play_page_test.dart
```

Expected: PASS, 3 tests. `router.gr.dart` is committed, so the regenerated file is part of this commit.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/pages/library/spaces/games mobile/lib/routing/router.dart mobile/lib/routing/router.gr.dart \
        mobile/test/presentation/pages/games/game_play_page_test.dart
git commit -m "feat(mobile): add the game play page"
```

---

## Task 10: The standings section

**Files:**

- Create: `mobile/lib/presentation/widgets/games/standings_section.widget.dart`
- Test: `mobile/test/presentation/widgets/games/standings_section_test.dart`

**Interfaces:**

- Consumes: `competitionRanks`, `formatStandingsMonth`.
- Produces: `StandingsSection({GameLeaderboardResponseDto? today, required int todayRoundCount, required GameStandingsResponseDto month, required List<SharedSpaceMemberResponseDto> members, required String currentUserId})`, keys `standings-tab-today`, `standings-tab-month`, `standings-row-<userId>`, `standings-rank-<userId>`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/widgets/games/standings_section_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:openapi/api.dart';

SharedSpaceMemberResponseDto _member(String id) => SharedSpaceMemberResponseDto(
  userId: id,
  name: id,
  email: '$id@example.com',
  role: SharedSpaceRole.viewer,
  joinedAt: '2026-01-01T00:00:00Z',
  sharePersonMetadata: true,
  showInTimeline: true,
);

void main() {
  // Deliberately "wrongly sorted looking": a zero-score player ABOVE a never-played one. That is
  // exactly what the server sends, and any client-side re-sort by total would reorder these two.
  final month = GameStandingsResponseDto(
    month: '2026-08',
    entries: [
      GameStandingsResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 30, daysPlayed: 2),
      GameStandingsResponseDtoEntriesInner(userId: 'b', name: 'Bo', total: 30, daysPlayed: 3),
      GameStandingsResponseDtoEntriesInner(userId: 'c', name: 'Cy', total: 0, daysPlayed: 1),
      GameStandingsResponseDtoEntriesInner(userId: 'd', name: 'Di', total: 0, daysPlayed: 0),
    ],
  );

  Future<void> pump(WidgetTester tester, {GameLeaderboardResponseDto? today}) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: StandingsSection(
          today: today,
          todayRoundCount: 5,
          month: month,
          members: [_member('a'), _member('b'), _member('c'), _member('d')],
          currentUserId: 'a',
        ),
      ),
    ),
  );

  testWidgets('renders rows in the order the server sent them', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('standings-tab-month')));
    await tester.pump();

    final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(rows.map((row) => row.userId), ['a', 'b', 'c', 'd'],
        reason: 'A client-side sort by total would move Cy below Di');
  });

  testWidgets('ranks ties as 1, 2, 2, 4 rather than inventing a winner', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('standings-tab-month')));
    await tester.pump();

    final rows = tester.widgetList(find.byType(StandingsRow)).cast<StandingsRow>().toList();
    expect(rows.map((row) => row.rank), [1, 2, 2, 4]);
  });

  testWidgets('a member who has not played shows a dash', (tester) async {
    await pump(tester);
    await tester.tap(find.byKey(const Key('standings-tab-month')));
    await tester.pump();

    final di = tester.widget<StandingsRow>(find.byKey(const Key('standings-row-d'))) ;
    expect(di.value, '—');
  });

  testWidgets('with no daily today there are no tabs, only the monthly board', (tester) async {
    await pump(tester);

    expect(find.byKey(const Key('standings-tab-today')), findsNothing);
    expect(find.byType(StandingsRow), findsNWidgets(4));
  });

  testWidgets('with a daily it opens on Today', (tester) async {
    await pump(
      tester,
      today: GameLeaderboardResponseDto(
        entries: [GameLeaderboardResponseDtoEntriesInner(userId: 'a', name: 'Ana', total: 4000, answered: 5)],
      ),
    );

    expect(find.byKey(const Key('standings-tab-today')), findsOneWidget);
    expect(find.byType(StandingsRow), findsNWidgets(1));
  });

  testWidgets('an entry with no matching member is skipped rather than rendered nameless', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: StandingsSection(
            today: null,
            todayRoundCount: 5,
            month: month,
            members: [_member('a')],
            currentUserId: 'a',
          ),
        ),
      ),
    );

    expect(find.byType(StandingsRow), findsNWidgets(1));
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/widgets/games/standings_section_test.dart`
Expected: FAIL — `standings_section.widget.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/games/standings_section.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:openapi/api.dart';

/// One board row. A widget rather than a builder so tests can read `userId`, `rank` and `value`
/// without scraping text.
class StandingsRow extends StatelessWidget {
  const StandingsRow({
    super.key,
    required this.userId,
    required this.rank,
    required this.name,
    required this.detail,
    required this.value,
    required this.isMe,
  });

  final String userId;
  final int rank;
  final String name;
  final String detail;
  final String value;
  final bool isMe;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Text('$rank'),
      title: Text(name, style: isMe ? const TextStyle(fontWeight: FontWeight.bold) : null),
      subtitle: Text(detail),
      trailing: Text(value),
    );
  }
}

/// Today's daily board and the monthly board.
///
/// [today] is the DAILY CHALLENGE's own leaderboard, not part of the standings response, so it is
/// null whenever the space has no daily today — and then there are no tabs at all.
///
/// Neither board is sorted here. GameService already applies `compareStandings` before responding,
/// and re-sorting by total would break the rule that a member who played and scored zero still
/// outranks one who never turned up.
class StandingsSection extends StatefulWidget {
  const StandingsSection({
    super.key,
    required this.today,
    required this.todayRoundCount,
    required this.month,
    required this.members,
    required this.currentUserId,
  });

  final GameLeaderboardResponseDto? today;
  final int todayRoundCount;
  final GameStandingsResponseDto month;
  final List<SharedSpaceMemberResponseDto> members;
  final String currentUserId;

  @override
  State<StandingsSection> createState() => _StandingsSectionState();
}

class _StandingsSectionState extends State<StandingsSection> {
  bool _showToday = true;

  @override
  Widget build(BuildContext context) {
    final hasToday = widget.today != null;
    // Falls back to the monthly board whenever there is no daily, so the section always shows the
    // thing the player can act on.
    final showToday = hasToday && _showToday;
    final memberIds = {for (final member in widget.members) member.userId};

    final rows = showToday
        ? [
            for (final entry in widget.today!.entries)
              if (memberIds.contains(entry.userId))
                (
                  userId: entry.userId,
                  name: entry.name,
                  total: entry.total,
                  played: entry.answered,
                  detail: entry.answered == 0
                      ? 'game_not_played'.t(context: context)
                      : 'game_rounds_answered'.t(
                          context: context,
                          args: {'answered': '${entry.answered}', 'total': '${widget.todayRoundCount}'},
                        ),
                ),
          ]
        : [
            for (final entry in widget.month.entries)
              if (memberIds.contains(entry.userId))
                (
                  userId: entry.userId,
                  name: entry.name,
                  total: entry.total,
                  played: entry.daysPlayed,
                  // `game_days_played` is an ICU plural keyed on `count`, so it takes a NUMBER
                  // under `count` — not a pre-stringified `days`. A wrong arg name renders the raw
                  // key, silently.
                  detail: entry.daysPlayed == 0
                      ? 'game_not_played'.t(context: context)
                      : 'game_days_played'.t(context: context, args: {'count': entry.daysPlayed}),
                ),
          ];

    final ranks = competitionRanks([for (final row in rows) row.total]);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('game_leaderboard'.t(context: context), style: Theme.of(context).textTheme.titleMedium),
            if (hasToday)
              SegmentedButton<bool>(
                segments: [
                  ButtonSegment(
                    value: true,
                    label: Text('game_standings_today'.t(context: context), key: const Key('standings-tab-today')),
                  ),
                  ButtonSegment(
                    value: false,
                    label: Text(
                      formatStandingsMonth(widget.month.month),
                      key: const Key('standings-tab-month'),
                    ),
                  ),
                ],
                selected: {showToday},
                onSelectionChanged: (selection) => setState(() => _showToday = selection.first),
              ),
          ],
        ),
        for (var i = 0; i < rows.length; i++)
          StandingsRow(
            key: Key('standings-row-${rows[i].userId}'),
            userId: rows[i].userId,
            rank: ranks[i],
            name: rows[i].name,
            detail: rows[i].detail,
            value: rows[i].played == 0
                ? '—'
                : 'game_points'.t(context: context, args: {'score': '${rows[i].total}'}),
            isMe: rows[i].userId == widget.currentUserId,
          ),
      ],
    );
  }
}
```

Note: when `today` is null the segmented button is absent, so the `standings-tab-month` key is
absent too — the "no tabs" test asserts on `standings-tab-today` for that reason. When a daily
exists, tapping `standings-tab-month` switches boards.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/presentation/widgets/games/standings_section_test.dart`
Expected: PASS, 6 tests.

- [ ] **Step 5: Prove the ordering test bites**

Insert `rows.sort((a, b) => b.total.compareTo(a.total));` before the `ranks` line and re-run.
Expected: the "renders rows in the order the server sent them" test fails, because Cy moves below
Di. Remove the sort.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/games/standings_section.widget.dart \
        mobile/test/presentation/widgets/games/standings_section_test.dart
git commit -m "feat(mobile): add the games standings section"
```

---

## Task 11: Challenge cards and the create sheet

**Files:**

- Create: `mobile/lib/presentation/widgets/games/challenge_card.widget.dart`
- Create: `mobile/lib/presentation/widgets/games/challenge_create_sheet.widget.dart`
- Test: `mobile/test/presentation/widgets/games/challenge_card_test.dart`

**Interfaces:**

- Consumes: `getGameRoundImageUrl`.
- Produces:
  - `ChallengeCard({required GameChallengeListItemResponseDto challenge, required bool canDelete, required VoidCallback onTap, required VoidCallback onDelete})`, keys `challenge-card-<id>`, `challenge-card-delete-<id>`, `challenge-card-pip-<n>`.
  - `ChallengeCreateSheet.show(BuildContext) → Future<({int roundCount, GameChallengeType type})?>`, keys `create-round-count-<n>`, `create-type-<name>`, `create-submit`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/widgets/games/challenge_card_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:openapi/api.dart';

GameChallengeListItemResponseDto _challenge({num answered = 0, DateTime? dailyOn}) =>
    GameChallengeListItemResponseDto(
      id: 'c1',
      spaceId: 's1',
      name: 'Challenge 3',
      roundCount: 5,
      locationRoundCount: 3,
      answered: answered,
      total: 0,
      scaleKm: 1,
      scaleDays: 1,
      createdAt: DateTime.utc(2026, 8, 18),
      dailyOn: dailyOn,
    );

void main() {
  Future<void> pump(
    WidgetTester tester, {
    required GameChallengeListItemResponseDto challenge,
    bool canDelete = true,
    VoidCallback? onDelete,
  }) => tester.pumpWidget(
    MaterialApp(
      home: Scaffold(
        body: ChallengeCard(
          challenge: challenge,
          canDelete: canDelete,
          onTap: () {},
          onDelete: onDelete ?? () {},
        ),
      ),
    ),
  );

  testWidgets('renders one filled pip per answered round', (tester) async {
    await pump(tester, challenge: _challenge(answered: 3));

    expect(find.byType(ChallengePip), findsNWidgets(5));
    final pips = tester.widgetList(find.byType(ChallengePip)).cast<ChallengePip>().toList();
    expect(pips.where((pip) => pip.filled).length, 3);
  });

  testWidgets('a viewer is offered no delete control', (tester) async {
    await pump(tester, challenge: _challenge(), canDelete: false);

    expect(find.byKey(const Key('challenge-card-delete-c1')), findsNothing);
  });

  testWidgets('delete asks for confirmation before firing', (tester) async {
    var deleted = 0;
    await pump(tester, challenge: _challenge(), onDelete: () => deleted++);

    await tester.tap(find.byKey(const Key('challenge-card-delete-c1')));
    await tester.pumpAndSettle();
    expect(deleted, 0, reason: 'The dialog must stand between the tap and the deletion');

    await tester.tap(find.byKey(const Key('challenge-card-delete-confirm')));
    await tester.pumpAndSettle();
    expect(deleted, 1);
  });

  testWidgets('a daily is never deletable, whatever the role says', (tester) async {
    await pump(tester, challenge: _challenge(dailyOn: DateTime.utc(2026, 8, 18)), canDelete: true);

    expect(find.byKey(const Key('challenge-card-delete-c1')), findsNothing);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/widgets/games/challenge_card_test.dart`
Expected: FAIL — `challenge_card.widget.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/presentation/widgets/games/challenge_card.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';
import 'package:openapi/api.dart';

class ChallengePip extends StatelessWidget {
  const ChallengePip({super.key, required this.filled});

  final bool filled;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 8,
      height: 8,
      margin: const EdgeInsets.only(right: 4),
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: filled ? Theme.of(context).colorScheme.primary : Theme.of(context).colorScheme.surfaceContainerHighest,
      ),
    );
  }
}

class ChallengeCard extends StatelessWidget {
  const ChallengeCard({
    super.key,
    required this.challenge,
    required this.canDelete,
    required this.onTap,
    required this.onDelete,
  });

  final GameChallengeListItemResponseDto challenge;
  final bool canDelete;
  final VoidCallback onTap;
  final VoidCallback onDelete;

  /// A daily is shared state, not one member's row, and the server refuses to delete it with a 400.
  /// Hiding the control keeps the client from offering an action that cannot succeed.
  bool get _deletable => canDelete && challenge.dailyOn == null;

  Future<void> _confirmDelete(BuildContext context) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text('game_delete_challenge'.t(context: context)),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(false), child: Text('cancel'.t(context: context))),
          TextButton(
            key: const Key('challenge-card-delete-confirm'),
            onPressed: () => Navigator.of(context).pop(true),
            child: Text('delete'.t(context: context)),
          ),
        ],
      ),
    );
    if (confirmed ?? false) onDelete();
  }

  @override
  Widget build(BuildContext context) {
    final answered = challenge.answered.toInt();
    final total = challenge.roundCount.toInt();

    return InkWell(
      key: Key('challenge-card-${challenge.id}'),
      onTap: onTap,
      child: Stack(
        children: [
          // Round 0's image is already a generic, EXIF-free preview keyed by (challenge, index), so
          // using it as a backdrop leaks nothing the player would not see on entering the round.
          Positioned.fill(
            child: Image(
              image: RemoteImageProvider(url: getGameRoundImageUrl(challenge.id, 0)),
              fit: BoxFit.cover,
              opacity: const AlwaysStoppedAnimation(0.5),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Text(challenge.name),
                Row(
                  children: [
                    for (var i = 0; i < total; i++)
                      ChallengePip(key: Key('challenge-card-pip-$i'), filled: i < answered),
                  ],
                ),
              ],
            ),
          ),
          if (_deletable)
            Positioned(
              top: 0,
              right: 0,
              child: IconButton(
                key: Key('challenge-card-delete-${challenge.id}'),
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _confirmDelete(context),
              ),
            ),
        ],
      ),
    );
  }
}
```

`mobile/lib/presentation/widgets/games/challenge_create_sheet.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:openapi/api.dart';

/// Round-count and type pickers. Returns null if the sheet is dismissed.
class ChallengeCreateSheet extends StatefulWidget {
  const ChallengeCreateSheet({super.key});

  static Future<({int roundCount, GameChallengeType type})?> show(BuildContext context) {
    return showModalBottomSheet<({int roundCount, GameChallengeType type})>(
      context: context,
      builder: (_) => const ChallengeCreateSheet(),
    );
  }

  @override
  State<ChallengeCreateSheet> createState() => _ChallengeCreateSheetState();
}

class _ChallengeCreateSheetState extends State<ChallengeCreateSheet> {
  int _roundCount = 5;
  GameChallengeType _type = GameChallengeType.mixed;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('game_round_count'.t(context: context)),
          SegmentedButton<int>(
            segments: [
              for (final count in [3, 5, 10])
                ButtonSegment(value: count, label: Text('$count', key: Key('create-round-count-$count'))),
            ],
            selected: {_roundCount},
            onSelectionChanged: (selection) => setState(() => _roundCount = selection.first),
          ),
          const SizedBox(height: 12),
          Text('game_type'.t(context: context)),
          SegmentedButton<GameChallengeType>(
            segments: [
              ButtonSegment(
                value: GameChallengeType.mixed,
                label: Text('game_type_mixed'.t(context: context), key: const Key('create-type-mixed')),
              ),
              ButtonSegment(
                value: GameChallengeType.location,
                label: Text('game_type_location'.t(context: context), key: const Key('create-type-location')),
              ),
              ButtonSegment(
                value: GameChallengeType.date,
                label: Text('game_type_date'.t(context: context), key: const Key('create-type-date')),
              ),
            ],
            selected: {_type},
            onSelectionChanged: (selection) => setState(() => _type = selection.first),
          ),
          const SizedBox(height: 16),
          FilledButton(
            key: const Key('create-submit'),
            onPressed: () => Navigator.of(context).pop((roundCount: _roundCount, type: _type)),
            child: Text('game_new_challenge'.t(context: context)),
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/presentation/widgets/games/challenge_card_test.dart`
Expected: PASS, 4 tests.

- [ ] **Step 5: Prove the confirm dialog bites**

Change `onPressed: () => _confirmDelete(context)` to `onPressed: onDelete` and re-run. Expected: the
confirmation test fails with `deleted == 1` before the dialog. Restore.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/games/challenge_card.widget.dart \
        mobile/lib/presentation/widgets/games/challenge_create_sheet.widget.dart \
        mobile/test/presentation/widgets/games/challenge_card_test.dart
git commit -m "feat(mobile): add the game challenge card and create sheet"
```

---

## Task 12: The daily card, the opt-in prompt, and the space update

**Files:**

- Create: `mobile/lib/presentation/widgets/games/daily_challenge_card.widget.dart`
- Create: `mobile/lib/presentation/widgets/games/daily_challenge_prompt.widget.dart`
- Modify: `mobile/lib/repositories/shared_space_api.repository.dart`
- Test: `mobile/test/presentation/widgets/games/daily_challenge_card_test.dart`
- Test: `mobile/test/repositories/shared_space_daily_toggle_test.dart`

**Interfaces:**

- Consumes: `gameDailyProvider`, `timeUntilNextDaily`.
- Produces:
  - `DailySlot({required String spaceId, required bool? dailyChallengeEnabled, required bool canEdit, required void Function(bool enabled) onDecide, required VoidCallback onPlay, required VoidCallback onStandings})` — the whole tri-state slot, keys `daily-card`, `daily-prompt`, `daily-play`, `daily-standings`.
  - `const double kDailySlotHeight` — the fixed reservation.
  - `SharedSpaceApiRepository.update(..., bool? dailyChallengeEnabled)`.

- [ ] **Step 1: Write the failing tests**

`mobile/test/repositories/shared_space_daily_toggle_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/services/api.service.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockApiService extends Mock implements ApiService {}

class _MockSpacesApi extends Mock implements SharedSpacesApi {}

void main() {
  late _MockApiService apiService;
  late _MockSpacesApi spacesApi;
  late SharedSpaceApiRepository repository;

  setUpAll(() => registerFallbackValue(SharedSpaceUpdateDto()));

  setUp(() {
    apiService = _MockApiService();
    spacesApi = _MockSpacesApi();
    when(() => apiService.sharedSpacesApi).thenReturn(spacesApi);
    when(() => spacesApi.updateSpace(any(), any())).thenAnswer(
      (_) async => SharedSpaceResponseDto(
        id: 's1',
        name: 'Space',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        createdById: 'u1',
      ),
    );
    repository = SharedSpaceApiRepository(apiService);
  });

  SharedSpaceUpdateDto captureDto() =>
      verify(() => spacesApi.updateSpace('s1', captureAny())).captured.single as SharedSpaceUpdateDto;

  test('turning the daily on sends present(true) and touches nothing else', () async {
    await repository.update('s1', dailyChallengeEnabled: true);

    final dto = captureDto();
    expect(dto.dailyChallengeEnabled.orElse(null), isTrue);
    expect(dto.name.isPresent, isFalse);
    expect(dto.description.isPresent, isFalse);
    expect(dto.color.isPresent, isFalse);
  });

  test('turning it off sends present(false), not absent', () async {
    await repository.update('s1', dailyChallengeEnabled: false);

    expect(captureDto().dailyChallengeEnabled.orElse(null), isFalse);
  });

  test('a rename leaves the daily setting absent rather than clobbering it', () async {
    await repository.update('s1', name: 'Renamed');

    expect(captureDto().dailyChallengeEnabled.isPresent, isFalse);
  });
}
```

`mobile/test/presentation/widgets/games/daily_challenge_card_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:openapi/api.dart';

GameChallengeListItemResponseDto _daily({num answered = 0}) => GameChallengeListItemResponseDto(
  id: 'daily-1',
  spaceId: 's1',
  name: '2026-08-18',
  roundCount: 5,
  locationRoundCount: 3,
  answered: answered,
  total: 18420,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
  dailyOn: DateTime.utc(2026, 8, 18),
);

Future<void> pump(
  WidgetTester tester, {
  required bool? enabled,
  required bool canEdit,
  GameChallengeListItemResponseDto? daily,
}) => tester.pumpWidget(
  ProviderScope(
    overrides: [gameDailyProvider('s1').overrideWith((ref) async => daily)],
    child: MaterialApp(
      home: Scaffold(
        body: DailySlot(
          spaceId: 's1',
          dailyChallengeEnabled: enabled,
          canEdit: canEdit,
          onDecide: (_) {},
          onPlay: () {},
          onStandings: () {},
        ),
      ),
    ),
  ),
);

void main() {
  testWidgets('an un-asked space prompts an editor', (tester) async {
    await pump(tester, enabled: null, canEdit: true);
    await tester.pump();

    expect(find.byKey(const Key('daily-prompt')), findsOneWidget);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('an un-asked space shows a viewer nothing at all', (tester) async {
    await pump(tester, enabled: null, canEdit: false);
    await tester.pump();

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('a declined space shows an editor nothing', (tester) async {
    await pump(tester, enabled: false, canEdit: true);
    await tester.pump();

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  testWidgets('an enabled space offers Play while the daily is unplayed', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily());
    await tester.pump();

    expect(find.byKey(const Key('daily-play')), findsOneWidget);
    expect(find.byKey(const Key('daily-standings')), findsNothing);
  });

  testWidgets('a played daily flips to the score and the standings link', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));
    await tester.pump();

    expect(find.byKey(const Key('daily-standings')), findsOneWidget);
    expect(find.byKey(const Key('daily-play')), findsNothing);
  });

  testWidgets('the slot reserves the same height played or unplayed', (tester) async {
    await pump(tester, enabled: true, canEdit: false, daily: _daily());
    await tester.pump();
    final unplayed = tester.getSize(find.byKey(const Key('daily-card'))).height;

    await pump(tester, enabled: true, canEdit: false, daily: _daily(answered: 5));
    await tester.pump();
    final played = tester.getSize(find.byKey(const Key('daily-card'))).height;

    expect(played, unplayed, reason: 'A height change would jitter the timeline scrubber offset');
  });
}
```

- [ ] **Step 2: Run both and confirm they fail**

Run: `flutter test test/repositories/shared_space_daily_toggle_test.dart test/presentation/widgets/games/daily_challenge_card_test.dart`
Expected: FAIL — the parameter and the widget do not exist.

- [ ] **Step 3: Implement the repository change**

In `mobile/lib/repositories/shared_space_api.repository.dart`, extend `update`:

```dart
  /// [dailyChallengeEnabled] is EDITOR-level, not owner-level: `SharedSpaceService.update` computes
  /// its minimum role from the payload and deliberately leaves this field out of
  /// `isOwnerOnlySettingsUpdate`. Gating it to owners on the client would disagree with web.
  ///
  /// `null` means absent — leave it alone. There is no way to write the column back to "never
  /// asked", and none is wanted: the server schema is `z.boolean().optional()` (optional, NOT
  /// nullable), so `Optional.present(null)` is a 400.
  Future<SharedSpaceResponseDto> update(
    String id, {
    String? name,
    String? description,
    UserAvatarColor? color,
    bool? dailyChallengeEnabled,
  }) async {
    final dto = SharedSpaceUpdateDto(
      name: name == null ? const Optional.absent() : Optional.present(name.trim()),
      description: description == null ? const Optional.absent() : Optional.present(description),
      color: color == null ? const Optional.absent() : Optional.present(color),
      dailyChallengeEnabled:
          dailyChallengeEnabled == null ? const Optional.absent() : Optional.present(dailyChallengeEnabled),
    );
    // ... existing call unchanged
  }
```

- [ ] **Step 4: Implement the slot**

`mobile/lib/presentation/widgets/games/daily_challenge_prompt.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';

/// Asked once per space, of editors only. Declining is sticky and reversible.
class DailyChallengePrompt extends StatelessWidget {
  const DailyChallengePrompt({super.key, required this.onDecide});

  final void Function(bool enabled) onDecide;

  @override
  Widget build(BuildContext context) {
    return Card(
      key: const Key('daily-prompt'),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('game_daily_enable_title'.t(context: context)),
            Text('game_daily_enable_description'.t(context: context)),
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                TextButton(
                  key: const Key('daily-prompt-decline'),
                  onPressed: () => onDecide(false),
                  child: Text('game_daily_decline'.t(context: context)),
                ),
                FilledButton(
                  key: const Key('daily-prompt-enable'),
                  onPressed: () => onDecide(true),
                  child: Text('game_daily_enable'.t(context: context)),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
```

`mobile/lib/presentation/widgets/games/daily_challenge_card.widget.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_prompt.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/utils/game_format.dart';
import 'package:immich_mobile/utils/image_url_builder.dart';

/// Fixed height for the whole slot, in every state that renders something.
///
/// The sliver must declare its height BEFORE the daily arrives — the scrubber consumes it
/// synchronously at layout time — so this is a constant rather than a measurement. The played and
/// unplayed cards are the same height for the same reason.
const double kDailySlotHeight = 92;

/// The tri-state daily slot.
///
/// | dailyChallengeEnabled | editor | viewer |
/// | null                  | prompt | nothing |
/// | true                  | card   | card    |
/// | false                 | nothing| nothing |
class DailySlot extends ConsumerWidget {
  const DailySlot({
    super.key,
    required this.spaceId,
    required this.dailyChallengeEnabled,
    required this.canEdit,
    required this.onDecide,
    required this.onPlay,
    required this.onStandings,
  });

  final String spaceId;
  final bool? dailyChallengeEnabled;
  final bool canEdit;
  final void Function(bool enabled) onDecide;
  final VoidCallback onPlay;
  final VoidCallback onStandings;

  /// The height to reserve. Depends only on values the page already holds synchronously, never on
  /// the daily provider's async state.
  static double reservedHeight({required bool? dailyChallengeEnabled, required bool canEdit}) {
    if (dailyChallengeEnabled == null) return canEdit ? kDailySlotHeight : 0;
    return dailyChallengeEnabled ? kDailySlotHeight : 0;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (dailyChallengeEnabled == null) {
      return canEdit
          ? SizedBox(height: kDailySlotHeight, child: DailyChallengePrompt(onDecide: onDecide))
          : const SizedBox.shrink();
    }
    if (!dailyChallengeEnabled!) return const SizedBox.shrink();

    // Only reached for an opted-in space: reading this generates the daily server-side.
    final daily = ref.watch(gameDailyProvider(spaceId));

    return SizedBox(
      height: kDailySlotHeight,
      child: daily.when(
        loading: () => const Card(child: Center(child: CircularProgressIndicator())),
        error: (_, __) => Card(
          child: Center(child: Text('game_daily_unavailable'.t(context: context))),
        ),
        data: (challenge) {
          if (challenge == null) {
            return Card(child: Center(child: Text('game_daily_unavailable'.t(context: context))));
          }
          final played = challenge.answered >= challenge.roundCount;
          return Card(
            key: const Key('daily-card'),
            child: Stack(
              children: [
                Positioned.fill(
                  child: Image(
                    image: RemoteImageProvider(url: getGameRoundImageUrl(challenge.id, 0)),
                    fit: BoxFit.cover,
                    opacity: const AlwaysStoppedAnimation(0.45),
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(10),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text('game_daily_challenge'.t(context: context)),
                          if (played)
                            Text('game_daily_next_in'.t(
                              context: context,
                              args: {'time': timeUntilNextDaily(DateTime.now().toUtc())},
                            )),
                        ],
                      ),
                      played
                          ? FilledButton(
                              key: const Key('daily-standings'),
                              onPressed: onStandings,
                              child: Text('game_leaderboard'.t(context: context)),
                            )
                          : FilledButton(
                              key: const Key('daily-play'),
                              onPressed: onPlay,
                              child: Text('game_play'.t(context: context)),
                            ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
```

- [ ] **Step 5: Run both tests and confirm they pass**

Run: `flutter test test/repositories/shared_space_daily_toggle_test.dart test/presentation/widgets/games/daily_challenge_card_test.dart`
Expected: PASS, 9 tests.

- [ ] **Step 6: Prove the Optional discipline bites**

Change `dailyChallengeEnabled == null ? const Optional.absent() : ...` to
`Optional.present(dailyChallengeEnabled)` and re-run. Expected: the rename test fails — it would
send `present(null)`, the payload the server 400s on. Restore.

- [ ] **Step 7: Commit**

```bash
git add mobile/lib/presentation/widgets/games/daily_challenge_card.widget.dart \
        mobile/lib/presentation/widgets/games/daily_challenge_prompt.widget.dart \
        mobile/lib/repositories/shared_space_api.repository.dart \
        mobile/test/repositories/shared_space_daily_toggle_test.dart \
        mobile/test/presentation/widgets/games/daily_challenge_card_test.dart
git commit -m "feat(mobile): add the daily challenge slot and its opt-in"
```

---

## Task 13: The Challenges page

**Files:**

- Create: `mobile/lib/pages/library/spaces/games/space_games.page.dart`
- Modify: `mobile/lib/routing/router.dart`
- Test: `mobile/test/presentation/pages/games/space_games_page_test.dart`

**Interfaces:**

- Consumes: `gameDailyProvider`, `gameChallengesProvider`, `gameStandingsProvider`, `gameLeaderboardProvider`, `sharedSpaceMembersProvider`, `DailySlot`, `StandingsSection`, `ChallengeCard`, `ChallengeCreateSheet`, `shouldShowStandings`.
- Produces: `SpaceGamesPage({required String spaceId, required bool canEdit})` + `SpaceGamesRoute`, keys `space-games-create`, `space-games-retry`.

- [ ] **Step 1: Write the failing test**

`mobile/test/presentation/pages/games/space_games_page_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/pages/library/spaces/games/space_games.page.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:openapi/api.dart';

GameChallengeListItemResponseDto _challenge(String id) => GameChallengeListItemResponseDto(
  id: id,
  spaceId: 's1',
  name: id,
  roundCount: 5,
  locationRoundCount: 3,
  answered: 0,
  total: 0,
  scaleKm: 1,
  scaleDays: 1,
  createdAt: DateTime.utc(2026, 8, 18),
);

Future<void> pump(
  WidgetTester tester, {
  required bool canEdit,
  List<GameChallengeListItemResponseDto> challenges = const [],
  Object? challengesError,
}) => tester.pumpWidget(
  ProviderScope(
    overrides: [
      gameDailyProvider('s1').overrideWith((ref) async => null),
      gameStandingsProvider('s1').overrideWith(
        (ref) async => GameStandingsResponseDto(month: '2026-08', entries: []),
      ),
      sharedSpaceMembersProvider('s1').overrideWith((ref) async => []),
      if (challengesError != null)
        gameChallengesProvider('s1').overrideWith((ref) async => throw challengesError)
      else
        gameChallengesProvider('s1').overrideWith((ref) async => challenges),
    ],
    child: MaterialApp(home: SpaceGamesPage(spaceId: 's1', canEdit: canEdit)),
  ),
);

void main() {
  testWidgets('an editor is offered the create control', (tester) async {
    await pump(tester, canEdit: true);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-games-create')), findsOneWidget);
  });

  testWidgets('a viewer is not', (tester) async {
    await pump(tester, canEdit: false);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-games-create')), findsNothing);
  });

  testWidgets('lists the space custom challenges', (tester) async {
    await pump(tester, canEdit: false, challenges: [_challenge('c1'), _challenge('c2')]);
    await tester.pumpAndSettle();

    expect(find.byType(ChallengeCard), findsNWidgets(2));
  });

  testWidgets('a failed load offers a retry rather than an empty page', (tester) async {
    await pump(tester, canEdit: false, challengesError: Exception('offline'));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('space-games-retry')), findsOneWidget);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/presentation/pages/games/space_games_page_test.dart`
Expected: FAIL — `space_games.page.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/pages/library/spaces/games/space_games.page.dart`:

```dart
import 'package:auto_route/auto_route.dart';
import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/extensions/translate_extensions.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_create_sheet.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/standings_section.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:immich_mobile/routing/router.dart';
import 'package:openapi/api.dart';

@RoutePage()
class SpaceGamesPage extends ConsumerWidget {
  const SpaceGamesPage({super.key, required this.spaceId, required this.canEdit});

  final String spaceId;
  final bool canEdit;

  Future<void> _create(BuildContext context, WidgetRef ref) async {
    final choice = await ChallengeCreateSheet.show(context);
    if (choice == null) return;
    await ref.read(gameApiRepositoryProvider).createChallenge(
      spaceId,
      roundCount: choice.roundCount,
      type: choice.type,
    );
    ref.invalidate(gameChallengesProvider(spaceId));
  }

  Future<void> _delete(WidgetRef ref, String challengeId) async {
    await ref.read(gameApiRepositoryProvider).deleteChallenge(challengeId);
    ref.invalidate(gameChallengesProvider(spaceId));
  }

  Future<void> _decideDaily(WidgetRef ref, bool enabled) async {
    await ref.read(sharedSpaceApiRepositoryProvider).update(spaceId, dailyChallengeEnabled: enabled);
    ref.invalidate(sharedSpaceProvider(spaceId));
    ref.invalidate(gameDailyProvider(spaceId));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final space = ref.watch(sharedSpaceProvider(spaceId));
    final challenges = ref.watch(gameChallengesProvider(spaceId));
    final standings = ref.watch(gameStandingsProvider(spaceId));
    final members = ref.watch(sharedSpaceMembersProvider(spaceId));
    final daily = ref.watch(gameDailyProvider(spaceId));
    final currentUserId = ref.watch(currentUserProvider)?.id ?? '';

    // `Absent.value` THROWS, so this must stay `.orElse(null)`.
    final enabled = space.valueOrNull?.dailyChallengeEnabled.orElse(null);
    final dailyChallenge = daily.valueOrNull;
    final todayBoard = dailyChallenge == null ? null : ref.watch(gameLeaderboardProvider(dailyChallenge.id));

    return Scaffold(
      appBar: AppBar(title: Text('game_challenges'.t(context: context))),
      body: challenges.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(
          child: FilledButton(
            key: const Key('space-games-retry'),
            onPressed: () => ref.invalidate(gameChallengesProvider(spaceId)),
            child: Text('retry'.t(context: context)),
          ),
        ),
        data: (list) => ListView(
          padding: const EdgeInsets.all(12),
          children: [
            DailySlot(
              spaceId: spaceId,
              dailyChallengeEnabled: enabled,
              canEdit: canEdit,
              onDecide: (value) => _decideDaily(ref, value),
              onPlay: () => context.pushRoute(GamePlayRoute(challengeId: dailyChallenge!.id)),
              onStandings: () {},
            ),
            const SizedBox(height: 16),
            if (standings.valueOrNull != null &&
                shouldShowStandingsFor(enabled, standings.requireValue))
              StandingsSection(
                today: todayBoard?.valueOrNull,
                todayRoundCount: dailyChallenge?.roundCount.toInt() ?? 0,
                month: standings.requireValue,
                members: members.valueOrNull ?? const [],
                currentUserId: currentUserId,
              ),
            const SizedBox(height: 16),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('game_your_challenges'.t(context: context)),
                if (canEdit)
                  IconButton(
                    key: const Key('space-games-create'),
                    icon: const Icon(Icons.add),
                    onPressed: () => _create(context, ref),
                  ),
              ],
            ),
            if (list.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 24),
                child: Text('game_no_challenges'.t(context: context), textAlign: TextAlign.center),
              ),
            for (final challenge in list)
              SizedBox(
                height: 90,
                child: ChallengeCard(
                  challenge: challenge,
                  canDelete: canEdit,
                  onTap: () => context.pushRoute(GamePlayRoute(challengeId: challenge.id)),
                  onDelete: () => _delete(ref, challenge.id),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Adapts the DTO to the pure rule in game_format.dart.
bool shouldShowStandingsFor(bool? enabled, GameStandingsResponseDto standings) =>
    shouldShowStandings(enabled, [for (final entry in standings.entries) entry.daysPlayed]);
```

Add the import for `shouldShowStandings` from `package:immich_mobile/utils/game_format.dart`, and
register the route in `mobile/lib/routing/router.dart`:

```dart
AutoRoute(page: SpaceGamesRoute.page, guards: [_authGuard, _duplicateGuard]),
```

- [ ] **Step 4: Regenerate and run**

```bash
dart run build_runner build --delete-conflicting-outputs
flutter test test/presentation/pages/games/space_games_page_test.dart
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/pages/library/spaces/games/space_games.page.dart mobile/lib/routing/router.dart \
        mobile/lib/routing/router.gr.dart mobile/test/presentation/pages/games/space_games_page_test.dart
git commit -m "feat(mobile): add the space challenges page"
```

---

## Task 14: Wire the game into the space

**Files:**

- Modify: `mobile/lib/presentation/widgets/spaces/space_detail_kebab.widget.dart`
- Modify: `mobile/lib/presentation/widgets/spaces/space_top_sliver.widget.dart`
- Modify: `mobile/lib/pages/library/spaces/space_detail.page.dart`
- Test: `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart` (extend if present, else create)
- Test: `mobile/test/presentation/pages/space_detail_top_sliver_test.dart` (extend)

**Interfaces:**

- Consumes: `DailySlot`, `DailySlot.reservedHeight`.
- Produces: `SpaceDetailKebab({... required VoidCallback onChallenges})` and `SpaceTopSliver({... required bool? dailyChallengeEnabled, required VoidCallback onPlayDaily, required VoidCallback onDailyStandings, required void Function(bool) onDecideDaily})`.

- [ ] **Step 1: Write the failing tests**

Add to `mobile/test/presentation/widgets/spaces/space_detail_kebab_test.dart`:

```dart
  testWidgets('the Challenges item is offered to viewers as well as editors', (tester) async {
    for (final canEdit in [true, false]) {
      await tester.pumpWidget(/* the file's existing harness, with canEdit: canEdit */);
      await tester.tap(find.byKey(const Key('space-detail-kebab')));
      await tester.pumpAndSettle();

      expect(
        find.byKey(const Key('space-detail-kebab-challenges')),
        findsOneWidget,
        reason: 'Playing needs membership, not the editor role',
      );
    }
  });
```

Add to `mobile/test/presentation/pages/space_detail_top_sliver_test.dart`:

```dart
  test('the daily slot reserves height only when it renders something', () {
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: null, canEdit: true), kDailySlotHeight);
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: null, canEdit: false), 0);
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: false, canEdit: true), 0);
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: true, canEdit: false), kDailySlotHeight);
  });
```

- [ ] **Step 2: Run both and confirm they fail**

Run: `flutter test test/presentation/widgets/spaces/space_detail_kebab_test.dart test/presentation/pages/space_detail_top_sliver_test.dart`
Expected: FAIL — no `space-detail-kebab-challenges`, no `DailySlot` import.

- [ ] **Step 3: Implement**

In `space_detail_kebab.widget.dart`, add `onChallenges` to the constructor and the `_KebabAction`
enum, and a menu item **without a `canEdit` gate**:

```dart
        PopupMenuItem<_KebabAction>(
          key: const Key('space-detail-kebab-challenges'),
          value: _KebabAction.challenges,
          child: Text('game_challenges'.t(context: context)),
        ),
```

In `space_top_sliver.widget.dart`, put the slot above the albums shelf and add its height:

```dart
          const SyncStatusBanner(),
          DailySlot(
            spaceId: spaceId,
            dailyChallengeEnabled: dailyChallengeEnabled,
            canEdit: canEdit,
            onDecide: onDecideDaily,
            onPlay: onPlayDaily,
            onStandings: onDailyStandings,
          ),
          SpaceAlbumsShelf(/* unchanged */),
```

and in `computeTopSliverHeight`:

```dart
  // Depends only on values the page already holds synchronously, so unlike the shelf below it this
  // reservation never jitters while data loads.
  final dailyHeight = DailySlot.reservedHeight(
    dailyChallengeEnabled: dailyChallengeEnabled,
    canEdit: canEdit,
  );

  return bannerHeight + dailyHeight + shelfHeight;
```

In `space_detail.page.dart`, pass `_space!.dailyChallengeEnabled.orElse(null)` into the sliver, wire
the kebab item to `context.pushRoute(SpaceGamesRoute(spaceId: widget.spaceId, canEdit: _canEdit))`,
and route the daily's Play to `GamePlayRoute`.

- [ ] **Step 4: Run the full mobile suite**

Run: `flutter test`
Expected: PASS. The full suite is ~2900 tests and takes about a minute; it exits cleanly, unlike a
file-scoped run.

- [ ] **Step 5: Run both CI gates**

```bash
dart analyze --fatal-infos
dart format --set-exit-if-changed $(find lib -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
git status -- '*mise.lock'
```

Expected: no issues, no formatting changes, and **no modification to either `mise.lock`** — any
`mise` invocation rewrites them, and that is 100+ lines of silent damage that kills CI.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/presentation/widgets/spaces mobile/lib/pages/library/spaces/space_detail.page.dart \
        mobile/test/presentation/widgets/spaces mobile/test/presentation/pages/space_detail_top_sliver_test.dart
git commit -m "feat(mobile): surface the photo guessing game from the space"
```

---

## Self-Review

**Spec coverage.** Every section of the design maps to a task: pure helpers → 1; the round-image
rule → 2; repository → 3; providers → 4; play state machine → 5; location surface → 6; date surface
→ 7; reveal → 8; play page → 9; standings → 10; cards and create/delete → 11; daily slot and opt-in
→ 12; Challenges page → 13; timeline and kebab wiring → 14. The answer-leak rules are enforced in
Tasks 2 (single call site, with a source guard), 6 (`GuessMap`, never `DriftMap`) and 5 (answers
only from a refetch).

**Not covered here, by design:** the daily reminder. It is a separable deliverable that depends on
Task 5's `onDailyCompleted` hook, and it is the only part of the spec needing new i18n keys. It gets
its own plan, `2026-08-18-mobile-daily-challenge-reminder.md`.

**Type consistency.** `RoundResult`, `GamePhase` and `GameSessionState` are defined in Task 5 and
consumed unchanged in Tasks 8 and 9. `getGameRoundImageUrl(String, int)` is defined in Task 2 and
used in 6, 7, 8, 11, 12. `DailySlot.reservedHeight` is defined in Task 12 and consumed in Task 14.
`StandingsRow` is defined in Task 10 and asserted on in the same task's tests only.
