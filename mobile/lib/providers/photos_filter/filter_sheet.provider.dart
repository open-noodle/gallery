import 'package:hooks_riverpod/hooks_riverpod.dart';

enum FilterSheetSnap { hidden, peek, browse, deep }

final photosFilterSheetProvider = StateProvider<FilterSheetSnap>((ref) => FilterSheetSnap.hidden);
