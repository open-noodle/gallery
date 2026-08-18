# Mobile Daily Challenge Reminder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remind a player, once a day at a time they choose, that a daily challenge is waiting — but only while they belong to a space that has the daily switched on, and never on a day they have already played.

**Architecture:** A local scheduled notification, not a push. The decision of _when_ to fire is a pure function with entirely local inputs, so it is unit-testable without the plugin. A thin provider turns that function's output into scheduled notifications and re-runs it on three triggers. The opt-out is a local setting on the existing notification settings page.

**Tech Stack:** `flutter_local_notifications ^17.2.4` (already initialised in `main.dart`), the `timezone` package (already initialised by `initializeTimeZones()` in `main.dart`), `hooks_riverpod ^2.6.1`, `mocktail ^1.0.5`.

**Spec:** `docs/superpowers/specs/2026-08-18-mobile-photo-guessing-game-design.md` (§ "The daily reminder")

**Depends on:** `docs/superpowers/plans/2026-08-18-mobile-photo-guessing-game.md`, specifically Task 5's `GameSessionController.onDailyCompleted` hook. Do not start this plan until that one is merged.

## Global Constraints

- **No push infrastructure.** There is no FCM, no APNs and no device-token table in this repo, and this plan adds none. Everything is a local notification.
- **No server changes.** The gate reads `dailyChallengeEnabled` off the existing `sharedSpacesProvider` response — `SharedSpaceRepository.getAllByUserId` uses `selectAll('shared_space')`, so the column is already there.
- **Never call `getDailyChallenge` to decide whether to notify.** That endpoint **generates** the daily as a side effect of the read. Polling it per space on every foreground would generate a daily for every opted-in space every day, in the background, running the CLIP scene queries for spaces nobody opened — precisely the eager-generation cost the daily's design chose lazy reads to avoid.
- **The scheduling policy performs no I/O.** All inputs are local values passed in; the function is pure and total.
- **Copy names no date, no count and no space.** The local record can be stale, and a notification that confidently names something it got wrong is worse than a generic one. It also avoids plural forms in ten locales.
- **`AndroidScheduleMode.inexactAllowWhileIdle`.** Exact alarms would require `SCHEDULE_EXACT_ALARM` on Android 12+, a manifest permission carrying Play Store policy, for no gain on a daily reminder.
- **Five new i18n keys, in all ten maintained locales** (`de fr it nl pl es ru zh_Hans zh_Hant` + `en`), inserted alphabetically, then `npx prettier --write i18n/*.json`.
- Both CI gates are hard: `dart analyze --fatal-infos` and `dart format` over `lib`.

### Running tests locally

Flutter **3.44.8**, pinned in `mobile/mise.toml`. Do not use `mise run`.

```bash
export PATH="$HOME/.local/share/mise/installs/aqua-flutter-flutter/3.44.8/flutter/bin:$PATH"
cd mobile
flutter pub get
dart run easy_localization:generate -S ../i18n && dart run bin/generate_keys.dart
flutter test test/path/to/file_test.dart
```

---

## File Structure

| File                                                     | Responsibility                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `mobile/lib/utils/daily_reminder_schedule.dart`          | The pure policy: which local instants to schedule. No I/O, no plugin, no Flutter. |
| `mobile/lib/providers/game/daily_reminder.provider.dart` | Turns the policy's output into scheduled notifications; owns the three triggers.  |
| `mobile/lib/domain/models/settings_key.dart`             | Three new keys.                                                                   |
| `mobile/lib/widgets/settings/notification_setting.dart`  | The opt-out toggle and time picker.                                               |
| `mobile/lib/main.dart`                                   | The notification-tap handler.                                                     |

---

## Task 1: The i18n keys

**Files:**

- Modify: `i18n/en.json`, `i18n/de.json`, `i18n/fr.json`, `i18n/it.json`, `i18n/nl.json`, `i18n/pl.json`, `i18n/es.json`, `i18n/ru.json`, `i18n/zh_Hans.json`, `i18n/zh_Hant.json`

**Interfaces:**

- Produces: `game_daily_reminder_title`, `game_daily_reminder_subtitle`, `game_daily_reminder_time`, `game_daily_reminder_notification_title`, `game_daily_reminder_notification_body`.

- [ ] **Step 1: Add the English keys**

Insert alphabetically into `i18n/en.json` (they sort between `game_daily_played` and
`game_daily_toggle_failed`):

```json
  "game_daily_reminder_notification_body": "Today's daily challenge is waiting",
  "game_daily_reminder_notification_title": "Daily challenge",
  "game_daily_reminder_subtitle": "A daily nudge for spaces that have the daily challenge switched on",
  "game_daily_reminder_time": "Remind me at",
  "game_daily_reminder_title": "Daily challenge reminder",
```

- [ ] **Step 2: Translate into the other nine locales**

