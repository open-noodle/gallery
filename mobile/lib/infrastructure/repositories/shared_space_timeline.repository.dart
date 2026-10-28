part of 'timeline.repository.dart';

/// Gallery timeline queries. Every route the app opens goes through here: the Space timelines,
/// the viewer-visibility scopes (partners and Spaces on video, place, map and favorites), the
/// fork's main timeline (shared_space_timeline.drift) and the temporal scope applied to every
/// route. Upstream routes this file reuses keep their bodies in [TimelineRepository]; the fork
/// hunks there are an optional `extraWhere` on the four album, the place and the person builders,
/// an optional `extraJoins` on the remote and place buckets and the joinLocal remote asset list
/// (a joined bucket counts distinct assets), the `GroupAssetsBy.none` counts rewritten as joined
/// counts (the remote album one carries `deletedAt IS NULL`) and the year arms.
class SharedSpaceTimelineRepository {
  final TimelineRepository _timeline;

  const SharedSpaceTimelineRepository(this._timeline);

  Drift get _db => _timeline._db;

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

    return _db.sharedSpaceTimelineDrift
        .spaceMergedBucket(userIds: userIds, currentUserId: currentUserId, groupBy: groupBy.index)
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

    return _db.sharedSpaceTimelineDrift
        .spaceMergedAsset(userIds: userIds, currentUserId: currentUserId, limit: (_) => Limit(count, offset))
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
        _db.sharedSpaceAlbumAssetEntity,
        _db.sharedSpaceAlbumLinkEntity,
        _db.sharedSpaceAlbumHiddenEntity,
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
            _db.sharedSpaceAlbumAssetEntity,
            _db.sharedSpaceAlbumLinkEntity,
            _db.sharedSpaceAlbumHiddenEntity,
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
    bucketSource: () => _timeline._watchLocalAlbumBucket(
      albumId,
      groupBy: groupBy,
      extraWhere: _localWithinTemporalScope(_db.localAssetEntity, temporalScope),
    ),
    assetSource: (offset, count) => _timeline._getLocalAlbumBucketAssets(
      albumId,
      offset: offset,
      count: count,
      extraWhere: _localWithinTemporalScope(_db.localAssetEntity, temporalScope),
    ),
    origin: TimelineOrigin.localAlbum,
  );

  TimelineQuery remoteAlbum(
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () => _timeline._watchRemoteAlbumBucket(
      albumId,
      groupBy: groupBy,
      extraWhere: _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
    ),
    assetSource: (offset, count) => _timeline._getRemoteAlbumBucketAssets(
      albumId,
      groupBy: groupBy,
      offset: offset,
      count: count,
      extraWhere: _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope),
    ),
    origin: TimelineOrigin.remoteAlbum,
  );

  // Mirrors remoteAlbum() but scopes via shared_space_asset. Always orders DESC
  // (shared spaces have no per-space order setting in PR1).
  //
  // Assets belong to a space if they are directly added via shared_space_asset, owned by a
  // library linked via shared_space_library, or in an album linked into the space with
  // showInTimeline. The bucket LEFT JOINs the association tables and requires one match: Drift's
  // `.watch()` only subscribes to tables referenced via a real FROM/JOIN, so a previous
  // `IN (...) OR IN (...)` formulation produced a stale stream that never re-emitted when photos
  // were added/removed or a library link changed (timeline_repository_test.dart covers both). A
  // joined bucket counts DISTINCT remote_asset.id, so an asset matching several branches counts
  // once. The asset list (.get(), no reactivity concern) uses isInQuery, which deduplicates.
  //
  // Stack collapse: we LEFT JOIN stack_entity and keep an asset when it has no stack, when it IS
  // the stack's primary (cover), OR when the stack row is not present locally
  // (stack_entity.id IS NULL). That last arm matters for shared spaces: stack_entity only syncs
  // for the viewer's own and partners' stacks (there is no shared-space stack sync), yet a
  // non-owned space asset still carries its stack_id. Without the `IS NULL` fallback such a stack
  // would collapse against a missing primary and vanish entirely; instead we show its frames flat.
  TimelineQuery sharedSpace(
    String spaceId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final rae = _db.remoteAssetEntity;
    final stack = _db.stackEntity;
    Expression<bool> inSpace(Expression<bool> membership) =>
        rae.deletedAt.isNull() &
        (rae.visibility.equalsValue(AssetVisibility.timeline) | rae.visibility.equalsValue(AssetVisibility.archive)) &
        _remoteWithinTemporalScope(rae, temporalScope) &
        membership &
        (rae.stackId.isNull() | stack.id.isNull() | rae.id.equalsExp(stack.primaryAssetId));
    Join stackJoin() => leftOuterJoin(stack, stack.id.equalsExp(rae.stackId), useColumns: false);

    return (
      bucketSource: () => _timeline
          ._watchRemoteBucket(
            filter: (_) => inSpace(
              _db.sharedSpaceAssetEntity.assetId.isNotNull() |
                  _db.sharedSpaceLibraryEntity.libraryId.isNotNull() |
                  _db.sharedSpaceAlbumLinkEntity.albumId.isNotNull(),
            ),
            groupBy: groupBy,
            extraJoins: [
              leftOuterJoin(
                _db.sharedSpaceAssetEntity,
                _db.sharedSpaceAssetEntity.assetId.equalsExp(rae.id) &
                    _db.sharedSpaceAssetEntity.spaceId.equals(spaceId),
                useColumns: false,
              ),
              leftOuterJoin(
                _db.sharedSpaceLibraryEntity,
                _db.sharedSpaceLibraryEntity.libraryId.equalsExp(rae.libraryId) &
                    _db.sharedSpaceLibraryEntity.spaceId.equals(spaceId),
                useColumns: false,
              ),
              leftOuterJoin(
                _db.sharedSpaceAlbumAssetEntity,
                _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(rae.id),
                useColumns: false,
              ),
              leftOuterJoin(
                _db.sharedSpaceAlbumLinkEntity,
                _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId) &
                    _db.sharedSpaceAlbumLinkEntity.spaceId.equals(spaceId) &
                    _db.sharedSpaceAlbumLinkEntity.showInTimeline.equals(true),
                useColumns: false,
              ),
              stackJoin(),
            ],
          )
          .handleError((error) => const <Bucket>[]),
      assetSource: (offset, count) => _timeline._getRemoteAssets(
        filter: (_) => inSpace(
          rae.id.isInQuery(
                _db.sharedSpaceAssetEntity.selectOnly()
                  ..addColumns([_db.sharedSpaceAssetEntity.assetId])
                  ..where(_db.sharedSpaceAssetEntity.spaceId.equals(spaceId)),
              ) |
              rae.libraryId.isInQuery(
                _db.sharedSpaceLibraryEntity.selectOnly()
                  ..addColumns([_db.sharedSpaceLibraryEntity.libraryId])
                  ..where(_db.sharedSpaceLibraryEntity.spaceId.equals(spaceId)),
              ) |
              rae.id.isInQuery(
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
              ),
        ),
        offset: offset,
        count: count,
        joinLocal: true,
        extraJoins: [stackJoin()],
      ),
      origin: TimelineOrigin.remoteSpace,
    );
  }

  // Detail query for one linked album inside a space. Scopes by album membership
  // only (no showInTimeline filter — the detail page shows all the album's
  // photos). spaceId is carried for the origin/header.
  TimelineQuery spaceAlbum(
    String spaceId,
    String albumId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final rae = _db.remoteAssetEntity;
    final albumAsset = _db.sharedSpaceAlbumAssetEntity;
    Expression<bool> inAlbum(Expression<bool> membership) =>
        rae.deletedAt.isNull() &
        (rae.visibility.equalsValue(AssetVisibility.timeline) | rae.visibility.equalsValue(AssetVisibility.archive)) &
        _remoteWithinTemporalScope(rae, temporalScope) &
        membership;

    return (
      bucketSource: () => _timeline
          ._watchRemoteBucket(
            filter: (_) => inAlbum(albumAsset.assetId.isNotNull()),
            groupBy: groupBy,
            extraJoins: [
              leftOuterJoin(
                albumAsset,
                albumAsset.assetId.equalsExp(rae.id) & albumAsset.albumId.equals(albumId),
                useColumns: false,
              ),
            ],
          )
          .handleError((error) => const <Bucket>[]),
      assetSource: (offset, count) => _timeline._getRemoteAssets(
        filter: (_) => inAlbum(
          rae.id.isInQuery(
            albumAsset.selectOnly()
              ..addColumns([albumAsset.assetId])
              ..where(albumAsset.albumId.equals(albumId)),
          ),
        ),
        offset: offset,
        count: count,
        joinLocal: true,
      ),
      origin: TimelineOrigin.remoteSpace,
    );
  }

  TimelineQuery fromAssets(List<BaseAsset> assets, TimelineOrigin origin) => _timeline.fromAssets(assets, origin);

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

  TimelineQuery fromAssetsWithBuckets(List<BaseAsset> assets, TimelineOrigin origin) =>
      _timeline.fromAssetsWithBuckets(assets, origin);

  TimelineQuery remote(
    String ownerId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _timeline._remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        row.visibility.equalsValue(AssetVisibility.timeline) &
        row.ownerId.equals(ownerId) &
        _remoteWithinTemporalScope(row, temporalScope),
    groupBy: groupBy,
    origin: TimelineOrigin.remoteAssets,
  );

  TimelineQuery recentlyAdded(String userId, GroupAssetsBy groupBy) => _timeline.recentlyAdded(userId, groupBy);

  // #763: favorites are per-viewer, not per-owner — a viewer's favorite flag on someone else's
  // asset must still surface on their Favorites page. Mirrors the server/web /favorites scope
  // (timeline.service.ts getTimeBuckets with isFavorite=true, withPartners, withSharedSpaces):
  //   * own assets (Timeline + Archive, the page's pre-#763 owner scope);
  //   * timeline-enabled partners' assets (partner.inTimeline, the same set getMyPartnerIds
  //     {timelineEnabled: true} resolves) — Timeline visibility only, since the server rejects
  //     withPartners without an explicit visibility so a partner's ARCHIVED assets never leak;
  //   * assets reachable through EVERY space the viewer is a member of, ignoring the member's
  //     showInTimeline: a favorite placed inside a space the viewer hid from their timeline is
  //     still theirs (server getAllMemberSpaceIds, "Favorites ignores the timeline hide"). The
  //     album arm keeps the server's 'personal' gate — the viewer's own
  //     shared_space_album_hidden row — not the shared link showInTimeline flag.
  // The bucket runs `_watchRemoteBucket` with [_favoriteScopeJoins] (real joins for reactivity)
  // and the asset list `_getRemoteAssets` with [_favoriteScopePredicate], kept in lockstep. Not
  // the viewer_visibility helpers: they apply the timeline hide.
  TimelineQuery favorite(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    Expression<bool> favoriteInScope($RemoteAssetEntityTable row, Expression<bool> inScope) =>
        row.deletedAt.isNull() &
        row.isFavorite.equals(true) &
        (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive)) &
        _remoteWithinTemporalScope(row, temporalScope) &
        inScope;

    return (
      bucketSource: () {
        final scope = _favoriteScopeJoins(userId);
        return _timeline._watchRemoteBucket(
          filter: (row) => favoriteInScope(row, scope.inScope),
          groupBy: groupBy,
          extraJoins: scope.joins,
        );
      },
      assetSource: (offset, count) => _timeline._getRemoteAssets(
        filter: (row) => favoriteInScope(row, _favoriteScopePredicate(userId)),
        offset: offset,
        count: count,
      ),
      origin: TimelineOrigin.favorite,
    );
  }

  /// LEFT OUTER JOINs + WHERE term for the Favorites scope (see [favorite]). Real joins rather than
  /// isInQuery so Drift's readsFrom tracks every table and the bucket stream stays reactive.
  ({List<Join> joins, Expression<bool> inScope}) _favoriteScopeJoins(String userId) {
    final rae = _db.remoteAssetEntity;
    final assetMember = _db.alias(_db.sharedSpaceMemberEntity, 'fav_ssm_asset');
    final libraryMember = _db.alias(_db.sharedSpaceMemberEntity, 'fav_ssm_lib');
    final albumMember = _db.alias(_db.sharedSpaceMemberEntity, 'fav_ssm_album');

    final joins = <Join>[
      leftOuterJoin(
        _db.partnerEntity,
        _db.partnerEntity.sharedById.equalsExp(rae.ownerId) &
            _db.partnerEntity.sharedWithId.equals(userId) &
            _db.partnerEntity.inTimeline.equals(true),
        useColumns: false,
      ),
      leftOuterJoin(
        _db.sharedSpaceAssetEntity,
        _db.sharedSpaceAssetEntity.assetId.equalsExp(rae.id),
        useColumns: false,
      ),
      leftOuterJoin(
        assetMember,
        assetMember.spaceId.equalsExp(_db.sharedSpaceAssetEntity.spaceId) & assetMember.userId.equals(userId),
        useColumns: false,
      ),
      leftOuterJoin(
        _db.sharedSpaceLibraryEntity,
        _db.sharedSpaceLibraryEntity.libraryId.equalsExp(rae.libraryId),
        useColumns: false,
      ),
      leftOuterJoin(
        libraryMember,
        libraryMember.spaceId.equalsExp(_db.sharedSpaceLibraryEntity.spaceId) & libraryMember.userId.equals(userId),
        useColumns: false,
      ),
      leftOuterJoin(
        _db.sharedSpaceAlbumAssetEntity,
        _db.sharedSpaceAlbumAssetEntity.assetId.equalsExp(rae.id),
        useColumns: false,
      ),
      leftOuterJoin(
        _db.sharedSpaceAlbumLinkEntity,
        _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId),
        useColumns: false,
      ),
      leftOuterJoin(
        albumMember,
        albumMember.spaceId.equalsExp(_db.sharedSpaceAlbumLinkEntity.spaceId) & albumMember.userId.equals(userId),
        useColumns: false,
      ),
      leftOuterJoin(
        _db.sharedSpaceAlbumHiddenEntity,
        _db.sharedSpaceAlbumHiddenEntity.spaceId.equalsExp(_db.sharedSpaceAlbumLinkEntity.spaceId) &
            _db.sharedSpaceAlbumHiddenEntity.albumId.equalsExp(_db.sharedSpaceAlbumLinkEntity.albumId) &
            _db.sharedSpaceAlbumHiddenEntity.userId.equals(userId),
        useColumns: false,
      ),
    ];

    final inScope =
        rae.ownerId.equals(userId) |
        (_db.partnerEntity.sharedById.isNotNull() & rae.visibility.equalsValue(AssetVisibility.timeline)) |
        assetMember.userId.isNotNull() |
        libraryMember.userId.isNotNull() |
        (albumMember.userId.isNotNull() & _db.sharedSpaceAlbumHiddenEntity.albumId.isNull());

    return (joins: joins, inScope: inScope);
  }

  /// The [_favoriteScopeJoins] scope as isInQuery subqueries, for one-shot .get() asset lists
  /// (no reactivity concern; isInQuery naturally deduplicates).
  Expression<bool> _favoriteScopePredicate(String userId) {
    final rae = _db.remoteAssetEntity;

    final ownedByPartner =
        rae.ownerId.isInQuery(
          _db.partnerEntity.selectOnly()
            ..addColumns([_db.partnerEntity.sharedById])
            ..where(_db.partnerEntity.sharedWithId.equals(userId) & _db.partnerEntity.inTimeline.equals(true)),
        ) &
        rae.visibility.equalsValue(AssetVisibility.timeline);

    final inSpaceAsset = rae.id.isInQuery(
      _db.sharedSpaceAssetEntity.selectOnly()
        ..addColumns([_db.sharedSpaceAssetEntity.assetId])
        ..join([
          innerJoin(
            _db.sharedSpaceMemberEntity,
            _db.sharedSpaceMemberEntity.spaceId.equalsExp(_db.sharedSpaceAssetEntity.spaceId) &
                _db.sharedSpaceMemberEntity.userId.equals(userId),
            useColumns: false,
          ),
        ]),
    );

    final inSpaceLibrary = rae.libraryId.isInQuery(
      _db.sharedSpaceLibraryEntity.selectOnly()
        ..addColumns([_db.sharedSpaceLibraryEntity.libraryId])
        ..join([
          innerJoin(
            _db.sharedSpaceMemberEntity,
            _db.sharedSpaceMemberEntity.spaceId.equalsExp(_db.sharedSpaceLibraryEntity.spaceId) &
                _db.sharedSpaceMemberEntity.userId.equals(userId),
            useColumns: false,
          ),
        ]),
    );

    final inSpaceAlbum = rae.id.isInQuery(
      _db.sharedSpaceAlbumAssetEntity.selectOnly()
        ..addColumns([_db.sharedSpaceAlbumAssetEntity.assetId])
        ..join([
          innerJoin(
            _db.sharedSpaceAlbumLinkEntity,
            _db.sharedSpaceAlbumLinkEntity.albumId.equalsExp(_db.sharedSpaceAlbumAssetEntity.albumId),
            useColumns: false,
          ),
          innerJoin(
            _db.sharedSpaceMemberEntity,
            _db.sharedSpaceMemberEntity.spaceId.equalsExp(_db.sharedSpaceAlbumLinkEntity.spaceId) &
                _db.sharedSpaceMemberEntity.userId.equals(userId),
            useColumns: false,
          ),
          leftOuterJoin(
            _db.sharedSpaceAlbumHiddenEntity,
            _db.sharedSpaceAlbumHiddenEntity.spaceId.equalsExp(_db.sharedSpaceAlbumLinkEntity.spaceId) &
                _db.sharedSpaceAlbumHiddenEntity.albumId.equalsExp(_db.sharedSpaceAlbumLinkEntity.albumId) &
                _db.sharedSpaceAlbumHiddenEntity.userId.equals(userId),
            useColumns: false,
          ),
        ])
        ..where(_db.sharedSpaceAlbumHiddenEntity.albumId.isNull()),
    );

    return rae.ownerId.equals(userId) | ownedByPartner | inSpaceAsset | inSpaceLibrary | inSpaceAlbum;
  }

  TimelineQuery trash(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _timeline._remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNotNull() & row.ownerId.equals(userId) & _remoteWithinTemporalScope(row, temporalScope),
    groupBy: groupBy,
    origin: TimelineOrigin.trash,
    joinLocal: true,
  );

  TimelineQuery archived(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _timeline._remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        row.ownerId.equals(userId) &
        row.visibility.equalsValue(AssetVisibility.archive) &
        _remoteWithinTemporalScope(row, temporalScope),
    groupBy: groupBy,
    origin: TimelineOrigin.archive,
    joinLocal: true,
  );

  TimelineQuery locked(
    String userId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => _timeline._remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        row.visibility.equalsValue(AssetVisibility.locked) &
        row.ownerId.equals(userId) &
        _remoteWithinTemporalScope(row, temporalScope),
    origin: TimelineOrigin.lockedFolder,
    groupBy: groupBy,
  );

  TimelineQuery video(
    List<String> userIds,
    String currentUserId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    Expression<bool> visibleVideo($RemoteAssetEntityTable row, Expression<bool> visibleToViewer) =>
        row.deletedAt.isNull() &
        row.type.equalsValue(AssetType.video) &
        row.visibility.equalsValue(AssetVisibility.timeline) &
        _remoteWithinTemporalScope(row, temporalScope) &
        visibleToViewer;

    return (
      bucketSource: () {
        if (groupBy == GroupAssetsBy.none) {
          throw UnsupportedError('GroupAssetsBy.none is not supported for _watchVideoBucket');
        }
        final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
        return _timeline._watchRemoteBucket(
          filter: (row) => visibleVideo(
            row,
            row.ownerId.isIn(userIds) |
                viz.assetMember.userId.isNotNull() |
                viz.libraryMember.userId.isNotNull() |
                viz.albumMember.userId.isNotNull(),
          ),
          groupBy: groupBy,
          extraJoins: viz.joins,
        );
      },
      assetSource: (offset, count) => _timeline._getRemoteAssets(
        filter: (row) => visibleVideo(row, viewerVisibilityPredicate(_db, row, userIds, currentUserId)),
        offset: offset,
        count: count,
      ),
      origin: TimelineOrigin.video,
    );
  }

  TimelineQuery place(
    String place,
    List<String> userIds,
    String currentUserId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) => (
    bucketSource: () {
      final viz = buildViewerVisibilityJoins(_db, _db.remoteAssetEntity, currentUserId);
      return _timeline._watchPlaceBucket(
        place,
        groupBy: groupBy,
        extraJoins: viz.joins,
        extraWhere:
            _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
            (_db.remoteAssetEntity.ownerId.isIn(userIds) |
                viz.assetMember.userId.isNotNull() |
                viz.libraryMember.userId.isNotNull() |
                viz.albumMember.userId.isNotNull()),
      );
    },
    assetSource: (offset, count) => _timeline._getPlaceBucketAssets(
      place,
      groupBy: groupBy,
      offset: offset,
      count: count,
      extraWhere:
          _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope) &
          viewerVisibilityPredicate(_db, _db.remoteAssetEntity, userIds, currentUserId),
    ),
    origin: TimelineOrigin.place,
  );

  // Owner-scoped like the person/asset_face sync it reads. Upstream's person filter also admits
  // partner and album assets; the owner term keeps this route exactly as it was.
  TimelineQuery person(
    String userId,
    String personId,
    GroupAssetsBy groupBy, {
    TimelineTemporalScope temporalScope = const TimelineTemporalScope.none(),
  }) {
    final ownedInScope =
        _db.remoteAssetEntity.ownerId.equals(userId) & _remoteWithinTemporalScope(_db.remoteAssetEntity, temporalScope);
    return (
      bucketSource: () => _timeline._watchPersonBucket([userId], personId, groupBy: groupBy, extraWhere: ownedInScope),
      assetSource: (offset, count) => _timeline._getPersonBucketAssets(
        [userId],
        personId,
        groupBy: groupBy,
        offset: offset,
        count: count,
        extraWhere: ownedInScope,
      ),
      origin: TimelineOrigin.person,
    );
  }

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
  }) => _timeline._remoteQueryBuilder(
    filter: (row) =>
        row.deletedAt.isNull() &
        (row.visibility.equalsValue(AssetVisibility.timeline) | row.visibility.equalsValue(AssetVisibility.archive)) &
        row.id.isIn(assetIds) &
        _remoteWithinTemporalScope(row, temporalScope),
    groupBy: groupBy,
    origin: TimelineOrigin.person,
  );

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
          (options) => _watchMapBucket(
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
}

