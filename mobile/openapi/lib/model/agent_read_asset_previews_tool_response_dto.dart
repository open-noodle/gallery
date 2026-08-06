//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentReadAssetPreviewsToolResponseDto {
  /// Returns a new [AgentReadAssetPreviewsToolResponseDto] instance.
  AgentReadAssetPreviewsToolResponseDto({
    required this.status,
    required this.toolCall,
    this.reason,
    this.previews = const [],
  });

  AgentReadAssetPreviewsToolResponseDtoStatusEnum status;

  AgentToolCallResponseDto toolCall;

  String? reason;

  List<AgentAssetMediaReference> previews;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentReadAssetPreviewsToolResponseDto &&
    other.status == status &&
    other.toolCall == toolCall &&
    other.reason == reason &&
    _deepEquality.equals(other.previews, previews);

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (status.hashCode) +
    (toolCall.hashCode) +
    (reason == null ? 0 : reason!.hashCode) +
    (previews.hashCode);

  @override
  String toString() => 'AgentReadAssetPreviewsToolResponseDto[status=$status, toolCall=$toolCall, reason=$reason, previews=$previews]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'status'] = this.status;
      json[r'toolCall'] = this.toolCall;
    if (this.reason != null) {
      json[r'reason'] = this.reason;
    }
      json[r'previews'] = this.previews;
    return json;
  }

  /// Returns a new [AgentReadAssetPreviewsToolResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentReadAssetPreviewsToolResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "AgentReadAssetPreviewsToolResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentReadAssetPreviewsToolResponseDto(
        status: AgentReadAssetPreviewsToolResponseDtoStatusEnum.fromJson(json[r'status'])!,
        toolCall: AgentToolCallResponseDto.fromJson(json[r'toolCall'])!,
        reason: mapValueOfType<String>(json, r'reason'),
        previews: AgentAssetMediaReference.listFromJson(json[r'previews']),
      );
    }
    return null;
  }

  static List<AgentReadAssetPreviewsToolResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentReadAssetPreviewsToolResponseDto> mapFromJson(dynamic json) {
    final map = <String, AgentReadAssetPreviewsToolResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentReadAssetPreviewsToolResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentReadAssetPreviewsToolResponseDto-objects as value to a dart map
  static Map<String, List<AgentReadAssetPreviewsToolResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentReadAssetPreviewsToolResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentReadAssetPreviewsToolResponseDto.listFromJson(entry.value, growable: growable,);
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


class AgentReadAssetPreviewsToolResponseDtoStatusEnum {
  /// Instantiate a new enum with the provided [value].
  const AgentReadAssetPreviewsToolResponseDtoStatusEnum._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const approvalRequired = AgentReadAssetPreviewsToolResponseDtoStatusEnum._(r'approval-required');
  static const denied = AgentReadAssetPreviewsToolResponseDtoStatusEnum._(r'denied');
  static const success = AgentReadAssetPreviewsToolResponseDtoStatusEnum._(r'success');

  /// List of all possible values in this [enum][AgentReadAssetPreviewsToolResponseDtoStatusEnum].
  static const values = <AgentReadAssetPreviewsToolResponseDtoStatusEnum>[
    approvalRequired,
    denied,
    success,
  ];

  static AgentReadAssetPreviewsToolResponseDtoStatusEnum? fromJson(dynamic value) => AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer().decode(value);

  static List<AgentReadAssetPreviewsToolResponseDtoStatusEnum> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentReadAssetPreviewsToolResponseDtoStatusEnum>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentReadAssetPreviewsToolResponseDtoStatusEnum.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentReadAssetPreviewsToolResponseDtoStatusEnum] to String,
/// and [decode] dynamic data back to [AgentReadAssetPreviewsToolResponseDtoStatusEnum].
class AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer {
  factory AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer() => _instance ??= const AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer._();

  const AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer._();

  String encode(AgentReadAssetPreviewsToolResponseDtoStatusEnum data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentReadAssetPreviewsToolResponseDtoStatusEnum.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentReadAssetPreviewsToolResponseDtoStatusEnum? decode(dynamic data, {bool allowNull = true}) {
    if (data != null) {
      switch (data) {
        case r'approval-required': return AgentReadAssetPreviewsToolResponseDtoStatusEnum.approvalRequired;
        case r'denied': return AgentReadAssetPreviewsToolResponseDtoStatusEnum.denied;
        case r'success': return AgentReadAssetPreviewsToolResponseDtoStatusEnum.success;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// Singleton [AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer] instance.
  static AgentReadAssetPreviewsToolResponseDtoStatusEnumTypeTransformer? _instance;
}

