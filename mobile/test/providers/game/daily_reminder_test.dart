import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/config/app_config.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../test_helpers/wire_dates.dart';

class _MockScheduler extends Mock implements DailyReminderScheduler {}

// `SettingsRepository` has no `get`/`set` — reads go through `AppConfig.read` (via
// `appConfigProvider`) and writes go through `SettingsRepository.write` (via `settingsProvider`).
// So the settings side of this harness is split the same way: `appConfigProvider` is overridden
// directly with a value built from each test's settings map, and this mock only stands in for
// `.write()` calls, matching the pattern in map_bottom_sheet_timeline_test.dart.
class _MockSettingsRepository extends Mock implements SettingsRepository {}

/// The UTC day key of [instant], computed independently of `dailyKeyFor` — so a test comparing
/// against this cannot pass merely because it makes the same mistake `dailyKeyFor` would. Mirrors
/// daily_reminder_schedule_test.dart's `_utcKeyOf`.
String _utcKeyOf(DateTime instant) {
  final utc = instant.toUtc();
  return '${utc.year}-${utc.month.toString().padLeft(2, '0')}-${utc.day.toString().padLeft(2, '0')}';
}

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
    when(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-18')).thenAnswer((_) async {});
    when(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, '2026-08-18')).thenAnswer((_) async {});
    when(() => settings.write(SettingsKey.gameSoloDailyUnavailableOn, '2026-08-18')).thenAnswer((_) async {});
    // The neighbouring days are stubbed too, and must never be written. Without them a
    // day-shifted key fails as an unstubbed-call TypeError inside the controller rather than on
    // the verify below, which reads as a broken harness instead of as the wrong day recorded.
    for (final day in ['2026-08-17', '2026-08-19']) {
      when(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, day)).thenAnswer((_) async {});
      when(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, day)).thenAnswer((_) async {});
      when(() => settings.write(SettingsKey.gameSoloDailyUnavailableOn, day)).thenAnswer((_) async {});
    }
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

  // These two used to assert `verifyNever(scheduleAt)`: with a single shared gate, no opted-in
  // space meant nothing scheduled at all, full stop. Now that the solo daily un-gates the reminder
  // (`hasOptedInSpace || soloDailyEnabled`, soloDailyEnabled unconditionally true), scheduleAt DOES
  // fire regardless — so a bare called/not-called split can no longer tell "counted as opted in"
  // apart from "did not". Both are rebuilt around the per-source SKIP instead: the solo daily is
  // recorded played today and the space is left unplayed, so a CORRECTLY false hasOptedInSpace
  // vacuously counts the space as played too (both sources played → today's occurrence skipped,
  // 6 left), while a wrongly-true hasOptedInSpace would read the space as genuinely unplayed
  // (neither source played → today kept, 7 left) — the count is what distinguishes them.
  test('an absent dailyChallengeEnabled does not count as opted in, and does not throw', () async {
    // `Absent.value` THROWS — reading this field with `.value` would blow up when `refresh()` is
    // awaited below, rather than returning false.
    final todayKey = _utcKeyOf(DateTime(2026, 8, 18, 18));
    final c = container(
      [_space('s1')],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true, SettingsKey.gameSoloDailyLastPlayed: todayKey},
    );

    await c.read(dailyReminderProvider).refresh(now: DateTime(2026, 8, 18, 9));

    verify(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ).called(kDailyReminderHorizonDays - 1);
  });

  test('a declined space does not count as opted in', () async {
    final todayKey = _utcKeyOf(DateTime(2026, 8, 18, 18));
    final c = container(
      [_space('s1', dailyEnabled: false)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true, SettingsKey.gameSoloDailyLastPlayed: todayKey},
    );

    await c.read(dailyReminderProvider).refresh(now: DateTime(2026, 8, 18, 9));

    verify(
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ).called(kDailyReminderHorizonDays - 1);
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

    // Deliberately not `verify(cancelAll).called(2)`: a bare count does not pin ORDER — a
    // regression that moved cancelAll() to the end of the scheduling loop would still call it
    // twice, wiping out every notification it had just scheduled, and a count-only assertion
    // would still pass. verifyInOrder instead pins cancelAll before the first scheduleAt of each
    // of the two refresh cycles below. (mocktail's verify()/verifyInOrder() consume the calls
    // they match, so combining this with a separate called(2) on the same mock would double
    // count and fail — this replaces that check rather than supplementing it.)
    verifyInOrder([
      () => scheduler.cancelAll(),
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
      () => scheduler.cancelAll(),
      () => scheduler.scheduleAt(
        any(),
        any(),
        title: any(named: 'title'),
        body: any(named: 'body'),
        payload: any(named: 'payload'),
      ),
    ]);
  });

  test('hasPermission is not asked unless the local gates already pass', () async {
    // Toggle left off (default). hasPermission() can raise the iOS system permission dialog, so a
    // user who never enabled the toggle must never see it just from opening the app. The space
    // half of the old comment here no longer holds: soloDailyEnabled is unconditionally true, so
    // an opted-in space is not what is gating this — only `enabled` still is, which is why the
    // toggle being left off (not the space) is what this test actually pins.
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(() => scheduler.hasPermission());
  });

  test('recording a completed space daily stores the SPACE key and reschedules', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).recordDailyCompleted(wireDateOnly('2026-08-18'), isSolo: false);

    verify(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-18')).called(1);
    // `dailyOn` is a date-only value that arrives as LOCAL midnight, so converting it to a UTC
    // key names the previous day east of Greenwich and the next one west of it.
    verifyNever(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-17'));
    verifyNever(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-19'));
    verify(() => scheduler.cancelAll()).called(1);
  });

  // The solo counterpart of the test above — recording under the WRONG key would silently
  // suppress the reminder for the other, unplayed daily, which is the exact bug this task fixes.
  test('recording a completed solo daily stores the SOLO key, not the space one', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).recordDailyCompleted(wireDateOnly('2026-08-18'), isSolo: true);

    verify(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, '2026-08-18')).called(1);
    verifyNever(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-18'));
    verifyNever(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, '2026-08-17'));
    verifyNever(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, '2026-08-19'));
    verify(() => scheduler.cancelAll()).called(1);
  });

  // The Critical fix: soloDailyEnabled being unconditionally true asserted a guarantee the
  // product does not make — the player's library can genuinely be too small to fill a solo daily
  // — which made a day whose solo daily was unavailable permanently unskippable. This is the write
  // side of that fix: the PhotoGuesser page's own read of the solo daily (which already happens,
  // and which this deliberately does NOT duplicate) is what discovers "unavailable" and reports it
  // here.
  test('recording the solo daily unavailable stores the day and reschedules', () async {
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).recordSoloDailyUnavailable(now: DateTime.utc(2026, 8, 18));

    verify(() => settings.write(SettingsKey.gameSoloDailyUnavailableOn, '2026-08-18')).called(1);
    verify(() => scheduler.cancelAll()).called(1);
  });

  test('recording the solo daily unavailable does not touch either last-played key', () async {
    // "Unavailable" and "played" are different facts recorded under different keys — conflating
    // them would make a genuinely unplayed daily read as finished, or vice versa.
    final c = container(
      [_space('s1', dailyEnabled: true)],
      settingsValues: {SettingsKey.gameDailyReminderEnabled: true},
    );

    await c.read(dailyReminderProvider).recordSoloDailyUnavailable(now: DateTime.utc(2026, 8, 18));

    verifyNever(() => settings.write(SettingsKey.gameSoloDailyLastPlayed, '2026-08-18'));
    verifyNever(() => settings.write(SettingsKey.gameSpaceDailyLastPlayed, '2026-08-18'));
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
