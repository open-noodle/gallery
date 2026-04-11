import { CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { CreateIdColumn } from 'src/decorators';
import { LibraryTable } from 'src/schema/tables/library.table';
import { UserTable } from 'src/schema/tables/user.table';

// Denormalized (userId, libraryId) access-grant table with a per-user createId.
// Drives LibrarySync.getCreatedAfter so users who gain access to pre-existing
// libraries via shared-space links correctly receive library metadata and
// asset backfill on next sync.
//
// See docs/plans/2026-04-11-library-user-access-backfill-design.md for the
// full design, triggers, and migration backfill strategy.
@Table({ name: 'library_user' })
// Hot-path index: LibrarySync.getCreatedAfter filters by userId then createId,
// so a composite leading with userId lets the planner seek directly to the
// user's slice and walk sorted. PK (userId, libraryId) doesn't serve this
// query because it's ordered on the wrong column.
@Index({ name: 'library_user_userId_createId_idx', columns: ['userId', 'createId'] })
export class LibraryUserTable {
  @ForeignKeyColumn(() => UserTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    // The composite (userId, createId) index above already serves the
    // userId-leading hot-path query — no need for a standalone index.
    index: false,
  })
  userId!: string;

  @ForeignKeyColumn(() => LibraryTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    // No query uses libraryId as the leading column on this table; the
    // consumer trigger and migration backfill all join through PK.
    index: false,
  })
  libraryId!: string;

  // No standalone index — the composite (userId, createId) above is what the
  // query planner uses.
  @CreateIdColumn()
  createId!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
