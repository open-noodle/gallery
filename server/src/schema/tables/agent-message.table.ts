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
import { AgentMessageRole } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';
import type { AgentMessageContent } from 'src/types/agent-message.types';

@Index({ columns: ['sessionId', 'createdAt', 'id'] })
@Table('agent_message')
export class AgentMessageTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  sessionId!: string;

  @Column()
  role!: AgentMessageRole;

  @Column({ type: 'jsonb' })
  content!: AgentMessageContent;

  @Column({ nullable: true })
  providerMessageId!: string | null;

  @Column({ type: 'uuid', nullable: true })
  toolCallId!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
