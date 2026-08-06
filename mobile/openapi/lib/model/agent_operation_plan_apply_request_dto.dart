//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentOperationPlanApplyRequestDto {
  /// Returns a new [AgentOperationPlanApplyRequestDto] instance.
  AgentOperationPlanApplyRequestDto({
    this.fieldOverrides = const Optional.present(const {}),
    this.itemSelections = const Optional.present(const {}),
    this.operationIds = const [],
    this.planRevision = const Optional.absent(),
  });

  Optional<Map<String, Map<String, String>>?> fieldOverrides;

  Optional<Map<String, AgentOperationItemSelection>?> itemSelections;

  List<String> operationIds;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> planRevision;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentOperationPlanApplyRequestDto &&
    _deepEquality.equals(other.fieldOverrides, fieldOverrides) &&
    _deepEquality.equals(other.itemSelections, itemSelections) &&
    _deepEquality.equals(other.operationIds, operationIds) &&
    other.planRevision == planRevision;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (fieldOverrides.hashCode) +
    (itemSelections.hashCode) +
    (operationIds.hashCode) +
    (planRevision == null ? 0 : planRevision!.hashCode);

  @override
  String toString() => 'AgentOperationPlanApplyRequestDto[fieldOverrides=$fieldOverrides, itemSelections=$itemSelections, operationIds=$operationIds, planRevision=$planRevision]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.fieldOverrides.isPresent) {
      final value = this.fieldOverrides.value;
      json[r'fieldOverrides'] = value;
    }
    if (this.itemSelections.isPresent) {
      final value = this.itemSelections.value;
      json[r'itemSelections'] = value;
    }
      json[r'operationIds'] = this.operationIds;
    if (this.planRevision.isPresent) {
      final value = this.planRevision.value;
      json[r'planRevision'] = value;
    }
    return json;
  }

  /// Returns a new [AgentOperationPlanApplyRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentOperationPlanApplyRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentOperationPlanApplyRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentOperationPlanApplyRequestDto(
        fieldOverrides: json.containsKey(r'fieldOverrides') ? Optional.present(mapCastOfType<String, Map<String, String>>(json, r'fieldOverrides')) : const Optional.absent(),
        itemSelections: json.containsKey(r'itemSelections') ? Optional.present(AgentOperationItemSelection.mapFromJson(json[r'itemSelections'])) : const Optional.absent(),
        operationIds: json[r'operationIds'] is Iterable
            ? (json[r'operationIds'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        planRevision: json.containsKey(r'planRevision') ? Optional.present(json[r'planRevision'] == null ? null : int.parse('${json[r'planRevision']}')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentOperationPlanApplyRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationPlanApplyRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationPlanApplyRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentOperationPlanApplyRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentOperationPlanApplyRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentOperationPlanApplyRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentOperationPlanApplyRequestDto-objects as value to a dart map
  static Map<String, List<AgentOperationPlanApplyRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentOperationPlanApplyRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentOperationPlanApplyRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'operationIds',
  };
}

