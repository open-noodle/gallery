// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.dart'
    as i2;
import 'package:drift/src/runtime/query_builder/query_builder.dart' as i3;

typedef $$SharedSpaceAlbumEntityTableCreateCompanionBuilder =
    i1.SharedSpaceAlbumEntityCompanion Function({
      required String id,
      required String name,
      i0.Value<String?> description,
      i0.Value<String?> thumbnailAssetId,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
      i0.Value<bool> isActivityEnabled,
      i0.Value<int> order,
    });
typedef $$SharedSpaceAlbumEntityTableUpdateCompanionBuilder =
    i1.SharedSpaceAlbumEntityCompanion Function({
      i0.Value<String> id,
      i0.Value<String> name,
      i0.Value<String?> description,
      i0.Value<String?> thumbnailAssetId,
      i0.Value<DateTime> createdAt,
      i0.Value<DateTime> updatedAt,
      i0.Value<bool> isActivityEnabled,
      i0.Value<int> order,
    });

class $$SharedSpaceAlbumEntityTableFilterComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumEntityTable> {
  $$SharedSpaceAlbumEntityTableFilterComposer({
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

  i0.ColumnFilters<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
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

  i0.ColumnFilters<bool> get isActivityEnabled => $composableBuilder(
    column: $table.isActivityEnabled,
    builder: (column) => i0.ColumnFilters(column),
  );

  i0.ColumnFilters<int> get order => $composableBuilder(
    column: $table.order,
    builder: (column) => i0.ColumnFilters(column),
  );
}

class $$SharedSpaceAlbumEntityTableOrderingComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumEntityTable> {
  $$SharedSpaceAlbumEntityTableOrderingComposer({
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

  i0.ColumnOrderings<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
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

  i0.ColumnOrderings<bool> get isActivityEnabled => $composableBuilder(
    column: $table.isActivityEnabled,
    builder: (column) => i0.ColumnOrderings(column),
  );

  i0.ColumnOrderings<int> get order => $composableBuilder(
    column: $table.order,
    builder: (column) => i0.ColumnOrderings(column),
  );
}

class $$SharedSpaceAlbumEntityTableAnnotationComposer
    extends i0.Composer<i0.GeneratedDatabase, i1.$SharedSpaceAlbumEntityTable> {
  $$SharedSpaceAlbumEntityTableAnnotationComposer({
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

  i0.GeneratedColumn<String> get thumbnailAssetId => $composableBuilder(
    column: $table.thumbnailAssetId,
    builder: (column) => column,
  );

  i0.GeneratedColumn<DateTime> get createdAt =>
      $composableBuilder(column: $table.createdAt, builder: (column) => column);

  i0.GeneratedColumn<DateTime> get updatedAt =>
      $composableBuilder(column: $table.updatedAt, builder: (column) => column);

  i0.GeneratedColumn<bool> get isActivityEnabled => $composableBuilder(
    column: $table.isActivityEnabled,
    builder: (column) => column,
  );

  i0.GeneratedColumn<int> get order =>
      $composableBuilder(column: $table.order, builder: (column) => column);
}

class $$SharedSpaceAlbumEntityTableTableManager
    extends
        i0.RootTableManager<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumEntityTable,
          i1.SharedSpaceAlbumEntityData,
          i1.$$SharedSpaceAlbumEntityTableFilterComposer,
          i1.$$SharedSpaceAlbumEntityTableOrderingComposer,
          i1.$$SharedSpaceAlbumEntityTableAnnotationComposer,
          $$SharedSpaceAlbumEntityTableCreateCompanionBuilder,
          $$SharedSpaceAlbumEntityTableUpdateCompanionBuilder,
          (
            i1.SharedSpaceAlbumEntityData,
            i0.BaseReferences<
              i0.GeneratedDatabase,
              i1.$SharedSpaceAlbumEntityTable,
              i1.SharedSpaceAlbumEntityData
            >,
          ),
          i1.SharedSpaceAlbumEntityData,
          i0.PrefetchHooks Function()
        > {
  $$SharedSpaceAlbumEntityTableTableManager(
    i0.GeneratedDatabase db,
    i1.$SharedSpaceAlbumEntityTable table,
  ) : super(
        i0.TableManagerState(
          db: db,
          table: table,
          createFilteringComposer: () =>
              i1.$$SharedSpaceAlbumEntityTableFilterComposer(
                $db: db,
                $table: table,
              ),
          createOrderingComposer: () =>
              i1.$$SharedSpaceAlbumEntityTableOrderingComposer(
                $db: db,
                $table: table,
              ),
          createComputedFieldComposer: () =>
              i1.$$SharedSpaceAlbumEntityTableAnnotationComposer(
                $db: db,
                $table: table,
              ),
          updateCompanionCallback:
              ({
                i0.Value<String> id = const i0.Value.absent(),
                i0.Value<String> name = const i0.Value.absent(),
                i0.Value<String?> description = const i0.Value.absent(),
                i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
                i0.Value<bool> isActivityEnabled = const i0.Value.absent(),
                i0.Value<int> order = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumEntityCompanion(
                id: id,
                name: name,
                description: description,
                thumbnailAssetId: thumbnailAssetId,
                createdAt: createdAt,
                updatedAt: updatedAt,
                isActivityEnabled: isActivityEnabled,
                order: order,
              ),
          createCompanionCallback:
              ({
                required String id,
                required String name,
                i0.Value<String?> description = const i0.Value.absent(),
                i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
                i0.Value<DateTime> createdAt = const i0.Value.absent(),
                i0.Value<DateTime> updatedAt = const i0.Value.absent(),
                i0.Value<bool> isActivityEnabled = const i0.Value.absent(),
                i0.Value<int> order = const i0.Value.absent(),
              }) => i1.SharedSpaceAlbumEntityCompanion.insert(
                id: id,
                name: name,
                description: description,
                thumbnailAssetId: thumbnailAssetId,
                createdAt: createdAt,
                updatedAt: updatedAt,
                isActivityEnabled: isActivityEnabled,
                order: order,
              ),
          withReferenceMapper: (p0) => p0
              .map((e) => (e.readTable(table), i0.BaseReferences(db, table, e)))
              .toList(),
          prefetchHooksCallback: null,
        ),
      );
}

typedef $$SharedSpaceAlbumEntityTableProcessedTableManager =
    i0.ProcessedTableManager<
      i0.GeneratedDatabase,
      i1.$SharedSpaceAlbumEntityTable,
      i1.SharedSpaceAlbumEntityData,
      i1.$$SharedSpaceAlbumEntityTableFilterComposer,
      i1.$$SharedSpaceAlbumEntityTableOrderingComposer,
      i1.$$SharedSpaceAlbumEntityTableAnnotationComposer,
      $$SharedSpaceAlbumEntityTableCreateCompanionBuilder,
      $$SharedSpaceAlbumEntityTableUpdateCompanionBuilder,
      (
        i1.SharedSpaceAlbumEntityData,
        i0.BaseReferences<
          i0.GeneratedDatabase,
          i1.$SharedSpaceAlbumEntityTable,
          i1.SharedSpaceAlbumEntityData
        >,
      ),
      i1.SharedSpaceAlbumEntityData,
      i0.PrefetchHooks Function()
    >;

class $SharedSpaceAlbumEntityTable extends i2.SharedSpaceAlbumEntity
    with
        i0.TableInfo<
          $SharedSpaceAlbumEntityTable,
          i1.SharedSpaceAlbumEntityData
        > {
  @override
  final i0.GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SharedSpaceAlbumEntityTable(this.attachedDatabase, [this._alias]);
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
  static const i0.VerificationMeta _isActivityEnabledMeta =
      const i0.VerificationMeta('isActivityEnabled');
  @override
  late final i0.GeneratedColumn<bool> isActivityEnabled =
      i0.GeneratedColumn<bool>(
        'is_activity_enabled',
        aliasedName,
        false,
        type: i0.DriftSqlType.bool,
        requiredDuringInsert: false,
        defaultConstraints: i0.GeneratedColumn.constraintIsAlways(
          'CHECK ("is_activity_enabled" IN (0, 1))',
        ),
        defaultValue: const i3.Constant(true),
      );
  static const i0.VerificationMeta _orderMeta = const i0.VerificationMeta(
    'order',
  );
  @override
  late final i0.GeneratedColumn<int> order = i0.GeneratedColumn<int>(
    'order',
    aliasedName,
    false,
    type: i0.DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const i3.Constant(0),
  );
  @override
  List<i0.GeneratedColumn> get $columns => [
    id,
    name,
    description,
    thumbnailAssetId,
    createdAt,
    updatedAt,
    isActivityEnabled,
    order,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'shared_space_album_entity';
  @override
  i0.VerificationContext validateIntegrity(
    i0.Insertable<i1.SharedSpaceAlbumEntityData> instance, {
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
    if (data.containsKey('thumbnail_asset_id')) {
      context.handle(
        _thumbnailAssetIdMeta,
        thumbnailAssetId.isAcceptableOrUnknown(
          data['thumbnail_asset_id']!,
          _thumbnailAssetIdMeta,
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
    if (data.containsKey('is_activity_enabled')) {
      context.handle(
        _isActivityEnabledMeta,
        isActivityEnabled.isAcceptableOrUnknown(
          data['is_activity_enabled']!,
          _isActivityEnabledMeta,
        ),
      );
    }
    if (data.containsKey('order')) {
      context.handle(
        _orderMeta,
        order.isAcceptableOrUnknown(data['order']!, _orderMeta),
      );
    }
    return context;
  }

  @override
  Set<i0.GeneratedColumn> get $primaryKey => {id};
  @override
  i1.SharedSpaceAlbumEntityData map(
    Map<String, dynamic> data, {
    String? tablePrefix,
  }) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return i1.SharedSpaceAlbumEntityData(
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
      thumbnailAssetId: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.string,
        data['${effectivePrefix}thumbnail_asset_id'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
      isActivityEnabled: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.bool,
        data['${effectivePrefix}is_activity_enabled'],
      )!,
      order: attachedDatabase.typeMapping.read(
        i0.DriftSqlType.int,
        data['${effectivePrefix}order'],
      )!,
    );
  }

  @override
  $SharedSpaceAlbumEntityTable createAlias(String alias) {
    return $SharedSpaceAlbumEntityTable(attachedDatabase, alias);
  }

  @override
  bool get withoutRowId => true;
  @override
  bool get isStrict => true;
}

class SharedSpaceAlbumEntityData extends i0.DataClass
    implements i0.Insertable<i1.SharedSpaceAlbumEntityData> {
  final String id;
  final String name;
  final String? description;
  final String? thumbnailAssetId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isActivityEnabled;
  final int order;
  const SharedSpaceAlbumEntityData({
    required this.id,
    required this.name,
    this.description,
    this.thumbnailAssetId,
    required this.createdAt,
    required this.updatedAt,
    required this.isActivityEnabled,
    required this.order,
  });
  @override
  Map<String, i0.Expression> toColumns(bool nullToAbsent) {
    final map = <String, i0.Expression>{};
    map['id'] = i0.Variable<String>(id);
    map['name'] = i0.Variable<String>(name);
    if (!nullToAbsent || description != null) {
      map['description'] = i0.Variable<String>(description);
    }
    if (!nullToAbsent || thumbnailAssetId != null) {
      map['thumbnail_asset_id'] = i0.Variable<String>(thumbnailAssetId);
    }
    map['created_at'] = i0.Variable<DateTime>(createdAt);
    map['updated_at'] = i0.Variable<DateTime>(updatedAt);
    map['is_activity_enabled'] = i0.Variable<bool>(isActivityEnabled);
    map['order'] = i0.Variable<int>(order);
    return map;
  }

  factory SharedSpaceAlbumEntityData.fromJson(
    Map<String, dynamic> json, {
    i0.ValueSerializer? serializer,
  }) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return SharedSpaceAlbumEntityData(
      id: serializer.fromJson<String>(json['id']),
      name: serializer.fromJson<String>(json['name']),
      description: serializer.fromJson<String?>(json['description']),
      thumbnailAssetId: serializer.fromJson<String?>(json['thumbnailAssetId']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
      isActivityEnabled: serializer.fromJson<bool>(json['isActivityEnabled']),
      order: serializer.fromJson<int>(json['order']),
    );
  }
  @override
  Map<String, dynamic> toJson({i0.ValueSerializer? serializer}) {
    serializer ??= i0.driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'name': serializer.toJson<String>(name),
      'description': serializer.toJson<String?>(description),
      'thumbnailAssetId': serializer.toJson<String?>(thumbnailAssetId),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
      'isActivityEnabled': serializer.toJson<bool>(isActivityEnabled),
      'order': serializer.toJson<int>(order),
    };
  }

  i1.SharedSpaceAlbumEntityData copyWith({
    String? id,
    String? name,
    i0.Value<String?> description = const i0.Value.absent(),
    i0.Value<String?> thumbnailAssetId = const i0.Value.absent(),
    DateTime? createdAt,
    DateTime? updatedAt,
    bool? isActivityEnabled,
    int? order,
  }) => i1.SharedSpaceAlbumEntityData(
    id: id ?? this.id,
    name: name ?? this.name,
    description: description.present ? description.value : this.description,
    thumbnailAssetId: thumbnailAssetId.present
        ? thumbnailAssetId.value
        : this.thumbnailAssetId,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    isActivityEnabled: isActivityEnabled ?? this.isActivityEnabled,
    order: order ?? this.order,
  );
  SharedSpaceAlbumEntityData copyWithCompanion(
    i1.SharedSpaceAlbumEntityCompanion data,
  ) {
    return SharedSpaceAlbumEntityData(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      description: data.description.present
          ? data.description.value
          : this.description,
      thumbnailAssetId: data.thumbnailAssetId.present
          ? data.thumbnailAssetId.value
          : this.thumbnailAssetId,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      isActivityEnabled: data.isActivityEnabled.present
          ? data.isActivityEnabled.value
          : this.isActivityEnabled,
      order: data.order.present ? data.order.value : this.order,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumEntityData(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('description: $description, ')
          ..write('thumbnailAssetId: $thumbnailAssetId, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('isActivityEnabled: $isActivityEnabled, ')
          ..write('order: $order')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    description,
    thumbnailAssetId,
    createdAt,
    updatedAt,
    isActivityEnabled,
    order,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is i1.SharedSpaceAlbumEntityData &&
          other.id == this.id &&
          other.name == this.name &&
          other.description == this.description &&
          other.thumbnailAssetId == this.thumbnailAssetId &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt &&
          other.isActivityEnabled == this.isActivityEnabled &&
          other.order == this.order);
}

class SharedSpaceAlbumEntityCompanion
    extends i0.UpdateCompanion<i1.SharedSpaceAlbumEntityData> {
  final i0.Value<String> id;
  final i0.Value<String> name;
  final i0.Value<String?> description;
  final i0.Value<String?> thumbnailAssetId;
  final i0.Value<DateTime> createdAt;
  final i0.Value<DateTime> updatedAt;
  final i0.Value<bool> isActivityEnabled;
  final i0.Value<int> order;
  const SharedSpaceAlbumEntityCompanion({
    this.id = const i0.Value.absent(),
    this.name = const i0.Value.absent(),
    this.description = const i0.Value.absent(),
    this.thumbnailAssetId = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
    this.isActivityEnabled = const i0.Value.absent(),
    this.order = const i0.Value.absent(),
  });
  SharedSpaceAlbumEntityCompanion.insert({
    required String id,
    required String name,
    this.description = const i0.Value.absent(),
    this.thumbnailAssetId = const i0.Value.absent(),
    this.createdAt = const i0.Value.absent(),
    this.updatedAt = const i0.Value.absent(),
    this.isActivityEnabled = const i0.Value.absent(),
    this.order = const i0.Value.absent(),
  }) : id = i0.Value(id),
       name = i0.Value(name);
  static i0.Insertable<i1.SharedSpaceAlbumEntityData> custom({
    i0.Expression<String>? id,
    i0.Expression<String>? name,
    i0.Expression<String>? description,
    i0.Expression<String>? thumbnailAssetId,
    i0.Expression<DateTime>? createdAt,
    i0.Expression<DateTime>? updatedAt,
    i0.Expression<bool>? isActivityEnabled,
    i0.Expression<int>? order,
  }) {
    return i0.RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (description != null) 'description': description,
      if (thumbnailAssetId != null) 'thumbnail_asset_id': thumbnailAssetId,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (isActivityEnabled != null) 'is_activity_enabled': isActivityEnabled,
      if (order != null) 'order': order,
    });
  }

  i1.SharedSpaceAlbumEntityCompanion copyWith({
    i0.Value<String>? id,
    i0.Value<String>? name,
    i0.Value<String?>? description,
    i0.Value<String?>? thumbnailAssetId,
    i0.Value<DateTime>? createdAt,
    i0.Value<DateTime>? updatedAt,
    i0.Value<bool>? isActivityEnabled,
    i0.Value<int>? order,
  }) {
    return i1.SharedSpaceAlbumEntityCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      description: description ?? this.description,
      thumbnailAssetId: thumbnailAssetId ?? this.thumbnailAssetId,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isActivityEnabled: isActivityEnabled ?? this.isActivityEnabled,
      order: order ?? this.order,
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
    if (thumbnailAssetId.present) {
      map['thumbnail_asset_id'] = i0.Variable<String>(thumbnailAssetId.value);
    }
    if (createdAt.present) {
      map['created_at'] = i0.Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = i0.Variable<DateTime>(updatedAt.value);
    }
    if (isActivityEnabled.present) {
      map['is_activity_enabled'] = i0.Variable<bool>(isActivityEnabled.value);
    }
    if (order.present) {
      map['order'] = i0.Variable<int>(order.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SharedSpaceAlbumEntityCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('description: $description, ')
          ..write('thumbnailAssetId: $thumbnailAssetId, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('isActivityEnabled: $isActivityEnabled, ')
          ..write('order: $order')
          ..write(')'))
        .toString();
  }
}
