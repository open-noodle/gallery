//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanSummaryRequestDto {
  /// Returns a new [AgentOperationPlanSummaryRequestDto] instance.
  AgentOperationPlanSummaryRequestDto({
    this.focus = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> focus;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanSummaryRequestDto &&
    other.focus == focus;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (focus == null ? 0 : focus!.hashCode);

  @override
  String toString() => 'AgentOperationPlanSummaryRequestDto[focus=$focus]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.focus.isPresent) {
      final value = this.focus.value;
      json[r'focus'] = value;
    }
    return json;
  }

  /// Returns a new [AgentOperationPlanSummaryRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanSummaryRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanSummaryRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanSummaryRequestDto(
        focus: json.containsKey(r'focus') ? Optional.present(mapValueOfType<String>(json, r'focus')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentOperationPlanSummaryRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanSummaryRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanSummaryRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanSummaryRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanSummaryRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanSummaryRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanSummaryRequestDto-objects as value to a dart map
  static Map<String, List<AgentOperationPlanSummaryRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanSummaryRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanSummaryRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

