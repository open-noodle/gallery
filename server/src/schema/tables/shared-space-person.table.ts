import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';

@Table('shared_space_person')
@UpdatedAtTrigger('shared_space_person_updatedAt')
@Index({ name: 'shared_space_person_spaceId_idx', columns: ['spaceId'] })
@Index({ name: 'shared_space_person_space_count_idx', columns: ['spaceId', 'isHidden', 'assetCount'] })
export class SharedSpacePersonTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', index: false })
  spaceId!: string;

  @Column({ default: '', type: 'character varying' })
  name!: Generated<string>;

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'SET NULL', nullable: true })
  representativeFaceId!: string | null;

  @Column({ type: 'boolean', default: false })
  isHidden!: Generated<boolean>;

  @Column({ type: 'character varying', default: 'person' })
  type!: Generated<string>;

  @Column({ type: 'date', nullable: true })
  birthDate!: string | null;

  @Column({ type: 'integer', default: 0 })
  faceCount!: Generated<number>;

  @Column({ type: 'integer', default: 0 })
  assetCount!: Generated<number>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
