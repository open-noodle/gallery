import { AlbumSpaceAssetAuditTable } from 'src/schema/tables/album-space-asset-audit.table.js';
import { AlbumSpaceAssetTable } from 'src/schema/tables/album-space-asset.table.js';
import { AssetDuplicateChecksumTable } from 'src/schema/tables/asset-duplicate-checksum.table.js';
import { AssetFavoriteAuditTable } from 'src/schema/tables/asset-favorite-audit.table.js';
import { AssetFavoriteTable } from 'src/schema/tables/asset-favorite.table.js';
import { FaceIdentityFaceTable } from 'src/schema/tables/face-identity-face.table.js';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table.js';
import { FacePersonVerdictTable } from 'src/schema/tables/face-person-verdict.table.js';
import { FaceRepairDeclineTable } from 'src/schema/tables/face-repair-decline.table.js';
import { FaceRepairScanFlaggedFaceTable } from 'src/schema/tables/face-repair-scan-flagged-face.table.js';
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table.js';
import { LibraryAssetAuditTable } from 'src/schema/tables/library-asset-audit.table.js';
import { LibraryAuditTable } from 'src/schema/tables/library-audit.table.js';
import { LibraryUserTable } from 'src/schema/tables/library-user.table.js';
import { PetSearchTable } from 'src/schema/tables/pet-search.table.js';
import { SharedSpaceActivityTable } from 'src/schema/tables/shared-space-activity.table.js';
import { SharedSpaceAlbumAssetAuditTable } from 'src/schema/tables/shared-space-album-asset-audit.table.js';
import { SharedSpaceAlbumAuditTable } from 'src/schema/tables/shared-space-album-audit.table.js';
import { SharedSpaceAlbumFolderAuditTable } from 'src/schema/tables/shared-space-album-folder-audit.table.js';
import { SharedSpaceAlbumFolderTable } from 'src/schema/tables/shared-space-album-folder.table.js';
import { SharedSpaceAlbumHiddenAuditTable } from 'src/schema/tables/shared-space-album-hidden-audit.table.js';
import { SharedSpaceAlbumHiddenTable } from 'src/schema/tables/shared-space-album-hidden.table.js';
import { SharedSpaceAlbumUserAuditTable } from 'src/schema/tables/shared-space-album-user-audit.table.js';
import { SharedSpaceAlbumUserTable } from 'src/schema/tables/shared-space-album-user.table.js';
import { SharedSpaceAlbumTable } from 'src/schema/tables/shared-space-album.table.js';
import { SharedSpaceAssetAuditTable } from 'src/schema/tables/shared-space-asset-audit.table.js';
import { SharedSpaceAssetTable } from 'src/schema/tables/shared-space-asset.table.js';
import { SharedSpaceAuditTable } from 'src/schema/tables/shared-space-audit.table.js';
import { SharedSpaceFaceMatchBackfillTargetTable } from 'src/schema/tables/shared-space-face-match-backfill-target.table.js';
import { SharedSpaceLibraryAssetAuditTable } from 'src/schema/tables/shared-space-library-asset-audit.table.js';
import { SharedSpaceLibraryAuditTable } from 'src/schema/tables/shared-space-library-audit.table.js';
import { SharedSpaceLibraryTable } from 'src/schema/tables/shared-space-library.table.js';
import { SharedSpaceMemberAuditTable } from 'src/schema/tables/shared-space-member-audit.table.js';
import { SharedSpaceMemberTable } from 'src/schema/tables/shared-space-member.table.js';
import { SharedSpacePersonAliasTable } from 'src/schema/tables/shared-space-person-alias.table.js';
import { SharedSpacePersonFaceTable } from 'src/schema/tables/shared-space-person-face.table.js';
import { SharedSpacePersonTable } from 'src/schema/tables/shared-space-person.table.js';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table.js';
import { StorageMigrationLogTable } from 'src/schema/tables/storage-migration-log.table.js';
import { UserGroupMemberTable } from 'src/schema/tables/user-group-member.table.js';
import { UserGroupTable } from 'src/schema/tables/user-group.table.js';

