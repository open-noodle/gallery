//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AssetEditableResponseDto {
  /// Returns a new [AssetEditableResponseDto] instance.
  AssetEditableResponseDto({
    this.editableAssetIds = const [],
  });

  /// Subset of the requested IDs the caller may edit
  List<String> editableAssetIds;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AssetEditableResponseDto &&
    _deepEquality.equals(other.editableAssetIds, editableAssetIds);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (editableAssetIds.hashCode);

  @override
  String toString() => 'AssetEditableResponseDto[editableAssetIds=$editableAssetIds]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'editableAssetIds'] = this.editableAssetIds;
    return json;
  }

  /// Returns a new [AssetEditableResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AssetEditableResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AssetEditableResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AssetEditableResponseDto(
        editableAssetIds: json[r'editableAssetIds'] is Iterable
            ? (json[r'editableAssetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
      );
    }
    return null;
  }

  static List<AssetEditableResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AssetEditableResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AssetEditableResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AssetEditableResponseDto> mapFromJson(dynamic json) {
    final map = <String, AssetEditableResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AssetEditableResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AssetEditableResponseDto-objects as value to a dart map
  static Map<String, List<AssetEditableResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AssetEditableResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AssetEditableResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'editableAssetIds',
  };
}

