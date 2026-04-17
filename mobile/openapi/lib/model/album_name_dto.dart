//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AlbumNameDto {
  /// Returns a new [AlbumNameDto] instance.
  AlbumNameDto({
    required this.albumName,
    required this.albumThumbnailAssetId,
    required this.assetCount,
    this.endDate,
    required this.id,
    required this.shared,
    this.startDate,
  });

  String albumName;

  String? albumThumbnailAssetId;

  num assetCount;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? endDate;

  String id;

  bool shared;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  String? startDate;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AlbumNameDto &&
    other.albumName == albumName &&
    other.albumThumbnailAssetId == albumThumbnailAssetId &&
    other.assetCount == assetCount &&
    other.endDate == endDate &&
    other.id == id &&
    other.shared == shared &&
    other.startDate == startDate;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (albumName.hashCode) +
    (albumThumbnailAssetId == null ? 0 : albumThumbnailAssetId!.hashCode) +
    (assetCount.hashCode) +
    (endDate == null ? 0 : endDate!.hashCode) +
    (id.hashCode) +
    (shared.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode);

  @override
  String toString() => 'AlbumNameDto[albumName=$albumName, albumThumbnailAssetId=$albumThumbnailAssetId, assetCount=$assetCount, endDate=$endDate, id=$id, shared=$shared, startDate=$startDate]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'albumName'] = this.albumName;
    if (this.albumThumbnailAssetId != null) {
      json[r'albumThumbnailAssetId'] = this.albumThumbnailAssetId;
    } else {
    //  json[r'albumThumbnailAssetId'] = null;
    }
      json[r'assetCount'] = this.assetCount;
    if (this.endDate != null) {
      json[r'endDate'] = this.endDate;
    } else {
    //  json[r'endDate'] = null;
    }
      json[r'id'] = this.id;
      json[r'shared'] = this.shared;
    if (this.startDate != null) {
      json[r'startDate'] = this.startDate;
    } else {
    //  json[r'startDate'] = null;
    }
    return json;
  }

  /// Returns a new [AlbumNameDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AlbumNameDto? fromJson(dynamic value) {
    upgradeDto(value, "AlbumNameDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AlbumNameDto(
        albumName: mapValueOfType<String>(json, r'albumName')!,
        albumThumbnailAssetId: mapValueOfType<String>(json, r'albumThumbnailAssetId'),
        assetCount: num.parse('${json[r'assetCount']}'),
        endDate: mapValueOfType<String>(json, r'endDate'),
        id: mapValueOfType<String>(json, r'id')!,
        shared: mapValueOfType<bool>(json, r'shared')!,
        startDate: mapValueOfType<String>(json, r'startDate'),
      );
    }
    return null;
  }

  static List<AlbumNameDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AlbumNameDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AlbumNameDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AlbumNameDto> mapFromJson(dynamic json) {
    final map = <String, AlbumNameDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AlbumNameDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AlbumNameDto-objects as value to a dart map
  static Map<String, List<AlbumNameDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AlbumNameDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AlbumNameDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'albumName',
    'albumThumbnailAssetId',
    'assetCount',
    'id',
    'shared',
  };
}

