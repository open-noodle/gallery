//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsSelectionHandle {
  /// Returns a new [AgentSearchAssetsSelectionHandle] instance.
  AgentSearchAssetsSelectionHandle({
    required this.assetCount,
    required this.expiresAt,
    required this.id,
    required this.sourceRef,
    required this.sourceToolCallId,
  });

  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  DateTime expiresAt;

  String id;

  String sourceRef;

  String? sourceToolCallId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsSelectionHandle &&
    other.assetCount == assetCount &&
    other.expiresAt == expiresAt &&
    other.id == id &&
    other.sourceRef == sourceRef &&
    other.sourceToolCallId == sourceToolCallId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (assetCount.hashCode) +
    (expiresAt.hashCode) +
    (id.hashCode) +
    (sourceRef.hashCode) +
    (sourceToolCallId == null ? 0 : sourceToolCallId!.hashCode);

  @override
  String toString() => 'AgentSearchAssetsSelectionHandle[assetCount=$assetCount, expiresAt=$expiresAt, id=$id, sourceRef=$sourceRef, sourceToolCallId=$sourceToolCallId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'assetCount'] = this.assetCount;
      json[r'expiresAt'] = _isEpochMarker(r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')
        ? this.expiresAt.millisecondsSinceEpoch
        : this.expiresAt.toUtc().toIso8601String();
      json[r'id'] = this.id;
      json[r'sourceRef'] = this.sourceRef;
    if (this.sourceToolCallId != null) {
      json[r'sourceToolCallId'] = this.sourceToolCallId;
    } else {
      json[r'sourceToolCallId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSearchAssetsSelectionHandle] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsSelectionHandle? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsSelectionHandle");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsSelectionHandle(
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        expiresAt: mapDateTime(json, r'expiresAt', r'/^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$/')!,
        id: mapValueOfType<String>(json, r'id')!,
        sourceRef: mapValueOfType<String>(json, r'sourceRef')!,
        sourceToolCallId: mapValueOfType<String>(json, r'sourceToolCallId'),
      );
    }
    return null;
  }

  static List<AgentSearchAssetsSelectionHandle> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsSelectionHandle>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsSelectionHandle.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsSelectionHandle> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsSelectionHandle>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsSelectionHandle.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsSelectionHandle-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsSelectionHandle>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsSelectionHandle>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsSelectionHandle.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'assetCount',
    'expiresAt',
    'id',
    'sourceRef',
    'sourceToolCallId',
  };
}

