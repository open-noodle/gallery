import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/widgets/settings/notification_setting.dart';
import 'package:mocktail/mocktail.dart';

import '../../test_utils.dart';

class _MockController extends Mock implements DailyReminderController {}

void main() {
  late Drift db;
  late _MockController controller;

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

    controller = _MockController();
    when(() => controller.refresh()).thenAnswer((_) async {});
  });

  tearDownAll(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await db.close();
  });

  Future<void> pump(WidgetTester tester) => tester.pumpWidget(
    ProviderScope(
      overrides: [
        dailyReminderProvider.overrideWithValue(controller),
        // Deliberately made to throw: the settings page must not depend on the network.
        sharedSpacesProvider.overrideWith((ref) async => throw Exception('offline')),
      ],
      child: const MaterialApp(home: Scaffold(body: NotificationSetting())),
    ),
  );

  testWidgets('renders the reminder row without touching the network', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('daily-reminder-toggle')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('toggling on repaints the switch, persists the setting and reschedules', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
      isFalse,
      reason: 'The reminder is off by default; this is the starting point the tap has to move away from',
    );

    await tester.tap(find.byKey(const Key('daily-reminder-toggle')));
    await tester.pumpAndSettle();

    // The assertion this test used to be missing. Verifying only `refresh()` passes against a
    // widget that never rebuilds: the setting is written and the schedule is refreshed while the
    // switch stays visually off, so a second tap silently persists `false` on a switch that still
    // looks off. Reading the RENDERED value is the only thing that catches it.
    expect(
      tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value,
      isTrue,
      reason: 'The switch must show the state it just persisted, not the state it was born with',
    );
    expect(
      SettingsRepository.instance.appConfig.read(SettingsKey.gameDailyReminderEnabled),
      isTrue,
      reason: 'The tap must reach the store, not just the pixels',
    );
    verify(() => controller.refresh()).called(greaterThan(0));
  });

  testWidgets('toggling back off repaints the switch too', (tester) async {
    await SettingsRepository.instance.write(SettingsKey.gameDailyReminderEnabled, true);

    await pump(tester);
    await tester.pumpAndSettle();

    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value, isTrue);

    await tester.tap(find.byKey(const Key('daily-reminder-toggle')));
    await tester.pumpAndSettle();

    expect(tester.widget<SwitchListTile>(find.byType(SwitchListTile)).value, isFalse);
    expect(SettingsRepository.instance.appConfig.read(SettingsKey.gameDailyReminderEnabled), isFalse);
  });

  testWidgets('the time row is offered so 18:00 is a default, not a rule', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('daily-reminder-time')), findsOneWidget);
    expect(find.text('18:00'), findsOneWidget);
  });

  testWidgets('the time row repaints when the stored minute changes', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    expect(find.text('18:00'), findsOneWidget);

    // A change made to the store while the row is on screen. Seeding the row from `ref.read`
    // leaves 18:00 painted forever; only a widget that actually watches the config repaints.
    await SettingsRepository.instance.write(SettingsKey.gameDailyReminderMinuteOfDay, 9 * 60);
    await tester.pumpAndSettle();

    expect(find.text('09:00'), findsOneWidget);
    expect(find.text('18:00'), findsNothing);
  });
}
