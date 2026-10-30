import 'package:flutter_test/flutter_test.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/cleanup/pages/cleanup_day_photos.page.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';

// "Show that day" (specs/2026-10-29-mobile-library-cleanup-design.md, "Details sheet" → "Links") opens the fork's search
// results filtered to the photo's date.
//
//   Given a screen's own search, closed     When the day search starts for 15 August 2022 at 09:00
//                                           Then search mode is on and the date filter is that one day, whole

void main() {
  test('the day search opens search mode filtered to that one day', () {
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect(container.read(searchModeProvider), isFalse);

    libraryCleanupSearchDay(
      container.read(searchModeProvider.notifier),
      container.read(searchStateProvider.notifier),
      DateTime.utc(2022, 8, 15, 9),
    );

    expect(container.read(searchModeProvider), isTrue);
    final date = container.read(searchStateProvider).filters.date;
    expect(date, SearchDate.custom(from: DateTime(2022, 8, 15), to: DateTime(2022, 8, 15)));
  });
}
