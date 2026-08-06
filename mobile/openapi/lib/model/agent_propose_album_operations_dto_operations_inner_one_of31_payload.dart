//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload {
  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload] instance.
  AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload({
    this.password = const Optional.absent(),
    this.expiresAt = const Optional.absent(),
    this.showMetadata = const Optional.absent(),
    this.allowDownload = const Optional.absent(),
  });

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> password;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> expiresAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> showMetadata;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<bool?> allowDownload;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload &&
    other.password == password &&
    other.expiresAt == expiresAt &&
    other.showMetadata == showMetadata &&
    other.allowDownload == allowDownload;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (password == null ? 0 : password!.hashCode) +
    (expiresAt == null ? 0 : expiresAt!.hashCode) +
    (showMetadata == null ? 0 : showMetadata!.hashCode) +
    (allowDownload == null ? 0 : allowDownload!.hashCode);

  @override
  String toString() => 'AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload[password=$password, expiresAt=$expiresAt, showMetadata=$showMetadata, allowDownload=$allowDownload]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.password.isPresent) {
      final value = this.password.value;
      json[r'password'] = value;
    }
    if (this.expiresAt.isPresent) {
      final value = this.expiresAt.value;
      json[r'expiresAt'] = value;
    }
    if (this.showMetadata.isPresent) {
      final value = this.showMetadata.value;
      json[r'showMetadata'] = value;
    }
    if (this.allowDownload.isPresent) {
      final value = this.allowDownload.value;
      json[r'allowDownload'] = value;
    }
    return json;
  }

  /// Returns a new [AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload? fromJson(dynamic value) {
    upgradeDto(value, "AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload(
        password: json.containsKey(r'password') ? Optional.present(mapValueOfType<String>(json, r'password')) : const Optional.absent(),
        expiresAt: json.containsKey(r'expiresAt') ? Optional.present(mapValueOfType<String>(json, r'expiresAt')) : const Optional.absent(),
        showMetadata: json.containsKey(r'showMetadata') ? Optional.present(mapValueOfType<bool>(json, r'showMetadata')) : const Optional.absent(),
        allowDownload: json.containsKey(r'allowDownload') ? Optional.present(mapValueOfType<bool>(json, r'allowDownload')) : const Optional.absent(),
      );
    }
    return null;
  }

  static List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload> mapFromJson(dynamic json) {
    final map = <String, AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload-objects as value to a dart map
  static Map<String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentProposeAlbumOperationsDtoOperationsInnerOneOf31Payload.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
  };
}

