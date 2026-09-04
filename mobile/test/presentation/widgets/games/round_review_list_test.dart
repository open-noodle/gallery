import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_review_list.widget.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

/// A guessed location round. Defaults land on a 412 km miss so the default call reads the same
/// number the "shows the distance" test asserts against.
GameRoundDetailResponseDto _guessedLocation(int index, {num score = 4182, double? distanceKm = 412.3}) =>
    GameRoundDetailResponseDto(
      index: index,
      type: GameRoundType.location,
      assetId: const Optional.present('asset-1'),
      score: Optional.present(score),
      answer: Optional.present(GameRoundDetailResponseDtoAnswer(date: null, lat: 41.15, lon: -8.61)),
      guess: Optional.present(
        GameRoundDetailResponseDtoGuess(lat: 38.72, lon: -9.14, date: null, distanceKm: distanceKm, offsetDays: null),
      ),
    );

/// A guessed date round. Defaults land on a 3-day miss.
GameRoundDetailResponseDto _guessedDate(int index, {num score = 3640, int? offsetDays = 3}) => GameRoundDetailResponseDto(
  index: index,
  type: GameRoundType.date,
  assetId: const Optional.present('asset-2'),
  score: Optional.present(score),
  answer: Optional.present(GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2024, 6, 4), lat: null, lon: null)),
  guess: Optional.present(
    GameRoundDetailResponseDtoGuess(lat: null, lon: null, date: DateTime.utc(2024, 6, 1), distanceKm: null, offsetDays: offsetDays),
  ),
);

/// A round the caller has not guessed yet — no score, no guess, no answer.
GameRoundDetailResponseDto _unguessed(int index) => GameRoundDetailResponseDto(index: index, type: GameRoundType.location);

/// A guessed round from a server predating this change: `score`/`answer` are real (the caller DID
/// play it) but the response carries no `guess` object at all — omitting the `guess:` argument
/// leaves `GameRoundDetailResponseDto.guess` at its generated `Optional.absent()` default, the exact
/// shape an older server sends. `distanceKm`/`offsetDays` therefore both come back null rather than
/// present-and-zero.
GameRoundDetailResponseDto _guessedWithoutGuessField(int index, {GameRoundType type = GameRoundType.location}) =>
    GameRoundDetailResponseDto(
      index: index,
      type: type,
      assetId: const Optional.present('asset-1'),
      score: const Optional.present(4182),
      answer: Optional.present(
        type == GameRoundType.location
            ? GameRoundDetailResponseDtoAnswer(date: null, lat: 41.15, lon: -8.61)
            : GameRoundDetailResponseDtoAnswer(date: DateTime.utc(2024, 6, 4), lat: null, lon: null),
      ),
    );

