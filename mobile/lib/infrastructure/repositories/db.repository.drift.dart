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
import 'package:immich_mobile/infrastructure/entities/shared_space_album_hidden.entity.drift.dart'
    as i11;
import 'package:immich_mobile/infrastructure/entities/remote_album.entity.drift.dart'
    as i12;
import 'package:immich_mobile/infrastructure/entities/local_album.entity.drift.dart'
    as i13;
import 'package:immich_mobile/infrastructure/entities/local_album_asset.entity.drift.dart'
    as i14;
import 'package:immich_mobile/infrastructure/entities/auth_user.entity.drift.dart'
    as i15;
import 'package:immich_mobile/infrastructure/entities/user_metadata.entity.drift.dart'
    as i16;
import 'package:immich_mobile/infrastructure/entities/partner.entity.drift.dart'
    as i17;
import 'package:immich_mobile/infrastructure/entities/exif.entity.drift.dart'
    as i18;
import 'package:immich_mobile/infrastructure/entities/remote_album_asset.entity.drift.dart'
    as i19;
import 'package:immich_mobile/infrastructure/entities/remote_album_user.entity.drift.dart'
    as i20;
import 'package:immich_mobile/infrastructure/entities/remote_asset_cloud_id.entity.drift.dart'
    as i21;
import 'package:immich_mobile/infrastructure/entities/library.entity.drift.dart'
    as i22;
import 'package:immich_mobile/infrastructure/entities/shared_space_album.entity.drift.dart'
    as i23;
import 'package:immich_mobile/infrastructure/entities/shared_space_album_folder.entity.drift.dart'
    as i24;
import 'package:immich_mobile/infrastructure/entities/memory.entity.drift.dart'
    as i25;
import 'package:immich_mobile/infrastructure/entities/memory_asset.entity.drift.dart'
    as i26;
import 'package:immich_mobile/infrastructure/entities/person.entity.drift.dart'
    as i27;
import 'package:immich_mobile/infrastructure/entities/asset_face.entity.drift.dart'
    as i28;
import 'package:immich_mobile/infrastructure/entities/store.entity.drift.dart'
    as i29;
import 'package:immich_mobile/infrastructure/entities/trashed_local_asset.entity.drift.dart'
    as i30;
import 'package:immich_mobile/infrastructure/entities/asset_edit.entity.drift.dart'
    as i31;
import 'package:immich_mobile/infrastructure/entities/settings.entity.drift.dart'
    as i32;
import 'package:immich_mobile/infrastructure/entities/asset_ocr.entity.drift.dart'
    as i33;
import 'package:immich_mobile/infrastructure/entities/merged_asset.drift.dart'
    as i34;
