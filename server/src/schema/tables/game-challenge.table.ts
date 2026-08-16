import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
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
// The daily is generated lazily by whichever member opens the page first that day, so concurrent
// readers really do race to insert one. This partial unique index is what makes the loser fail
// rather than create a second, divergent daily for the same space and date.
@Index({
  name: 'game_challenge_daily_uq',
  columns: ['spaceId', 'dailyOn'],
  unique: true,
  where: '"dailyOn" IS NOT NULL',
})
export class GameChallengeTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  spaceId!: string;

  // Nullable, and SET NULL rather than CASCADE: a daily has no human author, and cascading meant
  // deleting a user destroyed the challenges they had created in a SHARED space along with every
  // other member's guesses and scores.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  createdById!: string | null;

  @Column()
  name!: string;

  // The UTC date this challenge is the daily for; NULL for a player-created challenge.
  @Column({ type: 'date', nullable: true })
  dailyOn!: string | null;

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
