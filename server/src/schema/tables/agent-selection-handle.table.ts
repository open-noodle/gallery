import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import { UpdateIdColumn } from 'src/decorators';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import { AgentToolCallTable } from 'src/schema/tables/agent-tool-call.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('agent_selection_handle')
@Index({ columns: ['sessionId', 'userId', 'expiresAt'] })
@Index({ columns: ['sourceToolCallId'] })
export class AgentSelectionHandleTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @ForeignKeyColumn(() => AgentToolCallTable, { onUpdate: 'CASCADE', onDelete: 'SET NULL', nullable: true })
  sourceToolCallId!: string | null;

  @Column({ type: 'jsonb' })
  assetIds!: string[];

  @Column({ type: 'integer' })
  assetCount!: number;

  @Column({ type: 'jsonb' })
  sampleAssetIds!: string[];

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Timestamp;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
