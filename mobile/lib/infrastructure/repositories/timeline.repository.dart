import 'dart:async';

import 'package:drift/drift.dart';
import 'package:easy_localization/easy_localization.dart';
import 'package:immich_mobile/data/db/main/database.dart';
import 'package:immich_mobile/data/db/main/table/local/asset.dart';
import 'package:immich_mobile/data/db/main/table/local/asset.drift.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.dart';
import 'package:immich_mobile/data/db/main/table/remote/asset.drift.dart';
import 'package:immich_mobile/domain/models/album/album.model.dart';
import 'package:immich_mobile/domain/models/asset/base_asset.model.dart';
import 'package:immich_mobile/domain/models/map.model.dart';
import 'package:immich_mobile/domain/models/timeline.model.dart';
import 'package:immich_mobile/domain/models/timeline_temporal_scope.model.dart';
import 'package:immich_mobile/domain/services/timeline.service.dart';
import 'package:immich_mobile/infrastructure/repositories/map.repository.dart';
import 'package:immich_mobile/infrastructure/repositories/timeline.repository.drift.dart';
import 'package:immich_mobile/infrastructure/repositories/viewer_visibility.dart';
import 'package:stream_transform/stream_transform.dart';

@DriftAccessor()
class TimelineRepository extends DatabaseAccessor<Drift> with $TimelineRepositoryMixin {
  TimelineRepository(super.attachedDatabase);

  Drift get _db => attachedDatabase;

  Stream<List<String>> watchTimelineUserIds(String userId) {
    final query = _db.partnerEntity.selectOnly()
      ..addColumns([_db.partnerEntity.sharedById])
      ..where(_db.partnerEntity.inTimeline.equals(true) & _db.partnerEntity.sharedWithId.equals(userId));

    return query
        .map((row) => row.read(_db.partnerEntity.sharedById)!)
        .watch()
        // Add current user ID to the list
        .map((users) => users..add(userId));
  }

