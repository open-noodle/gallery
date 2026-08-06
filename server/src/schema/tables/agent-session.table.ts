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
import { AgentApprovalMode, AgentPermissionPreset, AgentSessionStatus } from 'src/enum';
import { AgentProviderCredentialTable } from 'src/schema/tables/agent-provider-credential.table';
import { UserTable } from 'src/schema/tables/user.table';
import type {
  AgentCredentialSnapshot,
  AgentInitialContextSnapshot,
  AgentModelSnapshot,
  AgentPermissionPlanSnapshot,
  AgentRunnerCapabilitiesSnapshot,
  AgentWorkflowStateSnapshot,
} from 'src/types/agent-session.types';

@Index({ columns: ['userId'] })
@Index({ columns: ['userId', 'status'] })
@Table('agent_session')
@UpdatedAtTrigger('agent_session_updatedAt')
export class AgentSessionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @ForeignKeyColumn(() => AgentProviderCredentialTable, { onUpdate: 'CASCADE', onDelete: 'SET NULL', nullable: true })
  providerCredentialId!: string | null;

  @Column({ type: 'jsonb' })
  credentialSnapshot!: AgentCredentialSnapshot;

  @Column({ type: 'jsonb' })
  modelSnapshot!: AgentModelSnapshot;

  @Column()
  permissionPreset!: AgentPermissionPreset;

  @Column({ type: 'jsonb' })
  permissionPlanSnapshot!: AgentPermissionPlanSnapshot;

  @Column()
  approvalMode!: AgentApprovalMode;

  @Column({ nullable: true })
  runnerEndpoint!: string | null;

  @Column({ nullable: true })
  runnerSessionId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  runnerCapabilitiesSnapshot!: AgentRunnerCapabilitiesSnapshot;

  @Column({ type: 'jsonb', nullable: true })
  workflowState!: AgentWorkflowStateSnapshot;

  @Column({ default: AgentSessionStatus.Created })
  status!: Generated<AgentSessionStatus>;

  @Column({ type: 'jsonb' })
  initialContextSnapshot!: AgentInitialContextSnapshot;

  @Column({ nullable: true })
  title!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  endedAt!: Timestamp | null;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
