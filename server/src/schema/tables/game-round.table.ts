import { Column, ForeignKeyColumn, Generated, Table, Timestamp, Unique } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { AssetTable } from 'src/schema/tables/asset.table';
import { GameChallengeTable } from 'src/schema/tables/game-challenge.table';

export type GameRoundType = 'location' | 'date';

// One question. The answer is DENORMALISED here rather than joined from asset_exif
// on read: if the asset is deleted or its EXIF edited mid-challenge, every score
// already submitted must remain stable and comparable. assetId is therefore
// nullable with ON DELETE SET NULL - the round survives its photo.
@Table('game_round')
@Unique({ name: 'game_round_challenge_index_uq', columns: ['challengeId', 'index'] })
export class GameRoundTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => GameChallengeTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  challengeId!: string;

  @Column({ type: 'integer' })
  index!: number;

  @Column()
  type!: GameRoundType;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  assetId!: string | null;

  @Column({ type: 'double precision', nullable: true })
  answerLat!: number | null;

  @Column({ type: 'double precision', nullable: true })
  answerLon!: number | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  answerDate!: Timestamp | null;
}
