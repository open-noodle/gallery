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
    this.retainedAssetCount = const Optional.absent(),
  });

  /// Photos that would leave the caller's own timeline
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int hiddenAssetCount;

  /// Photos in this scope that stay on the caller's timeline via a path they did not hide
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> retainedAssetCount;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceTimelineHidePreviewDto &&
    other.hiddenAssetCount == hiddenAssetCount &&
    other.retainedAssetCount == retainedAssetCount;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (hiddenAssetCount.hashCode) +
    (retainedAssetCount == null ? 0 : retainedAssetCount!.hashCode);

  @override
  String toString() => 'SharedSpaceTimelineHidePreviewDto[hiddenAssetCount=$hiddenAssetCount, retainedAssetCount=$retainedAssetCount]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'hiddenAssetCount'] = this.hiddenAssetCount;
    if (this.retainedAssetCount.isPresent) {
      final value = this.retainedAssetCount.value;
      json[r'retainedAssetCount'] = value;
    }
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
        retainedAssetCount: json.containsKey(r'retainedAssetCount') ? Optional.present(json[r'retainedAssetCount'] == null ? null : int.parse('${json[r'retainedAssetCount']}')) : const Optional.absent(),
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

