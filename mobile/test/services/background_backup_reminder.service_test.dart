import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/background_backup_status.model.dart';
import 'package:immich_mobile/services/background_backup_reminder.service.dart';
import 'package:immich_mobile/services/background_backup_status.service.dart';
import 'package:mocktail/mocktail.dart';

class MockBackgroundBackupStatusService extends Mock implements BackgroundBackupStatusService {}

void main() {
  late MockBackgroundBackupStatusService statusService;
  late List<({int id, String title, String body})> notifications;
  late BackgroundBackupReminderService sut;

  setUpAll(() {
    registerFallbackValue(BackgroundBackupFailureReason.none);
  });

  setUp(() {
    statusService = MockBackgroundBackupStatusService();
    notifications = [];
    sut = BackgroundBackupReminderService(
      statusService: statusService,
      showNotification: ({required int id, required String title, required String body}) async {
        notifications.add((id: id, title: title, body: body));
      },
    );
    when(() => statusService.markReminderShown()).thenAnswer((_) async {});
    when(() => statusService.recordFailure(any())).thenAnswer((_) async {});
  });

  // `.t()` returns the raw key when EasyLocalization is uninitialized (see
  // _translateHelper's try/catch), so assert on keys, not translated copy.
  test('infers blocked, records osPrevented, and reminds for a stale status', () async {
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)));
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications.single.title, 'backup_background_reminder_title');
    expect(notifications.single.body, 'backup_background_reminder_body');
    verify(() => statusService.recordFailure(BackgroundBackupFailureReason.osPrevented)).called(1);
    verify(() => statusService.markReminderShown()).called(1);
  });

  test('reminds for an already-blocked status without re-inferring osPrevented', () async {
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: DateTime.now().subtract(const Duration(days: 8)),
      lastBackgroundFailureReason: BackgroundBackupFailureReason.osPrevented,
    );
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications.single.title, 'backup_background_reminder_title');
    verifyNever(() => statusService.recordFailure(any()));
    verify(() => statusService.markReminderShown()).called(1);
  });

  test('does not show reminder for healthy status', () async {
    final status = BackgroundBackupStatus(lastBackgroundWakeAt: DateTime.now());
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder();

    expect(notifications, isEmpty);
    verifyNever(() => statusService.recordFailure(any()));
    verifyNever(() => statusService.markReminderShown());
  });

  test('does not show reminder when rate limited', () async {
    final now = DateTime.now();
    final status = BackgroundBackupStatus(
      lastBackgroundWakeAt: now.subtract(const Duration(days: 8)),
      lastReminderAt: now.subtract(const Duration(hours: 2)),
    );
    when(() => statusService.read()).thenAnswer((_) async => status);

    await sut.maybeShowReminder(now: now);

    expect(notifications, isEmpty);
    verifyNever(() => statusService.markReminderShown());
  });
}
