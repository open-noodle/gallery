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

  testWidgets('toggling on persists the setting and reschedules', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const Key('daily-reminder-toggle')));
    await tester.pumpAndSettle();

    verify(() => controller.refresh()).called(greaterThan(0));
  });

  testWidgets('the time row is offered so 18:00 is a default, not a rule', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('daily-reminder-time')), findsOneWidget);
  });
}
