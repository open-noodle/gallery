import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/search_timeline.dart' show searchResultsPendingProvider;
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';

/// What search mode adds around the Photos screen (TimelineRouteScope wraps the page in it):
/// - room at the top for the search header, so the timeline's scrubber starts below it;
/// - the Years | Months | All pill while searching, in the place of the hidden bottom nav, so zoom works on results.
///   Outside search the Photos page keeps its app-bar chip and shows no pill. The pill sits beside the page rather than
///   inside the Timeline, so the timeline (and its scroll position) is untouched by entering and leaving;
/// - the warm-up of the server's unfiltered search cache when the Photos tab first shows (Slice 2's warm-up: once per
///   session, silent on failure).
class PhotosSearchFrame extends ConsumerStatefulWidget {
  final Widget child;

  const PhotosSearchFrame({super.key, required this.child});

  @override
  ConsumerState<PhotosSearchFrame> createState() => _PhotosSearchFrameState();
}

class _PhotosSearchFrameState extends ConsumerState<PhotosSearchFrame> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        ref.read(searchWarmUpProvider);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final searching = ref.watch(searchModeProvider);
    final media = MediaQuery.of(context);
    return Stack(
      children: [
        // The timeline reserves its bottom padding from the media padding: in search mode it makes room for the pill,
        // as detail timelines do. Its scrubber starts below `padding.top + kToolbarHeight`, room for an app bar: the
        // search header is taller, so the top grows by the difference, which the header takes back off. Always the
        // same wrappers, so the page underneath is never rebuilt from scratch.
        SearchHeaderInset(
          extra: searching ? SearchHeader.extraTopPadding : 0,
          child: MediaQuery(
            data: searching
                ? media.copyWith(
                    padding: media.padding.copyWith(
                      top: media.padding.top + SearchHeader.extraTopPadding,
                      bottom:
                          media.padding.bottom +
                          TimelineGroupingBottomPill.pillHeight +
                          TimelineGroupingBottomPill.bottomFloat,
                    ),
                  )
                : media,
            child: widget.child,
          ),
        ),
        StaleResultsScrim(top: media.padding.top),
        if (searching) const TimelineGroupingBottomPill(),
      ],
    );
  }
}

/// What search mode adds around any other timeline screen (album, space, person, ...): room at the top for the search
/// header, as on Photos. These screens already show the grouping pill, whose search button enters search mode.
class SearchScreenFrame extends ConsumerWidget {
  final Widget child;

  const SearchScreenFrame({super.key, required this.child});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final searching = ref.watch(searchModeProvider);
    final media = MediaQuery.of(context);
    return Stack(
      children: [
        SearchHeaderInset(
          extra: searching ? SearchHeader.extraTopPadding : 0,
          child: MediaQuery(
            data: searching
                ? media.copyWith(padding: media.padding.copyWith(top: media.padding.top + SearchHeader.extraTopPadding))
                : media,
            child: child,
          ),
        ),
        StaleResultsScrim(top: media.padding.top),
      ],
    );
  }
}

/// Dims the grid below the search header while a search is on its way (searchResultsPendingProvider): the photos
/// underneath are the previous answer, or the screen's own timeline, not what the filters now ask for. Touches pass
/// through, so the grid still scrolls.
class StaleResultsScrim extends ConsumerWidget {
  /// The status bar height: the header sits right below it.
  final double top;

  const StaleResultsScrim({super.key, required this.top});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(searchResultsPendingProvider)) {
      return const SizedBox.shrink();
    }
    const headerHeight = SearchHeader.fieldRowHeight + SearchHeader.chipRowHeight + SearchHeader.resultsRowHeight;
    return Positioned.fill(
      top: top + headerHeight,
      child: IgnorePointer(
        child: TweenAnimationBuilder<double>(
          key: const Key('search-mode-stale-scrim'),
          tween: Tween(begin: 0, end: 0.6),
          duration: const Duration(milliseconds: 150),
          builder: (context, opacity, _) =>
              ColoredBox(color: Theme.of(context).colorScheme.surface.withValues(alpha: opacity)),
        ),
      ),
    );
  }
}

/// A screen's own sliver above its timeline (a space's header and albums) steps aside while search mode shows results,
/// as the Photos memory lane does: the results start right under the search header.
class HiddenWhileSearching extends ConsumerWidget {
  final Widget sliver;

  const HiddenWhileSearching({super.key, required this.sliver});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filtering = ref.watch(searchModeProvider) && !ref.watch(searchStateProvider.select((s) => s.isEmpty));
    return filtering ? const SliverToBoxAdapter(child: SizedBox.shrink()) : sliver;
  }
}
