//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentShareLinkCreateOperationType {
  /// Instantiate a new enum with the provided [value].
  const AgentShareLinkCreateOperationType._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const shareLinkPeriodCreate = AgentShareLinkCreateOperationType._(r'shareLink.create');

  /// List of all possible values in this [enum][AgentShareLinkCreateOperationType].
  static const values = <AgentShareLinkCreateOperationType>[
    shareLinkPeriodCreate,
  ];

  static AgentShareLinkCreateOperationType? fromJson(dynamic value) => AgentShareLinkCreateOperationTypeTypeTransformer().decode(value);

  static List<AgentShareLinkCreateOperationType> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentShareLinkCreateOperationType>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentShareLinkCreateOperationType.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentShareLinkCreateOperationType] to String,
/// and [decode] dynamic data back to [AgentShareLinkCreateOperationType].
class AgentShareLinkCreateOperationTypeTypeTransformer {
  factory AgentShareLinkCreateOperationTypeTypeTransformer() => _instance ??= const AgentShareLinkCreateOperationTypeTypeTransformer._();

  const AgentShareLinkCreateOperationTypeTypeTransformer._();

  String encode(AgentShareLinkCreateOperationType data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentShareLinkCreateOperationType.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentShareLinkCreateOperationType? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'shareLink.create': return AgentShareLinkCreateOperationType.shareLinkPeriodCreate;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentShareLinkCreateOperationTypeTypeTransformer] instance.
  static AgentShareLinkCreateOperationTypeTypeTransformer? _instance;
}

