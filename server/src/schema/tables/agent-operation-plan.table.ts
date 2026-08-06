import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AgentOperationPlanStatus } from 'src/enum';
import { AgentSessionTable } from 'src/schema/tables/agent-session.table';

@Table('agent_operation_plan')
@UpdatedAtTrigger('agent_operation_plan_updatedAt')
@Unique({ name: 'agent_operation_plan_sessionId_revision_key', columns: ['sessionId', 'revision'] })
@Index({ columns: ['sessionId', 'status'] })
export class AgentOperationPlanTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentSessionTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', index: false })
  sessionId!: string;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ default: AgentOperationPlanStatus.Proposed })
  status!: Generated<AgentOperationPlanStatus>;

  @Column({ type: 'text' })
  summary!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
