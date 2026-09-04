import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/widgets/settings/preference_settings/nav_setting.dart';
import 'package:immich_mobile/widgets/settings/preference_settings/preference_setting.dart';

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

  Future<void> pumpNavSetting(WidgetTester tester) => tester.pumpConsumerWidget(const NavSetting());

  AppConfig readConfig() => SettingsRepository.instance.appConfig;

  testWidgets('reflects the stored value and round-trips through the effective config', (tester) async {
    // Fresh install: no row, so the default applies.
    await pumpNavSetting(tester);

    final tile = tester.widget<SwitchListTile>(find.byType(SwitchListTile));
    expect(tile.value, true, reason: 'Spaces is the default');

    await tester.tap(find.byKey(const Key('nav-show-spaces-switch')));
    await tester.pumpAndSettle();
    expect(readConfig().read(SettingsKey.navShowSpaces), false);

    await tester.tap(find.byKey(const Key('nav-show-spaces-switch')));
    await tester.pumpAndSettle();
    // Asserts the EFFECTIVE value, not a stored row: SettingsRepository.write
    // clears the row when the value equals the default, so "true" is persisted
    // as the absence of a row.
    expect(readConfig().read(SettingsKey.navShowSpaces), true);
  });

  // Everything above pumps [NavSetting] directly, so none of it would notice
  // the tile being dropped from the Preferences page — which is the only place
  // a user can reach it, and the only way back to Albums in the nav.
  testWidgets('the Preferences settings page lists the nav setting', (tester) async {
    await tester.pumpConsumerWidget(const PreferenceSetting());

    expect(find.byType(NavSetting), findsOneWidget);
    expect(find.byKey(const Key('nav-show-spaces-switch')), findsOneWidget);
  });
}
