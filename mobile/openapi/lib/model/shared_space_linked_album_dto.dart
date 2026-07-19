//
// AUTO-GENERATED FILE, DO NOT MODIFY!
//
// @dart=2.18

// ignore_for_file: unused_element, unused_import
// ignore_for_file: always_put_required_named_parameters_first
// ignore_for_file: constant_identifier_names
// ignore_for_file: lines_longer_than_80_chars

part of openapi.api;

class SharedSpaceLinkedAlbumDto {
  /// Returns a new [SharedSpaceLinkedAlbumDto] instance.
  SharedSpaceLinkedAlbumDto({
    required this.addedById,
    required this.albumName,
    required this.albumThumbnailAssetId,
    required this.assetCount,
    this.contributorCounts = const Optional.present(const []),
    required this.createdAt,
    required this.description,
    this.endDate = const Optional.absent(),
    required this.hasSharedLink,
    required this.id,
    required this.isActivityEnabled,
    this.lastModifiedAssetTimestamp = const Optional.absent(),
    required this.linkedAt,
    this.order = const Optional.absent(),
    required this.ownerId,
    required this.shared,
    this.sharedSpaceLinks = const Optional.present(const []),
    required this.showInTimeline,
    this.startDate = const Optional.absent(),
    required this.updatedAt,
  });

  /// User who linked the album into the space
  String? addedById;

  /// Album name
  String albumName;

  /// Thumbnail asset ID
  String? albumThumbnailAssetId;

  /// Number of assets
  ///
  /// Minimum value: 0
  /// Maximum value: 9007199254740991
  int assetCount;

  Optional<List<ContributorCountResponseDto>?> contributorCounts;

  /// Creation date
  DateTime createdAt;

  /// Album description
  String description;

  /// End date (latest asset)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> endDate;

  /// Has shared link
  bool hasSharedLink;

  /// Album ID
  String id;

  /// Activity feed enabled
  bool isActivityEnabled;

  /// Last modified asset timestamp
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> lastModifiedAssetTimestamp;

  /// Link creation timestamp
  DateTime linkedAt;

  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<AssetOrder?> order;

  /// User ID of the album owner (non-PII UUID, for group-by-owner)
  String ownerId;

  /// Is shared album
  bool shared;

  Optional<List<AlbumSharedSpaceLinkResponseDto>?> sharedSpaceLinks;

  /// Include this album in the space timeline
  bool showInTimeline;

  /// Start date (earliest asset)
  ///
  /// Please note: This property should have been non-nullable! Since the specification file
  /// does not include a default value (using the "default:" property), however, the generated
  /// source code must fall back to having a nullable type.
  /// Consider adding a "default:" property in the specification file to hide this note.
  ///
  Optional<DateTime?> startDate;

  /// Last update date
  DateTime updatedAt;

  @override
  bool operator ==(Object other) => identical(this, other) || other is SharedSpaceLinkedAlbumDto &&
    other.addedById == addedById &&
    other.albumName == albumName &&
    other.albumThumbnailAssetId == albumThumbnailAssetId &&
    other.assetCount == assetCount &&
    _deepEquality.equals(other.contributorCounts, contributorCounts) &&
    other.createdAt == createdAt &&
    other.description == description &&
    other.endDate == endDate &&
    other.hasSharedLink == hasSharedLink &&
    other.id == id &&
    other.isActivityEnabled == isActivityEnabled &&
    other.lastModifiedAssetTimestamp == lastModifiedAssetTimestamp &&
    other.linkedAt == linkedAt &&
    other.order == order &&
    other.ownerId == ownerId &&
    other.shared == shared &&
    _deepEquality.equals(other.sharedSpaceLinks, sharedSpaceLinks) &&
    other.showInTimeline == showInTimeline &&
    other.startDate == startDate &&
    other.updatedAt == updatedAt;

