import 'package:immich_mobile/domain/models/timeline.model.dart';

/// Which zoom level the timeline is at. Fork-only: upstream has no overview.
///
/// Deliberately NOT [GroupAssetsBy]. That type means "how coarse are the photo
/// grid's date headers"; this one means "which zoom level is the timeline at".
/// Storing the second in the first is what caused #903.
enum TimelineOverviewMode { years, months, all }

/// What the timeline should render for the current scope: which zoom level, and
/// the bucket/header granularity that goes with it.
typedef TimelineGroupingSpec = ({TimelineOverviewMode mode, GroupAssetsBy groupBy});

/// Clamps the persisted "Photo Grid" -> "Group by" setting to the two granularities
/// the grid renders: month + day headers ([GroupAssetsBy.day]) or month-only headers
/// ([GroupAssetsBy.month]).
///
/// Legacy `auto`/`none`, and `year` left behind by the removed Year option, all fall
/// back to day.
///
/// Apply this ONLY where the persisted setting is read. Never apply it to a grouping a
/// caller passed explicitly: `timeline_query.provider.dart` passes [GroupAssetsBy.none]
/// deliberately for relevance-sorted search, and normalizing it to day would silently
/// re-introduce date bucketing there.
GroupAssetsBy normalizeGridGrouping(GroupAssetsBy groupBy) =>
    groupBy == GroupAssetsBy.month ? GroupAssetsBy.month : GroupAssetsBy.day;
