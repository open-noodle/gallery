//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigStorageUsageDto {
  /// Returns a new [SystemConfigStorageUsageDto] instance.
  SystemConfigStorageUsageDto({
    required this.includeDerivatives,
  });

  /// Include thumbnails and transcoded videos in storage usage
  bool includeDerivatives;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigStorageUsageDto &&
    other.includeDerivatives == includeDerivatives;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (includeDerivatives.hashCode);

  @override
  String toString() => 'SystemConfigStorageUsageDto[includeDerivatives=$includeDerivatives]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'includeDerivatives'] = this.includeDerivatives;
    return json;
  }

  /// Returns a new [SystemConfigStorageUsageDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigStorageUsageDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigStorageUsageDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigStorageUsageDto(
        includeDerivatives: mapValueOfType<bool>(json, r'includeDerivatives')!,
      );
    }
    return null;
  }

  static List<SystemConfigStorageUsageDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigStorageUsageDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigStorageUsageDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigStorageUsageDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigStorageUsageDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigStorageUsageDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigStorageUsageDto-objects as value to a dart map
  static Map<String, List<SystemConfigStorageUsageDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigStorageUsageDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigStorageUsageDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'includeDerivatives',
  };
}

