import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart' show searchCapabilitiesProvider;
import 'package:immich_mobile/gallery/search/search_options.model.dart';

// Search mode on a timeline screen (specs/2026-10-23-mobile-search-redesign-design.md, "Entering and leaving search
// mode"). The root instance is the Photos screen's, so the bottom nav and the memory lane can read it; other screens
// get their own through TimelineRouteScope's `search:` argument (searchTimelineScopeOverrides).

/// Whether the screen is in search mode. Leaving clears every filter and the query (see leaveSearchMode).
class SearchModeNotifier extends Notifier<bool> {
  /// The timeline's scroll offset when search mode opened, restored on leaving.
  double? savedScrollOffset;

  /// The unfiltered availability of this session's scope (#910's "empty for the whole scope"; see
  /// searchScopeAvailability).
  SearchAvailability? scopeAvailability;

  /// Whether [scopeAvailability] came from a stale server answer: the options notifier asks for it again until fresh.
  bool scopeAvailabilityStale = false;

  bool _entrancePending = false;

  @override
  bool build() => false;

  /// True once per opening: the search header plays its entrance the first time it is built after [enter], and not
  /// again when the timeline rebuilds it while search mode stays open.
  bool claimEntrance() {
    final pending = _entrancePending;
    _entrancePending = false;
    return pending;
  }

  void enter() {
    if (state) {
      return;
    }
    savedScrollOffset = null;
    scopeAvailability = null;
    scopeAvailabilityStale = false;
    _entrancePending = true;
    // What the server can do is read again for each opening: it may be another server, or upgraded, since last time.
    ref.invalidate(searchCapabilitiesProvider);
    state = true;
  }

  /// Records the offset to come back to; only the first call of a session counts.
  void rememberScrollOffset(double offset) => savedScrollOffset ??= offset;

  void leave() {
    state = false;
  }
}

final searchModeProvider = NotifierProvider<SearchModeNotifier, bool>(SearchModeNotifier.new, dependencies: const []);

/// Whether this timeline route has a search (TimelineRouteScope's `search:`). A timeline without one never shows the
/// search header, even while Photos is in search mode underneath a route pushed from its results.
final timelineHasSearchProvider = Provider<bool>((ref) => false, dependencies: const []);

/// Jumps [controller] back to [offset] once the restored timeline is laid out far enough to hold it. The normal
/// timeline is rebuilt on leaving (its data source comes back), so its extent grows over a few frames.
void restoreScrollOffset(ScrollController controller, double offset, {int attempts = 120}) {
  void attempt(int left) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!controller.hasClients) {
        if (left > 0) {
          attempt(left - 1);
        }
        return;
      }
      final position = controller.positions.last;
      if (position.maxScrollExtent >= offset || left == 0) {
        controller.jumpTo(offset.clamp(0.0, position.maxScrollExtent));
        return;
      }
      attempt(left - 1);
    });
    WidgetsBinding.instance.scheduleFrame();
  }

  attempt(attempts);
}
