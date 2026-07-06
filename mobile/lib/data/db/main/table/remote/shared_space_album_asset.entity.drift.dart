// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.dart'
    as i2;

typedef $$SharedSpaceAlbumAssetEntityTableCreateCompanionBuilder =
    i1.SharedSpaceAlbumAssetEntityCompanion Function({
      required String albumId,
      required String assetId,
    });
typedef $$SharedSpaceAlbumAssetEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceAlbumAssetEntityCompanion Function({
      i0.Value<String> albumId,
      i0.Value<String> assetId,
    });

class $$SharedSpaceAlbumAssetEntityTableFilterComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumAssetEntityTable
        > {
  $$SharedSpaceAlbumAssetEntityTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnFilters<String> get albumId => $composableBuilder(
    column: $table.albumId,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get assetId => $composableBuilder(
    column: $table.assetId,
    builder: (column) => i0.ColumnFilters(column),
  );
}

class $$SharedSpaceAlbumAssetEntityTableOrderingComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumAssetEntityTable
        > {
  $$SharedSpaceAlbumAssetEntityTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnOrderings<String> get albumId => $composableBuilder(
    column: $table.albumId,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get assetId => $composableBuilder(
    column: $table.assetId,
    builder: (column) => i0.ColumnOrderings(column),
  );
}

class $$SharedSpaceAlbumAssetEntityTableAnnotationComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumAssetEntityTable
        > {
  $$SharedSpaceAlbumAssetEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get albumId =>
      $composableBuilder(column: $table.albumId, builder: (column) => column);

  i0.GeneratedColumn<String> get assetId =>
      $composableBuilder(column: $table.assetId, builder: (column) => column);
}

class $$SharedSpaceAlbumAssetEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumAssetEntityTable,
          i1.SharedSpaceAlbumAssetEntityData,
          i1.$$SharedSpaceAlbumAssetEntityTableFilterComposer,
          i1.$$SharedSpaceAlbumAssetEntityTableOrderingComposer,
          i1.$$SharedSpaceAlbumAssetEntityTableAnnotationComposer,
          $$SharedSpaceAlbumAssetEntityTableCreateCompanionBuilder,
          $$SharedSpaceAlbumAssetEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceAlbumAssetEntityData,
            i0.BaseReferences<
              i0.GeneratedDatabase,
              i1.$SharedSpaceAlbumAssetEntityTable,
              i1.SharedSpaceAlbumAssetEntityData
            >,
          ),
          i1.SharedSpaceAlbumAssetEntityData,
          i0.PrefetchHooks Function()
        > {
  $$SharedSpaceAlbumAssetEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceAlbumAssetEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceAlbumAssetEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceAlbumAssetEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceAlbumAssetEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> albumId = const i0.Value.absent(),
                i0.Value<String> assetId = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumAssetEntityCompanion(
                albumId: albumId,
                assetId: assetId,
              ),
          createCompanionCallback:
              ({required String albumId, required String assetId}) =>
                  i1.SharedSpaceAlbumAssetEntityCompanion.insert(
                    albumId: albumId,
                    assetId: assetId,
                  ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), i0.BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SharedSpaceAlbumAssetEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceAlbumAssetEntityTable,
      i1.SharedSpaceAlbumAssetEntityData,
      i1.$$SharedSpaceAlbumAssetEntityTableFilterComposer,
      i1.$$SharedSpaceAlbumAssetEntityTableOrderingComposer,
      i1.$$SharedSpaceAlbumAssetEntityTableAnnotationComposer,
      $$SharedSpaceAlbumAssetEntityTableCreateCompanionBuilder,
      $$SharedSpaceAlbumAssetEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceAlbumAssetEntityData,
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumAssetEntityTable,
          i1.SharedSpaceAlbumAssetEntityData
        >,
      ),
      i1.SharedSpaceAlbumAssetEntityData,
      i0.PrefetchHooks Function()
    >;
i0.Index get idxSharedSpaceAlbumAssetAlbum => i0.Index(
  'idx_shared_space_album_asset_album',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_album ON shared_space_album_asset_entity (album_id)',
);

class $SharedSpaceAlbumAssetEntityTable extends i2.SharedSpaceAlbumAssetEntity
    with
        i0.TableInfo<
          $SharedSpaceAlbumAssetEntityTable,
          i1.SharedSpaceAlbumAssetEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceAlbumAssetEntityTable(this.attachedDatabase, [this._alias]);
  static const i0.VerificationMeta _albumIdMeta = const i0.VerificationMeta(
    'albumId',
  );
  @override
  late final i0.GeneratedColumn<String> albumId = i0.GeneratedColumn<String>(
    'album_id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const i0.VerificationMeta _assetIdMeta = const i0.VerificationMeta(
    'assetId',
  );
  @override
  late final i0.GeneratedColumn<String> assetId = i0.GeneratedColumn<String>(
    'asset_id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<i0.GeneratedColumn> get $columns => [albumId, assetId];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_album_asset_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceAlbumAssetEntityData> instance, {
    bool isInserting = false,
  }) {
    final context = i0.VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('album_id')) {
      context.handle(
        _albumIdMeta,
        albumId.isAcceptableOrUnknown(data['album_id']!, _albumIdMeta),
      );
    } else if (isInserting) {
      context.missing(_albumIdMeta);
    }
    if (data.containsKey('asset_id')) {
      context.handle(
        _assetIdMeta,
        assetId.isAcceptableOrUnknown(data['asset_id']!, _assetIdMeta),
      );
    } else if (isInserting) {
      context.missing(_assetIdMeta);
    }
    return context;
  }

  @override
  Set<i0.GeneratedColumn> get $primaryKey => {albumId, assetId};
  @override
  i1.SharedSpaceAlbumAssetEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceAlbumAssetEntityData(
      albumId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}album_id'],
      )!,
      assetId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}asset_id'],
      )!,
    );
  }

  @override
  $SharedSpaceAlbumAssetEntityTable createAlias(String alias) {
    return $SharedSpaceAlbumAssetEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceAlbumAssetEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceAlbumAssetEntityData> {
  final String albumId;
  final String assetId;
  const SharedSpaceAlbumAssetEntityData({
    required this.albumId,
    required this.assetId,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['album_id'] = i0.Variable<String>(albumId);
    map['asset_id'] = i0.Variable<String>(assetId);
    return map;
  }

  factory SharedSpaceAlbumAssetEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceAlbumAssetEntityData(
      albumId: serializer.fromJson<String>(json['albumId']),
      assetId: serializer.fromJson<String>(json['assetId']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'albumId': serializer.toJson<String>(albumId),
      'assetId': serializer.toJson<String>(assetId),
    };
  }

  i1.SharedSpaceAlbumAssetEntityData copyWith({
    String? albumId,
    String? assetId,
  }) => i1.SharedSpaceAlbumAssetEntityData(
    albumId: albumId ?? this.albumId,
    assetId: assetId ?? this.assetId,
  );
  SharedSpaceAlbumAssetEntityData copyWithCompanion(
    i1.SharedSpaceAlbumAssetEntityCompanion data,
  ) {
    return SharedSpaceAlbumAssetEntityData(
      albumId: data.albumId.present ? data.albumId.value : this.albumId,
      assetId: data.assetId.present ? data.assetId.value : this.assetId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumAssetEntityData(')
          ..write('albumId: $albumId, ')
          ..write('assetId: $assetId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(albumId, assetId);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceAlbumAssetEntityData &&
          other.albumId == this.albumId &&
          other.assetId == this.assetId);
}

class SharedSpaceAlbumAssetEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceAlbumAssetEntityData> {
  final i0.Value<String> albumId;
  final i0.Value<String> assetId;
  const SharedSpaceAlbumAssetEntityCompanion({
    this.albumId = const i0.Value.absent(),
    this.assetId = const i0.Value.absent(),
  });
  SharedSpaceAlbumAssetEntityCompanion.insert({
    required String albumId,
    required String assetId,
  }) : albumId = i0.Value(albumId),
       assetId = i0.Value(assetId);
  static i0.Insertable<i1.SharedSpaceAlbumAssetEntityData> custom({
    i0.Expression<String>? albumId,
    i0.Expression<String>? assetId,
  }) {
    return i0.RawValuesInsertable({
      if (albumId != null) 'album_id': albumId,
      if (assetId != null) 'asset_id': assetId,
    });
  }

  i1.SharedSpaceAlbumAssetEntityCompanion copyWith({
    i0.Value<String>? albumId,
    i0.Value<String>? assetId,
  }) {
    return i1.SharedSpaceAlbumAssetEntityCompanion(
      albumId: albumId ?? this.albumId,
      assetId: assetId ?? this.assetId,
    );
  }

  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    if (albumId.present) {
      map['album_id'] = i0.Variable<String>(albumId.value);
    }
    if (assetId.present) {
      map['asset_id'] = i0.Variable<String>(assetId.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumAssetEntityCompanion(')
          ..write('albumId: $albumId, ')
          ..write('assetId: $assetId')
          ..write(')'))
        .toString();
  }
}

i0.Index get idxSharedSpaceAlbumAssetAssetAlbum => i0.Index(
  'idx_shared_space_album_asset_asset_album',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_asset_asset_album ON shared_space_album_asset_entity (asset_id, album_id)',
);
