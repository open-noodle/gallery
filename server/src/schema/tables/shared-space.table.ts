import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  TriggerFunction,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { shared_space_delete_audit, shared_space_delete_library_audit } from 'src/schema/functions';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space')
@UpdatedAtTrigger('shared_space_updatedAt')
// BEFORE DELETE row-level so the trigger sees shared_space_member rows that the
// cascade is about to remove. See shared_space_delete_audit body for the dedup logic.
@TriggerFunction({
  timing: 'before',
  actions: ['delete'],
  scope: 'row',
  function: shared_space_delete_audit,
})
// Gallery-fork PR 2: BEFORE-row trigger so shared_space_library and
// shared_space_member rows are still visible when fanning out library_audit on
// space deletion. The companion AFTER triggers on shared_space_library and
// shared_space_member skip during this cascade via EXISTS shared_space guards.
@TriggerFunction({
  timing: 'before',
  actions: ['delete'],
  scope: 'row',
  function: shared_space_delete_library_audit,
})
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

  @Column({ type: 'character varying', length: 20, nullable: true })
  color!: string | null;

  @Column({ type: 'integer', nullable: true })
  thumbnailCropY!: number | null;

  @Column({ type: 'boolean', default: true })
  faceRecognitionEnabled!: Generated<boolean>;

  @Column({ type: 'boolean', default: true })
  petsEnabled!: Generated<boolean>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastActivityAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
