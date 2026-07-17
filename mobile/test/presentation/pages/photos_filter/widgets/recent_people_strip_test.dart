import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/recent_people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/people_picker.provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  PersonDto person(String id, String name, {String? spaceId}) =>
      PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '', spaceId: spaceId);

  group('RecentPeopleStrip', () {
    // Same routing as the picker rows: a recent shared-space person must hit the space endpoint.
    testWidgets('shared-space recent avatar routes to the space thumbnail endpoint', (tester) async {
      await tester.pumpConsumerWidget(
        const RecentPeopleStrip(),
        overrides: [
          recentPeopleProvider.overrideWith((ref) async => [person('space-person:sp-1', 'Zoe', spaceId: 'space-1')]),
        ],
      );
      await tester.pumpAndSettle();
      final avatar = tester.widget<CircleAvatar>(
        find.descendant(
          of: find.byKey(const Key('recent-person-space-person:sp-1')),
          matching: find.byType(CircleAvatar),
        ),
      );
      expect(
        (avatar.backgroundImage! as RemoteImageProvider).url,
        'http://localhost:0/shared-spaces/space-1/people/sp-1/thumbnail',
      );
    });

    testWidgets('renders one tile per recent person with stable key', (tester) async {
      await tester.pumpConsumerWidget(
        const RecentPeopleStrip(),
        overrides: [
          recentPeopleProvider.overrideWith(
            (ref) async => [person('a', 'Alice'), person('b', 'Bob'), person('c', 'Carol')],
          ),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('recent-person-a')), findsOneWidget);
      expect(find.byKey(const Key('recent-person-b')), findsOneWidget);
      expect(find.byKey(const Key('recent-person-c')), findsOneWidget);
    });

    testWidgets('hidden when no recents', (tester) async {
      await tester.pumpConsumerWidget(
        const Column(children: [RecentPeopleStrip()]),
        overrides: [recentPeopleProvider.overrideWith((ref) async => const <PersonDto>[])],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('recent-person-a')), findsNothing);
      expect(tester.getSize(find.byType(RecentPeopleStrip)), Size.zero);
    });

    testWidgets('tapping a recent avatar toggles selection', (tester) async {
      await tester.pumpConsumerWidget(
        const RecentPeopleStrip(),
        overrides: [
          recentPeopleProvider.overrideWith((ref) async => [person('a', 'Alice')]),
        ],
      );
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(RecentPeopleStrip)));
      await tester.tap(find.byKey(const Key('recent-person-a')));
      await tester.pumpAndSettle();

      final selected = container.read(photosFilterProvider).people;
      expect(selected, hasLength(1));
      expect(selected.single.id, 'a');

      // Second tap removes.
      await tester.tap(find.byKey(const Key('recent-person-a')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).people, isEmpty);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(
        const RecentPeopleStrip(),
        overrides: [
          recentPeopleProvider.overrideWith((ref) async => [person('a', 'Alice')]),
        ],
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('recent-person-a')), findsOneWidget);
    });
  });
}
