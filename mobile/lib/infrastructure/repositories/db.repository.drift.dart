// dart format width=80
// ignore_for_file: type=lint
import 'package:drift/drift.dart' as i0;
import 'package:immich_mobile/infrastructure/entities/user.entity.drift.dart'
    as i1;
import 'package:immich_mobile/infrastructure/entities/remote_asset.entity.drift.dart'
    as i2;
import 'package:immich_mobile/infrastructure/entities/stack.entity.drift.dart'
    as i3;
import 'package:immich_mobile/infrastructure/entities/local_asset.entity.drift.dart'
    as i4;
import 'package:immich_mobile/infrastructure/entities/shared_space.entity.drift.dart'
    as i5;
import 'package:immich_mobile/infrastructure/entities/shared_space_asset.entity.drift.dart'
    as i6;
import 'package:immich_mobile/infrastructure/entities/shared_space_member.entity.drift.dart'
    as i7;
import 'package:immich_mobile/infrastructure/entities/shared_space_library.entity.drift.dart'
    as i8;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_asset.entity.drift.dart'
    as i9;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_link.entity.drift.dart'
    as i10;
import 'package:immich_mobile/infrastructure/entities/remote_album.entity.drift.dart'
    as i11;
import 'package:immich_mobile/infrastructure/entities/local_album.entity.drift.dart'
    as i12;
import 'package:immich_mobile/infrastructure/entities/local_album_asset.entity.drift.dart'
    as i13;
import 'package:immich_mobile/infrastructure/entities/auth_user.entity.drift.dart'
    as i14;
import 'package:immich_mobile/infrastructure/entities/user_metadata.entity.drift.dart'
    as i15;
import 'package:immich_mobile/infrastructure/entities/partner.entity.drift.dart'
    as i16;
import 'package:immich_mobile/infrastructure/entities/exif.entity.drift.dart'
    as i17;
import 'package:immich_mobile/infrastructure/entities/remote_album_asset.entity.drift.dart'
    as i18;
import 'package:immich_mobile/infrastructure/entities/remote_album_user.entity.drift.dart'
    as i19;
import 'package:immich_mobile/infrastructure/entities/remote_asset_cloud_id.entity.drift.dart'
    as i20;
import 'package:immich_mobile/infrastructure/entities/library.entity.drift.dart'
    as i21;
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.drift.dart'
    as i22;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_hidden.entity.drift.dart'
    as i23;
import 'package:immich_mobile/infrastructure/entities/memory.entity.drift.dart'
    as i24;
import 'package:immich_mobile/infrastructure/entities/memory_asset.entity.drift.dart'
    as i25;
import 'package:immich_mobile/infrastructure/entities/person.entity.drift.dart'
    as i26;
import 'package:immich_mobile/infrastructure/entities/asset_face.entity.drift.dart'
    as i27;
import 'package:immich_mobile/infrastructure/entities/store.entity.drift.dart'
    as i28;
import 'package:immich_mobile/infrastructure/entities/trashed_local_asset.entity.drift.dart'
    as i29;
import 'package:immich_mobile/infrastructure/entities/asset_edit.entity.drift.dart'
    as i30;
import 'package:immich_mobile/infrastructure/entities/settings.entity.drift.dart'
    as i31;
import 'package:immich_mobile/infrastructure/entities/asset_ocr.entity.drift.dart'
    as i32;
import 'package:immich_mobile/infrastructure/entities/merged_asset.drift.dart'
    as i33;
import 'package:drift/internal/modular.dart' as i34;

