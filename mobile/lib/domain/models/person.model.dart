import 'dart:convert';

// TODO: Remove PersonDto once Isar is removed
class PersonDto {
  const PersonDto({
    required this.id,
    this.birthDate,
    required this.isHidden,
    required this.name,
    required this.thumbnailPath,
    this.updatedAt,
    this.numberOfAssets,
    this.spaceId,
  });

  final String id;
  final DateTime? birthDate;
  final bool isHidden;
  final String name;
  final String thumbnailPath;
  final DateTime? updatedAt;

  /// Photo count for the picker row (`_PersonRow` "N photos" subtitle). Sourced from
  /// [DriftPerson.numberOfAssets] with no extra network call; null hides the subtitle
  /// (e.g. the offline local-Drift fallback path never populates it).
  final int? numberOfAssets;

  /// Space scope for a photos-filter person. Non-null when this is a shared-space person, in
  /// which case [id] is the tokenized `space-person:<uuid>` filter id and the avatar routes to
  /// the membership-gated space thumbnail endpoint (the owner endpoint 404s that id). Null for
  /// personal/owned people. Mirrors [DriftPerson.spaceId] / web `primaryProfile.spaceId`.
  final String? spaceId;

  @override
  String toString() {
    return 'Person(id: $id, birthDate: $birthDate, isHidden: $isHidden, name: $name, thumbnailPath: $thumbnailPath, updatedAt: $updatedAt, numberOfAssets: $numberOfAssets, spaceId: $spaceId)';
  }

  PersonDto copyWith({
    String? id,
    DateTime? birthDate,
    bool? isHidden,
    String? name,
    String? thumbnailPath,
    DateTime? updatedAt,
    int? numberOfAssets,
    String? spaceId,
  }) {
    return PersonDto(
      id: id ?? this.id,
      birthDate: birthDate ?? this.birthDate,
      isHidden: isHidden ?? this.isHidden,
      name: name ?? this.name,
      thumbnailPath: thumbnailPath ?? this.thumbnailPath,
      updatedAt: updatedAt ?? this.updatedAt,
      numberOfAssets: numberOfAssets ?? this.numberOfAssets,
      spaceId: spaceId ?? this.spaceId,
    );
  }

  Map<String, dynamic> toMap() {
    return <String, dynamic>{
      'id': id,
      'birthDate': birthDate?.millisecondsSinceEpoch,
      'isHidden': isHidden,
      'name': name,
      'thumbnailPath': thumbnailPath,
      'updatedAt': updatedAt?.millisecondsSinceEpoch,
      'numberOfAssets': numberOfAssets,
      'spaceId': spaceId,
    };
  }

  factory PersonDto.fromMap(Map<String, dynamic> map) {
    return PersonDto(
      id: map['id'] as String,
      birthDate: map['birthDate'] != null ? DateTime.fromMillisecondsSinceEpoch(map['birthDate'] as int) : null,
      isHidden: map['isHidden'] as bool,
      name: map['name'] as String,
      thumbnailPath: map['thumbnailPath'] as String,
      updatedAt: map['updatedAt'] != null ? DateTime.fromMillisecondsSinceEpoch(map['updatedAt'] as int) : null,
      numberOfAssets: map['numberOfAssets'] as int?,
      spaceId: map['spaceId'] as String?,
    );
  }

  String toJson() => json.encode(toMap());

  factory PersonDto.fromJson(String source) => PersonDto.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  bool operator ==(covariant PersonDto other) {
    if (identical(this, other)) {
      return true;
    }

    return other.id == id &&
        other.birthDate == birthDate &&
        other.isHidden == isHidden &&
        other.name == name &&
        other.thumbnailPath == thumbnailPath &&
        other.updatedAt == updatedAt &&
        other.numberOfAssets == numberOfAssets &&
        other.spaceId == spaceId;
  }

  @override
  int get hashCode {
    return id.hashCode ^
        birthDate.hashCode ^
        isHidden.hashCode ^
        name.hashCode ^
        thumbnailPath.hashCode ^
        updatedAt.hashCode ^
        numberOfAssets.hashCode ^
        spaceId.hashCode;
  }
}

// Model for a person stored in the server
class DriftPerson {
  final String id;
  final DateTime createdAt;
  final DateTime updatedAt;
  final String ownerId;
  final String name;
  final String? faceAssetId;
  final bool isFavorite;
  final bool isHidden;
  final String? color;
  final DateTime? birthDate;

  /// Non-null when this person is a Space-scoped identity resolved from the server (the
  /// People-page shared-space list). Personal/owned people are always null. Edits to a
  /// Space person must route through the editor-gated shared-space endpoint, never the
  /// owner-only person endpoint.
  final String? spaceId;