  TimelineQuery main(
    List<String> userIds,
    String currentUserId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchMainBucket(userIds, currentUserId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getMainBucketAssets(userIds, currentUserId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.main,
  );

  Stream<List<Bucket>> _watchMainBucket(
    List<String> userIds,
    String currentUserId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      throw UnsupportedError("GroupAssetsBy.none is not supported for watchMainBucket");
    }

    if (!temporalScope.isEmpty) {
      return _watchScopedMainBucket(userIds, currentUserId, groupBy: groupBy, temporalScope: temporalScope);
    }

    return _db.mergedAssetDrift
        .mergedBucket(userIds: userIds, currentUserId: currentUserId, groupBy: groupBy.index)
        .map((row) {
          final date = row.bucketDate.truncateDate(groupBy);
          return TimeBucket(date: date, assetCount: row.assetCount);
        })
        .watch();
  }

  Future<List<BaseAsset>> _getMainBucketAssets(
    List<String> userIds,
    String currentUserId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (!temporalScope.isEmpty) {
      return _getScopedMainBucketAssets(
        userIds,
        currentUserId,
        offset: offset,
        count: count,
        temporalScope: temporalScope,
      );
    }

    return _db.mergedAssetDrift
        .mergedAsset(userIds: userIds, currentUserId: currentUserId, limit: (_) => Limit(count, offset))
        .map(
          (row) => row.remoteId != null && row.ownerId != null
              ? RemoteAsset(
                  id: row.remoteId!,
                  localId: row.localId,
                  name: row.name,
                  ownerId: row.ownerId!,
                  checksum: row.checksum,
                  type: row.type,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  uploadedAt: row.uploadedAt,
                  thumbHash: row.thumbHash,
                  width: row.width,
                  height: row.height,
                  isFavorite: row.isFavorite,
                  durationMs: row.durationMs,
                  livePhotoVideoId: row.livePhotoVideoId,
                  stackId: row.stackId,
                  isEdited: row.isEdited,
                )
              : LocalAsset(
                  id: row.localId!,
                  remoteId: row.remoteId,
                  name: row.name,
                  checksum: row.checksum,
                  type: row.type,
                  createdAt: row.createdAt,
                  updatedAt: row.updatedAt,
                  width: row.width,
                  height: row.height,
                  isFavorite: row.isFavorite,
                  durationMs: row.durationMs,
                  orientation: row.orientation,
                  playbackStyle: AssetPlaybackStyle.values[row.playbackStyle],
                  cloudId: row.iCloudId,
                  latitude: row.latitude,
                  longitude: row.longitude,
                  adjustmentTime: row.adjustmentTime,
                  isEdited: row.isEdited,
                ),
        )
        .get();
  }

  Stream<List<Bucket>> _watchScopedMainBucket(
    List<String> userIds,
    String currentUserId, {
    required GroupAssetsBy groupBy,
    required TimelineTemporalScope temporalScope,
  }) {
    final query = _db.customSelect(
      _scopedMainBucketSql(userIds, groupBy),
      variables: _scopedMainVariables(userIds, currentUserId, temporalScope),
      readsFrom: {
        _db.remoteAssetEntity,
        _db.stackEntity,
        _db.sharedSpaceAssetEntity,
        _db.sharedSpaceLibraryEntity,
        _db.sharedSpaceMemberEntity,
        _db.localAssetEntity,
        _db.localAlbumAssetEntity,
        _db.localAlbumEntity,
      },
    );

    return query.map((row) {
      final timeline = row.read<String>('bucket_date').truncateDate(groupBy);
      final assetCount = row.read<int>('asset_count');
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getScopedMainBucketAssets(
    List<String> userIds,
    String currentUserId, {
    required int offset,
    required int count,
    required TimelineTemporalScope temporalScope,
  }) {
    return _db
        .customSelect(
          _scopedMainAssetSql(userIds),
          variables: [
            ..._scopedMainVariables(userIds, currentUserId, temporalScope),
            Variable<int>(count),
            Variable<int>(offset),
          ],
          readsFrom: {
            _db.remoteAssetEntity,
            _db.stackEntity,
            _db.sharedSpaceAssetEntity,
            _db.sharedSpaceLibraryEntity,
            _db.sharedSpaceMemberEntity,
            _db.localAssetEntity,
            _db.localAlbumAssetEntity,
            _db.localAlbumEntity,
          },
        )
        .map(_scopedMainAssetFromRow)
        .get();
  }

  TimelineQuery localAlbum(
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchLocalAlbumBucket(albumId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getLocalAlbumBucketAssets(albumId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.localAlbum,
  );

  Stream<List<Bucket>> _watchLocalAlbumBucket(
    String albumId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      final countExp = _db.localAssetEntity.id.count();
      final query = _db.localAssetEntity.selectOnly()
        ..addColumns([countExp])
        ..join([
          innerJoin(
            _db.localAlbumAssetEntity,
            _db.localAlbumAssetEntity.assetId.equalsExp(_db.localAssetEntity.id),
            useColumns: false,
          ),
        ])
        ..where(
          _db.localAlbumAssetEntity.albumId.equals(albumId) &
              _localWithinTemporalScope(_db.localAssetEntity, temporalScope),
        );
      return query.map((row) => _generateBuckets(row.read(countExp)!)).watchSingle();
    }

    final assetCountExp = _db.localAssetEntity.id.count();
    final dateExp = _db.localAssetEntity.createdAt.dateFmt(groupBy, toLocal: true);

    final query =
        _db.localAssetEntity.selectOnly().join([
            innerJoin(
              _db.localAlbumAssetEntity,
              _db.localAlbumAssetEntity.assetId.equalsExp(_db.localAssetEntity.id),
              useColumns: false,
            ),
          ])
          ..addColumns([assetCountExp, dateExp])
          ..where(
            _db.localAlbumAssetEntity.albumId.equals(albumId) &
                _localWithinTemporalScope(_db.localAssetEntity, temporalScope),
          )
          ..groupBy([dateExp])
          ..orderBy([OrderingTerm.desc(dateExp)]);

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getLocalAlbumBucketAssets(
    String albumId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final query =
        _db.localAssetEntity.select().join([
            innerJoin(
              _db.localAlbumAssetEntity,
              _db.localAlbumAssetEntity.assetId.equalsExp(_db.localAssetEntity.id),
              useColumns: false,
            ),
            leftOuterJoin(
              _db.remoteAssetEntity,
              _db.localAssetEntity.checksum.equalsExp(_db.remoteAssetEntity.checksum) &
                  _db.remoteAssetEntity.ownerId.isInQuery(
                    _db.selectOnly(_db.authUserEntity)
                      ..addColumns([_db.authUserEntity.id])
                      ..limit(1),
                  ),
              useColumns: false,
            ),
          ])
          ..addColumns([_db.remoteAssetEntity.id])
          ..where(
            _db.localAlbumAssetEntity.albumId.equals(albumId) &
                _localWithinTemporalScope(_db.localAssetEntity, temporalScope),
          )
          ..orderBy([OrderingTerm.desc(_db.localAssetEntity.createdAt)])
          ..limit(count, offset: offset);

    return query
        .map((row) => row.readTable(_db.localAssetEntity).toDto(remoteId: row.read(_db.remoteAssetEntity.id)))
        .get();
  }

  TimelineQuery remoteAlbum(
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchRemoteAlbumBucket(albumId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) => _getRemoteAlbumBucketAssets(
      albumId,
      groupBy: groupBy,
      offset: offset,
      count: count,
      temporalScope: temporalScope,
    ),
    origin: TimelineOrigin.remoteAlbum,
  );

  Stream<List<Bucket>> _watchRemoteAlbumBucket(
    String albumId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      final countExp = _db.remoteAssetEntity.id.count();
      final query = _db.remoteAssetEntity.selectOnly()
        ..addColumns([countExp])
        ..join([
          innerJoin(
            _db.remoteAlbumAssetEntity,
            _db.remoteAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAlbumAssetEntity.albumId.equals(albumId) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
        );
      return query
          .map((row) => row.read(countExp) ?? 0)
          .map(_generateBuckets)
          .watchSingle()
          .handleError((error) => const <Bucket>[]);
    }

    return (_db.remoteAlbumEntity.select()..where((row) => row.id.equals(albumId)))
        .watch()
        .switchMap((albums) {
          if (albums.isEmpty) {
            return Stream.value(const <Bucket>[]);
          }

          final album = albums.first;
          final isAscending = album.order == AlbumAssetOrder.asc;
          final assetCountExp = _db.remoteAssetEntity.id.count();
          final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

          final query = _db.remoteAssetEntity.selectOnly()
            ..addColumns([assetCountExp, dateExp])
            ..join([
              innerJoin(
                _db.remoteAlbumAssetEntity,
                _db.remoteAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
                useColumns: false,
              ),
            ])
            ..where(
              _db.remoteAssetEntity.deletedAt.isNull() &
                  _db.remoteAlbumAssetEntity.albumId.equals(albumId) &
                  _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
            )
            ..groupBy([dateExp]);

          if (isAscending) {
            query.orderBy([OrderingTerm.asc(dateExp)]);
          } else {
            query.orderBy([OrderingTerm.desc(dateExp)]);
          }

          return query.map((row) {
            final timeline = row.read(dateExp)!.truncateDate(groupBy);
            final assetCount = row.read(assetCountExp)!;
            return TimeBucket(date: timeline, assetCount: assetCount);
          }).watch();
        })
        // If there's an error (e.g., album was deleted), return empty buckets
        .handleError((error) => const <Bucket>[]);
  }

  Future<List<BaseAsset>> _getRemoteAlbumBucketAssets(
    String albumId, {
    required int offset,
    required int count,
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) async {
    final albumData = await (_db.remoteAlbumEntity.select()..where((row) => row.id.equals(albumId))).getSingleOrNull();

    // If album doesn't exist (was deleted), return empty list
    if (albumData == null) {
      return const <BaseAsset>[];
    }

    final isAscending = albumData.order == AlbumAssetOrder.asc;

    // Correlated subquery picks the first matching local asset by checksum,
    // avoiding fan-out when the same photo exists in multiple device albums (#23273).
    final localId = subqueryExpression<String>(
      _db.localAssetEntity.selectOnly()
        ..addColumns([_db.localAssetEntity.id])
        ..where(_db.localAssetEntity.checksum.equalsExp(_db.remoteAssetEntity.checksum))
        ..limit(1),
    );

    final query =
        _db.remoteAssetEntity.select().addColumns([localId]).join([
          innerJoin(
            _db.remoteAlbumAssetEntity,
            _db.remoteAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
        ])..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAlbumAssetEntity.albumId.equals(albumId) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
        );

    query.orderBy(
      _assetDateOrder(groupBy, ascending: isAscending).map((order) => order(_db.remoteAssetEntity)).toList(),
    );

    query.limit(count, offset: offset);

    return query.map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(localId))).get();
  }

  // Mirrors remoteAlbum() but scopes via shared_space_asset. Always orders DESC
  // (shared spaces have no per-space order setting in PR1).
  TimelineQuery sharedSpace(
    String spaceId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchSharedSpaceBucket(spaceId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getSharedSpaceBucketAssets(spaceId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.remoteSpace,
  );

  Stream<List<Bucket>> _watchSharedSpaceBucket(
    String spaceId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    // Assets belong to a space if they are either:
    //   1. directly added via shared_space_asset, OR
    //   2. owned by a library that is linked via shared_space_library.
    //
    // We LEFT JOIN both association tables and require at least one match in
    // the WHERE clause. The join structure matters for reactivity: Drift's
    // `.watch()` only subscribes to tables referenced via a real FROM/JOIN in
    // the query builder — tables reached via `.isInQuery()` subqueries are
    // invisible to the reactive layer, so a previous `IN (...) OR IN (...)`
    // formulation produced a stale stream that never re-emitted when photos
    // were added/removed or a library link changed. See
    // timeline_repository_test.dart for the regression covering both cases.
    //
    // An asset matching both branches is counted once because we COUNT
    // DISTINCT remote_asset.id.
    //
    // Stack collapse: we LEFT JOIN stack_entity and keep an asset when it has
    // no stack, when it IS the stack's primary (cover), OR when the stack row
    // is not present locally (stack_entity.id IS NULL). That last arm matters
    // for shared spaces: stack_entity only syncs for the viewer's own and
    // partners' stacks (there is no shared-space stack sync), yet a non-owned
    // space asset still carries its stack_id. Without the `IS NULL` fallback
    // such a stack would collapse against a missing primary and vanish
    // entirely; instead we show its frames flat (as before collapse existed).

    if (groupBy == GroupAssetsBy.none) {
      final countExp = _db.remoteAssetEntity.id.count(distinct: true);
      final countQuery = _db.remoteAssetEntity.selectOnly()
        ..addColumns([countExp])
        ..join([
          leftOuterJoin(
            _db.sharedSpaceAssetEntity,
            _db.sharedSpaceAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
                _db.sharedSpaceAssetEntity.spaceId.equals(spaceId),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceLibraryEntity,
            _db.sharedSpaceLibraryEntity.libraryId.equalsExp(_db.remoteAssetEntity.libraryId) &
                _db.sharedSpaceLibraryEntity.spaceId.equals(spaceId),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceAlbumAssetEntity,
            _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceAlbumLinkEntity,
            _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
                _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
                _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.stackEntity,
            _db.stackEntity.id.equalsExp(_db.remoteAssetEntity.stackId),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                  _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
              (_db.sharedSpaceAssetEntity.assetId.isNotNull() |
                  _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                  _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull()) &
              (_db.remoteAssetEntity.stackId.isNull() |
                  _db.stackEntity.id.isNull() |
                  _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
        );
      return countQuery
          .map((row) => row.read(countExp) ?? 0)
          .watchSingle()
          .map(_generateBuckets)
          .handleError((error) => const <Bucket>[]);
    }

    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join([
        leftOuterJoin(
          _db.sharedSpaceAssetEntity,
          _db.sharedSpaceAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
              _db.sharedSpaceAssetEntity.spaceId.equals(spaceId),
          useColumns: false,
        ),
        leftOuterJoin(
          _db.sharedSpaceLibraryEntity,
          _db.sharedSpaceLibraryEntity.libraryId.equalsExp(_db.remoteAssetEntity.libraryId) &
              _db.sharedSpaceLibraryEntity.spaceId.equals(spaceId),
          useColumns: false,
        ),
        leftOuterJoin(
          _db.sharedSpaceAlbumAssetEntity,
          _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
          useColumns: false,
        ),
        leftOuterJoin(
          _db.sharedSpaceAlbumLinkEntity,
          _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
              _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
              _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
          useColumns: false,
        ),
        leftOuterJoin(_db.stackEntity, _db.stackEntity.id.equalsExp(_db.remoteAssetEntity.stackId), useColumns: false),
      ])
      ..where(
        _db.remoteAssetEntity.deletedAt.isNull() &
            (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.sharedSpaceAssetEntity.assetId.isNotNull() |
                _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull()) &
            (_db.remoteAssetEntity.stackId.isNull() |
                _db.stackEntity.id.isNull() |
                _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    return query
        .map((row) {
          final timeline = row.read(dateExp)!.truncateDate(groupBy);
          final assetCount = row.read(assetCountExp)!;
          return TimeBucket(date: timeline, assetCount: assetCount);
        })
        .watch()
        .handleError((error) => const <Bucket>[]);
  }

  Future<List<BaseAsset>> _getSharedSpaceBucketAssets(
    String spaceId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) async {
    final membership =
        _db.remoteAssetEntity.id.isInQuery(
          _db.sharedSpaceAssetEntity.selectOnly()
            ..addColumns([_db.sharedSpaceAssetEntity.assetId])
            ..where(_db.sharedSpaceAssetEntity.spaceId.equals(spaceId)),
        ) |
        _db.remoteAssetEntity.libraryId.isInQuery(
          _db.sharedSpaceLibraryEntity.selectOnly()
            ..addColumns([_db.sharedSpaceLibraryEntity.libraryId])
            ..where(_db.sharedSpaceLibraryEntity.spaceId.equals(spaceId)),
        ) |
        _db.remoteAssetEntity.id.isInQuery(
          _db.sharedSpaceAlbumAssetEntity.selectOnly()
            ..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId])
            ..join([
              innerJoin(
                _db.sharedSpaceAlbumLinkEntity,
                _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
                    _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
                    _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
                useColumns: false,
              ),
            ]),
        );

    final query =
        _db.remoteAssetEntity.select().addColumns([_db.localAssetEntity.id]).join([
            leftOuterJoin(
              _db.localAssetEntity,
              _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
              useColumns: false,
            ),
            leftOuterJoin(
              _db.stackEntity,
              _db.stackEntity.id.equalsExp(_db.remoteAssetEntity.stackId),
              useColumns: false,
            ),
          ])
          ..where(
            _db.remoteAssetEntity.deletedAt.isNull() &
                (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                    _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                membership &
                (_db.remoteAssetEntity.stackId.isNull() |
                    _db.stackEntity.id.isNull() |
                    _db.remoteAssetEntity.id.equalsExp(_db.stackEntity.primaryAssetId)),
          )
          ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
          ..limit(count, offset: offset);

    return query
        .map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(_db.localAssetEntity.id)))
        .get();
  }

  // Detail query for one linked album inside a space. Scopes by album membership
  // only (no showInTimeline filter — the detail page shows all the album's
  // photos). spaceId is carried for the origin/header.
  TimelineQuery spaceAlbum(
    String spaceId,
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchSpaceAlbumBucket(albumId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getSpaceAlbumBucketAssets(albumId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.remoteSpace,
  );

  Stream<List<Bucket>> _watchSpaceAlbumBucket(
    String albumId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      final countExp = _db.remoteAssetEntity.id.count(distinct: true);
      final countQuery = _db.remoteAssetEntity.selectOnly()
        ..addColumns([countExp])
        ..join([
          leftOuterJoin(
            _db.sharedSpaceAlbumAssetEntity,
            _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
                _db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId),
            useColumns: false,
          ),
        ])
        ..where(
          _db.remoteAssetEntity.deletedAt.isNull() &
              (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                  _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
              _db.sharedSpaceAlbumAssetEntity.assetId.isNotNull(),
        );
      return countQuery
          .map((row) => row.read(countExp) ?? 0)
          .watchSingle()
          .map(_generateBuckets)
          .handleError((error) => const <Bucket>[]);
    }

    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);
    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join([
        leftOuterJoin(
          _db.sharedSpaceAlbumAssetEntity,
          _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(_db.remoteAssetEntity.id) &
              _db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId),
          useColumns: false,
        ),
      ])
      ..where(
        _db.remoteAssetEntity.deletedAt.isNull() &
            (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            _db.sharedSpaceAlbumAssetEntity.assetId.isNotNull(),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);
    return query
        .map((row) {
          final timeline = row.read(dateExp)!.truncateDate(groupBy);
          final assetCount = row.read(assetCountExp)!;
          return TimeBucket(date: timeline, assetCount: assetCount);
        })
        .watch()
        .handleError((error) => const <Bucket>[]);
  }

  Future<List<BaseAsset>> _getSpaceAlbumBucketAssets(
    String albumId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) async {
    final membership = _db.remoteAssetEntity.id.isInQuery(
      _db.sharedSpaceAlbumAssetEntity.selectOnly()
        ..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId])
        ..where(_db.sharedSpaceAlbumAssetEntity.albumId.equals(albumId)),
    );
    final query =
        _db.remoteAssetEntity.select().addColumns([_db.localAssetEntity.id]).join([
            leftOuterJoin(
              _db.localAssetEntity,
              _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
              useColumns: false,
            ),
          ])
          ..where(
            _db.remoteAssetEntity.deletedAt.isNull() &
                (_db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) |
                    _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.archive)) &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                membership,
          )
          ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
          ..limit(count, offset: offset);
    return query
        .map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(_db.localAssetEntity.id)))
        .get();
  }

  TimelineQuery fromAssets(List<BaseAsset> assets, TimelineOrigin origin) => (
    bucketSource: () => Stream.value(_generateBuckets(assets.length)),
    assetSource: (offset, count) => Future.value(assets.skip(offset).take(count).toList(growable: false)),
    origin: origin,
  );

  TimelineQuery fromAssetStream(
    List<BaseAsset> Function() getAssets,
    Stream<int> assetCount,
    TimelineOrigin origin, {
    GroupAssetsBy groupBy = GroupAssetsBy.none,
    bool descending = true,
  }) => (
    bucketSource: () async* {
      yield _buildBuckets(getAssets(), groupBy, descending);
      yield* assetCount.map((_) => _buildBuckets(getAssets(), groupBy, descending));
    },
    assetSource: (offset, count) => Future.value(
      _orderedForGrouping(getAssets(), groupBy, descending).skip(offset).take(count).toList(growable: false),
    ),
    origin: origin,
  );

  TimelineQuery fromAssetsWithBuckets(List<BaseAsset> assets, TimelineOrigin origin) {
    // Sort assets by date descending and group by day
    final sorted = List<BaseAsset>.from(assets)..sort((a, b) => b.createdAt.compareTo(a.createdAt));
    final Map<DateTime, int> bucketCounts = {};
    for (final asset in sorted) {
      final localTime = asset.createdAt.toLocal();
      final date = DateTime(localTime.year, localTime.month, localTime.day);
      bucketCounts[date] = (bucketCounts[date] ?? 0) + 1;
    }

    final buckets = bucketCounts.entries.map((e) => TimeBucket(date: e.key, assetCount: e.value)).toList();

    return (
      bucketSource: () => Stream.value(buckets),
      assetSource: (offset, count) => Future.value(sorted.skip(offset).take(count).toList(growable: false)),
      origin: origin,
    );
  }

  TimelineQuery remote(
    String ownerId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() & row.visibility.equalsValue(AssetVisibility.timeline) & row.ownerId.equals(ownerId),
    groupBy: groupBy,
    temporalScope: temporalScope,
    origin: TimelineOrigin.remoteAssets,
  );

  TimelineQuery recentlyAdded(String userId, GroupAssetsBy groupBy) => _remoteQueryBuilder(
    filter: (row) =>
        row.uploadedAt.isNotNull() &
        row.deletedAt.isNull() &
        row.ownerId.equals(userId) &
        (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive)),
    origin: TimelineOrigin.recentlyAdded,
    groupBy: groupBy,
    sortBy: SortAssetsBy.uploaded,
  );

  TimelineQuery favorite(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        row.isFavorite.equals(true) &
        row.ownerId.equals(userId) &
        (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive)),
    groupBy: groupBy,
    temporalScope: temporalScope,
    origin: TimelineOrigin.favorite,
  );

  TimelineQuery trash(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) => row.deletedAt.isNotNull() & row.ownerId.equals(userId),
    groupBy: groupBy,
    temporalScope: temporalScope,
    origin: TimelineOrigin.trash,
    joinLocal: true,
  );

  TimelineQuery archived(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() & row.ownerId.equals(userId) & row.visibility.equalsValue(AssetVisibility.archive),
    groupBy: groupBy,
    temporalScope: temporalScope,
    origin: TimelineOrigin.archive,
    joinLocal: true,
  );

  TimelineQuery locked(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() & row.visibility.equalsValue(AssetVisibility.locked) & row.ownerId.equals(userId),
    origin: TimelineOrigin.lockedFolder,
    groupBy: groupBy,
    temporalScope: temporalScope,
  );

  TimelineQuery video(
    List<String> userIds,
    String currentUserId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchVideoBucket(userIds, currentUserId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) =>
        _getVideoBucketAssets(userIds, currentUserId, offset: offset, count: count, temporalScope: temporalScope),
    origin: TimelineOrigin.video,
  );

  Stream<List<Bucket>> _watchVideoBucket(
    List<String> userIds,
    String currentUserId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      throw UnsupportedError('GroupAssetsBy.none is not supported for _watchVideoBucket');
    }

    final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join(viz.joins)
      ..where(
        _db.remoteAssetEntity.deletedAt.isNull() &
            _db.remoteAssetEntity.type.equalsValue(AssetType.video) &
            _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.remoteAssetEntity.ownerId.isIn(userIds) |
                viz.assetMember.userId.isNotNull() |
                viz.libraryMember.userId.isNotNull() |
                viz.albumMember.userId.isNotNull()),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getVideoBucketAssets(
    List<String> userIds,
    String currentUserId, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

    final query = _db.remoteAssetEntity.select()
      ..where(
        (row) =>
            row.deletedAt.isNull() &
            row.type.equalsValue(AssetType.video) &
            row.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(row, temporalScope) &
            visibilityPredicate,
      )
      ..orderBy([(row) => OrderingTerm.desc(row.createdAt)])
      ..limit(count, offset: offset);

    return query.map((row) => row.toDto()).get();
  }

  TimelineQuery place(
    String place,
    List<String> userIds,
    String currentUserId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () =>
        _watchPlaceBucket(place, userIds, currentUserId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) => _getPlaceBucketAssets(
      place,
      userIds,
      currentUserId,
      groupBy: groupBy,
      offset: offset,
      count: count,
      temporalScope: temporalScope,
    ),
    origin: TimelineOrigin.place,
  );

  TimelineQuery person(
    String userId,
    String personId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _watchPersonBucket(userId, personId, groupBy: groupBy, temporalScope: temporalScope),
    assetSource: (offset, count) => _getPersonBucketAssets(
      userId,
      personId,
      groupBy: groupBy,
      offset: offset,
      count: count,
      temporalScope: temporalScope,
    ),
    origin: TimelineOrigin.person,
  );

  /// Timeline for a Space-shared person, restricted to the [assetIds] the server resolved for
  /// that person (GET /shared-spaces/{id}/people/{id}/assets). Unlike [person], this does NOT
  /// filter by ownerId or join asset_face: a Space person's photos are owned by another user
  /// and their face→person links are owner-scoped and never sync to the viewer, so the local
  /// join would be empty ("0 items"). The Space assets themselves do sync locally, so once the
  /// server tells us which ones contain the person we render them straight from remote_asset —
  /// mirroring the web person detail page for a Space person. An empty [assetIds] yields an
  /// empty timeline.
  TimelineQuery sharedSpacePerson(
    List<String> assetIds,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive)) &
        row.id.isIn(assetIds),
    groupBy: groupBy,
    temporalScope: temporalScope,
    origin: TimelineOrigin.person,
  );

  Stream<List<Bucket>> _watchPlaceBucket(
    String place,
    List<String> userIds,
    String currentUserId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      throw UnsupportedError('GroupAssetsBy.none is not supported for _watchPlaceBucket');
    }

    final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join([
        innerJoin(
          _db.remoteExifEntity,
          _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
          useColumns: false,
        ),
        ...viz.joins,
      ])
      ..where(
        _db.remoteExifEntity.city.equals(place) &
            _db.remoteAssetEntity.deletedAt.isNull() &
            _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.remoteAssetEntity.ownerId.isIn(userIds) |
                viz.assetMember.userId.isNotNull() |
                viz.libraryMember.userId.isNotNull() |
                viz.albumMember.userId.isNotNull()),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getPlaceBucketAssets(
    String place,
    List<String> userIds,
    String currentUserId, {
    required int offset,
    required int count,
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

    final query =
        _db.remoteAssetEntity.select().join([
            innerJoin(
              _db.remoteExifEntity,
              _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
              useColumns: false,
            ),
          ])
          ..where(
            _db.remoteAssetEntity.deletedAt.isNull() &
                _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
                _db.remoteExifEntity.city.equals(place) &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                visibilityPredicate,
          )
          ..orderBy(_assetDateOrder(groupBy).map((order) => order(_db.remoteAssetEntity)).toList())
          ..limit(count, offset: offset);

    return query.map((row) => row.readTable(_db.remoteAssetEntity).toDto()).get();
  }

  Stream<List<Bucket>> _watchPersonBucket(
    String userId,
    String personId, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final idQuery = _db.assetFaceEntity.selectOnly()
      ..addColumns([_db.assetFaceEntity.assetId])
      ..where(
        _db.assetFaceEntity.personId.equals(personId) &
            _db.assetFaceEntity.isVisible.equals(true) &
            _db.assetFaceEntity.deletedAt.isNull(),
      );

    if (groupBy == GroupAssetsBy.none) {
      final query = _db.remoteAssetEntity.selectOnly()
        ..addColumns([_db.remoteAssetEntity.id.count()])
        ..where(
          _db.remoteAssetEntity.id.isInQuery(idQuery) &
              _db.remoteAssetEntity.deletedAt.isNull() &
              _db.remoteAssetEntity.ownerId.equals(userId) &
              _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
              _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
        );

      return query.map((row) {
        final count = row.read(_db.remoteAssetEntity.id.count())!;
        return _generateBuckets(count);
      }).watchSingle();
    }

    final assetCountExp = _db.remoteAssetEntity.id.count();
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..where(
        _db.remoteAssetEntity.id.isInQuery(idQuery) &
            _db.remoteAssetEntity.ownerId.equals(userId) &
            _db.remoteAssetEntity.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            _db.remoteAssetEntity.deletedAt.isNull(),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getPersonBucketAssets(
    String userId,
    String personId, {
    required int offset,
    required int count,
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final idQuery = _db.assetFaceEntity.selectOnly()
      ..addColumns([_db.assetFaceEntity.assetId])
      ..where(
        _db.assetFaceEntity.personId.equals(personId) &
            _db.assetFaceEntity.isVisible.equals(true) &
            _db.assetFaceEntity.deletedAt.isNull(),
      );

    final query = _db.remoteAssetEntity.select()
      ..where(
        (row) =>
            row.id.isInQuery(idQuery) &
            row.deletedAt.isNull() &
            row.ownerId.equals(userId) &
            row.visibility.equalsValue(AssetVisibility.timeline) &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
      )
      ..orderBy(_assetDateOrder(groupBy))
      ..limit(count, offset: offset);

    return query.map((row) => row.toDto()).get();
  }

  /// Creates a geographic map query that can dynamically filter on changing [TimelineMapOptions]
  /// (most notably the active map bounds)
  TimelineQuery geographicMap(
    List<String> userIds,
    String currentUserId,
    TimelineMapOptions Function() currentOptions,
    Stream<TimelineMapOptions> optionsStream,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => Stream.value(currentOptions())
        .followedBy(optionsStream)
        .switchMap(
          // Any error would kill the stream for all options; make sure the stream stays alive
          (options) =>
              _watchMapBucket(
                userIds,
                currentUserId,
                options,
                groupBy: groupBy,
                temporalScope: temporalScope,
              ).handleError((_) {}),
        ),
    assetSource: (offset, count) => _getMapBucketAssets(
      userIds,
      currentUserId,
      currentOptions(),
      offset: offset,
      count: count,
      temporalScope: temporalScope,
    ),
    origin: TimelineOrigin.map,
  );

  Stream<List<Bucket>> _watchMapBucket(
    List<String> userIds,
    String currentUserId,
    TimelineMapOptions options, {
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      throw UnsupportedError('GroupAssetsBy.none is not supported for _watchMapBucket');
    }

    // NOTE: Mobile map() currently allows withPartners+shared-space branches
    // when onlyFavorites or includeArchived is true, which diverges from the
    // server's restriction (timeline.service.ts rejects that combination). We
    // preserve the mobile-specific behavior here intentionally.

    final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
    final assetCountExp = _db.remoteAssetEntity.id.count(distinct: true);
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..join([
        innerJoin(
          _db.remoteExifEntity,
          _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
          useColumns: false,
        ),
        ...viz.joins,
      ])
      ..where(
        _db.remoteExifEntity.inBounds(options.bounds) &
            _db.remoteAssetEntity.visibility.isIn([
              AssetVisibility.timeline.index,
              if (options.includeArchived) AssetVisibility.archive.index,
            ]) &
            _db.remoteAssetEntity.deletedAt.isNull() &
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.remoteAssetEntity.ownerId.isIn(userIds) |
                viz.assetMember.userId.isNotNull() |
                viz.libraryMember.userId.isNotNull() |
                viz.albumMember.userId.isNotNull()),
      )
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    if (options.onlyFavorites) {
      query.where(_db.remoteAssetEntity.isFavorite.equals(true));
    }

    final timeRange = options.timeRange;

    final hasCustomRange = timeRange.from != null || timeRange.to != null;

    if (hasCustomRange) {
      if (timeRange.from != null) {
        query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(timeRange.from!));
      }

      if (timeRange.to != null) {
        query.where(_db.remoteAssetEntity.createdAt.isSmallerOrEqualValue(timeRange.to!));
      }
    } else if (options.relativeDays > 0) {
      final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));

      query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate));
    }

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  Future<List<BaseAsset>> _getMapBucketAssets(
    List<String> userIds,
    String currentUserId,
    TimelineMapOptions options, {
    required int offset,
    required int count,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final visibilityPredicate = viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId);

    final query =
        _db.remoteAssetEntity.select().join([
            innerJoin(
              _db.remoteExifEntity,
              _db.remoteExifEntity.assetId.equalsExp(_db.remoteAssetEntity.id),
              useColumns: false,
            ),
          ])
          ..where(
            _db.remoteExifEntity.inBounds(options.bounds) &
                _db.remoteAssetEntity.visibility.isIn([
                  AssetVisibility.timeline.index,
                  if (options.includeArchived) AssetVisibility.archive.index,
                ]) &
                _db.remoteAssetEntity.deletedAt.isNull() &
                _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
                visibilityPredicate,
          )
          ..orderBy([OrderingTerm.desc(_db.remoteAssetEntity.createdAt)])
          ..limit(count, offset: offset);

    if (options.onlyFavorites) {
      query.where(_db.remoteAssetEntity.isFavorite.equals(true));
    }

    final timeRange = options.timeRange;

    final hasCustomRange = timeRange.from != null || timeRange.to != null;

    if (hasCustomRange) {
      if (timeRange.from != null) {
        query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(timeRange.from!));
      }

      if (timeRange.to != null) {
        query.where(_db.remoteAssetEntity.createdAt.isSmallerOrEqualValue(timeRange.to!));
      }
    } else if (options.relativeDays > 0) {
      final cutoffDate = DateTime.now().toUtc().subtract(Duration(days: options.relativeDays));

      query.where(_db.remoteAssetEntity.createdAt.isBiggerOrEqualValue(cutoffDate));
    }

    return query.map((row) => row.readTable(_db.remoteAssetEntity).toDto()).get();
  }

  @pragma('vm:prefer-inline')
  TimelineQuery _remoteQueryBuilder({
    required Expression<bool> Function($RemoteAssetEntityTable row) filter,
    required TimelineOrigin origin,
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    bool joinLocal = false,
    SortAssetsBy sortBy = SortAssetsBy.taken,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    return (
      bucketSource: () =>
          _watchRemoteBucket(filter: filter, groupBy: groupBy, sortBy: sortBy, temporalScope: temporalScope),
      assetSource: (offset, count) => _getRemoteAssets(
        filter: filter,
        offset: offset,
        count: count,
        joinLocal: joinLocal,
        sortBy: sortBy,
        temporalScope: temporalScope,
      ),
      origin: origin,
    );
  }

  Stream<List<Bucket>> _watchRemoteBucket({
    required Expression<bool> Function($RemoteAssetEntityTable row) filter,
    GroupAssetsBy groupBy = GroupAssetsBy.day,
    SortAssetsBy sortBy = SortAssetsBy.taken,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (groupBy == GroupAssetsBy.none) {
      final query = _db.remoteAssetEntity.count(
        where: (row) => filter(row) & _remoteWithinTemporalScope(row, temporalScope),
      );
      return query.map(_generateBuckets).watchSingle();
    }

    final assetCountExp = _db.remoteAssetEntity.id.count();
    final dateExp = _db.remoteAssetEntity.effectiveCreatedAt(groupBy, sortBy: sortBy);

    final query = _db.remoteAssetEntity.selectOnly()
      ..addColumns([assetCountExp, dateExp])
      ..where(filter(_db.remoteAssetEntity) & _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope))
      ..groupBy([dateExp])
      ..orderBy([OrderingTerm.desc(dateExp)]);

    return query.map((row) {
      final timeline = row.read(dateExp)!.truncateDate(groupBy);
      final assetCount = row.read(assetCountExp)!;
      return TimeBucket(date: timeline, assetCount: assetCount);
    }).watch();
  }

  @pragma('vm:prefer-inline')
  Future<List<BaseAsset>> _getRemoteAssets({
    required Expression<bool> Function($RemoteAssetEntityTable row) filter,
    required int offset,
    required int count,
    bool joinLocal = false,
    SortAssetsBy sortBy = SortAssetsBy.taken,
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    if (joinLocal) {
      final query =
          _db.remoteAssetEntity.select().join([
              leftOuterJoin(
                _db.localAssetEntity,
                _db.remoteAssetEntity.checksum.equalsExp(_db.localAssetEntity.checksum),
                useColumns: false,
              ),
            ])
            ..addColumns([_db.localAssetEntity.id])
            ..where(filter(_db.remoteAssetEntity) & _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope))
            ..orderBy([
              OrderingTerm.desc(
                sortBy == SortAssetsBy.uploaded ? _db.remoteAssetEntity.uploadedAt : _db.remoteAssetEntity.createdAt,
              ),
            ])
            ..limit(count, offset: offset);

      return query
          .map((row) => row.readTable(_db.remoteAssetEntity).toDto(localId: row.read(_db.localAssetEntity.id)))
          .get();
    } else {
      final query = _db.remoteAssetEntity.select()
        ..where((row) => filter(row) & _remoteWithinTemporalScope(row, temporalScope))
        ..orderBy([(row) => OrderingTerm.desc(sortBy == SortAssetsBy.uploaded ? row.uploadedAt : row.createdAt)])
        ..limit(count, offset: offset);

      return query.map((row) => row.toDto()).get();
    }
  }
}

