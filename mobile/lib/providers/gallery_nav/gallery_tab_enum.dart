import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Fork-only tab identity. Distinct from upstream's `TabEnum`
/// (`home/search/spaces/library`) — the bottom nav redesign keeps the
/// upstream enum + constants untouched for rebase hygiene (design §4.6, §6.6).
enum GalleryTabEnum { photos, albums, library }

const int kGalleryPhotosIndex = 0;
const int kGalleryAlbumsIndex = 1;
const int kGalleryLibraryIndex = 2;

/// The currently-active tab in the Gallery bottom-nav shell.
/// Synced automatically from `tabsRouter.activeIndex` by a listener registered
/// in `GalleryTabShellPage.initState` — no manual writes from tap callbacks.
final galleryTabProvider = StateProvider<GalleryTabEnum>((_) => GalleryTabEnum.photos);
