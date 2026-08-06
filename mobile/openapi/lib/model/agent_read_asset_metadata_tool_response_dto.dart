//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetMetadataToolResponseDto {
  /// Returns a new [AgentReadAssetMetadataToolResponseDto] instance.
  AgentReadAssetMetadataToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.assets = const [],
  });

  AgentReadAssetMetadataToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  List<AgentAssetMetadataResult> assets;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetMetadataToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.assets, assets);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (assets.hashCode);

  @override
  String toString() => 'AgentReadAssetMetadataToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, assets=$assets]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
      json[r'assets'] = this.assets;
    return json;
  }

  /// Returns a new [AgentReadAssetMetadataToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetMetadataToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetMetadataToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetMetadataToolResponseDto(
        status: AgentReadAssetMetadataToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        assets: AgentAssetMetadataResult.listFromJson(json[r'assets']),
      );
    }
    return null;
  }

  static List<AgentReadAssetMetadataToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetMetadataToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetMetadataToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetMetadataToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetMetadataToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentReadAssetMetadataToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetMetadataToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetMetadataToolResponseDto.listFromJson(entry.value, growable: growable,);
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


class AgentReadAssetMetadataToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetMetadataToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentReadAssetMetadataToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentReadAssetMetadataToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentReadAssetMetadataToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetMetadataToolResponseDtoStatusEnum].
  static const values = <AgentReadAssetMetadataToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentReadAssetMetadataToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetMetadataToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetMetadataToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetMetadataToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetMetadataToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetMetadataToolResponseDtoStatusEnum].
class AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer {
  factory AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer._();

  const AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentReadAssetMetadataToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetMetadataToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetMetadataToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentReadAssetMetadataToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentReadAssetMetadataToolResponseDtoStatusEnum.denied;
        case r'success': return AgentReadAssetMetadataToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentReadAssetMetadataToolResponseDtoStatusEnumTypeTransformer? _instance;
}

