//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceTimelineHidePreviewDto {
  /// Returns a new [SharedSpaceTimelineHidePreviewDto] instance.
  SharedSpaceTimelineHidePreviewDto({
    required this.hiddenAssetCount,
  });

  /// Photos that would leave the caller's own timeline
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int hiddenAssetCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceTimelineHidePreviewDto &&
    other.hiddenAssetCount == hiddenAssetCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (hiddenAssetCount.hashCode);

  @override
  String toString() => 'SharedSpaceTimelineHidePreviewDto[hiddenAssetCount=$hiddenAssetCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'hiddenAssetCount'] = this.hiddenAssetCount;
    return json;
  }

  /// Returns a new [SharedSpaceTimelineHidePreviewDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceTimelineHidePreviewDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceTimelineHidePreviewDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceTimelineHidePreviewDto(
        hiddenAssetCount: mapValueOfType<int>(json, r'hiddenAssetCount')!,
      );
    }
    return null;
  }

  static List<SharedSpaceTimelineHidePreviewDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceTimelineHidePreviewDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceTimelineHidePreviewDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceTimelineHidePreviewDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceTimelineHidePreviewDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceTimelineHidePreviewDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceTimelineHidePreviewDto-objects as value to a dart map
  static Map<String, List<SharedSpaceTimelineHidePreviewDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceTimelineHidePreviewDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceTimelineHidePreviewDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'hiddenAssetCount',
  };
}