List<Bucket> _generateBuckets(int count) => count == 0 ? const [] : [Bucket(assetCount: count)];

List<OrderingTerm Function($RemoteAssetEntityTable)> _assetDateOrder(GroupAssetsBy groupBy, {bool ascending = false}) {
  OrderingTerm order(Expression<Object> exp) => ascending ? OrderingTerm.asc(exp) : OrderingTerm.desc(exp);
  return [
    if (groupBy != GroupAssetsBy.none) (row) => order(row.effectiveCreatedAt(groupBy)),
    (row) => order(row.createdAt),
  ];
}

// Date-less segments (flat) for `none`; dated TimeBuckets in `descending` order otherwise.
List<Bucket> _buildBuckets(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) return _generateBuckets(assets.length);
  final counts = <DateTime, int>{}; // LinkedHashMap: insertion order follows the pre-ordered list
  for (final asset in _orderedForGrouping(assets, groupBy, descending)) {
    final key = _localBucketDate(asset.createdAt, groupBy);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return [for (final e in counts.entries) TimeBucket(date: e.key, assetCount: e.value)];
}

List<BaseAsset> _orderedForGrouping(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) return assets;
  // Tie-break on heroTag so assets sharing an identical createdAt keep a stable order,
  // keeping the overview representative (first asset per bucket) deterministic across rebuilds.
  final sorted = [...assets]
    ..sort((a, b) {
      final byDate = a.createdAt.compareTo(b.createdAt);
      return byDate != 0 ? byDate : a.heroTag.compareTo(b.heroTag);
    });
  return descending ? sorted.reversed.toList(growable: false) : sorted.toList(growable: false);
}

