//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentAssetMediaReference {
  /// Returns a new [AgentAssetMediaReference] instance.
  AgentAssetMediaReference({
    required this.assetId,
    required this.fileName,
    required this.height,
    required this.mediaUrl,
    required this.mimeType,
    required this.width,
  });

  String assetId;

  String fileName;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? height;

  String mediaUrl;

  String mimeType;

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int? width;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentAssetMediaReference &&
    other.assetId == assetId &&
    other.fileName == fileName &&
    other.height == height &&
    other.mediaUrl == mediaUrl &&
    other.mimeType == mimeType &&
    other.width == width;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetId.hashCode) +
    (fileName.hashCode) +
    (height == null ? 0 : height!.hashCode) +
    (mediaUrl.hashCode) +
    (mimeType.hashCode) +
    (width == null ? 0 : width!.hashCode);

  @override
  String toString() => 'AgentAssetMediaReference[assetId=$assetId, fileName=$fileName, height=$height, mediaUrl=$mediaUrl, mimeType=$mimeType, width=$width]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetId'] = this.assetId;
      json[r'fileName'] = this.fileName;
    if (this.height != null) {
      json[r'height'] = this.height;
    } else {
    //  json[r'height'] = null;
    }
      json[r'mediaUrl'] = this.mediaUrl;
      json[r'mimeType'] = this.mimeType;
    if (this.width != null) {
      json[r'width'] = this.width;
    } else {
    //  json[r'width'] = null;
    }
    return json;
  }

  /// Returns a new [AgentAssetMediaReference] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentAssetMediaReference? fromJson(dynamic value) {
    upgradeDto(value, "AgentAssetMediaReference");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentAssetMediaReference(
        assetId: mapValueOfType<String>(json, r'assetId')!,
        fileName: mapValueOfType<String>(json, r'fileName')!,
        height: mapValueOfType<int>(json, r'height'),
        mediaUrl: mapValueOfType<String>(json, r'mediaUrl')!,
        mimeType: mapValueOfType<String>(json, r'mimeType')!,
        width: mapValueOfType<int>(json, r'width'),
      );
    }
    return null;
  }

  static List<AgentAssetMediaReference> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentAssetMediaReference>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentAssetMediaReference.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentAssetMediaReference> mapFromJson(dynamic json) {
    final map = <String, AgentAssetMediaReference>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentAssetMediaReference.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentAssetMediaReference-objects as value to a dart map
  static Map<String, List<AgentAssetMediaReference>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentAssetMediaReference>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentAssetMediaReference.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetId',
    'fileName',
    'height',
    'mediaUrl',
    'mimeType',
    'width',
  };
}

