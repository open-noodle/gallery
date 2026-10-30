import 'package:auto_route/auto_route.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_scope.dart';
import 'package:immich_mobile/gallery/search/search_state.model.dart';
import 'package:immich_mobile/gallery/search/search_state.notifier.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_route_scope.dart';
import 'package:immich_mobile/providers/infrastructure/timeline.provider.dart';
import 'package:immich_mobile/providers/user.provider.dart';
import 'package:immich_mobile/widgets/common/mesmerizing_sliver_app_bar.dart';

/// "Show that day" from the details sheet (specs/2026-10-29-mobile-library-cleanup-design.md, "Details sheet" →
/// "Links"): every photo of the user's taken on [date], not only the cleanup ones, in the fork's search results. The
/// main timeline has no jump-to-date, so this is the user's own timeline (Recently taken's) in search mode with the
/// date filter set to that one day. Leaving search mode shows the whole timeline; back returns to the cleanup card.
///
/// [date] is `yyyy-MM-dd` (the photo's local wall-clock day), so the route needs no date type.
@RoutePage()
class LibraryCleanupDayPhotosPage extends StatelessWidget {
  const LibraryCleanupDayPhotosPage({super.key, required this.date});

  final String date;

  @override
  Widget build(BuildContext context) {
    final day = DateTime.parse(date);
    final locale = Localizations.maybeLocaleOf(context)?.toLanguageTag() ?? 'en';
    String title;
    try {
      title = DateFormat.yMMMMd(locale).format(day);
    } catch (_) {
      title = DateFormat.yMMMMd('en').format(day);
    }
    return TimelineRouteScope(
      timelineServiceBuilder: (ref, scope, groupBy) {
        final user = ref.watch(currentUserProvider);
        if (user == null) {
          throw Exception('User must be logged in to see a day of photos');
        }
        return ref.watch(timelineFactoryProvider).remoteAssets(user.id, groupBy: groupBy, temporalScope: scope);
      },
      search: const RecentlyTakenSearchScope(),
      child: _DaySearch(
        day: day,
        child: Timeline(appBar: MesmerizingSliverAppBar(title: title)),
      ),
    );
  }
}

/// Opens the route's search on [day] once the screen is built.
class _DaySearch extends ConsumerStatefulWidget {
  const _DaySearch({required this.day, required this.child});

  final DateTime day;
  final Widget child;

  @override
  ConsumerState<_DaySearch> createState() => _DaySearchState();
}

class _DaySearchState extends ConsumerState<_DaySearch> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        libraryCleanupSearchDay(
          ref.read(searchModeProvider.notifier),
          ref.read(searchStateProvider.notifier),
          widget.day,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// Search mode on, filtered to the one day [day] (the search's own custom range, from and to that day).
void libraryCleanupSearchDay(SearchModeNotifier mode, SearchStateNotifier state, DateTime day) {
  mode.enter();
  final only = DateTime(day.year, day.month, day.day);
  state.setDate(SearchDate.custom(from: only, to: only));
}