  @override
  int get hashCode =>
    // ignore: unnecessary_parenthesis
    (addedById == null ? 0 : addedById!.hashCode) +
    (albumName.hashCode) +
    (albumThumbnailAssetId == null ? 0 : albumThumbnailAssetId!.hashCode) +
    (assetCount.hashCode) +
    (contributorCounts.hashCode) +
    (createdAt.hashCode) +
    (description.hashCode) +
    (endDate == null ? 0 : endDate!.hashCode) +
    (hasSharedLink.hashCode) +
    (id.hashCode) +
    (isActivityEnabled.hashCode) +
    (lastModifiedAssetTimestamp == null ? 0 : lastModifiedAssetTimestamp!.hashCode) +
    (linkedAt.hashCode) +
    (order == null ? 0 : order!.hashCode) +
    (ownerId.hashCode) +
    (shared.hashCode) +
    (sharedSpaceLinks.hashCode) +
    (showInTimeline.hashCode) +
    (startDate == null ? 0 : startDate!.hashCode) +
    (updatedAt.hashCode);

  @override
  String toString() => 'SharedSpaceLinkedAlbumDto[addedById=$addedById, albumName=$albumName, albumThumbnailAssetId=$albumThumbnailAssetId, assetCount=$assetCount, contributorCounts=$contributorCounts, createdAt=$createdAt, description=$description, endDate=$endDate, hasSharedLink=$hasSharedLink, id=$id, isActivityEnabled=$isActivityEnabled, lastModifiedAssetTimestamp=$lastModifiedAssetTimestamp, linkedAt=$linkedAt, order=$order, ownerId=$ownerId, shared=$shared, sharedSpaceLinks=$sharedSpaceLinks, showInTimeline=$showInTimeline, startDate=$startDate, updatedAt=$updatedAt]';

  Map<String, dynamic> toJson() {
    final json = <String, dynamic>{};
    if (this.addedById != null) {
      json[r'addedById'] = this.addedById;
    } else {
    //  json[r'addedById'] = null;
    }
      json[r'albumName'] = this.albumName;
    if (this.albumThumbnailAssetId != null) {
      json[r'albumThumbnailAssetId'] = this.albumThumbnailAssetId;
    } else {
    //  json[r'albumThumbnailAssetId'] = null;
    }
      json[r'assetCount'] = this.assetCount;
    if (this.contributorCounts.isPresent) {
      final value = this.contributorCounts.value;
      json[r'contributorCounts'] = value;
    }
      json[r'createdAt'] = this.createdAt.toUtc().toIso8601String();
      json[r'description'] = this.description;
    if (this.endDate.isPresent) {
      final value = this.endDate.value;
      json[r'endDate'] = value == null ? null : value.toUtc().toIso8601String();
    }
      json[r'hasSharedLink'] = this.hasSharedLink;
      json[r'id'] = this.id;
      json[r'isActivityEnabled'] = this.isActivityEnabled;
    if (this.lastModifiedAssetTimestamp.isPresent) {
      final value = this.lastModifiedAssetTimestamp.value;
      json[r'lastModifiedAssetTimestamp'] = value == null ? null : value.toUtc().toIso8601String();
    }
      json[r'linkedAt'] = this.linkedAt.toUtc().toIso8601String();
    if (this.order.isPresent) {
      final value = this.order.value;
      json[r'order'] = value;
    }
      json[r'ownerId'] = this.ownerId;
      json[r'shared'] = this.shared;
    if (this.sharedSpaceLinks.isPresent) {
      final value = this.sharedSpaceLinks.value;
      json[r'sharedSpaceLinks'] = value;
    }
      json[r'showInTimeline'] = this.showInTimeline;
    if (this.startDate.isPresent) {
      final value = this.startDate.value;
      json[r'startDate'] = value == null ? null : value.toUtc().toIso8601String();
    }
      json[r'updatedAt'] = this.updatedAt.toUtc().toIso8601String();
    return json;
  }

