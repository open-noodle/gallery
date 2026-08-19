import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/date_round.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_progress_hud.widget.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  // getGameRoundImageUrl reads Store.get(StoreKey.serverEndpoint), which throws unless the Store
  // is initialized. Mirrors the setup in people_grid_test.dart / location_round_test.dart. Unlike
  // the location round, DateRound has no map, so no SettingsRepository/MapThemeOverride wiring
  // is needed here.
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

  Future<DateTime?> pumpAndGuess(WidgetTester tester, {void Function(DateRoundState state)? adjust}) async {
    DateTime? emitted;
    await tester.pumpConsumerWidget(
      DateRound(
        challengeId: 'challenge-1',
        index: 0,
        minYear: 1970,
        maxYear: 2026,
        roundNumber: 1,
        roundCount: 5,
        onGuess: (value) => emitted = value,
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
    await tester.pumpConsumerWidget(
      DateRound(
        challengeId: 'challenge-1',
        index: 0,
        minYear: 1970,
        maxYear: 2026,
        roundNumber: 1,
        roundCount: 5,
        onGuess: (_) {},
      ),
    );

    final state = tester.state<DateRoundState>(find.byType(DateRound));
    expect(state.years.first, 1970);
    expect(state.years.last, 2026);
    expect(state.years.length, 57);
  });

  // `roundNumber`/`roundCount` were required parameters this widget never used: LocationRound drew
  // a progress HUD and DateRound drew nothing, so in a mixed challenge the indicator vanished on
  // every date round.
  testWidgets('the round HUD is drawn, with the round-progress placeholders resolved', (tester) async {
    await tester.pumpConsumerWidget(
      DateRound(
        challengeId: 'challenge-1',
        index: 0,
        minYear: 1970,
        maxYear: 2026,
        roundNumber: 2,
        roundCount: 5,
        onGuess: (_) {},
      ),
    );

    expect(find.byType(RoundProgressHud), findsOneWidget);
    // A wrong args key in 'game_round_progress'.t(args: {...}) renders the raw key instead of this
    // text — .t() swallows the MessageFormat failure silently.
    expect(find.text('Round 2 of 5'), findsOneWidget);
  });

  testWidgets('the Guess button resolves the month/year placeholders instead of showing the raw key', (tester) async {
    await tester.pumpConsumerWidget(
      DateRound(
        challengeId: 'challenge-1',
        index: 0,
        minYear: 1970,
        maxYear: 2026,
        roundNumber: 1,
        roundCount: 5,
        onGuess: (_) {},
      ),
    );

    // A wrong args key in 'game_guess_month_year'.t(args: {...}) renders the raw key instead of
    // this text — .t() swallows the MessageFormat failure silently.
    tester.state<DateRoundState>(find.byType(DateRound)).debugSelect(year: 2019, month: 7);
    await tester.pump();

    expect(find.text('Guess July 2019'), findsOneWidget);
  });
}
