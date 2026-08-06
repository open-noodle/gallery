//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;


class AgentToolName {
  /// Instantiate a new enum with the provided [value].
  const AgentToolName._(this.value);

  /// The underlying value of this enum member.
  final String value;

  @override
  String toString() => value;

  String toJson() => value;

  static const searchAssets = AgentToolName._(r'searchAssets');
  static const findTripCandidates = AgentToolName._(r'findTripCandidates');
  static const readSelectionMetadata = AgentToolName._(r'readSelectionMetadata');
  static const curateSelection = AgentToolName._(r'curateSelection');
  static const resolveAssetSearchFilters = AgentToolName._(r'resolveAssetSearchFilters');
  static const resolveLocation = AgentToolName._(r'resolveLocation');
  static const searchPeople = AgentToolName._(r'searchPeople');
  static const readAssetMetadata = AgentToolName._(r'readAssetMetadata');
  static const readAssetPreviews = AgentToolName._(r'readAssetPreviews');
  static const readAssetOriginals = AgentToolName._(r'readAssetOriginals');
  static const listAlbums = AgentToolName._(r'listAlbums');
  static const readAlbum = AgentToolName._(r'readAlbum');
  static const listSpaces = AgentToolName._(r'listSpaces');
  static const listDuplicateGroups = AgentToolName._(r'listDuplicateGroups');
  static const readSpace = AgentToolName._(r'readSpace');
  static const searchUsers = AgentToolName._(r'searchUsers');
  static const proposeAlbumOperations = AgentToolName._(r'proposeAlbumOperations');
  static const proposeAlbumFromSearch = AgentToolName._(r'proposeAlbumFromSearch');
  static const proposeAlbumFromSelection = AgentToolName._(r'proposeAlbumFromSelection');
  static const proposeAddAssetsToAlbumFromSearch = AgentToolName._(r'proposeAddAssetsToAlbumFromSearch');
  static const proposeSpaceFromSearch = AgentToolName._(r'proposeSpaceFromSearch');
  static const proposeAddAssetsToSpaceFromSearch = AgentToolName._(r'proposeAddAssetsToSpaceFromSearch');
  static const proposeAssetBatchFromSearch = AgentToolName._(r'proposeAssetBatchFromSearch');
  static const proposeAssetBatchFromSelection = AgentToolName._(r'proposeAssetBatchFromSelection');
  static const reviseProposedOperations = AgentToolName._(r'reviseProposedOperations');
  static const summarizePlan = AgentToolName._(r'summarizePlan');

  /// List of all possible values in this [enum][AgentToolName].
  static const values = <AgentToolName>[
    searchAssets,
    findTripCandidates,
    readSelectionMetadata,
    curateSelection,
    resolveAssetSearchFilters,
    resolveLocation,
    searchPeople,
    readAssetMetadata,
    readAssetPreviews,
    readAssetOriginals,
    listAlbums,
    readAlbum,
    listSpaces,
    listDuplicateGroups,
    readSpace,
    searchUsers,
    proposeAlbumOperations,
    proposeAlbumFromSearch,
    proposeAlbumFromSelection,
    proposeAddAssetsToAlbumFromSearch,
    proposeSpaceFromSearch,
    proposeAddAssetsToSpaceFromSearch,
    proposeAssetBatchFromSearch,
    proposeAssetBatchFromSelection,
    reviseProposedOperations,
    summarizePlan,
  ];

  static AgentToolName? fromJson(dynamic value) => AgentToolNameTypeTransformer().decode(value);

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

  String encode(AgentToolName data) => data.value;

  /// Decodes a [dynamic value][data] to a AgentToolName.
  ///
  /// If [allowNull] is true and the [dynamic value][data] cannot be decoded successfully,
  /// then null is returned. However, if [allowNull] is false and the [dynamic value][data]
  /// cannot be decoded successfully, then an [UnimplementedError] is thrown.
  ///
  /// The [allowNull] is very handy when an API changes and a new enum value is added or removed,
  /// and users are still using an old app with the old code.
  AgentToolName? decode(dynamic data, {bool allowNull = true}) {
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

  /// Singleton [AgentToolNameTypeTransformer] instance.
  static AgentToolNameTypeTransformer? _instance;
}