abstract class $Drift extends i0.GeneratedDatabase {
  $Drift(i0.QueryExecutor e) : super(e);
  $DriftManager get managers => $DriftManager(this);
  late final i1.$UserEntityTable userEntity = i1.$UserEntityTable(this);
  late final i2.$RemoteAssetEntityTable remoteAssetEntity = i2
      .$RemoteAssetEntityTable(this);
  late final i3.$StackEntityTable stackEntity = i3.$StackEntityTable(this);
  late final i4.$LocalAssetEntityTable localAssetEntity = i4
      .$LocalAssetEntityTable(this);
  late final i5.$SharedSpaceEntityTable sharedSpaceEntity = i5
      .$SharedSpaceEntityTable(this);
  late final i6.$SharedSpaceAssetEntityTable sharedSpaceAssetEntity = i6
      .$SharedSpaceAssetEntityTable(this);
  late final i7.$SharedSpaceMemberEntityTable sharedSpaceMemberEntity = i7
      .$SharedSpaceMemberEntityTable(this);
  late final i8.$SharedSpaceLibraryEntityTable sharedSpaceLibraryEntity = i8
      .$SharedSpaceLibraryEntityTable(this);
  late final i9.$SharedSpaceAlbumAssetEntityTable sharedSpaceAlbumAssetEntity =
      i9.$SharedSpaceAlbumAssetEntityTable(this);
  late final i10.$SharedSpaceAlbumLinkEntityTable sharedSpaceAlbumLinkEntity =
      i10.$SharedSpaceAlbumLinkEntityTable(this);
  late final i11.$RemoteAlbumEntityTable remoteAlbumEntity = i11
      .$RemoteAlbumEntityTable(this);
  late final i12.$LocalAlbumEntityTable localAlbumEntity = i12
      .$LocalAlbumEntityTable(this);
  late final i13.$LocalAlbumAssetEntityTable localAlbumAssetEntity = i13
      .$LocalAlbumAssetEntityTable(this);
  late final i14.$AuthUserEntityTable authUserEntity = i14.$AuthUserEntityTable(
    this,
  );
  late final i15.$UserMetadataEntityTable userMetadataEntity = i15
      .$UserMetadataEntityTable(this);
  late final i16.$PartnerEntityTable partnerEntity = i16.$PartnerEntityTable(
    this,
  );
  late final i17.$RemoteExifEntityTable remoteExifEntity = i17
      .$RemoteExifEntityTable(this);
  late final i18.$RemoteAlbumAssetEntityTable remoteAlbumAssetEntity = i18
      .$RemoteAlbumAssetEntityTable(this);
  late final i19.$RemoteAlbumUserEntityTable remoteAlbumUserEntity = i19
      .$RemoteAlbumUserEntityTable(this);
  late final i20.$RemoteAssetCloudIdEntityTable remoteAssetCloudIdEntity = i20
      .$RemoteAssetCloudIdEntityTable(this);
  late final i21.$LibraryEntityTable libraryEntity = i21.$LibraryEntityTable(
    this,
  );
  late final i22.$SharedSpaceAlbumEntityTable sharedSpaceAlbumEntity = i22
      .$SharedSpaceAlbumEntityTable(this);
  late final i23.$SharedSpaceAlbumHiddenEntityTable
  sharedSpaceAlbumHiddenEntity = i23.$SharedSpaceAlbumHiddenEntityTable(this);
  late final i24.$MemoryEntityTable memoryEntity = i24.$MemoryEntityTable(this);
  late final i25.$MemoryAssetEntityTable memoryAssetEntity = i25
      .$MemoryAssetEntityTable(this);
  late final i26.$PersonEntityTable personEntity = i26.$PersonEntityTable(this);
  late final i27.$AssetFaceEntityTable assetFaceEntity = i27
      .$AssetFaceEntityTable(this);
  late final i28.$StoreEntityTable storeEntity = i28.$StoreEntityTable(this);
  late final i29.$TrashedLocalAssetEntityTable trashedLocalAssetEntity = i29
      .$TrashedLocalAssetEntityTable(this);
  late final i30.$AssetEditEntityTable assetEditEntity = i30
      .$AssetEditEntityTable(this);
  late final i31.$SettingsEntityTable settingsEntity = i31.$SettingsEntityTable(
    this,
  );
  late final i32.$AssetOcrEntityTable assetOcrEntity = i32.$AssetOcrEntityTable(
    this,
  );
  i33.MergedAssetDrift get mergedAssetDrift => i34.ReadDatabaseContainer(
    this,
  ).accessor<i33.MergedAssetDrift>(i33.MergedAssetDrift.new);
  @override
  Iterable<i0.TableInfo<i0.Table, Object?>> get allTables =>
      allSchemaEntities.whereType<i0.TableInfo<i0.Table, Object?>>();
  @override
  List<i0.DatabaseSchemaEntity> get allSchemaEntities => [
    userEntity,
    remoteAssetEntity,
    stackEntity,
    localAssetEntity,
    sharedSpaceEntity,
    sharedSpaceAssetEntity,
    sharedSpaceMemberEntity,
    sharedSpaceLibraryEntity,
    sharedSpaceAlbumAssetEntity,
    sharedSpaceAlbumLinkEntity,
    remoteAlbumEntity,
    localAlbumEntity,
    localAlbumAssetEntity,
    i10.idxSharedSpaceAlbumLinkSpace,
    i10.idxSharedSpaceAlbumLinkAlbumSpace,
    i5.idxSharedSpaceCreatedById,
    i9.idxSharedSpaceAlbumAssetAlbum,
    i9.idxSharedSpaceAlbumAssetAssetAlbum,
    i8.idxSharedSpaceLibrarySpaceId,
    i8.idxSharedSpaceLibraryLibrarySpace,
    i6.idxSharedSpaceAssetSpaceAsset,
    i6.idxSharedSpaceAssetAssetSpace,
    i13.idxLocalAlbumAssetAlbumAsset,
    i4.idxLocalAssetChecksum,
    i4.idxLocalAssetCloudId,
    i4.idxLocalAssetCreatedAt,
    i3.idxStackPrimaryAssetId,
    i2.uQRemoteAssetsOwnerChecksum,
    i2.uQRemoteAssetsOwnerLibraryChecksum,
    i2.idxRemoteAssetChecksum,
    i2.idxRemoteAssetStackId,
    i2.idxRemoteAssetOwnerVisibilityDeletedCreated,
    i2.idxRemoteAssetLibraryCreated,
    i2.idxRemoteAssetUploaded,
    authUserEntity,
    userMetadataEntity,
    partnerEntity,
    remoteExifEntity,
    remoteAlbumAssetEntity,
    remoteAlbumUserEntity,
    remoteAssetCloudIdEntity,
    libraryEntity,
    sharedSpaceAlbumEntity,
    sharedSpaceAlbumHiddenEntity,
    memoryEntity,
    memoryAssetEntity,
    personEntity,
    assetFaceEntity,
    storeEntity,
    trashedLocalAssetEntity,
    assetEditEntity,
    settingsEntity,
    assetOcrEntity,
    i16.idxPartnerSharedWithId,
    i17.idxLatLng,
    i17.idxRemoteExifCity,
    i18.idxRemoteAlbumAssetAlbumAsset,
    i20.idxRemoteAssetCloudId,
    i23.idxSharedSpaceAlbumHiddenAlbumSpace,
    i26.idxPersonOwnerId,
    i27.idxAssetFacePersonId,
    i27.idxAssetFaceAssetId,
    i27.idxAssetFaceVisiblePerson,
    i29.idxTrashedLocalAssetChecksum,
    i29.idxTrashedLocalAssetAlbum,
    i30.idxAssetEditAssetId,
    i32.idxAssetOcrAssetId,
  ];
  @override
  i0.StreamQueryUpdateRules
  get streamUpdateRules => const i0.StreamQueryUpdateRules([
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('stack_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('shared_space_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'shared_space_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('shared_space_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'shared_space_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'shared_space_member_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'shared_space_member_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'shared_space_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'shared_space_library_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'shared_space_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'shared_space_album_link_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_album_entity', kind: i0.UpdateKind.update),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_album_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('local_album_entity', kind: i0.UpdateKind.update),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'local_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('local_album_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'local_album_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('local_album_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('user_metadata_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('partner_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('partner_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_exif_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_album_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_album_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_album_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_album_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_album_user_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('remote_album_user_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'remote_asset_cloud_id_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('library_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'shared_space_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate(
          'shared_space_album_hidden_entity',
          kind: i0.UpdateKind.delete,
        ),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('memory_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('memory_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'memory_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [
        i0.TableUpdate('memory_asset_entity', kind: i0.UpdateKind.delete),
      ],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'user_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('person_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('asset_face_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'person_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('asset_face_entity', kind: i0.UpdateKind.update)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('asset_edit_entity', kind: i0.UpdateKind.delete)],
    ),
    i0.WritePropagation(
      on: i0.TableUpdateQuery.onTableName(
        'remote_asset_entity',
        limitUpdateKind: i0.UpdateKind.delete,
      ),
      result: [i0.TableUpdate('asset_ocr_entity', kind: i0.UpdateKind.delete)],
    ),
  ]);
  @override
  i0.DriftDatabaseOptions get options =>
      const i0.DriftDatabaseOptions(storeDateTimeAsText: true);
}

