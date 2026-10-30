import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/spaces/space_member_permissions.dart';
import 'package:immich_mobile/providers/shared_space.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

class _MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

SharedSpaceResponseDto _space({required bool canAddMembers}) => SharedSpaceResponseDto(
  createdAt: '2026-01-01T00:00:00.000Z',
  createdById: 'owner',
  id: 'space-1',
  name: 'Space',
  updatedAt: '2026-01-01T00:00:00.000Z',
  memberManagement: Optional.present(
    SharedSpaceMemberManagementDto(
      canAddMembers: canAddMembers,
      canChangeRoles: false,
      editorsCanAddMembers: null,
      editorsCanChangeRoles: null,
      serverEditorsCanAddMembers: canAddMembers,
      serverEditorsCanChangeRoles: false,
    ),
  ),
);

void main() {
  late _MockSharedSpaceApiRepository repository;
  late ProviderContainer container;

  setUp(() {
    repository = _MockSharedSpaceApiRepository();
    container = ProviderContainer(overrides: [sharedSpaceApiRepositoryProvider.overrideWithValue(repository)]);
    addTearDown(container.dispose);
  });

  // The members page gates on the space's member-management permissions, which an admin or owner can change while
  // the app runs. Reopening the page must fetch them again rather than reuse what the first visit loaded.
  test('fetches the space again once nothing watches it any more', () async {
    var canAdd = false;
    when(() => repository.get('space-1')).thenAnswer((_) async => _space(canAddMembers: canAdd));

    final first = container.listen(sharedSpaceProvider('space-1'), (_, _) {});
    expect(
      canAddSpaceMembers(await container.read(sharedSpaceProvider('space-1').future), SharedSpaceRole.editor),
      isFalse,
    );
    first.close();
    await container.pump();

    canAdd = true;
    final second = container.listen(sharedSpaceProvider('space-1'), (_, _) {});
    addTearDown(second.close);
    expect(
      canAddSpaceMembers(await container.read(sharedSpaceProvider('space-1').future), SharedSpaceRole.editor),
      isTrue,
    );
    verify(() => repository.get('space-1')).called(2);
  });
}
