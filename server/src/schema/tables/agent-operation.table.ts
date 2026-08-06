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
import { AgentOperationRiskLevel, AgentOperationStatus, AgentOperationTargetKind, AgentOperationType } from 'src/enum';
import { AgentOperationPlanTable } from 'src/schema/tables/agent-operation-plan.table';
import type { AgentOperationPayload, AgentOperationResult } from 'src/types/agent-operation.types';

@Table('agent_operation')
@UpdatedAtTrigger('agent_operation_updatedAt')
@Index({ columns: ['planId'] })
@Index({ columns: ['planId', 'status'] })
@Index({ columns: ['planId', 'position'] })
export class AgentOperationTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AgentOperationPlanTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE', index: false })
  planId!: string;

  @Column()
  type!: AgentOperationType;

  @Column({ type: 'integer' })
  position!: number;

  @Column({ type: 'text' })
  summary!: string;

  @Column()
  targetKind!: AgentOperationTargetKind;

  @Column({ type: 'uuid', nullable: true })
  targetId!: string | null;

  @Column({ nullable: true })
  temporaryTargetId!: string | null;

  @Column({ type: 'jsonb' })
  assetIds!: string[];

  @Column({ type: 'jsonb' })
  payload!: AgentOperationPayload;

  @Column({ type: 'jsonb' })
  dependencyIds!: string[];

  @Column({ default: AgentOperationRiskLevel.Low })
  riskLevel!: Generated<AgentOperationRiskLevel>;

  @Column({ type: 'boolean', default: true })
  enabled!: Generated<boolean>;

  @Column({ default: AgentOperationStatus.Proposed })
  status!: Generated<AgentOperationStatus>;

  @Column({ type: 'jsonb', nullable: true })
  result!: AgentOperationResult | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
