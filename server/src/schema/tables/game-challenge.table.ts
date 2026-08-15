import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

// One playable challenge: a frozen set of rounds drawn from a single shared space.
//
// scaleKm / scaleDays are FROZEN at generation. Scoring divides by them, so
// recomputing later - as the space gains photos - would silently rewrite the
// meaning of every score already recorded against this challenge.
@Table('game_challenge')
@UpdatedAtTrigger('game_challenge_updatedAt')
export class GameChallengeTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  spaceId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  createdById!: string;

  @Column()
  name!: string;

  @Column({ type: 'integer' })
  roundCount!: number;

  @Column({ type: 'double precision' })
  scaleKm!: number;

  @Column({ type: 'integer' })
  scaleDays!: number;

  @Column({ type: 'timestamp with time zone', nullable: true })
  closedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