Match each file's existing register and terminology. German, Italian and Spanish address the user
informally (`du` / `tu` / `tú`); French and Russian use the formal `vous` / `вы`. Reuse the noun each
file already uses for the daily challenge — look up that file's `game_daily_challenge` value rather
than inventing a synonym.

| Locale    | `..._notification_body`             | `..._title`                         |
| --------- | ----------------------------------- | ----------------------------------- |
| `de`      | Die heutige Tageschallenge wartet   | Erinnerung an die Tageschallenge    |
| `fr`      | Le défi du jour vous attend         | Rappel du défi du jour              |
| `it`      | La sfida di oggi ti aspetta         | Promemoria della sfida quotidiana   |
| `nl`      | De dagelijkse uitdaging wacht op je | Herinnering dagelijkse uitdaging    |
| `pl`      | Dzisiejsze wyzwanie czeka           | Przypomnienie o codziennym wyzwaniu |
| `es`      | El reto diario te está esperando    | Recordatorio del reto diario        |
| `ru`      | Ежедневное задание ждёт вас         | Напоминание о ежедневном задании    |
| `zh_Hans` | 今天的每日挑战正在等你              | 每日挑战提醒                        |
| `zh_Hant` | 今天的每日挑戰正在等你              | 每日挑戰提醒                        |

Translate `_subtitle` and `_time` in the same register, and mind gender agreement where the file's
own noun for the challenge is gendered.

- [ ] **Step 3: Format and verify every locale has all five**

```bash
npx prettier --write i18n/*.json
for f in en de fr it nl pl es ru zh_Hans zh_Hant; do
  printf '%s ' "$f"; grep -c 'game_daily_reminder' "i18n/$f.json"
done
```

Expected: `5` for each of the ten locales.

- [ ] **Step 4: Commit**

```bash
git add i18n
git commit -m "feat(i18n): add the daily challenge reminder strings"
```

---

## Task 2: The scheduling policy

**Files:**

- Create: `mobile/lib/utils/daily_reminder_schedule.dart`
- Test: `mobile/test/utils/daily_reminder_schedule_test.dart`

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `const int kDailyReminderHorizonDays = 7`
  - `List<DateTime> dailyReminderOccurrences({required DateTime now, required int minuteOfDay, required bool enabled, required bool permissionGranted, required bool hasOptedInSpace, required String? lastPlayedDate, int horizonDays = kDailyReminderHorizonDays})`

- [ ] **Step 1: Write the failing test**

