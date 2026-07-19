import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Delete-audit for album_space_asset cross-owner contributions (#764). Trigger-driven
// (album_space_asset_delete_audit fires AFTER DELETE ... FOR EACH STATEMENT), so it captures BOTH
// explicit contribution removal (AlbumService.removeAssets) AND every FK cascade (asset/album/space
// delete). `id` is a UUIDv7 in the same watermark domain as album_asset_audit.id, so the
// SharedSpaceAlbumToAssetSync delete stream can UNION all three audit arms under one ORDER BY id.
//
// Distinct from #752's shared_space_album_asset_audit (which audits normal album_asset membership).
@Table('album_space_asset_audit')
@Index({ name: 'album_space_asset_audit_albumId_id_idx', columns: ['albumId', 'id'] })
export class AlbumSpaceAssetAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  assetId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
