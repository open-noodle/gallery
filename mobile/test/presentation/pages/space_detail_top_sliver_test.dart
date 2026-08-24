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
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/presentation/widgets/spaces/space_top_sliver.widget.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';
import 'package:immich_mobile/providers/sync_status.provider.dart';
import '../../widget_tester_extensions.dart';

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
}) {
  return ProviderScope(
    overrides: [
      spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
      syncStatusProvider.overrideWith(() => _FakeSyncStatusNotifier(syncing: isRemoteSyncing)),
    ],
    child: MaterialApp(
      home: Scaffold(
        body: CustomScrollView(
          slivers: [SpaceTopSliver(spaceId: spaceId, canEdit: canEdit, onLinkTap: () {}, onAlbumTap: (_) {})],
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Fake SyncStatusNotifier
// ---------------------------------------------------------------------------

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
    await tester.pumpWidget(localizedForTest(_wrap(spaceId: 'space-1', canEdit: true, albums: [_album('a1')])));
    await tester.pump(); // stream emit

    expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
  });

  testWidgets('viewer + 0 albums: shelf is absent from the top sliver', (tester) async {
    await tester.pumpWidget(localizedForTest(_wrap(spaceId: 'space-1', canEdit: false, albums: [])));
    await tester.pump();

    expect(find.byKey(const Key('space-albums-shelf')), findsNothing);
    // No link tile either
    expect(find.byKey(const Key('space-album-link-tile')), findsNothing);
  });

  testWidgets('editor + 0 albums: slim shelf with link tile still renders', (tester) async {
    await tester.pumpWidget(localizedForTest(_wrap(spaceId: 'space-1', canEdit: true, albums: [])));
    await tester.pump();

    expect(find.byKey(const Key('space-albums-shelf')), findsOneWidget);
    expect(find.byKey(const Key('space-album-link-tile')), findsOneWidget);
  });
}