`mobile/test/utils/daily_reminder_schedule_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';

/// 18:00 as minutes since local midnight.
const int _sixPm = 18 * 60;

List<DateTime> occurrences({
  required DateTime now,
  int minuteOfDay = _sixPm,
  bool enabled = true,
  bool permissionGranted = true,
  bool hasOptedInSpace = true,
  String? lastPlayedDate,
  int horizonDays = kDailyReminderHorizonDays,
}) => dailyReminderOccurrences(
  now: now,
  minuteOfDay: minuteOfDay,
  enabled: enabled,
  permissionGranted: permissionGranted,
  hasOptedInSpace: hasOptedInSpace,
  lastPlayedDate: lastPlayedDate,
  horizonDays: horizonDays,
);

void main() {
  // 09:00 local on 18 Aug 2026 — before the 18:00 reminder time.
  final morning = DateTime(2026, 8, 18, 9);

  group('gates', () {
    test('disabled means nothing is scheduled', () {
      expect(occurrences(now: morning, enabled: false), isEmpty);
    });

    test('no opted-in space means nothing is scheduled', () {
      expect(occurrences(now: morning, hasOptedInSpace: false), isEmpty);
    });

    test('a revoked OS permission means nothing is scheduled, whatever the toggle says', () {
      expect(occurrences(now: morning, permissionGranted: false), isEmpty);
    });

    test('a zero horizon means nothing is scheduled', () {
      expect(occurrences(now: morning, horizonDays: 0), isEmpty);
    });
  });

  group('the horizon', () {
    test('schedules one occurrence per day, starting today when the time has not passed', () {
      final result = occurrences(now: morning);

      expect(result.length, kDailyReminderHorizonDays);
      expect(result.first, DateTime(2026, 8, 18, 18));
      expect(result.last, DateTime(2026, 8, 24, 18));
    });

    test('starts tomorrow once the local time has passed', () {
      final result = occurrences(now: DateTime(2026, 8, 18, 19, 30));

      expect(result.first, DateTime(2026, 8, 19, 18));
    });

    test('every occurrence is in the future and strictly increasing', () {
      final result = occurrences(now: morning);

      for (final instant in result) {
        expect(instant.isAfter(morning), isTrue);
      }
      for (var i = 1; i < result.length; i++) {
        expect(result[i].isAfter(result[i - 1]), isTrue);
      }
    });
  });

  group('the already-played skip', () {
    test('drops the nearest occurrence when its UTC day is already played', () {
      final utcDayOfFirst = DateTime(2026, 8, 18, 18).toUtc();
      final key = '${utcDayOfFirst.year}-'
          '${utcDayOfFirst.month.toString().padLeft(2, '0')}-'
          '${utcDayOfFirst.day.toString().padLeft(2, '0')}';

      final result = occurrences(now: morning, lastPlayedDate: key);

      expect(result.length, kDailyReminderHorizonDays - 1);
      expect(result.first, DateTime(2026, 8, 19, 18));
    });

    test('drops nothing when the last play was an earlier day', () {
      expect(occurrences(now: morning, lastPlayedDate: '2026-08-01').length, kDailyReminderHorizonDays);
    });

    test('only the nearest occurrence can ever be dropped — future days cannot have been played', () {
      final result = occurrences(now: morning, lastPlayedDate: '2026-08-01');

      expect(result.length, kDailyReminderHorizonDays);
    });

    test('a future lastPlayedDate (clock skew) drops nothing rather than silencing the reminder', () {
      expect(occurrences(now: morning, lastPlayedDate: '2027-01-01').length, kDailyReminderHorizonDays);
    });

    test('an unparseable or empty lastPlayedDate is treated as never played', () {
      expect(occurrences(now: morning, lastPlayedDate: '').length, kDailyReminderHorizonDays);
      expect(occurrences(now: morning, lastPlayedDate: 'not-a-date').length, kDailyReminderHorizonDays);
    });
  });

  group('the UTC comparison', () {
    // The skip compares against the UTC date of the occurrence's own INSTANT, so it is correct
    // whichever side of Greenwich the player is on. Asserted through the public behaviour rather
    // than by faking a timezone, which a unit test cannot do portably.
    test('the dropped day is the UTC day of the occurrence, not the local calendar day', () {
      final first = DateTime(2026, 8, 18, 18);
      final localKey = '2026-08-18';
      final utc = first.toUtc();
      final utcKey = '${utc.year}-${utc.month.toString().padLeft(2, '0')}-${utc.day.toString().padLeft(2, '0')}';

      final droppedByUtc = occurrences(now: morning, lastPlayedDate: utcKey);
      expect(droppedByUtc.first, isNot(first));

      if (utcKey != localKey) {
        // Only meaningful where the two differ; where they agree this assertion is vacuous and the
        // test above already carries the weight.
        final notDroppedByLocal = occurrences(now: morning, lastPlayedDate: localKey);
        expect(notDroppedByLocal.first, first);
      }
    });
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/utils/daily_reminder_schedule_test.dart`
Expected: FAIL — `daily_reminder_schedule.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/utils/daily_reminder_schedule.dart`:

```dart
/// How many days ahead the reminder schedules.
///
/// One-shots over a horizon rather than a repeating schedule: a repeating notification cannot skip a
/// single occurrence, so it would remind a player about a daily they had already played — the usual
/// reason notifications get switched off for good. The cost is that reminders lapse if the app is
/// not opened for a week, which is accepted; a player who has been away that long is better left
/// alone. It also keeps well clear of iOS's 64-pending-notification cap.
const int kDailyReminderHorizonDays = 7;

/// The `YYYY-MM-DD` UTC key for an instant — the same shape `SettingsKey.gameDailyLastPlayed` holds
/// and the same day boundary the server's `dailyOn` uses.
String dailyKeyFor(DateTime instant) {
  final utc = instant.toUtc();
  return '${utc.year.toString().padLeft(4, '0')}-'
      '${utc.month.toString().padLeft(2, '0')}-'
      '${utc.day.toString().padLeft(2, '0')}';
}

/// Which local instants the daily reminder should fire at.
///
/// Pure and total: every input is a local value and nothing here performs I/O. In particular this
/// never asks the server whether a daily has been played, because `GET .../games/daily` GENERATES
/// the daily as a side effect of the read.
///
/// [minuteOfDay] is minutes since local midnight. It is a local time on purpose: the daily resets at
/// UTC midnight, which is 1-2 am across Europe. Any local time maps to some UTC instant, and
/// whatever daily is current then is the one waiting — so there is no timezone trap, provided the
/// copy never names a date.
List<DateTime> dailyReminderOccurrences({
  required DateTime now,
  required int minuteOfDay,
  required bool enabled,
  required bool permissionGranted,
  required bool hasOptedInSpace,
  required String? lastPlayedDate,
  int horizonDays = kDailyReminderHorizonDays,
}) {
  // Permission is checked here, not only where the toggle is set: it can be revoked in OS settings
  // long after the toggle was switched on.
  if (!enabled || !permissionGranted || !hasOptedInSpace || horizonDays <= 0) {
    return const [];
  }

  final firstToday = DateTime(now.year, now.month, now.day).add(Duration(minutes: minuteOfDay));
  final start = firstToday.isAfter(now) ? firstToday : firstToday.add(const Duration(days: 1));

  final occurrences = <DateTime>[];
  for (var day = 0; day < horizonDays; day++) {
    final instant = start.add(Duration(days: day));
    // The skip compares against the UTC day of THIS instant, not the local calendar day, so it is
    // correct for a player whose evening falls on the following UTC date.
    if (lastPlayedDate != null && lastPlayedDate == dailyKeyFor(instant)) {
      continue;
    }
    occurrences.add(instant);
  }
  return occurrences;
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/utils/daily_reminder_schedule_test.dart`
Expected: PASS, 13 tests.

