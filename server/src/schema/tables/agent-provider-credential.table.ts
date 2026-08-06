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
import { AgentProviderType } from 'src/enum';
import { UserTable } from 'src/schema/tables/user.table';

@Index({ columns: ['userId'] })
@Table('agent_provider_credential')
@UpdatedAtTrigger('agent_provider_credential_updatedAt')
export class AgentProviderCredentialTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onUpdate: 'CASCADE', onDelete: 'CASCADE' })
  userId!: string;

  @Column()
  providerType!: AgentProviderType;

  @Column()
  label!: string;

  @Column({ nullable: true })
  baseUrl!: string | null;

  @Column({ type: 'text' })
  encryptedSecret!: string;

  @Column({ type: 'integer', default: 1 })
  secretVersion!: Generated<number>;

  @Column({ array: true, type: 'character varying' })
  models!: string[];

  @Column({ nullable: true })
  defaultModel!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  lastUsedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
