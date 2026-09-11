import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:openapi/api.dart';

/// Where a tapped daily-reminder notification should open.
sealed class DailyReminderDestination {
  const DailyReminderDestination();
}

/// A specific space's game surface.
class SpaceDailyDestination extends DailyReminderDestination {
  const SpaceDailyDestination({required this.spaceId, required this.canEdit});

  final String spaceId;
  final bool canEdit;
}

/// The solo (personal) daily surface.
class SoloDailyDestination extends DailyReminderDestination {
  const SoloDailyDestination();
}

/// Pure decision for where a tapped daily-reminder notification opens.
///
/// Pure and total like `dailyReminderOccurrences`, and for the same reason: this is a policy
/// decision, not I/O, so it stays testable without a router or a device.
///
/// The default is the first opted-in space, in [spaces]' own order, falling back to the solo
/// daily when none resolves (no opted-in space, or the caller passed an empty list because its
/// own spaces fetch failed) — every account has a personal daily once the reminder toggle is on,
/// unlike a space, which needs an editor to switch `dailyChallengeEnabled` on first, so this
/// always has somewhere useful to land instead of a dead end.
///
/// [spacePlayedToday] / [soloPlayedToday] override that default in exactly one case: when the
/// space daily is ALREADY finished for today and the solo one is not. The reminder that fired
/// tonight is scheduled from the same two facts (see `dailyReminderOccurrences`'s "skip only when
/// every enabled source is played"), so if it fired at all with the space side done, it can only
/// be because the solo side is the one still unplayed — routing to the space by default would
/// silently reopen a daily the player already finished and never surface the actual reason they
/// were reminded. The reverse (solo done, space not) needs no special case: the default
/// space-first order already sends them to the correct, still-unplayed space daily. When NEITHER
/// is played (the common case) or BOTH are (a stale tap after finishing both), the default order
/// applies unchanged.
DailyReminderDestination resolveDailyReminderDestination({
  required List<SharedSpaceResponseDto> spaces,
  required String? currentUserId,
  required bool spacePlayedToday,
  required bool soloPlayedToday,
}) {
  if (spacePlayedToday && !soloPlayedToday) {
    return const SoloDailyDestination();
  }

  for (final space in spaces) {
    // `dailyChallengeEnabled` is Optional<bool?> and `Absent.value` THROWS, so this must stay
    // `.orElse(null)`. Absent and null both mean "not opted in".
    if (space.dailyChallengeEnabled.orElse(null) == true) {
      return SpaceDailyDestination(spaceId: space.id, canEdit: spaceIsWritable(space, currentUserId));
    }
  }

  return const SoloDailyDestination();
}