class $DriftManager {
  final $Drift _db;
  $DriftManager(this._db);
  i1.$$UserEntityTableTableManager get userEntity =>
      i1.$$UserEntityTableTableManager(_db, _db.userEntity);
  i2.$$RemoteAssetEntityTableTableManager get remoteAssetEntity =>
      i2.$$RemoteAssetEntityTableTableManager(_db, _db.remoteAssetEntity);
  i3.$$StackEntityTableTableManager get stackEntity =>
      i3.$$StackEntityTableTableManager(_db, _db.stackEntity);
  i4.$$LocalAssetEntityTableTableManager get localAssetEntity =>
      i4.$$LocalAssetEntityTableTableManager(_db, _db.localAssetEntity);
  i5.$$SharedSpaceEntityTableTableManager get sharedSpaceEntity =>
      i5.$$SharedSpaceEntityTableTableManager(_db, _db.sharedSpaceEntity);
  i6.$$SharedSpaceAssetEntityTableTableManager get sharedSpaceAssetEntity =>
      i6.$$SharedSpaceAssetEntityTableTableManager(
        _db,
        _db.sharedSpaceAssetEntity,
      );
  i7.$$SharedSpaceMemberEntityTableTableManager get sharedSpaceMemberEntity =>
      i7.$$SharedSpaceMemberEntityTableTableManager(
        _db,
        _db.sharedSpaceMemberEntity,
      );
  i8.$$SharedSpaceLibraryEntityTableTableManager get sharedSpaceLibraryEntity =>
      i8.$$SharedSpaceLibraryEntityTableTableManager(
        _db,
        _db.sharedSpaceLibraryEntity,
      );
  i9.$$SharedSpaceAlbumAssetEntityTableTableManager
  get sharedSpaceAlbumAssetEntity =>
      i9.$$SharedSpaceAlbumAssetEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumAssetEntity,
      );
  i10.$$SharedSpaceAlbumLinkEntityTableTableManager
  get sharedSpaceAlbumLinkEntity =>
      i10.$$SharedSpaceAlbumLinkEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumLinkEntity,
      );
  i11.$$RemoteAlbumEntityTableTableManager get remoteAlbumEntity =>
      i11.$$RemoteAlbumEntityTableTableManager(_db, _db.remoteAlbumEntity);
  i12.$$LocalAlbumEntityTableTableManager get localAlbumEntity =>
      i12.$$LocalAlbumEntityTableTableManager(_db, _db.localAlbumEntity);
  i13.$$LocalAlbumAssetEntityTableTableManager get localAlbumAssetEntity => i13
      .$$LocalAlbumAssetEntityTableTableManager(_db, _db.localAlbumAssetEntity);
  i14.$$AuthUserEntityTableTableManager get authUserEntity =>
      i14.$$AuthUserEntityTableTableManager(_db, _db.authUserEntity);
  i15.$$UserMetadataEntityTableTableManager get userMetadataEntity =>
      i15.$$UserMetadataEntityTableTableManager(_db, _db.userMetadataEntity);
  i16.$$PartnerEntityTableTableManager get partnerEntity =>
      i16.$$PartnerEntityTableTableManager(_db, _db.partnerEntity);
  i17.$$RemoteExifEntityTableTableManager get remoteExifEntity =>
      i17.$$RemoteExifEntityTableTableManager(_db, _db.remoteExifEntity);
  i18.$$RemoteAlbumAssetEntityTableTableManager get remoteAlbumAssetEntity =>
      i18.$$RemoteAlbumAssetEntityTableTableManager(
        _db,
        _db.remoteAlbumAssetEntity,
      );
  i19.$$RemoteAlbumUserEntityTableTableManager get remoteAlbumUserEntity => i19
      .$$RemoteAlbumUserEntityTableTableManager(_db, _db.remoteAlbumUserEntity);
  i20.$$RemoteAssetCloudIdEntityTableTableManager
  get remoteAssetCloudIdEntity =>
      i20.$$RemoteAssetCloudIdEntityTableTableManager(
        _db,
        _db.remoteAssetCloudIdEntity,
      );
  i21.$$LibraryEntityTableTableManager get libraryEntity =>
      i21.$$LibraryEntityTableTableManager(_db, _db.libraryEntity);
  i22.$$SharedSpaceAlbumEntityTableTableManager get sharedSpaceAlbumEntity =>
      i22.$$SharedSpaceAlbumEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumEntity,
      );
  i23.$$SharedSpaceAlbumHiddenEntityTableTableManager
  get sharedSpaceAlbumHiddenEntity =>
      i23.$$SharedSpaceAlbumHiddenEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumHiddenEntity,
      );
  i24.$$MemoryEntityTableTableManager get memoryEntity =>
      i24.$$MemoryEntityTableTableManager(_db, _db.memoryEntity);
  i25.$$MemoryAssetEntityTableTableManager get memoryAssetEntity =>
      i25.$$MemoryAssetEntityTableTableManager(_db, _db.memoryAssetEntity);
  i26.$$PersonEntityTableTableManager get personEntity =>
      i26.$$PersonEntityTableTableManager(_db, _db.personEntity);
  i27.$$AssetFaceEntityTableTableManager get assetFaceEntity =>
      i27.$$AssetFaceEntityTableTableManager(_db, _db.assetFaceEntity);
  i28.$$StoreEntityTableTableManager get storeEntity =>
      i28.$$StoreEntityTableTableManager(_db, _db.storeEntity);
  i29.$$TrashedLocalAssetEntityTableTableManager get trashedLocalAssetEntity =>
      i29.$$TrashedLocalAssetEntityTableTableManager(
        _db,
        _db.trashedLocalAssetEntity,
      );
  i30.$$AssetEditEntityTableTableManager get assetEditEntity =>
      i30.$$AssetEditEntityTableTableManager(_db, _db.assetEditEntity);
  i31.$$SettingsEntityTableTableManager get settingsEntity =>
      i31.$$SettingsEntityTableTableManager(_db, _db.settingsEntity);
  i32.$$AssetOcrEntityTableTableManager get assetOcrEntity =>
      i32.$$AssetOcrEntityTableTableManager(_db, _db.assetOcrEntity);
}
