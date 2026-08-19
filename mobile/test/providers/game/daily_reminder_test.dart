import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockScheduler extends Mock implements DailyReminderScheduler {}

// `SettingsRepository` has no `get`/`set` — reads go through `AppConfig.read` (via
// `appConfigProvider`) and writes go through `SettingsRepository.write` (via `settingsProvider`).
// So the settings side of this harness is split the same way: `appConfigProvider` is overridden
// directly with a value built from each test's settings map, and this mock only stands in for
// `.write()` calls, matching the pattern in map_bottom_sheet_timeline_test.dart.
class _MockSettingsRepository extends Mock implements SettingsRepository {}

SharedSpaceResponseDto _space(String id, {bool? dailyEnabled}) => SharedSpaceResponseDto(
  id: id,
  name: id,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdById: 'u1',
  dailyChallengeEnabled: dailyEnabled == null ? const Optional.absent() : Optional.present(dailyEnabled),
);

void main() {
  late _MockScheduler scheduler;
  late _MockSettingsRepository settings;

  setUpAll(() => registerFallbackValue(DateTime(2026)));

  setUp(() {
    scheduler = _MockScheduler();
    settings = _MockSettingsRepository();
    when(() => scheduler.cancelAll()).thenAnswer((_) async {});
    when(() => scheduler.hasPermission()).thenAnswer((_) async => true);
    when(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ).thenAnswer((_) async {});
    // Stubbed with the literal value rather than `any<String?>()`: `write` is generic
    // (`write<T, U extends T>`), and mocktail matches on the call site's inferred type arguments
    // too — `any<String?>()` infers `U = String?` while the real call passes a non-null `String`
    // (`U = String`), so the stub silently would not match and the mock would return `null`.
    when(() => settings.write(SettingsKey.gameDailyLastPlayed, '2026-08-18')).thenAnswer((_) async {});
  });

  ProviderContainer container(
    List<SharedSpaceResponseDto> spaces, {
    Map<SettingsKey, Object?> settingsValues = const {},
  }) {
    final result = ProviderContainer(
      overrides: [
        dailyReminderSchedulerProvider.overrideWithValue(scheduler),
        settingsProvider.overrideWithValue(settings),
        appConfigProvider.overrideWithValue(AppConfig.fromEntries(settingsValues)),
        sharedSpacesProvider.overrideWith((ref) async => spaces),
      ],
    );
    addTearDown(result.dispose);
    return result;
  }

  test('schedules nothing while the toggle is off, and clears anything pending', () async {
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();

    verify(() => scheduler.cancelAll()).called(1);
    verifyNever(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    );
  });

  test('schedules the horizon once a space has the daily switched on', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).refresh();

    verify(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ).called(greaterThan(0));
  });

  test('an absent dailyChallengeEnabled does not count as opted in, and does not throw', () async {
    // `Absent.value` THROWS — reading this field with `.value` would blow up here rather than
    // returning false.
    final c = container([_space('s1')], settingsValues: {SettingsKey.gameDailyReminderEnabled: true});

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    );
  });

  test('a declined space does not count as opted in', () async {
    final c = container(
      [_space('s1', dailyEnabled: false)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    );
  });

  test('one opted-in space among several is enough', () async {
    final c = container(
      [_space('s1', dailyEnabled: false), _space('s2', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).refresh();

    verify(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ).called(greaterThan(0));
  });

  test('a revoked OS permission schedules nothing even with the toggle on', () async {
    when(() => scheduler.hasPermission()).thenAnswer((_) async => false);
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    );
  });

  test('every refresh cancels before it schedules, so occurrences never accumulate', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).refresh();
    await c.read(dailyReminderProvider).refresh();

    verify(() => scheduler.cancelAll()).called(2);
  });

  test('recording a completion stores the daily UTC date and reschedules', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).recordDailyCompleted(DateTime.utc(2026, 8, 18));

    verify(() => settings.write(SettingsKey.gameDailyLastPlayed, '2026-08-18')).called(1);
    verify(() => scheduler.cancelAll()).called(1);
  });

  test('a spaces-list failure leaves pending notifications alone rather than cancelling them', () async {
    final c = ProviderContainer(
      overrides: [
        dailyReminderSchedulerProvider.overrideWithValue(scheduler),
        settingsProvider.overrideWithValue(settings),
        appConfigProvider.overrideWithValue(AppConfig.fromEntries({SettingsKey.gameDailyReminderEnabled: true})),
        sharedSpacesProvider.overrideWith((ref) async => throw Exception('offline')),
      ],
    );
    addTearDown(c.dispose);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(() => scheduler.cancelAll());
  });
}