DateTime _localBucketDate(DateTime createdAt, GroupAssetsBy groupBy) {
  final t = createdAt.toLocal();
  return switch (groupBy) {
    GroupAssetsBy.day || GroupAssetsBy.auto => DateTime(t.year, t.month, t.day),
    GroupAssetsBy.month => DateTime(t.year, t.month),
    GroupAssetsBy.year => DateTime(t.year),
    // Unreachable: _buildBuckets guards `none` before calling here. Present only to keep the switch exhaustive.
    GroupAssetsBy.none => DateTime(t.year, t.month, t.day),
  };
}

final _scopeDateFormat = DateFormat('yyyy-MM-dd', 'en');

String _sqlPlaceholders(int count, {int start = 1}) => List.generate(count, (index) => '?${start + index}').join(', ');

List<Variable<Object>> _scopedMainVariables(
  List<String> userIds,
  String currentUserId,
  TimelineTemporalScope temporalScope,
) {
  return [
    Variable<String>(currentUserId),
    Variable<String>(_scopeDateFormat.format(temporalScope.start!)),
    Variable<String>(_scopeDateFormat.format(temporalScope.end!)),
    ...userIds.map(Variable<String>.new),
  ];
}

String _scopedMainRemoteWhere(List<String> userIds) {
  final userIdsSql = _sqlPlaceholders(userIds.length, start: 4);
  return '''
rae.deleted_at IS NULL
AND rae.visibility = 0
AND COALESCE(STRFTIME('%Y-%m-%d', rae.local_date_time), STRFTIME('%Y-%m-%d', rae.created_at, 'localtime')) >= ?2
AND COALESCE(STRFTIME('%Y-%m-%d', rae.local_date_time), STRFTIME('%Y-%m-%d', rae.created_at, 'localtime')) <= ?3
AND (
  rae.owner_id IN ($userIdsSql)
  OR EXISTS (
    SELECT 1 FROM shared_space_asset_entity ssa
    INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssa.space_id
    WHERE ssa.asset_id = rae.id
      AND ssm.user_id = ?1
      AND ssm.show_in_timeline = 1
  )
  OR EXISTS (
    SELECT 1 FROM shared_space_library_entity ssl
    INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssl.space_id
    WHERE ssl.library_id = rae.library_id
      AND ssm.user_id = ?1
      AND ssm.show_in_timeline = 1
  )
)
AND (
  rae.stack_id IS NULL
  OR rae.id = se.primary_asset_id
)
''';
}

