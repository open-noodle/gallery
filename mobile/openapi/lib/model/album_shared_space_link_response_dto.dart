//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AlbumSharedSpaceLinkResponseDto {
  /// Returns a new [AlbumSharedSpaceLinkResponseDto] instance.
  AlbumSharedSpaceLinkResponseDto({
    required this.linkedById,
    required this.showInTimeline,
    required this.spaceId,
    required this.spaceName,
  });

  /// User who linked the album into the space
  String? linkedById;

  /// Whether the album appears in the aggregated space timeline
  bool showInTimeline;

  /// Shared space ID this album is linked into
  String spaceId;

  /// Shared space name
  String spaceName;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AlbumSharedSpaceLinkResponseDto &&
    other.linkedById == linkedById &&
    other.showInTimeline == showInTimeline &&
    other.spaceId == spaceId &&
    other.spaceName == spaceName;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (linkedById == null ? 0 : linkedById!.hashCode) +
    (showInTimeline.hashCode) +
    (spaceId.hashCode) +
    (spaceName.hashCode);

  @override
  String toString() => 'AlbumSharedSpaceLinkResponseDto[linkedById=$linkedById, showInTimeline=$showInTimeline, spaceId=$spaceId, spaceName=$spaceName]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.linkedById != null) {
      json[r'linkedById'] = this.linkedById;
    } else {
      json[r'linkedById'] = null;
    }
      json[r'showInTimeline'] = this.showInTimeline;
      json[r'spaceId'] = this.spaceId;
      json[r'spaceName'] = this.spaceName;
    return json;
  }

  /// Returns a new [AlbumSharedSpaceLinkResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AlbumSharedSpaceLinkResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AlbumSharedSpaceLinkResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AlbumSharedSpaceLinkResponseDto(
        linkedById: mapValueOfType<String>(json, r'linkedById'),
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
        spaceId: mapValueOfType<String>(json, r'spaceId')!,
        spaceName: mapValueOfType<String>(json, r'spaceName')!,
      );
    }
    return null;
  }

  static List<AlbumSharedSpaceLinkResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AlbumSharedSpaceLinkResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AlbumSharedSpaceLinkResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AlbumSharedSpaceLinkResponseDto> mapFromJson(dynamic json) {
    final map = <String, AlbumSharedSpaceLinkResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AlbumSharedSpaceLinkResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AlbumSharedSpaceLinkResponseDto-objects as value to a dart map
  static Map<String, List<AlbumSharedSpaceLinkResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AlbumSharedSpaceLinkResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AlbumSharedSpaceLinkResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'linkedById',
    'showInTimeline',
    'spaceId',
    'spaceName',
  };
}

