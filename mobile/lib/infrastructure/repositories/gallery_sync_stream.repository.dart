import 'package:drift/drift.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/memory/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/library.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_folder.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_hidden.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_album_link.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_library.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/shared_space_member.drift.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart' show AssetVisibility;
import 'package:immich_mobile/infrastructure/repositories/space_album.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/sync_stream.repository.dart';
import 'package:logging/logging.dart';
import 'package:openapi/api.dart' hide AssetVisibility;

typedef GallerySyncHandler = Future<void> Function(Iterable<Object> data);

/// Fork sync entity types and their handlers. [SyncStreamService] dispatches every type its
/// upstream switch does not handle through this map. [currentUserId] is read at dispatch time so
/// the repository stays free of a Store dependency (see [GallerySyncStreamRepository.deleteLibrariesV1]).
Map<SyncEntityType, GallerySyncHandler> gallerySyncHandlers(
  GallerySyncStreamRepository repo, {
  required String? Function() currentUserId,
}) => {
  SyncEntityType.sharedSpaceV1: (data) => repo.updateSharedSpacesV1(data.cast()),
  SyncEntityType.sharedSpaceDeleteV1: (data) => repo.deleteSharedSpacesV1(data.cast()),
  SyncEntityType.sharedSpaceMemberV1: (data) => repo.updateSharedSpaceMembersV1(data.cast()),
  SyncEntityType.sharedSpaceMemberBackfillV1: (data) => repo.updateSharedSpaceMembersV1(data.cast()),
  SyncEntityType.sharedSpaceMemberDeleteV1: (data) => repo.deleteSharedSpaceMembersV1(data.cast()),
  SyncEntityType.sharedSpaceAssetCreateV1: (data) => repo.updateSharedSpaceAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAssetUpdateV1: (data) => repo.updateSharedSpaceAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAssetBackfillV1: (data) => repo.updateSharedSpaceAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAssetExifCreateV1: (data) => repo.updateSharedSpaceAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceAssetExifUpdateV1: (data) => repo.updateSharedSpaceAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceAssetExifBackfillV1: (data) => repo.updateSharedSpaceAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceToAssetV1: (data) => repo.updateSharedSpaceToAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceToAssetBackfillV1: (data) => repo.updateSharedSpaceToAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceToAssetDeleteV1: (data) => repo.deleteSharedSpaceToAssetsV1(data.cast()),
  SyncEntityType.libraryV1: (data) => repo.updateLibrariesV1(data.cast()),
  SyncEntityType.libraryDeleteV1: (data) async {
    final userId = currentUserId();
    if (userId == null) {
      _serviceLogger.warning('LibraryDeleteV1 received without a current user id — skipping sweep');
      return;
    }
    return repo.deleteLibrariesV1(data.cast(), currentUserId: userId);
  },
  SyncEntityType.libraryAssetCreateV1: (data) => repo.updateLibraryAssetsV1(data.cast()),
  SyncEntityType.libraryAssetBackfillV1: (data) => repo.updateLibraryAssetsV1(data.cast()),
  SyncEntityType.libraryAssetDeleteV1: (data) => repo.deleteLibraryAssetsV1(data.cast()),
  SyncEntityType.libraryAssetExifCreateV1: (data) => repo.updateLibraryAssetExifsV1(data.cast()),
  SyncEntityType.libraryAssetExifBackfillV1: (data) => repo.updateLibraryAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceLibraryV1: (data) => repo.updateSharedSpaceLibrariesV1(data.cast()),
  SyncEntityType.sharedSpaceLibraryBackfillV1: (data) => repo.updateSharedSpaceLibrariesV1(data.cast()),
  SyncEntityType.sharedSpaceLibraryDeleteV1: (data) => repo.deleteSharedSpaceLibrariesV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumV1: (data) => repo.updateSharedSpaceAlbumsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumBackfillV1: (data) => repo.updateSharedSpaceAlbumsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumDeleteV1: (data) => repo.deleteSharedSpaceAlbumsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumLinkV1: (data) => repo.updateSharedSpaceAlbumLinksV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumLinkBackfillV1: (data) => repo.updateSharedSpaceAlbumLinksV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumLinkDeleteV1: (data) => repo.deleteSharedSpaceAlbumLinksV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumFolderV1: (data) => repo.updateSharedSpaceAlbumFoldersV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumFolderBackfillV1: (data) => repo.updateSharedSpaceAlbumFoldersV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumFolderDeleteV1: (data) => repo.deleteSharedSpaceAlbumFoldersV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumToAssetV1: (data) => repo.updateSharedSpaceAlbumToAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumToAssetBackfillV1: (data) => repo.updateSharedSpaceAlbumToAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumToAssetDeleteV1: (data) => repo.deleteSharedSpaceAlbumToAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetCreateV1: (data) => repo.updateSharedSpaceAlbumAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetUpdateV1: (data) => repo.updateSharedSpaceAlbumAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetBackfillV1: (data) => repo.updateSharedSpaceAlbumAssetsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetExifCreateV1: (data) => repo.updateSharedSpaceAlbumAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetExifUpdateV1: (data) => repo.updateSharedSpaceAlbumAssetExifsV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumAssetExifBackfillV1: (data) => repo.updateSharedSpaceAlbumAssetExifsV1(data.cast()),
  // gallery-fork (#1041): per-member "hidden from my timeline" album rows.
  SyncEntityType.sharedSpaceAlbumHiddenV1: (data) => repo.updateSharedSpaceAlbumHiddenV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumHiddenBackfillV1: (data) => repo.updateSharedSpaceAlbumHiddenV1(data.cast()),
  SyncEntityType.sharedSpaceAlbumHiddenDeleteV1: (data) => repo.deleteSharedSpaceAlbumHiddenV1(data.cast()),
  // Per-user favorites (#763).
  SyncEntityType.assetFavoriteV1: (data) => repo.updateAssetFavoritesV1(data.cast()),
  SyncEntityType.assetFavoriteDeleteV1: (data) => repo.deleteAssetFavoritesV1(data.cast()),
};

