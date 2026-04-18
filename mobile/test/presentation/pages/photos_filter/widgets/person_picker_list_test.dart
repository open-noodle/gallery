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
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/person_picker_list.widget.dart';
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
    await StoreService.init(storeRepository: DriftStoreRepository(db));
    await Store.put(StoreKey.serverEndpoint, 'http://localhost:0');
  });
  tearDownAll(() async {
    await Store.clear();
    await db.close();
  });

  PersonDto person(String id, String name) => PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '');

  group('PersonPickerList', () {
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
      final people = <PersonDto>[];
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
