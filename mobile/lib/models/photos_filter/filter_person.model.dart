import 'package:freezed_annotation/freezed_annotation.dart';

part 'filter_person.model.freezed.dart';

/// Photos-filter view of a person. [id] is the TOKENIZED filter id
/// (`person:<uuid>` / `space-person:<uuid>`) — the server's filterId format —
/// never a raw profile id. Deliberately distinct from the domain person model:
/// the two id value-spaces fail silently when confused (the owner thumbnail
/// endpoint 404s a token; a personIds search matches nothing on a raw
/// space-person id).
///
/// [spaceId] carries the Space scope so avatars route to the membership-gated
/// space thumbnail endpoint (getFilterPersonThumbnailUrl). [numberOfAssets]
/// feeds the picker row's photo count; null (offline/local fallback) hides it.
@freezed
abstract class FilterPerson with _$FilterPerson {
  const factory FilterPerson({
    required String id,
    required String name,
    DateTime? birthDate,
    DateTime? updatedAt,
    int? numberOfAssets,
    String? spaceId,
  }) = _FilterPerson;
}
