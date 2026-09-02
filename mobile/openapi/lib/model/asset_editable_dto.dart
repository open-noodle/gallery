//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetEditableDto {
  /// Returns a new [AssetEditableDto] instance.
  AssetEditableDto({
    this.assetIds = const [],
  });

  /// Asset IDs to resolve editability for
  List<String> assetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetEditableDto &&
    _deepEquality.equals(other.assetIds, assetIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode);

  @override
  String toString() => 'AssetEditableDto[assetIds=$assetIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
    return json;
  }

  /// Returns a new [AssetEditableDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetEditableDto? fromJson(dynamic value) {
    upgradeDto(value, "AssetEditableDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetEditableDto(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AssetEditableDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetEditableDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetEditableDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetEditableDto> mapFromJson(dynamic json) {
    final map = <String, AssetEditableDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetEditableDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetEditableDto-objects as value to a dart map
  static Map<String, List<AssetEditableDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetEditableDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetEditableDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
  };
}

