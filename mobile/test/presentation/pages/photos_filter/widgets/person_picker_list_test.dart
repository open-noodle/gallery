import 'package:drift/drift.dart' as drift;
import 'package:drift/native.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/store.model.dart';
import 'package:immich_mobile/domain/services/store.service.dart';
import 'package:immich_mobile/entities/store.entity.dart';
import 'package:immich_mobile/infrastructure/repositories/db.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/store.repository.dart';
import 'package:immich_mobile/models/photos_filter/filter_person.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart';
import 'package:immich_mobile/presentation/widgets/images/remote_image_provider.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

/// Force a logical MediaQuery size by overriding the test view's physical size.
/// `tester.binding.setSurfaceSize` is a no-op under the current Flutter test
/// binding — MediaQuery stays at the 800×600 default regardless. Setting the
/// view's physical size directly (at fixed 3.0 dpr) is the working API.
void _setLogicalSize(WidgetTester tester, Size logical, {double dpr = 3.0}) {
  tester.view.devicePixelRatio = dpr;
  tester.view.physicalSize = Size(logical.width * dpr, logical.height * dpr);
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
}

void main() {
  late Drift db;
  setUpAll(() async {
    TestWidgetsFlutterBinding.ensureInitialized();
    db = Drift(drift.DatabaseConnection(NativeDatabase.memory(), closeStreamsSynchronously: true));
    await StoreService.init(storeRepository: StoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  FilterPerson person(String id, String name, {int? numberOfAssets, String? spaceId}) =>
      FilterPerson(id: id, name: name, numberOfAssets: numberOfAssets, spaceId: spaceId);

  RemoteImageProvider avatarProviderFor(WidgetTester tester, String rowKey) {
    final avatar = tester.widget<CircleAvatar>(
      find.descendant(of: find.byKey(Key(rowKey)), matching: find.byType(CircleAvatar)),
    );
    return avatar.backgroundImage! as RemoteImageProvider;
  }

  group('PersonPickerList', () {
    // A shared-space person's avatar must hit the membership-gated space thumbnail endpoint —
    // its tokenized id 404s the owner-only /people endpoint (the reported gray-circle bug).
    testWidgets('shared-space person avatar routes to the space thumbnail endpoint', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(
        PersonPickerList(people: [person('space-person:sp-1', 'Zoe', spaceId: 'space-1')]),
      );
      await tester.pumpAndSettle();
      expect(
        avatarProviderFor(tester, 'person-row-space-person:sp-1').url,
        'http://localhost:0/shared-spaces/space-1/people/sp-1/thumbnail',
      );
    });

    testWidgets('personal person avatar routes to the owner thumbnail endpoint', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('person:p-1', 'Alice')]));
      await tester.pumpAndSettle();
      expect(avatarProviderFor(tester, 'person-row-person:p-1').url, 'http://localhost:0/people/p-1/thumbnail');
    });

    testWidgets('shows a photo-count subtitle when numberOfAssets is present', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice', numberOfAssets: 1204)]));
      await tester.pumpAndSettle();
      final finder = find.byKey(const Key('person-row-count-a'));
      expect(finder, findsOneWidget);
      expect((tester.widget(finder) as Text).data, contains('1,204'));
    });

    testWidgets('hides the photo-count subtitle when numberOfAssets is null', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('person-row-count-a')), findsNothing);
    });

    testWidgets('renders rows and bucket headers alpha-sorted', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(
        PersonPickerList(people: [person('a', 'Alice'), person('b', 'Bob'), person('c', 'Carol')]),
      );
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('person-row-a')), findsOneWidget);
      expect(find.byKey(const Key('person-row-b')), findsOneWidget);
      expect(find.byKey(const Key('person-row-c')), findsOneWidget);
      expect(find.byKey(const Key('alpha-bucket-header-A')), findsOneWidget);
      expect(find.byKey(const Key('alpha-bucket-header-B')), findsOneWidget);
      expect(find.byKey(const Key('alpha-bucket-header-C')), findsOneWidget);
    });

    testWidgets('tapping a row toggles selection', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(PersonPickerList)));
      await tester.tap(find.byKey(const Key('person-row-a')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).people.single.id, 'a');

      await tester.tap(find.byKey(const Key('person-row-a')));
      await tester.pumpAndSettle();
      expect(container.read(photosFilterProvider).people, isEmpty);
    });

    testWidgets('scrubber tap jumps the list to the target bucket', (tester) async {
      // 500×800 viewport. A...M headers + rows fill well past the fold.
      _setLogicalSize(tester, const Size(500, 800));
      final people = <FilterPerson>[];
      for (final letter in ['A', 'B', 'C', 'M']) {
        for (var i = 0; i < 5; i++) {
          people.add(person('$letter-$i', '$letter${i}name'));
        }
      }
      await tester.pumpConsumerWidget(PersonPickerList(people: people));
      await tester.pumpAndSettle();

      // Tap the scrubber's M letter.
      await tester.tapAt(tester.getCenter(find.byKey(const Key('alpha-scrubber-M'))));
      await tester.pumpAndSettle();

      // Expect the M header to be in the viewport or near top.
      final headerRect = tester.getRect(find.byKey(const Key('alpha-bucket-header-M')));
      // Header is present and not below the viewport.
      expect(headerRect.top, lessThan(800));
      expect(headerRect.top, greaterThanOrEqualTo(0));
    });

    testWidgets('scrubber hidden when width < 480pt', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('alpha-scrubber-A')), findsNothing);
    });

    testWidgets('scrubber shown when width >= 480pt portrait', (tester) async {
      _setLogicalSize(tester, const Size(500, 900));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('alpha-scrubber-A')), findsOneWidget);
    });

    testWidgets('person row meets 44pt tap target', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidget(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      expectTapTargetMin(tester, find.byKey(const Key('person-row-a')), min: 44);
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      _setLogicalSize(tester, const Size(400, 800));
      await tester.pumpConsumerWidgetDark(PersonPickerList(people: [person('a', 'Alice')]));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('person-row-a')), findsOneWidget);
      expect(find.byKey(const Key('alpha-bucket-header-A')), findsOneWidget);
    });
  });
}
