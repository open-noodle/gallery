import 'package:hooks_riverpod/hooks_riverpod.dart';

enum FilterSheetSnap { hidden, browse, deep }

final photosFilterSheetProvider = StateProvider<FilterSheetSnap>((ref) => FilterSheetSnap.hidden);