import 'package:drift/internal/modular.dart' as i35;

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
  late final i11.$SharedSpaceAlbumHiddenEntityTable
  sharedSpaceAlbumHiddenEntity = i11.$SharedSpaceAlbumHiddenEntityTable(this);
  late final i12.$RemoteAlbumEntityTable remoteAlbumEntity = i12
      .$RemoteAlbumEntityTable(this);
  late final i13.$LocalAlbumEntityTable localAlbumEntity = i13
      .$LocalAlbumEntityTable(this);
  late final i14.$LocalAlbumAssetEntityTable localAlbumAssetEntity = i14
      .$LocalAlbumAssetEntityTable(this);
  late final i15.$AuthUserEntityTable authUserEntity = i15.$AuthUserEntityTable(
    this,
  );
  late final i16.$UserMetadataEntityTable userMetadataEntity = i16
      .$UserMetadataEntityTable(this);
  late final i17.$PartnerEntityTable partnerEntity = i17.$PartnerEntityTable(
    this,
  );
  late final i18.$RemoteExifEntityTable remoteExifEntity = i18
      .$RemoteExifEntityTable(this);
  late final i19.$RemoteAlbumAssetEntityTable remoteAlbumAssetEntity = i19
      .$RemoteAlbumAssetEntityTable(this);
  late final i20.$RemoteAlbumUserEntityTable remoteAlbumUserEntity = i20
      .$RemoteAlbumUserEntityTable(this);
  late final i21.$RemoteAssetCloudIdEntityTable remoteAssetCloudIdEntity = i21
      .$RemoteAssetCloudIdEntityTable(this);
  late final i22.$LibraryEntityTable libraryEntity = i22.$LibraryEntityTable(
    this,
  );
  late final i23.$SharedSpaceAlbumEntityTable sharedSpaceAlbumEntity = i23
      .$SharedSpaceAlbumEntityTable(this);
  late final i24.$SharedSpaceAlbumFolderEntityTable
  sharedSpaceAlbumFolderEntity = i24.$SharedSpaceAlbumFolderEntityTable(this);
  late final i25.$MemoryEntityTable memoryEntity = i25.$MemoryEntityTable(this);
  late final i26.$MemoryAssetEntityTable memoryAssetEntity = i26
      .$MemoryAssetEntityTable(this);
  late final i27.$PersonEntityTable personEntity = i27.$PersonEntityTable(this);
  late final i28.$AssetFaceEntityTable assetFaceEntity = i28
      .$AssetFaceEntityTable(this);
  late final i29.$StoreEntityTable storeEntity = i29.$StoreEntityTable(this);
  late final i30.$TrashedLocalAssetEntityTable trashedLocalAssetEntity = i30
      .$TrashedLocalAssetEntityTable(this);
  late final i31.$AssetEditEntityTable assetEditEntity = i31
      .$AssetEditEntityTable(this);
  late final i32.$SettingsEntityTable settingsEntity = i32.$SettingsEntityTable(
    this,
  );
  late final i33.$AssetOcrEntityTable assetOcrEntity = i33.$AssetOcrEntityTable(
    this,
  );
  i34.MergedAssetDrift get mergedAssetDrift => i35.ReadDatabaseContainer(
    this,
  ).accessor<i34.MergedAssetDrift>(i34.MergedAssetDrift.new);
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
    sharedSpaceAlbumHiddenEntity,
    remoteAlbumEntity,
    localAlbumEntity,
    localAlbumAssetEntity,
    i11.idxSharedSpaceAlbumHiddenAlbumSpace,
    i5.idxSharedSpaceCreatedById,
    i10.idxSharedSpaceAlbumLinkSpace,
    i10.idxSharedSpaceAlbumLinkAlbumSpace,
    i9.idxSharedSpaceAlbumAssetAlbum,
    i9.idxSharedSpaceAlbumAssetAssetAlbum,
    i8.idxSharedSpaceLibrarySpaceId,
    i8.idxSharedSpaceLibraryLibrarySpace,
    i6.idxSharedSpaceAssetSpaceAsset,
    i6.idxSharedSpaceAssetAssetSpace,
    i14.idxLocalAlbumAssetAlbumAsset,
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
    sharedSpaceAlbumFolderEntity,
    memoryEntity,
    memoryAssetEntity,
    personEntity,
    assetFaceEntity,
    storeEntity,
    trashedLocalAssetEntity,
    assetEditEntity,
    settingsEntity,
    assetOcrEntity,
    i17.idxPartnerSharedWithId,
    i18.idxLatLng,
    i18.idxRemoteExifCity,
    i19.idxRemoteAlbumAssetAlbumAsset,
    i21.idxRemoteAssetCloudId,
    i24.idxSharedSpaceAlbumFolderSpace,
    i27.idxPersonOwnerId,
    i28.idxAssetFacePersonId,
    i28.idxAssetFaceAssetId,
    i28.idxAssetFaceVisiblePerson,
    i30.idxTrashedLocalAssetChecksum,
    i30.idxTrashedLocalAssetAlbum,
    i31.idxAssetEditAssetId,
    i33.idxAssetOcrAssetId,
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
          'shared_space_album_folder_entity',
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
  i11.$$SharedSpaceAlbumHiddenEntityTableTableManager
  get sharedSpaceAlbumHiddenEntity =>
      i11.$$SharedSpaceAlbumHiddenEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumHiddenEntity,
      );
  i12.$$RemoteAlbumEntityTableTableManager get remoteAlbumEntity =>
      i12.$$RemoteAlbumEntityTableTableManager(_db, _db.remoteAlbumEntity);
  i13.$$LocalAlbumEntityTableTableManager get localAlbumEntity =>
      i13.$$LocalAlbumEntityTableTableManager(_db, _db.localAlbumEntity);
  i14.$$LocalAlbumAssetEntityTableTableManager get localAlbumAssetEntity => i14
      .$$LocalAlbumAssetEntityTableTableManager(_db, _db.localAlbumAssetEntity);
  i15.$$AuthUserEntityTableTableManager get authUserEntity =>
      i15.$$AuthUserEntityTableTableManager(_db, _db.authUserEntity);
  i16.$$UserMetadataEntityTableTableManager get userMetadataEntity =>
      i16.$$UserMetadataEntityTableTableManager(_db, _db.userMetadataEntity);
  i17.$$PartnerEntityTableTableManager get partnerEntity =>
      i17.$$PartnerEntityTableTableManager(_db, _db.partnerEntity);
  i18.$$RemoteExifEntityTableTableManager get remoteExifEntity =>
      i18.$$RemoteExifEntityTableTableManager(_db, _db.remoteExifEntity);
  i19.$$RemoteAlbumAssetEntityTableTableManager get remoteAlbumAssetEntity =>
      i19.$$RemoteAlbumAssetEntityTableTableManager(
        _db,
        _db.remoteAlbumAssetEntity,
      );
  i20.$$RemoteAlbumUserEntityTableTableManager get remoteAlbumUserEntity => i20
      .$$RemoteAlbumUserEntityTableTableManager(_db, _db.remoteAlbumUserEntity);
  i21.$$RemoteAssetCloudIdEntityTableTableManager
  get remoteAssetCloudIdEntity =>
      i21.$$RemoteAssetCloudIdEntityTableTableManager(
        _db,
        _db.remoteAssetCloudIdEntity,
      );
  i22.$$LibraryEntityTableTableManager get libraryEntity =>
      i22.$$LibraryEntityTableTableManager(_db, _db.libraryEntity);
  i23.$$SharedSpaceAlbumEntityTableTableManager get sharedSpaceAlbumEntity =>
      i23.$$SharedSpaceAlbumEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumEntity,
      );
  i24.$$SharedSpaceAlbumFolderEntityTableTableManager
  get sharedSpaceAlbumFolderEntity =>
      i24.$$SharedSpaceAlbumFolderEntityTableTableManager(
        _db,
        _db.sharedSpaceAlbumFolderEntity,
      );
  i25.$$MemoryEntityTableTableManager get memoryEntity =>
      i25.$$MemoryEntityTableTableManager(_db, _db.memoryEntity);
  i26.$$MemoryAssetEntityTableTableManager get memoryAssetEntity =>
      i26.$$MemoryAssetEntityTableTableManager(_db, _db.memoryAssetEntity);
  i27.$$PersonEntityTableTableManager get personEntity =>
      i27.$$PersonEntityTableTableManager(_db, _db.personEntity);
  i28.$$AssetFaceEntityTableTableManager get assetFaceEntity =>
      i28.$$AssetFaceEntityTableTableManager(_db, _db.assetFaceEntity);
  i29.$$StoreEntityTableTableManager get storeEntity =>
      i29.$$StoreEntityTableTableManager(_db, _db.storeEntity);
  i30.$$TrashedLocalAssetEntityTableTableManager get trashedLocalAssetEntity =>
      i30.$$TrashedLocalAssetEntityTableTableManager(
        _db,
        _db.trashedLocalAssetEntity,
      );
  i31.$$AssetEditEntityTableTableManager get assetEditEntity =>
      i31.$$AssetEditEntityTableTableManager(_db, _db.assetEditEntity);
  i32.$$SettingsEntityTableTableManager get settingsEntity =>
      i32.$$SettingsEntityTableTableManager(_db, _db.settingsEntity);
  i33.$$AssetOcrEntityTableTableManager get assetOcrEntity =>
      i33.$$AssetOcrEntityTableTableManager(_db, _db.assetOcrEntity);
}
