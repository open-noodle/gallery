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
import { AgentToolApprovalDecision, AgentToolCallStatus, AgentToolDataClass, AgentToolName } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import type {
  AgentToolProviderSnapshot,
  AgentToolRequestMetadata,
  AgentToolResponseMetadata,
} from 'src/types/agent-tool.types';

@Index({ columns: ['sessionId', 'status'] })
@Index({ columns: ['sessionId', 'startedAt', 'id'] })
@Table('agent_tool_call')
export class AgentToolCallTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column()
  toolName!: AgentToolName;

  @Column()
  status!: AgentToolCallStatus;

  @Column({ nullable: true })
  approvalDecision!: AgentToolApprovalDecision | null;

  @Column({ type: 'text' })
  requestSummary!: string;

  @Column({ type: 'text', nullable: true })
  responseSummary!: string | null;

  @Column({ type: 'jsonb' })
  redactedRequestMetadata!: AgentToolRequestMetadata;

  @Column({ type: 'jsonb', nullable: true })
  redactedResponseMetadata!: AgentToolResponseMetadata | null;

  @Column()
  dataClass!: AgentToolDataClass;

  @Column({ type: 'integer' })
  assetCount!: number;

  @Column({ type: 'integer' })
  albumCount!: number;

  @Column({ type: 'jsonb' })
  providerSnapshot!: AgentToolProviderSnapshot;

  @CreateDateColumn()
  startedAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  completedAt!: Timestamp | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;
}
