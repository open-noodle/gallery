import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:openapi/api.dart';

/// Sort modes for a space's linked-albums grid ([SpaceAlbumsPage]).
enum SpaceAlbumSortMode {
  name(0, 'name', SortOrder.asc),
  photoCount(1, 'sort_photo_count', SortOrder.desc),
  recentlyLinked(2, 'sort_recently_linked', SortOrder.desc),
  recentlyUpdated(3, 'sort_recently_updated', SortOrder.desc);

  const SpaceAlbumSortMode(this.storeIndex, this.label, this.defaultOrder);

  final int storeIndex;
  final String label;
  final SortOrder defaultOrder;

  SortOrder effectiveOrder(bool isReverse) => isReverse ? defaultOrder.reverse() : defaultOrder;
}

/// Sort modes for the Spaces grid ([SpacesPage]).
enum SpaceSortMode {
  name(0, 'name', SortOrder.asc),
  recentActivity(1, 'sort_recent_activity', SortOrder.desc),
  dateCreated(2, 'sort_date_created', SortOrder.desc),
  members(3, 'sort_members', SortOrder.desc),
  photos(4, 'sort_photos', SortOrder.desc);

  const SpaceSortMode(this.storeIndex, this.label, this.defaultOrder);

  final int storeIndex;
  final String label;
  final SortOrder defaultOrder;

  SortOrder effectiveOrder(bool isReverse) => isReverse ? defaultOrder.reverse() : defaultOrder;
}

/// Case-insensitive, trimmed, literal-substring match — no regex, no
/// diacritic folding (intentional; see the design spec).
bool _matches(String name, String query) {
  final q = query.trim().toLowerCase();
  return q.isEmpty || name.toLowerCase().contains(q);
}

int _byName(String a, String b) => a.toLowerCase().compareTo(b.toLowerCase());

List<SpaceAlbum> filterAndSortSpaceAlbums(
  List<SpaceAlbum> items,
  String query,
  SpaceAlbumSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((a) => _matches(a.name, query)).toList();
  out.sort((a, b) {
    final c = switch (mode) {
      SpaceAlbumSortMode.name => _byName(a.name, b.name),
      SpaceAlbumSortMode.photoCount => a.assetCount.compareTo(b.assetCount),
      SpaceAlbumSortMode.recentlyLinked => a.linkedAt.compareTo(b.linkedAt),
      SpaceAlbumSortMode.recentlyUpdated => a.updatedAt.compareTo(b.updatedAt),
    };
    if (c != 0) return sign * c;
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}

// Optional-safe readers for SharedSpaceResponseDto. Verified against the
// generated `openapi` client (mobile/openapi/lib/model/shared_space_response_dto.dart
// + optional.dart): `memberCount`/`assetCount`/`lastActivityAt` are
// `Optional<T?>` with `isPresent`/`value` accessors; `.value` throws
// (`StateError`) when absent, so every read below guards with `isPresent`
// first. `createdAt`/`updatedAt` are required non-null `String`s.
num _members(SharedSpaceResponseDto s) => (s.memberCount.isPresent ? s.memberCount.value : null) ?? 0;

num _photos(SharedSpaceResponseDto s) => (s.assetCount.isPresent ? s.assetCount.value : null) ?? 0;

DateTime _activity(SharedSpaceResponseDto s) {
  final la = s.lastActivityAt;
  if (la.isPresent && la.value != null) return DateTime.parse(la.value!);
  return DateTime.parse(s.updatedAt.isNotEmpty ? s.updatedAt : s.createdAt);
}

List<SharedSpaceResponseDto> filterAndSortSpaces(
  List<SharedSpaceResponseDto> items,
  String query,
  SpaceSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((s) => _matches(s.name, query)).toList();
  out.sort((a, b) {
    final c = switch (mode) {
      SpaceSortMode.name => _byName(a.name, b.name),
      SpaceSortMode.recentActivity => _activity(a).compareTo(_activity(b)),
      SpaceSortMode.dateCreated => DateTime.parse(a.createdAt).compareTo(DateTime.parse(b.createdAt)),
      SpaceSortMode.members => _members(a).compareTo(_members(b)),
      SpaceSortMode.photos => _photos(a).compareTo(_photos(b)),
    };
    if (c != 0) return sign * c;
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}
