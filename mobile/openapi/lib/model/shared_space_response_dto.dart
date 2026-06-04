//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceResponseDto {
  /// Returns a new [SharedSpaceResponseDto] instance.
  SharedSpaceResponseDto({
    this.assetCount = const Optional.absent(),
    this.color = const Optional.absent(),
    required this.createdAt,
    required this.createdById,
    this.description = const Optional.absent(),
    this.faceRecognitionEnabled = const Optional.absent(),
    this.hasPets = const Optional.absent(),
    required this.id,
    this.lastActivityAt = const Optional.absent(),
    this.lastContributor = const Optional.absent(),
    this.lastViewedAt = const Optional.absent(),
    this.linkedLibraries = const Optional.present(const []),
    this.memberCount = const Optional.absent(),
    this.members = const Optional.present(const []),
    required this.name,
    this.newAssetCount = const Optional.absent(),
    this.petsEnabled = const Optional.absent(),
    this.recentAssetIds = const Optional.present(const []),
    this.recentAssetThumbhashes = const Optional.present(const []),
    this.thumbnailAssetId = const Optional.absent(),
    this.thumbnailCropY = const Optional.absent(),
    required this.updatedAt,
  });

  /// Number of assets
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> assetCount;

  /// Space color
  Optional<UserAvatarColor?> color;

  /// Creation date
  String createdAt;

  /// Creator user ID
  String createdById;

  /// Space description
  Optional<String?> description;

  /// Whether face recognition is enabled for this space
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> faceRecognitionEnabled;

  /// Whether any pet-type persons exist in this space
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> hasPets;

  /// Space ID
  String id;

  /// Last activity timestamp (most recent asset add)
  Optional<String?> lastActivityAt;

  Optional<SharedSpaceResponseDtoLastContributor?> lastContributor;

  /// When the current user last viewed this space
  Optional<String?> lastViewedAt;

  Optional<List<SharedSpaceLinkedLibraryDto>?> linkedLibraries;

  /// Number of members
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> memberCount;

  /// Space members (summary)
  Optional<List<SharedSpaceMemberResponseDto>?> members;

  /// Space name
  String name;

  /// Number of new assets since last viewed
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> newAssetCount;

  /// Whether pets are shown in space people list
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> petsEnabled;

  /// Recent asset IDs for collage display (up to 4)
  Optional<List<String>?> recentAssetIds;

  /// Thumbhashes for recent assets (parallel array)
  Optional<List<String>?> recentAssetThumbhashes;

  /// Thumbnail asset ID
  Optional<String?> thumbnailAssetId;

  /// Vertical crop position for cover photo (0-100)
  Optional<num?> thumbnailCropY;

  /// Last update date
  String updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceResponseDto &&
    other.assetCount == assetCount &&
    other.color == color &&
    other.createdAt == createdAt &&
    other.createdById == createdById &&
    other.description == description &&
    other.faceRecognitionEnabled == faceRecognitionEnabled &&
    other.hasPets == hasPets &&
    other.id == id &&
    other.lastActivityAt == lastActivityAt &&
    other.lastContributor == lastContributor &&
    other.lastViewedAt == lastViewedAt &&
    _deepEquality.equals(other.linkedLibraries, linkedLibraries) &&
    other.memberCount == memberCount &&
    _deepEquality.equals(other.members, members) &&
    other.name == name &&
    other.newAssetCount == newAssetCount &&
    other.petsEnabled == petsEnabled &&
    _deepEquality.equals(other.recentAssetIds, recentAssetIds) &&
    _deepEquality.equals(other.recentAssetThumbhashes, recentAssetThumbhashes) &&
    other.thumbnailAssetId == thumbnailAssetId &&
    other.thumbnailCropY == thumbnailCropY &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetCount == null ? 0 : assetCount!.hashCode) +
    (color == null ? 0 : color!.hashCode) +
    (createdAt.hashCode) +
    (createdById.hashCode) +
    (description == null ? 0 : description!.hashCode) +
    (faceRecognitionEnabled == null ? 0 : faceRecognitionEnabled!.hashCode) +
    (hasPets == null ? 0 : hasPets!.hashCode) +
    (id.hashCode) +
    (lastActivityAt == null ? 0 : lastActivityAt!.hashCode) +
    (lastContributor == null ? 0 : lastContributor!.hashCode) +
    (lastViewedAt == null ? 0 : lastViewedAt!.hashCode) +
    (linkedLibraries.hashCode) +
    (memberCount == null ? 0 : memberCount!.hashCode) +
    (members.hashCode) +
    (name.hashCode) +
    (newAssetCount == null ? 0 : newAssetCount!.hashCode) +
    (petsEnabled == null ? 0 : petsEnabled!.hashCode) +
    (recentAssetIds.hashCode) +
    (recentAssetThumbhashes.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode) +
    (thumbnailCropY == null ? 0 : thumbnailCropY!.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SharedSpaceResponseDto[assetCount=$assetCount, color=$color, createdAt=$createdAt, createdById=$createdById, description=$description, faceRecognitionEnabled=$faceRecognitionEnabled, hasPets=$hasPets, id=$id, lastActivityAt=$lastActivityAt, lastContributor=$lastContributor, lastViewedAt=$lastViewedAt, linkedLibraries=$linkedLibraries, memberCount=$memberCount, members=$members, name=$name, newAssetCount=$newAssetCount, petsEnabled=$petsEnabled, recentAssetIds=$recentAssetIds, recentAssetThumbhashes=$recentAssetThumbhashes, thumbnailAssetId=$thumbnailAssetId, thumbnailCropY=$thumbnailCropY, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.assetCount.isPresent) {
      final value = this.assetCount.value;
      json[r'assetCount'] = value;
    }
    if (this.color.isPresent) {
      final value = this.color.value;
      json[r'color'] = value;
    }
      json[r'createdAt'] = this.createdAt;
      json[r'createdById'] = this.createdById;
    if (this.description.isPresent) {
      final value = this.description.value;
      json[r'description'] = value;
    }
    if (this.faceRecognitionEnabled.isPresent) {
      final value = this.faceRecognitionEnabled.value;
      json[r'faceRecognitionEnabled'] = value;
    }
    if (this.hasPets.isPresent) {
      final value = this.hasPets.value;
      json[r'hasPets'] = value;
    }
      json[r'id'] = this.id;
    if (this.lastActivityAt.isPresent) {
      final value = this.lastActivityAt.value;
      json[r'lastActivityAt'] = value;
    }
    if (this.lastContributor.isPresent) {
      final value = this.lastContributor.value;
      json[r'lastContributor'] = value;
    }
    if (this.lastViewedAt.isPresent) {
      final value = this.lastViewedAt.value;
      json[r'lastViewedAt'] = value;
    }
    if (this.linkedLibraries.isPresent) {
      final value = this.linkedLibraries.value;
      json[r'linkedLibraries'] = value;
    }
    if (this.memberCount.isPresent) {
      final value = this.memberCount.value;
      json[r'memberCount'] = value;
    }
    if (this.members.isPresent) {
      final value = this.members.value;
      json[r'members'] = value;
    }
      json[r'name'] = this.name;
    if (this.newAssetCount.isPresent) {
      final value = this.newAssetCount.value;
      json[r'newAssetCount'] = value;
    }
    if (this.petsEnabled.isPresent) {
      final value = this.petsEnabled.value;
      json[r'petsEnabled'] = value;
    }
    if (this.recentAssetIds.isPresent) {
      final value = this.recentAssetIds.value;
      json[r'recentAssetIds'] = value;
    }
    if (this.recentAssetThumbhashes.isPresent) {
      final value = this.recentAssetThumbhashes.value;
      json[r'recentAssetThumbhashes'] = value;
    }
    if (this.thumbnailAssetId.isPresent) {
      final value = this.thumbnailAssetId.value;
      json[r'thumbnailAssetId'] = value;
    }
    if (this.thumbnailCropY.isPresent) {
      final value = this.thumbnailCropY.value;
      json[r'thumbnailCropY'] = value;
    }
      json[r'updatedAt'] = this.updatedAt;
    return json;
  }

  /// Returns a new [SharedSpaceResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceResponseDto(
        assetCount: json.containsKey(r'assetCount') ? Optional.present(json[r'assetCount'] == null ? null : num.parse('${json[r'assetCount']}')) : const Optional.absent(),
        color: json.containsKey(r'color') ? Optional.present(UserAvatarColor.fromJson(json[r'color'])) : const Optional.absent(),
        createdAt: mapValueOfType<String>(json, r'createdAt')!,
        createdById: mapValueOfType<String>(json, r'createdById')!,
        description: json.containsKey(r'description') ? Optional.present(mapValueOfType<String>(json, r'description')) : const Optional.absent(),
        faceRecognitionEnabled: json.containsKey(r'faceRecognitionEnabled') ? Optional.present(mapValueOfType<bool>(json, r'faceRecognitionEnabled')) : const Optional.absent(),
        hasPets: json.containsKey(r'hasPets') ? Optional.present(mapValueOfType<bool>(json, r'hasPets')) : const Optional.absent(),
        id: mapValueOfType<String>(json, r'id')!,
        lastActivityAt: json.containsKey(r'lastActivityAt') ? Optional.present(mapValueOfType<String>(json, r'lastActivityAt')) : const Optional.absent(),
        lastContributor: json.containsKey(r'lastContributor') ? Optional.present(SharedSpaceResponseDtoLastContributor.fromJson(json[r'lastContributor'])) : const Optional.absent(),
        lastViewedAt: json.containsKey(r'lastViewedAt') ? Optional.present(mapValueOfType<String>(json, r'lastViewedAt')) : const Optional.absent(),
        linkedLibraries: json.containsKey(r'linkedLibraries') ? Optional.present(SharedSpaceLinkedLibraryDto.listFromJson(json[r'linkedLibraries'])) : const Optional.absent(),
        memberCount: json.containsKey(r'memberCount') ? Optional.present(json[r'memberCount'] == null ? null : num.parse('${json[r'memberCount']}')) : const Optional.absent(),
        members: json.containsKey(r'members') ? Optional.present(SharedSpaceMemberResponseDto.listFromJson(json[r'members'])) : const Optional.absent(),
        name: mapValueOfType<String>(json, r'name')!,
        newAssetCount: json.containsKey(r'newAssetCount') ? Optional.present(json[r'newAssetCount'] == null ? null : num.parse('${json[r'newAssetCount']}')) : const Optional.absent(),
        petsEnabled: json.containsKey(r'petsEnabled') ? Optional.present(mapValueOfType<bool>(json, r'petsEnabled')) : const Optional.absent(),
        recentAssetIds: json.containsKey(r'recentAssetIds') ? Optional.present(json[r'recentAssetIds'] is Iterable
            ? (json[r'recentAssetIds'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        recentAssetThumbhashes: json.containsKey(r'recentAssetThumbhashes') ? Optional.present(json[r'recentAssetThumbhashes'] is Iterable
            ? (json[r'recentAssetThumbhashes'] as Iterable).cast<String>().toList(growable: false)
            : const []) : const Optional.absent(),
        thumbnailAssetId: json.containsKey(r'thumbnailAssetId') ? Optional.present(mapValueOfType<String>(json, r'thumbnailAssetId')) : const Optional.absent(),
        thumbnailCropY: json.containsKey(r'thumbnailCropY') ? Optional.present(json[r'thumbnailCropY'] == null ? null : num.parse('${json[r'thumbnailCropY']}')) : const Optional.absent(),
        updatedAt: mapValueOfType<String>(json, r'updatedAt')!,
      );
    }
    return null;
  }

  static List<SharedSpaceResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceResponseDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceResponseDto-objects as value to a dart map
  static Map<String, List<SharedSpaceResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'createdAt',
    'createdById',
    'id',
    'name',
    'updatedAt',
  };
}

