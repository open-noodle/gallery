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
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_space_album_folder')
@UpdatedAtTrigger('shared_space_album_folder_updatedAt')
@Index({ name: 'shared_space_album_folder_spaceId_idx', columns: ['spaceId'] })
@Index({
  name: 'shared_space_album_folder_parentId_idx',
  columns: ['parentId'],
  where: '"parentId" IS NOT NULL',
})
// Sibling names are unique case-insensitively. This needs TWO partial indexes rather than one
// index over (spaceId, parentId, lower(name)): Postgres treats NULL parents as distinct, and
// NULLS NOT DISTINCT is PG15+ while Gallery targets PG14. Without the root-scoped index below,
// two root folders could both be called "Trips".
@Index({
  name: 'shared_space_album_folder_nested_name_key',
  unique: true,
  expression: `"spaceId", "parentId", LOWER(BTRIM("name"))`,
  where: '"parentId" IS NOT NULL',
})
@Index({
  name: 'shared_space_album_folder_root_name_key',
  unique: true,
  expression: `"spaceId", LOWER(BTRIM("name"))`,
  where: '"parentId" IS NULL',
})
export class SharedSpaceAlbumFolderTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', index: false })
  spaceId!: string;

  // Self-referencing adjacency list, same shape as TagTable.parentId. CASCADE is only ever
  // exercised by a direct SQL delete or by space deletion — the service promotes children
  // one level up inside a transaction before deleting a folder (see deleteAlbumFolder).
  @ForeignKeyColumn(() => SharedSpaceAlbumFolderTable, {
    nullable: true,
    onDelete: 'CASCADE',
    index: false,
  })
  parentId!: string | null;

  @Column({ type: 'character varying' })
  name!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  // Unused by web. Deliberate hedge so the mobile-parity spec can add a sync entity
  // without a second migration.
  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
