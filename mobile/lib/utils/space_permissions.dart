import 'package:openapi/api.dart';

/// Role predicates for shared spaces, shared by every surface that gates on them.
///
/// One implementation so the space detail page, the space bottom sheet and the
/// link picker cannot drift apart. See the 2026-07-26 mobile Spaces UX design, §4.
///
/// `SharedSpaceResponseDto.members` is `Optional<List<...>?>` and `Absent.value`
/// **throws** (`openapi/lib/optional.dart:67`), so every read goes through
/// `orElse(null)` — the previously common `members.value ?? const []` crashes on a
/// response that omits the list.
/// The first matching row wins, which makes the duplicate-membership case
/// deterministic. Written as an explicit loop rather than `.firstOrNull` so the
/// file needs no `package:collection` import — Dart imports are not transitive,
/// and this module deliberately imports only `openapi`.
SharedSpaceRole? _roleOf(SharedSpaceResponseDto space, String currentUserId) {
  final members = space.members.orElse(null) ?? const <SharedSpaceMemberResponseDto>[];
  for (final member in members) {
    if (member.userId == currentUserId) return member.role;
  }
  return null;
}

/// Whether [currentUserId] may add to, and edit the naming of, [space].
///
/// The creator short-circuit is deliberate and takes precedence over their member
/// row: `getAll` does not guarantee the creator appears in `members`, so relying on
/// the list alone would lock a space's own creator out of it.
bool spaceIsWritable(SharedSpaceResponseDto space, String? currentUserId) {
  if (currentUserId == null) return false;
  if (space.createdById == currentUserId) return true;
  return roleIsWritable(_roleOf(space, currentUserId));
}

/// Whether [currentUserId] owns [space] — the gate for destructive actions.
bool spaceIsOwned(SharedSpaceResponseDto space, String? currentUserId) {
  if (currentUserId == null) return false;
  if (space.createdById == currentUserId) return true;
  return _roleOf(space, currentUserId) == SharedSpaceRole.owner;
}

/// The role-only overload, for callers holding a resolved [SharedSpaceRole]
/// rather than a whole DTO (e.g. `SpaceBottomSheet`).
bool roleIsWritable(SharedSpaceRole? role) => role == SharedSpaceRole.owner || role == SharedSpaceRole.editor;
