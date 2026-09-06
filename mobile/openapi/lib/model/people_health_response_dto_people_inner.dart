//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class PeopleHealthResponseDtoPeopleInner {
  /// Returns a new [PeopleHealthResponseDtoPeopleInner] instance.
  PeopleHealthResponseDtoPeopleInner({
    required this.exif,
    required this.faceCount,
    required this.facesWithoutEmbedding,
    required this.id,
    required this.machineLearning,
    required this.manual,
    required this.name,
    required this.ownerId,
  });

  num exif;

  num faceCount;

  num facesWithoutEmbedding;

  String id;

  num machineLearning;

  num manual;

  String name;

  String ownerId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is PeopleHealthResponseDtoPeopleInner &&
    other.exif == exif &&
    other.faceCount == faceCount &&
    other.facesWithoutEmbedding == facesWithoutEmbedding &&
    other.id == id &&
    other.machineLearning == machineLearning &&
    other.manual == manual &&
    other.name == name &&
    other.ownerId == ownerId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (exif.hashCode) +
    (faceCount.hashCode) +
    (facesWithoutEmbedding.hashCode) +
    (id.hashCode) +
    (machineLearning.hashCode) +
    (manual.hashCode) +
    (name.hashCode) +
    (ownerId.hashCode);

  @override
  String toString() => 'PeopleHealthResponseDtoPeopleInner[exif=$exif, faceCount=$faceCount, facesWithoutEmbedding=$facesWithoutEmbedding, id=$id, machineLearning=$machineLearning, manual=$manual, name=$name, ownerId=$ownerId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'exif'] = this.exif;
      json[r'faceCount'] = this.faceCount;
      json[r'facesWithoutEmbedding'] = this.facesWithoutEmbedding;
      json[r'id'] = this.id;
      json[r'machineLearning'] = this.machineLearning;
      json[r'manual'] = this.manual;
      json[r'name'] = this.name;
      json[r'ownerId'] = this.ownerId;
    return json;
  }

  /// Returns a new [PeopleHealthResponseDtoPeopleInner] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static PeopleHealthResponseDtoPeopleInner? fromJson(dynamic value) {
    upgradeDto(value, "PeopleHealthResponseDtoPeopleInner");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return PeopleHealthResponseDtoPeopleInner(
        exif: num.parse('${json[r'exif']}'),
        faceCount: num.parse('${json[r'faceCount']}'),
        facesWithoutEmbedding: num.parse('${json[r'facesWithoutEmbedding']}'),
        id: mapValueOfType<String>(json, r'id')!,
        machineLearning: num.parse('${json[r'machineLearning']}'),
        manual: num.parse('${json[r'manual']}'),
        name: mapValueOfType<String>(json, r'name')!,
        ownerId: mapValueOfType<String>(json, r'ownerId')!,
      );
    }
    return null;
  }

  static List<PeopleHealthResponseDtoPeopleInner> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <PeopleHealthResponseDtoPeopleInner>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = PeopleHealthResponseDtoPeopleInner.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, PeopleHealthResponseDtoPeopleInner> mapFromJson(dynamic json) {
    final map = <String, PeopleHealthResponseDtoPeopleInner>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = PeopleHealthResponseDtoPeopleInner.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of PeopleHealthResponseDtoPeopleInner-objects as value to a dart map
  static Map<String, List<PeopleHealthResponseDtoPeopleInner>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<PeopleHealthResponseDtoPeopleInner>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = PeopleHealthResponseDtoPeopleInner.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'exif',
    'faceCount',
    'facesWithoutEmbedding',
    'id',
    'machineLearning',
    'manual',
    'name',
    'ownerId',
  };
}

