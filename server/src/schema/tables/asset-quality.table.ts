import { Column, ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// gallery-fork: Library Cleanup (specs/2026-09-23-library-cleanup-design.md)
// Per-asset quality FACTS; queues decide at query time.
@Table('asset_quality')
@Index({ name: 'asset_quality_ownerId_sharpness_idx', columns: ['ownerId', 'sharpness'] })
@Index({ name: 'asset_quality_ownerId_screenshot_idx', columns: ['ownerId'], where: '"isScreenshot" = true' })
export class AssetQualityTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: false })
  ownerId!: string;

  @Column({ type: 'real', nullable: true })
  sharpness!: number | null;

  @Column({ type: 'real', nullable: true })
  brightness!: number | null;

  @Column({ type: 'real', nullable: true })
  clippedDark!: number | null;

  @Column({ type: 'real', nullable: true })
  clippedBright!: number | null;

  @Column({ type: 'boolean', default: false })
  isScreenshot!: boolean;

  @Column({ type: 'smallint' })
  version!: number;
}
