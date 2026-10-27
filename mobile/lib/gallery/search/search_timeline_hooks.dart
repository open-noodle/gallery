import 'package:flutter/material.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';
import 'package:immich_mobile/generated/translations.g.dart';

// The UI swap (specs/2026-10-23-mobile-search-redesign-design.md, "Layering"): the one hook the upstream Timeline
// widget calls at its app-bar sites, so no upstream app-bar class changes.

/// The sliver at the top of the timeline: the search header while this route's search is on, the screen's own app bar
/// otherwise.
Widget? searchAwareAppBar(WidgetRef ref, Widget? appBar) =>
    ref.watch(timelineHasSearchProvider) && ref.watch(searchModeProvider) ? const SearchHeader() : appBar;

/// The entry on every timeline screen but Photos ("Entering and leaving search mode"): a search button at the end of
/// the grouping pill, shown while the route has a search and it is not on yet. Photos enters from the bottom nav's
/// search button; its pill only shows in search mode, so it never shows this button.
class TimelinePillSearchButton extends ConsumerWidget {
  const TimelinePillSearchButton({super.key});

  /// The width the button adds to the pill.
  static const double width = 44;

  static bool visible(WidgetRef ref) => ref.watch(timelineHasSearchProvider) && !ref.watch(searchModeProvider);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!visible(ref)) {
      return const SizedBox.shrink();
    }
    return SizedBox(
      width: width,
      child: IconButton(
        key: const Key('timeline-pill-search'),
        tooltip: context.t.search,
        icon: const Icon(Icons.search_rounded),
        onPressed: () => ref.read(searchModeProvider.notifier).enter(),
      ),
    );
  }
}
