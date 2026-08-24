library;

/// Task 3 — B5 wiring test.
///
/// Verifies that tapping the "＋ Link" action in [SpaceAlbumsPage] invokes the
/// [onLink] callback (which in production is wired by [SpaceDetailPage] to push
/// [SpaceLinkAlbumRoute]). We test the callback contract here; the actual route
/// push is verified end-to-end via the running app.
import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/pages/library/spaces/space_albums.page.dart';
import 'package:immich_mobile/providers/infrastructure/space_album.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

List<Override> _overrides({required String spaceId, required List<SpaceAlbum> albums}) => [
  spaceAlbumsProvider(spaceId).overrideWith((_) => Stream.value(albums)),
];

void main() {
  const spaceId = 'space-1';

  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  testWidgets('tapping ＋ Link in SpaceAlbumsPage invokes the onLink callback', (tester) async {
    var callCount = 0;

    await tester.pumpConsumerWidget(
      SpaceAlbumsPage(spaceId: spaceId, canEdit: true, onLink: () => callCount++),
      overrides: _overrides(
        spaceId: spaceId,
        albums: [
          SpaceAlbum(
            id: 'a1',
            name: 'Hawaii',
            showInTimeline: true,
            linkedAt: DateTime.utc(2026, 1, 1),
            updatedAt: DateTime.utc(2026, 1, 1),
            createdAt: DateTime.utc(2026, 1, 1),
          ),
        ],
      ),
    );

    // Tap the ＋ Link app-bar action.
    await tester.tap(find.byKey(const Key('space-albums-link-action')));
    await tester.pump();

    expect(callCount, 1);
  });

  testWidgets('tapping ＋ Link in empty-state SpaceAlbumsPage invokes the onLink callback', (tester) async {
    var callCount = 0;

    await tester.pumpConsumerWidget(
      SpaceAlbumsPage(spaceId: spaceId, canEdit: true, onLink: () => callCount++),
      overrides: _overrides(spaceId: spaceId, albums: const []), // empty — shows empty state
    );

    // The empty state shows a "Link an album" FilledButton — tap it.
    await tester.tap(find.text('Link an album'));
    await tester.pump();

    expect(callCount, 1);
  });
}
