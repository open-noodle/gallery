//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentOperationNewSpaceTargetKind {
  /// Instantiate a new enum with the provided [value].
  const AgentOperationNewSpaceTargetKind._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const newSpace = AgentOperationNewSpaceTargetKind._(r'new_space');

  /// List of all possible values in this [enum][AgentOperationNewSpaceTargetKind].
  static const values = <AgentOperationNewSpaceTargetKind>[
    newSpace,
  ];

  static AgentOperationNewSpaceTargetKind? fromJson(dynamic value) => AgentOperationNewSpaceTargetKindTypeTransformer().decode(value);

  static List<AgentOperationNewSpaceTargetKind> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentOperationNewSpaceTargetKind>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentOperationNewSpaceTargetKind.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentOperationNewSpaceTargetKind] to String,
/// and [decode] dynamic data back to [AgentOperationNewSpaceTargetKind].
class AgentOperationNewSpaceTargetKindTypeTransformer {
  factory AgentOperationNewSpaceTargetKindTypeTransformer() => _instance ??= const AgentOperationNewSpaceTargetKindTypeTransformer._();

  const AgentOperationNewSpaceTargetKindTypeTransformer._();

  String encode(AgentOperationNewSpaceTargetKind data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentOperationNewSpaceTargetKind.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentOperationNewSpaceTargetKind? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'new_space': return AgentOperationNewSpaceTargetKind.newSpace;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentOperationNewSpaceTargetKindTypeTransformer] instance.
  static AgentOperationNewSpaceTargetKindTypeTransformer? _instance;
}

