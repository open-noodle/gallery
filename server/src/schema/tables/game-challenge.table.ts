import {
  Check,
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

// One playable challenge: a frozen set of rounds drawn from a single scope - either a shared
// space's photos or one user's own library.
//
// scaleKm / scaleDays are FROZEN at generation. Scoring divides by them, so
// recomputing later - as the space gains photos - would silently rewrite the
// meaning of every score already recorded against this challenge.
@Table('game_challenge')
@UpdatedAtTrigger('game_challenge_updatedAt')
// Exactly one scope, never both and never neither. A row with both would be ambiguous to every
// authorization branch that dispatches on scope; a row with neither has no pool to draw from and
// nobody who may read it.
@Check({
  name: 'game_challenge_scope_chk',
  expression: `num_nonnulls("spaceId", "ownerId") = 1`,
})
// The daily is generated lazily by whichever member opens the page first that day, so concurrent
// readers really do race to insert one. This partial unique index is what makes the loser fail
// rather than create a second, divergent daily for the same space and date.
@Index({
  name: 'game_challenge_daily_uq',
  columns: ['spaceId', 'dailyOn'],
  unique: true,
  where: '"spaceId" IS NOT NULL AND "dailyOn" IS NOT NULL',
})
// Postgres treats NULLs as distinct in a unique index, so once spaceId is nullable the index
// above stops constraining solo rows entirely. Without this second index the lazy-generation
// race - which the first index exists to LOSE - starts winning twice, and one user gets two
// divergent dailies for the same UTC day.
@Index({
  name: 'game_challenge_owner_daily_uq',
  columns: ['ownerId', 'dailyOn'],
  unique: true,
  where: '"ownerId" IS NOT NULL AND "dailyOn" IS NOT NULL',
})
export class GameChallengeTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => SharedSpaceTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    index: true,
    nullable: true,
  })
  spaceId!: string | null;

  // A solo challenge is personal and has no other stakeholder, so it dies with its owner -
  // unlike createdById, which is SET NULL precisely so deleting one member does not destroy a
  // shared space's challenges. A solo challenge leaves createdById NULL rather than setting
  // both: two FK actions firing on one row for one deletion event is a trap, and the authorship
  // is already carried here.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true, nullable: true })
  ownerId!: string | null;

  // Nullable, and SET NULL rather than CASCADE: a daily has no human author, and cascading meant
  // deleting a user destroyed the challenges they had created in a SHARED space along with every
  // other member's guesses and scores.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  createdById!: string | null;

  // Frozen at generation, for the same reason scaleKm/scaleDays are: re-resolving eligibility
  // from live preferences would 404 every round image of a game in flight the moment the player
  // toggled a source off.
  @Column({ type: 'boolean', default: false })
  includePartners!: Generated<boolean>;

  @Column({ type: 'boolean', default: false })
  includeSpaces!: Generated<boolean>;

  @Column()
  name!: string;

  // The UTC date this challenge is the daily for; NULL for a player-created challenge. Typed as a
  // Timestamp because that is what the driver hands back for a `date` column - the same convention
  // as person.birthDate, whose DTO runs it through asDateString() to get a yyyy-mm-dd back out.
  @Column({ type: 'date', nullable: true })
  dailyOn!: Timestamp | null;

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
