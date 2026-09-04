import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Append-only delete log for shared_space_album_hidden. Unhiding an album is a ROW DELETE,
// so without this a synced client would never learn the row went away. FK-less by design
// (the referenced rows are already gone). Mirrors shared_space_album_user_audit.
@Table('shared_space_album_hidden_audit')
// The delete stream scans by userId equality plus an id range; a composite index serves both
// without an in-memory sort. Same reasoning as shared_space_album_user_audit_userId_id_idx.
@Index({ name: 'shared_space_album_hidden_audit_userId_id_idx', columns: ['userId', 'id'] })
export class SharedSpaceAlbumHiddenAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
