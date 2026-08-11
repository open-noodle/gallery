import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/media_type_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/rating_stars_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/deep/toggles_section.widget.dart';
import 'package:immich_mobile/presentation/widgets/filter_sheet/filter_section_id.dart';
import 'package:immich_mobile/providers/photos_filter/collapsed_sections.provider.dart';
import '../../../../widget_tester_extensions.dart';

class _FakePrefs implements FilterSectionPrefs {
  Set<FilterSectionId> stored;
  _FakePrefs(this.stored);
  @override
  Set<FilterSectionId> loadCollapsed() => stored;
  @override
  Future<void> saveCollapsed(Set<FilterSectionId> ids) async => stored = ids;
}

Widget _host(Widget child) => localizedForTest(
  ProviderScope(
    overrides: [filterSectionPrefsProvider.overrideWithValue(_FakePrefs({}))],
    child: MaterialApp(
      localizationsDelegates: const [DefaultMaterialLocalizations.delegate, DefaultWidgetsLocalizations.delegate],
      home: Scaffold(body: ListView(children: [child])),
    ),
  ),
);

void main() {
  testWidgets('rating section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const RatingStarsSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-rating')), findsOneWidget);
  });
  testWidgets('media section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const MediaTypeSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-media')), findsOneWidget);
  });
  testWidgets('toggles section is wrapped in a collapsible header', (t) async {
    await t.pumpWidget(_host(const TogglesSection()));
    await t.pumpAndSettle();
    expect(find.byKey(const Key('collapsible-header-toggles')), findsOneWidget);
  });
}
