import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';

class MockSharedSpaceApiRepository extends Mock implements SharedSpaceApiRepository {}

class MockUserService extends Mock implements UserService {}

// CurrentUserProvider's real constructor takes a UserService and immediately calls
// tryGetMyUser() + watchMyUser().listen(...) — so a fixed user is injected by
// stubbing the service, not by subclassing the notifier.
CurrentUserProvider _fixedUser(UserDto? user) {
  final service = MockUserService();
  when(() => service.tryGetMyUser()).thenReturn(user);
  when(() => service.watchMyUser()).thenAnswer((_) => const Stream.empty());
  return CurrentUserProvider(service);
}

UserDto _user(String id) => UserDto(id: id, email: 'u@example.com', name: 'U', profileChangedAt: DateTime(2024, 1, 1));

void main() {
  test('resolves the editor role from the shared-space repository', () async {
    final repo = MockSharedSpaceApiRepository();
    when(() => repo.isSpaceEditor('space-1', 'u1')).thenAnswer((_) async => true);
    final container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
        currentUserProvider.overrideWith((ref) => _fixedUser(_user('u1'))),
      ],
    );
    addTearDown(container.dispose);

    expect(await container.read(driftSpaceEditableProvider('space-1').future), isTrue);

    when(() => repo.isSpaceEditor('space-1', 'u1')).thenAnswer((_) async => false);
    container.invalidate(driftSpaceEditableProvider);
    expect(await container.read(driftSpaceEditableProvider('space-1').future), isFalse);
  });

  test('defaults to editable when no user is resolved', () async {
    final container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(MockSharedSpaceApiRepository()),
        currentUserProvider.overrideWith((ref) => _fixedUser(null)),
      ],
    );
    addTearDown(container.dispose);

    expect(await container.read(driftSpaceEditableProvider('space-1').future), isTrue);
  });
}
