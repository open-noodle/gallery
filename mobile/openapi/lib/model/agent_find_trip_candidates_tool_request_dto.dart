//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentFindTripCandidatesToolRequestDto {
  /// Returns a new [AgentFindTripCandidatesToolRequestDto] instance.
  AgentFindTripCandidatesToolRequestDto({
    this.lookbackDays = const Optional.absent(),
    this.maxCandidates = const Optional.absent(),
    this.placeHint = const Optional.absent(),
    this.targetDate = const Optional.absent(),
    this.toolCallId = const Optional.absent(),
  });

  /// Minimum value: 1
  /// Maximum value: 365
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> lookbackDays;

  /// Minimum value: 1
  /// Maximum value: 10
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> maxCandidates;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> placeHint;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> targetDate;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> toolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentFindTripCandidatesToolRequestDto &&
    other.lookbackDays == lookbackDays &&
    other.maxCandidates == maxCandidates &&
    other.placeHint == placeHint &&
    other.targetDate == targetDate &&
    other.toolCallId == toolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (lookbackDays == null ? 0 : lookbackDays!.hashCode) +
    (maxCandidates == null ? 0 : maxCandidates!.hashCode) +
    (placeHint == null ? 0 : placeHint!.hashCode) +
    (targetDate == null ? 0 : targetDate!.hashCode) +
    (toolCallId == null ? 0 : toolCallId!.hashCode);

  @override
  String toString() => 'AgentFindTripCandidatesToolRequestDto[lookbackDays=$lookbackDays, maxCandidates=$maxCandidates, placeHint=$placeHint, targetDate=$targetDate, toolCallId=$toolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.lookbackDays.isPresent) {
      final value = this.lookbackDays.value;
      json[r'lookbackDays'] = value;
    }
    if (this.maxCandidates.isPresent) {
      final value = this.maxCandidates.value;
      json[r'maxCandidates'] = value;
    }
    if (this.placeHint.isPresent) {
      final value = this.placeHint.value;
      json[r'placeHint'] = value;
    }
    if (this.targetDate.isPresent) {
      final value = this.targetDate.value;
      json[r'targetDate'] = value;
    }
    if (this.toolCallId.isPresent) {
      final value = this.toolCallId.value;
      json[r'toolCallId'] = value;
    }
    return json;
  }

  /// Returns a new [AgentFindTripCandidatesToolRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentFindTripCandidatesToolRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentFindTripCandidatesToolRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentFindTripCandidatesToolRequestDto(
        lookbackDays: json.containsKey(r'lookbackDays') ? Optional.present(json[r'lookbackDays'] == null ? null : int.parse('${json[r'lookbackDays']}')) : const Optional.absent(),
        maxCandidates: json.containsKey(r'maxCandidates') ? Optional.present(json[r'maxCandidates'] == null ? null : int.parse('${json[r'maxCandidates']}')) : const Optional.absent(),
        placeHint: json.containsKey(r'placeHint') ? Optional.present(mapValueOfType<String>(json, r'placeHint')) : const Optional.absent(),
        targetDate: json.containsKey(r'targetDate') ? Optional.present(mapValueOfType<String>(json, r'targetDate')) : const Optional.absent(),
        toolCallId: json.containsKey(r'toolCallId') ? Optional.present(mapValueOfType<String>(json, r'toolCallId')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentFindTripCandidatesToolRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentFindTripCandidatesToolRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentFindTripCandidatesToolRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentFindTripCandidatesToolRequestDto> mapFromJson(dynamic json) {
    final map = <String, AgentFindTripCandidatesToolRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentFindTripCandidatesToolRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentFindTripCandidatesToolRequestDto-objects as value to a dart map
  static Map<String, List<AgentFindTripCandidatesToolRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentFindTripCandidatesToolRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentFindTripCandidatesToolRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

