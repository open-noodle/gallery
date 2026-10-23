import 'package:flutter/widgets.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/gallery/search/search_mode.provider.dart';
import 'package:immich_mobile/gallery/search/widgets/search_header.widget.dart';

// The UI swap (specs/2026-10-23-mobile-search-redesign-design.md, "Layering"): the one hook the upstream Timeline
// widget calls at its app-bar sites, so no upstream app-bar class changes.

/// The sliver at the top of the timeline: the search header while this route's search is on, the screen's own app bar
/// otherwise.
Widget? searchAwareAppBar(WidgetRef ref, Widget? appBar) =>
    ref.watch(timelineHasSearchProvider) && ref.watch(searchModeProvider) ? const SearchHeader() : appBar;
