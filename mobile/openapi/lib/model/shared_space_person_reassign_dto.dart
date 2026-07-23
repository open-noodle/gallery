//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpacePersonReassignDto {
  /// Returns a new [SharedSpacePersonReassignDto] instance.
  SharedSpacePersonReassignDto({
    this.assetIds = const [],
    required this.target,
  });

  /// Assets whose face on this person is misassigned
  List<String> assetIds;

  SharedSpacePersonReassignDtoTarget target;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpacePersonReassignDto &&
    _deepEquality.equals(other.assetIds, assetIds) &&
    other.target == target;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetIds.hashCode) +
    (target.hashCode);

  @override
  String toString() => 'SharedSpacePersonReassignDto[assetIds=$assetIds, target=$target]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetIds'] = this.assetIds;
      json[r'target'] = this.target;
    return json;
  }

  /// Returns a new [SharedSpacePersonReassignDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpacePersonReassignDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpacePersonReassignDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpacePersonReassignDto(
        assetIds: json[r'assetIds'] is Iterable
            ? (json[r'assetIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        target: SharedSpacePersonReassignDtoTarget.fromJson(json[r'target'])!,
      );
    }
    return null;
  }

  static List<SharedSpacePersonReassignDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpacePersonReassignDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpacePersonReassignDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpacePersonReassignDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpacePersonReassignDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpacePersonReassignDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpacePersonReassignDto-objects as value to a dart map
  static Map<String, List<SharedSpacePersonReassignDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpacePersonReassignDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpacePersonReassignDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetIds',
    'target',
  };
}

