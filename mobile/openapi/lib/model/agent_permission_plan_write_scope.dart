//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class AgentPermissionPlanWriteScope {
  /// Returns a new [AgentPermissionPlanWriteScope] instance.
  AgentPermissionPlanWriteScope({
    required this.addAssets,
    required this.addAssetsToSpaces,
    required this.addMembersToSpaces,
    required this.archiveAssets,
    required this.createAlbum,
    required this.createSharedLinks,
    required this.createSpace,
    required this.deleteContainers,
    required this.editAssets,
    required this.favoriteAssets,
    required this.lockAssets,
    required this.managePeople,
    required this.manageStacks,
    required this.removeAssets,
    required this.removeAssetsFromSpaces,
    required this.removeMembersFromSpaces,
    required this.setCover,
    required this.shareAlbums,
    required this.tagAssets,
    required this.trashAssets,
    required this.updateAssetMetadata,
    required this.updateDetails,
    required this.updateSpaceDetails,
    required this.updateSpaceMemberRoles,
  });

  bool addAssets;

  bool addAssetsToSpaces;

  bool addMembersToSpaces;

  bool archiveAssets;

  bool createAlbum;

  bool createSharedLinks;

  bool createSpace;

  bool deleteContainers;

  bool editAssets;

  bool favoriteAssets;

  bool lockAssets;

  bool managePeople;

  bool manageStacks;

  bool removeAssets;

  bool removeAssetsFromSpaces;

  bool removeMembersFromSpaces;

  bool setCover;

  bool shareAlbums;

  bool tagAssets;

  bool trashAssets;

  bool updateAssetMetadata;

  bool updateDetails;

  bool updateSpaceDetails;

  bool updateSpaceMemberRoles;

  @override
  bool operator ==(Object other) => identical(this, other) || other is AgentPermissionPlanWriteScope &&
    other.addAssets == addAssets &&
    other.addAssetsToSpaces == addAssetsToSpaces &&
    other.addMembersToSpaces == addMembersToSpaces &&
    other.archiveAssets == archiveAssets &&
    other.createAlbum == createAlbum &&
    other.createSharedLinks == createSharedLinks &&
    other.createSpace == createSpace &&
    other.deleteContainers == deleteContainers &&
    other.editAssets == editAssets &&
    other.favoriteAssets == favoriteAssets &&
    other.lockAssets == lockAssets &&
    other.managePeople == managePeople &&
    other.manageStacks == manageStacks &&
    other.removeAssets == removeAssets &&
    other.removeAssetsFromSpaces == removeAssetsFromSpaces &&
    other.removeMembersFromSpaces == removeMembersFromSpaces &&
    other.setCover == setCover &&
    other.shareAlbums == shareAlbums &&
    other.tagAssets == tagAssets &&
    other.trashAssets == trashAssets &&
    other.updateAssetMetadata == updateAssetMetadata &&
    other.updateDetails == updateDetails &&
    other.updateSpaceDetails == updateSpaceDetails &&
    other.updateSpaceMemberRoles == updateSpaceMemberRoles;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (addAssets.hashCode) +
    (addAssetsToSpaces.hashCode) +
    (addMembersToSpaces.hashCode) +
    (archiveAssets.hashCode) +
    (createAlbum.hashCode) +
    (createSharedLinks.hashCode) +
    (createSpace.hashCode) +
    (deleteContainers.hashCode) +
    (editAssets.hashCode) +
    (favoriteAssets.hashCode) +
    (lockAssets.hashCode) +
    (managePeople.hashCode) +
    (manageStacks.hashCode) +
    (removeAssets.hashCode) +
    (removeAssetsFromSpaces.hashCode) +
    (removeMembersFromSpaces.hashCode) +
    (setCover.hashCode) +
    (shareAlbums.hashCode) +
    (tagAssets.hashCode) +
    (trashAssets.hashCode) +
    (updateAssetMetadata.hashCode) +
    (updateDetails.hashCode) +
    (updateSpaceDetails.hashCode) +
    (updateSpaceMemberRoles.hashCode);

  @override
  String toString() => 'AgentPermissionPlanWriteScope[addAssets=$addAssets, addAssetsToSpaces=$addAssetsToSpaces, addMembersToSpaces=$addMembersToSpaces, archiveAssets=$archiveAssets, createAlbum=$createAlbum, createSharedLinks=$createSharedLinks, createSpace=$createSpace, deleteContainers=$deleteContainers, editAssets=$editAssets, favoriteAssets=$favoriteAssets, lockAssets=$lockAssets, managePeople=$managePeople, manageStacks=$manageStacks, removeAssets=$removeAssets, removeAssetsFromSpaces=$removeAssetsFromSpaces, removeMembersFromSpaces=$removeMembersFromSpaces, setCover=$setCover, shareAlbums=$shareAlbums, tagAssets=$tagAssets, trashAssets=$trashAssets, updateAssetMetadata=$updateAssetMetadata, updateDetails=$updateDetails, updateSpaceDetails=$updateSpaceDetails, updateSpaceMemberRoles=$updateSpaceMemberRoles]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
      json[r'addAssets'] = this.addAssets;
      json[r'addAssetsToSpaces'] = this.addAssetsToSpaces;
      json[r'addMembersToSpaces'] = this.addMembersToSpaces;
      json[r'archiveAssets'] = this.archiveAssets;
      json[r'createAlbum'] = this.createAlbum;
      json[r'createSharedLinks'] = this.createSharedLinks;
      json[r'createSpace'] = this.createSpace;
      json[r'deleteContainers'] = this.deleteContainers;
      json[r'editAssets'] = this.editAssets;
      json[r'favoriteAssets'] = this.favoriteAssets;
      json[r'lockAssets'] = this.lockAssets;
      json[r'managePeople'] = this.managePeople;
      json[r'manageStacks'] = this.manageStacks;
      json[r'removeAssets'] = this.removeAssets;
      json[r'removeAssetsFromSpaces'] = this.removeAssetsFromSpaces;
      json[r'removeMembersFromSpaces'] = this.removeMembersFromSpaces;
      json[r'setCover'] = this.setCover;
      json[r'shareAlbums'] = this.shareAlbums;
      json[r'tagAssets'] = this.tagAssets;
      json[r'trashAssets'] = this.trashAssets;
      json[r'updateAssetMetadata'] = this.updateAssetMetadata;
      json[r'updateDetails'] = this.updateDetails;
      json[r'updateSpaceDetails'] = this.updateSpaceDetails;
      json[r'updateSpaceMemberRoles'] = this.updateSpaceMemberRoles;
    return json;
  }

  /// Returns a new [AgentPermissionPlanWriteScope] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static AgentPermissionPlanWriteScope? fromJson(dynamic value) {
    upgradeDto(value, "AgentPermissionPlanWriteScope");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return AgentPermissionPlanWriteScope(
        addAssets: mapValueOfType<bool>(json, r'addAssets')!,
        addAssetsToSpaces: mapValueOfType<bool>(json, r'addAssetsToSpaces')!,
        addMembersToSpaces: mapValueOfType<bool>(json, r'addMembersToSpaces')!,
        archiveAssets: mapValueOfType<bool>(json, r'archiveAssets')!,
        createAlbum: mapValueOfType<bool>(json, r'createAlbum')!,
        createSharedLinks: mapValueOfType<bool>(json, r'createSharedLinks')!,
        createSpace: mapValueOfType<bool>(json, r'createSpace')!,
        deleteContainers: mapValueOfType<bool>(json, r'deleteContainers')!,
        editAssets: mapValueOfType<bool>(json, r'editAssets')!,
        favoriteAssets: mapValueOfType<bool>(json, r'favoriteAssets')!,
        lockAssets: mapValueOfType<bool>(json, r'lockAssets')!,
        managePeople: mapValueOfType<bool>(json, r'managePeople')!,
        manageStacks: mapValueOfType<bool>(json, r'manageStacks')!,
        removeAssets: mapValueOfType<bool>(json, r'removeAssets')!,
        removeAssetsFromSpaces: mapValueOfType<bool>(json, r'removeAssetsFromSpaces')!,
        removeMembersFromSpaces: mapValueOfType<bool>(json, r'removeMembersFromSpaces')!,
        setCover: mapValueOfType<bool>(json, r'setCover')!,
        shareAlbums: mapValueOfType<bool>(json, r'shareAlbums')!,
        tagAssets: mapValueOfType<bool>(json, r'tagAssets')!,
        trashAssets: mapValueOfType<bool>(json, r'trashAssets')!,
        updateAssetMetadata: mapValueOfType<bool>(json, r'updateAssetMetadata')!,
        updateDetails: mapValueOfType<bool>(json, r'updateDetails')!,
        updateSpaceDetails: mapValueOfType<bool>(json, r'updateSpaceDetails')!,
        updateSpaceMemberRoles: mapValueOfType<bool>(json, r'updateSpaceMemberRoles')!,
      );
    }
    return null;
  }

  static List<AgentPermissionPlanWriteScope> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <AgentPermissionPlanWriteScope>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = AgentPermissionPlanWriteScope.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, AgentPermissionPlanWriteScope> mapFromJson(dynamic json) {
    final map = <String, AgentPermissionPlanWriteScope>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = AgentPermissionPlanWriteScope.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of AgentPermissionPlanWriteScope-objects as value to a dart map
  static Map<String, List<AgentPermissionPlanWriteScope>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<AgentPermissionPlanWriteScope>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = AgentPermissionPlanWriteScope.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'addAssets',
    'addAssetsToSpaces',
    'addMembersToSpaces',
    'archiveAssets',
    'createAlbum',
    'createSharedLinks',
    'createSpace',
    'deleteContainers',
    'editAssets',
    'favoriteAssets',
    'lockAssets',
    'managePeople',
    'manageStacks',
    'removeAssets',
    'removeAssetsFromSpaces',
    'removeMembersFromSpaces',
    'setCover',
    'shareAlbums',
    'tagAssets',
    'trashAssets',
    'updateAssetMetadata',
    'updateDetails',
    'updateSpaceDetails',
    'updateSpaceMemberRoles',
  };
}

