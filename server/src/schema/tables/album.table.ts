import {
  AfterUpdateTrigger,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetOrder } from 'src/enum';
import { album_soft_delete_shared_space_album } from 'src/schema/functions';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table({ name: 'album' })
@UpdatedAtTrigger('album_updatedAt')
// gallery-fork: on album soft-delete/restore (the user-deletion trash window),
// tombstone/re-create shared_space_album grants + link rows. Body-guarded to real
// deletedAt transitions. See the function comment in schema/functions.ts.
@AfterUpdateTrigger({
  name: 'album_soft_delete_shared_space_album',
  scope: 'statement',
  referencingOldTableAs: 'old_rows',
  referencingNewTableAs: 'new_rows',
  function: album_soft_delete_shared_space_album,
})
export class AlbumTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column({ default: 'Untitled Album' })
  albumName!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @ForeignKeyColumn(() => AssetTable, {
    nullable: true,
    onDelete: 'SET NULL',
    onUpdate: 'CASCADE',
    comment: 'Asset ID to be used as thumbnail',
  })
  albumThumbnailAssetId!: string | null;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @DeleteDateColumn()
  deletedAt!: Timestamp | null;

  @Column({ type: 'boolean', default: true })
  isActivityEnabled!: Generated<boolean>;

  @Column({ default: AssetOrder.Desc })
  order!: Generated<AssetOrder>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
