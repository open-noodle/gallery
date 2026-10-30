import { Column, CreateDateColumn, ForeignKeyColumn, type Generated, Table, Timestamp } from '@immich/sql-tools';
import { CleanupDecisionType, CleanupQueue } from 'src/enum.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// gallery-fork: Library Cleanup (specs/2026-09-23-library-cleanup-design.md)
// "keep" decisions per queue so queues drain to zero.
@Table('cleanup_decision')
export class CleanupDecisionTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  userId!: string;

  @Column({ type: 'character varying', primary: true })
  queue!: CleanupQueue;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'character varying', default: CleanupDecisionType.Keep })
  decision!: Generated<CleanupDecisionType>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
