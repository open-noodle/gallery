import { AfterDeleteTrigger, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { shared_space_library_delete_audit } from 'src/schema/functions';
import { LibraryTable } from 'src/schema/tables/library.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_library')
// Fan-out trigger: on unlinking (direct or via cascade from library/shared_space
// deletion) emits rows to library_audit (per user who loses access) and
// shared_space_library_audit (the join-row delete). The function body is the
// single source of truth for both audit streams.
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_library_delete_audit,
  referencingOldTableAs: 'old',
})
export class SharedSpaceLibraryTable {
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', primary: true, index: false })
  spaceId!: string;

  @ForeignKeyColumn(() => LibraryTable, { onDelete: 'CASCADE', primary: true })
  libraryId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  addedById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