  /// Returns a new [SharedSpaceLinkedAlbumDto] instance and imports its values from
  /// [value] if it's a [Map], null otherwise.
  // ignore: prefer_constructors_over_static_methods
  static SharedSpaceLinkedAlbumDto? fromJson(dynamic value) {
    upgradeDto(value, "SharedSpaceLinkedAlbumDto");
    if (value is Map) {
      final json = value.cast<String, dynamic>();

      return SharedSpaceLinkedAlbumDto(
        addedById: mapValueOfType<String>(json, r'addedById'),
        albumName: mapValueOfType<String>(json, r'albumName')!,
        albumThumbnailAssetId: mapValueOfType<String>(json, r'albumThumbnailAssetId'),
        assetCount: mapValueOfType<int>(json, r'assetCount')!,
        contributorCounts: json.containsKey(r'contributorCounts') ? Optional.present(ContributorCountResponseDto.listFromJson(json[r'contributorCounts'])) : const Optional.absent(),
        createdAt: mapDateTime(json, r'createdAt', r'')!,
        description: mapValueOfType<String>(json, r'description')!,
        endDate: json.containsKey(r'endDate') ? Optional.present(mapDateTime(json, r'endDate', r'')) : const Optional.absent(),
        hasSharedLink: mapValueOfType<bool>(json, r'hasSharedLink')!,
        id: mapValueOfType<String>(json, r'id')!,
        isActivityEnabled: mapValueOfType<bool>(json, r'isActivityEnabled')!,
        lastModifiedAssetTimestamp: json.containsKey(r'lastModifiedAssetTimestamp') ? Optional.present(mapDateTime(json, r'lastModifiedAssetTimestamp', r'')) : const Optional.absent(),
        linkedAt: mapDateTime(json, r'linkedAt', r'')!,
        order: json.containsKey(r'order') ? Optional.present(AssetOrder.fromJson(json[r'order'])) : const Optional.absent(),
        ownerId: mapValueOfType<String>(json, r'ownerId')!,
        shared: mapValueOfType<bool>(json, r'shared')!,
        sharedSpaceLinks: json.containsKey(r'sharedSpaceLinks') ? Optional.present(AlbumSharedSpaceLinkResponseDto.listFromJson(json[r'sharedSpaceLinks'])) : const Optional.absent(),
        showInTimeline: mapValueOfType<bool>(json, r'showInTimeline')!,
        startDate: json.containsKey(r'startDate') ? Optional.present(mapDateTime(json, r'startDate', r'')) : const Optional.absent(),
        updatedAt: mapDateTime(json, r'updatedAt', r'')!,
      );
    }
    return null;
  }

  static List<SharedSpaceLinkedAlbumDto> listFromJson(dynamic json, {bool growable = false,}) {
    final result = <SharedSpaceLinkedAlbumDto>[];
    if (json is List && json.isNotEmpty) {
      for (final row in json) {
        final value = SharedSpaceLinkedAlbumDto.fromJson(row);
        if (value != null) {
          result.add(value);
        }
      }
    }
    return result.toList(growable: growable);
  }

  static Map<String, SharedSpaceLinkedAlbumDto> mapFromJson(dynamic json) {
    final map = <String, SharedSpaceLinkedAlbumDto>{};
    if (json is Map && json.isNotEmpty) {
      json = json.cast<String, dynamic>(); // ignore: parameter_assignments
      for (final entry in json.entries) {
        final value = SharedSpaceLinkedAlbumDto.fromJson(entry.value);
        if (value != null) {
          map[entry.key] = value;
        }
      }
    }
    return map;
  }

  // maps a json object with a list of SharedSpaceLinkedAlbumDto-objects as value to a dart map
  static Map<String, List<SharedSpaceLinkedAlbumDto>> mapListFromJson(dynamic json, {bool growable = false,}) {
    final map = <String, List<SharedSpaceLinkedAlbumDto>>{};
    if (json is Map && json.isNotEmpty) {
      // ignore: parameter_assignments
      json = json.cast<String, dynamic>();
      for (final entry in json.entries) {
        map[entry.key] = SharedSpaceLinkedAlbumDto.listFromJson(entry.value, growable: growable,);
      }
    }
    return map;
  }

  /// The list of required keys that must be present in a JSON.
  static const requiredKeys = <String>{
    'addedById',
    'albumName',
    'albumThumbnailAssetId',
    'assetCount',
    'createdAt',
    'description',
    'hasSharedLink',
    'id',
    'isActivityEnabled',
    'linkedAt',
    'ownerId',
    'shared',
    'showInTimeline',
    'updatedAt',
  };
}

