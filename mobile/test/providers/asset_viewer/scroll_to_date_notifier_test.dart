import 'package:flutter_test/flutter_test.dart';
import 'package:immich_mobile/providers/asset_viewer/scroll_to_date_notifier.provider.dart';

void main() {
  group('ScrollToDateNotifier', () {
    test('starts with no pending date', () {
      final notifier = ScrollToDateNotifier(null);

      expect(notifier.value, isNull);
      expect(notifier.consume(), isNull);
    });

    test('latches the requested date until a consumer is ready for it', () {
      // This is the race a broadcast event loses: the "view in timeline" request
      // is made (e.g. from a memory or a notification) *before* the timeline is
      // mounted and subscribed. The latch must keep the date so the timeline can
      // drain it once it is ready.
      final notifier = ScrollToDateNotifier(null);
      final date = DateTime(2026, 5, 30);

      notifier.scrollToDate(date);

      expect(notifier.consume(), date);
    });

    test('applies the pending date at most once', () {
      final notifier = ScrollToDateNotifier(null);
      notifier.scrollToDate(DateTime(2026, 5, 30));

      expect(notifier.consume(), DateTime(2026, 5, 30));
      // A rebuild / second drain must not re-trigger the scroll.
      expect(notifier.consume(), isNull);
    });

    test('notifies listeners on every request, even for the same date', () {
      // Tapping "view in timeline" twice for the same month must re-trigger the
      // scroll, so requesting an unchanged date still has to notify.
      final notifier = ScrollToDateNotifier(null);
      var notifications = 0;
      notifier.addListener(() => notifications++);

      final date = DateTime(2026, 5, 30);
      notifier.scrollToDate(date);
      notifier.scrollToDate(date);

      expect(notifications, greaterThanOrEqualTo(2));
    });
  });
}
