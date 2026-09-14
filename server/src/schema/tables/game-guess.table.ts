import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp, Unique } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { GameRoundTable } from 'src/schema/tables/game-round.table';
import { UserTable } from 'src/schema/tables/user.table';

// One player's answer to one round. Final: the unique constraint is what makes
// "you get one guess" a database guarantee rather than a service convention.
// `score` is written once at submission and never recomputed.
@Table('game_guess')
@Unique({ name: 'game_guess_round_user_uq', columns: ['roundId', 'userId'] })
export class GameGuessTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => GameRoundTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  roundId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  userId!: string;

  @Column({ type: 'double precision', nullable: true })
  guessLat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  guessLon!: number | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  guessDate!: Timestamp | null;

  @Column({ type: 'double precision', nullable: true })
  distanceKm!: number | null;

  @Column({ type: 'integer', nullable: true })
  offsetDays!: number | null;

  @Column({ type: 'integer' })
  score!: number;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
