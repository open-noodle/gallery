import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// Whether Spatial Scene is offered on one photo regardless of the automatic choice
// (specs/2026-10-29-spatial-scene-design.md, "Per-photo actions"). A row of its own rather than a column on
// asset_spatial_scene: that row is derived data, rebuilt by every depth run, while this is a person's choice, and it
// can be made before the photo has a depth map. No row means the automatic choice.
@Table('asset_spatial_scene_offer')
export class AssetSpatialSceneOfferTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'boolean' })
  offered!: boolean;
}
