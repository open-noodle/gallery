import 'package:immich_mobile/pages/library/spaces/collection_sort.dart';

class SpaceAlbumsConfig {
  final SpaceAlbumSortMode sortMode;
  final bool isReverse;

  const SpaceAlbumsConfig({this.sortMode = SpaceAlbumSortMode.recentlyLinked, this.isReverse = false});

  SpaceAlbumsConfig copyWith({SpaceAlbumSortMode? sortMode, bool? isReverse}) =>
      SpaceAlbumsConfig(sortMode: sortMode ?? this.sortMode, isReverse: isReverse ?? this.isReverse);

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SpaceAlbumsConfig && other.sortMode == sortMode && other.isReverse == isReverse);

  @override
  int get hashCode => Object.hash(sortMode, isReverse);

  @override
  String toString() => 'SpaceAlbumsConfig(sortMode: $sortMode, isReverse: $isReverse)';
}
