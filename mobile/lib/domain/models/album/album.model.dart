import 'package:flutter/foundation.dart';
import 'package:freezed_annotation/freezed_annotation.dart';

part 'album.model.freezed.dart';

enum AlbumAssetOrder {
  // do not change this order!
  asc,
  desc,
}

enum AlbumUserRole {
  // do not change this order!
  editor,
  viewer,
  owner,
}

// Model for an album stored in the server
@freezed
abstract class RemoteAlbum with _$RemoteAlbum {
  const factory RemoteAlbum({
    required String id,
    required String name,
    required String ownerId,
    required String description,
    required DateTime createdAt,
    required DateTime updatedAt,
    String? thumbnailAssetId,
    required bool isActivityEnabled,
    required AlbumAssetOrder order,
    required int assetCount,
    required String ownerName,
    required bool isShared,

    /// The current user's role in this album, if known.
    ///
    /// - `null` when not populated (e.g. from DB queries that don't join the
    ///   role table or in test fixtures that don't need it).
    /// - [AlbumUserRole.owner] when the current user is the album owner.
    /// - [AlbumUserRole.editor] / [AlbumUserRole.viewer] for shared albums.
    ///
    /// Used by [linkableAlbumCandidates] to determine own/editable albums
    /// without an extra async DB call per album.
    AlbumUserRole? currentUserRole,
  }) = _RemoteAlbum;
}
