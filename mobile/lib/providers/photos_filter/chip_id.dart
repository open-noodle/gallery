sealed class ChipId {
  const ChipId();
}

class PersonChipId extends ChipId {
  final String personId;
  const PersonChipId(this.personId);
  @override
  bool operator ==(Object other) => other is PersonChipId && other.personId == personId;
  @override
  int get hashCode => Object.hash('PersonChipId', personId);
}

class TagChipId extends ChipId {
  final String tagId;
  const TagChipId(this.tagId);
  @override
  bool operator ==(Object other) => other is TagChipId && other.tagId == tagId;
  @override
  int get hashCode => Object.hash('TagChipId', tagId);
}

// Value-less chip ids: singletons via identity; define == as runtimeType match.
class LocationChipId extends ChipId {
  const LocationChipId();
  @override
  bool operator ==(Object other) => other is LocationChipId;
  @override
  int get hashCode => (LocationChipId).hashCode;
}

class DateChipId extends ChipId {
  const DateChipId();
  @override
  bool operator ==(Object other) => other is DateChipId;
  @override
  int get hashCode => (DateChipId).hashCode;
}

class RatingChipId extends ChipId {
  const RatingChipId();
  @override
  bool operator ==(Object other) => other is RatingChipId;
  @override
  int get hashCode => (RatingChipId).hashCode;
}

class MediaTypeChipId extends ChipId {
  const MediaTypeChipId();
  @override
  bool operator ==(Object other) => other is MediaTypeChipId;
  @override
  int get hashCode => (MediaTypeChipId).hashCode;
}

class FavouriteChipId extends ChipId {
  const FavouriteChipId();
  @override
  bool operator ==(Object other) => other is FavouriteChipId;
  @override
  int get hashCode => (FavouriteChipId).hashCode;
}

class ArchiveChipId extends ChipId {
  const ArchiveChipId();
  @override
  bool operator ==(Object other) => other is ArchiveChipId;
  @override
  int get hashCode => (ArchiveChipId).hashCode;
}

class NotInAlbumChipId extends ChipId {
  const NotInAlbumChipId();
  @override
  bool operator ==(Object other) => other is NotInAlbumChipId;
  @override
  int get hashCode => (NotInAlbumChipId).hashCode;
}

class TextChipId extends ChipId {
  const TextChipId();
  @override
  bool operator ==(Object other) => other is TextChipId;
  @override
  int get hashCode => (TextChipId).hashCode;
}