/// Decoders for the fork sync entity types, spread into upstream's `_kResponseMap` in
/// sync_api.repository.dart. Every type here also needs a handler in [gallerySyncHandlers].
const gallerySyncResponseMap = <SyncEntityType, Function(Object)>{
  // --- gallery-fork: shared-space sync types ---
  SyncEntityType.sharedSpaceV1: SyncSharedSpaceV1.fromJson,
  SyncEntityType.sharedSpaceDeleteV1: SyncSharedSpaceDeleteV1.fromJson,
  SyncEntityType.sharedSpaceMemberV1: SyncSharedSpaceMemberV1.fromJson,
  SyncEntityType.sharedSpaceMemberBackfillV1: SyncSharedSpaceMemberV1.fromJson,
  SyncEntityType.sharedSpaceMemberDeleteV1: SyncSharedSpaceMemberDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAssetCreateV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetUpdateV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifUpdateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceToAssetV1: SyncSharedSpaceToAssetV1.fromJson,
  SyncEntityType.sharedSpaceToAssetBackfillV1: SyncSharedSpaceToAssetV1.fromJson,
  SyncEntityType.sharedSpaceToAssetDeleteV1: SyncSharedSpaceToAssetDeleteV1.fromJson,
  // --- gallery-fork: library sync types ---
  SyncEntityType.libraryV1: SyncLibraryV1.fromJson,
  SyncEntityType.libraryDeleteV1: SyncLibraryDeleteV1.fromJson,
  SyncEntityType.libraryAssetCreateV1: SyncAssetV1.fromJson,
  SyncEntityType.libraryAssetBackfillV1: SyncAssetV1.fromJson,
  SyncEntityType.libraryAssetDeleteV1: SyncLibraryAssetDeleteV1.fromJson,
  SyncEntityType.libraryAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.libraryAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceLibraryV1: SyncSharedSpaceLibraryV1.fromJson,
  SyncEntityType.sharedSpaceLibraryBackfillV1: SyncSharedSpaceLibraryV1.fromJson,
  SyncEntityType.sharedSpaceLibraryDeleteV1: SyncSharedSpaceLibraryDeleteV1.fromJson,
  // --- gallery-fork: shared-space album sync types (Phase 2B) ---
  SyncEntityType.sharedSpaceAlbumV1: SyncAlbumV2.fromJson,
  SyncEntityType.sharedSpaceAlbumBackfillV1: SyncAlbumV2.fromJson,
  SyncEntityType.sharedSpaceAlbumDeleteV1: SyncAlbumDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkV1: SyncSharedSpaceAlbumLinkV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkBackfillV1: SyncSharedSpaceAlbumLinkV1.fromJson,
  SyncEntityType.sharedSpaceAlbumLinkDeleteV1: SyncSharedSpaceAlbumLinkDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumFolderV1: SyncSharedSpaceAlbumFolderV1.fromJson,
  SyncEntityType.sharedSpaceAlbumFolderBackfillV1: SyncSharedSpaceAlbumFolderV1.fromJson,
  SyncEntityType.sharedSpaceAlbumFolderDeleteV1: SyncSharedSpaceAlbumFolderDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetBackfillV1: SyncAlbumToAssetV1.fromJson,
  SyncEntityType.sharedSpaceAlbumToAssetDeleteV1: SyncAlbumToAssetDeleteV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetCreateV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetUpdateV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetBackfillV1: SyncAssetV2.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifCreateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifUpdateV1: SyncAssetExifV1.fromJson,
  SyncEntityType.sharedSpaceAlbumAssetExifBackfillV1: SyncAssetExifV1.fromJson,
  // gallery-fork (#1041): per-member "hidden from my timeline" album rows.
  SyncEntityType.sharedSpaceAlbumHiddenV1: SyncSharedSpaceAlbumHiddenV1.fromJson,
  SyncEntityType.sharedSpaceAlbumHiddenBackfillV1: SyncSharedSpaceAlbumHiddenV1.fromJson,
  SyncEntityType.sharedSpaceAlbumHiddenDeleteV1: SyncSharedSpaceAlbumHiddenDeleteV1.fromJson,
  // --- gallery-fork: per-user favorites sync (#763) ---
  SyncEntityType.assetFavoriteV1: SyncAssetFavoriteV1.fromJson,
  SyncEntityType.assetFavoriteDeleteV1: SyncAssetFavoriteDeleteV1.fromJson,
};