  /// Photo count sourced from the shared-spaces server list (`PersonResponseDto.numberOfAssets`).
  /// Null when unavailable — the owner-scoped local Drift query and the offline fallback path
  /// never populate it, so the picker row hides the count gracefully rather than erroring.
  final int? numberOfAssets;

  /// Whether the viewer has usable family-relationship access at all, sourced from whether
  /// `PersonResponseDto.familyRelationLabel` was present in the server response (an absent
  /// field means no access — the feature is off, or this viewer's grant is `none` — not merely
  /// "no relationship known"). `false` means the asset-viewer people strip must render exactly
  /// as it does today, with no relation line for this person at all (`A12`).
  final bool hasFamilyAccess;

  /// This person's relation to the viewer ("your sibling"), already derived server-side —
  /// never computed on the client. Meaningful only when [hasFamilyAccess] is `true`: `null`
  /// then means access is granted but no relationship is recorded, which the strip renders as
  /// a neutral dash rather than a blank line.
  final String? familyRelationLabel;

  const DriftPerson({
    required this.id,
    required this.createdAt,
    required this.updatedAt,
    required this.ownerId,
    required this.name,
    this.faceAssetId,
    required this.isFavorite,
    required this.isHidden,
    required this.color,
    this.birthDate,
    this.spaceId,
    this.numberOfAssets,
    this.hasFamilyAccess = false,
    this.familyRelationLabel,
  });

  DriftPerson copyWith({
    String? id,
    DateTime? createdAt,
    DateTime? updatedAt,
    String? ownerId,
    String? name,
    String? faceAssetId,
    bool? isFavorite,
    bool? isHidden,
    String? color,
    DateTime? birthDate,
    String? spaceId,
    int? numberOfAssets,
    bool? hasFamilyAccess,
    String? familyRelationLabel,
  }) {
    return DriftPerson(
      id: id ?? this.id,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      ownerId: ownerId ?? this.ownerId,
      name: name ?? this.name,
      faceAssetId: faceAssetId ?? this.faceAssetId,
      isFavorite: isFavorite ?? this.isFavorite,
      isHidden: isHidden ?? this.isHidden,
      color: color ?? this.color,
      birthDate: birthDate ?? this.birthDate,
      spaceId: spaceId ?? this.spaceId,
      numberOfAssets: numberOfAssets ?? this.numberOfAssets,
      hasFamilyAccess: hasFamilyAccess ?? this.hasFamilyAccess,
      familyRelationLabel: familyRelationLabel ?? this.familyRelationLabel,
    );
  }

  @override
  String toString() {
    return '''Person {
    id: $id,
    createdAt: $createdAt,
    updatedAt: $updatedAt,
    ownerId: $ownerId,
    name: $name,
    faceAssetId: ${faceAssetId ?? "<NA>"},
    isFavorite: $isFavorite,
    isHidden: $isHidden,
    color: ${color ?? "<NA>"},
    birthDate: ${birthDate ?? "<NA>"},
    spaceId: ${spaceId ?? "<NA>"},
    numberOfAssets: ${numberOfAssets ?? "<NA>"},
    hasFamilyAccess: $hasFamilyAccess,
    familyRelationLabel: ${familyRelationLabel ?? "<NA>"}
}''';
  }

  @override
  bool operator ==(covariant DriftPerson other) {
    if (identical(this, other)) {
      return true;
    }

    return other.id == id &&
        other.createdAt == createdAt &&
        other.updatedAt == updatedAt &&
        other.ownerId == ownerId &&
        other.name == name &&
        other.faceAssetId == faceAssetId &&
        other.isFavorite == isFavorite &&
        other.isHidden == isHidden &&
        other.color == color &&
        other.birthDate == birthDate &&
        other.spaceId == spaceId &&
        other.numberOfAssets == numberOfAssets &&
        other.hasFamilyAccess == hasFamilyAccess &&
        other.familyRelationLabel == familyRelationLabel;
  }

  @override
  int get hashCode {
    return id.hashCode ^
        createdAt.hashCode ^
        updatedAt.hashCode ^
        ownerId.hashCode ^
        name.hashCode ^
        faceAssetId.hashCode ^
        isFavorite.hashCode ^
        isHidden.hashCode ^
        color.hashCode ^
        birthDate.hashCode ^
        spaceId.hashCode ^
        numberOfAssets.hashCode ^
        hasFamilyAccess.hashCode ^
        familyRelationLabel.hashCode;
  }
}

enum PeopleSortBy { photoCount, name }
