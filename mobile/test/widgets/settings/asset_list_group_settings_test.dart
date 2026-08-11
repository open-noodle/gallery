import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:easy_localization/easy_localization.dart' hide TextDirection;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/translations.g.dart';
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

  testWidgets('offers only the month + day and month choices', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    expect(find.text(StaticTranslations.instance.asset_list_layout_settings_group_by_month_day), findsOneWidget);
    expect(find.text(StaticTranslations.instance.month), findsOneWidget);
    expect(find.text(StaticTranslations.instance.year), findsNothing);
    expect(find.text('asset_list_layout_settings_group_automatically'.tr()), findsNothing);
    expect(find.text(StaticTranslations.instance.none), findsNothing);
  });

  testWidgets('selecting month persists selected grouping', (tester) async {
    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.month));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.month);
  });

  testWidgets('selecting month + day from month persists selected grouping', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.month);

    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    await tester.tap(find.text(StaticTranslations.instance.asset_list_layout_settings_group_by_month_day));
    await tester.pumpAndSettle();

    expect(SettingsRepository.instance.appConfig.timeline.groupAssetsBy, GroupAssetsBy.day);
  });

  testWidgets('a persisted year grouping shows month + day as the selected choice', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.timelineGroupAssetsBy, GroupAssetsBy.year);

    await tester.pumpConsumerWidget(const GroupSettings());
    await tester.pumpAndSettle();

    final radioGroup = tester.widget<RadioGroup<GroupAssetsBy>>(find.byType(RadioGroup<GroupAssetsBy>));
    expect(radioGroup.groupValue, GroupAssetsBy.day);
  });

  // L-3 ("a stored year value falls back to Month + day selected") is not added here: the test
  // above already covers it end to end. `SettingsRadioListTile.groupBy` is the very same value
  // `RadioGroup.groupValue` reads one line later inside the widget's own build() — any bug that
  // breaks one breaks the other identically, so asserting via the inner widget too is a duplicate,
  // not a distinct scenario. Do not re-add it.
}
