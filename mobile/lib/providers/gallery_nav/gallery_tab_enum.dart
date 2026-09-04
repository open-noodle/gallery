import 'package:hooks_riverpod/hooks_riverpod.dart';
import 'package:immich_mobile/providers/infrastructure/settings.provider.dart';

/// Fork-only tab identity. Distinct from upstream's `TabEnum`
/// (`home/search/spaces/library`) — the bottom nav redesign keeps the
/// upstream enum + constants untouched for rebase hygiene (design §4.6, §6.6).
///
/// NOTE: the declaration order of this enum is NOT the nav slot order, and
/// `.index` must never be used as a router index. There are four values for
/// three slots, because slot 1 holds either Albums or Spaces depending on
/// `SettingsKey.navShowSpaces`. Use [galleryNavSlots] for every conversion
/// between a slot index and the tab occupying it.
enum GalleryTabEnum { photos, albums, spaces, library }

const int kGalleryPhotosIndex = 0;

/// Slot 1 — Albums or Spaces, per the user's preference.
const int kGalleryCollectionIndex = 1;
const int kGalleryLibraryIndex = 2;

/// The three nav slots, in order. The single place slot index and tab identity
/// are related; every call site reads through this rather than `.index` or
/// `.values`.
List<GalleryTabEnum> galleryNavSlots({required bool showSpaces}) => [
  GalleryTabEnum.photos,
  showSpaces ? GalleryTabEnum.spaces : GalleryTabEnum.albums,
  GalleryTabEnum.library,
];

/// The live nav slots, derived from the user's `navShowSpaces` preference.
///
/// `autoDispose` for lifecycle symmetry with `appConfigProvider`, which this
/// watches and which is itself `autoDispose`: without it this provider would
/// outlive its only dependency and keep it alive for the process lifetime.
/// Nothing enforces it — riverpod 2.6.1 lets a non-autoDispose provider watch an
/// autoDispose one without throwing.
final galleryNavSlotsProvider = Provider.autoDispose<List<GalleryTabEnum>>((ref) {
  final showSpaces = ref.watch(appConfigProvider.select((config) => config.nav.showSpaces));
  return galleryNavSlots(showSpaces: showSpaces);
});

/// The currently-active tab in the Gallery bottom-nav shell.
/// Synced automatically from `tabsRouter.activeIndex` by a listener registered
/// in `GalleryTabShellPage.initState` — no manual writes from tap callbacks.
final galleryTabProvider = StateProvider<GalleryTabEnum>((_) => GalleryTabEnum.photos);
