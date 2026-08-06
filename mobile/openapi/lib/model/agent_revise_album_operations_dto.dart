//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReviseAlbumOperationsDto {
  /// Returns a new [AgentReviseAlbumOperationsDto] instance.
  AgentReviseAlbumOperationsDto({
    this.feedback = const Optional.absent(),
    this.operations = const [],
    required this.summary,
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> feedback;

  List<AgentProposeAlbumOperationsDtoOperationsInner> operations;

  String summary;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReviseAlbumOperationsDto &&
    other.feedback == feedback &&
    _deepEquality.equals(other.operations, operations) &&
    other.summary == summary;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (feedback == null ? 0 : feedback!.hashCode) +
    (operations.hashCode) +
    (summary.hashCode);

  @override
  String toString() => 'AgentReviseAlbumOperationsDto[feedback=$feedback, operations=$operations, summary=$summary]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.feedback.isPresent) {
      final value = this.feedback.value;
      json[r'feedback'] = value;
    }
      json[r'operations'] = this.operations;
      json[r'summary'] = this.summary;
    return json;
  }

  /// Returns a new [AgentReviseAlbumOperationsDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReviseAlbumOperationsDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReviseAlbumOperationsDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReviseAlbumOperationsDto(
        feedback: json.containsKey(r'feedback') ? Optional.present(mapValueOfType<String>(json, r'feedback')) : const Optional.absent(),
        operations: AgentProposeAlbumOperationsDtoOperationsInner.listFromJson(json[r'operations']),
        summary: mapValueOfType<String>(json, r'summary')!,
      );
    }
    return null;
  }

  static List<AgentReviseAlbumOperationsDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReviseAlbumOperationsDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReviseAlbumOperationsDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReviseAlbumOperationsDto> mapFromJson(dynamic json) {
    final map = <String, AgentReviseAlbumOperationsDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReviseAlbumOperationsDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReviseAlbumOperationsDto-objects as value to a dart map
  static Map<String, List<AgentReviseAlbumOperationsDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReviseAlbumOperationsDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReviseAlbumOperationsDto.listFromJson(entry.value, growable: growable,);
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

