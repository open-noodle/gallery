//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleMatchedResult {
  /// Returns a new [AgentSearchPeopleMatchedResult] instance.
  AgentSearchPeopleMatchedResult({
    required this.name,
    required this.personId,
    required this.status,
    required this.thumbnailAssetId,
  });

  String name;

  String personId;

  AgentSearchPeopleMatchedResultStatusEnum status;

  String? thumbnailAssetId;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleMatchedResult &&
    other.name == name &&
    other.personId == personId &&
    other.status == status &&
    other.thumbnailAssetId == thumbnailAssetId;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (name.hashCode) +
    (personId.hashCode) +
    (status.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode);

  @override
  String toString() => 'AgentSearchPeopleMatchedResult[name=$name, personId=$personId, status=$status, thumbnailAssetId=$thumbnailAssetId]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'name'] = this.name;
      json[r'personId'] = this.personId;
      json[r'status'] = this.status;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
    return json;
  }

  /// Returns a new [AgentSearchPeopleMatchedResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleMatchedResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleMatchedResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleMatchedResult(
        name: mapValueOfType<String>(json, r'name')!,
        personId: mapValueOfType<String>(json, r'personId')!,
        status: AgentSearchPeopleMatchedResultStatusEnum.fromJson(json[r'status'])!,
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
      );
    }
    return null;
  }

  static List<AgentSearchPeopleMatchedResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleMatchedResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleMatchedResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleMatchedResult> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleMatchedResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleMatchedResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleMatchedResult-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleMatchedResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleMatchedResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleMatchedResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'name',
    'personId',
    'status',
    'thumbnailAssetId',
  };
}


class AgentSearchPeopleMatchedResultStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleMatchedResultStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const matched = AgentSearchPeopleMatchedResultStatusEnum._(r'matched');

  /// List of all possible values in this [enum][AgentSearchPeopleMatchedResultStatusEnum].
  static const values = <AgentSearchPeopleMatchedResultStatusEnum>[
    matched,
  ];

  static AgentSearchPeopleMatchedResultStatusEnum? fromJson(dynamic value) => AgentSearchPeopleMatchedResultStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleMatchedResultStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleMatchedResultStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleMatchedResultStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleMatchedResultStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleMatchedResultStatusEnum].
class AgentSearchPeopleMatchedResultStatusEnumTypeTransformer {
  factory AgentSearchPeopleMatchedResultStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleMatchedResultStatusEnumTypeTransformer._();

  const AgentSearchPeopleMatchedResultStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleMatchedResultStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleMatchedResultStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleMatchedResultStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'matched': return AgentSearchPeopleMatchedResultStatusEnum.matched;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleMatchedResultStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleMatchedResultStatusEnumTypeTransformer? _instance;
}


