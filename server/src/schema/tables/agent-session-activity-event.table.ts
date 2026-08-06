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
import {
  AgentSessionActivityEventKind,
  AgentSessionActivityEventSource,
  AgentSessionActivityEventStatus,
} from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';

export type AgentSessionActivityEventCounts = {
  total?: number;
  applied?: number;
  skipped?: number;
  failed?: number;
};

@Index({ columns: ['sessionId', 'createdAt', 'id'] })
@Table('agent_session_activity_event')
export class AgentSessionActivityEventTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column()
  kind!: AgentSessionActivityEventKind;

  @Column()
  status!: AgentSessionActivityEventStatus;

  @Column()
  source!: AgentSessionActivityEventSource;

  @Column({ type: 'text', nullable: true })
  summary!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  counts!: AgentSessionActivityEventCounts | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
