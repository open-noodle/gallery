//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoExecuted {
  /// Returns a new [FaceRepairResponseDtoExecuted] instance.
  FaceRepairResponseDtoExecuted({
    required this.requeued,
    required this.unassigned,
  });

  num requeued;

  num unassigned;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoExecuted &&
    other.requeued == requeued &&
    other.unassigned == unassigned;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (requeued.hashCode) +
    (unassigned.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoExecuted[requeued=$requeued, unassigned=$unassigned]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'requeued'] = this.requeued;
      json[r'unassigned'] = this.unassigned;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoExecuted] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoExecuted? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoExecuted");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoExecuted(
        requeued: num.parse('${json[r'requeued']}'),
        unassigned: num.parse('${json[r'unassigned']}'),
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoExecuted> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoExecuted>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoExecuted.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoExecuted> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoExecuted>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoExecuted.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoExecuted-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoExecuted>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoExecuted>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoExecuted.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'requeued',
    'unassigned',
  };
}