// Same logger name the dispatch switch used, so the skip warning reads as before.
final _serviceLogger = Logger('SyncStreamService');

/// Gallery-only sync stream handlers: shared spaces, libraries, space albums, per-user
/// favorites and the space-aware asset prune. Upstream handlers stay in [SyncStreamRepository].
class GallerySyncStreamRepository extends DatabaseAccessor<Drift> {
  final Logger _logger = Logger('SyncStreamRepository');

  GallerySyncStreamRepository(super.attachedDatabase);

  Drift get _db => attachedDatabase;

  SyncStreamRepository get _syncStream => _db.syncStreamRepository;

  /// Clears every fork-only remote table. Called by [SyncStreamRepository.reset] inside its
  /// transaction, under PRAGMA foreign_keys = OFF.
  Future<void> resetTables() async {
    // SyncResetV1 must wipe every fork-only remote table too, or a stale
    // shared_space_album_asset + link row joined to a re-synced remote_asset
    // wrongly re-places assets in space timelines after a reset. Runs under
    // PRAGMA foreign_keys = OFF (see reset() preamble), so ordering is free;
    // children-before-parents kept for readability.
    await _db.sharedSpaceAlbumAssetEntity.deleteAll();
    // gallery-fork (#1041): per-member "hidden from my timeline" album rows.
    await _db.sharedSpaceAlbumHiddenEntity.deleteAll();
    await _db.sharedSpaceAlbumLinkEntity.deleteAll();
    // Folders must be listed EXPLICITLY. Their only other removal path is the spaceId
    // cascade, and foreign_keys is OFF for this whole block — so an omission here is never
    // cleared by anything: a folder deleted server-side while the device was away has had
    // its tombstone pruned, so the delete is never re-delivered, and folders for spaces the
    // user was removed from stay on disk with their names while every other space table is
    // rebuilt from what the user can still access.
    await _db.sharedSpaceAlbumFolderEntity.deleteAll();
    await _db.sharedSpaceAlbumEntity.deleteAll();
    await _db.sharedSpaceAssetEntity.deleteAll();
    await _db.sharedSpaceLibraryEntity.deleteAll();
    await _db.sharedSpaceMemberEntity.deleteAll();
    await _db.sharedSpaceEntity.deleteAll();
    await _db.libraryEntity.deleteAll();
  }

  // --- gallery-fork: shared-space sync handlers ---

