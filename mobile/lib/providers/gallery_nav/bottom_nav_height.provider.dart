import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Height of the Gallery bottom-nav pill in logical pixels, published by the
/// nav widget so scrolling surfaces can reserve clearance for it rather than
/// letting it overlap their last row (see `DriftLibraryPage`).
///
/// Writers must equality-guard their writes:
///   if (ref.read(bottomNavHeightProvider) != measured)
///     ref.read(bottomNavHeightProvider.notifier).state = measured;
///
/// Riverpod's `StateProvider` notifies listeners on every `state =` set
/// regardless of value equality, so without the guard every reader would
/// rebuild on each LayoutBuilder frame.
///
/// Reads 0 when the nav is hidden (multi-select, keyboard-up, landscape)
/// or not yet measured.
final bottomNavHeightProvider = StateProvider<double>((_) => 0);