- [ ] **Step 5: Prove the permission gate bites**

Delete `|| !permissionGranted` and re-run. Expected: the revoked-permission test fails. Restore.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/utils/daily_reminder_schedule.dart mobile/test/utils/daily_reminder_schedule_test.dart
git commit -m "feat(mobile): add the daily reminder scheduling policy"
```

---

## Task 3: The settings keys

**Files:**

- Modify: `mobile/lib/domain/models/settings_key.dart`
- Test: `mobile/test/domain/models/settings_key_game_test.dart`

**Interfaces:**

- Produces: `SettingsKey.gameDailyReminderEnabled<bool>`, `SettingsKey.gameDailyReminderMinuteOfDay<int>`, `SettingsKey.gameDailyLastPlayed<String?>`.

- [ ] **Step 1: Write the failing test**

`mobile/test/domain/models/settings_key_game_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';

void main() {
  test('the reminder defaults to off at 18:00 with no play recorded', () {
    expect(SettingsKey.gameDailyReminderEnabled.defaultValue, isFalse);
    expect(SettingsKey.gameDailyReminderMinuteOfDay.defaultValue, 18 * 60);
    expect(SettingsKey.gameDailyLastPlayed.defaultValue, isNull);
  });

  test('the keys are distinct — a shared storage key would make one overwrite another', () {
    final names = {
      SettingsKey.gameDailyReminderEnabled.name,
      SettingsKey.gameDailyReminderMinuteOfDay.name,
      SettingsKey.gameDailyLastPlayed.name,
    };

    expect(names.length, 3);
  });
}
```

Read the enum's existing entries first: if `SettingsKey` members declare defaults differently in this
codebase (e.g. `defaultValue:` named argument versus a `Setting<T>` wrapper), match that form exactly
rather than the shape sketched above, and adjust the assertions to the real accessor.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/domain/models/settings_key_game_test.dart`
Expected: FAIL — the members do not exist.

- [ ] **Step 3: Implement**

In `mobile/lib/domain/models/settings_key.dart`, after the `// Spaces` block:

```dart
  // Games
  gameDailyReminderEnabled<bool>(defaultValue: false),
  gameDailyReminderMinuteOfDay<int>(defaultValue: 18 * 60),

  /// The UTC `YYYY-MM-DD` of the last DAILY challenge finished on this device.
  ///
  /// One date, not a per-space map: the reminder's rule is "you have already played today", so a
  /// single day is all it needs. A per-space map would require reading every opted-in space's daily
  /// to evaluate — and that read GENERATES the daily server-side.
  gameDailyLastPlayed<String?>(),
```

Match the file's existing declaration style for defaults exactly.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/domain/models/settings_key_game_test.dart`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/domain/models/settings_key.dart mobile/test/domain/models/settings_key_game_test.dart
git commit -m "feat(mobile): add the daily reminder settings keys"
```

---

## Task 4: The scheduling provider

**Files:**

- Create: `mobile/lib/providers/game/daily_reminder.provider.dart`
- Test: `mobile/test/providers/game/daily_reminder_test.dart`

**Interfaces:**

- Consumes: `dailyReminderOccurrences`, `dailyKeyFor`, `SettingsKey`, `sharedSpacesProvider`.
- Produces:
  - `abstract class DailyReminderScheduler { Future<void> cancelAll(); Future<void> scheduleAt(int id, DateTime instant, {required String title, required String body, required String payload}); Future<bool> hasPermission(); }`
  - `final dailyReminderSchedulerProvider = Provider<DailyReminderScheduler>(...)`
  - `final dailyReminderProvider = Provider<DailyReminderController>(...)`
  - `DailyReminderController.refresh()`, `.recordDailyCompleted(DateTime dailyOn)`
  - `const String kDailyReminderPayload = 'game-daily-reminder'`

- [ ] **Step 1: Write the failing test**

`mobile/test/providers/game/daily_reminder_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockScheduler extends Mock implements DailyReminderScheduler {}

class _FakeSettings extends Mock implements SettingsService {
  final Map<SettingsKey, Object?> values = {};

  @override
  T get<T>(SettingsKey<T> key) => (values[key] ?? key.defaultValue) as T;

  @override
  Future<void> set<T>(SettingsKey<T> key, T value) async => values[key] = value;
}

