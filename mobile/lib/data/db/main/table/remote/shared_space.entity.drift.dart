// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.dart'
    as i2;
import 'package:drift/src/runtime/query_builder/query_builder.dart' as i3;
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart'
    as i4;
import 'package:drift/internal/modular.dart' as i5;

typedef $$SharedSpaceEntityTableCreateCompanionBuilder =
    i1.SharedSpaceEntityCompanion Function({
      required String id,
      required String name,
      i0.Value<String?> description,
      i0.Value<String?> color,
      required String createdById,
      i0.Value<String?> thumbnailAssetId,
      i0.Value<int?> thumbnailCropY,
      i0.Value<bool> faceRecognitionEnabled,
      i0.Value<bool> petsEnabled,
      i0.Value<DateTime?> lastActivityAt,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });
typedef $$SharedSpaceEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceEntityCompanion Function({
      i0.Value<String> id,
      i0.Value<String> name,
      i0.Value<String?> description,
      i0.Value<String?> color,
      i0.Value<String> createdById,
      i0.Value<String?> thumbnailAssetId,
      i0.Value<int?> thumbnailCropY,
      i0.Value<bool> faceRecognitionEnabled,
      i0.Value<bool> petsEnabled,
      i0.Value<DateTime?> lastActivityAt,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
    });