// Date-less segments (flat) for `none`; dated TimeBuckets in `descending` order otherwise.
List<Bucket> _buildBuckets(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) {
    return _generateBuckets(assets.length);
  }
  final counts = <DateTime, int>{}; // LinkedHashMap: insertion order follows the pre-ordered list
  for (final asset in _orderedForGrouping(assets, groupBy, descending)) {
    final key = _localBucketDate(asset.createdAt, groupBy);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return [for (final e in counts.entries) TimeBucket(date: e.key, assetCount: e.value)];
}

List<BaseAsset> _orderedForGrouping(List<BaseAsset> assets, GroupAssetsBy groupBy, bool descending) {
  if (groupBy == GroupAssetsBy.none) {
    return assets;
  }
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

// Same ownership and Space predicate as spaceMergedAsset/spaceMergedBucket in
// shared_space_timeline.drift (album-link leg and the #1041 owner hide included); keep them in step.
String _scopedMainRemoteWhere(List<String> userIds) {
  final userIdsSql = _sqlPlaceholders(userIds.length, start: 4);
  return '''
rae.deleted_at IS NULL
AND rae.visibility = 0
AND COALESCE(STRFTIME('%Y-%m-%d', rae.local_date_time), STRFTIME('%Y-%m-%d', rae.created_at, 'localtime')) >= ?2
AND COALESCE(STRFTIME('%Y-%m-%d', rae.local_date_time), STRFTIME('%Y-%m-%d', rae.created_at, 'localtime')) <= ?3
AND (
  (
    (rae.owner_id IN ($userIdsSql) AND rae.owner_id != ?1)
    OR (
      rae.owner_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM shared_space_asset_entity ssa
        INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssa.space_id
        WHERE ssa.asset_id = rae.id
          AND ssm.user_id = ?1
          AND ssm.show_in_timeline = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM shared_space_library_entity ssl
        INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssl.space_id
        WHERE ssl.library_id = rae.library_id
          AND ssm.user_id = ?1
          AND ssm.show_in_timeline = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM shared_space_album_asset_entity ssaa
        INNER JOIN shared_space_album_link_entity ssal ON ssal.album_id = ssaa.album_id
        INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssal.space_id
        WHERE ssaa.asset_id = rae.id
          AND ssm.user_id = ?1
          AND (
            ssm.show_in_timeline = 0
            OR EXISTS (
              SELECT 1 FROM shared_space_album_hidden_entity ssah
              WHERE ssah.space_id = ssal.space_id
                AND ssah.album_id = ssal.album_id
                AND ssah.user_id = ?1
            )
          )
      )
    )
  )
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
  OR EXISTS (
    SELECT 1 FROM shared_space_album_asset_entity ssaa
    INNER JOIN shared_space_album_link_entity ssal ON ssal.album_id = ssaa.album_id
    INNER JOIN shared_space_member_entity ssm ON ssm.space_id = ssal.space_id
    WHERE ssaa.asset_id = rae.id
      AND NOT EXISTS (
        SELECT 1 FROM shared_space_album_hidden_entity ssah
        WHERE ssah.space_id = ssal.space_id
          AND ssah.album_id = ssal.album_id
          AND ssah.user_id = ?1
      )
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
  if (scope.isEmpty) {
    return const Constant(true);
  }
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.effectiveCreatedAt(GroupAssetsBy.day);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}

Expression<bool> _localWithinTemporalScope($LocalAssetEntityTable row, TimelineTemporalScope scope) {
  if (scope.isEmpty) {
    return const Constant(true);
  }
  final start = _scopeDateFormat.format(scope.start!);
  final end = _scopeDateFormat.format(scope.end!);
  final dateExp = row.createdAt.dateFmt(GroupAssetsBy.day, toLocal: true);
  return dateExp.isBiggerOrEqualValue(start) & dateExp.isSmallerOrEqualValue(end);
}
