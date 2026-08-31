//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FamilyClusterResponseDto {
  /// Returns a new [FamilyClusterResponseDto] instance.
  FamilyClusterResponseDto({
    required this.label,
    required this.rootCandidateId,
    required this.size,
  });

  /// Display name of the cluster
  String label;

  /// A resolvable identity id in this cluster, usable as a default root
  String rootCandidateId;

  /// Total people in the cluster, resolvable or not
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int size;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FamilyClusterResponseDto &&
    other.label == label &&
    other.rootCandidateId == rootCandidateId &&
    other.size == size;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (label.hashCode) +
    (rootCandidateId.hashCode) +
    (size.hashCode);

  @override
  String toString() => 'FamilyClusterResponseDto[label=$label, rootCandidateId=$rootCandidateId, size=$size]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'label'] = this.label;
      json[r'rootCandidateId'] = this.rootCandidateId;
      json[r'size'] = this.size;
    return json;
  }

  /// Returns a new [FamilyClusterResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FamilyClusterResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "FamilyClusterResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FamilyClusterResponseDto(
        label: mapValueOfType<String>(json, r'label')!,
        rootCandidateId: mapValueOfType<String>(json, r'rootCandidateId')!,
        size: mapValueOfType<int>(json, r'size')!,
      );
    }
    return null;
  }

  static List<FamilyClusterResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FamilyClusterResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FamilyClusterResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FamilyClusterResponseDto> mapFromJson(dynamic json) {
    final map = <String, FamilyClusterResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FamilyClusterResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FamilyClusterResponseDto-objects as value to a dart map
  static Map<String, List<FamilyClusterResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FamilyClusterResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FamilyClusterResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'label',
    'rootCandidateId',
    'size',
  };
}

