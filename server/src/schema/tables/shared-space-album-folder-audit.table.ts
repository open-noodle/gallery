import { Column, CreateDateColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Ungated folder-removal audit: one row per deleted folder. Consumed by
// SharedSpaceAlbumFolderSync.getDeletes. FK-less append log, mirroring
// shared_space_album_audit.
//
// All three payload columns are load-bearing: `id` is the sync CURSOR (its own uuidv7, NOT the
// folder's id), `spaceId` is what getDeletes gates on via accessibleSpaces, and `folderId` tells
// the client which folder to drop.
@Table('shared_space_album_folder_audit')
export class SharedSpaceAlbumFolderAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  spaceId!: string;

  @Column({ type: 'uuid', index: true })
  folderId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
