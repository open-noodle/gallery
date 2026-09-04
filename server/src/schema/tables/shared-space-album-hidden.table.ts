import {
  AfterDeleteTrigger,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  ForeignKeyConstraint,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { shared_space_album_hidden_delete_audit } from 'src/schema/functions';
import { SharedSpaceAlbumTable } from 'src/schema/tables/shared-space-album.table';
import { UserTable } from 'src/schema/tables/user.table';

// gallery-fork (#1041): "this album does not appear in MY timeline" — per member, per linked album.
//
// SPARSE: a row exists only when that member has hidden that album. Absence means shown. A dense
// table would be members x albums and would need the trigger fan-out shared_space_album_user carries.
//
// NOT shared_space_album.showInTimeline, which stays a SHARED, editor-settable flag governing the
// space's own Photos tab. This one is private to its owner, which is what makes it safe for it to
// subtract the owner's own photos.
@Table('shared_space_album_hidden')
@UpdatedAtTrigger('shared_space_album_hidden_updatedAt')
// One constraint covers three cleanup cases: unlinking the album from the space, deleting the space,
// and deleting the album — the latter two cascade into shared_space_album first, which cascades here.
// Column-level FKs to shared_space/album would therefore be redundant, so spaceId/albumId are plain
// columns. Only userId needs its own FK: no path from the link row reaches the user.
@ForeignKeyConstraint({
  columns: ['spaceId', 'albumId'],
  referenceTable: () => SharedSpaceAlbumTable,
  referenceColumns: ['spaceId', 'albumId'],
  onUpdate: 'NO ACTION',
  onDelete: 'CASCADE',
})
@AfterDeleteTrigger({
  scope: 'statement',
  function: shared_space_album_hidden_delete_audit,
  referencingOldTableAs: 'old',
})
export class SharedSpaceAlbumHiddenTable {
  @Column({ type: 'uuid', primary: true })
  spaceId!: string;

  @Column({ type: 'uuid', primary: true, index: true })
  albumId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  userId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
