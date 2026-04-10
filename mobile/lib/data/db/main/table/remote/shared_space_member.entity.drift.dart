// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.dart'
    as i2;
import 'package:drift/src/runtime/query_builder/query_builder.dart' as i3;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i4;
import 'package:drift/internal/modular.dart' as i5;
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart'
    as i6;

typedef $$SharedSpaceMemberEntityTableCreateCompanionBuilder =
    i1.SharedSpaceMemberEntityCompanion Function({
      required String spaceId,
      required String userId,
      required String role,
      i0.Value<DateTime> joinedAt,
      i0.Value<bool> showInTimeline,
    });
typedef $$SharedSpaceMemberEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceMemberEntityCompanion Function({
      i0.Value<String> spaceId,
      i0.Value<String> userId,
      i0.Value<String> role,
      i0.Value<DateTime> joinedAt,
      i0.Value<bool> showInTimeline,
    });

final class $$SharedSpaceMemberEntityTableReferences
    extends
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceMemberEntityTable,
          i1.SharedSpaceMemberEntityData
        > {
  $$SharedSpaceMemberEntityTableReferences(
    super.$_db,
    super.$_table,
    super.$_typedResult,
  );

  static i4.$SharedSpaceEntityTable _spaceIdTable(i0.GeneratedDatabase db) =>
      i5.ReadDatabaseContainer(db)
          .resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity')
          .createAlias(
            i0.$_aliasNameGenerator(
              i5.ReadDatabaseContainer(db)
                  .resultSet<i1.$SharedSpaceMemberEntityTable>(
                    'shared_space_member_entity',
                  )
                  .spaceId,
              i5.ReadDatabaseContainer(
                db,
              ).resultSet<i4.$SharedSpaceEntityTable>('shared_space_entity').id,
            ),
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

  static i6.$UserEntityTable _userIdTable(i0.GeneratedDatabase db) =>
      i5.ReadDatabaseContainer(db)
          .resultSet<i6.$UserEntityTable>('user_entity')
          .createAlias(
            i0.$_aliasNameGenerator(
              i5.ReadDatabaseContainer(db)
                  .resultSet<i1.$SharedSpaceMemberEntityTable>(
                    'shared_space_member_entity',
                  )
                  .userId,
              i5.ReadDatabaseContainer(
                db,
              ).resultSet<i6.$UserEntityTable>('user_entity').id,
            ),
          );

  i6.$$UserEntityTableProcessedTableManager get userId {
    final $_column = $_itemColumn<String>('user_id')!;

    final manager = i6
        .$$UserEntityTableTableManager(
          $_db,
          i5.ReadDatabaseContainer(
            $_db,
          ).resultSet<i6.$UserEntityTable>('user_entity'),
        )
        .filter((f) => f.id.sqlEquals($_column));
    final item = $_typedResult.readTableOrNull(_userIdTable($_db));
    if (item == null) return manager;
    return i0.ProcessedTableManager(
      manager.$state.copyWith(prefetchedData: [item]),
    );
  }
}

class $$SharedSpaceMemberEntityTableFilterComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceMemberEntityTable> {
  $$SharedSpaceMemberEntityTableFilterComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnFilters<String> get role => $composableBuilder(
    column: $table.role,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<DateTime> get joinedAt => $composableBuilder(
    column: $table.joinedAt,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
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

  i6.$$UserEntityTableFilterComposer get userId {
    final i6.$$UserEntityTableFilterComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.userId,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i6.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i6.$$UserEntityTableFilterComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i6.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceMemberEntityTableOrderingComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceMemberEntityTable> {
  $$SharedSpaceMemberEntityTableOrderingComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.ColumnOrderings<String> get role => $composableBuilder(
    column: $table.role,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<DateTime> get joinedAt => $composableBuilder(
    column: $table.joinedAt,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
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

  i6.$$UserEntityTableOrderingComposer get userId {
    final i6.$$UserEntityTableOrderingComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.userId,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i6.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i6.$$UserEntityTableOrderingComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i6.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceMemberEntityTableAnnotationComposer
    extends
        i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceMemberEntityTable> {
  $$SharedSpaceMemberEntityTableAnnotationComposer({
    required super.$db,
    required super.$table,
    super.joinBuilder,
    super.$addJoinBuilderToRootComposer,
    super.$removeJoinBuilderFromRootComposer,
  });
  i0.GeneratedColumn<String> get role =>
      $composableBuilder(column: $table.role, builder: (column) => column);

  i0.GeneratedColumn<DateTime> get joinedAt =>
      $composableBuilder(column: $table.joinedAt, builder: (column) => column);

  i0.GeneratedColumn<bool> get showInTimeline => $composableBuilder(
    column: $table.showInTimeline,
    builder: (column) => column,
  );

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

  i6.$$UserEntityTableAnnotationComposer get userId {
    final i6.$$UserEntityTableAnnotationComposer composer = $composerBuilder(
      composer: this,
      getCurrentColumn: (t) => t.userId,
      referencedTable: i5.ReadDatabaseContainer(
        $db,
      ).resultSet<i6.$UserEntityTable>('user_entity'),
      getReferencedColumn: (t) => t.id,
      builder:
          (
            joinBuilder, {
            $addJoinBuilderToRootComposer,
            $removeJoinBuilderFromRootComposer,
          }) => i6.$$UserEntityTableAnnotationComposer(
            $db: $db,
            $table: i5.ReadDatabaseContainer(
              $db,
            ).resultSet<i6.$UserEntityTable>('user_entity'),
            $addJoinBuilderToRootComposer: $addJoinBuilderToRootComposer,
            joinBuilder: joinBuilder,
            $removeJoinBuilderFromRootComposer:
                $removeJoinBuilderFromRootComposer,
          ),
    );
    return composer;
  }
}

class $$SharedSpaceMemberEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceMemberEntityTable,
          i1.SharedSpaceMemberEntityData,
          i1.$$SharedSpaceMemberEntityTableFilterComposer,
          i1.$$SharedSpaceMemberEntityTableOrderingComposer,
          i1.$$SharedSpaceMemberEntityTableAnnotationComposer,
          $$SharedSpaceMemberEntityTableCreateCompanionBuilder,
          $$SharedSpaceMemberEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceMemberEntityData,
            i1.$$SharedSpaceMemberEntityTableReferences,
          ),
          i1.SharedSpaceMemberEntityData,
          i0.PrefetchHooks Function({bool spaceId, bool userId})
        > {
  $$SharedSpaceMemberEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceMemberEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceMemberEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceMemberEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceMemberEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> spaceId = const i0.Value.absent(),
                i0.Value<String> userId = const i0.Value.absent(),
                i0.Value<String> role = const i0.Value.absent(),
                i0.Value<DateTime> joinedAt = const i0.Value.absent(),
                i0.Value<bool> showInTimeline = const i0.Value.absent(),
              }) => i1.SharedSpaceMemberEntityCompanion(
                spaceId: spaceId,
                userId: userId,
                role: role,
                joinedAt: joinedAt,
                showInTimeline: showInTimeline,
              ),
          createCompanionCallback:
              ({
                required String spaceId,
                required String userId,
                required String role,
                i0.Value<DateTime> joinedAt = const i0.Value.absent(),
                i0.Value<bool> showInTimeline = const i0.Value.absent(),
              }) => i1.SharedSpaceMemberEntityCompanion.insert(
                spaceId: spaceId,
                userId: userId,
                role: role,
                joinedAt: joinedAt,
                showInTimeline: showInTimeline,
              ),
          withReferenceMapper: (p0) => p0
              .map(
                (e) => (
                  e.readTable(table),
                  i1.$$SharedSpaceMemberEntityTableReferences(db, table, e),
                ),
              )
              .toList(),
          prefetchHooksCallback: ({spaceId = false, userId = false}) {
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
                                    .$$SharedSpaceMemberEntityTableReferences
                                    ._spaceIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceMemberEntityTableReferences
                                    ._spaceIdTable(db)
                                    .id,
                              )
                              as T;
                    }
                    if (userId) {
                      state =
                          state.withJoin(
                                currentTable: table,
                                currentColumn: table.userId,
                                referencedTable: i1
                                    .$$SharedSpaceMemberEntityTableReferences
                                    ._userIdTable(db),
                                referencedColumn: i1
                                    .$$SharedSpaceMemberEntityTableReferences
                                    ._userIdTable(db)
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

typedef $$SharedSpaceMemberEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceMemberEntityTable,
      i1.SharedSpaceMemberEntityData,
      i1.$$SharedSpaceMemberEntityTableFilterComposer,
      i1.$$SharedSpaceMemberEntityTableOrderingComposer,
      i1.$$SharedSpaceMemberEntityTableAnnotationComposer,
      $$SharedSpaceMemberEntityTableCreateCompanionBuilder,
      $$SharedSpaceMemberEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceMemberEntityData,
        i1.$$SharedSpaceMemberEntityTableReferences,
      ),
      i1.SharedSpaceMemberEntityData,
      i0.PrefetchHooks Function({bool spaceId, bool userId})
    >;

class $SharedSpaceMemberEntityTable extends i2.SharedSpaceMemberEntity
    with
        i0.TableInfo<
          $SharedSpaceMemberEntityTable,
          i1.SharedSpaceMemberEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceMemberEntityTable(this.attachedDatabase, [this._alias]);
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
    defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
      'REFERENCES user_entity (id) ON DELETE CASCADE',
    ),
  );
  static const i0.VerificationMeta _roleMeta = const i0.VerificationMeta(
    'role',
  );
  @override
  late final i0.GeneratedColumn<String> role = i0.GeneratedColumn<String>(
    'role',
    aliasedName,
    false,
    type: i0.DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const i0.VerificationMeta _joinedAtMeta = const i0.VerificationMeta(
    'joinedAt',
  );
  @override
  late final i0.GeneratedColumn<DateTime> joinedAt =
      i0.GeneratedColumn<DateTime>(
        'joined_at',
        aliasedName,
        false,
        type: i0.DriftSqlType.dateTime,
        requiredDuringInsert: false,
        defaultValue: i3.currentDateAndTime,
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
  @override
  List<i0.GeneratedColumn> get $columns => [
    spaceId,
    userId,
    role,
    joinedAt,
    showInTimeline,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_member_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceMemberEntityData> instance, {
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
    if (data.containsKey('user_id')) {
      context.handle(
        _userIdMeta,
        userId.isAcceptableOrUnknown(data['user_id']!, _userIdMeta),
      );
    } else if (isInserting) {
      context.missing(_userIdMeta);
    }
    if (data.containsKey('role')) {
      context.handle(
        _roleMeta,
        role.isAcceptableOrUnknown(data['role']!, _roleMeta),
      );
    } else if (isInserting) {
      context.missing(_roleMeta);
    }
    if (data.containsKey('joined_at')) {
      context.handle(
        _joinedAtMeta,
        joinedAt.isAcceptableOrUnknown(data['joined_at']!, _joinedAtMeta),
      );
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
    return context;
  }

  @override
  Set<i0.GeneratedColumn> get $primaryKey => {spaceId, userId};
  @override
  i1.SharedSpaceMemberEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceMemberEntityData(
      spaceId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}space_id'],
      )!,
      userId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}user_id'],
      )!,
      role: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}role'],
      )!,
      joinedAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}joined_at'],
      )!,
      showInTimeline: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.bool,
        data['${effectivePrefix}show_in_timeline'],
      )!,
    );
  }

  @override
  $SharedSpaceMemberEntityTable createAlias(String alias) {
    return $SharedSpaceMemberEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceMemberEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceMemberEntityData> {
  final String spaceId;
  final String userId;
  final String role;
  final DateTime joinedAt;
  final bool showInTimeline;
  const SharedSpaceMemberEntityData({
    required this.spaceId,
    required this.userId,
    required this.role,
    required this.joinedAt,
    required this.showInTimeline,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['space_id'] = i0.Variable<String>(spaceId);
    map['user_id'] = i0.Variable<String>(userId);
    map['role'] = i0.Variable<String>(role);
    map['joined_at'] = i0.Variable<DateTime>(joinedAt);
    map['show_in_timeline'] = i0.Variable<bool>(showInTimeline);
    return map;
  }

  factory SharedSpaceMemberEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceMemberEntityData(
      spaceId: serializer.fromJson<String>(json['spaceId']),
      userId: serializer.fromJson<String>(json['userId']),
      role: serializer.fromJson<String>(json['role']),
      joinedAt: serializer.fromJson<DateTime>(json['joinedAt']),
      showInTimeline: serializer.fromJson<bool>(json['showInTimeline']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'spaceId': serializer.toJson<String>(spaceId),
      'userId': serializer.toJson<String>(userId),
      'role': serializer.toJson<String>(role),
      'joinedAt': serializer.toJson<DateTime>(joinedAt),
      'showInTimeline': serializer.toJson<bool>(showInTimeline),
    };
  }

  i1.SharedSpaceMemberEntityData copyWith({
    String? spaceId,
    String? userId,
    String? role,
    DateTime? joinedAt,
    bool? showInTimeline,
  }) => i1.SharedSpaceMemberEntityData(
    spaceId: spaceId ?? this.spaceId,
    userId: userId ?? this.userId,
    role: role ?? this.role,
    joinedAt: joinedAt ?? this.joinedAt,
    showInTimeline: showInTimeline ?? this.showInTimeline,
  );
  SharedSpaceMemberEntityData copyWithCompanion(
    i1.SharedSpaceMemberEntityCompanion data,
  ) {
    return SharedSpaceMemberEntityData(
      spaceId: data.spaceId.present ? data.spaceId.value : this.spaceId,
      userId: data.userId.present ? data.userId.value : this.userId,
      role: data.role.present ? data.role.value : this.role,
      joinedAt: data.joinedAt.present ? data.joinedAt.value : this.joinedAt,
      showInTimeline: data.showInTimeline.present
          ? data.showInTimeline.value
          : this.showInTimeline,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceMemberEntityData(')
          ..write('spaceId: $spaceId, ')
          ..write('userId: $userId, ')
          ..write('role: $role, ')
          ..write('joinedAt: $joinedAt, ')
          ..write('showInTimeline: $showInTimeline')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode =>
      Object.hash(spaceId, userId, role, joinedAt, showInTimeline);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceMemberEntityData &&
          other.spaceId == this.spaceId &&
          other.userId == this.userId &&
          other.role == this.role &&
          other.joinedAt == this.joinedAt &&
          other.showInTimeline == this.showInTimeline);
}

class SharedSpaceMemberEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceMemberEntityData> {
  final i0.Value<String> spaceId;
  final i0.Value<String> userId;
  final i0.Value<String> role;
  final i0.Value<DateTime> joinedAt;
  final i0.Value<bool> showInTimeline;
  const SharedSpaceMemberEntityCompanion({
    this.spaceId = const i0.Value.absent(),
    this.userId = const i0.Value.absent(),
    this.role = const i0.Value.absent(),
    this.joinedAt = const i0.Value.absent(),
    this.showInTimeline = const i0.Value.absent(),
  });
  SharedSpaceMemberEntityCompanion.insert({
    required String spaceId,
    required String userId,
    required String role,
    this.joinedAt = const i0.Value.absent(),
    this.showInTimeline = const i0.Value.absent(),
  }) : spaceId = i0.Value(spaceId),
       userId = i0.Value(userId),
       role = i0.Value(role);
  static i0.Insertable<i1.SharedSpaceMemberEntityData> custom({
    i0.Expression<String>? spaceId,
    i0.Expression<String>? userId,
    i0.Expression<String>? role,
    i0.Expression<DateTime>? joinedAt,
    i0.Expression<bool>? showInTimeline,
  }) {
    return i0.RawValuesInsertable({
      if (spaceId != null) 'space_id': spaceId,
      if (userId != null) 'user_id': userId,
      if (role != null) 'role': role,
      if (joinedAt != null) 'joined_at': joinedAt,
      if (showInTimeline != null) 'show_in_timeline': showInTimeline,
    });
  }

  i1.SharedSpaceMemberEntityCompanion copyWith({
    i0.Value<String>? spaceId,
    i0.Value<String>? userId,
    i0.Value<String>? role,
    i0.Value<DateTime>? joinedAt,
    i0.Value<bool>? showInTimeline,
  }) {
    return i1.SharedSpaceMemberEntityCompanion(
      spaceId: spaceId ?? this.spaceId,
      userId: userId ?? this.userId,
      role: role ?? this.role,
      joinedAt: joinedAt ?? this.joinedAt,
      showInTimeline: showInTimeline ?? this.showInTimeline,
    );
  }

  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    if (spaceId.present) {
      map['space_id'] = i0.Variable<String>(spaceId.value);
    }
    if (userId.present) {
      map['user_id'] = i0.Variable<String>(userId.value);
    }
    if (role.present) {
      map['role'] = i0.Variable<String>(role.value);
    }
    if (joinedAt.present) {
      map['joined_at'] = i0.Variable<DateTime>(joinedAt.value);
    }
    if (showInTimeline.present) {
      map['show_in_timeline'] = i0.Variable<bool>(showInTimeline.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceMemberEntityCompanion(')
          ..write('spaceId: $spaceId, ')
          ..write('userId: $userId, ')
          ..write('role: $role, ')
          ..write('joinedAt: $joinedAt, ')
          ..write('showInTimeline: $showInTimeline')
          ..write(')'))
        .toString();
  }
}
