// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_hidden.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_hidden.entity.dart'
    as i2;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i3;
import 'package:drift/internal/modular.dart' as i4;

typedef $$SharedSpaceAlbumHiddenEntityTableCreateCompanionBuilder =
    i1.SharedSpaceAlbumHiddenEntityCompanion Function({
      required String spaceId,
      required String albumId,
      required String userId,
    });
typedef $$SharedSpaceAlbumHiddenEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceAlbumHiddenEntityCompanion Function({
      i0.Value<String> spaceId,
      i0.Value<String> albumId,
      i0.Value<String> userId,
    });

final class $$SharedSpaceAlbumHiddenEntityTableReferences
    extends
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumHiddenEntityTable,
          i1.SharedSpaceAlbumHiddenEntityData
        > {
  $$SharedSpaceAlbumHiddenEntityTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static i3.$SharedSpaceEntityTable _spaceIdTable(
    i0.GeneratedDatabase db,
  ) => i4.ReadDatabaseContainer(db)
      .resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity')
      .createAlias(
        'shared_space_album_hidden_entity__space_id__shared_space_entity__id',
      );

  i3.$$SharedSpaceEntityTableProcessedTableManager get spaceId {
    final $_column = $_itemColumn<String>('space_id')!;

    final manager = i3
        .$$SharedSpaceEntityTableTableManager(
          $_db,
          i4.ReadDatabaseContainer(
            $_db,
          ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
        )
        .filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_spaceIdTable($_db));
    if (item == null) return manager;
    return i0.ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$SharedSpaceAlbumHiddenEntityTableFilterComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumHiddenEntityTable
        > {
  $$SharedSpaceAlbumHiddenEntityTableFilterComposer({
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

  i0.ColumnFilters<String> get userId => $composableBuilder(
    column: $table.userId,
    builder: (column) => i0.ColumnFilters(column),
  );

  i3.$$SharedSpaceEntityTableFilterComposer get spaceId {
    final i3.$$SharedSpaceEntityTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.spaceId,
      referencedTable: i4.ReadDatabaseContainer(
        $db,
      ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i3.$$SharedSpaceEntityTableFilterComposer(
            $db: $db,
            $table: i4.ReadDatabaseContainer(
              $db,
            ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceAlbumHiddenEntityTableOrderingComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumHiddenEntityTable
        > {
  $$SharedSpaceAlbumHiddenEntityTableOrderingComposer({
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

  i0.ColumnOrderings<String> get userId => $composableBuilder(
    column: $table.userId,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i3.$$SharedSpaceEntityTableOrderingComposer get spaceId {
    final i3.$$SharedSpaceEntityTableOrderingComposer composer =
        $composerBuilder(
          composer: this,
          getCurrentColumn: (t) => t.spaceId,
          referencedTable: i4.ReadDatabaseContainer(
            $db,
          ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
          getReferencedColumn: (t) => t.id,
          builder:
              (
                joinBuilder, {
                $addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer,
              }) => i3.$$SharedSpaceEntityTableOrderingComposer(
                $db: $db,
                $table: i4.ReadDatabaseContainer(
                  $db,
                ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
                $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                joinBuilder: joinBuilder,
                $removeJoinBuilderFromRootComposer:
                    $removeJoinBuilderFromRootComposer,
              ),
        );
    return composer;
  }
}

class $$SharedSpaceAlbumHiddenEntityTableAnnotationComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumHiddenEntityTable
        > {
  $$SharedSpaceAlbumHiddenEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get albumId =>
      $composableBuilder(column: $table.albumId, builder: (column) => column);

  i0.GeneratedColumn<String> get userId =>
      $composableBuilder(column: $table.userId, builder: (column) => column);

  i3.$$SharedSpaceEntityTableAnnotationComposer get spaceId {
    final i3.$$SharedSpaceEntityTableAnnotationComposer composer =
        $composerBuilder(
          composer: this,
          getCurrentColumn: (t) => t.spaceId,
          referencedTable: i4.ReadDatabaseContainer(
            $db,
          ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
          getReferencedColumn: (t) => t.id,
          builder:
              (
                joinBuilder, {
                $addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer,
              }) => i3.$$SharedSpaceEntityTableAnnotationComposer(
                $db: $db,
                $table: i4.ReadDatabaseContainer(
                  $db,
                ).resultSet<i3.$SharedSpaceEntityTable>('shared_space_entity'),
                $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                joinBuilder: joinBuilder,
                $removeJoinBuilderFromRootComposer:
                    $removeJoinBuilderFromRootComposer,
              ),
        );
    return composer;
  }
}

class $$SharedSpaceAlbumHiddenEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumHiddenEntityTable,
          i1.SharedSpaceAlbumHiddenEntityData,
          i1.$$SharedSpaceAlbumHiddenEntityTableFilterComposer,
          i1.$$SharedSpaceAlbumHiddenEntityTableOrderingComposer,
          i1.$$SharedSpaceAlbumHiddenEntityTableAnnotationComposer,
          $$SharedSpaceAlbumHiddenEntityTableCreateCompanionBuilder,
          $$SharedSpaceAlbumHiddenEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceAlbumHiddenEntityData,
            i1.$$SharedSpaceAlbumHiddenEntityTableReferences,
          ),
          i1.SharedSpaceAlbumHiddenEntityData,
          i0.PrefetchHooks Function({bool spaceId})
        > {
  $$SharedSpaceAlbumHiddenEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceAlbumHiddenEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceAlbumHiddenEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceAlbumHiddenEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceAlbumHiddenEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> spaceId = const i0.Value.absent(),
                i0.Value<String> albumId = const i0.Value.absent(),
                i0.Value<String> userId = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumHiddenEntityCompanion(
                spaceId: spaceId,
                albumId: albumId,
                userId: userId,
              ),
          createCompanionCallback:
              ({
                required String spaceId,
                required String albumId,
                required String userId,
              }) => i1.SharedSpaceAlbumHiddenEntityCompanion.insert(
                spaceId: spaceId,
                albumId: albumId,
                userId: userId,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  i1.$$SharedSpaceAlbumHiddenEntityTableReferences(
                    db,
                    table,
                    e,
                  ),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({spaceId = false}) {
            return i0.PrefetchHooks(
              db: db,
              explicitlyWatchedTables: [],
              addJoins:
                  <
                    T extends i0.TableManagerState<
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic,
                      dynamic
                    >
                  >(state) {
                    if (spaceId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.spaceId,
                                referencedTable: i1
                                    .$$SharedSpaceAlbumHiddenEntityTableReferences
                                    ._spaceIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceAlbumHiddenEntityTableReferences
                                    ._spaceIdTable(db)
                                    .id,
                              )
                              as T;
                    }

                    return state;
                  },
              getPrefetchedDataCallback: (items) async {
                return [];
              },
            );
          },
        ),
      );
}

typedef $$SharedSpaceAlbumHiddenEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceAlbumHiddenEntityTable,
      i1.SharedSpaceAlbumHiddenEntityData,
      i1.$$SharedSpaceAlbumHiddenEntityTableFilterComposer,
      i1.$$SharedSpaceAlbumHiddenEntityTableOrderingComposer,
      i1.$$SharedSpaceAlbumHiddenEntityTableAnnotationComposer,
      $$SharedSpaceAlbumHiddenEntityTableCreateCompanionBuilder,
      $$SharedSpaceAlbumHiddenEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceAlbumHiddenEntityData,
        i1.$$SharedSpaceAlbumHiddenEntityTableReferences,
      ),
      i1.SharedSpaceAlbumHiddenEntityData,
      i0.PrefetchHooks Function({bool spaceId})
    >;
i0.Index get idxSharedSpaceAlbumHiddenAlbumSpace => i0.Index(
  'idx_shared_space_album_hidden_album_space',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_hidden_album_space ON shared_space_album_hidden_entity (album_id, space_id)',
);

class $SharedSpaceAlbumHiddenEntityTable extends i2.SharedSpaceAlbumHiddenEntity
    with
        i0.TableInfo<
          $SharedSpaceAlbumHiddenEntityTable,
          i1.SharedSpaceAlbumHiddenEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceAlbumHiddenEntityTable(this.attachedDatabase, [this._alias]);
  static const i0.VerificationMeta _spaceIdMeta = const i0.VerificationMeta(
    'spaceId',
  );
  @override
  late final i0.GeneratedColumn<String> spaceId = i0.GeneratedColumn<String>(
    'space_id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
      'REFERENCES shared_space_entity (id) ON DELETE CASCADE',
    ),
  );
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
  static const i0.VerificationMeta _userIdMeta = const i0.VerificationMeta(
    'userId',
  );
  @override
  late final i0.GeneratedColumn<String> userId = i0.GeneratedColumn<String>(
    'user_id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<i0.GeneratedColumn> get $columns => [spaceId, albumId, userId];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_album_hidden_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceAlbumHiddenEntityData> instance, {
    bool isInserting = false,
  }) {
    final context = i0.VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('space_id')) {
      context.handle(
        _spaceIdMeta,
        spaceId.isAcceptableOrUnknown(data['space_id']!, _spaceIdMeta),
      );
    } else if (isInserting) {
      context.missing(_spaceIdMeta);
    }
    if (data.containsKey('album_id')) {
      context.handle(
        _albumIdMeta,
        albumId.isAcceptableOrUnknown(data['album_id']!, _albumIdMeta),
      );
    } else if (isInserting) {
      context.missing(_albumIdMeta);
    }
    if (data.containsKey('user_id')) {
      context.handle(
        _userIdMeta,
        userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta),
      );
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    return context;
  }

  @override
  Set<i0.GeneratedColumn> get $primaryKey => {spaceId, albumId, userId};
  @override
  i1.SharedSpaceAlbumHiddenEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceAlbumHiddenEntityData(
      spaceId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}space_id'],
      )!,
      albumId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}album_id'],
      )!,
      userId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}user_id'],
      )!,
    );
  }

  @override
  $SharedSpaceAlbumHiddenEntityTable createAlias(String alias) {
    return $SharedSpaceAlbumHiddenEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceAlbumHiddenEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceAlbumHiddenEntityData> {
  final String spaceId;
  final String albumId;
  final String userId;
  const SharedSpaceAlbumHiddenEntityData({
    required this.spaceId,
    required this.albumId,
    required this.userId,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['space_id'] = i0.Variable<String>(spaceId);
    map['album_id'] = i0.Variable<String>(albumId);
    map['user_id'] = i0.Variable<String>(userId);
    return map;
  }

  factory SharedSpaceAlbumHiddenEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceAlbumHiddenEntityData(
      spaceId: serializer.fromJson<String>(json['spaceId']),
      albumId: serializer.fromJson<String>(json['albumId']),
      userId: serializer.fromJson<String>(json['userId']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'spaceId': serializer.toJson<String>(spaceId),
      'albumId': serializer.toJson<String>(albumId),
      'userId': serializer.toJson<String>(userId),
    };
  }

  i1.SharedSpaceAlbumHiddenEntityData copyWith({
    String? spaceId,
    String? albumId,
    String? userId,
  }) => i1.SharedSpaceAlbumHiddenEntityData(
    spaceId: spaceId ?? this.spaceId,
    albumId: albumId ?? this.albumId,
    userId: userId ?? this.userId,
  );
  SharedSpaceAlbumHiddenEntityData copyWithCompanion(
    i1.SharedSpaceAlbumHiddenEntityCompanion data,
  ) {
    return SharedSpaceAlbumHiddenEntityData(
      spaceId: data.spaceId.present ? data.spaceId.value : this.spaceId,
      albumId: data.albumId.present ? data.albumId.value : this.albumId,
      userId: data.userId.present ? data.userId.value : this.userId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumHiddenEntityData(')
          ..write('spaceId: $spaceId, ')
          ..write('albumId: $albumId, ')
          ..write('userId: $userId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(spaceId, albumId, userId);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceAlbumHiddenEntityData &&
          other.spaceId == this.spaceId &&
          other.albumId == this.albumId &&
          other.userId == this.userId);
}

class SharedSpaceAlbumHiddenEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceAlbumHiddenEntityData> {
  final i0.Value<String> spaceId;
  final i0.Value<String> albumId;
  final i0.Value<String> userId;
  const SharedSpaceAlbumHiddenEntityCompanion({
    this.spaceId = const i0.Value.absent(),
    this.albumId = const i0.Value.absent(),
    this.userId = const i0.Value.absent(),
  });
  SharedSpaceAlbumHiddenEntityCompanion.insert({
    required String spaceId,
    required String albumId,
    required String userId,
  }) : spaceId = i0.Value(spaceId),
       albumId = i0.Value(albumId),
       userId = i0.Value(userId);
  static i0.Insertable<i1.SharedSpaceAlbumHiddenEntityData> custom({
    i0.Expression<String>? spaceId,
    i0.Expression<String>? albumId,
    i0.Expression<String>? userId,
  }) {
    return i0.RawValuesInsertable({
      if (spaceId != null) 'space_id': spaceId,
      if (albumId != null) 'album_id': albumId,
      if (userId != null) 'user_id': userId,
    });
  }

  i1.SharedSpaceAlbumHiddenEntityCompanion copyWith({
    i0.Value<String>? spaceId,
    i0.Value<String>? albumId,
    i0.Value<String>? userId,
  }) {
    return i1.SharedSpaceAlbumHiddenEntityCompanion(
      spaceId: spaceId ?? this.spaceId,
      albumId: albumId ?? this.albumId,
      userId: userId ?? this.userId,
    );
  }

  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    if (spaceId.present) {
      map['space_id'] = i0.Variable<String>(spaceId.value);
    }
    if (albumId.present) {
      map['album_id'] = i0.Variable<String>(albumId.value);
    }
    if (userId.present) {
      map['user_id'] = i0.Variable<String>(userId.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumHiddenEntityCompanion(')
          ..write('spaceId: $spaceId, ')
          ..write('albumId: $albumId, ')
          ..write('userId: $userId')
          ..write(')'))
        .toString();
  }
}
