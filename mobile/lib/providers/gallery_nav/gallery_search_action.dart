import 'package:auto_route/auto_route.dart';
import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/gallery_nav/gallery_tab_enum.dart';
import 'package:immich_mobile/providers/haptic_feedback.provider.dart';
import 'package:immich_mobile/providers/photos_filter/filter_sheet.provider.dart';
import 'package:immich_mobile/providers/photos_filter/search_focus.provider.dart';

// Coupled to AutoTabsRouter transition — see tab_shell.page.dart (upstream's
// 600 ms FadeTransition). 20 ms buffer lets MainTimelinePage finish its first-
// build pass so FilterSheetSearchBar can accept focus.
const Duration kGalleryTabTransitionDelay = Duration(milliseconds: 620);

/// Reader is the common shape across WidgetRef, Ref, and ProviderContainer's
/// `read`. Passing a closure lets this helper be called from any of them
/// without coupling to a specific Riverpod ref type.
typedef ProviderReader = T Function<T>(ProviderListenable<T>);

Future<void> openGallerySearch(TabsRouter tabsRouter, ProviderReader read) async {
  read(hapticFeedbackProvider.notifier).selectionClick();
  final onPhotos = tabsRouter.activeIndex == GalleryTabEnum.photos.index;

  if (!onPhotos) {
    tabsRouter.setActiveIndex(GalleryTabEnum.photos.index);
    await Future<void>.delayed(kGalleryTabTransitionDelay);
  }

  read(photosFilterSheetProvider.notifier).state = FilterSheetSnap.deep;
  read(photosFilterSearchFocusRequestProvider.notifier).state++;
}