String _scopedMainLocalWhere(List<String> userIds) {
  final userIdsSql = _sqlPlaceholders(userIds.length, start: 4);
  return '''
STRFTIME('%Y-%m-%d', lae.created_at, 'localtime') >= ?2
AND STRFTIME('%Y-%m-%d', lae.created_at, 'localtime') <= ?3
AND NOT EXISTS (
  SELECT 1 FROM remote_asset_entity rae WHERE rae.checksum = lae.checksum AND rae.owner_id IN ($userIdsSql)
)
AND EXISTS (
  SELECT 1 FROM local_album_asset_entity laa
  INNER JOIN local_album_entity la on laa.album_id = la.id
  WHERE laa.asset_id = lae.id AND la.backup_selection = 0
)
AND NOT EXISTS (
  SELECT 1 FROM local_album_asset_entity laa
  INNER JOIN local_album_entity la on laa.album_id = la.id
  WHERE laa.asset_id = lae.id AND la.backup_selection = 2
)
''';
}

String _scopedMainBucketSql(List<String> userIds, GroupAssetsBy groupBy) {
  final remoteBucketDate = switch (groupBy) {
    GroupAssetsBy.day || GroupAssetsBy.auto =>
      "COALESCE(STRFTIME('%Y-%m-%d', rae.local_date_time), STRFTIME('%Y-%m-%d', rae.created_at, 'localtime'))",
    GroupAssetsBy.month =>
      "COALESCE(STRFTIME('%Y-%m', rae.local_date_time), STRFTIME('%Y-%m', rae.created_at, 'localtime'))",
    GroupAssetsBy.year => "COALESCE(STRFTIME('%Y', rae.local_date_time), STRFTIME('%Y', rae.created_at, 'localtime'))",
    GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
  };
  final localBucketDate = switch (groupBy) {
    GroupAssetsBy.day || GroupAssetsBy.auto => "STRFTIME('%Y-%m-%d', lae.created_at, 'localtime')",
    GroupAssetsBy.month => "STRFTIME('%Y-%m', lae.created_at, 'localtime')",
    GroupAssetsBy.year => "STRFTIME('%Y', lae.created_at, 'localtime')",
    GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
  };

  return '''
SELECT COUNT(*) AS asset_count, bucket_date
FROM (
  SELECT $remoteBucketDate AS bucket_date
  FROM remote_asset_entity rae
  LEFT JOIN stack_entity se ON rae.stack_id = se.id
  WHERE ${_scopedMainRemoteWhere(userIds)}
  UNION ALL
  SELECT $localBucketDate AS bucket_date
  FROM local_asset_entity lae
  WHERE ${_scopedMainLocalWhere(userIds)}
)
GROUP BY bucket_date
ORDER BY bucket_date DESC
''';
}

