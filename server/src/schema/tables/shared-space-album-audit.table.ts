import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Ungated link-removal audit: one row per removed (space, album) link.
// Consumed by SharedSpaceAlbumLinkSync.getDeletes (A4). FK-less append log.
// Mirrors shared_space_library_audit.
@Table('shared_space_album_audit')
export class SharedSpaceAlbumAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
