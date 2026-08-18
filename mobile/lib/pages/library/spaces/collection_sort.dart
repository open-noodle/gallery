import 'package:immich_mobile/constants/enums.dart';
import 'package:immich_mobile/domain/models/space_album.model.dart';
import 'package:openapi/api.dart';

/// Sort modes for a space's linked-albums grid ([SpaceAlbumsPage]).
///
/// Declaration order IS menu order — [SpaceAlbumsPage] builds the menu from
/// `values`. The set and order match the web sort dropdown (see the #966 design
/// spec).
///
/// The identifiers are persisted verbatim by `EnumCodec` (`value.name`), so
/// renaming one silently resets every user who had it selected. That is why
/// `name` is labelled "Title" and `recentlyUpdated` is labelled "Date modified"
/// rather than being renamed to match.
enum SpaceAlbumSortMode {
  name(0, 'sort_title', SortOrder.asc),
  photoCount(1, 'sort_items', SortOrder.desc),
  recentlyUpdated(3, 'sort_modified', SortOrder.desc),
  dateCreated(4, 'sort_created', SortOrder.desc),
  mostRecentPhoto(5, 'sort_recent', SortOrder.desc),
  oldestPhoto(6, 'sort_oldest', SortOrder.desc),
  recentlyLinked(2, 'sort_recently_linked', SortOrder.desc);

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
///
/// [fields] are OR-ed: a row matches when *any* of them contains the query.
/// Nulls are skipped, so an absent field can never match. Which fields get
/// passed is the per-collection decision — albums search name + description to
/// match web (#973), spaces search the name only.
bool _matches(Iterable<String?> fields, String query) {
  final q = query.trim().toLowerCase();
  if (q.isEmpty) {
    return true;
  }
  return fields.any((field) => field != null && field.toLowerCase().contains(q));
}

int _byName(String a, String b) => a.toLowerCase().compareTo(b.toLowerCase());

/// Albums with no photo dates sort last in BOTH directions, matching upstream
/// web's `sortUnknownYearAlbums`. Returns null — deferring to the caller's
/// normal comparison — in the two cases where "one side is missing" doesn't
/// apply: both sides null (a tie; the caller falls through to the name/id
/// tie-break) and both sides present (the caller does the real comparison).
///
/// Upstream checks `endDate` for both photo-date sorts, including the one that
/// orders by `startDate`. This checks each mode's own field instead. The two
/// are equivalent in practice — both dates come from the same aggregate, so an
/// album has both or neither — so do not "fix" this to match upstream's quirk.
int? _unknownDateLast(DateTime? a, DateTime? b) {
  if (a == null && b == null) {
    return null;
  }
  if (a == null) {
    return 1;
  }
  if (b == null) {
    return -1;
  }
  return null;
}

List<SpaceAlbum> filterAndSortSpaceAlbums(
  List<SpaceAlbum> items,
  String query,
  SpaceAlbumSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  // Name OR description, matching web's `space-albums-list.svelte` filter.
  final out = items.where((a) => _matches([a.name, a.description], query)).toList();
  out.sort((a, b) {
    // Applied outside the sign so empty albums stay last in both directions.
    final unknown = switch (mode) {
      SpaceAlbumSortMode.mostRecentPhoto => _unknownDateLast(a.endDate, b.endDate),
      SpaceAlbumSortMode.oldestPhoto => _unknownDateLast(a.startDate, b.startDate),
      _ => null,
    };
    if (unknown != null) {
      return unknown;
    }

    final c = switch (mode) {
      SpaceAlbumSortMode.name => _byName(a.name, b.name),
      SpaceAlbumSortMode.photoCount => a.assetCount.compareTo(b.assetCount),
      SpaceAlbumSortMode.recentlyLinked => a.linkedAt.compareTo(b.linkedAt),
      SpaceAlbumSortMode.recentlyUpdated => a.updatedAt.compareTo(b.updatedAt),
      SpaceAlbumSortMode.dateCreated => a.createdAt.compareTo(b.createdAt),
      // _unknownDateLast has already returned for the case where exactly one
      // side is null. Reaching here means both are null (tie — fall through to
      // the name/id tie-break below) or both are present (real comparison).
      SpaceAlbumSortMode.mostRecentPhoto => a.endDate == null ? 0 : a.endDate!.compareTo(b.endDate!),
      SpaceAlbumSortMode.oldestPhoto => a.startDate == null ? 0 : a.startDate!.compareTo(b.startDate!),
    };
    if (c != 0) {
      return sign * c;
    }
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}

// Optional-safe readers for SharedSpaceResponseDto. Verified against the
// generated `openapi` client (mobile/generated/openapi/lib/model/shared_space_response_dto.dart
// + optional.dart): `memberCount`/`assetCount`/`lastActivityAt` are
// `Optional<T?>` with `isPresent`/`value` accessors; `.value` throws
// (`StateError`) when absent, so every read below guards with `isPresent`
// first. `createdAt`/`updatedAt` are required non-null `String`s.
num _members(SharedSpaceResponseDto s) => (s.memberCount.isPresent ? s.memberCount.value : null) ?? 0;

num _photos(SharedSpaceResponseDto s) => (s.assetCount.isPresent ? s.assetCount.value : null) ?? 0;

DateTime _activity(SharedSpaceResponseDto s) {
  final la = s.lastActivityAt;
  if (la.isPresent && la.value != null) {
    return DateTime.parse(la.value!);
  }
  return DateTime.parse(s.updatedAt.isNotEmpty ? s.updatedAt : s.createdAt);
}

List<SharedSpaceResponseDto> filterAndSortSpaces(
  List<SharedSpaceResponseDto> items,
  String query,
  SpaceSortMode mode,
  bool isReverse,
) {
  final sign = mode.effectiveOrder(isReverse) == SortOrder.asc ? 1 : -1;
  final out = items.where((s) => _matches([s.name], query)).toList();
  out.sort((a, b) {
    final c = switch (mode) {
      SpaceSortMode.name => _byName(a.name, b.name),
      SpaceSortMode.recentActivity => _activity(a).compareTo(_activity(b)),
      SpaceSortMode.dateCreated => DateTime.parse(a.createdAt).compareTo(DateTime.parse(b.createdAt)),
      SpaceSortMode.members => _members(a).compareTo(_members(b)),
      SpaceSortMode.photos => _photos(a).compareTo(_photos(b)),
    };
    if (c != 0) {
      return sign * c;
    }
    final n = _byName(a.name, b.name);
    return n != 0 ? n : a.id.compareTo(b.id);
  });
  return out;
}
