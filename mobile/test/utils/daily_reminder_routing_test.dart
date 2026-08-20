import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/daily_reminder_routing.dart';
import 'package:openapi/api.dart';

SharedSpaceResponseDto _space(String id, {bool? dailyEnabled, String createdById = 'other-user'}) =>
    SharedSpaceResponseDto(
      id: id,
      name: id,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      createdById: createdById,
      dailyChallengeEnabled: dailyEnabled == null ? const Optional.absent() : Optional.present(dailyEnabled),
    );

void main() {
  // The Important fix: on the healthy path, an opted-in space player finishes today's space
  // daily (spaceLastPlayed = today) while the solo one is still unplayed. The schedule correctly
  // does not skip tonight's occurrence — see dailyReminderOccurrences's "skip only when every
  // enabled source is played" — because the solo side is the reason it fired. Routing on
  // "does an opted-in space exist" alone, with no reference to which source was actually
  // unplayed, would open that same already-finished space daily and never surface the actual
  // reason the player was reminded.
  test('a finished space daily with an unplayed solo one routes to solo, not back to the space', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true)],
      currentUserId: 'u1',
      spacePlayedToday: true,
      soloPlayedToday: false,
    );

    expect(destination, isA<SoloDailyDestination>());
  });

  test('an unfinished space daily with a finished solo one still routes to the space', () {
    // The mirror image: nothing special needed here because the default space-first order already
    // sends the player to the correct, still-unplayed space daily.
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true)],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: true,
    );

    expect(destination, isA<SpaceDailyDestination>());
    expect((destination as SpaceDailyDestination).spaceId, 's1');
  });

  test('neither played keeps the default space-first order', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true)],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect(destination, isA<SpaceDailyDestination>());
  });

  test('both played falls back to the default space-first order rather than solo', () {
    // A stale tap after finishing both — there is no "right" answer, so this pins the existing
    // default rather than leaving it to chance.
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true)],
      currentUserId: 'u1',
      spacePlayedToday: true,
      soloPlayedToday: true,
    );

    expect(destination, isA<SpaceDailyDestination>());
  });

  test('the first opted-in space wins, in the spaces list order', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: false), _space('s2', dailyEnabled: true)],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect(destination, isA<SpaceDailyDestination>());
    expect((destination as SpaceDailyDestination).spaceId, 's2');
  });

  test('no opted-in space falls back to solo', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: false)],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect(destination, isA<SoloDailyDestination>());
  });

  test('an empty spaces list (e.g. a failed fetch) falls back to solo', () {
    final destination = resolveDailyReminderDestination(
      spaces: const [],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect(destination, isA<SoloDailyDestination>());
  });

  test('an absent dailyChallengeEnabled does not count as opted in, and does not throw', () {
    // `Absent.value` THROWS — reading this field with `.value` would blow up here rather than
    // returning false.
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1')],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect(destination, isA<SoloDailyDestination>());
  });

  test('canEdit follows spaceIsWritable: the creator can edit even absent from members', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true, createdById: 'u1')],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect((destination as SpaceDailyDestination).canEdit, isTrue);
  });

  test('canEdit is false for a non-creator with no member row', () {
    final destination = resolveDailyReminderDestination(
      spaces: [_space('s1', dailyEnabled: true, createdById: 'someone-else')],
      currentUserId: 'u1',
      spacePlayedToday: false,
      soloPlayedToday: false,
    );

    expect((destination as SpaceDailyDestination).canEdit, isFalse);
  });
}
