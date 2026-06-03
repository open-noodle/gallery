//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner {
  /// Returns a new [FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner] instance.
  FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner({
    required this.count,
    required this.ownerPersonId,
  });

  num count;

  String ownerPersonId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner &&
    other.count == count &&
    other.ownerPersonId == ownerPersonId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (count.hashCode) +
    (ownerPersonId.hashCode);

  @override
  String toString() => 'FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner[count=$count, ownerPersonId=$ownerPersonId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'count'] = this.count;
      json[r'ownerPersonId'] = this.ownerPersonId;
    return json;
  }

  /// Returns a new [FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner(
        count: num.parse('${json[r'count']}'),
        ownerPersonId: mapValueOfType<String>(json, r'ownerPersonId')!,
      );
    }
    return null;
  }

  static List<FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner> mapFromJson(dynamic json) {
    final map = <String, FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner-objects as value to a dart map
  static Map<String, List<FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairResponseDtoReportPersonsInnerSuspectedOwnersInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'count',
    'ownerPersonId',
  };
}

