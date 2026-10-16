import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// An image's colour adjustment (the editor's Adjust panel), kept beside the asset so asset_edit stays upstream-shaped:
// Immich's edit actions are crop, rotate and mirror, and a stock Immich client cannot decode any other action. The
// adjustment is applied after those edits when Gallery renders the edited thumbnails. Values are -100..100 (0 = none).
@Table('asset_image_adjust')
export class AssetImageAdjustTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'double precision', default: 0 })
  exposure!: number;

  @Column({ type: 'double precision', default: 0 })
  contrast!: number;

  @Column({ type: 'double precision', default: 0 })
  saturation!: number;

  @Column({ type: 'boolean', default: false })
  invert!: boolean;
}
