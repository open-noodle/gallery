//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsSampleItem {
  /// Returns a new [AgentSearchAssetsSampleItem] instance.
  AgentSearchAssetsSampleItem({
    this.exifInfo = const Optional.absent(),
    this.fileCreatedAt = const Optional.absent(),
    this.fileModifiedAt = const Optional.absent(),
    this.isFavorite = const Optional.absent(),
    required this.itemRef,
    this.localDateTime = const Optional.absent(),
    this.originalFileName = const Optional.absent(),
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

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> isFavorite;

  String itemRef;

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

  Optional<List<AgentSearchAssetsSampleItemTagsInner>?> tags;

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
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsSampleItem &&
    other.exifInfo == exifInfo &&
    other.fileCreatedAt == fileCreatedAt &&
    other.fileModifiedAt == fileModifiedAt &&
    other.isFavorite == isFavorite &&
    other.itemRef == itemRef &&
    other.localDateTime == localDateTime &&
    other.originalFileName == originalFileName &&
    _deepEquality.equals(other.tags, tags) &&
    other.type == type &&
    other.visibility == visibility;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (exifInfo == null ? 0 : exifInfo!.hashCode) +
    (fileCreatedAt == null ? 0 : fileCreatedAt!.hashCode) +
    (fileModifiedAt == null ? 0 : fileModifiedAt!.hashCode) +
    (isFavorite == null ? 0 : isFavorite!.hashCode) +
    (itemRef.hashCode) +
    (localDateTime == null ? 0 : localDateTime!.hashCode) +
    (originalFileName == null ? 0 : originalFileName!.hashCode) +
    (tags.hashCode) +
    (type == null ? 0 : type!.hashCode) +
    (visibility == null ? 0 : visibility!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsSampleItem[exifInfo=$exifInfo, fileCreatedAt=$fileCreatedAt, fileModifiedAt=$fileModifiedAt, isFavorite=$isFavorite, itemRef=$itemRef, localDateTime=$localDateTime, originalFileName=$originalFileName, tags=$tags, type=$type, visibility=$visibility]';

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
    if (this.isFavorite.isPresent) {
      final value = this.isFavorite.value;
      json[r'isFavorite'] = value;
    }
      json[r'itemRef'] = this.itemRef;
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

  /// Returns a new [AgentSearchAssetsSampleItem] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsSampleItem? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsSampleItem");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsSampleItem(
        exifInfo: json.containsKey(r'exifInfo') ? Optional.present(AgentAssetMetadataResultExifInfo.fromJson(json[r'exifInfo'])) : const Optional.absent(),
        fileCreatedAt: json.containsKey(r'fileCreatedAt') ? Optional.present(mapDateTime(json, r'fileCreatedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        fileModifiedAt: json.containsKey(r'fileModifiedAt') ? Optional.present(mapDateTime(json, r'fileModifiedAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        isFavorite: json.containsKey(r'isFavorite') ? Optional.present(mapValueOfType<bool>(json, r'isFavorite')) : const Optional.absent(),
        itemRef: mapValueOfType<String>(json, r'itemRef')!,
        localDateTime: json.containsKey(r'localDateTime') ? Optional.present(mapDateTime(json, r'localDateTime', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')) : const Optional.absent(),
        originalFileName: json.containsKey(r'originalFileName') ? Optional.present(mapValueOfType<String>(json, r'originalFileName')) : const Optional.absent(),
        tags: json.containsKey(r'tags') ? Optional.present(AgentSearchAssetsSampleItemTagsInner.listFromJson(json[r'tags'])) : const Optional.absent(),
        type: json.containsKey(r'type') ? Optional.present(AssetTypeEnum.fromJson(json[r'type'])) : const Optional.absent(),
        visibility: json.containsKey(r'visibility') ? Optional.present(AssetVisibility.fromJson(json[r'visibility'])) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsSampleItem> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsSampleItem>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsSampleItem.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsSampleItem> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsSampleItem>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsSampleItem.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsSampleItem-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsSampleItem>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsSampleItem>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsSampleItem.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'itemRef',
  };
}

