//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetOriginalsToolResponseDto {
  /// Returns a new [AgentReadAssetOriginalsToolResponseDto] instance.
  AgentReadAssetOriginalsToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.originals = const [],
  });

  AgentReadAssetOriginalsToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  List<AgentAssetMediaReference> originals;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetOriginalsToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.originals, originals);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (originals.hashCode);

  @override
  String toString() => 'AgentReadAssetOriginalsToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, originals=$originals]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
      json[r'originals'] = this.originals;
    return json;
  }

  /// Returns a new [AgentReadAssetOriginalsToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetOriginalsToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetOriginalsToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetOriginalsToolResponseDto(
        status: AgentReadAssetOriginalsToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        originals: AgentAssetMediaReference.listFromJson(json[r'originals']),
      );
    }
    return null;
  }

  static List<AgentReadAssetOriginalsToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetOriginalsToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetOriginalsToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetOriginalsToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetOriginalsToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetOriginalsToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetOriginalsToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentReadAssetOriginalsToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetOriginalsToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetOriginalsToolResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'status',
    'toolCall',
  };
}


class AgentReadAssetOriginalsToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetOriginalsToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentReadAssetOriginalsToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentReadAssetOriginalsToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentReadAssetOriginalsToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetOriginalsToolResponseDtoStatusEnum].
  static const values = <AgentReadAssetOriginalsToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentReadAssetOriginalsToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetOriginalsToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetOriginalsToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetOriginalsToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetOriginalsToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetOriginalsToolResponseDtoStatusEnum].
class AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer {
  factory AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer._();

  const AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentReadAssetOriginalsToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetOriginalsToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetOriginalsToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentReadAssetOriginalsToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentReadAssetOriginalsToolResponseDtoStatusEnum.denied;
        case r'success': return AgentReadAssetOriginalsToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentReadAssetOriginalsToolResponseDtoStatusEnumTypeTransformer? _instance;
}

