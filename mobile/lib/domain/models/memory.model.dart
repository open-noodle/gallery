import 'dart:convert';

import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';

part 'memory.model.freezed.dart';

// TODO(agg23): Remove enum suffix
enum MemoryTypeEnum {
  // do not change this order!
  onThisDay,
  rule,
}

// Fork (#418): the rule-based memories pipeline sends an arbitrary payload per rule
// (ruleId/title/subtitle, plus onThisDay's year), so this stays a raw-map-backed
// hand-written class rather than upstream's `@Freezed(... required int year)`.
// Mixing a plain class with freezed siblings is upstream's own idiom in these files.
class MemoryData {
  final Map<String, dynamic> raw;

  const MemoryData(this.raw);

  int? get year => raw['year'] is int ? raw['year'] as int : (raw['year'] as num?)?.toInt();

  String? get ruleId => raw['ruleId'] as String?;

  String? get title => raw['title'] as String?;

  String? get subtitle => raw['subtitle'] as String?;

  MemoryData copyWith({Map<String, dynamic>? raw}) {
    return MemoryData(raw ?? this.raw);
  }

  Map<String, dynamic> toMap() {
    return Map<String, dynamic>.from(raw);
  }

  factory MemoryData.fromMap(Map<String, dynamic> map) {
    return MemoryData(Map<String, dynamic>.from(map));
  }

  String toJson() => json.encode(toMap());

  factory MemoryData.fromJson(String source) => MemoryData.fromMap(json.decode(source) as Map<String, dynamic>);

  @override
  String toString() => 'MemoryData(raw: $raw)';

  @override
  bool operator ==(covariant MemoryData other) {
    if (identical(this, other)) {
      return true;
    }

    return const DeepCollectionEquality().equals(other.raw, raw);
  }

  @override
  int get hashCode => const DeepCollectionEquality().hash(raw);
}

/// A specialized collection of assets with some novel display mechanism
// TODO(agg23): DriftMemoryRepository currently mutates `assets`
@Freezed(makeCollectionsUnmodifiable: false)
abstract class Memory with _$Memory {
  const factory Memory({
    required String id,
    required DateTime createdAt,
    required DateTime updatedAt,
    DateTime? deletedAt,
    required String ownerId,
    required MemoryTypeEnum type,
    required MemoryData data,
    required bool isSaved,
    required DateTime memoryAt,
    DateTime? seenAt,
    DateTime? showAt,
    DateTime? hideAt,
    required List<RemoteAsset> assets,
  }) = _Memory;
}
