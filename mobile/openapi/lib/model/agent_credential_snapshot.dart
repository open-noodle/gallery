//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentCredentialSnapshot {
  /// Returns a new [AgentCredentialSnapshot] instance.
  AgentCredentialSnapshot({
    required this.baseUrl,
    required this.defaultModel,
    required this.id,
    required this.label,
    this.models = const [],
    required this.providerType,
  });

  String? baseUrl;

  String? defaultModel;

  String id;

  String label;

  List<String> models;

  AgentProviderType providerType;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentCredentialSnapshot &&
    other.baseUrl == baseUrl &&
    other.defaultModel == defaultModel &&
    other.id == id &&
    other.label == label &&
    _deepEquality.equals(other.models, models) &&
    other.providerType == providerType;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (baseUrl == null ? 0 : baseUrl!.hashCode) +
    (defaultModel == null ? 0 : defaultModel!.hashCode) +
    (id.hashCode) +
    (label.hashCode) +
    (models.hashCode) +
    (providerType.hashCode);

  @override
  String toString() => 'AgentCredentialSnapshot[baseUrl=$baseUrl, defaultModel=$defaultModel, id=$id, label=$label, models=$models, providerType=$providerType]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.baseUrl != null) {
      json[r'baseUrl'] = this.baseUrl;
    } else {
    //  json[r'baseUrl'] = null;
    }
    if (this.defaultModel != null) {
      json[r'defaultModel'] = this.defaultModel;
    } else {
    //  json[r'defaultModel'] = null;
    }
      json[r'id'] = this.id;
      json[r'label'] = this.label;
      json[r'models'] = this.models;
      json[r'providerType'] = this.providerType;
    return json;
  }

  /// Returns a new [AgentCredentialSnapshot] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentCredentialSnapshot? fromJson(dynamic value) {
    upgradeDto(value, "AgentCredentialSnapshot");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentCredentialSnapshot(
        baseUrl: mapValueOfType<String>(json, r'baseUrl'),
        defaultModel: mapValueOfType<String>(json, r'defaultModel'),
        id: mapValueOfType<String>(json, r'id')!,
        label: mapValueOfType<String>(json, r'label')!,
        models: json[r'models'] is Iterable
            ? (json[r'models'] as Iterable).cast<String>().toList(growable: false)
            : const [],
        providerType: AgentProviderType.fromJson(json[r'providerType'])!,
      );
    }
    return null;
  }

  static List<AgentCredentialSnapshot> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentCredentialSnapshot>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentCredentialSnapshot.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentCredentialSnapshot> mapFromJson(dynamic json) {
    final map = <String, AgentCredentialSnapshot>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentCredentialSnapshot.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentCredentialSnapshot-objects as value to a dart map
  static Map<String, List<AgentCredentialSnapshot>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentCredentialSnapshot>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentCredentialSnapshot.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'baseUrl',
    'defaultModel',
    'id',
    'label',
    'models',
    'providerType',
  };
}

