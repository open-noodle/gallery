import 'dart:convert';

import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep_content.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/time_buckets.provider.dart';

import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });
  setUp(() async => Store.put(StoreKey.filterSheetHiddenSections, '[]'));

  Future<void> pumpDeep(WidgetTester tester, ScrollController controller) async {
    await tester.binding.setSurfaceSize(const Size(400, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpConsumerWidget(
      DeepContent(scrollController: controller),
      overrides: [
        photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.deep),
        timeBucketsProvider.overrideWith((ref, filter) => Future.value(const [])),
      ],
    );
    await tester.pumpAndSettle();
  }

  testWidgets('hidden sections are not rendered; visible ones are', (tester) async {
    await Store.put(StoreKey.filterSheetHiddenSections, jsonEncode(['tags']));
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await pumpDeep(tester, controller);

    expect(find.byKey(const Key('deep-section-tags')), findsNothing);
    expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
    expect(find.byKey(const Key('deep-section-media')), findsOneWidget);
  });

  testWidgets('default: all sections visible', (tester) async {
    await Store.put(StoreKey.filterSheetHiddenSections, '[]');
    final controller = ScrollController();
    addTearDown(controller.dispose);
    await pumpDeep(tester, controller);

    expect(find.byKey(const Key('deep-section-people')), findsOneWidget);
    expect(find.byKey(const Key('deep-section-toggles')), findsOneWidget);
  });
}
