//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchAssetsSample {
  /// Returns a new [AgentSearchAssetsSample] instance.
  AgentSearchAssetsSample({
    this.items = const [],
    required this.sampleSize,
  });

  List<AgentSearchAssetsSampleItem> items;

  /// Minimum value: 0
  /// Maximum value: 25
  int sampleSize;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchAssetsSample &&
    _deepEquality.equals(other.items, items) &&
    other.sampleSize == sampleSize;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (items.hashCode) +
    (sampleSize.hashCode);

  @override
  String toString() => 'AgentSearchAssetsSample[items=$items, sampleSize=$sampleSize]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'items'] = this.items;
      json[r'sampleSize'] = this.sampleSize;
    return json;
  }

  /// Returns a new [AgentSearchAssetsSample] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchAssetsSample? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchAssetsSample");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchAssetsSample(
        items: AgentSearchAssetsSampleItem.listFromJson(json[r'items']),
        sampleSize: mapValueOfType<int>(json, r'sampleSize')!,
      );
    }
    return null;
  }

  static List<AgentSearchAssetsSample> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchAssetsSample>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchAssetsSample.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchAssetsSample> mapFromJson(dynamic json) {
    final map = <String, AgentSearchAssetsSample>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchAssetsSample.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchAssetsSample-objects as value to a dart map
  static Map<String, List<AgentSearchAssetsSample>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchAssetsSample>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchAssetsSample.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'items',
    'sampleSize',
  };
}

