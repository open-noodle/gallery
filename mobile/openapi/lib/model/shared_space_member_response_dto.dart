//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceMemberResponseDto {
  /// Returns a new [SharedSpaceMemberResponseDto] instance.
  SharedSpaceMemberResponseDto({
    this.avatarColor = const Optional.absent(),
    this.contributionCount = const Optional.absent(),
    required this.email,
    required this.joinedAt,
    this.lastActiveAt = const Optional.absent(),
    required this.name,
    this.profileChangedAt = const Optional.absent(),
    this.profileImagePath = const Optional.absent(),
    this.recentAssetId = const Optional.absent(),
    required this.role,
    required this.sharePersonMetadata,
    required this.showInTimeline,
    required this.userId,
  });

  /// Avatar color
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> avatarColor;

  /// Number of photos contributed by this member
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> contributionCount;

  /// User email
  String email;

  /// Join date
  String joinedAt;

  /// Last time this member added a photo
  Optional<String?> lastActiveAt;

  /// User name
  String name;

  /// Profile change date
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> profileChangedAt;

  /// Profile image path
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> profileImagePath;

  /// Most recently added asset ID by this member
  Optional<String?> recentAssetId;

  SharedSpaceRole role;

  /// Share person names and birth dates with this space
  bool sharePersonMetadata;

  /// Show space assets in timeline
  bool showInTimeline;

  /// User ID
  String userId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceMemberResponseDto &&
    other.avatarColor == avatarColor &&
    other.contributionCount == contributionCount &&
    other.email == email &&
    other.joinedAt == joinedAt &&
    other.lastActiveAt == lastActiveAt &&
    other.name == name &&
    other.profileChangedAt == profileChangedAt &&
    other.profileImagePath == profileImagePath &&
    other.recentAssetId == recentAssetId &&
    other.role == role &&
    other.sharePersonMetadata == sharePersonMetadata &&
    other.showInTimeline == showInTimeline &&
    other.userId == userId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (avatarColor == null ? 0 : avatarColor!.hashCode) +
    (contributionCount == null ? 0 : contributionCount!.hashCode) +
    (email.hashCode) +
    (joinedAt.hashCode) +
    (lastActiveAt == null ? 0 : lastActiveAt!.hashCode) +
    (name.hashCode) +
    (profileChangedAt == null ? 0 : profileChangedAt!.hashCode) +
    (profileImagePath == null ? 0 : profileImagePath!.hashCode) +
    (recentAssetId == null ? 0 : recentAssetId!.hashCode) +
    (role.hashCode) +
    (sharePersonMetadata.hashCode) +
    (showInTimeline.hashCode) +
    (userId.hashCode);

  @override
  String toString() => 'SharedSpaceMemberResponseDto[avatarColor=$avatarColor, contributionCount=$contributionCount, email=$email, joinedAt=$joinedAt, lastActiveAt=$lastActiveAt, name=$name, profileChangedAt=$profileChangedAt, profileImagePath=$profileImagePath, recentAssetId=$recentAssetId, role=$role, sharePersonMetadata=$sharePersonMetadata, showInTimeline=$showInTimeline, userId=$userId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.avatarColor.isPresent) {
      final value = this.avatarColor.value;
      json[r'avatarColor'] = value;
    }
    if (this.contributionCount.isPresent) {
      final value = this.contributionCount.value;
      json[r'contributionCount'] = value;
    }
      json[r'email'] = this.email;
      json[r'joinedAt'] = this.joinedAt;
    if (this.lastActiveAt.isPresent) {
      final value = this.lastActiveAt.value;
      json[r'lastActiveAt'] = value;
    }
      json[r'name'] = this.name;
    if (this.profileChangedAt.isPresent) {
      final value = this.profileChangedAt.value;
      json[r'profileChangedAt'] = value;
    }
    if (this.profileImagePath.isPresent) {
      final value = this.profileImagePath.value;
      json[r'profileImagePath'] = value;
    }
    if (this.recentAssetId.isPresent) {
      final value = this.recentAssetId.value;
      json[r'recentAssetId'] = value;
    }
      json[r'role'] = this.role;
      json[r'sharePersonMetadata'] = this.sharePersonMetadata;
      json[r'showInTimeline'] = this.showInTimeline;
      json[r'userId'] = this.userId;
    return json;
  }

  /// Returns a new [SharedSpaceMemberResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceMemberResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceMemberResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceMemberResponseDto(
        avatarColor: json.containsKey(r'avatarColor') ? Optional.present(mapValueOfType<String>(json, r'avatarColor')) : const Optional.absent(),
        contributionCount: json.containsKey(r'contributionCount') ? Optional.present(json[r'contributionCount'] == null ? null : num.parse('${json[r'contributionCount']}')) : const Optional.absent(),
        email: mapValueOfType<String>(json, r'email')!,
        joinedAt: mapValueOfType<String>(json, r'joinedAt')!,
        lastActiveAt: json.containsKey(r'lastActiveAt') ? Optional.present(mapValueOfType<String>(json, r'lastActiveAt')) : const Optional.absent(),
        name: mapValueOfType<String>(json, r'name')!,
        profileChangedAt: json.containsKey(r'profileChangedAt') ? Optional.present(mapValueOfType<String>(json, r'profileChangedAt')) : const Optional.absent(),
        profileImagePath: json.containsKey(r'profileImagePath') ? Optional.present(mapValueOfType<String>(json, r'profileImagePath')) : const Optional.absent(),
        recentAssetId: json.containsKey(r'recentAssetId') ? Optional.present(mapValueOfType<String>(json, r'recentAssetId')) : const Optional.absent(),
        role: SharedSpaceRole.fromJson(json[r'role'])!,
        sharePersonMetadata: mapValueOfType<bool>(json, r'sharePersonMetadata')!,
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
        userId: mapValueOfType<String>(json, r'userId')!,
      );
    }
    return null;
  }

  static List<SharedSpaceMemberResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceMemberResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceMemberResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceMemberResponseDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceMemberResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceMemberResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceMemberResponseDto-objects as value to a dart map
  static Map<String, List<SharedSpaceMemberResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceMemberResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceMemberResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'email',
    'joinedAt',
    'name',
    'role',
    'sharePersonMetadata',
    'showInTimeline',
    'userId',
  };
}

