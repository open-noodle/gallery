import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/domain/models/settings_key.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_grouping.model.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

/// The active zoom level of the Years / Months / All selector.
///
/// View state only: it always starts at "All" and is never written to
/// [SettingsKey.timelineGroupAssetsBy]. Persisting it there is what made the
/// "Photo Grid" -> "Group by" setting flip the timeline into the overview cards (#903).
class TimelineOverviewModeNotifier extends Notifier<TimelineOverviewMode> {
  @override
  TimelineOverviewMode build() => TimelineOverviewMode.all;

  Future<void> set(TimelineOverviewMode mode) async {
    state = mode;
  }
}

/// The active zoom level for the current scope.
///
/// Scoped per-route by `TimelineRouteScope` (unless the route opts into `sharedGrouping`),
/// so a change inside an album does not leak into the main Photos timeline. Widgets resolve
/// the nearest scope automatically, but any PROVIDER that reads this must list it in its own
/// `dependencies:` — otherwise its auto-scoped copy silently resolves the root mode.
final timelineOverviewModeProvider = NotifierProvider<TimelineOverviewModeNotifier, TimelineOverviewMode>(
  TimelineOverviewModeNotifier.new,
);

/// What to render for the current scope, and at what granularity.
///
/// Years / Months render the overview cards at that granularity. All renders the photo
/// grid, whose header granularity is the persisted Group by setting.
final timelineGroupingSpecProvider = Provider<TimelineGroupingSpec>((ref) {
  final mode = ref.watch(timelineOverviewModeProvider);
  return switch (mode) {
    TimelineOverviewMode.years => (mode: mode, groupBy: GroupAssetsBy.year),
    TimelineOverviewMode.months => (mode: mode, groupBy: GroupAssetsBy.month),
    TimelineOverviewMode.all => (mode: mode, groupBy: ref.watch(timelineGridGroupingProvider)),
  };
  // timelineOverviewModeProvider must be listed so the auto-scoped copy of this provider
  // inside a TimelineRouteScope resolves the ROUTE-LOCAL mode rather than the root one.
}, dependencies: [timelineOverviewModeProvider]);

/// The persisted "Photo Grid" -> "Group by" setting: how coarse the headers on the photo
/// grid are. Only [GroupAssetsBy.day] (month + day headers) and [GroupAssetsBy.month]
/// (month-only headers) are reachable; everything else falls back to day.
final timelineGridGroupingProvider = Provider<GroupAssetsBy>(
  (ref) => normalizeGridGrouping(ref.watch(appConfigProvider.select((config) => config.timeline.groupAssetsBy))),
);
