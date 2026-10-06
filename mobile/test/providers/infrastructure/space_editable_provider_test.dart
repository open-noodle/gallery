import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/repositories/shared_space_api.repository.dart';
import 'package:mocktail/mocktail.dart';
import 'package:openapi/api.dart';

import '../../fixtures/shared_space.stub.dart';

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

// SharedSpaceStub.spaceWithMembers is 'space-3': user-1 owner (and creator), user-2 editor,
// user-3 viewer.
void main() {
  late MockSharedSpaceApiRepository repo;

  setUp(() {
    repo = MockSharedSpaceApiRepository();
    when(() => repo.getAll()).thenAnswer((_) async => [SharedSpaceStub.spaceWithMembers]);
  });

  ProviderContainer containerFor(UserDto? user) {
    final container = ProviderContainer(
      overrides: [
        sharedSpaceApiRepositoryProvider.overrideWithValue(repo),
        currentUserProvider.overrideWith((ref) => _fixedUser(user)),
      ],
    );
    addTearDown(container.dispose);
    return container;
  }

  test('owners and editors may edit, read from the spaces list without fetching members', () async {
    expect(await containerFor(_user('user-1')).read(driftSpaceEditableProvider('space-3').future), isTrue);
    expect(await containerFor(_user('user-2')).read(driftSpaceEditableProvider('space-3').future), isTrue);

    verifyNever(() => repo.getMembers(any()));
  });

  test('viewers are read-only', () async {
    expect(await containerFor(_user('user-3')).read(driftSpaceEditableProvider('space-3').future), isFalse);
  });

  test('a space missing from the list, or no resolved user, fails open', () async {
    expect(await containerFor(_user('user-3')).read(driftSpaceEditableProvider('space-unknown').future), isTrue);
    expect(await containerFor(null).read(driftSpaceEditableProvider('space-3').future), isTrue);
  });

  test('a failed spaces list fails open instead of erroring', () async {
    when(() => repo.getAll()).thenThrow(Exception('offline'));

    expect(await containerFor(_user('user-3')).read(driftSpaceEditableProvider('space-3').future), isTrue);
  });

  test('has no value while the spaces list loads, then resolves a viewer to read-only', () async {
    final spaces = Completer<List<SharedSpaceResponseDto>>();
    when(() => repo.getAll()).thenAnswer((_) => spaces.future);
    final container = containerFor(_user('user-3'));

    // Callers read `.valueOrNull ?? true`, so the loading state keeps the edit affordances.
    expect(container.read(driftSpaceEditableProvider('space-3')).valueOrNull, isNull);

    spaces.complete([SharedSpaceStub.spaceWithMembers]);
    expect(await container.read(driftSpaceEditableProvider('space-3').future), isFalse);
  });
}
