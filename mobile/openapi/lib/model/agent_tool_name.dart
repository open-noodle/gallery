//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


enum AgentToolName {
  searchAssets._(r'searchAssets'),
  findTripCandidates._(r'findTripCandidates'),
  readSelectionMetadata._(r'readSelectionMetadata'),
  curateSelection._(r'curateSelection'),
  resolveAssetSearchFilters._(r'resolveAssetSearchFilters'),
  resolveLocation._(r'resolveLocation'),
  searchPeople._(r'searchPeople'),
  readAssetMetadata._(r'readAssetMetadata'),
  readAssetPreviews._(r'readAssetPreviews'),
  readAssetOriginals._(r'readAssetOriginals'),
  listAlbums._(r'listAlbums'),
  readAlbum._(r'readAlbum'),
  listSpaces._(r'listSpaces'),
  listDuplicateGroups._(r'listDuplicateGroups'),
  readSpace._(r'readSpace'),
  searchUsers._(r'searchUsers'),
  proposeAlbumOperations._(r'proposeAlbumOperations'),
  proposeAlbumFromSearch._(r'proposeAlbumFromSearch'),
  proposeAlbumFromSelection._(r'proposeAlbumFromSelection'),
  proposeAddAssetsToAlbumFromSearch._(r'proposeAddAssetsToAlbumFromSearch'),
  proposeSpaceFromSearch._(r'proposeSpaceFromSearch'),
  proposeAddAssetsToSpaceFromSearch._(r'proposeAddAssetsToSpaceFromSearch'),
  proposeAssetBatchFromSearch._(r'proposeAssetBatchFromSearch'),
  proposeAssetBatchFromSelection._(r'proposeAssetBatchFromSelection'),
  reviseProposedOperations._(r'reviseProposedOperations'),
  summarizePlan._(r'summarizePlan'),
  ;

  /// Instantiate a new enum with the provided value.
  const AgentToolName._(this._value);

  /// The underlying value of this enum member.
  final String _value;

  @override
  String toString() => _value;

  /// Encodes this enum as a value suitable for JSON.
  String toJson() => _value;

  /// Returns the instance of [AgentToolName] that was successfully decoded
  /// from the passed [value] on success, null otherwise.
  static AgentToolName? fromJson(dynamic value) => AgentToolNameTypeTransformer().decode(value);

  /// Returns a [List] containing instances of [AgentToolName]
  /// that were successfully decoded from the passed [JSON][json].
  static List<AgentToolName> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentToolName>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentToolName.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }
}

/// Transformation class that can [encode] an instance of [AgentToolName] to String,
/// and [decode] dynamic data back to [AgentToolName].
class AgentToolNameTypeTransformer {
  factory AgentToolNameTypeTransformer() => _instance ??= const AgentToolNameTypeTransformer._();

  const AgentToolNameTypeTransformer._();

  /// Encodes this enum as a value suitable for JSON.
  String encode(AgentToolName data) => data._value;

  /// Returns the instance of [AgentToolName] that was successfully decoded
  /// from the passed [data] value on success, null otherwise.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolName? decode(dynamic data, {bool allowNull = true}) {
    if (data is AgentToolName) {
      return data;
    }
    if (data != null) {
      switch (data) {
        case r'searchAssets': return AgentToolName.searchAssets;
        case r'findTripCandidates': return AgentToolName.findTripCandidates;
        case r'readSelectionMetadata': return AgentToolName.readSelectionMetadata;
        case r'curateSelection': return AgentToolName.curateSelection;
        case r'resolveAssetSearchFilters': return AgentToolName.resolveAssetSearchFilters;
        case r'resolveLocation': return AgentToolName.resolveLocation;
        case r'searchPeople': return AgentToolName.searchPeople;
        case r'readAssetMetadata': return AgentToolName.readAssetMetadata;
        case r'readAssetPreviews': return AgentToolName.readAssetPreviews;
        case r'readAssetOriginals': return AgentToolName.readAssetOriginals;
        case r'listAlbums': return AgentToolName.listAlbums;
        case r'readAlbum': return AgentToolName.readAlbum;
        case r'listSpaces': return AgentToolName.listSpaces;
        case r'listDuplicateGroups': return AgentToolName.listDuplicateGroups;
        case r'readSpace': return AgentToolName.readSpace;
        case r'searchUsers': return AgentToolName.searchUsers;
        case r'proposeAlbumOperations': return AgentToolName.proposeAlbumOperations;
        case r'proposeAlbumFromSearch': return AgentToolName.proposeAlbumFromSearch;
        case r'proposeAlbumFromSelection': return AgentToolName.proposeAlbumFromSelection;
        case r'proposeAddAssetsToAlbumFromSearch': return AgentToolName.proposeAddAssetsToAlbumFromSearch;
        case r'proposeSpaceFromSearch': return AgentToolName.proposeSpaceFromSearch;
        case r'proposeAddAssetsToSpaceFromSearch': return AgentToolName.proposeAddAssetsToSpaceFromSearch;
        case r'proposeAssetBatchFromSearch': return AgentToolName.proposeAssetBatchFromSearch;
        case r'proposeAssetBatchFromSelection': return AgentToolName.proposeAssetBatchFromSelection;
        case r'reviseProposedOperations': return AgentToolName.reviseProposedOperations;
        case r'summarizePlan': return AgentToolName.summarizePlan;
        default:
          if (!allowNull) {
            throw ArgumentError('Unknown enum value to decode: $data');
          }
      }
    }
    return null;
  }

  /// The singleton instance of this transformer.
  static AgentToolNameTypeTransformer? _instance;
}

