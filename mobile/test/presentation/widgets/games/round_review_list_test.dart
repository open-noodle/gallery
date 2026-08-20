import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/round_review_list.widget.dart';
import 'package:openapi/api.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

/// A guessed location round. Defaults land on a 412 km miss so the default call reads the same
/// number the "shows the distance" test asserts against.
GameRoundDetailResponseDto _guessedLocation(int index, {num score = 4182, double distanceKm = 412.3, String? assetId = 'asset-1'}) =>
    GameRoundDetailResponseDto(
      index: index,
      type: GameRoundType.location,
      assetId: Optional.present(assetId),
      score: Optional.present(score),
      answer: Optional.present(GameRoundDetailResponseDtoAnswer(date: null, lat: 41.15, lon: -8.61)),
      guess: Optional.present(
        GameRoundDetailResponseDtoGuess(lat: 38.72, lon: -9.14, date: null, distanceKm: distanceKm, offsetDays: null),
      ),
    );

/// A guessed date round. Defaults land on a 3-day miss.
GameRoundDetailResponseDto _guessedDate(int index, {num score = 3640, int offsetDays = 3}) => GameRoundDetailResponseDto(
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
    // Accepted only for readability at call sites that want to make the point explicit — a space
    // challenge stays open while other members are still playing, but this list keys off the
    // caller's own guesses and never reads closedAt.
    DateTime? closedAt,
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
}
