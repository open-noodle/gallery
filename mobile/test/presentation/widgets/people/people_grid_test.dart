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
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/presentation/widgets/people/people_grid.widget.dart';
import 'package:immich_mobile/providers/infrastructure/people.provider.dart';

import '../../../test_utils.dart';
import '../../../widget_tester_extensions.dart';

DriftPerson _p(String id, String name, {String? spaceId, bool isHidden = false}) => DriftPerson(
  id: id,
  createdAt: DateTime(2024, 1, 1),
  updatedAt: DateTime(2024, 1, 1),
  ownerId: 'owner',
  name: name,
  isFavorite: false,
  isHidden: isHidden,
  color: null,
  spaceId: spaceId,
);

void main() {
  // getPersonThumbnailUrl reads Store.get(StoreKey.serverEndpoint), which throws unless the
  // Store is initialized — TestUtils.init() alone is not enough for anything that renders an
  // avatar. Mirrors the setup in drift_people_collection_test.dart.
  late Drift db;

  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    TestUtils.init();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: DriftStoreRepository(db), listenUpdates: false);
  });

  setUp(() async {
    await Store.clear();
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });

  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  Future<void> pumpGrid(
    WidgetTester tester,
    List<DriftPerson> people, {
    required PeopleEditPolicy policy,
    void Function(DriftPerson)? onTap,
    List<Override> overrides = const [],
  }) => tester.pumpConsumerWidget(
    PeopleGrid(people: people, editPolicy: policy, onPersonTap: onTap ?? (_) {}),
    overrides: overrides,
  );

  group('PeopleGrid with FixedEditability(true)', () {
    testWidgets('renders a tappable name for a named person', (tester) async {
      await pumpGrid(tester, [_p('sp1', 'Mia', spaceId: 'space-1')], policy: const FixedEditability(true));

      expect(find.text('Mia'), findsOneWidget);
      expect(find.byKey(const Key('person-name-editable-sp1')), findsOneWidget);
    });

    testWidgets('offers "Add a name" for an unnamed person', (tester) async {
      await pumpGrid(tester, [_p('sp1', '', spaceId: 'space-1')], policy: const FixedEditability(true));

      expect(find.text('Add a name'), findsOneWidget);
    });
  });

  group('PeopleGrid with FixedEditability(false)', () {
    testWidgets('renders a plain, non-tappable name', (tester) async {
      await pumpGrid(tester, [_p('sp1', 'Mia', spaceId: 'space-1')], policy: const FixedEditability(false));

      expect(find.text('Mia'), findsOneWidget);
      expect(find.byKey(const Key('person-name-editable-sp1')), findsNothing);
    });

    testWidgets('offers no "Add a name" affordance for an unnamed person', (tester) async {
      await pumpGrid(tester, [_p('sp1', '', spaceId: 'space-1')], policy: const FixedEditability(false));

      expect(find.text('Add a name'), findsNothing);
      // Positive anchor: the tile itself renders — "Add a name" is absent because the
      // affordance is gated, not because nothing rendered at all.
      expect(find.byKey(const ValueKey('sp1')), findsWidgets);
    });
  });

  group('PeopleGrid with PerPersonSpaceRole', () {
    // This is the reactive path the sealed-class design exists for: the global People page
    // resolves editability per person from driftSpaceEditableProvider, not from a fixed flag.
    testWidgets('renders a plain, non-tappable name when the space resolves as read-only', (tester) async {
      await pumpGrid(
        tester,
        [_p('sp1', 'Mia', spaceId: 'space-1')],
        policy: const PerPersonSpaceRole(),
        overrides: [driftSpaceEditableProvider.overrideWith((ref, spaceId) async => false)],
      );

      expect(find.text('Mia'), findsOneWidget);
      expect(find.byKey(const Key('person-name-editable-sp1')), findsNothing);
    });

    testWidgets('a personal person (null spaceId) is always editable, without any provider override', (tester) async {
      await pumpGrid(tester, [_p('me', 'Personal Pat')], policy: const PerPersonSpaceRole());

      expect(find.text('Personal Pat'), findsOneWidget);
      expect(find.byKey(const Key('person-name-editable-me')), findsOneWidget);
    });
  });

  testWidgets('does not render a hidden person', (tester) async {
    await pumpGrid(tester, [
      _p('visible', 'Mia', spaceId: 'space-1'),
      _p('hidden', 'Ghost', spaceId: 'space-1', isHidden: true),
    ], policy: const FixedEditability(true));

    expect(find.text('Mia'), findsOneWidget);
    expect(find.text('Ghost'), findsNothing);
    // Positive anchor: prove the hidden person's whole tile is gone, not just its name label.
    expect(find.byWidgetPredicate((w) => w is CircleAvatar && w.key == const ValueKey('hidden')), findsNothing);
  });

  testWidgets('renders a whitespace-only name as a blank label, not "Add a name"', (tester) async {
    // Pre-existing behaviour carried over verbatim from the global People page: the empty
    // check does not trim, while the comparator does. Asserted so it reads as intended.
    await pumpGrid(tester, [_p('sp1', ' ', spaceId: 'space-1')], policy: const FixedEditability(true));

    expect(find.text('Add a name'), findsNothing);
    expect(find.text(' '), findsOneWidget);
  });

  testWidgets('invokes onPersonTap with the space-scoped person', (tester) async {
    DriftPerson? tapped;
    await pumpGrid(
      tester,
      [_p('sp1', 'Mia', spaceId: 'space-1')],
      policy: const FixedEditability(true),
      onTap: (person) => tapped = person,
    );

    // The avatar keeps ValueKey(person.id) (see the widget), which the tile Column also
    // carries — resolve the CircleAvatar specifically, the same way
    // drift_people_collection_test.dart does.
    await tester.tap(find.byWidgetPredicate((w) => w is CircleAvatar && w.key == const ValueKey('sp1')));
    await tester.pumpAndSettle();

    expect(tapped?.id, 'sp1');
    expect(tapped?.spaceId, 'space-1');
  });

  testWidgets('builds a space person avatar from the space thumbnail endpoint', (tester) async {
    await pumpGrid(tester, [_p('sp1', 'Mia', spaceId: 'space-1')], policy: const FixedEditability(true));

    final avatar = tester.widget<CircleAvatar>(
      find.byWidgetPredicate((w) => w is CircleAvatar && w.key == const ValueKey('sp1')),
    );
    final provider = avatar.backgroundImage;

    // A space person's id has no row in the owner-only person table, so /people/{id}/thumbnail
    // would 404 — it must route to the membership-gated space endpoint. The `?c=` suffix is the
    // fork's cache-buster: getPersonThumbnailUrl takes the person's updatedAt so a re-assigned
    // face thumbnail is not served from a stale cache. Derived from _p's own date rather than
    // hardcoded, so the two cannot drift apart.
    final cacheBuster = DateTime(2024, 1, 1).millisecondsSinceEpoch;
    expect(
      provider is RemoteImageProvider ? provider.url : null,
      'http://localhost:0/shared-spaces/space-1/people/sp1/thumbnail?c=$cacheBuster',
    );
  });
}
