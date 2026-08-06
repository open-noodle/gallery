//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentMessageBlock {
  /// Returns a new [AgentMessageBlock] instance.
  AgentMessageBlock({
    required this.text,
    required this.type,
    required this.summary,
    required this.toolCallId,
    required this.assetId,
    this.label = const Optional.absent(),
    required this.planId,
    this.choices = const [],
    required this.kind,
    required this.query,
    required this.textFallback,
  });

  String text;

  AgentMessageClarificationBlockType type;

  String summary;

  String toolCallId;

  String assetId;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<String?> label;

  String planId;

  List<AgentMessageClarificationChoice> choices;

  AgentMessageBlockKindEnum kind;

  String query;

  String textFallback;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentMessageBlock &&
    other.text == text &&
    other.type == type &&
    other.summary == summary &&
    other.toolCallId == toolCallId &&
    other.assetId == assetId &&
    other.label == label &&
    other.planId == planId &&
    _deepEquality.equals(other.choices, choices) &&
    other.kind == kind &&
    other.query == query &&
    other.textFallback == textFallback;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (text.hashCode) +
    (type.hashCode) +
    (summary.hashCode) +
    (toolCallId.hashCode) +
    (assetId.hashCode) +
    (label == null ? 0 : label!.hashCode) +
    (planId.hashCode) +
    (choices.hashCode) +
    (kind.hashCode) +
    (query.hashCode) +
    (textFallback.hashCode);

  @override
  String toString() => 'AgentMessageBlock[text=$text, type=$type, summary=$summary, toolCallId=$toolCallId, assetId=$assetId, label=$label, planId=$planId, choices=$choices, kind=$kind, query=$query, textFallback=$textFallback]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'text'] = this.text;
      json[r'type'] = this.type;
      json[r'summary'] = this.summary;
      json[r'toolCallId'] = this.toolCallId;
      json[r'assetId'] = this.assetId;
    if (this.label.isPresent) {
      final value = this.label.value;
      json[r'label'] = value;
    }
      json[r'planId'] = this.planId;
      json[r'choices'] = this.choices;
      json[r'kind'] = this.kind;
      json[r'query'] = this.query;
      json[r'textFallback'] = this.textFallback;
    return json;
  }

  /// Returns a new [AgentMessageBlock] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentMessageBlock? fromJson(dynamic value) {
    upgradeDto(value, "AgentMessageBlock");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentMessageBlock(
        text: mapValueOfType<String>(json, r'text')!,
        type: AgentMessageClarificationBlockType.fromJson(json[r'type'])!,
        summary: mapValueOfType<String>(json, r'summary')!,
        toolCallId: mapValueOfType<String>(json, r'toolCallId')!,
        assetId: mapValueOfType<String>(json, r'assetId')!,
        label: json.containsKey(r'label') ? Optional.present(mapValueOfType<String>(json, r'label')) : const Optional.absent(),
        planId: mapValueOfType<String>(json, r'planId')!,
        choices: AgentMessageClarificationChoice.listFromJson(json[r'choices']),
        kind: AgentMessageBlockKindEnum.fromJson(json[r'kind'])!,
        query: mapValueOfType<String>(json, r'query')!,
        textFallback: mapValueOfType<String>(json, r'textFallback')!,
      );
    }
    return null;
  }

  static List<AgentMessageBlock> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageBlock>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageBlock.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentMessageBlock> mapFromJson(dynamic json) {
    final map = <String, AgentMessageBlock>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentMessageBlock.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentMessageBlock-objects as value to a dart map
  static Map<String, List<AgentMessageBlock>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentMessageBlock>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentMessageBlock.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'text',
    'type',
    'summary',
    'toolCallId',
    'assetId',
    'planId',
    'choices',
    'kind',
    'query',
    'textFallback',
  };
}


class AgentMessageBlockKindEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentMessageBlockKindEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const person = AgentMessageBlockKindEnum._(r'person');
  static const tag = AgentMessageBlockKindEnum._(r'tag');
  static const album = AgentMessageBlockKindEnum._(r'album');
  static const space = AgentMessageBlockKindEnum._(r'space');
  static const cameraMake = AgentMessageBlockKindEnum._(r'cameraMake');
  static const cameraModel = AgentMessageBlockKindEnum._(r'cameraModel');
  static const lensModel = AgentMessageBlockKindEnum._(r'lensModel');

  /// List of all possible values in this [enum][AgentMessageBlockKindEnum].
  static const values = <AgentMessageBlockKindEnum>[
    person,
    tag,
    album,
    space,
    cameraMake,
    cameraModel,
    lensModel,
  ];

  static AgentMessageBlockKindEnum? fromJson(dynamic value) => AgentMessageBlockKindEnumTypeTransformer().decode(value);

  static List<AgentMessageBlockKindEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentMessageBlockKindEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentMessageBlockKindEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentMessageBlockKindEnum] to String,
/// and [decode] dynamic data back to [AgentMessageBlockKindEnum].
class AgentMessageBlockKindEnumTypeTransformer {
  factory AgentMessageBlockKindEnumTypeTransformer() => _instance ??= const AgentMessageBlockKindEnumTypeTransformer._();

  const AgentMessageBlockKindEnumTypeTransformer._();

  String encode(AgentMessageBlockKindEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentMessageBlockKindEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentMessageBlockKindEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'person': return AgentMessageBlockKindEnum.person;
        case r'tag': return AgentMessageBlockKindEnum.tag;
        case r'album': return AgentMessageBlockKindEnum.album;
        case r'space': return AgentMessageBlockKindEnum.space;
        case r'cameraMake': return AgentMessageBlockKindEnum.cameraMake;
        case r'cameraModel': return AgentMessageBlockKindEnum.cameraModel;
        case r'lensModel': return AgentMessageBlockKindEnum.lensModel;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentMessageBlockKindEnumTypeTransformer] instance.
  static AgentMessageBlockKindEnumTypeTransformer? _instance;
}


