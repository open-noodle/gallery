import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';

@Table('asset_quality')
export class AssetQualityTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'integer', nullable: true })
  sharpness!: number | null;

  @Column({ type: 'integer', nullable: true })
  exposure!: number | null;

  @Column({ type: 'integer', nullable: true })
  brightness!: number | null;

  @Column({ type: 'integer', nullable: true })
  quality!: number | null;
}
