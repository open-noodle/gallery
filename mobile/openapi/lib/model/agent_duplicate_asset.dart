//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentDuplicateAsset {
  /// Returns a new [AgentDuplicateAsset] instance.
  AgentDuplicateAsset({
    required this.fileCreatedAt,
    required this.height,
    required this.id,
    required this.isFavorite,
    required this.originalFileName,
    required this.rating,
    required this.sharpness,
    required this.width,
  });

  DateTime fileCreatedAt;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? height;

  String id;

  bool isFavorite;

  String originalFileName;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? rating;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? sharpness;

  /// Minimum value: -9007199254740991
  /// Maximum value: 9007199254740991
  int? width;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentDuplicateAsset &&
    other.fileCreatedAt == fileCreatedAt &&
    other.height == height &&
    other.id == id &&
    other.isFavorite == isFavorite &&
    other.originalFileName == originalFileName &&
    other.rating == rating &&
    other.sharpness == sharpness &&
    other.width == width;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (fileCreatedAt.hashCode) +
    (height == null ? 0 : height!.hashCode) +
    (id.hashCode) +
    (isFavorite.hashCode) +
    (originalFileName.hashCode) +
    (rating == null ? 0 : rating!.hashCode) +
    (sharpness == null ? 0 : sharpness!.hashCode) +
    (width == null ? 0 : width!.hashCode);

  @override
  String toString() => 'AgentDuplicateAsset[fileCreatedAt=$fileCreatedAt, height=$height, id=$id, isFavorite=$isFavorite, originalFileName=$originalFileName, rating=$rating, sharpness=$sharpness, width=$width]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'fileCreatedAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.fileCreatedAt.millisecondsSinceEpoch
        : this.fileCreatedAt.toUtc().toIso8601String();
    if (this.height != null) {
      json[r'height'] = this.height;
    } else {
    //  json[r'height'] = null;
    }
      json[r'id'] = this.id;
      json[r'isFavorite'] = this.isFavorite;
      json[r'originalFileName'] = this.originalFileName;
    if (this.rating != null) {
      json[r'rating'] = this.rating;
    } else {
    //  json[r'rating'] = null;
    }
    if (this.sharpness != null) {
      json[r'sharpness'] = this.sharpness;
    } else {
    //  json[r'sharpness'] = null;
    }
    if (this.width != null) {
      json[r'width'] = this.width;
    } else {
    //  json[r'width'] = null;
    }
    return json;
  }

  /// Returns a new [AgentDuplicateAsset] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentDuplicateAsset? fromJson(dynamic value) {
    upgradeDto(value, "AgentDuplicateAsset");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentDuplicateAsset(
        fileCreatedAt: mapDateTime(json, r'fileCreatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        height: mapValueOfType<int>(json, r'height'),
        id: mapValueOfType<String>(json, r'id')!,
        isFavorite: mapValueOfType<bool>(json, r'isFavorite')!,
        originalFileName: mapValueOfType<String>(json, r'originalFileName')!,
        rating: mapValueOfType<int>(json, r'rating'),
        sharpness: mapValueOfType<int>(json, r'sharpness'),
        width: mapValueOfType<int>(json, r'width'),
      );
    }
    return null;
  }

  static List<AgentDuplicateAsset> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentDuplicateAsset>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentDuplicateAsset.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentDuplicateAsset> mapFromJson(dynamic json) {
    final map = <String, AgentDuplicateAsset>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentDuplicateAsset.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentDuplicateAsset-objects as value to a dart map
  static Map<String, List<AgentDuplicateAsset>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentDuplicateAsset>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentDuplicateAsset.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'fileCreatedAt',
    'height',
    'id',
    'isFavorite',
    'originalFileName',
    'rating',
    'sharpness',
    'width',
  };
}

