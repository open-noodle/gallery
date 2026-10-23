import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search.providers.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/presentation/widgets/timeline/timeline_grouping_bottom_pill.widget.dart';

/// What search mode adds around the Photos screen (TimelineRouteScope wraps the page in it):
/// - the Years | Months | All pill while searching, in the place of the hidden bottom nav, so zoom works on results.
///   Outside search the Photos page keeps its app-bar chip and shows no pill. The pill sits beside the page rather than
///   inside the Timeline, so the timeline (and its scroll position) is untouched by entering and leaving;
/// - the warm-up of the server's unfiltered search cache when the Photos tab first shows, while the preview is on
///   (Slice 2's warm-up: once per session, silent on failure).
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
      if (mounted && ref.read(searchPreviewEnabledProvider)) {
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
        // as detail timelines do. Always the same wrapper, so the page underneath is never rebuilt from scratch.
        MediaQuery(
          data: searching
              ? media.copyWith(
                  padding: media.padding.copyWith(
                    bottom:
                        media.padding.bottom +
                        TimelineGroupingBottomPill.pillHeight +
                        TimelineGroupingBottomPill.bottomFloat,
                  ),
                )
              : media,
          child: widget.child,
        ),
        if (searching) const TimelineGroupingBottomPill(),
      ],
    );
  }
}
