import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

@Table('shared_space_album_asset_audit')
// gaps-7: SharedSpaceAlbumToAssetSync.getDeletes scans by albumId IN (...) AND id > ack AND id <
// nowId. A composite (albumId, id) index serves the filter-by-album + id-range-scan directly
// instead of a bitmap-OR of the single-column albumId index plus an in-memory sort on id.
@Index({ name: 'shared_space_album_asset_audit_albumId_id_idx', columns: ['albumId', 'id'] })
export class SharedSpaceAlbumAssetAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  assetId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
