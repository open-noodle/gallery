import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/browse_content.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/camera_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/people_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/places_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/tags_strip.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/strips/when_strip.widget.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/hidden_sections.provider.dart';

import '../../../widget_tester_extensions.dart';

class _FakeVis implements FilterSectionVisibilityPrefs {
  Set<FilterSectionId> stored;
  _FakeVis(this.stored);
  @override
  Set<FilterSectionId> loadHidden() => stored;
  @override
  Future<void> saveHidden(Set<FilterSectionId> ids) async => stored = ids;
}

Future<void> _pump(WidgetTester tester, ScrollController controller, {Set<FilterSectionId> hidden = const {}}) async {
  await tester.binding.setSurfaceSize(const Size(400, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpConsumerWidget(
    BrowseContent(scrollController: controller),
    overrides: [
      photosFilterSheetProvider.overrideWith((ref) => FilterSheetSnap.browse),
      filterSectionVisibilityPrefsProvider.overrideWithValue(_FakeVis(hidden)),
    ],
  );
  await tester.pumpAndSettle();
}

void main() {
  group('BrowseContent', () {
    testWidgets('"More filters" button sets snap to deep', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      // Tall viewport so the bottom "More filters" button renders inside the
      // ListView's build window.
      await _pump(tester, controller);
      final container = ProviderScope.containerOf(tester.element(find.byType(BrowseContent)));
      container.read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.browse;
      await tester.pumpAndSettle();

      await tester.tap(find.byKey(const Key('browse-see-all')));
      await tester.pumpAndSettle();

      expect(container.read(photosFilterSheetProvider), FilterSheetSnap.deep);
    });

    testWidgets('with nothing hidden, all five strips render', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await _pump(tester, controller);

      expect(find.byType(PeopleStrip), findsOneWidget);
      expect(find.byType(PlacesStrip), findsOneWidget);
      expect(find.byType(TagsStrip), findsOneWidget);
      expect(find.byType(CameraStrip), findsOneWidget);
      expect(find.byType(WhenStrip), findsOneWidget);
    });

    // #1002: sections hidden via "Manage sections" (Deep) must stay hidden when
    // the sheet collapses to Browse, not silently reappear as unfiltered strips.
    testWidgets('sections hidden via Manage sections stay hidden in Browse', (tester) async {
      final controller = ScrollController();
      addTearDown(controller.dispose);
      await _pump(tester, controller, hidden: {FilterSectionId.people, FilterSectionId.places});

      expect(find.byType(PeopleStrip), findsNothing);
      expect(find.byType(PlacesStrip), findsNothing);
      expect(find.byType(TagsStrip), findsOneWidget);
      expect(find.byType(CameraStrip), findsOneWidget);
      expect(find.byType(WhenStrip), findsOneWidget);
    });
  });
}
