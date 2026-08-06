//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAssetMetadataResult {
  /// Returns a new [AgentAssetMetadataResult] instance.
  AgentAssetMetadataResult({
    this.exifInfo = const Optional.absent(),
    this.fileCreatedAt = const Optional.absent(),
    this.fileModifiedAt = const Optional.absent(),
    required this.id,
    this.isFavorite = const Optional.absent(),
    this.localDateTime = const Optional.absent(),
    this.originalFileName = const Optional.absent(),
    this.qualityInfo = const Optional.absent(),
    this.tags = const Optional.present(const []),
    this.type = const Optional.absent(),
    this.visibility = const Optional.absent(),
  });

  Optional<AgentAssetMetadataResultExifInfo?> exifInfo;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> fileCreatedAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> fileModifiedAt;

  String id;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isFavorite;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> localDateTime;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> originalFileName;

  Optional<AgentAssetMetadataQuality?> qualityInfo;

  Optional<List<AgentAssetMetadataTag>?> tags;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AssetTypeEnum?> type;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AssetVisibility?> visibility;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAssetMetadataResult &&
    other.exifInfo == exifInfo &&
    other.fileCreatedAt == fileCreatedAt &&
    other.fileModifiedAt == fileModifiedAt &&
    other.id == id &&
    other.isFavorite == isFavorite &&
    other.localDateTime == localDateTime &&
    other.originalFileName == originalFileName &&
    other.qualityInfo == qualityInfo &&
    _deepEquality.equals(other.tags, tags) &&
    other.type == type &&
    other.visibility == visibility;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (exifInfo == null ? 0 : exifInfo!.hashCode) +
    (fileCreatedAt == null ? 0 : fileCreatedAt!.hashCode) +
    (fileModifiedAt == null ? 0 : fileModifiedAt!.hashCode) +
    (id.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (localDateTime == null ? 0 : localDateTime!.hashCode) +
    (originalFileName == null ? 0 : originalFileName!.hashCode) +
    (qualityInfo == null ? 0 : qualityInfo!.hashCode) +
    (tags.hashCode) +
    (type == null ? 0 : type!.hashCode) +
    (visibility == null ? 0 : visibility!.hashCode);

  @override
  String toString() => 'AgentAssetMetadataResult[exifInfo=$exifInfo, fileCreatedAt=$fileCreatedAt, fileModifiedAt=$fileModifiedAt, id=$id, isFavorite=$isFavorite, localDateTime=$localDateTime, originalFileName=$originalFileName, qualityInfo=$qualityInfo, tags=$tags, type=$type, visibility=$visibility]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.exifInfo.isPresent) {
      final value = this.exifInfo.value;
      json[r'exifInfo'] = value;
    }
    if (this.fileCreatedAt.isPresent) {
      final value = this.fileCreatedAt.value;
      json[r'fileCreatedAt'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.fileModifiedAt.isPresent) {
      final value = this.fileModifiedAt.value;
      json[r'fileModifiedAt'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
      json[r'id'] = this.id;
    if (this.isFavorite.isPresent) {
      final value = this.isFavorite.value;
      json[r'isFavorite'] = value;
    }
    if (this.localDateTime.isPresent) {
      final value = this.localDateTime.value;
      json[r'localDateTime'] = value == null ? null : (_isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? value.millisecondsSinceEpoch
        : value.toUtc().toIso8601String());
    }
    if (this.originalFileName.isPresent) {
      final value = this.originalFileName.value;
      json[r'originalFileName'] = value;
    }
    if (this.qualityInfo.isPresent) {
      final value = this.qualityInfo.value;
      json[r'qualityInfo'] = value;
    }
    if (this.tags.isPresent) {
      final value = this.tags.value;
      json[r'tags'] = value;
    }
    if (this.type.isPresent) {
      final value = this.type.value;
      json[r'type'] = value;
    }
    if (this.visibility.isPresent) {
      final value = this.visibility.value;
      json[r'visibility'] = value;
    }
    return json;
  }

  /// Returns a new [AgentAssetMetadataResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAssetMetadataResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentAssetMetadataResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAssetMetadataResult(
        exifInfo: json.containsKey(r'exifInfo') ? Optional.present(AgentAssetMetadataResultExifInfo.fromJson(json[r'exifInfo'])) : const Optional.absent(),
        fileCreatedAt: json.containsKey(r'fileCreatedAt') ? Optional.present(mapDateTime(json, r'fileCreatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        fileModifiedAt: json.containsKey(r'fileModifiedAt') ? Optional.present(mapDateTime(json, r'fileModifiedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        id: mapValueOfType<String>(json, r'id')!,
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        localDateTime: json.containsKey(r'localDateTime') ? Optional.present(mapDateTime(json, r'localDateTime', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        originalFileName: json.containsKey(r'originalFileName') ? Optional.present(mapValueOfType<String>(json, r'originalFileName')) : const Optional.absent(),
        qualityInfo: json.containsKey(r'qualityInfo') ? Optional.present(AgentAssetMetadataQuality.fromJson(json[r'qualityInfo'])) : const Optional.absent(),
        tags: json.containsKey(r'tags') ? Optional.present(AgentAssetMetadataTag.listFromJson(json[r'tags'])) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(AssetTypeEnum.fromJson(json[r'type'])) : const Optional.absent(),
        visibility: json.containsKey(r'visibility') ? Optional.present(AssetVisibility.fromJson(json[r'visibility'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentAssetMetadataResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMetadataResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMetadataResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAssetMetadataResult> mapFromJson(dynamic json) {
    final map = <String, AgentAssetMetadataResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAssetMetadataResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAssetMetadataResult-objects as value to a dart map
  static Map<String, List<AgentAssetMetadataResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAssetMetadataResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAssetMetadataResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'id',
  };
}

