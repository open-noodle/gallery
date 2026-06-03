//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class FaceRepairRequestDto {
  /// Returns a new [FaceRepairRequestDto] instance.
  FaceRepairRequestDto({
    this.dryRun = true,
    this.maxAttributionDistance,
    this.maxDistance,
    this.maxFlaggedFraction,
    this.minFaces,
    this.ownerId,
    this.personId,
    this.voteMargin,
    this.voteWindow,
  });

  bool dryRun;

  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? maxAttributionDistance;

  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? maxDistance;

  /// Minimum value: 0
  /// Maximum value: 1
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  num? maxFlaggedFraction;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? minFaces;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? ownerId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? personId;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? voteMargin;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  int? voteWindow;

  @override
  bool operator ==(Object other) => identical(this, other) || other is FaceRepairRequestDto &&
    other.dryRun == dryRun &&
    other.maxAttributionDistance == maxAttributionDistance &&
    other.maxDistance == maxDistance &&
    other.maxFlaggedFraction == maxFlaggedFraction &&
    other.minFaces == minFaces &&
    other.ownerId == ownerId &&
    other.personId == personId &&
    other.voteMargin == voteMargin &&
    other.voteWindow == voteWindow;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (dryRun.hashCode) +
    (maxAttributionDistance == null ? 0 : maxAttributionDistance!.hashCode) +
    (maxDistance == null ? 0 : maxDistance!.hashCode) +
    (maxFlaggedFraction == null ? 0 : maxFlaggedFraction!.hashCode) +
    (minFaces == null ? 0 : minFaces!.hashCode) +
    (ownerId == null ? 0 : ownerId!.hashCode) +
    (personId == null ? 0 : personId!.hashCode) +
    (voteMargin == null ? 0 : voteMargin!.hashCode) +
    (voteWindow == null ? 0 : voteWindow!.hashCode);

  @override
  String toString() => 'FaceRepairRequestDto[dryRun=$dryRun, maxAttributionDistance=$maxAttributionDistance, maxDistance=$maxDistance, maxFlaggedFraction=$maxFlaggedFraction, minFaces=$minFaces, ownerId=$ownerId, personId=$personId, voteMargin=$voteMargin, voteWindow=$voteWindow]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'dryRun'] = this.dryRun;
    if (this.maxAttributionDistance != null) {
      json[r'maxAttributionDistance'] = this.maxAttributionDistance;
    } else {
    //  json[r'maxAttributionDistance'] = null;
    }
    if (this.maxDistance != null) {
      json[r'maxDistance'] = this.maxDistance;
    } else {
    //  json[r'maxDistance'] = null;
    }
    if (this.maxFlaggedFraction != null) {
      json[r'maxFlaggedFraction'] = this.maxFlaggedFraction;
    } else {
    //  json[r'maxFlaggedFraction'] = null;
    }
    if (this.minFaces != null) {
      json[r'minFaces'] = this.minFaces;
    } else {
    //  json[r'minFaces'] = null;
    }
    if (this.ownerId != null) {
      json[r'ownerId'] = this.ownerId;
    } else {
    //  json[r'ownerId'] = null;
    }
    if (this.personId != null) {
      json[r'personId'] = this.personId;
    } else {
    //  json[r'personId'] = null;
    }
    if (this.voteMargin != null) {
      json[r'voteMargin'] = this.voteMargin;
    } else {
    //  json[r'voteMargin'] = null;
    }
    if (this.voteWindow != null) {
      json[r'voteWindow'] = this.voteWindow;
    } else {
    //  json[r'voteWindow'] = null;
    }
    return json;
  }

  /// Returns a new [FaceRepairRequestDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static FaceRepairRequestDto? fromJson(dynamic value) {
    upgradeDto(value, "FaceRepairRequestDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return FaceRepairRequestDto(
        dryRun: mapValueOfType<bool>(json, r'dryRun') ?? true,
        maxAttributionDistance: json[r'maxAttributionDistance'] == null
            ? null
            : num.parse('${json[r'maxAttributionDistance']}'),
        maxDistance: json[r'maxDistance'] == null
            ? null
            : num.parse('${json[r'maxDistance']}'),
        maxFlaggedFraction: json[r'maxFlaggedFraction'] == null
            ? null
            : num.parse('${json[r'maxFlaggedFraction']}'),
        minFaces: mapValueOfType<int>(json, r'minFaces'),
        ownerId: mapValueOfType<String>(json, r'ownerId'),
        personId: mapValueOfType<String>(json, r'personId'),
        voteMargin: mapValueOfType<int>(json, r'voteMargin'),
        voteWindow: mapValueOfType<int>(json, r'voteWindow'),
      );
    }
    return null;
  }

  static List<FaceRepairRequestDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <FaceRepairRequestDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = FaceRepairRequestDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, FaceRepairRequestDto> mapFromJson(dynamic json) {
    final map = <String, FaceRepairRequestDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = FaceRepairRequestDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of FaceRepairRequestDto-objects as value to a dart map
  static Map<String, List<FaceRepairRequestDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<FaceRepairRequestDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = FaceRepairRequestDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

