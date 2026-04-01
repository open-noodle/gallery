import { ForeignKeyColumn, PrimaryColumn, Table } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('asset_duplicate_checksum')
export class AssetDuplicateChecksumTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  assetId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  ownerId!: string;

  @PrimaryColumn({ type: 'bytea' })
  checksum!: Buffer;
}
