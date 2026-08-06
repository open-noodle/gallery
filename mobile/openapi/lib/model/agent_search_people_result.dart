//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentSearchPeopleResult {
  /// Returns a new [AgentSearchPeopleResult] instance.
  AgentSearchPeopleResult({
    required this.status,
    required this.name,
    required this.personId,
    required this.thumbnailAssetId,
    this.choices = const [],
  });

  AgentSearchPeopleResultStatusEnum status;

  String name;

  String personId;

  String? thumbnailAssetId;

  List<AgentSearchPeopleChoice> choices;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentSearchPeopleResult &&
    other.status == status &&
    other.name == name &&
    other.personId == personId &&
    other.thumbnailAssetId == thumbnailAssetId &&
    _deepEquality.equals(other.choices, choices);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (name.hashCode) +
    (personId.hashCode) +
    (thumbnailAssetId == null ? 0 : thumbnailAssetId!.hashCode) +
    (choices.hashCode);

  @override
  String toString() => 'AgentSearchPeopleResult[status=$status, name=$name, personId=$personId, thumbnailAssetId=$thumbnailAssetId, choices=$choices]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'name'] = this.name;
      json[r'personId'] = this.personId;
    if (this.thumbnailAssetId != null) {
      json[r'thumbnailAssetId'] = this.thumbnailAssetId;
    } else {
    //  json[r'thumbnailAssetId'] = null;
    }
      json[r'choices'] = this.choices;
    return json;
  }

  /// Returns a new [AgentSearchPeopleResult] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentSearchPeopleResult? fromJson(dynamic value) {
    upgradeDto(value, "AgentSearchPeopleResult");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentSearchPeopleResult(
        status: AgentSearchPeopleResultStatusEnum.fromJson(json[r'status'])!,
        name: mapValueOfType<String>(json, r'name')!,
        personId: mapValueOfType<String>(json, r'personId')!,
        thumbnailAssetId: mapValueOfType<String>(json, r'thumbnailAssetId'),
        choices: AgentSearchPeopleChoice.listFromJson(json[r'choices']),
      );
    }
    return null;
  }

  static List<AgentSearchPeopleResult> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleResult>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleResult.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentSearchPeopleResult> mapFromJson(dynamic json) {
    final map = <String, AgentSearchPeopleResult>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentSearchPeopleResult.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentSearchPeopleResult-objects as value to a dart map
  static Map<String, List<AgentSearchPeopleResult>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentSearchPeopleResult>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentSearchPeopleResult.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'name',
    'personId',
    'thumbnailAssetId',
    'choices',
  };
}


class AgentSearchPeopleResultStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentSearchPeopleResultStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const ambiguous = AgentSearchPeopleResultStatusEnum._(r'ambiguous');

  /// List of all possible values in this [enum][AgentSearchPeopleResultStatusEnum].
  static const values = <AgentSearchPeopleResultStatusEnum>[
    ambiguous,
  ];

  static AgentSearchPeopleResultStatusEnum? fromJson(dynamic value) => AgentSearchPeopleResultStatusEnumTypeTransformer().decode(value);

  static List<AgentSearchPeopleResultStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentSearchPeopleResultStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentSearchPeopleResultStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentSearchPeopleResultStatusEnum] to String,
/// and [decode] dynamic data back to [AgentSearchPeopleResultStatusEnum].
class AgentSearchPeopleResultStatusEnumTypeTransformer {
  factory AgentSearchPeopleResultStatusEnumTypeTransformer() => _instance ??= const AgentSearchPeopleResultStatusEnumTypeTransformer._();

  const AgentSearchPeopleResultStatusEnumTypeTransformer._();

  String encode(AgentSearchPeopleResultStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentSearchPeopleResultStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentSearchPeopleResultStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'ambiguous': return AgentSearchPeopleResultStatusEnum.ambiguous;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentSearchPeopleResultStatusEnumTypeTransformer] instance.
  static AgentSearchPeopleResultStatusEnumTypeTransformer? _instance;
}