SharedSpaceResponseDto _space(String id, {bool? dailyEnabled}) => SharedSpaceResponseDto(
  id: id,
  name: id,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  createdById: 'u1',
  dailyChallengeEnabled:
      dailyEnabled == null ? const Optional.absent() : Optional.present(dailyEnabled),
);

void main() {
  late _MockScheduler scheduler;
  late _FakeSettings settings;

  setUpAll(() => registerFallbackValue(DateTime(2026)));

  setUp(() {
    scheduler = _MockScheduler();
    settings = _FakeSettings();
    when(() => scheduler.cancelAll()).thenAnswer((_) async {});
    when(() => scheduler.hasPermission()).thenAnswer((_) async => true);
    when(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    ).thenAnswer((_) async {});
  });

  ProviderContainer container(List<SharedSpaceResponseDto> spaces) {
    final result = ProviderContainer(
      overrides: [
        dailyReminderSchedulerProvider.overrideWithValue(scheduler),
        settingsServiceProvider.overrideWithValue(settings),
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
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    );
  });

  test('schedules the horizon once a space has the daily switched on', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();

    verify(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    ).called(greaterThan(0));
  });

  test('an absent dailyChallengeEnabled does not count as opted in, and does not throw', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    // `Absent.value` THROWS — reading this field with `.value` would blow up here rather than
    // returning false.
    final c = container([_space('s1')]);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    );
  });

  test('a declined space does not count as opted in', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = container([_space('s1', dailyEnabled: false)]);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    );
  });

  test('one opted-in space among several is enough', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = container([_space('s1', dailyEnabled: false), _space('s2', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();

    verify(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    ).called(greaterThan(0));
  });

  test('a revoked OS permission schedules nothing even with the toggle on', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    when(() => scheduler.hasPermission()).thenAnswer((_) async => false);
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(
      () => scheduler.scheduleAt(any(), any(),
          title: any(named: 'title'), body: any(named: 'body'), payload: any(named: 'payload')),
    );
  });

  test('every refresh cancels before it schedules, so occurrences never accumulate', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).refresh();
    await c.read(dailyReminderProvider).refresh();

    verify(() => scheduler.cancelAll()).called(2);
  });

  test('recording a completion stores the daily UTC date and reschedules', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = container([_space('s1', dailyEnabled: true)]);

    await c.read(dailyReminderProvider).recordDailyCompleted(DateTime.utc(2026, 8, 18));

    expect(settings.values[SettingsKey.gameDailyLastPlayed], '2026-08-18');
    verify(() => scheduler.cancelAll()).called(1);
  });

  test('a spaces-list failure leaves pending notifications alone rather than cancelling them', () async {
    settings.values[SettingsKey.gameDailyReminderEnabled] = true;
    final c = ProviderContainer(
      overrides: [
        dailyReminderSchedulerProvider.overrideWithValue(scheduler),
        settingsServiceProvider.overrideWithValue(settings),
        sharedSpacesProvider.overrideWith((ref) async => throw Exception('offline')),
      ],
    );
    addTearDown(c.dispose);

    await c.read(dailyReminderProvider).refresh();

    verifyNever(() => scheduler.cancelAll());
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/providers/game/daily_reminder_test.dart`
Expected: FAIL — `daily_reminder.provider.dart` does not exist.

- [ ] **Step 3: Implement**

`mobile/lib/providers/game/daily_reminder.provider.dart`:

```dart
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/utils/daily_reminder_schedule.dart';
import 'package:timezone/timezone.dart' as tz;

/// Identifies a reminder tap so `main.dart` can route it without parsing anything.
const String kDailyReminderPayload = 'game-daily-reminder';

/// Notification ids are fixed and contiguous, so a cancel-then-schedule cycle cannot leave an
/// orphan behind from a longer previous horizon.
const int _kFirstNotificationId = 8100;

/// The plugin boundary, behind an interface so the policy above it is testable without a platform
/// channel.
abstract class DailyReminderScheduler {
  Future<void> cancelAll();
  Future<bool> hasPermission();
  Future<void> scheduleAt(
    int id,
    DateTime instant, {
    required String title,
    required String body,
    required String payload,
  });
}

class _PluginScheduler implements DailyReminderScheduler {
  final FlutterLocalNotificationsPlugin _plugin = FlutterLocalNotificationsPlugin();

  @override
  Future<void> cancelAll() async {
    for (var i = 0; i < kDailyReminderHorizonDays; i++) {
      await _plugin.cancel(_kFirstNotificationId + i);
    }
  }

  @override
  Future<bool> hasPermission() async {
    final android = _plugin
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>();
    if (android != null) {
      return await android.areNotificationsEnabled() ?? false;
    }
    final ios = _plugin.resolvePlatformSpecificImplementation<IOSFlutterLocalNotificationsPlugin>();
    if (ios != null) {
      return await ios.requestPermissions(alert: true, badge: false, sound: true) ?? false;
    }
    return false;
  }

  @override
  Future<void> scheduleAt(
    int id,
    DateTime instant, {
    required String title,
    required String body,
    required String payload,
  }) {
    return _plugin.zonedSchedule(
      id,
      title,
      body,
      tz.TZDateTime.from(instant, tz.local),
      const NotificationDetails(
        android: AndroidNotificationDetails('game_daily_reminder', 'Daily challenge'),
        iOS: DarwinNotificationDetails(),
      ),
      // Inexact on purpose: an exact alarm would need SCHEDULE_EXACT_ALARM on Android 12+, a
      // manifest permission with Play Store policy attached, and a daily nudge does not need it.
      androidScheduleMode: AndroidScheduleMode.inexactAllowWhileIdle,
      payload: payload,
    );
  }
}

final dailyReminderSchedulerProvider = Provider<DailyReminderScheduler>((ref) => _PluginScheduler());

final dailyReminderProvider = Provider<DailyReminderController>(DailyReminderController.new);

class DailyReminderController {
  DailyReminderController(this._ref);

  final Ref _ref;

  /// Recompute and re-apply the whole schedule.
  ///
  /// Called on cold start, on resume, and after a daily is finished. Reads no game endpoint: asking
  /// the server whether today's daily is played would GENERATE it for every opted-in space.
  Future<void> refresh({DateTime? now}) async {
    final List<dynamic> spaces;
    try {
      spaces = await _ref.read(sharedSpacesProvider.future);
    } catch (_) {
      // Offline. Leave whatever is pending in place — cancelling would silence a reminder because
      // of a transient network failure.
      return;
    }

    await _ref.read(dailyReminderSchedulerProvider).cancelAll();

    final settings = _ref.read(settingsServiceProvider);
    final scheduler = _ref.read(dailyReminderSchedulerProvider);

    // `dailyChallengeEnabled` is Optional<bool?> and `Absent.value` THROWS, so this must stay
    // `.orElse(null)`. Absent and null both mean "not opted in".
    final hasOptedInSpace = spaces.any((space) => space.dailyChallengeEnabled.orElse(null) == true);

    final occurrences = dailyReminderOccurrences(
      now: now ?? DateTime.now(),
      minuteOfDay: settings.get(SettingsKey.gameDailyReminderMinuteOfDay),
      enabled: settings.get(SettingsKey.gameDailyReminderEnabled),
      permissionGranted: await scheduler.hasPermission(),
      hasOptedInSpace: hasOptedInSpace,
      lastPlayedDate: settings.get(SettingsKey.gameDailyLastPlayed),
    );

    for (var i = 0; i < occurrences.length; i++) {
      await scheduler.scheduleAt(
        _kFirstNotificationId + i,
        occurrences[i],
        title: 'game_daily_reminder_notification_title'.tr(),
        body: 'game_daily_reminder_notification_body'.tr(),
        payload: kDailyReminderPayload,
      );
    }
  }

  /// Records that a daily was finished, then reschedules so today's occurrence drops immediately
  /// rather than waiting for the next resume.
  Future<void> recordDailyCompleted(DateTime dailyOn) async {
    await _ref.read(settingsServiceProvider).set(SettingsKey.gameDailyLastPlayed, dailyKeyFor(dailyOn));
    await refresh();
  }
}
```

Import `package:easy_localization/easy_localization.dart` for `.tr()`, which resolves without a
`BuildContext` — a notification body is built off-screen.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/providers/game/daily_reminder_test.dart`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the Optional trap is covered**

Change `space.dailyChallengeEnabled.orElse(null) == true` to `space.dailyChallengeEnabled.value ==
true` and re-run. Expected: the "absent does not count as opted in" test throws rather than passing.
Restore.

- [ ] **Step 6: Commit**

```bash
git add mobile/lib/providers/game/daily_reminder.provider.dart mobile/test/providers/game/daily_reminder_test.dart
git commit -m "feat(mobile): schedule the daily challenge reminder"
```

---

## Task 5: The settings row

**Files:**

- Modify: `mobile/lib/widgets/settings/notification_setting.dart`
- Test: `mobile/test/widgets/settings/daily_reminder_setting_test.dart`

**Interfaces:**

- Consumes: `SettingsKey`, `dailyReminderProvider`.
- Produces: keys `daily-reminder-toggle`, `daily-reminder-time`.

- [ ] **Step 1: Write the failing test**

`mobile/test/widgets/settings/daily_reminder_setting_test.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/widgets/settings/notification_setting.dart';
import 'package:mocktail/mocktail.dart';

class _MockController extends Mock implements DailyReminderController {}

void main() {
  late _MockController controller;

  setUp(() {
    controller = _MockController();
    when(() => controller.refresh()).thenAnswer((_) async {});
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/widgets/settings/daily_reminder_setting_test.dart`
Expected: FAIL — no `daily-reminder-toggle`.

- [ ] **Step 3: Implement**

Append to the `notificationSettings` list in `mobile/lib/widgets/settings/notification_setting.dart`:

```dart
      // Local state only, and deliberately no network read: this page must open offline. What is
      // gated on space membership is the SCHEDULING, not this row — see
      // DailyReminderController.refresh.
      SettingsSwitchListTile(
        key: const Key('daily-reminder-toggle'),
        valueNotifier: reminderEnabled,
        title: 'game_daily_reminder_title'.tr(),
        subtitle: 'game_daily_reminder_subtitle'.tr(),
        onChanged: (value) async {
          await ref.read(settingsServiceProvider).set(SettingsKey.gameDailyReminderEnabled, value);
          await ref.read(dailyReminderProvider).refresh();
        },
      ),
      ListTile(
        key: const Key('daily-reminder-time'),
        title: Text('game_daily_reminder_time'.tr()),
        trailing: Text(_formatMinuteOfDay(reminderMinute.value)),
        onTap: () async {
          final picked = await showTimePicker(
            context: context,
            initialTime: TimeOfDay(hour: reminderMinute.value ~/ 60, minute: reminderMinute.value % 60),
          );
          if (picked == null) return;
          reminderMinute.value = picked.hour * 60 + picked.minute;
          await ref
              .read(settingsServiceProvider)
              .set(SettingsKey.gameDailyReminderMinuteOfDay, reminderMinute.value);
          await ref.read(dailyReminderProvider).refresh();
        },
      ),
```

with, above the list:

```dart
    final reminderEnabled = useValueNotifier(
      ref.read(settingsServiceProvider).get(SettingsKey.gameDailyReminderEnabled),
    );
    final reminderMinute = useValueNotifier(
      ref.read(settingsServiceProvider).get(SettingsKey.gameDailyReminderMinuteOfDay),
    );
```

and a small helper in the same file:

```dart
String _formatMinuteOfDay(int minuteOfDay) =>
    '${(minuteOfDay ~/ 60).toString().padLeft(2, '0')}:${(minuteOfDay % 60).toString().padLeft(2, '0')}';
```

Match the file's existing tile widgets — if `SettingsSwitchListTile` takes different parameters here,
use its real signature rather than the sketch above.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `flutter test test/widgets/settings/daily_reminder_setting_test.dart`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add mobile/lib/widgets/settings/notification_setting.dart \
        mobile/test/widgets/settings/daily_reminder_setting_test.dart
git commit -m "feat(mobile): add the daily reminder setting"
```

---

## Task 6: The three triggers and the tap handler

**Files:**

- Modify: `mobile/lib/main.dart`
- Modify: `mobile/lib/pages/library/spaces/games/game_play.page.dart`
- Test: `mobile/test/providers/game/daily_reminder_triggers_test.dart`

**Interfaces:**

- Consumes: `dailyReminderProvider`, `AppLifeCycleEnum`, `GameSessionController.onDailyCompleted`, `kDailyReminderPayload`.
- Produces: nothing new — this wires what exists.

- [ ] **Step 1: Write the failing test**

`mobile/test/providers/game/daily_reminder_triggers_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/game/daily_reminder.provider.dart';
import 'package:immich_mobile/providers/game/game_session.provider.dart';
import 'package:immich_mobile/repositories/game_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockController extends Mock implements DailyReminderController {}

class _MockGameApiRepository extends Mock implements GameApiRepository {}

void main() {
  test('finishing a daily reports its completion to the reminder', () async {
    final reminder = _MockController();
    when(() => reminder.recordDailyCompleted(any())).thenAnswer((_) async {});

    final repository = _MockGameApiRepository();
    var fetches = 0;
    when(() => repository.getChallenge('c1')).thenAnswer((_) async {
      fetches++;
      return GameChallengeDetailResponseDto(
        id: 'c1',
        spaceId: 's1',
        name: 'daily',
        roundCount: 1,
        scaleKm: 1,
        scaleDays: 1,
        createdAt: DateTime.utc(2026, 8, 18),
        dailyOn: DateTime.utc(2026, 8, 18),
        rounds: [
          GameRoundDetailResponseDto(
            index: 0,
            type: GameRoundType.location,
            score: fetches == 1 ? const Optional.absent() : const Optional.present(10),
          ),
        ],
      );
    });
    when(() => repository.guessLocation(any(), any(), lat: any(named: 'lat'), lon: any(named: 'lon')))
        .thenAnswer((_) async => GameGuessResponseDto(roundId: 'r', userId: 'u', score: 10));
    when(() => repository.getLeaderboard(any())).thenAnswer((_) async => GameLeaderboardResponseDto(entries: []));

    final container = ProviderContainer(
      overrides: [
        gameApiRepositoryProvider.overrideWithValue(repository),
        dailyReminderProvider.overrideWithValue(reminder),
      ],
    );
    addTearDown(container.dispose);

    await container.read(gameSessionProvider('c1').future);
    final controller = container.read(gameSessionProvider('c1').notifier)
      ..onDailyCompleted = (dailyOn) => container.read(dailyReminderProvider).recordDailyCompleted(dailyOn);
    await controller.guessLocation(lat: 1, lon: 1);
    controller.next();
    await Future<void>.delayed(Duration.zero);

    verify(() => reminder.recordDailyCompleted(DateTime.utc(2026, 8, 18))).called(1);
  });
}
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `flutter test test/providers/game/daily_reminder_triggers_test.dart`
Expected: FAIL — nothing wires `onDailyCompleted` yet, so `recordDailyCompleted` is never called.

- [ ] **Step 3: Wire the completion trigger**

In `game_play.page.dart`, set the hook when the session is first read:

```dart
    // The session owns the state machine; the reminder owns the schedule. This is the one line that
    // connects them, and it fires only for a DAILY — a custom challenge never satisfies a reminder.
    ref.read(gameSessionProvider(challengeId).notifier).onDailyCompleted =
        (dailyOn) => ref.read(dailyReminderProvider).recordDailyCompleted(dailyOn);
```

- [ ] **Step 4: Wire cold start and resume**

In `mobile/lib/main.dart`, after the user and providers are available, add the cold-start refresh:

```dart
    // Cold start. AppLifeCycleEnum.resumed does NOT fire on a cold launch, so without this a fresh
    // install (or a killed app) would have nothing scheduled until it was backgrounded once.
    unawaited(ref.read(dailyReminderProvider).refresh());
```

and, where `AppLifeCycleEnum` transitions are already observed, refresh on `resumed`.

- [ ] **Step 5: Wire the tap handler**

In `main.dart`, the plugin is currently initialised with no response callback, so a tap opens the app
and nothing more. Add:

```dart
    await FlutterLocalNotificationsPlugin().initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@drawable/notification_icon'),
        iOS: DarwinInitializationSettings(),
      ),
      // A reminder that opens the timeline is a reminder about nothing. Route it to a space that
      // actually has a daily; the spaces list is the honest fallback when none can be resolved.
      onDidReceiveNotificationResponse: (response) {
        if (response.payload != kDailyReminderPayload) return;
        unawaited(_openDailyChallenge());
      },
    );
```

where `_openDailyChallenge` reads `sharedSpacesProvider`, picks the first space whose
`dailyChallengeEnabled.orElse(null) == true` in the spaces list's own default order, and pushes
`SpaceGamesRoute(spaceId: ..., canEdit: ...)`, falling back to the spaces list.

Keep this handler to a single delegating call: `main.dart` is a shared file and therefore rebase
surface.

- [ ] **Step 6: Run the test and the full suite**

```bash
flutter test test/providers/game/daily_reminder_triggers_test.dart
flutter test
```

Expected: the trigger test PASSes; the full suite (~2900 tests, about a minute) passes.

- [ ] **Step 7: Run both CI gates and check the lockfiles**

```bash
dart analyze --fatal-infos
dart format --set-exit-if-changed $(find lib -name '*.dart' -not \( -name '*.g.dart' -o -name '*.drift.dart' -o -name '*.gr.dart' \))
git status -- '*mise.lock'
```

Expected: no issues, no formatting changes, and **no modification to either `mise.lock`**.

- [ ] **Step 8: Commit**

```bash
git add mobile/lib/main.dart mobile/lib/pages/library/spaces/games/game_play.page.dart \
        mobile/test/providers/game/daily_reminder_triggers_test.dart
git commit -m "feat(mobile): trigger the daily reminder on start, resume and completion"
```

---

## Self-Review

**Spec coverage.** Every clause of the spec's reminder section maps to a task: the i18n keys → 1; the
one-shot horizon, the local time, the skip rule and the inexact Android mode → 2; the single
`gameDailyLastPlayed` key and the toggle keys → 3; the opted-in-space gate, the permission check and
the cancel-before-schedule cycle → 4; the offline-safe settings row → 5; cold start, resume,
completion and the tap handler → 6.

**Placeholder scan.** Three steps deliberately say "match the file's existing style" rather than
inventing a signature — Task 3's `SettingsKey` declaration form and Task 5's `SettingsSwitchListTile`
parameters. These are instructions to read one file, not deferred decisions, and each names exactly
what to check.

**Type consistency.** `dailyReminderOccurrences` and `dailyKeyFor` are defined in Task 2 and consumed
in Task 4. `DailyReminderScheduler`, `DailyReminderController.refresh/recordDailyCompleted` and
`kDailyReminderPayload` are defined in Task 4 and consumed in Tasks 5 and 6.
`GameSessionController.onDailyCompleted` comes from the game client plan's Task 5 with the signature
`void Function(DateTime dailyOn)?`, which is what Task 6 assigns to.

**Known ordering dependency.** Task 6 edits `game_play.page.dart`, created by the game client plan's
Task 9. That plan must be merged first.
