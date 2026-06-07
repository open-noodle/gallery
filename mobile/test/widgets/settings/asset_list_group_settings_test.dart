import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/widgets/settings/asset_list_settings/asset_list_group_settings.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
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

  testWidgets('renders grouping choices without none', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    expect(find.text('year'), findsOneWidget);
    expect(find.text('month'), findsOneWidget);
    expect(find.text('asset_list_layout_settings_group_by_month_day'), findsOneWidget);
    expect(find.text('asset_list_layout_settings_group_automatically'), findsNothing);
    expect(find.text('none'), findsNothing);
  });

  testWidgets('selecting year persists selected grouping', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text('year'));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.year);
  });

  testWidgets('selecting month from year persists selected grouping', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);

    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text('month'));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
  });
}
