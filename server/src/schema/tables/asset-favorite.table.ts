import { CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { CreateIdColumn, UpdateIdColumn } from 'src/decorators';
import { AssetTable } from 'src/schema/tables/asset.table';
import { UserTable } from 'src/schema/tables/user.table';

// Per-user favorites overlay (#763). A favorite is a fact about (user, asset), never about an
// asset alone — see docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §3.
// Carries its own createId/updateId watermarks (+ asset_favorite_audit) because favorites are a
// separately-synced entity: a favorite write must NOT bump the owner's asset.updateId, which
// would re-sync that asset to every space member (§4.3).
//
// PK is (userId, assetId), deliberately userId-leading — the dominant query is "my favorites".
@Table('asset_favorite')
export class AssetFavoriteTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  userId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: true })
  assetId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