final class $$SharedSpaceEntityTableReferences
    extends
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceEntityTable,
          i1.SharedSpaceEntityData
        > {
  $$SharedSpaceEntityTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static i4.$UserEntityTable _createdByIdTable(i0.GeneratedDatabase db) =>
      i5.ReadDatabaseContainer(db)
          .resultSet<i4.$UserEntityTable>('user_entity')
          .createAlias(
            i0.$_aliasNameGenerator(
              i5.ReadDatabaseContainer(db)
                  .resultSet<i1.$SharedSpaceEntityTable>('shared_space_entity')
                  .createdById,
              i5.ReadDatabaseContainer(
                db,
              ).resultSet<i4.$UserEntityTable>('user_entity').id,
            ),
          );

  i4.$$UserEntityTableProcessedTableManager get createdById {
    final $_column = $_itemColumn<String>('created_by_id')!;

    final manager = i4
        .$$UserEntityTableTableManager(
          $_db,
          i5.ReadDatabaseContainer(
            $_db,
          ).resultSet<i4.$UserEntityTable>('user_entity'),
        )
        .filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_createdByIdTable($_db));
    if (item == null) return manager;
    return i0.ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$SharedSpaceEntityTableFilterComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceEntityTable> {
  $$SharedSpaceEntityTableFilterComposer({
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

  i0.ColumnFilters<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get color => $composableBuilder(
    column: $table.color,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<int> get thumbnailCropY => $composableBuilder(
    column: $table.thumbnailCropY,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<bool> get faceRecognitionEnabled => $composableBuilder(
    column: $table.faceRecognitionEnabled,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<bool> get petsEnabled => $composableBuilder(
    column: $table.petsEnabled,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
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

  i4.$$UserEntityTableFilterComposer get createdById {
    final i4.$$UserEntityTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.createdById,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i4.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i4.$$UserEntityTableFilterComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i4.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceEntityTableOrderingComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceEntityTable> {
  $$SharedSpaceEntityTableOrderingComposer({
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

  i0.ColumnOrderings<String> get name => $composableBuilder(
    column: $table.name,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get color => $composableBuilder(
    column: $table.color,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<int> get thumbnailCropY => $composableBuilder(
    column: $table.thumbnailCropY,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<bool> get faceRecognitionEnabled => $composableBuilder(
    column: $table.faceRecognitionEnabled,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<bool> get petsEnabled => $composableBuilder(
    column: $table.petsEnabled,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
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

  i4.$$UserEntityTableOrderingComposer get createdById {
    final i4.$$UserEntityTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.createdById,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i4.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i4.$$UserEntityTableOrderingComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i4.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceEntityTableAnnotationComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceEntityTable> {
  $$SharedSpaceEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get id =>
      $composableBuilder(column: $table.id, builder: (column) => column);

  i0.GeneratedColumn<String> get name =>
      $composableBuilder(column: $table.name, builder: (column) => column);

  i0.GeneratedColumn<String> get description => $composableBuilder(
    column: $table.description,
    builder: (column) => column,
  );

  i0.GeneratedColumn<String> get color =>
      $composableBuilder(column: $table.color, builder: (column) => column);

  i0.GeneratedColumn<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
    builder: (column) => column,
  );

  i0.GeneratedColumn<int> get thumbnailCropY => $composableBuilder(
    column: $table.thumbnailCropY,
    builder: (column) => column,
  );

  i0.GeneratedColumn<bool> get faceRecognitionEnabled => $composableBuilder(
    column: $table.faceRecognitionEnabled,
    builder: (column) => column,
  );

  i0.GeneratedColumn<bool> get petsEnabled => $composableBuilder(
    column: $table.petsEnabled,
    builder: (column) => column,
  );

  i0.GeneratedColumn<DateTime> get lastActivityAt => $composableBuilder(
    column: $table.lastActivityAt,
    builder: (column) => column,
  );

  i0.GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  i0.GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  i4.$$UserEntityTableAnnotationComposer get createdById {
    final i4.$$UserEntityTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.createdById,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i4.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i4.$$UserEntityTableAnnotationComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i4.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceEntityTable,
          i1.SharedSpaceEntityData,
          i1.$$SharedSpaceEntityTableFilterComposer,
          i1.$$SharedSpaceEntityTableOrderingComposer,
          i1.$$SharedSpaceEntityTableAnnotationComposer,
          $$SharedSpaceEntityTableCreateCompanionBuilder,
          $$SharedSpaceEntityTableUpdateCompanionBuilder,
          (i1.SharedSpaceEntityData, i1.$$SharedSpaceEntityTableReferences),
          i1.SharedSpaceEntityData,
          i0.PrefetchHooks Function({bool createdById})
        > {
  $$SharedSpaceEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceEntityTableFilterComposer($db: db, $table: table),
          createOrderingComposer: () => i1
              .$$SharedSpaceEntityTableOrderingComposer($db: db, $table: table),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> id = const i0.Value.absent(),
                i0.Value<String> name = const i0.Value.absent(),
                i0.Value<String?> description = const i0.Value.absent(),
                i0.Value<String?> color = const i0.Value.absent(),
                i0.Value<String> createdById = const i0.Value.absent(),
                i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
                i0.Value<int?> thumbnailCropY = const i0.Value.absent(),
                i0.Value<bool> faceRecognitionEnabled = const i0.Value.absent(),
                i0.Value<bool> petsEnabled = const i0.Value.absent(),
                i0.Value<DateTime?> lastActivityAt = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceEntityCompanion(
                id: id,
                name: name,
                description: description,
                color: color,
                createdById: createdById,
                thumbnailAssetId: thumbnailAssetId,
                thumbnailCropY: thumbnailCropY,
                faceRecognitionEnabled: faceRecognitionEnabled,
                petsEnabled: petsEnabled,
                lastActivityAt: lastActivityAt,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String name,
                i0.Value<String?> description = const i0.Value.absent(),
                i0.Value<String?> color = const i0.Value.absent(),
                required String createdById,
                i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
                i0.Value<int?> thumbnailCropY = const i0.Value.absent(),
                i0.Value<bool> faceRecognitionEnabled = const i0.Value.absent(),
                i0.Value<bool> petsEnabled = const i0.Value.absent(),
                i0.Value<DateTime?> lastActivityAt = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
              }) => i1.SharedSpaceEntityCompanion.insert(
                id: id,
                name: name,
                description: description,
                color: color,
                createdById: createdById,
                thumbnailAssetId: thumbnailAssetId,
                thumbnailCropY: thumbnailCropY,
                faceRecognitionEnabled: faceRecognitionEnabled,
                petsEnabled: petsEnabled,
                lastActivityAt: lastActivityAt,
                createdAt: createdAt,
                updatedAt: updatedAt,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  i1.$$SharedSpaceEntityTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({createdById = false}) {
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
                    if (createdById) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.createdById,
                                referencedTable: i1
                                    .$$SharedSpaceEntityTableReferences
                                    ._createdByIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceEntityTableReferences
                                    ._createdByIdTable(db)
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

typedef $$SharedSpaceEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceEntityTable,
      i1.SharedSpaceEntityData,
      i1.$$SharedSpaceEntityTableFilterComposer,
      i1.$$SharedSpaceEntityTableOrderingComposer,
      i1.$$SharedSpaceEntityTableAnnotationComposer,
      $$SharedSpaceEntityTableCreateCompanionBuilder,
      $$SharedSpaceEntityTableUpdateCompanionBuilder,
      (i1.SharedSpaceEntityData, i1.$$SharedSpaceEntityTableReferences),
      i1.SharedSpaceEntityData,
      i0.PrefetchHooks Function({bool createdById})
    >;
i0.Index get idxSharedSpaceCreatedById => i0.Index(
  'idx_shared_space_created_by_id',
  'CREATE INDEX IF NOT EXISTS idx_shared_space_created_by_id ON shared_space_entity (created_by_id)',
);

class $SharedSpaceEntityTable extends i2.SharedSpaceEntity
    with i0.TableInfo<$SharedSpaceEntityTable, i1.SharedSpaceEntityData> {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceEntityTable(this.attachedDatabase, [this._alias]);
  static const i0.VerificationMeta _idMeta = const i0.VerificationMeta('id');
  @override
  late final i0.GeneratedColumn<String> id = i0.GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
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
  static const i0.VerificationMeta _descriptionMeta = const i0.VerificationMeta(
    'description',
  );
  @override
  late final i0.GeneratedColumn<String> description =
      i0.GeneratedColumn<String>(
        'description',
        aliasedName,
        true,
        type: i0.DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const i0.VerificationMeta _colorMeta = const i0.VerificationMeta(
    'color',
  );
  @override
  late final i0.GeneratedColumn<String> color = i0.GeneratedColumn<String>(
    'color',
    aliasedName,
    true,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const i0.VerificationMeta _createdByIdMeta = const i0.VerificationMeta(
    'createdById',
  );
  @override
  late final i0.GeneratedColumn<String> createdById =
      i0.GeneratedColumn<String>(
        'created_by_id',
        aliasedName,
        false,
        type: i0.DriftSqlType.string,
        requiredDuringInsert: true,
        defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
          'REFERENCES user_entity (id) ON DELETE CASCADE',
        ),
      );
  static const i0.VerificationMeta _thumbnailAssetIdMeta =
      const i0.VerificationMeta('thumbnailAssetId');
  @override
  late final i0.GeneratedColumn<String> thumbnailAssetId =
      i0.GeneratedColumn<String>(
        'thumbnail_asset_id',
        aliasedName,
        true,
        type: i0.DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const i0.VerificationMeta _thumbnailCropYMeta =
      const i0.VerificationMeta('thumbnailCropY');
  @override
  late final i0.GeneratedColumn<int> thumbnailCropY = i0.GeneratedColumn<int>(
    'thumbnail_crop_y',
    aliasedName,
    true,
    type: i0.DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const i0.VerificationMeta _faceRecognitionEnabledMeta =
      const i0.VerificationMeta('faceRecognitionEnabled');
  @override
  late final i0.GeneratedColumn<bool> faceRecognitionEnabled =
      i0.GeneratedColumn<bool>(
        'face_recognition_enabled',
        aliasedName,
        false,
        type: i0.DriftSqlType.bool,
        requiredDuringInsert: false,
        defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
          'CHECK ("face_recognition_enabled" IN (0, 1))',
        ),
        defaultValue: const i3.Constant(true),
      );
  static const i0.VerificationMeta _petsEnabledMeta = const i0.VerificationMeta(
    'petsEnabled',
  );
  @override
  late final i0.GeneratedColumn<bool> petsEnabled = i0.GeneratedColumn<bool>(
    'pets_enabled',
    aliasedName,
    false,
    type: i0.DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
      'CHECK ("pets_enabled" IN (0, 1))',
    ),
    defaultValue: const i3.Constant(false),
  );
  static const i0.VerificationMeta _lastActivityAtMeta =
      const i0.VerificationMeta('lastActivityAt');
  @override
  late final i0.GeneratedColumn<DateTime> lastActivityAt =
      i0.GeneratedColumn<DateTime>(
        'last_activity_at',
        aliasedName,
        true,
        type: i0.DriftSqlType.dateTime,
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
    id,
    name,
    description,
    color,
    createdById,
    thumbnailAssetId,
    thumbnailCropY,
    faceRecognitionEnabled,
    petsEnabled,
    lastActivityAt,
    createdAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceEntityData> instance, {
    bool isInserting = false,
  }) {
    final context = i0.VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('description')) {
      context.handle(
        _descriptionMeta,
        description.isAcceptableOrUnknown(
          data['description']!,
          _descriptionMeta,
        ),
      );
    }
    if (data.containsKey('color')) {
      context.handle(
        _colorMeta,
        color.isAcceptableOrUnknown(data['color']!, _colorMeta),
      );
    }
    if (data.containsKey('created_by_id')) {
      context.handle(
        _createdByIdMeta,
        createdById.isAcceptableOrUnknown(
          data['created_by_id']!,
          _createdByIdMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_createdByIdMeta);
    }
    if (data.containsKey('thumbnail_asset_id')) {
      context.handle(
        _thumbnailAssetIdMeta,
        thumbnailAssetId.isAcceptableOrUnknown(
          data['thumbnail_asset_id']!,
          _thumbnailAssetIdMeta,
        ),
      );
    }
    if (data.containsKey('thumbnail_crop_y')) {
      context.handle(
        _thumbnailCropYMeta,
        thumbnailCropY.isAcceptableOrUnknown(
          data['thumbnail_crop_y']!,
          _thumbnailCropYMeta,
        ),
      );
    }
    if (data.containsKey('face_recognition_enabled')) {
      context.handle(
        _faceRecognitionEnabledMeta,
        faceRecognitionEnabled.isAcceptableOrUnknown(
          data['face_recognition_enabled']!,
          _faceRecognitionEnabledMeta,
        ),
      );
    }
    if (data.containsKey('pets_enabled')) {
      context.handle(
        _petsEnabledMeta,
        petsEnabled.isAcceptableOrUnknown(
          data['pets_enabled']!,
          _petsEnabledMeta,
        ),
      );
    }
    if (data.containsKey('last_activity_at')) {
      context.handle(
        _lastActivityAtMeta,
        lastActivityAt.isAcceptableOrUnknown(
          data['last_activity_at']!,
          _lastActivityAtMeta,
        ),
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
  Set<i0.GeneratedColumn> get $primaryKey => {id};
  @override
  i1.SharedSpaceEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceEntityData(
      id: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      description: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}description'],
      ),
      color: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}color'],
      ),
      createdById: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}created_by_id'],
      )!,
      thumbnailAssetId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}thumbnail_asset_id'],
      ),
      thumbnailCropY: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.int,
        data['${effectivePrefix}thumbnail_crop_y'],
      ),
      faceRecognitionEnabled: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.bool,
        data['${effectivePrefix}face_recognition_enabled'],
      )!,
      petsEnabled: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.bool,
        data['${effectivePrefix}pets_enabled'],
      )!,
      lastActivityAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}last_activity_at'],
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
  $SharedSpaceEntityTable createAlias(String alias) {
    return $SharedSpaceEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceEntityData> {
  final String id;
  final String name;
  final String? description;
  final String? color;
  final String createdById;
  final String? thumbnailAssetId;
  final int? thumbnailCropY;
  final bool faceRecognitionEnabled;
  final bool petsEnabled;
  final DateTime? lastActivityAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  const SharedSpaceEntityData({
    required this.id,
    required this.name,
    this.description,
    this.color,
    required this.createdById,
    this.thumbnailAssetId,
    this.thumbnailCropY,
    required this.faceRecognitionEnabled,
    required this.petsEnabled,
    this.lastActivityAt,
    required this.createdAt,
    required this.updatedAt,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['id'] = i0.Variable<String>(id);
    map['name'] = i0.Variable<String>(name);
    if (!nullToAbsent || description != null) {
      map['description'] = i0.Variable<String>(description);
    }
    if (!nullToAbsent || color != null) {
      map['color'] = i0.Variable<String>(color);
    }
    map['created_by_id'] = i0.Variable<String>(createdById);
    if (!nullToAbsent || thumbnailAssetId != null) {
      map['thumbnail_asset_id'] = i0.Variable<String>(thumbnailAssetId);
    }
    if (!nullToAbsent || thumbnailCropY != null) {
      map['thumbnail_crop_y'] = i0.Variable<int>(thumbnailCropY);
    }
    map['face_recognition_enabled'] = i0.Variable<bool>(faceRecognitionEnabled);
    map['pets_enabled'] = i0.Variable<bool>(petsEnabled);
    if (!nullToAbsent || lastActivityAt != null) {
      map['last_activity_at'] = i0.Variable<DateTime>(lastActivityAt);
    }
    map['created_at'] = i0.Variable<DateTime>(createdAt);
    map['updated_at'] = i0.Variable<DateTime>(updatedAt);
    return map;
  }

  factory SharedSpaceEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceEntityData(
      id: serializer.fromJson<String>(json['id']),
      name: serializer.fromJson<String>(json['name']),
      description: serializer.fromJson<String?>(json['description']),
      color: serializer.fromJson<String?>(json['color']),
      createdById: serializer.fromJson<String>(json['createdById']),
      thumbnailAssetId: serializer.fromJson<String?>(json['thumbnailAssetId']),
      thumbnailCropY: serializer.fromJson<int?>(json['thumbnailCropY']),
      faceRecognitionEnabled: serializer.fromJson<bool>(
        json['faceRecognitionEnabled'],
      ),
      petsEnabled: serializer.fromJson<bool>(json['petsEnabled']),
      lastActivityAt: serializer.fromJson<DateTime?>(json['lastActivityAt']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'name': serializer.toJson<String>(name),
      'description': serializer.toJson<String?>(description),
      'color': serializer.toJson<String?>(color),
      'createdById': serializer.toJson<String>(createdById),
      'thumbnailAssetId': serializer.toJson<String?>(thumbnailAssetId),
      'thumbnailCropY': serializer.toJson<int?>(thumbnailCropY),
      'faceRecognitionEnabled': serializer.toJson<bool>(faceRecognitionEnabled),
      'petsEnabled': serializer.toJson<bool>(petsEnabled),
      'lastActivityAt': serializer.toJson<DateTime?>(lastActivityAt),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  i1.SharedSpaceEntityData copyWith({
    String? id,
    String? name,
    i0.Value<String?> description = const i0.Value.absent(),
    i0.Value<String?> color = const i0.Value.absent(),
    String? createdById,
    i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
    i0.Value<int?> thumbnailCropY = const i0.Value.absent(),
    bool? faceRecognitionEnabled,
    bool? petsEnabled,
    i0.Value<DateTime?> lastActivityAt = const i0.Value.absent(),
    DateTime? createdAt,
    DateTime? updatedAt,
  }) => i1.SharedSpaceEntityData(
    id: id ?? this.id,
    name: name ?? this.name,
    description: description.present ? description.value : this.description,
    color: color.present ? color.value : this.color,
    createdById: createdById ?? this.createdById,
    thumbnailAssetId: thumbnailAssetId.present
        ? thumbnailAssetId.value
        : this.thumbnailAssetId,
    thumbnailCropY: thumbnailCropY.present
        ? thumbnailCropY.value
        : this.thumbnailCropY,
    faceRecognitionEnabled:
        faceRecognitionEnabled ?? this.faceRecognitionEnabled,
    petsEnabled: petsEnabled ?? this.petsEnabled,
    lastActivityAt: lastActivityAt.present
        ? lastActivityAt.value
        : this.lastActivityAt,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  SharedSpaceEntityData copyWithCompanion(i1.SharedSpaceEntityCompanion data) {
    return SharedSpaceEntityData(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      description: data.description.present
          ? data.description.value
          : this.description,
      color: data.color.present ? data.color.value : this.color,
      createdById: data.createdById.present
          ? data.createdById.value
          : this.createdById,
      thumbnailAssetId: data.thumbnailAssetId.present
          ? data.thumbnailAssetId.value
          : this.thumbnailAssetId,
      thumbnailCropY: data.thumbnailCropY.present
          ? data.thumbnailCropY.value
          : this.thumbnailCropY,
      faceRecognitionEnabled: data.faceRecognitionEnabled.present
          ? data.faceRecognitionEnabled.value
          : this.faceRecognitionEnabled,
      petsEnabled: data.petsEnabled.present
          ? data.petsEnabled.value
          : this.petsEnabled,
      lastActivityAt: data.lastActivityAt.present
          ? data.lastActivityAt.value
          : this.lastActivityAt,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceEntityData(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('description: $description, ')
          ..write('color: $color, ')
          ..write('createdById: $createdById, ')
          ..write('thumbnailAssetId: $thumbnailAssetId, ')
          ..write('thumbnailCropY: $thumbnailCropY, ')
          ..write('faceRecognitionEnabled: $faceRecognitionEnabled, ')
          ..write('petsEnabled: $petsEnabled, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    description,
    color,
    createdById,
    thumbnailAssetId,
    thumbnailCropY,
    faceRecognitionEnabled,
    petsEnabled,
    lastActivityAt,
    createdAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceEntityData &&
          other.id == this.id &&
          other.name == this.name &&
          other.description == this.description &&
          other.color == this.color &&
          other.createdById == this.createdById &&
          other.thumbnailAssetId == this.thumbnailAssetId &&
          other.thumbnailCropY == this.thumbnailCropY &&
          other.faceRecognitionEnabled == this.faceRecognitionEnabled &&
          other.petsEnabled == this.petsEnabled &&
          other.lastActivityAt == this.lastActivityAt &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt);
}

class SharedSpaceEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceEntityData> {
  final i0.Value<String> id;
  final i0.Value<String> name;
  final i0.Value<String?> description;
  final i0.Value<String?> color;
  final i0.Value<String> createdById;
  final i0.Value<String?> thumbnailAssetId;
  final i0.Value<int?> thumbnailCropY;
  final i0.Value<bool> faceRecognitionEnabled;
  final i0.Value<bool> petsEnabled;
  final i0.Value<DateTime?> lastActivityAt;
  final i0.Value<DateTime> createdAt;
  final i0.Value<DateTime> updatedAt;
  const SharedSpaceEntityCompanion({
    this.id = const i0.Value.absent(),
    this.name = const i0.Value.absent(),
    this.description = const i0.Value.absent(),
    this.color = const i0.Value.absent(),
    this.createdById = const i0.Value.absent(),
    this.thumbnailAssetId = const i0.Value.absent(),
    this.thumbnailCropY = const i0.Value.absent(),
    this.faceRecognitionEnabled = const i0.Value.absent(),
    this.petsEnabled = const i0.Value.absent(),
    this.lastActivityAt = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  });
  SharedSpaceEntityCompanion.insert({
    required String id,
    required String name,
    this.description = const i0.Value.absent(),
    this.color = const i0.Value.absent(),
    required String createdById,
    this.thumbnailAssetId = const i0.Value.absent(),
    this.thumbnailCropY = const i0.Value.absent(),
    this.faceRecognitionEnabled = const i0.Value.absent(),
    this.petsEnabled = const i0.Value.absent(),
    this.lastActivityAt = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
  }) : id = i0.Value(id),
       name = i0.Value(name),
       createdById = i0.Value(createdById);
  static i0.Insertable<i1.SharedSpaceEntityData> custom({
    i0.Expression<String>? id,
    i0.Expression<String>? name,
    i0.Expression<String>? description,
    i0.Expression<String>? color,
    i0.Expression<String>? createdById,
    i0.Expression<String>? thumbnailAssetId,
    i0.Expression<int>? thumbnailCropY,
    i0.Expression<bool>? faceRecognitionEnabled,
    i0.Expression<bool>? petsEnabled,
    i0.Expression<DateTime>? lastActivityAt,
    i0.Expression<DateTime>? createdAt,
    i0.Expression<DateTime>? updatedAt,
  }) {
    return i0.RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (description != null) 'description': description,
      if (color != null) 'color': color,
      if (createdById != null) 'created_by_id': createdById,
      if (thumbnailAssetId != null) 'thumbnail_asset_id': thumbnailAssetId,
      if (thumbnailCropY != null) 'thumbnail_crop_y': thumbnailCropY,
      if (faceRecognitionEnabled != null)
        'face_recognition_enabled': faceRecognitionEnabled,
      if (petsEnabled != null) 'pets_enabled': petsEnabled,
      if (lastActivityAt != null) 'last_activity_at': lastActivityAt,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
    });
  }

  i1.SharedSpaceEntityCompanion copyWith({
    i0.Value<String>? id,
    i0.Value<String>? name,
    i0.Value<String?>? description,
    i0.Value<String?>? color,
    i0.Value<String>? createdById,
    i0.Value<String?>? thumbnailAssetId,
    i0.Value<int?>? thumbnailCropY,
    i0.Value<bool>? faceRecognitionEnabled,
    i0.Value<bool>? petsEnabled,
    i0.Value<DateTime?>? lastActivityAt,
    i0.Value<DateTime>? createdAt,
    i0.Value<DateTime>? updatedAt,
  }) {
    return i1.SharedSpaceEntityCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      color: color ?? this.color,
      createdById: createdById ?? this.createdById,
      thumbnailAssetId: thumbnailAssetId ?? this.thumbnailAssetId,
      thumbnailCropY: thumbnailCropY ?? this.thumbnailCropY,
      faceRecognitionEnabled:
          faceRecognitionEnabled ?? this.faceRecognitionEnabled,
      petsEnabled: petsEnabled ?? this.petsEnabled,
      lastActivityAt: lastActivityAt ?? this.lastActivityAt,
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
    if (name.present) {
      map['name'] = i0.Variable<String>(name.value);
    }
    if (description.present) {
      map['description'] = i0.Variable<String>(description.value);
    }
    if (color.present) {
      map['color'] = i0.Variable<String>(color.value);
    }
    if (createdById.present) {
      map['created_by_id'] = i0.Variable<String>(createdById.value);
    }
    if (thumbnailAssetId.present) {
      map['thumbnail_asset_id'] = i0.Variable<String>(thumbnailAssetId.value);
    }
    if (thumbnailCropY.present) {
      map['thumbnail_crop_y'] = i0.Variable<int>(thumbnailCropY.value);
    }
    if (faceRecognitionEnabled.present) {
      map['face_recognition_enabled'] = i0.Variable<bool>(
        faceRecognitionEnabled.value,
      );
    }
    if (petsEnabled.present) {
      map['pets_enabled'] = i0.Variable<bool>(petsEnabled.value);
    }
    if (lastActivityAt.present) {
      map['last_activity_at'] = i0.Variable<DateTime>(lastActivityAt.value);
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
    return (StringBuffer('SharedSpaceEntityCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('description: $description, ')
          ..write('color: $color, ')
          ..write('createdById: $createdById, ')
          ..write('thumbnailAssetId: $thumbnailAssetId, ')
          ..write('thumbnailCropY: $thumbnailCropY, ')
          ..write('faceRecognitionEnabled: $faceRecognitionEnabled, ')
          ..write('petsEnabled: $petsEnabled, ')
          ..write('lastActivityAt: $lastActivityAt, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }
}
