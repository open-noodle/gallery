import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';

class SpacesConfig {
  final SpaceSortMode sortMode;
  final bool isReverse;

  const SpacesConfig({this.sortMode = SpaceSortMode.recentActivity, this.isReverse = false});

  SpacesConfig copyWith({SpaceSortMode? sortMode, bool? isReverse}) =>
      SpacesConfig(sortMode: sortMode ?? this.sortMode, isReverse: isReverse ?? this.isReverse);

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is SpacesConfig && other.sortMode == sortMode && other.isReverse == isReverse);

  @override
  int get hashCode => Object.hash(sortMode, isReverse);

  @override
  String toString() => 'SpacesConfig(sortMode: $sortMode, isReverse: $isReverse)';
}
