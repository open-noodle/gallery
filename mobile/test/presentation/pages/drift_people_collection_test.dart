import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/generated/translations.g.dart';
import 'package:immich_mobile/infrastructure/repositories/settings.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/presentation/pages/drift_people_collection.page.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../test_utils.dart';
import '../../widget_tester_extensions.dart';

Person _person(String id, String name, {String? spaceId}) =>
    Person(id: id, updatedAt: DateTime(2024, 1, 1), name: name, spaceId: spaceId);

void main() {
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db), listenUpdates: false);
    await SettingsRepository.ensureInitialized(db);
  });

  setUp(() async {
    await Store.clear();
    await SettingsRepository.instance.clear(SettingsKey.values);
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  // .first: PeopleGrid puts ValueKey(person.id) on BOTH the tile's outer Column and its
  // CircleAvatar (people_grid.widget.dart), so byKey matches two widgets.
  double dxOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dx;
  double dyOf(WidgetTester tester, String personId) => tester.getTopLeft(find.byKey(ValueKey(personId)).first).dy;

  bool isBefore(WidgetTester tester, String a, String b) {
    final dyA = dyOf(tester, a);
    final dyB = dyOf(tester, b);
    if (dyA != dyB) {
      return dyA < dyB;
    }
    return dxOf(tester, a) < dxOf(tester, b);
  }

  group('DriftPeopleCollectionPage', () {
    testWidgets('renders the sort-keyed provider order and re-queries when the setting changes', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => sortBy == PeopleSortBy.photoCount
                ? [_person('zoe', 'Zoe'), _person('alice', 'Alice')]
                : [_person('alice', 'Alice'), _person('zoe', 'Zoe')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'zoe', 'alice'), isTrue);

      await tester.tap(find.byKey(const Key('people-sort-button')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const Key('people-sort-name')));
      await tester.pumpAndSettle();

      expect(isBefore(tester, 'alice', 'zoe'), isTrue);
      expect(SettingsRepository.instance.appConfig.people.sortBy, PeopleSortBy.name);
    });

    testWidgets('the in-page search filter preserves the provider order', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('zo', 'Zora'), _person('al', 'Alora'), _person('bo', 'Bob')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      await tester.tap(find.byIcon(Icons.search));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), 'ora');
      await tester.pumpAndSettle();

      expect(find.byKey(const ValueKey('bo')), findsNothing);
      expect(find.byKey(const ValueKey('zo')), findsWidgets);
      expect(isBefore(tester, 'zo', 'al'), isTrue);
    });

    // The page lists non-owned shared-space people; the rename affordance must be gated to
    // owner-or-space-editor exactly like the web People page (issue #727 sibling). A personal
    // person (null spaceId) and a space person the viewer can edit both show "add a name" for
    // an empty name; a viewer-only space person shows a read-only name and no add-a-name.
    testWidgets('shows the add-a-name affordance for an editable space person', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('sp', '', spaceId: 'space-1')],
          ),
          driftSpaceEditableProvider.overrideWith((ref, spaceId) async => true),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text(StaticTranslations.instance.add_a_name), findsOneWidget);
    });

    testWidgets('hides the add-a-name affordance for a viewer-only space person', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('sp', '', spaceId: 'space-1')],
          ),
          driftSpaceEditableProvider.overrideWith((ref, spaceId) async => false),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text(StaticTranslations.instance.add_a_name), findsNothing);
    });

    testWidgets('still renders a viewer-only space person\'s name read-only', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('sp', 'Shared Sam', spaceId: 'space-1')],
          ),
          driftSpaceEditableProvider.overrideWith((ref, spaceId) async => false),
        ],
      );
      await tester.pumpAndSettle();

      expect(find.text('Shared Sam'), findsOneWidget);
    });

    // A space-only person's id is a shared_space_person id with no row in the owner-only
    // person table, so its avatar must resolve via the membership-gated space thumbnail
    // endpoint (not /people/{id}/thumbnail, which 404s), matching the web People page.
    String? avatarUrl(WidgetTester tester, String personId) {
      final avatar = tester.widget<CircleAvatar>(
        find.byWidgetPredicate((w) => w is CircleAvatar && w.key == ValueKey(personId)),
      );
      final provider = avatar.backgroundImage;
      return provider is RemoteImageProvider ? provider.url : null;
    }

    testWidgets('builds a space person\'s avatar from the space thumbnail endpoint', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('sp', 'Shared Sam', spaceId: 'space-1')],
          ),
          driftSpaceEditableProvider.overrideWith((ref, spaceId) async => true),
        ],
      );
      await tester.pumpAndSettle();

      // `?c=<ms>` is upstream #29350's cache-buster, threaded through the fork's space-scoped
      // helper too; assert it is present so it cannot silently regress.
      expect(avatarUrl(tester, 'sp'), contains('/shared-spaces/space-1/people/sp/thumbnail?c='));
    });

    testWidgets('builds a personal person\'s avatar from the owner thumbnail endpoint', (tester) async {
      await tester.pumpConsumerWidget(
        const DriftPeopleCollectionPage(),
        overrides: [
          driftGetAllPeopleWithSharedSpacesProvider.overrideWith(
            (ref, sortBy) async => [_person('me', 'Personal Pat')],
          ),
        ],
      );
      await tester.pumpAndSettle();

      expect(avatarUrl(tester, 'me'), contains('/people/me/thumbnail?c='));
    });
  });
}
