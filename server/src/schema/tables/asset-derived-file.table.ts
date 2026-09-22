import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  type Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
} from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// Gallery-fork: cache index for on-demand derived images (image.presets). One row per rendered
// (asset, preset, width, edited) variant. Deliberately separate from asset_file, whose unique key is
// (assetId, type, isEdited) and which the thumbnail job owns end to end; these rows are written by
// the serve path and dropped whenever the asset's thumbnails regenerate or the preset disappears.
// See specs/2026-09-22-derived-image-presets-design.md.
@Table('asset_derived_file')
@Unique({ columns: ['assetId', 'preset', 'width', 'isEdited'] })
export class AssetDerivedFileTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  assetId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @Column()
  preset!: string;

  @Column({ type: 'integer' })
  width!: number;

  @Column({ type: 'integer' })
  height!: number;

  @Column({ type: 'boolean', default: false })
  isEdited!: Generated<boolean>;

  @Column()
  path!: string;
}
