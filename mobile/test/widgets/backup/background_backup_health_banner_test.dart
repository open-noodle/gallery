import 'dart:convert';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/widgets/backup/background_backup_health_banner.dart';

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  setUp(() async {
    await Store.clear();
  });

  tearDown(() async {
    await Store.clear();
  });

  testWidgets('hides the banner for healthy status', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(lastBackgroundWakeAt: DateTime.now().subtract(const Duration(hours: 1))).toJson(),
      ),
    );

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner())),
      ),
    );
    await tester.pump();

    expect(find.byType(BackgroundBackupHealthBanner), findsOneWidget);
    expect(find.textContaining('backup_background_'), findsNothing);
  });

  testWidgets('shows stale status', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(
          lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
          lastUploadSuccessAt: DateTime.now().subtract(const Duration(days: 9)),
          lastCandidateCount: 4,
        ).toJson(),
      ),
    );

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner())),
      ),
    );
    await tester.pump();

    expect(find.text('backup_background_stale_title'), findsOneWidget);
    expect(find.text('backup_background_stale_body'), findsOneWidget);
  });

  testWidgets('shows blocked status when the OS prevented background execution', (tester) async {
    await Store.put(
      StoreKey.backgroundBackupStatus,
      jsonEncode(
        BackgroundBackupStatus(
          lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
          lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
        ).toJson(),
      ),
    );

    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: Scaffold(body: BackgroundBackupHealthBanner())),
      ),
    );
    await tester.pump();

    expect(find.text('backup_background_blocked_title'), findsOneWidget);
    expect(find.text('backup_background_blocked_body'), findsOneWidget);
  });
}
