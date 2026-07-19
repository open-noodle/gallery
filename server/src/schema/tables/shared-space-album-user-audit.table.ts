import { AfterInsertTrigger, Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { shared_space_album_user_delete_after_audit } from 'src/schema/functions';

// Gated grant-revocation audit: one row per (album, user) who has lost all
// paths. The consumer trigger shared_space_album_user_delete_after_audit
// (AFTER INSERT on this table) deletes the grant row; SharedSpaceAlbumSync.getDeletes
// (A4) also reads it. FK-less append log. Mirrors library_audit.
@Table('shared_space_album_user_audit')
// When audit rows land, drop the corresponding shared_space_album_user rows.
@AfterInsertTrigger({
  name: 'shared_space_album_user_delete_after_audit',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_album_user_delete_after_audit,
})
// gaps-7: SharedSpaceAlbumSync.getDeletes scans by userId = ? AND id range. A composite
// (userId, id) index serves the equality + range scan without an in-memory sort.
@Index({ name: 'shared_space_album_user_audit_userId_id_idx', columns: ['userId', 'id'] })
export class SharedSpaceAlbumUserAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  albumId!: string;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