String _scopedMainAssetSql(List<String> userIds) {
  return '''
SELECT *
FROM (
  SELECT
    rae.id AS remote_id,
    (SELECT lae.id FROM local_asset_entity lae WHERE lae.checksum = rae.checksum LIMIT 1) AS local_id,
    rae.name,
    rae."type",
    rae.created_at AS created_at,
    rae.updated_at,
    rae.width,
    rae.height,
    rae.duration_ms,
    rae.is_favorite,
    rae.thumb_hash,
    rae.checksum,
    rae.owner_id,
    rae.live_photo_video_id,
    0 AS orientation,
    rae.stack_id,
    NULL AS i_cloud_id,
    NULL AS latitude,
    NULL AS longitude,
    NULL AS adjustment_time,
    rae.is_edited,
    0 AS playback_style
  FROM remote_asset_entity rae
  LEFT JOIN stack_entity se ON rae.stack_id = se.id
  WHERE ${_scopedMainRemoteWhere(userIds)}
  UNION ALL
  SELECT
    NULL AS remote_id,
    lae.id AS local_id,
    lae.name,
    lae."type",
    lae.created_at AS created_at,
    lae.updated_at,
    lae.width,
    lae.height,
    lae.duration_ms,
    lae.is_favorite,
    NULL AS thumb_hash,
    lae.checksum,
    NULL AS owner_id,
    NULL AS live_photo_video_id,
    lae.orientation,
    NULL AS stack_id,
    lae.i_cloud_id,
    lae.latitude,
    lae.longitude,
    lae.adjustment_time,
    0 AS is_edited,
    lae.playback_style
  FROM local_asset_entity lae
  WHERE ${_scopedMainLocalWhere(userIds)}
)
ORDER BY created_at DESC
LIMIT ?${userIds.length + 4} OFFSET ?${userIds.length + 5}
''';
}

