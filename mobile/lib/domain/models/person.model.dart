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
  }) = _Person;
}

enum PeopleSortBy { photoCount, name }
