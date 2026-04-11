import {
  AfterDeleteTrigger,
  AfterInsertTrigger,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { shared_space_library_after_insert_user, shared_space_library_delete_audit } from 'src/schema/functions';
import { LibraryTable } from 'src/schema/tables/library.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_library')
@UpdatedAtTrigger('shared_space_library_updatedAt')
// Populates library_user for every member of the space when a library is
// linked, and bumps library.updateId so the metadata row re-emits via
// LibrarySync.getUpserts. See
// docs/plans/2026-04-11-library-user-access-backfill-design.md.
@AfterInsertTrigger({
  name: 'shared_space_library_after_insert_user',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_library_after_insert_user,
})
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

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
