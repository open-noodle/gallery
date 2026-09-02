/// Widget tests for [SpaceTopSliver] — the combined sync-banner + Albums shelf
/// sliver mounted on SpaceDetailPage (B2 Task 4).
///
/// We pump [SpaceTopSliver] directly (not the full SpaceDetailPage, which
/// requires many API providers) so the tests stay fast and focused on the
/// shelf's presence/absence logic.
library;

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/presentation/widgets/games/daily_challenge_card.widget.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_top_sliver.widget.dart';
import 'package:immich_mobile/providers/game/game.provider.dart';
import 'package:immich_mobile/providers/game/hidden_daily_banner.provider.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

SpaceAlbum _album(String id) => SpaceAlbum(
  id: id,
  name: 'Album $id',
  showInTimeline: true,
  linkedAt: DateTime.utc(2026, 1, 1),
  updatedAt: DateTime.utc(2026, 1, 1),
  createdAt: DateTime.utc(2026, 1, 1),
);

Widget _wrap({
  required String spaceId,
  required bool canEdit,
  required List<SpaceAlbum> albums,
  bool isRemoteSyncing = false,
  bool? dailyChallengeEnabled = false,
  bool dailyBannerHidden = false,
}) {
  return ProviderScope(
    overrides: [
      spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
      syncStatusProvider.overrideWith(() => _FakeSyncStatusNotifier(syncing: isRemoteSyncing)),
      // The slot fetches the day's challenge as soon as it renders; nothing here asserts on the
      // card's contents, so a resolved null keeps it off the network without changing the branch
      // under test.
      gameDailyProvider(spaceId).overrideWith((_) async => null),
      // Driven through the real provider rather than a prop: that is the path the space page
      // actually takes, so this covers the wiring too and not just the branch.
      hiddenDailyBannerPrefsProvider.overrideWithValue(_FakeHiddenDailyBannerPrefs(dailyBannerHidden ? {spaceId} : {})),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: CustomScrollView(
          slivers: [
            SpaceTopSliver(
              spaceId: spaceId,
              canEdit: canEdit,
              onLinkTap: () {},
              onAlbumTap: (_) {},
              dailyChallengeEnabled: dailyChallengeEnabled,
              onPlayDaily: () {},
              onDailyStandings: () {},
              onDecideDaily: (_) {},
            ),
          ],
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fake SyncStatusNotifier
// ---------------------------------------------------------------------------

class _FakeHiddenDailyBannerPrefs implements HiddenDailyBannerPrefs {
  _FakeHiddenDailyBannerPrefs(this.stored);
  Set<String> stored;
  @override
  Set<String> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<String> spaceIds) async => stored = spaceIds;
}

class _FakeSyncStatusNotifier extends SyncStatusNotifier {
  _FakeSyncStatusNotifier({required this.syncing});
  final bool syncing;

  @override
  SyncStatusState build() => SyncStatusState(remoteSyncStatus: syncing ? SyncStatus.syncing : SyncStatus.idle);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  late Drift db;

  // The shelf sorts its albums by the persisted `AppConfig.spaceAlbums`, so it
  // reads `appConfigProvider` -> SettingsRepository.instance, which throws when
  // uninitialized. Production initializes it in `bootstrap.dart` long before
  // any space UI mounts; these tests need the same guarantee.
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
  });

  tearDownAll(() async {
    await db.close();
  });

  testWidgets('editor + 1 album: shelf is present inside the top sliver', (tester) async {
    await tester.pumpWidget(_wrap(spaceId: 'space-1', canEdit: true, albums: [_album('a1')]));
    await tester.pump(); // stream emit

    expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
  });

  testWidgets('viewer + 0 albums: shelf is absent from the top sliver', (tester) async {
    await tester.pumpWidget(_wrap(spaceId: 'space-1', canEdit: false, albums: []));
    await tester.pump();

    expect(find.byKey(const Key('space-albums-shelf')), findsNothing);
    // No link tile either
    expect(find.byKey(const Key('space-album-link-tile')), findsNothing);
  });

  testWidgets('editor + 0 albums: slim shelf with link tile still renders', (tester) async {
    await tester.pumpWidget(_wrap(spaceId: 'space-1', canEdit: true, albums: []));
    await tester.pump();

    expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
    expect(find.byKey(const Key('space-album-link-tile')), findsOneWidget);
  });

  test('the daily slot reserves height only when it renders something', () {
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: true), kDailyCardHeight);
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: null), 0);
    expect(DailySlot.reservedHeight(dailyChallengeEnabled: false), 0);
  });

  // The opt-in prompt is a Challenges-page surface, not a timeline one — an un-asked space shows
  // nothing above its photos even to an editor who could act on it.
  testWidgets('an un-asked space puts nothing on the space timeline, even for an editor', (tester) async {
    await tester.pumpWidget(_wrap(spaceId: 'space-1', canEdit: true, albums: [], dailyChallengeEnabled: null));
    await tester.pump();

    expect(find.byKey(const Key('daily-prompt')), findsNothing);
    expect(find.byKey(const Key('daily-card')), findsNothing);
  });

  group('hiding this space\'s daily banner', () {
    testWidgets('an enabled daily normally puts the slot on the space timeline', (tester) async {
      await tester.pumpWidget(_wrap(spaceId: 'space-1', canEdit: false, albums: [], dailyChallengeEnabled: true));
      await tester.pump();

      expect(find.byType(DailySlot), findsOneWidget);
    });

    testWidgets('hiding it takes the slot off the space timeline', (tester) async {
      await tester.pumpWidget(
        _wrap(spaceId: 'space-1', canEdit: false, albums: [], dailyChallengeEnabled: true, dailyBannerHidden: true),
      );
      await tester.pump();

      expect(find.byType(DailySlot), findsNothing);
    });

    // The scrubber consumes this height synchronously at layout time, so it has to agree with the
    // gate above in the SAME frame. If it kept reserving the banner's height, hiding would leave a
    // band of empty space at the top of the timeline and desync every snap-to-month offset below.
    test('a hidden banner reserves no height', () {
      expect(
        DailySlot.reservedHeight(dailyChallengeEnabled: true, hidden: true),
        0,
        reason: 'hidden wins over an enabled daily',
      );
      expect(
        DailySlot.reservedHeight(dailyChallengeEnabled: true, hidden: false),
        kDailyCardHeight,
        reason: 'and shows again once un-hidden',
      );
    });
  });
}