// Gallery fork tables, spread into ImmichDatabase.tables and merged into DB by src/schema/index.ts.
export const galleryTables = [
  AlbumSpaceAssetTable,
  AlbumSpaceAssetAuditTable,
  AssetDuplicateChecksumTable,
  AssetFavoriteTable,
  AssetFavoriteAuditTable,
  FaceIdentityTable,
  FaceIdentityFaceTable,
  FaceRepairDeclineTable,
  FaceRepairScanFlaggedFaceTable,
  FaceRepairScanTable,
  LibraryAuditTable,
  LibraryUserTable,
  LibraryAssetAuditTable,
  FacePersonVerdictTable,
  PetSearchTable,
  SharedSpaceTable,
  SharedSpaceAuditTable,
  SharedSpaceMemberTable,
  SharedSpaceMemberAuditTable,
  SharedSpaceAssetTable,
  SharedSpaceAssetAuditTable,
  SharedSpaceFaceMatchBackfillTargetTable,
  SharedSpaceAlbumTable,
  SharedSpaceAlbumAuditTable,
  SharedSpaceAlbumAssetAuditTable,
  SharedSpaceAlbumFolderTable,
  SharedSpaceAlbumFolderAuditTable,
  SharedSpaceAlbumUserTable,
  SharedSpaceAlbumUserAuditTable,
  SharedSpaceAlbumHiddenTable,
  SharedSpaceAlbumHiddenAuditTable,
  SharedSpaceLibraryTable,
  SharedSpaceLibraryAuditTable,
  SharedSpaceLibraryAssetAuditTable,
  SharedSpaceActivityTable,
  SharedSpacePersonTable,
  SharedSpacePersonFaceTable,
  SharedSpacePersonAliasTable,
  UserGroupTable,
  UserGroupMemberTable,
  StorageMigrationLogTable,
];

export interface GalleryDB {
  album_space_asset: AlbumSpaceAssetTable;
  album_space_asset_audit: AlbumSpaceAssetAuditTable;
  asset_duplicate_checksum: AssetDuplicateChecksumTable;
  asset_favorite: AssetFavoriteTable;
  asset_favorite_audit: AssetFavoriteAuditTable;
  face_identity: FaceIdentityTable;
  face_identity_face: FaceIdentityFaceTable;
  face_repair_decline: FaceRepairDeclineTable;
  face_repair_scan_flagged_face: FaceRepairScanFlaggedFaceTable;
  face_repair_scan: FaceRepairScanTable;
  library_audit: LibraryAuditTable;
  library_user: LibraryUserTable;
  library_asset_audit: LibraryAssetAuditTable;
  face_person_verdict: FacePersonVerdictTable;
  pet_search: PetSearchTable;
  shared_space: SharedSpaceTable;
  shared_space_audit: SharedSpaceAuditTable;
  shared_space_member: SharedSpaceMemberTable;
  shared_space_member_audit: SharedSpaceMemberAuditTable;
  shared_space_asset: SharedSpaceAssetTable;
  shared_space_asset_audit: SharedSpaceAssetAuditTable;
  shared_space_face_match_backfill_target: SharedSpaceFaceMatchBackfillTargetTable;
  shared_space_album: SharedSpaceAlbumTable;
  shared_space_album_audit: SharedSpaceAlbumAuditTable;
  shared_space_album_asset_audit: SharedSpaceAlbumAssetAuditTable;
  shared_space_album_folder: SharedSpaceAlbumFolderTable;
  shared_space_album_folder_audit: SharedSpaceAlbumFolderAuditTable;
  shared_space_album_user: SharedSpaceAlbumUserTable;
  shared_space_album_user_audit: SharedSpaceAlbumUserAuditTable;
  shared_space_album_hidden: SharedSpaceAlbumHiddenTable;
  shared_space_album_hidden_audit: SharedSpaceAlbumHiddenAuditTable;
  shared_space_library: SharedSpaceLibraryTable;
  shared_space_library_audit: SharedSpaceLibraryAuditTable;
  shared_space_library_asset_audit: SharedSpaceLibraryAssetAuditTable;
  shared_space_activity: SharedSpaceActivityTable;
  shared_space_person: SharedSpacePersonTable;
  shared_space_person_face: SharedSpacePersonFaceTable;
  shared_space_person_alias: SharedSpacePersonAliasTable;
  user_group: UserGroupTable;
  user_group_member: UserGroupMemberTable;
  storage_migration_log: StorageMigrationLogTable;
}
