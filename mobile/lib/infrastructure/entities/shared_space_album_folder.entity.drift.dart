// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_folder.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_folder.entity.dart'
    as i2;
import 'package:drift/src/runtime/query_builder/query_builder.dart' as i3;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i4;
import 'package:drift/internal/modular.dart' as i5;

typedef $$SharedSpaceAlbumFolderEntityTableCreateCompanionBuilder =
    i1.SharedSpaceAlbumFolderEntityCompanion Function({
      required String id,
      required String spaceId,
      i0.Value<String?> parentId,
      required String name,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });
typedef $$SharedSpaceAlbumFolderEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceAlbumFolderEntityCompanion Function({
      i0.Value<String> id,
      i0.Value<String> spaceId,
      i0.Value<String?> parentId,
      i0.Value<String> name,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });

final class $$SharedSpaceAlbumFolderEntityTableReferences
    extends
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumFolderEntityTable,
          i1.SharedSpaceAlbumFolderEntityData
        > {
  $$SharedSpaceAlbumFolderEntityTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static i4.$SharedSpaceEntityTable _spaceIdTable(
    i0.GeneratedDatabase db,
  ) => i5.ReadDatabaseContainer(db)
      .resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity')
      .createAlias(
        'shared_space_album_folder_entity__space_id__shared_space_entity__id',
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

class $$SharedSpaceAlbumFolderEntityTableFilterComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumFolderEntityTable
        > {
  $$SharedSpaceAlbumFolderEntityTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnFilters<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get parentId => $composableBuilder(
    column: $table.parentId,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
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

class $$SharedSpaceAlbumFolderEntityTableOrderingComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumFolderEntityTable
        > {
  $$SharedSpaceAlbumFolderEntityTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnOrderings<String> get id => $composableBuilder(
    column: $table.id,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get parentId => $composableBuilder(
    column: $table.parentId,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
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

class $$SharedSpaceAlbumFolderEntityTableAnnotationComposer
    extends
        i0.Composer<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumFolderEntityTable
        > {
  $$SharedSpaceAlbumFolderEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  i0.GeneratedColumn<String> get parentId =>
      $composableBuilder(column: $table.parentId, builder: (column) => column);

  i0.GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

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

class $$SharedSpaceAlbumFolderEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumFolderEntityTable,
          i1.SharedSpaceAlbumFolderEntityData,
          i1.$$SharedSpaceAlbumFolderEntityTableFilterComposer,
          i1.$$SharedSpaceAlbumFolderEntityTableOrderingComposer,
          i1.$$SharedSpaceAlbumFolderEntityTableAnnotationComposer,
          $$SharedSpaceAlbumFolderEntityTableCreateCompanionBuilder,
          $$SharedSpaceAlbumFolderEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceAlbumFolderEntityData,
            i1.$$SharedSpaceAlbumFolderEntityTableReferences,
          ),
          i1.SharedSpaceAlbumFolderEntityData,
          i0.PrefetchHooks Function({bool spaceId})
        > {
  $$SharedSpaceAlbumFolderEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceAlbumFolderEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceAlbumFolderEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceAlbumFolderEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceAlbumFolderEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> id = const i0.Value.absent(),
                i0.Value<String> spaceId = const i0.Value.absent(),
                i0.Value<String?> parentId = const i0.Value.absent(),
                i0.Value<String> name = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumFolderEntityCompanion(
                id: id,
                spaceId: spaceId,
                parentId: parentId,
                name: name,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String spaceId,
                i0.Value<String?> parentId = const i0.Value.absent(),
                required String name,
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumFolderEntityCompanion.insert(
                id: id,
                spaceId: spaceId,
                parentId: parentId,
                name: name,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  i1.$$SharedSpaceAlbumFolderEntityTableReferences(
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
                                    .$$SharedSpaceAlbumFolderEntityTableReferences
                                    ._spaceIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceAlbumFolderEntityTableReferences
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

typedef $$SharedSpaceAlbumFolderEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceAlbumFolderEntityTable,
      i1.SharedSpaceAlbumFolderEntityData,
      i1.$$SharedSpaceAlbumFolderEntityTableFilterComposer,
      i1.$$SharedSpaceAlbumFolderEntityTableOrderingComposer,
      i1.$$SharedSpaceAlbumFolderEntityTableAnnotationComposer,
      $$SharedSpaceAlbumFolderEntityTableCreateCompanionBuilder,
      $$SharedSpaceAlbumFolderEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceAlbumFolderEntityData,
        i1.$$SharedSpaceAlbumFolderEntityTableReferences,
      ),
      i1.SharedSpaceAlbumFolderEntityData,
      i0.PrefetchHooks Function({bool spaceId})
    >;
i0.Index get idxSharedSpaceAlbumFolderSpace => i0.Index(
  'idx_shared_space_album_folder_space',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_album_folder_space ON shared_space_album_folder_entity (space_id)',
);

class $SharedSpaceAlbumFolderEntityTable extends i2.SharedSpaceAlbumFolderEntity
    with
        i0.TableInfo<
          $SharedSpaceAlbumFolderEntityTable,
          i1.SharedSpaceAlbumFolderEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceAlbumFolderEntityTable(this.attachedDatabase, [this._alias]);
  static const i0.VerificationMeta _idMeta = const i0.VerificationMeta('id');
  @override
  late final i0.GeneratedColumn<String> id = i0.GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
  );
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
  static const i0.VerificationMeta _parentIdMeta = const i0.VerificationMeta(
    'parentId',
  );
  @override
  late final i0.GeneratedColumn<String> parentId = i0.GeneratedColumn<String>(
    'parent_id',
    aliasedName,
    true,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const i0.VerificationMeta _nameMeta = const i0.VerificationMeta(
    'name',
  );
  @override
  late final i0.GeneratedColumn<String> name = i0.GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
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
    id,
    spaceId,
    parentId,
    name,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_album_folder_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceAlbumFolderEntityData> instance, {
    bool isInserting = false,
  }) {
    final context = i0.VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('space_id')) {
      context.handle(
        _spaceIdMeta,
        spaceId.isAcceptableOrUnknown(data['space_id']!, _spaceIdMeta),
      );
    } else if (isInserting) {
      context.missing(_spaceIdMeta);
    }
    if (data.containsKey('parent_id')) {
      context.handle(
        _parentIdMeta,
        parentId.isAcceptableOrUnknown(data['parent_id']!, _parentIdMeta),
      );
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
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
  Set<i0.GeneratedColumn> get $primaryKey => {id};
  @override
  i1.SharedSpaceAlbumFolderEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceAlbumFolderEntityData(
      id: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      spaceId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}space_id'],
      )!,
      parentId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}parent_id'],
      ),
      name: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
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
  $SharedSpaceAlbumFolderEntityTable createAlias(String alias) {
    return $SharedSpaceAlbumFolderEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceAlbumFolderEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceAlbumFolderEntityData> {
  final String id;
  final String spaceId;
  final String? parentId;
  final String name;
  final DateTime createdAt;
  final DateTime updatedAt;
  const SharedSpaceAlbumFolderEntityData({
    required this.id,
    required this.spaceId,
    this.parentId,
    required this.name,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['id'] = i0.Variable<String>(id);
    map['space_id'] = i0.Variable<String>(spaceId);
    if (!nullToAbsent || parentId != null) {
      map['parent_id'] = i0.Variable<String>(parentId);
    }
    map['name'] = i0.Variable<String>(name);
    map['created_at'] = i0.Variable<DateTime>(createdAt);
    map['updated_at'] = i0.Variable<DateTime>(updatedAt);
    return map;
  }

  factory SharedSpaceAlbumFolderEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceAlbumFolderEntityData(
      id: serializer.fromJson<String>(json['id']),
      spaceId: serializer.fromJson<String>(json['spaceId']),
      parentId: serializer.fromJson<String?>(json['parentId']),
      name: serializer.fromJson<String>(json['name']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'spaceId': serializer.toJson<String>(spaceId),
      'parentId': serializer.toJson<String?>(parentId),
      'name': serializer.toJson<String>(name),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  i1.SharedSpaceAlbumFolderEntityData copyWith({
    String? id,
    String? spaceId,
    i0.Value<String?> parentId = const i0.Value.absent(),
    String? name,
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => i1.SharedSpaceAlbumFolderEntityData(
    id: id ?? this.id,
    spaceId: spaceId ?? this.spaceId,
    parentId: parentId.present ? parentId.value : this.parentId,
    name: name ?? this.name,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  SharedSpaceAlbumFolderEntityData copyWithCompanion(
    i1.SharedSpaceAlbumFolderEntityCompanion data,
  ) {
    return SharedSpaceAlbumFolderEntityData(
      id: data.id.present ? data.id.value : this.id,
      spaceId: data.spaceId.present ? data.spaceId.value : this.spaceId,
      parentId: data.parentId.present ? data.parentId.value : this.parentId,
      name: data.name.present ? data.name.value : this.name,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumFolderEntityData(')
          ..write('id: $id, ')
          ..write('spaceId: $spaceId, ')
          ..write('parentId: $parentId, ')
          ..write('name: $name, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(id, spaceId, parentId, name, createdAt, updatedAt);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceAlbumFolderEntityData &&
          other.id == this.id &&
          other.spaceId == this.spaceId &&
          other.parentId == this.parentId &&
          other.name == this.name &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class SharedSpaceAlbumFolderEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceAlbumFolderEntityData> {
  final i0.Value<String> id;
  final i0.Value<String> spaceId;
  final i0.Value<String?> parentId;
  final i0.Value<String> name;
  final i0.Value<DateTime> createdAt;
  final i0.Value<DateTime> updatedAt;
  const SharedSpaceAlbumFolderEntityCompanion({
    this.id = const i0.Value.absent(),
    this.spaceId = const i0.Value.absent(),
    this.parentId = const i0.Value.absent(),
    this.name = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  });
  SharedSpaceAlbumFolderEntityCompanion.insert({
    required String id,
    required String spaceId,
    this.parentId = const i0.Value.absent(),
    required String name,
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  }) : id = i0.Value(id),
       spaceId = i0.Value(spaceId),
       name = i0.Value(name);
  static i0.Insertable<i1.SharedSpaceAlbumFolderEntityData> custom({
    i0.Expression<String>? id,
    i0.Expression<String>? spaceId,
    i0.Expression<String>? parentId,
    i0.Expression<String>? name,
    i0.Expression<DateTime>? createdAt,
    i0.Expression<DateTime>? updatedAt,
  }) {
    return i0.RawValuesInsertable({
      if (id != null) 'id': id,
      if (spaceId != null) 'space_id': spaceId,
      if (parentId != null) 'parent_id': parentId,
      if (name != null) 'name': name,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
    });
  }

  i1.SharedSpaceAlbumFolderEntityCompanion copyWith({
    i0.Value<String>? id,
    i0.Value<String>? spaceId,
    i0.Value<String?>? parentId,
    i0.Value<String>? name,
    i0.Value<DateTime>? createdAt,
    i0.Value<DateTime>? updatedAt,
  }) {
    return i1.SharedSpaceAlbumFolderEntityCompanion(
      id: id ?? this.id,
      spaceId: spaceId ?? this.spaceId,
      parentId: parentId ?? this.parentId,
      name: name ?? this.name,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }

  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    if (id.present) {
      map['id'] = i0.Variable<String>(id.value);
    }
    if (spaceId.present) {
      map['space_id'] = i0.Variable<String>(spaceId.value);
    }
    if (parentId.present) {
      map['parent_id'] = i0.Variable<String>(parentId.value);
    }
    if (name.present) {
      map['name'] = i0.Variable<String>(name.value);
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
    return (StringBuffer('SharedSpaceAlbumFolderEntityCompanion(')
          ..write('id: $id, ')
          ..write('spaceId: $spaceId, ')
          ..write('parentId: $parentId, ')
          ..write('name: $name, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }
}