BaseAsset _scopedMainAssetFromRow(QueryRow row) {
  final remoteId = row.readNullable<String>('remote_id');
  final localId = row.readNullable<String>('local_id');
  final ownerId = row.readNullable<String>('owner_id');

  if (remoteId != null && ownerId != null) {
    return RemoteAsset(
      id: remoteId,
      localId: localId,
      name: row.read<String>('name'),
      ownerId: ownerId,
      checksum: row.read<String>('checksum'),
      type: AssetType.values[row.read<int>('type')],
      createdAt: row.read<DateTime>('created_at'),
      updatedAt: row.read<DateTime>('updated_at'),
      thumbHash: row.readNullable<String>('thumb_hash'),
      width: row.read<int>('width'),
      height: row.read<int>('height'),
      isFavorite: row.read<bool>('is_favorite'),
      durationMs: row.read<int>('duration_ms'),
      livePhotoVideoId: row.readNullable<String>('live_photo_video_id'),
      stackId: row.readNullable<String>('stack_id'),
      isEdited: row.read<bool>('is_edited'),
    );
  }

  return LocalAsset(
    id: localId!,
    remoteId: remoteId,
    name: row.read<String>('name'),
    checksum: row.readNullable<String>('checksum'),
    type: AssetType.values[row.read<int>('type')],
    createdAt: row.read<DateTime>('created_at'),
    updatedAt: row.read<DateTime>('updated_at'),
    width: row.read<int>('width'),
    height: row.read<int>('height'),
    isFavorite: row.read<bool>('is_favorite'),
    durationMs: row.read<int>('duration_ms'),
    orientation: row.read<int>('orientation'),
    playbackStyle: AssetPlaybackStyle.values[row.read<int>('playback_style')],
    cloudId: row.readNullable<String>('i_cloud_id'),
    latitude: row.readNullable<double>('latitude'),
    longitude: row.readNullable<double>('longitude'),
    adjustmentTime: row.readNullable<DateTime>('adjustment_time'),
    isEdited: row.read<bool>('is_edited'),
  );
}

