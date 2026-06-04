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
    this.dryRun = const Optional.present(true),
    this.maxAttributionDistance = const Optional.absent(),
    this.maxDistance = const Optional.absent(),
    this.maxFlaggedFraction = const Optional.absent(),
    this.minFaces = const Optional.absent(),
    this.ownerId = const Optional.absent(),
    this.personId = const Optional.absent(),
    this.voteMargin = const Optional.absent(),
    this.voteWindow = const Optional.absent(),
  });

  Optional<bool?> dryRun;

  /// Minimum value: 0
  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> maxAttributionDistance;

  /// Minimum value: 0
  /// Maximum value: 2
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> maxDistance;

  /// Minimum value: 0
  /// Maximum value: 1
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<num?> maxFlaggedFraction;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> minFaces;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> ownerId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> personId;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> voteMargin;

  /// Minimum value: 1
  /// Maximum value: 9007199254740991
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<int?> voteWindow;

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
    if (this.dryRun.isPresent) {
      final value = this.dryRun.value;
      json[r'dryRun'] = value;
    }
    if (this.maxAttributionDistance.isPresent) {
      final value = this.maxAttributionDistance.value;
      json[r'maxAttributionDistance'] = value;
    }
    if (this.maxDistance.isPresent) {
      final value = this.maxDistance.value;
      json[r'maxDistance'] = value;
    }
    if (this.maxFlaggedFraction.isPresent) {
      final value = this.maxFlaggedFraction.value;
      json[r'maxFlaggedFraction'] = value;
    }
    if (this.minFaces.isPresent) {
      final value = this.minFaces.value;
      json[r'minFaces'] = value;
    }
    if (this.ownerId.isPresent) {
      final value = this.ownerId.value;
      json[r'ownerId'] = value;
    }
    if (this.personId.isPresent) {
      final value = this.personId.value;
      json[r'personId'] = value;
    }
    if (this.voteMargin.isPresent) {
      final value = this.voteMargin.value;
      json[r'voteMargin'] = value;
    }
    if (this.voteWindow.isPresent) {
      final value = this.voteWindow.value;
      json[r'voteWindow'] = value;
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
        dryRun: json.containsKey(r'dryRun') ? Optional.present(mapValueOfType<bool>(json, r'dryRun')) : const Optional.absent(),
        maxAttributionDistance: json.containsKey(r'maxAttributionDistance') ? Optional.present(json[r'maxAttributionDistance'] == null ? null : num.parse('${json[r'maxAttributionDistance']}')) : const Optional.absent(),
        maxDistance: json.containsKey(r'maxDistance') ? Optional.present(json[r'maxDistance'] == null ? null : num.parse('${json[r'maxDistance']}')) : const Optional.absent(),
        maxFlaggedFraction: json.containsKey(r'maxFlaggedFraction') ? Optional.present(json[r'maxFlaggedFraction'] == null ? null : num.parse('${json[r'maxFlaggedFraction']}')) : const Optional.absent(),
        minFaces: json.containsKey(r'minFaces') ? Optional.present(json[r'minFaces'] == null ? null : int.parse('${json[r'minFaces']}')) : const Optional.absent(),
        ownerId: json.containsKey(r'ownerId') ? Optional.present(mapValueOfType<String>(json, r'ownerId')) : const Optional.absent(),
        personId: json.containsKey(r'personId') ? Optional.present(mapValueOfType<String>(json, r'personId')) : const Optional.absent(),
        voteMargin: json.containsKey(r'voteMargin') ? Optional.present(json[r'voteMargin'] == null ? null : int.parse('${json[r'voteMargin']}')) : const Optional.absent(),
        voteWindow: json.containsKey(r'voteWindow') ? Optional.present(json[r'voteWindow'] == null ? null : int.parse('${json[r'voteWindow']}')) : const Optional.absent(),
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

