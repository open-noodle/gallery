import { CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { CreateIdColumn } from 'src/decorators';
import { AlbumTable } from 'src/schema/tables/album.table';
import { UserTable } from 'src/schema/tables/user.table';

// Internal, write-once (userId, albumId) album-access grant with a per-user
// createId watermark. Trigger-maintained (A2/A3); never user-facing; never
// album_user. Drives SharedSpaceAlbumSync.getCreatedAfter (the per-album asset
// backfill loop). Mirrors library_user.
//
// See specs/2026-06-15-space-albums-phase2a-server-sync-design.md §4.1.
@Table({ name: 'shared_space_album_user' })
@Index({ name: 'shared_space_album_user_userId_createId_idx', columns: ['userId', 'createId'] })
export class SharedSpaceAlbumUserTable {
  @ForeignKeyColumn(() => UserTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  userId!: string;

  @ForeignKeyColumn(() => AlbumTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  albumId!: string;

  @CreateIdColumn()
  createId!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
