//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageClarificationBlock {
  /// Returns a new [AgentMessageClarificationBlock] instance.
  AgentMessageClarificationBlock({
    this.choices = const [],
    required this.kind,
    required this.query,
    required this.summary,
    required this.textFallback,
    required this.type,
  });

  List<AgentMessageClarificationChoice> choices;

  AgentMessageClarificationBlockKindEnum kind;

  String query;

  String summary;

  String textFallback;

  AgentMessageClarificationBlockType type;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageClarificationBlock &&
    _deepEquality.equals(other.choices, choices) &&
    other.kind == kind &&
    other.query == query &&
    other.summary == summary &&
    other.textFallback == textFallback &&
    other.type == type;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (choices.hashCode) +
    (kind.hashCode) +
    (query.hashCode) +
    (summary.hashCode) +
    (textFallback.hashCode) +
    (type.hashCode);

  @override
  String toString() => 'AgentMessageClarificationBlock[choices=$choices, kind=$kind, query=$query, summary=$summary, textFallback=$textFallback, type=$type]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'choices'] = this.choices;
      json[r'kind'] = this.kind;
      json[r'query'] = this.query;
      json[r'summary'] = this.summary;
      json[r'textFallback'] = this.textFallback;
      json[r'type'] = this.type;
    return json;
  }

  /// Returns a new [AgentMessageClarificationBlock] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageClarificationBlock? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageClarificationBlock");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageClarificationBlock(
        choices: AgentMessageClarificationChoice.listFromJson(json[r'choices']),
        kind: AgentMessageClarificationBlockKindEnum.fromJson(json[r'kind'])!,
        query: mapValueOfType<String>(json, r'query')!,
        summary: mapValueOfType<String>(json, r'summary')!,
        textFallback: mapValueOfType<String>(json, r'textFallback')!,
        type: AgentMessageClarificationBlockType.fromJson(json[r'type'])!,
      );
    }
    return null;
  }

  static List<AgentMessageClarificationBlock> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageClarificationBlock>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageClarificationBlock.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageClarificationBlock> mapFromJson(dynamic json) {
    final map = <String, AgentMessageClarificationBlock>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageClarificationBlock.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageClarificationBlock-objects as value to a dart map
  static Map<String, List<AgentMessageClarificationBlock>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageClarificationBlock>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageClarificationBlock.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'choices',
    'kind',
    'query',
    'summary',
    'textFallback',
    'type',
  };
}


enum AgentMessageClarificationBlockKindEnum {
  person._(r'person'),
  tag._(r'tag'),
  album._(r'album'),
  space._(r'space'),
  cameraMake._(r'cameraMake'),
  cameraModel._(r'cameraModel'),
  lensModel._(r'lensModel'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentMessageClarificationBlockKindEnum._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentMessageClarificationBlockKindEnum] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentMessageClarificationBlockKindEnum? fromJson(dynamic value) => AgentMessageClarificationBlockKindEnumTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentMessageClarificationBlockKindEnum]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentMessageClarificationBlockKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageClarificationBlockKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageClarificationBlockKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessageClarificationBlockKindEnum] to String,
/// and [decode] dynamic data back to [AgentMessageClarificationBlockKindEnum].
class AgentMessageClarificationBlockKindEnumTypeTransformer {
  factory AgentMessageClarificationBlockKindEnumTypeTransformer() => _instance ??= const AgentMessageClarificationBlockKindEnumTypeTransformer._();

  const AgentMessageClarificationBlockKindEnumTypeTransformer._();

  String encode(AgentMessageClarificationBlockKindEnum data) => data._value;

  /// Returns the instance of [AgentMessageClarificationBlockKindEnum] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageClarificationBlockKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentMessageClarificationBlockKindEnum) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'person': return AgentMessageClarificationBlockKindEnum.person;
        case r'tag': return AgentMessageClarificationBlockKindEnum.tag;
        case r'album': return AgentMessageClarificationBlockKindEnum.album;
        case r'space': return AgentMessageClarificationBlockKindEnum.space;
        case r'cameraMake': return AgentMessageClarificationBlockKindEnum.cameraMake;
        case r'cameraModel': return AgentMessageClarificationBlockKindEnum.cameraModel;
        case r'lensModel': return AgentMessageClarificationBlockKindEnum.lensModel;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentMessageClarificationBlockKindEnumTypeTransformer? _instance;
}


