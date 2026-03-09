import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space')
@UpdatedAtTrigger('shared_space_updatedAt')
export class SharedSpaceTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column({ type: 'text' })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', nullable: false })
  createdById!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', nullable: true })
  thumbnailAssetId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
