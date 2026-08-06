//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleChoice {
  /// Returns a new [AgentSearchPeopleChoice] instance.
  AgentSearchPeopleChoice({
    required this.name,
    required this.personId,
    required this.thumbnailAssetId,
  });

  String name;

  String personId;

  String? thumbnailAssetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleChoice &&
    other.name == name &&
    other.personId == personId &&
    other.thumbnailAssetId == thumbnailAssetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name.hashCode) +
    (personId.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode);

  @override
  String toString() => 'AgentSearchPeopleChoice[name=$name, personId=$personId, thumbnailAssetId=$thumbnailAssetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'name'] = this.name;
      json[r'personId'] = this.personId;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSearchPeopleChoice] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleChoice? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleChoice");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleChoice(
        name: mapValueOfType<String>(json, r'name')!,
        personId: mapValueOfType<String>(json, r'personId')!,
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
      );
    }
    return null;
  }

  static List<AgentSearchPeopleChoice> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleChoice>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleChoice.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleChoice> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleChoice>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleChoice.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleChoice-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleChoice>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleChoice>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleChoice.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
    'personId',
    'thumbnailAssetId',
  };
}

