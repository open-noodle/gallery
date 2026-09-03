import 'package:hooks_riverpod/hooks_riverpod.dart';

/// The filter panel is either up or it isn't. It used to have an intermediate
/// half-height "browse" resting state; that was removed — a downward drag now
/// either springs back to full height or dismisses.
enum FilterSheetVisibility { hidden, visible }

final photosFilterSheetProvider = StateProvider<FilterSheetVisibility>((ref) => FilterSheetVisibility.hidden);
