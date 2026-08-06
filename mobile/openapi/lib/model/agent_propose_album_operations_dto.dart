//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDto {
  /// Returns a new [AgentProposeAlbumOperationsDto] instance.
  AgentProposeAlbumOperationsDto({
    this.operations = const [],
    required this.summary,
  });

  List<AgentProposeAlbumOperationsDtoOperationsInner> operations;

  String summary;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDto &&
    _deepEquality.equals(other.operations, operations) &&
    other.summary == summary;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (operations.hashCode) +
    (summary.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDto[operations=$operations, summary=$summary]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'operations'] = this.operations;
      json[r'summary'] = this.summary;
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDto(
        operations: AgentProposeAlbumOperationsDtoOperationsInner.listFromJson(json[r'operations']),
        summary: mapValueOfType<String>(json, r'summary')!,
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDto> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDto-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'operations',
    'summary',
  };
}

