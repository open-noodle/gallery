//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceAlbumMemberTimelineDto {
  /// Returns a new [SharedSpaceAlbumMemberTimelineDto] instance.
  SharedSpaceAlbumMemberTimelineDto({
    required this.showInTimeline,
  });

  /// Show this album's assets in your own personal timeline
  bool showInTimeline;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceAlbumMemberTimelineDto &&
    other.showInTimeline == showInTimeline;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (showInTimeline.hashCode);

  @override
  String toString() => 'SharedSpaceAlbumMemberTimelineDto[showInTimeline=$showInTimeline]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'showInTimeline'] = this.showInTimeline;
    return json;
  }

  /// Returns a new [SharedSpaceAlbumMemberTimelineDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceAlbumMemberTimelineDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceAlbumMemberTimelineDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceAlbumMemberTimelineDto(
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
      );
    }
    return null;
  }

  static List<SharedSpaceAlbumMemberTimelineDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceAlbumMemberTimelineDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceAlbumMemberTimelineDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceAlbumMemberTimelineDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceAlbumMemberTimelineDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceAlbumMemberTimelineDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceAlbumMemberTimelineDto-objects as value to a dart map
  static Map<String, List<SharedSpaceAlbumMemberTimelineDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceAlbumMemberTimelineDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceAlbumMemberTimelineDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'showInTimeline',
  };
}

