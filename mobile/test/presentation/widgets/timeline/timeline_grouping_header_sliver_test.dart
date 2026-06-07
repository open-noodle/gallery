import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_header_sliver.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_selector.widget.dart';
import 'package:immich_mobile/providers/timeline/multiselect.provider.dart';
// easy_localization initializes shared_preferences internally; tests need the mock initializer.
// ignore: depend_on_referenced_packages
import 'package:shared_preferences/shared_preferences.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    SharedPreferences.setMockInitialValues({});
    await EasyLocalization.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await SettingsRepository.ensureInitialized(db);
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  Widget scroll() {
    return const CustomScrollView(
      slivers: [
        TimelineGroupingHeaderSliver(),
        SliverToBoxAdapter(child: SizedBox(height: 600)),
      ],
    );
  }

  group('TimelineGroupingHeaderSliver', () {
    testWidgets('renders TimelineGroupingSelector in a top-of-content sliver', (tester) async {
      await tester.pumpConsumerWidget(scroll());
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsOneWidget);
      expect(find.byType(TimelineGroupingSelector), findsOneWidget);
      expect(kTimelineGroupingHeaderSliverHeight, 56);
    });

    testWidgets('hides selector while multi-select is forced enabled', (tester) async {
      await tester.pumpConsumerWidget(
        scroll(),
        overrides: [
          multiSelectProvider.overrideWith(
            () => MultiSelectNotifier(
              const MultiSelectState(selectedAssets: {}, lockedSelectionAssets: {}, forceEnable: true),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsNothing);
      expect(find.byType(TimelineGroupingSelector), findsNothing);
    });

    testWidgets('hides selector while multi-select has selected assets', (tester) async {
      final selectedAsset = TestUtils.createRemoteAsset(id: 'selected-asset');

      await tester.pumpConsumerWidget(
        scroll(),
        overrides: [
          multiSelectProvider.overrideWith(
            () => MultiSelectNotifier(
              MultiSelectState(selectedAssets: {selectedAsset}, lockedSelectionAssets: const {}, forceEnable: false),
            ),
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.byKey(const Key('timeline-grouping-header-sliver')), findsNothing);
      expect(find.byType(TimelineGroupingSelector), findsNothing);
    });
  });
}
