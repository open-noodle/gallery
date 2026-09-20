import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/data/server/person.dart';
import 'package:immich_mobile/data/store.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/providers/infrastructure/db.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

import '../../medium/repository_context.dart';

const _currentUserId = 'current-user';

class _MockPersonApi extends Mock implements PersonApiRepository {}

class _MockUserService extends Mock implements UserService {}

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service) {
    state = UserDto(id: _currentUserId, email: 'current@test.com', name: 'current', profileChangedAt: DateTime(2024));
  }
}

void main() {
  late MediumRepositoryContext ctx;
  late _MockPersonApi api;
  late ProviderContainer container;

  setUp(() {
    ctx = MediumRepositoryContext();
    api = _MockPersonApi();
    final userService = _MockUserService();
    when(() => userService.tryGetMyUser()).thenReturn(null);
    when(() => userService.watchMyUser()).thenAnswer((_) => const Stream.empty());
    container = ProviderContainer(
      overrides: [
        driftProvider.overrideWithValue(ctx.db),
        personApiRepositoryProvider.overrideWithValue(api),
        // No stored preferences: the default minimum face count applies
        Store.userMetadata.preferences().overrideWith((ref) => Stream.value(null)),
        currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(userService)),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(ctx.dispose);
  });

  Future<Person?> byId(String personId) => container.read(Store.people.byId(personId).future);

  test('forAsset reads the local sync DB for the viewer\'s own asset', () async {
    await ctx.newUser(id: _currentUserId);
    final asset = await ctx.newRemoteAsset(ownerId: _currentUserId);
    final person = await ctx.newPerson(ownerId: _currentUserId);
    await ctx.newFace(assetId: asset.id, personId: person.id);

    final people = await container.read(Store.people.forAsset((id: asset.id, ownerId: _currentUserId)).future);

    expect(people.map((p) => p.id), [person.id]);
    verifyNever(() => api.getAssetPeople(any()));
  });

  test('forAsset fetches from the server for an asset the viewer does not own', () async {
    when(() => api.getAssetPeople(any())).thenAnswer((_) async => [const Person(id: 'space-person', name: 'Alice')]);

    final people = await container.read(Store.people.forAsset((id: 'shared-asset', ownerId: 'other-user')).future);

    expect(people.map((p) => p.id), ['space-person']);
    verify(() => api.getAssetPeople('shared-asset')).called(1);
  });

  test('forAsset returns no people when the server fetch fails for a non-owned asset', () async {
    when(() => api.getAssetPeople(any())).thenThrow(Exception('network down'));

    final people = await container.read(Store.people.forAsset((id: 'shared-asset', ownerId: 'other-user')).future);

    expect(people, isEmpty);
  });

  test('all serves named people, hiding unnamed ones lacking the face count', () async {
    final user = await ctx.newUser();
    final asset = await ctx.newRemoteAsset(ownerId: user.id);
    final named = await ctx.newPerson(ownerId: user.id, name: 'Alice');
    final unnamed = await ctx.newPerson(ownerId: user.id, name: '');

    await ctx.newFace(assetId: asset.id, personId: named.id);
    await ctx.newFace(assetId: asset.id, personId: unnamed.id);

    final people = await container.read(Store.people.all().future);

    expect(people.map((p) => p.id), [named.id]);
  });

  // immich-31661's two forAsset reactivity tests are intentionally absent: Gallery's
  // forAsset is a FutureProvider, not a Drift stream, because for an asset the viewer
  // does not own it resolves people from the SERVER (issue #727) and that arm cannot be
  // a local stream. Renames refresh via the explicit ref.invalidate in people_details.

  test('updateName pushes to the server, then saves locally', () async {
    final user = await ctx.newUser();
    final person = await ctx.newPerson(ownerId: user.id, name: 'Old');

    when(() => api.update(person.id, name: 'New')).thenAnswer((_) async => Person(id: person.id, name: 'New'));

    await container.read(Store.people).updateName(person.id, 'New');

    verify(() => api.update(person.id, name: 'New')).called(1);
    expect((await byId(person.id))?.name, 'New');
  });

  test('updateName leaves the DB untouched when the server rejects', () async {
    final user = await ctx.newUser();
    final person = await ctx.newPerson(ownerId: user.id, name: 'Old');
    when(() => api.update(person.id, name: 'New')).thenThrow(Exception('rejected'));

    await expectLater(container.read(Store.people).updateName(person.id, 'New'), throwsException);

    expect((await byId(person.id))?.name, 'Old');
  });

  test('updateBirthday pushes to the server, then saves locally', () async {
    final user = await ctx.newUser();
    final person = await ctx.newPerson(ownerId: user.id);
    final birthday = DateTime.utc(1990, 4, 2);

    when(
      () => api.update(person.id, birthday: birthday),
    ).thenAnswer((_) async => Person(id: person.id, name: person.name, birthDate: birthday));

    await container.read(Store.people).updateBirthday(person.id, birthday);

    verify(() => api.update(person.id, birthday: birthday)).called(1);
    expect((await byId(person.id))?.birthDate, birthday);
  });
}
