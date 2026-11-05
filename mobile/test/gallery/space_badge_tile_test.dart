import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/gallery/space_badge.provider.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/images/thumbnail_tile.widget.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    // The tile builds a thumbnail URL from it; nothing is fetched in a widget test.
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:2283/api');
  });

  tearDownAll(() async => db.close());

  final asset = RemoteAsset(
    id: 'asset',
    name: 'asset.jpg',
    ownerId: 'other',
    checksum: 'c-asset',
    type: AssetType.image,
    createdAt: DateTime(2025),
    updatedAt: DateTime(2025),
    isEdited: false,
  );
  final badge = find.byKey(const Key('space-badge'));
  double opacity(WidgetTester tester) =>
      tester.widget<AnimatedOpacity>(find.ancestor(of: badge, matching: find.byType(AnimatedOpacity)).first).opacity;

  testWidgets('a thumbnail fades its space badge out while it is selected', (tester) async {
    final container = ProviderContainer(
      overrides: [
        assetSpacesProvider.overrideWith((ref, _) => Stream.value((count: 2, color: null))),
        appConfigProvider.overrideWithValue(const AppConfig()),
        timelineServiceProvider.overrideWithValue(
          TimelineService((
            assetSource: (_, _) async => const [],
            bucketSource: () => Stream.value(const []),
            origin: TimelineOrigin.main,
          )),
        ),
      ],
    );
    addTearDown(container.dispose);
    await tester.pumpWidget(
      UncontrolledProviderScope(
        container: container,
        child: MaterialApp(
          home: Center(child: SizedBox.square(dimension: 120, child: ThumbnailTile(asset))),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(opacity(tester), 1);

    container.read(multiSelectProvider.notifier).toggleAssetSelection(asset);
    await tester.pumpAndSettle();
    expect(opacity(tester), 0);

    container.read(multiSelectProvider.notifier).toggleAssetSelection(asset);
    await tester.pumpAndSettle();
    expect(opacity(tester), 1);
  });
}
