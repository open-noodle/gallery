//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class DissolveResponseDtoCounts {
  /// Returns a new [DissolveResponseDtoCounts] instance.
  DissolveResponseDtoCounts({
    required this.assets,
    required this.exif,
    required this.faces,
    required this.mlWithEmbedding,
    required this.mlWithoutEmbedding,
    required this.notRedetectable,
    required this.remainingLiveFaces,
    required this.sharedAssets,
    required this.softDeleted,
  });

  num assets;

  num exif;

  num faces;

  num mlWithEmbedding;

  num mlWithoutEmbedding;

  num notRedetectable;

  num remainingLiveFaces;

  num sharedAssets;

  num softDeleted;

  @override
  bool operator ==(Object other) => identical(this, other) || other is DissolveResponseDtoCounts &&
    other.assets == assets &&
    other.exif == exif &&
    other.faces == faces &&
    other.mlWithEmbedding == mlWithEmbedding &&
    other.mlWithoutEmbedding == mlWithoutEmbedding &&
    other.notRedetectable == notRedetectable &&
    other.remainingLiveFaces == remainingLiveFaces &&
    other.sharedAssets == sharedAssets &&
    other.softDeleted == softDeleted;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assets.hashCode) +
    (exif.hashCode) +
    (faces.hashCode) +
    (mlWithEmbedding.hashCode) +
    (mlWithoutEmbedding.hashCode) +
    (notRedetectable.hashCode) +
    (remainingLiveFaces.hashCode) +
    (sharedAssets.hashCode) +
    (softDeleted.hashCode);

  @override
  String toString() => 'DissolveResponseDtoCounts[assets=$assets, exif=$exif, faces=$faces, mlWithEmbedding=$mlWithEmbedding, mlWithoutEmbedding=$mlWithoutEmbedding, notRedetectable=$notRedetectable, remainingLiveFaces=$remainingLiveFaces, sharedAssets=$sharedAssets, softDeleted=$softDeleted]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assets'] = this.assets;
      json[r'exif'] = this.exif;
      json[r'faces'] = this.faces;
      json[r'mlWithEmbedding'] = this.mlWithEmbedding;
      json[r'mlWithoutEmbedding'] = this.mlWithoutEmbedding;
      json[r'notRedetectable'] = this.notRedetectable;
      json[r'remainingLiveFaces'] = this.remainingLiveFaces;
      json[r'sharedAssets'] = this.sharedAssets;
      json[r'softDeleted'] = this.softDeleted;
    return json;
  }

  /// Returns a new [DissolveResponseDtoCounts] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static DissolveResponseDtoCounts? fromJson(dynamic value) {
    upgradeDto(value, "DissolveResponseDtoCounts");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return DissolveResponseDtoCounts(
        assets: num.parse('${json[r'assets']}'),
        exif: num.parse('${json[r'exif']}'),
        faces: num.parse('${json[r'faces']}'),
        mlWithEmbedding: num.parse('${json[r'mlWithEmbedding']}'),
        mlWithoutEmbedding: num.parse('${json[r'mlWithoutEmbedding']}'),
        notRedetectable: num.parse('${json[r'notRedetectable']}'),
        remainingLiveFaces: num.parse('${json[r'remainingLiveFaces']}'),
        sharedAssets: num.parse('${json[r'sharedAssets']}'),
        softDeleted: num.parse('${json[r'softDeleted']}'),
      );
    }
    return null;
  }

  static List<DissolveResponseDtoCounts> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <DissolveResponseDtoCounts>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = DissolveResponseDtoCounts.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, DissolveResponseDtoCounts> mapFromJson(dynamic json) {
    final map = <String, DissolveResponseDtoCounts>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = DissolveResponseDtoCounts.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of DissolveResponseDtoCounts-objects as value to a dart map
  static Map<String, List<DissolveResponseDtoCounts>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<DissolveResponseDtoCounts>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = DissolveResponseDtoCounts.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assets',
    'exif',
    'faces',
    'mlWithEmbedding',
    'mlWithoutEmbedding',
    'notRedetectable',
    'remainingLiveFaces',
    'sharedAssets',
    'softDeleted',
  };
}

