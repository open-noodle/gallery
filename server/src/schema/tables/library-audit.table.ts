import { AfterInsertTrigger, Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { library_user_delete_after_audit } from 'src/schema/functions';

@Table('library_audit')
// When audit rows land, drop the corresponding library_user rows. See
// docs/plans/2026-04-11-library-user-access-backfill-design.md.
@AfterInsertTrigger({
  name: 'library_user_delete_after_audit',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: library_user_delete_after_audit,
})
export class LibraryAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  libraryId!: string;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