Expression<bool> _remoteWithinTemporalScope($RemoteAssetEntityTable row, TimelineTemporalScope scope) {
  if (scope.isEmpty) return const Constant(true);
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.effectiveCreatedAt(GroupAssetsBy.day);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}

Expression<bool> _localWithinTemporalScope($LocalAssetEntityTable row, TimelineTemporalScope scope) {
  if (scope.isEmpty) return const Constant(true);
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.createdAt.dateFmt(GroupAssetsBy.day, toLocal: true);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}

extension on Expression<DateTime> {
  Expression<String> dateFmt(GroupAssetsBy groupBy, {bool toLocal = false}) {
    // DateTimes are stored in UTC, so we need to convert them to local time inside the query before formatting
    // to create the correct time bucket when toLocal is true
    // toLocal is false for remote assets where localDateTime is already in the correct timezone
    final localTimeExp = toLocal ? modify(const DateTimeModifier.localTime()) : this;
    return switch (groupBy) {
      GroupAssetsBy.day || GroupAssetsBy.auto => localTimeExp.date,
      GroupAssetsBy.month => localTimeExp.strftime("%Y-%m"),
      GroupAssetsBy.year => localTimeExp.strftime("%Y"),
      GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
    };
  }
}

extension on $RemoteAssetEntityTable {
  Expression<String> effectiveCreatedAt(GroupAssetsBy groupBy, {SortAssetsBy sortBy = SortAssetsBy.taken}) {
    if (sortBy == SortAssetsBy.uploaded) {
      return uploadedAt.dateFmt(groupBy, toLocal: true);
    }

    return coalesce([localDateTime.dateFmt(groupBy), createdAt.dateFmt(groupBy, toLocal: true)]);
  }
}

extension on String {
  DateTime truncateDate(GroupAssetsBy groupBy) {
    final format = switch (groupBy) {
      GroupAssetsBy.day || GroupAssetsBy.auto => "y-M-d",
      GroupAssetsBy.month => "y-M",
      GroupAssetsBy.year => "y",
      GroupAssetsBy.none => throw ArgumentError("GroupAssetsBy.none is not supported for date formatting"),
    };
    return DateFormat(format, 'en').parse(this);
  }
}
