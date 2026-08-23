import {
  AfterDeleteTrigger,
  AfterInsertTrigger,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { shared_space_album_after_insert_user, shared_space_album_delete_audit } from 'src/schema/functions';
import { AlbumTable } from 'src/schema/tables/album.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_album')
@UpdatedAtTrigger('shared_space_album_updatedAt')
// Populates shared_space_album_user for every member of the space when an album
// is linked, and bumps album.updateId so the metadata row re-emits via
// AlbumSync. See specs/2026-06-15-space-albums-phase2a-server-sync-design.md.
@AfterInsertTrigger({
  name: 'shared_space_album_after_insert_user',
  scope: 'statement',
  referencingNewTableAs: 'inserted_rows',
  function: shared_space_album_after_insert_user,
})
// Fan-out trigger: on unlinking (direct or via cascade from album/shared_space
// deletion) emits rows to shared_space_album_audit (the join-row delete, ungated)
// and shared_space_album_user_audit (per user who loses access, gated).
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_album_delete_audit,
  referencingOldTableAs: 'old',
})
export class SharedSpaceAlbumTable {
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', primary: true, index: false })
  spaceId!: string;

  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', primary: true })
  albumId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  addedById!: string | null;

  // Whether this album's photos appear in the aggregated space timeline.
  @Column({ type: 'boolean', default: true })
  showInTimeline!: Generated<boolean>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
