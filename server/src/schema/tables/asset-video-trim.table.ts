import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// A video's trim, kept beside the asset so asset.duration and asset_edit stay upstream-shaped: asset.duration is
// the original's length, which is what a stock Immich server plays. Gallery serves the trimmed file and projects
// `duration` (the probed length of that file) in its place.
@Table('asset_video_trim')
export class AssetVideoTrimTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'double precision' })
  startTime!: number;

  @Column({ type: 'double precision' })
  endTime!: number;

  // Milliseconds, like asset.duration. Null until the trim job has probed the trimmed file.
  @Column({ type: 'integer', nullable: true })
  duration!: number | null;
}
