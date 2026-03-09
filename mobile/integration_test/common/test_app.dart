import 'package:easy_localization/easy_localization.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/main.dart' as app;
import 'package:immich_mobile/providers/db.provider.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/utils/bootstrap.dart';
import 'package:patrol/patrol.dart';

/// Server URL for integration tests. Defaults to local Docker Compose stack.
const testServerUrl = String.fromEnvironment(
  'TEST_SERVER_URL',
  defaultValue: 'http://10.0.2.127:2285',
);

/// Test user credentials.
const testEmail = String.fromEnvironment(
  'TEST_EMAIL',
  defaultValue: 'admin@immich.app',
);

const testPassword = String.fromEnvironment(
  'TEST_PASSWORD',
  defaultValue: 'admin',
);

/// Bootstrap the Immich app for Patrol integration tests.
///
/// Initializes databases, clears prior state, and pumps the app widget.
Future<void> pumpImmichApp(PatrolIntegrationTester $) async {
  await app.initApp();
  await EasyLocalization.ensureInitialized();

  final (isar, drift, logDb) = await Bootstrap.initDB();
  await Bootstrap.initDomain(isar, drift, logDb);
  await Store.clear();
  await isar.writeTxn(() => isar.clear());

  await $.pumpWidgetAndSettle(
    ProviderScope(
      overrides: [
        dbProvider.overrideWithValue(isar),
        isarProvider.overrideWithValue(isar),
        driftProvider.overrideWith(driftOverride(drift)),
      ],
      child: const app.MainWidget(),
    ),
  );
}
