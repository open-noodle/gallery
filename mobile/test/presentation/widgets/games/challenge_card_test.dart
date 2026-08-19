import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/games/round_photo_placeholder.widget.dart';
import 'package:openapi/api.dart';

import '../../../widget_tester_extensions.dart';

GameChallengeListItemResponseDto _challenge({num answered = 0, DateTime? dailyOn}) => GameChallengeListItemResponseDto(
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
  closedAt: null,
  dailyOn: dailyOn,
);

void main() {
  // ChallengeCard builds a RemoteImageProvider URL via getGameRoundImageUrl, which reads
  // Store.get(StoreKey.serverEndpoint) — that throws unless the Store is initialized. Mirrors the
  // harness round_reveal_test.dart already solved for the same reason.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
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
    required GameChallengeListItemResponseDto challenge,
    bool canDelete = true,
    VoidCallback? onDelete,
  }) => tester.pumpConsumerWidget(
    ChallengeCard(challenge: challenge, canDelete: canDelete, onTap: () {}, onDelete: onDelete ?? () {}),
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
    // Proves the dialog's i18n keys ('game_delete_challenge', 'delete') actually resolved to their
    // translated text rather than `.t()` silently falling back to the raw key name.
    expect(find.text('Delete challenge'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);

    await tester.tap(find.byKey(const Key('challenge-card-delete-confirm')));
    await tester.pumpAndSettle();
    expect(deleted, 1);
  });

  // The spec requires that a round whose asset was deleted server-side "renders without the photo
  // rather than erroring". Without an errorBuilder the 404 throws into the framework and paints a
  // blank/error area. The builder is invoked directly: RemoteImageProvider's load never resolves
  // (or fails) deterministically inside a widget test, so driving a real 404 here would assert
  // nothing reliable - invoking the callback proves both that it exists and what it paints.
  testWidgets('the card backdrop falls back to a neutral placeholder when the photo cannot be loaded', (tester) async {
    await pump(tester, challenge: _challenge());

    final image = tester.widget<Image>(find.byType(Image));
    expect(image.errorBuilder, isNotNull, reason: 'A deleted asset 404s and would otherwise throw into the framework');

    await tester.pumpWidget(
      MaterialApp(home: Builder(builder: (context) => image.errorBuilder!(context, Exception('404'), null))),
    );
    await tester.pumpAndSettle();

    expect(find.byType(RoundPhotoPlaceholder), findsOneWidget);
    expect(find.byIcon(Icons.image_not_supported_outlined), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a daily is never deletable, whatever the role says', (tester) async {
    await pump(tester, challenge: _challenge(dailyOn: DateTime.utc(2026, 8, 18)), canDelete: true);

    expect(find.byKey(const Key('challenge-card-delete-c1')), findsNothing);
  });
}
