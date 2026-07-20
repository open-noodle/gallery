// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.dart'
    as i2;
import 'package:drift/src/runtime/query_builder/query_builder.dart' as i3;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i4;
import 'package:drift/internal/modular.dart' as i5;

typedef $$SharedSpaceAlbumLinkEntityTableCreateCompanionBuilder =
    i1.SharedSpaceAlbumLinkEntityCompanion Function({
      required String spaceId,
      required String albumId,
      i0.Value<bool> showInTimeline,
      i0.Value<String?> addedById,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });
typedef $$SharedSpaceAlbumLinkEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceAlbumLinkEntityCompanion Function({
      i0.Value<String> spaceId,
      i0.Value<String> albumId,
      i0.Value<bool> showInTimeline,
      i0.Value<String?> addedById,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });

final class $$SharedSpaceAlbumLinkEntityTableReferences
    extends
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumLinkEntityTable,
          i1.SharedSpaceAlbumLinkEntityData
        > {
  $$SharedSpaceAlbumLinkEntityTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static i4.$SharedSpaceEntityTable _spaceIdTable(i0.GeneratedDatabase db) =>
      i5.ReadDatabaseContainer(db)
          .resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity')
          .createAlias(
            'shared_space_album_link_entity__space_id__shared_space_entity__id',
          );

  i4.$$SharedSpaceEntityTableProcessedTableManager get spaceId {
    final $_column = $_itemColumn<String>('space_id')!;

    final manager = i4
        .$$SharedSpaceEntityTableTableManager(
          $_db,
          i5.ReadDatabaseContainer(
            $_db,
          ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
        )
        .filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_spaceIdTable($_db));
    if (item == null) return manager;
    return i0.ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$SharedSpaceAlbumLinkEntityTableFilterComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumLinkEntityTable> {
  $$SharedSpaceAlbumLinkEntityTableFilterComposer({
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

  i0.ColumnFilters<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get addedById => $composableBuilder(
    column: $table.addedById,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => i0.ColumnFilters(column),
  );

  i4.$$SharedSpaceEntityTableFilterComposer get spaceId {
    final i4.$$SharedSpaceEntityTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.spaceId,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i4.$$SharedSpaceEntityTableFilterComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceAlbumLinkEntityTableOrderingComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumLinkEntityTable> {
  $$SharedSpaceAlbumLinkEntityTableOrderingComposer({
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

  i0.ColumnOrderings<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get addedById => $composableBuilder(
    column: $table.addedById,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<DateTime> get createdAt => $composableBuilder(
    column: $table.createdAt,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<DateTime> get updatedAt => $composableBuilder(
    column: $table.updatedAt,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i4.$$SharedSpaceEntityTableOrderingComposer get spaceId {
    final i4.$$SharedSpaceEntityTableOrderingComposer composer =
        $composerBuilder(
          composer: this,
          getCurrentColumn: (t) => t.spaceId,
          referencedTable: i5.ReadDatabaseContainer(
            $db,
          ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
          getReferencedColumn: (t) => t.id,
          builder:
              (
                joinBuilder, {
                $addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer,
              }) => i4.$$SharedSpaceEntityTableOrderingComposer(
                $db: $db,
                $table: i5.ReadDatabaseContainer(
                  $db,
                ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
                $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                joinBuilder: joinBuilder,
                $removeJoinBuilderFromRootComposer:
                    $removeJoinBuilderFromRootComposer,
              ),
        );
    return composer;
  }
}

class $$SharedSpaceAlbumLinkEntityTableAnnotationComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumLinkEntityTable> {
  $$SharedSpaceAlbumLinkEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get albumId =>
      $composableBuilder(column: $table.albumId, builder: (column) => column);

  i0.GeneratedColumn<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
    builder: (column) => column,
  );

  i0.GeneratedColumn<String> get addedById =>
      $composableBuilder(column: $table.addedById, builder: (column) => column);

  i0.GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  i0.GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  i4.$$SharedSpaceEntityTableAnnotationComposer get spaceId {
    final i4.$$SharedSpaceEntityTableAnnotationComposer composer =
        $composerBuilder(
          composer: this,
          getCurrentColumn: (t) => t.spaceId,
          referencedTable: i5.ReadDatabaseContainer(
            $db,
          ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
          getReferencedColumn: (t) => t.id,
          builder:
              (
                joinBuilder, {
                $addJoinBuilderToRootComposer,
                $removeJoinBuilderFromRootComposer,
              }) => i4.$$SharedSpaceEntityTableAnnotationComposer(
                $db: $db,
                $table: i5.ReadDatabaseContainer(
                  $db,
                ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity'),
                $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
                joinBuilder: joinBuilder,
                $removeJoinBuilderFromRootComposer:
                    $removeJoinBuilderFromRootComposer,
              ),
        );
    return composer;
  }
}

class $$SharedSpaceAlbumLinkEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumLinkEntityTable,
          i1.SharedSpaceAlbumLinkEntityData,
          i1.$$SharedSpaceAlbumLinkEntityTableFilterComposer,
          i1.$$SharedSpaceAlbumLinkEntityTableOrderingComposer,
          i1.$$SharedSpaceAlbumLinkEntityTableAnnotationComposer,
          $$SharedSpaceAlbumLinkEntityTableCreateCompanionBuilder,
          $$SharedSpaceAlbumLinkEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceAlbumLinkEntityData,
            i1.$$SharedSpaceAlbumLinkEntityTableReferences,
          ),
          i1.SharedSpaceAlbumLinkEntityData,
          i0.PrefetchHooks Function({bool spaceId})
        > {
  $$SharedSpaceAlbumLinkEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceAlbumLinkEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceAlbumLinkEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceAlbumLinkEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceAlbumLinkEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> spaceId = const i0.Value.absent(),
                i0.Value<String> albumId = const i0.Value.absent(),
                i0.Value<bool> showInTimeline = const i0.Value.absent(),
                i0.Value<String?> addedById = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumLinkEntityCompanion(
                spaceId: spaceId,
                albumId: albumId,
                showInTimeline: showInTimeline,
                addedById: addedById,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          createCompanionCallback:
              ({
                required String spaceId,
                required String albumId,
                i0.Value<bool> showInTimeline = const i0.Value.absent(),
                i0.Value<String?> addedById = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumLinkEntityCompanion.insert(
                spaceId: spaceId,
                albumId: albumId,
                showInTimeline: showInTimeline,
                addedById: addedById,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  i1.$$SharedSpaceAlbumLinkEntityTableReferences(db, table, e),
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
                                    .$$SharedSpaceAlbumLinkEntityTableReferences
                                    ._spaceIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceAlbumLinkEntityTableReferences
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

typedef $$SharedSpaceAlbumLinkEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceAlbumLinkEntityTable,
      i1.SharedSpaceAlbumLinkEntityData,
      i1.$$SharedSpaceAlbumLinkEntityTableFilterComposer,
      i1.$$SharedSpaceAlbumLinkEntityTableOrderingComposer,
      i1.$$SharedSpaceAlbumLinkEntityTableAnnotationComposer,
      $$SharedSpaceAlbumLinkEntityTableCreateCompanionBuilder,
      $$SharedSpaceAlbumLinkEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceAlbumLinkEntityData,
        i1.$$SharedSpaceAlbumLinkEntityTableReferences,
      ),
      i1.SharedSpaceAlbumLinkEntityData,
      i0.PrefetchHooks Function({bool spaceId})
    >;
i0.Index get idxSharedSpaceAlbumLinkSpace => i0.Index(
  'idx_shared_space_album_link_space',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_space ON shared_space_album_link_entity (space_id)',
);

class $SharedSpaceAlbumLinkEntityTable extends i2.SharedSpaceAlbumLinkEntity
    with
        i0.TableInfo<
          $SharedSpaceAlbumLinkEntityTable,
          i1.SharedSpaceAlbumLinkEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceAlbumLinkEntityTable(this.attachedDatabase, [this._alias]);
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
  static const i0.VerificationMeta _showInTimelineMeta =
      const i0.VerificationMeta('showInTimeline');
  @override
  late final i0.GeneratedColumn<bool> showInTimeline = i0.GeneratedColumn<bool>(
    'show_in_timeline',
    aliasedName,
    false,
    type: i0.DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
      'CHECK ("show_in_timeline" IN (0, 1))',
    ),
    defaultValue: const i3.Constant(true),
  );
  static const i0.VerificationMeta _addedByIdMeta = const i0.VerificationMeta(
    'addedById',
  );
  @override
  late final i0.GeneratedColumn<String> addedById = i0.GeneratedColumn<String>(
    'added_by_id',
    aliasedName,
    true,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const i0.VerificationMeta _createdAtMeta = const i0.VerificationMeta(
    'createdAt',
  );
  @override
  late final i0.GeneratedColumn<DateTime> createdAt =
      i0.GeneratedColumn<DateTime>(
        'created_at',
        aliasedName,
        false,
        type: i0.DriftSqlType.dateTime,
        requiredDuringInsert: false,
        defaultValue: i3.currentDateAndTime,
      );
  static const i0.VerificationMeta _updatedAtMeta = const i0.VerificationMeta(
    'updatedAt',
  );
  @override
  late final i0.GeneratedColumn<DateTime> updatedAt =
      i0.GeneratedColumn<DateTime>(
        'updated_at',
        aliasedName,
        false,
        type: i0.DriftSqlType.dateTime,
        requiredDuringInsert: false,
        defaultValue: i3.currentDateAndTime,
      );
  @override
  List<i0.GeneratedColumn> get $columns => [
    spaceId,
    albumId,
    showInTimeline,
    addedById,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_album_link_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceAlbumLinkEntityData> instance, {
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
    if (data.containsKey('show_in_timeline')) {
      context.handle(
        _showInTimelineMeta,
        showInTimeline.isAcceptableOrUnknown(
          data['show_in_timeline']!,
          _showInTimelineMeta,
        ),
      );
    }
    if (data.containsKey('added_by_id')) {
      context.handle(
        _addedByIdMeta,
        addedById.isAcceptableOrUnknown(data['added_by_id']!, _addedByIdMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    }
    return context;
  }

  @override
  Set<i0.GeneratedColumn> get $primaryKey => {spaceId, albumId};
  @override
  i1.SharedSpaceAlbumLinkEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceAlbumLinkEntityData(
      spaceId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}space_id'],
      )!,
      albumId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}album_id'],
      )!,
      showInTimeline: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.bool,
        data['${effectivePrefix}show_in_timeline'],
      )!,
      addedById: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}added_by_id'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $SharedSpaceAlbumLinkEntityTable createAlias(String alias) {
    return $SharedSpaceAlbumLinkEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceAlbumLinkEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceAlbumLinkEntityData> {
  final String spaceId;
  final String albumId;
  final bool showInTimeline;
  final String? addedById;
  final DateTime createdAt;
  final DateTime updatedAt;
  const SharedSpaceAlbumLinkEntityData({
    required this.spaceId,
    required this.albumId,
    required this.showInTimeline,
    this.addedById,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['space_id'] = i0.Variable<String>(spaceId);
    map['album_id'] = i0.Variable<String>(albumId);
    map['show_in_timeline'] = i0.Variable<bool>(showInTimeline);
    if (!nullToAbsent || addedById != null) {
      map['added_by_id'] = i0.Variable<String>(addedById);
    }
    map['created_at'] = i0.Variable<DateTime>(createdAt);
    map['updated_at'] = i0.Variable<DateTime>(updatedAt);
    return map;
  }

  factory SharedSpaceAlbumLinkEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceAlbumLinkEntityData(
      spaceId: serializer.fromJson<String>(json['spaceId']),
      albumId: serializer.fromJson<String>(json['albumId']),
      showInTimeline: serializer.fromJson<bool>(json['showInTimeline']),
      addedById: serializer.fromJson<String?>(json['addedById']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'spaceId': serializer.toJson<String>(spaceId),
      'albumId': serializer.toJson<String>(albumId),
      'showInTimeline': serializer.toJson<bool>(showInTimeline),
      'addedById': serializer.toJson<String?>(addedById),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  i1.SharedSpaceAlbumLinkEntityData copyWith({
    String? spaceId,
    String? albumId,
    bool? showInTimeline,
    i0.Value<String?> addedById = const i0.Value.absent(),
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => i1.SharedSpaceAlbumLinkEntityData(
    spaceId: spaceId ?? this.spaceId,
    albumId: albumId ?? this.albumId,
    showInTimeline: showInTimeline ?? this.showInTimeline,
    addedById: addedById.present ? addedById.value : this.addedById,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  SharedSpaceAlbumLinkEntityData copyWithCompanion(
    i1.SharedSpaceAlbumLinkEntityCompanion data,
  ) {
    return SharedSpaceAlbumLinkEntityData(
      spaceId: data.spaceId.present ? data.spaceId.value : this.spaceId,
      albumId: data.albumId.present ? data.albumId.value : this.albumId,
      showInTimeline: data.showInTimeline.present
          ? data.showInTimeline.value
          : this.showInTimeline,
      addedById: data.addedById.present ? data.addedById.value : this.addedById,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumLinkEntityData(')
          ..write('spaceId: $spaceId, ')
          ..write('albumId: $albumId, ')
          ..write('showInTimeline: $showInTimeline, ')
          ..write('addedById: $addedById, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    spaceId,
    albumId,
    showInTimeline,
    addedById,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceAlbumLinkEntityData &&
          other.spaceId == this.spaceId &&
          other.albumId == this.albumId &&
          other.showInTimeline == this.showInTimeline &&
          other.addedById == this.addedById &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class SharedSpaceAlbumLinkEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceAlbumLinkEntityData> {
  final i0.Value<String> spaceId;
  final i0.Value<String> albumId;
  final i0.Value<bool> showInTimeline;
  final i0.Value<String?> addedById;
  final i0.Value<DateTime> createdAt;
  final i0.Value<DateTime> updatedAt;
  const SharedSpaceAlbumLinkEntityCompanion({
    this.spaceId = const i0.Value.absent(),
    this.albumId = const i0.Value.absent(),
    this.showInTimeline = const i0.Value.absent(),
    this.addedById = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  });
  SharedSpaceAlbumLinkEntityCompanion.insert({
    required String spaceId,
    required String albumId,
    this.showInTimeline = const i0.Value.absent(),
    this.addedById = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  }) : spaceId = i0.Value(spaceId),
       albumId = i0.Value(albumId);
  static i0.Insertable<i1.SharedSpaceAlbumLinkEntityData> custom({
    i0.Expression<String>? spaceId,
    i0.Expression<String>? albumId,
    i0.Expression<bool>? showInTimeline,
    i0.Expression<String>? addedById,
    i0.Expression<DateTime>? createdAt,
    i0.Expression<DateTime>? updatedAt,
  }) {
    return i0.RawValuesInsertable({
      if (spaceId != null) 'space_id': spaceId,
      if (albumId != null) 'album_id': albumId,
      if (showInTimeline != null) 'show_in_timeline': showInTimeline,
      if (addedById != null) 'added_by_id': addedById,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
    });
  }

  i1.SharedSpaceAlbumLinkEntityCompanion copyWith({
    i0.Value<String>? spaceId,
    i0.Value<String>? albumId,
    i0.Value<bool>? showInTimeline,
    i0.Value<String?>? addedById,
    i0.Value<DateTime>? createdAt,
    i0.Value<DateTime>? updatedAt,
  }) {
    return i1.SharedSpaceAlbumLinkEntityCompanion(
      spaceId: spaceId ?? this.spaceId,
      albumId: albumId ?? this.albumId,
      showInTimeline: showInTimeline ?? this.showInTimeline,
      addedById: addedById ?? this.addedById,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
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
    if (showInTimeline.present) {
      map['show_in_timeline'] = i0.Variable<bool>(showInTimeline.value);
    }
    if (addedById.present) {
      map['added_by_id'] = i0.Variable<String>(addedById.value);
    }
    if (createdAt.present) {
      map['created_at'] = i0.Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = i0.Variable<DateTime>(updatedAt.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumLinkEntityCompanion(')
          ..write('spaceId: $spaceId, ')
          ..write('albumId: $albumId, ')
          ..write('showInTimeline: $showInTimeline, ')
          ..write('addedById: $addedById, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }
}

i0.Index get idxSharedSpaceAlbumLinkAlbumSpace => i0.Index(
  'idx_shared_space_album_link_album_space',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_link_album_space ON shared_space_album_link_entity (album_id, space_id)',
);
