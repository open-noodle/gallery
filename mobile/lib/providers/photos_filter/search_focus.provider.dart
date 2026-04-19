import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Counter that callers increment to request focus on the FilterSheet's
/// text-search input. `FilterSheetSearchBar` watches this and compares to the
/// `Consumed` counter to detect unhandled requests — surviving the race where
/// a request lands before the search bar mounts.
///
/// Using a counter (not a shared `FocusNode`) is deliberate: providers outlive
/// widgets, and a disposed `FocusNode` in a provider would crash later consumers.
final photosFilterSearchFocusRequestProvider = StateProvider<int>((_) => 0);

/// Tracks the last request value actually processed by a mounted
/// `FilterSheetSearchBar`. Lifted to a provider (rather than per-State field)
/// so that snap transitions — which unmount+remount the search bar — don't
/// retrigger focus on the already-processed request. A fresh mount reads the
/// consumed counter and only focuses if `request > consumed`.
final photosFilterSearchFocusConsumedProvider = StateProvider<int>((_) => 0);
