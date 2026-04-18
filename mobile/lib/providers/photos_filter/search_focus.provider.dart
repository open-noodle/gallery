import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Counter that callers increment to request focus on the FilterSheet's
/// text-search input. `FilterSheetSearchBar` watches and uses a
/// `_lastProcessedFocusRequest` field in its State to detect rises —
/// surviving the race where a request lands before the search bar mounts
/// (common when `openGallerySearch` triggers the sheet from a non-Photos tab).
///
/// Using a counter (not a shared `FocusNode`) is deliberate: providers outlive
/// widgets, and a disposed `FocusNode` in a provider would crash later consumers.
final photosFilterSearchFocusRequestProvider = StateProvider<int>((_) => 0);
