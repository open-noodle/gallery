import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/person.model.dart';
import 'package:immich_mobile/presentation/pages/photos_filter/widgets/selected_people_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/photos_filter.provider.dart';

import '../../../../widget_tester_extensions.dart';

PersonDto _p(String id, String name) => PersonDto(id: id, name: name, isHidden: false, thumbnailPath: '');

void main() {
  group('SelectedPeopleStrip', () {
    testWidgets('hidden when no selections', (tester) async {
      // Wrap in a Column so SizedBox.shrink() gets loose constraints and
      // actually renders at Size.zero. Material's default child slot in
      // pumpConsumerWidget forces tight screen-sized constraints onto the
      // child, which would mask the shrink-to-zero layout.
      await tester.pumpConsumerWidget(const Column(children: [SelectedPeopleStrip()]));
      expect(find.byType(InputChip), findsNothing);
      expect(tester.getSize(find.byType(SelectedPeopleStrip)), Size.zero);
    });

    testWidgets('renders one chip per selected person', (tester) async {
      await tester.pumpConsumerWidget(const SelectedPeopleStrip());
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedPeopleStrip)));
      container.read(photosFilterProvider.notifier).togglePerson(_p('a', 'Alice'));
      container.read(photosFilterProvider.notifier).togglePerson(_p('b', 'Bob'));
      container.read(photosFilterProvider.notifier).togglePerson(_p('c', 'Carol'));
      await tester.pumpAndSettle();

      expect(find.byType(InputChip), findsNWidgets(3));
      expect(find.byKey(const Key('selected-chip-a')), findsOneWidget);
      expect(find.byKey(const Key('selected-chip-b')), findsOneWidget);
      expect(find.byKey(const Key('selected-chip-c')), findsOneWidget);
    });

    testWidgets('tapping x removes that person from photosFilterProvider.people', (tester) async {
      await tester.pumpConsumerWidget(const SelectedPeopleStrip());
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedPeopleStrip)));
      final alice = _p('a', 'Alice');
      final bob = _p('b', 'Bob');
      container.read(photosFilterProvider.notifier).togglePerson(alice);
      container.read(photosFilterProvider.notifier).togglePerson(bob);
      await tester.pumpAndSettle();

      // Find Alice's chip and tap its delete icon.
      final aliceChip = find.byKey(const Key('selected-chip-a'));
      final deleteIcon = find.descendant(of: aliceChip, matching: find.byIcon(Icons.close_rounded));
      expect(deleteIcon, findsOneWidget);
      await tester.tap(deleteIcon);
      await tester.pumpAndSettle();

      final remaining = container.read(photosFilterProvider).people;
      expect(remaining, hasLength(1));
      expect(remaining.single.id, 'b');
    });

    testWidgets('renders correctly in dark theme', (tester) async {
      await tester.pumpConsumerWidgetDark(const SelectedPeopleStrip());
      final container = ProviderScope.containerOf(tester.element(find.byType(SelectedPeopleStrip)));
      container.read(photosFilterProvider.notifier).togglePerson(_p('a', 'Alice'));
      await tester.pumpAndSettle();
      expect(find.byType(InputChip), findsOneWidget);
    });
  });
}
