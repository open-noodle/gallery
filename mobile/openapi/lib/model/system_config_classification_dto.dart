//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SystemConfigClassificationDto {
  /// Returns a new [SystemConfigClassificationDto] instance.
  SystemConfigClassificationDto({
    this.categories = const [],
    required this.enabled,
  });

  /// Classification categories
  List<SystemConfigClassificationCategoryDto> categories;

  /// Enable classification globally
  bool enabled;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SystemConfigClassificationDto &&
    _deepEquality.equals(other.categories, categories) &&
    other.enabled == enabled;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (categories.hashCode) +
    (enabled.hashCode);

  @override
  String toString() => 'SystemConfigClassificationDto[categories=$categories, enabled=$enabled]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'categories'] = this.categories;
      json[r'enabled'] = this.enabled;
    return json;
  }

  /// Returns a new [SystemConfigClassificationDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SystemConfigClassificationDto? fromJson(dynamic value) {
    upgradeDto(value, "SystemConfigClassificationDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SystemConfigClassificationDto(
        categories: SystemConfigClassificationCategoryDto.listFromJson(json[r'categories']),
        enabled: mapValueOfType<bool>(json, r'enabled')!,
      );
    }
    return null;
  }

  static List<SystemConfigClassificationDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SystemConfigClassificationDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SystemConfigClassificationDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SystemConfigClassificationDto> mapFromJson(dynamic json) {
    final map = <String, SystemConfigClassificationDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SystemConfigClassificationDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SystemConfigClassificationDto-objects as value to a dart map
  static Map<String, List<SystemConfigClassificationDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SystemConfigClassificationDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SystemConfigClassificationDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'categories',
    'enabled',
  };
}

