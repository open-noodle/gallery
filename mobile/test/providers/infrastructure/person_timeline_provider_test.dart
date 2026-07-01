import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/models/user.model.dart';
import 'package:immich_mobile/domain/services/people.service.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/domain/services/user.service.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';
import 'package:immich_mobile/providers/infrastructure/person_timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/infrastructure/user.provider.dart' as infra;
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:mocktail/mocktail.dart';

class _MockFactory extends Mock implements TimelineFactory {}

class _MockPeopleService extends Mock implements DriftPeopleService {}

class _MockUserService extends Mock implements UserService {}

class _FakeService extends Fake implements TimelineService {
  @override
  TimelineOrigin get origin => TimelineOrigin.person;
  @override
  Future<void> dispose() async {}
}

UserDto _user(String id) => UserDto(id: id, email: '$id@example.com', name: id, profileChangedAt: DateTime(2024, 1, 1));

class _StubCurrentUserNotifier extends CurrentUserProvider {
  _StubCurrentUserNotifier(super.service, UserDto? initial) {
    state = initial;
  }
}

DriftPerson _person(String id, {String? spaceId}) => DriftPerson(
  id: id,
  createdAt: DateTime(2020),
  updatedAt: DateTime(2020),
  ownerId: 'owner',
  name: 'Alice',
  isFavorite: false,
  isHidden: false,
  color: null,
  spaceId: spaceId,
);

ProviderContainer _container({
  required TimelineFactory factory,
  required DriftPeopleService peopleService,
  UserDto? user,
}) {
  final mockUserSvc = _MockUserService();
  when(() => mockUserSvc.tryGetMyUser()).thenReturn(user);
  when(() => mockUserSvc.watchMyUser()).thenAnswer((_) => const Stream<UserDto?>.empty());

  return ProviderContainer(
    overrides: [
      timelineFactoryProvider.overrideWithValue(factory),
      driftPeopleServiceProvider.overrideWithValue(peopleService),
      infra.userServiceProvider.overrideWithValue(mockUserSvc),
      currentUserProvider.overrideWith((ref) => _StubCurrentUserNotifier(mockUserSvc, user)),
    ],
  );
}

void main() {
  setUpAll(() {
    registerFallbackValue(GroupAssetsBy.day);
    registerFallbackValue(const TimelineTemporalScope.none());
  });

  const scope = TimelineTemporalScope.none();

  group('buildPersonTimelineRouteService', () {
    test('personal person (null spaceId) → owner-scoped factory.person', () {
      final factory = _MockFactory();
      final people = _MockPeopleService();
      final fake = _FakeService();
      when(
        () => factory.person(
          any(),
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, peopleService: people, user: _user('u1'));
      addTearDown(container.dispose);
      final route = ProviderContainer(
        parent: container,
        overrides: [
          timelineServiceProvider.overrideWith(
            (ref) => buildPersonTimelineRouteService(ref, _person('p1'), scope, GroupAssetsBy.day),
          ),
        ],
      );
      addTearDown(route.dispose);

      final svc = route.read(timelineServiceProvider);
      expect(svc, same(fake));
      verify(() => factory.person('u1', 'p1', groupBy: GroupAssetsBy.day, temporalScope: scope)).called(1);
      verifyNever(
        () => factory.sharedSpacePerson(
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      );
    });

    test('Space person (non-null spaceId) → factory.sharedSpacePerson with the server-resolved asset ids', () async {
      final factory = _MockFactory();
      final people = _MockPeopleService();
      final fake = _FakeService();
      when(() => people.getSharedSpacePersonAssetIds('space-1', 'sp1')).thenAnswer((_) async => ['a1', 'a2']);
      when(
        () => factory.sharedSpacePerson(
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, peopleService: people, user: _user('u1'));
      addTearDown(container.dispose);
      // Resolve the server fetch before the timeline builder reads it.
      await container.read(driftSharedSpacePersonAssetIdsProvider((spaceId: 'space-1', personId: 'sp1')).future);

      final route = ProviderContainer(
        parent: container,
        overrides: [
          timelineServiceProvider.overrideWith(
            (ref) => buildPersonTimelineRouteService(ref, _person('sp1', spaceId: 'space-1'), scope, GroupAssetsBy.day),
          ),
        ],
      );
      addTearDown(route.dispose);

      final svc = route.read(timelineServiceProvider);
      expect(svc, same(fake));
      verify(() => factory.sharedSpacePerson(['a1', 'a2'], groupBy: GroupAssetsBy.day, temporalScope: scope)).called(1);
      // A Space person must never fall through to the owner-scoped query (the "0 items" bug).
      verifyNever(
        () => factory.person(
          any(),
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      );
    });

    test('Space person still routes to sharedSpacePerson (empty) while the ids are loading', () {
      final factory = _MockFactory();
      final people = _MockPeopleService();
      final fake = _FakeService();
      // Never completes within the test: the builder must not block or fall back to person().
      when(() => people.getSharedSpacePersonAssetIds(any(), any())).thenAnswer((_) => Completer<List<String>>().future);
      when(
        () => factory.sharedSpacePerson(
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      ).thenReturn(fake);

      final container = _container(factory: factory, peopleService: people, user: _user('u1'));
      addTearDown(container.dispose);
      final route = ProviderContainer(
        parent: container,
        overrides: [
          timelineServiceProvider.overrideWith(
            (ref) => buildPersonTimelineRouteService(ref, _person('sp1', spaceId: 'space-1'), scope, GroupAssetsBy.day),
          ),
        ],
      );
      addTearDown(route.dispose);

      final svc = route.read(timelineServiceProvider);
      expect(svc, same(fake));
      verify(() => factory.sharedSpacePerson(const [], groupBy: GroupAssetsBy.day, temporalScope: scope)).called(1);
      verifyNever(
        () => factory.person(
          any(),
          any(),
          groupBy: any(named: 'groupBy'),
          temporalScope: any(named: 'temporalScope'),
        ),
      );
    });
  });
}
