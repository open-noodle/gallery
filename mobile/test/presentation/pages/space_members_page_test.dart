import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/gallery/spaces/space_member_permissions.dart';
import 'package:immich_mobile/pages/library/spaces/space_members.page.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUser extends CurrentUserProvider {
  _StubCurrentUser(super.service, UserDto? initial) {
    state = initial;
  }
}

const _spaceId = 'space-1';

SharedSpaceMemberResponseDto _member(String id, SharedSpaceRole role) => SharedSpaceMemberResponseDto(
  email: '$id@example.com',
  joinedAt: '2026-01-01T00:00:00.000Z',
  name: id,
  role: role,
  sharePersonMetadata: false,
  showInTimeline: true,
  userId: id,
);

SharedSpaceResponseDto _space({bool? add, bool? roles}) => SharedSpaceResponseDto(
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: 'owner',
  id: _spaceId,
  name: 'Space',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberManagement: add == null
      ? const Optional.absent()
      : Optional.present(
          SharedSpaceMemberManagementDto(
            canAddMembers: add,
            canChangeRoles: roles ?? false,
            editorsCanAddMembers: null,
            editorsCanChangeRoles: null,
            serverEditorsCanAddMembers: false,
            serverEditorsCanChangeRoles: false,
          ),
        ),
);

List<Override> _overrides(String me, SharedSpaceResponseDto space) {
  final user = UserDto(id: me, email: '$me@example.com', name: me, profileChangedAt: DateTime(2024, 1, 1));
  final userService = _MockUserService();
  when(() => userService.tryGetMyUser()).thenReturn(user);
  when(() => userService.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());
  return [
    currentUserProvider.overrideWith((ref) => _StubCurrentUser(userService, user)),
    sharedSpaceProvider(_spaceId).overrideWith((_) async => space),
    sharedSpaceMembersProvider(_spaceId).overrideWith(
      (_) async => [
        _member('owner', SharedSpaceRole.owner),
        _member('ed', SharedSpaceRole.editor),
        _member('ed2', SharedSpaceRole.editor),
        _member('vw', SharedSpaceRole.viewer),
      ],
    ),
  ];
}

void main() {
  setUpAll(() {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
  });

  Future<void> pump(WidgetTester tester, String me, SharedSpaceResponseDto space) =>
      tester.pumpConsumerWidget(const SpaceMembersPage(spaceId: _spaceId), overrides: _overrides(me, space));

  testWidgets('editor with canAddMembers sees the add button', (tester) async {
    await pump(tester, 'ed', _space(add: true, roles: false));
    expect(find.byIcon(Icons.person_add_outlined), findsOneWidget);
  });

  testWidgets('plain editor sees neither add button nor role sheet', (tester) async {
    await pump(tester, 'ed', _space(add: false, roles: false));
    expect(find.byIcon(Icons.person_add_outlined), findsNothing);
    await tester.tap(find.text('vw'));
    await tester.pumpAndSettle();
    expect(find.text('Set as Viewer'), findsNothing);
    expect(find.text('Set as Editor'), findsNothing);
  });

  testWidgets('editor with canChangeRoles gets the role sheet for a viewer, without remove', (tester) async {
    await pump(tester, 'ed', _space(add: false, roles: true));
    await tester.tap(find.text('vw'));
    await tester.pumpAndSettle();
    expect(find.text('Set as Editor'), findsOneWidget);
    expect(find.text('Set as Viewer'), findsOneWidget);
    expect(find.text('Remove from Space'), findsNothing);
  });

  testWidgets('editor with canChangeRoles gets no sheet for an owner target', (tester) async {
    await pump(tester, 'ed', _space(add: false, roles: true));
    await tester.tap(find.text('owner@example.com'));
    await tester.pumpAndSettle();
    expect(find.text('Set as Editor'), findsNothing);
  });

  testWidgets('owner sees the settings widget, the add button and remove', (tester) async {
    await pump(tester, 'owner', _space(add: true, roles: true));
    expect(find.byType(SpaceMemberPermissionSettings), findsOneWidget);
    expect(find.byIcon(Icons.person_add_outlined), findsOneWidget);
    await tester.tap(find.text('vw'));
    await tester.pumpAndSettle();
    expect(find.text('Remove from Space'), findsOneWidget);
  });

  testWidgets('older server (no memberManagement): owner as today, editor nothing', (tester) async {
    await pump(tester, 'owner', _space());
    expect(find.byIcon(Icons.person_add_outlined), findsOneWidget);
    expect(find.text('Server default (off)'), findsNothing);
  });

  testWidgets('older server: editor sees no add button and no role sheet', (tester) async {
    await pump(tester, 'ed', _space());
    expect(find.byIcon(Icons.person_add_outlined), findsNothing);
    await tester.tap(find.text('vw'));
    await tester.pumpAndSettle();
    expect(find.text('Set as Viewer'), findsNothing);
  });
}
