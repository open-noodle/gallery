import { Column, CreateDateColumn, ForeignKeyColumn, Table } from '@immich/sql-tools';
import type { Generated, Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// A photo's Spatial Scene depth map (specs/2026-10-29-spatial-scene-design.md), beside the asset rather than an
// asset_file row: `asset_file.type` is Immich's enum, and a stock Immich server must not meet a type it does not know.
// The row is also the "processed" stamp. The metrics are stored raw so eligibility can be decided when a photo is
// opened, against thresholds an admin can change without reprocessing.
@Table('asset_spatial_scene')
export class AssetSpatialSceneTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'text' })
  path!: string;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ type: 'real' })
  boundarySharpness!: number;

  @Column({ type: 'real' })
  edgeDensity!: number;

  @Column({ type: 'real' })
  foregroundRatio!: number;

  @Column({ type: 'real' })
  focus!: number;

  @Column({ type: 'text' })
  modelName!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
