import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/utils/space_permissions.dart';
import 'package:openapi/api.dart';

SharedSpaceMemberResponseDto _member(String userId, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
  userId: userId,
  name: userId,
  email: '$userId@example.com',
  role: role,
  joinedAt: '2024-01-01T00:00:00Z',
  sharePersonMetadata: true,
  showInTimeline: true,
);

/// [members] is passed through verbatim so a test can supply
/// `Optional.absent()`, `Optional.present(null)` or a real list.
SharedSpaceResponseDto _space({
  String createdById = 'creator',
  Optional<List<SharedSpaceMemberResponseDto>?> members = const Optional.absent(),
}) => SharedSpaceResponseDto(
  id: 'space-1',
  name: 'Space 1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  createdById: createdById,
  members: members,
);

void main() {
  group('spaceIsWritable / spaceIsOwned', () {
    test('the creator is writable and owned even when absent from the members list', () {
      final space = _space(createdById: 'me', members: Optional.present([_member('someone', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isTrue);
    });

    test('a non-creator member with the owner role is writable AND owned', () {
      final space = _space(createdById: 'creator', members: Optional.present([_member('me', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isTrue, reason: 'Delete gating depends on this');
    });

    test('an editor is writable but not owned', () {
      final space = _space(members: Optional.present([_member('me', SharedSpaceRole.editor)]));

      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('a viewer is neither', () {
      final space = _space(members: Optional.present([_member('me', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isFalse);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('a non-member who did not create the space is neither', () {
      final space = _space(members: Optional.present([_member('other', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, 'me'), isFalse);
      expect(spaceIsOwned(space, 'me'), isFalse);
    });

    test('an absent members list falls back to the creator check without throwing', () {
      // Absent.value throws StateError, so `members.value ?? const []` would crash here.
      final space = _space(createdById: 'me');

      expect(() => spaceIsWritable(space, 'me'), returnsNormally);
      expect(spaceIsWritable(space, 'me'), isTrue);
      expect(spaceIsWritable(space, 'someone-else'), isFalse);
    });

    test('a present-but-null members list behaves as an empty list', () {
      final space = _space(createdById: 'creator', members: const Optional.present(null));

      expect(() => spaceIsWritable(space, 'me'), returnsNormally);
      expect(spaceIsWritable(space, 'me'), isFalse);
    });

    test('duplicate membership rows resolve to the first match deterministically', () {
      final space = _space(
        members: Optional.present([_member('me', SharedSpaceRole.editor), _member('me', SharedSpaceRole.viewer)]),
      );

      expect(spaceIsWritable(space, 'me'), isTrue);
    });

    test('a null current user is never writable or owned, even if createdById is also null-ish', () {
      final space = _space(createdById: '', members: Optional.present([_member('me', SharedSpaceRole.owner)]));

      expect(spaceIsWritable(space, null), isFalse);
      expect(spaceIsOwned(space, null), isFalse);
    });

    test('the creator short-circuit wins over a demoted member row', () {
      // Ownership transferred: still the createdById, but demoted to viewer.
      final space = _space(createdById: 'me', members: Optional.present([_member('me', SharedSpaceRole.viewer)]));

      expect(spaceIsWritable(space, 'me'), isTrue, reason: 'precedence is a decision, not an accident');
      expect(spaceIsOwned(space, 'me'), isTrue);
    });
  });

  group('roleIsWritable', () {
    test('owner and editor are writable; viewer and null are not', () {
      expect(roleIsWritable(SharedSpaceRole.owner), isTrue);
      expect(roleIsWritable(SharedSpaceRole.editor), isTrue);
      expect(roleIsWritable(SharedSpaceRole.viewer), isFalse);
      expect(roleIsWritable(null), isFalse);
    });
  });
}
