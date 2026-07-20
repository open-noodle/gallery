//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class TimeBucketCoverResponseDto {
  /// Returns a new [TimeBucketCoverResponseDto] instance.
  TimeBucketCoverResponseDto({
    required this.representativeAssetId,
    required this.representativeRatio,
    required this.representativeThumbhash,
    required this.timeBucket,
  });

  /// Representative asset ID for this bucket
  String? representativeAssetId;

  /// Representative asset width/height ratio
  num? representativeRatio;

  /// Representative asset thumbhash, base64 encoded
  String? representativeThumbhash;

  String timeBucket;

  @override
  bool operator ==(Object other) => identical(this, other) || other is TimeBucketCoverResponseDto &&
    other.representativeAssetId == representativeAssetId &&
    other.representativeRatio == representativeRatio &&
    other.representativeThumbhash == representativeThumbhash &&
    other.timeBucket == timeBucket;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (representativeAssetId == null ? 0 : representativeAssetId!.hashCode) +
    (representativeRatio == null ? 0 : representativeRatio!.hashCode) +
    (representativeThumbhash == null ? 0 : representativeThumbhash!.hashCode) +
    (timeBucket.hashCode);

  @override
  String toString() => 'TimeBucketCoverResponseDto[representativeAssetId=$representativeAssetId, representativeRatio=$representativeRatio, representativeThumbhash=$representativeThumbhash, timeBucket=$timeBucket]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.representativeAssetId != null) {
      json[r'representativeAssetId'] = this.representativeAssetId;
    } else {
      json[r'representativeAssetId'] = null;
    }
    if (this.representativeRatio != null) {
      json[r'representativeRatio'] = this.representativeRatio;
    } else {
      json[r'representativeRatio'] = null;
    }
    if (this.representativeThumbhash != null) {
      json[r'representativeThumbhash'] = this.representativeThumbhash;
    } else {
      json[r'representativeThumbhash'] = null;
    }
      json[r'timeBucket'] = this.timeBucket;
    return json;
  }

  /// Returns a new [TimeBucketCoverResponseDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static TimeBucketCoverResponseDto? fromJson(dynamic value) {
    upgradeDto(value, "TimeBucketCoverResponseDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return TimeBucketCoverResponseDto(
        representativeAssetId: mapValueOfType<String>(json, r'representativeAssetId'),
        representativeRatio: json[r'representativeRatio'] == null
            ? null
            : num.parse('${json[r'representativeRatio']}'),
        representativeThumbhash: mapValueOfType<String>(json, r'representativeThumbhash'),
        timeBucket: mapValueOfType<String>(json, r'timeBucket')!,
      );
    }
    return null;
  }

  static List<TimeBucketCoverResponseDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <TimeBucketCoverResponseDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = TimeBucketCoverResponseDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, TimeBucketCoverResponseDto> mapFromJson(dynamic json) {
    final map = <String, TimeBucketCoverResponseDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = TimeBucketCoverResponseDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of TimeBucketCoverResponseDto-objects as value to a dart map
  static Map<String, List<TimeBucketCoverResponseDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<TimeBucketCoverResponseDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = TimeBucketCoverResponseDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'representativeAssetId',
    'representativeRatio',
    'representativeThumbhash',
    'timeBucket',
  };
}

