import { Column, CreateDateColumn, ForeignKeyColumn, Table, type Generated, type Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// A video's Data Saver copy (specs/2026-11-01-data-saver-video-design.md), beside the asset rather than an asset_file
// row: `asset_file.type` is Immich's enum, and a stock Immich server must not meet a type it does not know.
// The row is also the "processed" stamp: a null path means the video is already small enough to play as it is.
@Table('asset_data_saver_video')
export class AssetDataSaverVideoTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'text', nullable: true })
  path!: string | null;

  // `<codec>:<resolution>:<maxBitrate>` the copy was made with, so a settings change finds the stale ones
  @Column({ type: 'text' })
  settings!: string;

  // made from the trimmed file rather than the original
  @Column({ type: 'boolean' })
  fromEdited!: boolean;

  // reset on every upsert, so it is when the current copy was made
  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
