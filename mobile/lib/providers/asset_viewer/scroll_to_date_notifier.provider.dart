import 'package:flutter/material.dart';

final scrollToDateNotifierProvider = ScrollToDateNotifier(null);

/// Holds a pending request to scroll the timeline to a given date.
///
/// Unlike a fire-and-forget broadcast event, the requested date is latched here
/// until a timeline is ready to act on it. This survives the window between
/// requesting the scroll (e.g. tapping "view in timeline" from a memory or a
/// notification) and the timeline mounting and loading its segments. The
/// timeline drains the request with [consume] once it can scroll.
class ScrollToDateNotifier extends ValueNotifier<DateTime?> {
  ScrollToDateNotifier(super.value);

  /// Requests a scroll to [date]. Always notifies listeners, even when the same
  /// date is requested twice in a row, so repeated "view in timeline" taps to
  /// the same month re-trigger the scroll.
  void scrollToDate(DateTime date) {
    if (value == date) {
      notifyListeners();
    } else {
      value = date;
    }
  }

  /// Returns the pending date (or null) and clears the latch so the request is
  /// applied at most once.
  DateTime? consume() {
    final pending = value;
    value = null;
    return pending;
  }
}
