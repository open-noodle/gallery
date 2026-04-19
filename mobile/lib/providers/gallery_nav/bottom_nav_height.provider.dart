import 'package:hooks_riverpod/hooks_riverpod.dart';

/// Height of the Gallery bottom-nav pill in logical pixels, published by the
/// nav widget so the FilterSheet peek rail can stack above it instead of
/// overlapping (design §5.6).
///
/// Writers must equality-guard their writes:
///   if (ref.read(bottomNavHeightProvider) != measured)
///     ref.read(bottomNavHeightProvider.notifier).state = measured;
///
/// Riverpod's `StateProvider` notifies listeners on every `state =` set
/// regardless of value equality, so without the guard PeekContent would
/// rebuild on every LayoutBuilder frame.
///
/// Reads 0 when the nav is hidden (multi-select, keyboard-up, landscape)
/// or not yet measured.
final bottomNavHeightProvider = StateProvider<double>((_) => 0);
