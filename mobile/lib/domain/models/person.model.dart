import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'person.model.freezed.dart';

@freezed
abstract class Person with _$Person {
  const factory Person({
    required String id,
    required String name,
    DateTime? updatedAt,
    DateTime? birthDate,

    /// Non-null when this person is a Space-scoped identity resolved from the server (the
    /// People-page shared-space list). Personal/owned people are always null. Edits to a
    /// Space person must route through the editor-gated shared-space endpoint, never the
    /// owner-only person endpoint.
    String? spaceId,

    /// Photo count sourced from the shared-spaces server list (`PersonResponseDto.numberOfAssets`).
    /// Null when unavailable — the owner-scoped local Drift query and the offline fallback path
    /// never populate it, so the picker row hides the count gracefully rather than erroring.
    int? numberOfAssets,

    /// Drives the "favorites first" ordering of the server-backed people list, which is sorted
    /// client-side by `comparePeople`. The local Drift query sorts favorites in SQL instead, and
    /// paths that cannot know the flag (offline fallback, the asset-viewer strip) leave it false.
    @Default(false) bool isFavorite,

    /// Gallery-fork (family relationships): whether the viewer has usable family-relationship
    /// access at all, sourced from whether `PersonResponseDto.familyRelationLabel` was present
    /// in the server response (an absent field means no access — the feature is off, or this
    /// viewer's grant is `none` — not merely "no relationship known"). `false` means the
    /// asset-viewer people strip must render exactly as it does today, with no relation line
    /// for this person at all (`A12`).
    @Default(false) bool hasFamilyAccess,

    /// Gallery-fork (family relationships): this person's relation to the viewer ("your
    /// sibling"), already derived server-side — never computed on the client. Meaningful only
    /// when [hasFamilyAccess] is `true`: `null` then means access is granted but no
    /// relationship is recorded, which the strip renders as a neutral dash rather than a blank
    /// line.
    String? familyRelationLabel,
  }) = _Person;
}

enum PeopleSortBy { photoCount, name }

enum PeopleFilterBy {
  all,
  people,
  pets;

  /// The `type` query parameter for `GET /people` and `GET /shared-spaces/{id}/people`.
  /// Null means unfiltered. Values match the server enum exactly.
  String? toTypeParam() => switch (this) {
    PeopleFilterBy.all => null,
    PeopleFilterBy.people => 'person',
    PeopleFilterBy.pets => 'pet',
  };
}