  Future<void> updateSharedSpacesV1(Iterable<SyncSharedSpaceV1> data) async {
    try {
      await _db.batch((batch) {
        for (final space in data) {
          final companion = SharedSpaceEntityCompanion(
            name: Value(space.name),
            description: Value(space.description),
            color: Value(space.color),
            createdById: Value(space.createdById),
            thumbnailAssetId: Value(space.thumbnailAssetId),
            thumbnailCropY: Value(space.thumbnailCropY),
            faceRecognitionEnabled: Value(space.faceRecognitionEnabled),
            petsEnabled: Value(space.petsEnabled),
            lastActivityAt: Value(space.lastActivityAt),
            createdAt: Value(space.createdAt),
            updatedAt: Value(space.updatedAt),
          );

          batch.insert(
            _db.sharedSpaceEntity,
            companion.copyWith(id: Value(space.id)),
            onConflict: DoUpdate((_) => companion),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpacesV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpacesV1(Iterable<SyncSharedSpaceDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final space in data) {
          batch.deleteWhere(_db.sharedSpaceEntity, (row) => row.id.equals(space.spaceId));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpacesV1', error, stack);
      rethrow;
    }
  }

  Future<void> updateSharedSpaceMembersV1(Iterable<SyncSharedSpaceMemberV1> data) async {
    try {
      await _db.batch((batch) {
        for (final member in data) {
          final companion = SharedSpaceMemberEntityCompanion(
            role: Value(member.role),
            joinedAt: Value(member.joinedAt),
            showInTimeline: Value(member.showInTimeline),
          );

          batch.insert(
            _db.sharedSpaceMemberEntity,
            companion.copyWith(spaceId: Value(member.spaceId), userId: Value(member.userId)),
            onConflict: DoUpdate((_) => companion),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceMembersV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceMembersV1(Iterable<SyncSharedSpaceMemberDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final member in data) {
          batch.delete(
            _db.sharedSpaceMemberEntity,
            SharedSpaceMemberEntityCompanion(spaceId: Value(member.spaceId), userId: Value(member.userId)),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceMembersV1', error, stack);
      rethrow;
    }
  }

  // SharedSpaceAssetCreate/Update/Backfill use the same SyncAssetV1 payload as
  // the regular asset stream. We delegate to updateAssetsV1 to upsert into
  // remote_asset, which is the source of truth for asset metadata.
  Future<void> updateSharedSpaceAssetsV1(Iterable<SyncAssetV1> data) =>
      _syncStream.updateAssetsV1(data, debugLabel: 'shared-space');

  // Same delegation for exif rows.
  Future<void> updateSharedSpaceAssetExifsV1(Iterable<SyncAssetExifV1> data) =>
      _syncStream.updateAssetsExifV1(data, debugLabel: 'shared-space');

  Future<void> updateSharedSpaceToAssetsV1(Iterable<SyncSharedSpaceToAssetV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          final companion = SharedSpaceAssetEntityCompanion(spaceId: Value(join.spaceId), assetId: Value(join.assetId));

          batch.insert(_db.sharedSpaceAssetEntity, companion, onConflict: DoNothing());
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceToAssetsV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceToAssetsV1(Iterable<SyncSharedSpaceToAssetDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          batch.delete(
            _db.sharedSpaceAssetEntity,
            SharedSpaceAssetEntityCompanion(spaceId: Value(join.spaceId), assetId: Value(join.assetId)),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceToAssetsV1', error, stack);
      rethrow;
    }
  }

  // --- gallery-fork: library sync handlers ---

  Future<void> updateLibrariesV1(Iterable<SyncLibraryV1> data) async {
    try {
      await _db.batch((batch) {
        for (final library in data) {
          final companion = LibraryEntityCompanion(
            name: Value(library.name),
            ownerId: Value(library.ownerId),
            createdAt: Value(library.createdAt),
            updatedAt: Value(library.updatedAt),
          );

          batch.insert(
            _db.libraryEntity,
            companion.copyWith(id: Value(library.id)),
            onConflict: DoUpdate((_) => companion),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateLibrariesV1', error, stack);
      rethrow;
    }
  }

  // The currentUserId parameter is passed in from the dispatch site rather
  // than read from Store inside the repository. This keeps SyncStreamRepository
  // decoupled from the global Store singleton (matches the rest of the file,
  // which stays free of auth-context dependencies) and makes the handler
  // trivially testable with an in-memory Drift database.
  // SQLite's default SQLITE_MAX_VARIABLE_NUMBER is 999. The sweep customStatement
  // uses libraryIds.length + 2 parameters (currentUserId is bound twice). At
  // 500 we leave generous headroom: 500 + 2 = 502 parameters per chunk, well
  // under the limit even on builds with a lower compile-time cap.
  static const int _kSweepChunkSize = 500;

  Future<void> deleteLibrariesV1(Iterable<SyncLibraryDeleteV1> data, {required String currentUserId}) async {
    final libraryIds = data.map((d) => d.libraryId).toList();
    if (libraryIds.isEmpty) {
      return;
    }

    try {
      await _db.transaction(() async {
        for (final libraryId in libraryIds) {
          await _db.libraryEntity.deleteWhere((row) => row.id.equals(libraryId));
        }

        // Sweep orphan library assets in chunks to stay under the SQLite parameter
        // limit. Preserves every path that still legitimately reaches the asset:
        // user-owned, partner-shared, direct-add (shared_space_asset), space-album
        // membership (shared_space_album_asset) and classic-album membership
        // (remote_album_asset). mobile-2: unlinking a library while an asset is also
        // in a linked album must NOT delete the shared remote_asset row, or the asset
        // vanishes from album detail + the space timeline (the "swap a library link
        // for curated album links" workflow the feature encourages). remote_album_asset
        // is the adjacent pre-existing classic-album gap. Uses snake_case because Drift
        // generates snake_case table/column names from camelCase Dart identifiers — see
        // remote_asset.entity.dart for the `libraryId` column that becomes `library_id`.
        // The chunks all run inside the same transaction so the entire sweep stays
        // atomic with the libraryEntity deletes.
        for (var offset = 0; offset < libraryIds.length; offset += _kSweepChunkSize) {
          final chunk = libraryIds.sublist(offset, (offset + _kSweepChunkSize).clamp(0, libraryIds.length));
          final placeholders = chunk.map((_) => '?').join(',');
          await _db.customStatement(
            '''
            DELETE FROM remote_asset_entity
            WHERE library_id IS NOT NULL
              AND library_id IN ($placeholders)
              AND owner_id != ?
              AND owner_id NOT IN (
                SELECT shared_by_id FROM partner_entity WHERE shared_with_id = ?
              )
              AND id NOT IN (SELECT asset_id FROM shared_space_asset_entity)
              AND id NOT IN (SELECT asset_id FROM shared_space_album_asset_entity)
              AND id NOT IN (SELECT asset_id FROM remote_album_asset_entity)
            ''',
            [...chunk, currentUserId, currentUserId],
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteLibrariesV1', error, stack);
      rethrow;
    }
  }

  // LibraryAssetCreate/Backfill use the same SyncAssetV1 payload as the regular
  // asset stream. We delegate to updateAssetsV1 to upsert into remote_asset,
  // which is the source of truth for asset metadata.
  Future<void> updateLibraryAssetsV1(Iterable<SyncAssetV1> data) =>
      _syncStream.updateAssetsV1(data, debugLabel: 'library');

  // Per-asset deletes from the library asset stream. The server has already
  // scoped these to accessibleLibraries (see commit a6141764a) so we can
  // authoritatively remove the row without running the whole-library sweep.
  Future<void> deleteLibraryAssetsV1(Iterable<SyncLibraryAssetDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final asset in data) {
          batch.deleteWhere(_db.remoteAssetEntity, (row) => row.id.equals(asset.assetId));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteLibraryAssetsV1', error, stack);
      rethrow;
    }
  }

  // Same delegation pattern as updateSharedSpaceAssetExifsV1.
  Future<void> updateLibraryAssetExifsV1(Iterable<SyncAssetExifV1> data) =>
      _syncStream.updateAssetsExifV1(data, debugLabel: 'library');

  Future<void> updateSharedSpaceLibrariesV1(Iterable<SyncSharedSpaceLibraryV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          final companion = SharedSpaceLibraryEntityCompanion(
            spaceId: Value(join.spaceId),
            libraryId: Value(join.libraryId),
            addedById: Value(join.addedById),
            createdAt: Value(join.createdAt),
          );

          batch.insert(_db.sharedSpaceLibraryEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceLibrariesV1', error, stack);
      rethrow;
    }
  }

  // Does NOT sweep assets — that's the job of deleteLibrariesV1's whole-library
  // cascade when the underlying library itself is deleted. Removing a join row
  // just means the timeline UNION query in shared_space_timeline.repository.dart stops
  // including library-linked assets for this space.
  Future<void> deleteSharedSpaceLibrariesV1(Iterable<SyncSharedSpaceLibraryDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          batch.delete(
            _db.sharedSpaceLibraryEntity,
            SharedSpaceLibraryEntityCompanion(spaceId: Value(join.spaceId), libraryId: Value(join.libraryId)),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceLibrariesV1', error, stack);
      rethrow;
    }
  }

  // --- gallery-fork: SharedSpaceAlbum sync handlers (Phase 2B, Slice B1) ---
  //
  // These handlers mirror the library/shared-space-library path exactly.
  // None of them touch the personal remote_album / remote_album_asset tables
  // (the absorbed invariant on device, §10.2 of the spec).

  // Metadata (SharedSpaceAlbumV1 → SyncAlbumV2). Upsert into shared_space_album,
  // keyed by albumId. Mirrors updateSharedSpaceLibrariesV1's batch+DoUpdate shape.
  Future<void> updateSharedSpaceAlbumsV1(Iterable<SyncAlbumV2> data) async {
    try {
      await _db.batch((batch) {
        for (final album in data) {
          final companion = SharedSpaceAlbumEntityCompanion(
            id: Value(album.id),
            name: Value(album.name),
            description: Value(album.description),
            thumbnailAssetId: Value(album.thumbnailAssetId),
            createdAt: Value(album.createdAt),
            updatedAt: Value(album.updatedAt),
            isActivityEnabled: Value(album.isActivityEnabled),
            // Inline rather than a second copy of sync_stream.repository.dart's file-private extension.
            order: Value(
              switch (album.order) {
                AssetOrder.asc => AlbumAssetOrder.asc,
                AssetOrder.desc => AlbumAssetOrder.desc,
              }.index,
            ),
          );
          batch.insert(_db.sharedSpaceAlbumEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumsV1', error, stack);
      rethrow;
    }
  }

  // Metadata delete (gated — album fully gone for this user) → reuse the B0 sweep.
  // §4.4: sweeps shared_space_album_asset rows for this albumId; remote_asset blobs
  // are NOT swept (shared, possibly reachable by another path).
  Future<void> deleteSharedSpaceAlbumsV1(Iterable<SyncAlbumDeleteV1> data) async {
    final repo = SpaceAlbumRepository(_db);
    try {
      for (final d in data) {
        await repo.deleteAlbumMetadata(d.albumId);
      }
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumsV1', error, stack);
      rethrow;
    }
  }

  // Link (SharedSpaceAlbumLinkV1). Clone of updateSharedSpaceLibrariesV1.
  Future<void> updateSharedSpaceAlbumLinksV1(Iterable<SyncSharedSpaceAlbumLinkV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          final companion = SharedSpaceAlbumLinkEntityCompanion(
            spaceId: Value(join.spaceId),
            albumId: Value(join.albumId),
            showInTimeline: Value(join.showInTimeline),
            addedById: Value(join.addedById),
            folderId: Value(join.folderId),
            createdAt: Value(join.createdAt),
            updatedAt: Value(join.updatedAt),
          );
          batch.insert(_db.sharedSpaceAlbumLinkEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumLinksV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceAlbumLinksV1(Iterable<SyncSharedSpaceAlbumLinkDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final join in data) {
          batch.delete(
            _db.sharedSpaceAlbumLinkEntity,
            SharedSpaceAlbumLinkEntityCompanion(spaceId: Value(join.spaceId), albumId: Value(join.albumId)),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumLinksV1', error, stack);
      rethrow;
    }
  }

  // gallery-fork (#1041): per-member "hidden from my timeline" album rows.
  // SPARSE — a row exists only when this device's user has hidden that album.
  // Clone of updateSharedSpaceAlbumLinksV1 / deleteSharedSpaceAlbumLinksV1.
  Future<void> updateSharedSpaceAlbumHiddenV1(Iterable<SyncSharedSpaceAlbumHiddenV1> data) async {
    try {
      await _db.batch((batch) {
        for (final hidden in data) {
          final companion = SharedSpaceAlbumHiddenEntityCompanion(
            spaceId: Value(hidden.spaceId),
            albumId: Value(hidden.albumId),
            userId: Value(hidden.userId),
          );
          batch.insert(_db.sharedSpaceAlbumHiddenEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumHiddenV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceAlbumHiddenV1(Iterable<SyncSharedSpaceAlbumHiddenDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final hidden in data) {
          batch.delete(
            _db.sharedSpaceAlbumHiddenEntity,
            SharedSpaceAlbumHiddenEntityCompanion(
              spaceId: Value(hidden.spaceId),
              albumId: Value(hidden.albumId),
              userId: Value(hidden.userId),
            ),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumHiddenV1', error, stack);
      rethrow;
    }
  }

  // Folders (SharedSpaceAlbumFolderV1). Clone of updateSharedSpaceAlbumLinksV1.
  Future<void> updateSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderV1> data) async {
    try {
      await _db.batch((batch) {
        for (final folder in data) {
          final companion = SharedSpaceAlbumFolderEntityCompanion(
            id: Value(folder.id),
            spaceId: Value(folder.spaceId),
            parentId: Value(folder.parentId),
            name: Value(folder.name),
            createdAt: Value(folder.createdAt),
            updatedAt: Value(folder.updatedAt),
          );
          batch.insert(_db.sharedSpaceAlbumFolderEntity, companion, onConflict: DoUpdate((_) => companion));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumFoldersV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceAlbumFoldersV1(Iterable<SyncSharedSpaceAlbumFolderDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final folder in data) {
          batch.deleteWhere(_db.sharedSpaceAlbumFolderEntity, (t) => t.id.equals(folder.folderId));
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumFoldersV1', error, stack);
      rethrow;
    }
  }

  // Membership (SharedSpaceAlbumToAssetV1 → SyncAlbumToAssetV1). Clone of
  // updateSharedSpaceToAssetsV1 (onConflict DoNothing — membership is idempotent).
  Future<void> updateSharedSpaceAlbumToAssetsV1(Iterable<SyncAlbumToAssetV1> data) async {
    try {
      await _db.batch((batch) {
        for (final m in data) {
          batch.insert(
            _db.sharedSpaceAlbumAssetEntity,
            SharedSpaceAlbumAssetEntityCompanion(albumId: Value(m.albumId), assetId: Value(m.assetId)),
            onConflict: DoNothing(),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateSharedSpaceAlbumToAssetsV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteSharedSpaceAlbumToAssetsV1(Iterable<SyncAlbumToAssetDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final m in data) {
          batch.delete(
            _db.sharedSpaceAlbumAssetEntity,
            SharedSpaceAlbumAssetEntityCompanion(albumId: Value(m.albumId), assetId: Value(m.assetId)),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteSharedSpaceAlbumToAssetsV1', error, stack);
      rethrow;
    }
  }

  // Asset / exif blobs delegate to the shared remote_asset store (never a
  // space-album table). Mirrors updateSharedSpaceAssetsV1 / updateSharedSpaceAssetExifsV1.
  Future<void> updateSharedSpaceAlbumAssetsV1(Iterable<SyncAssetV2> data) =>
      _syncStream.updateAssetsV2(data, debugLabel: 'space-album');

  Future<void> updateSharedSpaceAlbumAssetExifsV1(Iterable<SyncAssetExifV1> data) =>
      _syncStream.updateAssetsExifV1(data, debugLabel: 'space-album');

  // --- gallery-fork: per-user favorites sync (#763) ---
  //
  // No new Drift table: remote_asset.isFavorite is a valid per-account store
  // because every asset payload is now recipient-resolved server-side.
  // Handlers flip the column by assetId: upsert -> true, tombstone -> false.
  // Batch-update idiom mirrors RemoteAssetRepository.updateFavorite.
  //
  // Ordering note (accepted, self-healing): a favorite event for a
  // not-yet-synced asset updates zero rows here and self-heals when the
  // recipient-resolved asset payload arrives; a stale-ordered asset payload
  // overwriting a newer favorite self-heals on the next favorite event or a
  // full resync — same eventual-consistency class as other cross-entity
  // fields in this sync stream. batch.update on an unmatched id is a no-op,
  // not a throw, so unknown assetIds are silently skipped.
  Future<void> updateAssetFavoritesV1(Iterable<SyncAssetFavoriteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final favorite in data) {
          batch.update(
            _db.remoteAssetEntity,
            const RemoteAssetEntityCompanion(isFavorite: Value(true)),
            where: (row) => row.id.equals(favorite.assetId),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: updateAssetFavoritesV1', error, stack);
      rethrow;
    }
  }

  Future<void> deleteAssetFavoritesV1(Iterable<SyncAssetFavoriteDeleteV1> data) async {
    try {
      await _db.batch((batch) {
        for (final favorite in data) {
          batch.update(
            _db.remoteAssetEntity,
            const RemoteAssetEntityCompanion(isFavorite: Value(false)),
            where: (row) => row.id.equals(favorite.assetId),
          );
        }
      });
    } catch (error, stack) {
      _logger.severe('Error: deleteAssetFavoritesV1', error, stack);
      rethrow;
    }
  }

  // --- gallery-fork: memory asset links and live-photo motion parts (upstream handlers call in) ---

  // memory -> asset link rows whose memory or asset has not been streamed yet, held until
  // SyncCompleteV1. Bounded by the links delivered in a single sync pass and cleared on every
  // flush, so it never accumulates across syncs. See insertOrDeferMemoryAssetsV1.
  final Set<(String memoryId, String assetId)> _deferredMemoryAssets = {};

  void clearDeferredMemoryAssets() => _deferredMemoryAssets.clear();

  // A link deleted before it could be replayed must not be resurrected by the flush.
  void forgetDeferredMemoryAssets(Iterable<SyncMemoryAssetDeleteV1> data) {
    for (final asset in data) {
      _deferredMemoryAssets.remove((asset.memoryId, asset.assetId));
    }
  }

  // memory_asset_entity carries real foreign keys on BOTH ids, and Drift sends the batch as a
  // single statement — so one link row whose memory or asset has not been streamed yet fails the
  // WHOLE batch with SQLITE_CONSTRAINT_FOREIGNKEY (787). That aborts /sync/stream mid-flight and,
  // because a failed batch is never acked, the next sync replays the same checkpoint and dies the
  // same way: a permanently wedged client, with people, faces, spaces and libraries (all streamed
  // later) never arriving. `onConflict: DoNothing()` does not help — it only covers PK conflicts.
  //
  // The server streams memories after every asset-bearing type (SYNC_TYPES_ORDER), so ordinarily
  // both parents are present. This client must also survive an OLDER fork server that still
  // streams them early — mobile and server release independently — so park what cannot be written
  // yet and replay it at SyncCompleteV1 rather than dropping it or letting the constraint fire.
  //
  // Called by SyncStreamRepository.updateMemoryAssetsV1, which logs and rethrows on failure.
  Future<void> insertOrDeferMemoryAssetsV1(Iterable<SyncMemoryAssetV1> data) async {
    final deferred = await _insertMemoryAssetLinks([for (final link in data) (link.memoryId, link.assetId)]);
    if (deferred.isNotEmpty) {
      _deferredMemoryAssets.addAll(deferred);
      _logger.fine('Deferred ${deferred.length} memory asset link(s) until their memory/asset arrives');
    }
  }

  // Replays the links parked by insertOrDeferMemoryAssetsV1. Called on SyncCompleteV1, by which point
  // every stream that can deliver an asset has run, so anything still unresolvable is a link this
  // device genuinely cannot represent (e.g. a memory pointing at an asset outside its sync scope).
  // Those are dropped with a warning instead of being carried into the next sync pass.
  Future<void> flushDeferredMemoryAssetsV1() async {
    if (_deferredMemoryAssets.isEmpty) {
      return;
    }

    final pending = Set.of(_deferredMemoryAssets);
    try {
      final unresolved = await _insertMemoryAssetLinks(pending);
      // Only forget the parked links once they have actually been dealt with — on failure they
      // stay put for the next flush.
      _deferredMemoryAssets.clear();

      final replayed = pending.length - unresolved.length;
      if (replayed > 0) {
        _logger.info('Replayed $replayed deferred memory asset link(s)');
      }
      if (unresolved.isNotEmpty) {
        final sample = unresolved.take(10).map((link) => '${link.$1}/${link.$2}').join(', ');
        _logger.warning(
          'Dropping ${unresolved.length} memory asset link(s) whose memory or asset never arrived: $sample',
        );
      }
    } catch (error, stack) {
      // Never rethrow: the sync itself has completed and every other batch is already acked.
      // Failing here would abort the stream and lose the parked links for nothing.
      _logger.severe('Error: flushDeferredMemoryAssetsV1', error, stack);
    }
  }

  // Writes the links whose memory AND asset already exist locally, and returns the rest instead of
  // letting the foreign keys abort the batch.
  //
  // Chunked because the parent lookups bind one variable per id: a single stream batch already
  // carries up to kSyncEventBatchSize (5000) links, and a flush replays everything parked over a
  // whole sync pass, which can be larger still. 500 keeps the `IN (...)` clauses far below any
  // SQLITE_MAX_VARIABLE_NUMBER a bundled sqlite3 might have.
  static const _memoryAssetLinkChunkSize = 500;

  Future<Set<(String, String)>> _insertMemoryAssetLinks(Iterable<(String, String)> links) async {
    final pending = links.toList(growable: false);
    if (pending.isEmpty) {
      return const {};
    }

    final deferred = <(String, String)>{};
    for (var start = 0; start < pending.length; start += _memoryAssetLinkChunkSize) {
      final end = start + _memoryAssetLinkChunkSize;
      deferred.addAll(
        await _insertMemoryAssetLinkChunk(pending.sublist(start, end > pending.length ? pending.length : end)),
      );
    }
    return deferred;
  }

  Future<Set<(String, String)>> _insertMemoryAssetLinkChunk(List<(String, String)> pending) async {
    final memoryQuery = _db.memoryEntity.selectOnly()
      ..addColumns([_db.memoryEntity.id])
      ..where(_db.memoryEntity.id.isIn(pending.map((link) => link.$1).toSet()));
    final knownMemories = (await memoryQuery.map((row) => row.read(_db.memoryEntity.id)).get()).nonNulls.toSet();

    final assetQuery = _db.remoteAssetEntity.selectOnly()
      ..addColumns([_db.remoteAssetEntity.id])
      ..where(_db.remoteAssetEntity.id.isIn(pending.map((link) => link.$2).toSet()));
    final knownAssets = (await assetQuery.map((row) => row.read(_db.remoteAssetEntity.id)).get()).nonNulls.toSet();

    final insertable = <(String, String)>[];
    final deferred = <(String, String)>{};
    for (final link in pending) {
      if (knownMemories.contains(link.$1) && knownAssets.contains(link.$2)) {
        insertable.add(link);
      } else {
        deferred.add(link);
      }
    }

    if (insertable.isNotEmpty) {
      await _db.batch((batch) {
        for (final link in insertable) {
          batch.insert(
            _db.memoryAssetEntity,
            MemoryAssetEntityCompanion(memoryId: Value(link.$1), assetId: Value(link.$2)),
            onConflict: DoNothing(),
          );
        }
      });
    }

    return deferred;
  }

  Future<void> hideReferencedLivePhotoMotionAssets() {
    return _db.customUpdate(
      '''
      UPDATE remote_asset_entity
      SET visibility = ?
      WHERE id IN (
        SELECT live_photo_video_id
        FROM remote_asset_entity
        WHERE live_photo_video_id IS NOT NULL
      )
      AND visibility != ?
      ''',
      variables: [Variable.withInt(AssetVisibility.hidden.index), Variable.withInt(AssetVisibility.hidden.index)],
      updates: {_db.remoteAssetEntity},
      updateKind: UpdateKind.update,
    );
  }

  Future<void> pruneAssets() async {
    try {
      await _db.transaction(() async {
        final authQuery = _db.authUserEntity.selectOnly()
          ..addColumns([_db.authUserEntity.id])
          ..limit(1);
        final currentUserId = await authQuery.map((row) => row.read(_db.authUserEntity.id)).getSingleOrNull();
        if (currentUserId == null) {
          _logger.warning('No authenticated user found during pruneAssets. Skipping asset pruning.');
          return;
        }

        final partnerQuery = _db.partnerEntity.selectOnly()
          ..addColumns([_db.partnerEntity.sharedById])
          ..where(_db.partnerEntity.sharedWithId.equals(currentUserId));
        final partnerIds = await partnerQuery.map((row) => row.read(_db.partnerEntity.sharedById)).get();

        final validUsers = {currentUserId, ...partnerIds.nonNulls};

        // Delete assets no longer reachable by ANY path. Keep-set:
        //   owned ∪ partner ∪ remote_album_asset (classic album)
        //   ∪ shared_space_asset (direct) ∪ shared_space_album_asset (granted album)
        //   ∪ library-reachable (library_id ∈ shared_space_library).
        // mobile-3/gaps-1: without the space/album/library arms a member's Drift DB
        // keeps remote_asset (filename, checksum, thumbhash) + remote_exif (GPS, city,
        // camera) forever after a purge/unlink, defeating the purge's privacy goal.
        //
        // remote_exif rows are removed automatically: remote_exif_entity.assetId has
        // ON DELETE CASCADE and this transaction runs with foreign_keys = ON.
        //
        // DEFERRED (follow-up): evicting cached thumbnail BYTES (in-memory
        // CustomImageCache — a PaintingBinding.imageCache singleton keyed by
        // ImageProvider instances, not asset ids — and the URL-keyed disk cache) is a
        // UI/service-layer concern not reachable from this Drift repository. Row-level
        // GC (remote_asset + cascaded remote_exif) is done here; byte eviction is a
        // future service-layer step (resolve pruned ids → provider keys / disk URLs).
        await _db.remoteAssetEntity.deleteWhere((asset) {
          return asset.ownerId.isNotIn(validUsers) &
              asset.id.isNotInQuery(
                _db.remoteAlbumAssetEntity.selectOnly()..addColumns([_db.remoteAlbumAssetEntity.assetId]),
              ) &
              asset.id.isNotInQuery(
                _db.sharedSpaceAssetEntity.selectOnly()..addColumns([_db.sharedSpaceAssetEntity.assetId]),
              ) &
              asset.id.isNotInQuery(
                _db.sharedSpaceAlbumAssetEntity.selectOnly()..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId]),
              ) &
              // Library-reachable exclusion. NULL-safe: `library_id NOT IN (...)` is NULL
              // (not TRUE) when library_id is NULL, so a null-library orphan would never
              // be deleted — guard with `IS NULL OR ...` so it still prunes.
              (asset.libraryId.isNull() |
                  asset.libraryId.isNotInQuery(
                    _db.sharedSpaceLibraryEntity.selectOnly()..addColumns([_db.sharedSpaceLibraryEntity.libraryId]),
                  ));
        });
      });
    } catch (error, stack) {
      _logger.severe('Error: pruneAssets', error, stack);
      // We do not rethrow here as this is a client-only cleanup and should not affect the sync process
    }
  }
}