void main() {
  // RoundReviewList's rows build a RemoteImageProvider URL via getGameRoundImageUrl, which reads
  // Store.get(StoreKey.serverEndpoint) — that throws unless the Store is initialized. Mirrors
  // daily_challenge_card_test.dart, which hits the same dependency.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
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

  Future<void> pump(
    WidgetTester tester, {
    required List<GameRoundDetailResponseDto> rounds,
    void Function(int index)? onRoundTap,
  }) => tester.pumpConsumerWidget(
    RoundReviewList(challengeId: 'c1', rounds: rounds, onRoundTap: onRoundTap ?? (_) {}),
  );

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

  // Four of the six i18n keys this widget introduces were previously asserted nowhere: a wrong arg
  // name on game_review_round would silently render the literal "Round {index} · Place" and every
  // other test here would stay green (none of them read the title or the heading). The score cell
  // was likewise unasserted. Pins the row title, the section heading, and the grouped score text.
  testWidgets('the row title, section heading and score cell resolve their i18n keys', (tester) async {
    await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)]);

    expect(find.text('Your rounds'), findsOneWidget);
    expect(find.text('Round 1 · Place'), findsOneWidget);
    expect(find.text('Round 2 · Date'), findsOneWidget);
    // Grouped, not bare interpolation — game_points substitutes {score} verbatim, so a raw number
    // would render "4182 pts" instead of "4,182 pts".
    expect(find.text('4,182 pts'), findsOneWidget);
    expect(find.text('3,640 pts'), findsOneWidget);
  });

  // Reachable against a server older than this change, where `guess` is absent entirely: score and
  // answer are real (the caller DID play the round) but there is nothing to compute a miss from.
  // `?? 0` here would render "0 m off" / "0 days off" — a fabricated pinpoint hit claiming the guess
  // landed exactly on the answer. The row must show no subtitle at all instead, matching
  // round_reveal.widget.dart's null-not-(0,0) convention and the leaderboard's dash-not-zero rule.
  testWidgets('renders no miss line when the guess is missing entirely', (tester) async {
    await pump(
      tester,
      rounds: [_guessedWithoutGuessField(0), _guessedWithoutGuessField(1, type: GameRoundType.date)],
    );

    expect(find.textContaining('off'), findsNothing);
    final tiles = tester.widgetList<ListTile>(find.byType(ListTile));
    expect(tiles.map((tile) => tile.subtitle), everyElement(isNull));
  });

  // The heading is the only thing that would otherwise render over nothing.
  testWidgets('a challenge with nothing guessed renders no section at all', (tester) async {
    await pump(tester, rounds: [_unguessed(0), _unguessed(1)]);

    expect(find.byKey(const Key('round-review-list')), findsNothing);
  });

  // A round scored 0 IS played — the filter tests `score != null`, not truthiness. Getting that
  // wrong drops the worst round of every game, which is the one people most want to look at.
  testWidgets('includes a round that scored zero', (tester) async {
    await pump(tester, rounds: [_guessedLocation(0, score: 0)]);

    expect(find.byKey(const Key('round-review-row-0')), findsOneWidget);
  });

  // A perfect date guess is 0 days off, and the ICU `other` branch renders "0 days off". Pinned so a
  // later copy change has to decide deliberately rather than discover it.
  testWidgets('renders a same-day date guess without crashing', (tester) async {
    await pump(tester, rounds: [_guessedDate(0, offsetDays: 0)]);

    expect(find.text('0 days off'), findsOneWidget);
  });

  // Structural, not merely behavioural: RoundReviewList takes no `closedAt` at all — a space
  // challenge stays open while other members are still playing, but the widget has no field to even
  // ask, let alone gate on. It keys off the caller's own guesses and nothing else.
  testWidgets('lists the caller rounds on a challenge that is still open', (tester) async {
    await pump(tester, rounds: [_guessedLocation(0), _guessedDate(1)]);

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

  // getRoundImage 404s for a deleted asset AND for one that is merely no longer eligible — trashed,
  // removed from the space, moved to the locked folder. Without an errorBuilder the 404 throws into
  // the framework and paints a blank/error area. The row's image URL is built from challengeId+index
  // (`_ReviewRow` never reads `assetId`), so nothing about the fixture can actually trigger a real
  // 404 here — the builder is invoked directly instead, the same technique round_reveal_test.dart
  // uses for its equivalent case: RemoteImageProvider's load never resolves (or fails)
  // deterministically inside a widget test, so driving a genuine 404 would assert nothing reliable.
  testWidgets('a round whose photo fails to load falls back to a neutral placeholder', (tester) async {
    await pump(tester, rounds: [_guessedLocation(0)]);

    final image = tester.widget<Image>(find.byType(Image));
    expect(
      image.errorBuilder,
      isNotNull,
      reason: 'A deleted or no-longer-eligible asset 404s and would otherwise throw into the framework',
    );

    await tester.pumpWidget(
      MaterialApp(home: Builder(builder: (context) => image.errorBuilder!(context, Exception('404'), null))),
    );
    await tester.pumpAndSettle();

    expect(find.byType(RoundPhotoPlaceholder), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
