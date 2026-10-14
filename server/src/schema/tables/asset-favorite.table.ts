import {
  AfterDeleteTrigger,
  AfterInsertTrigger,
  CreateDateColumn,
  ForeignKeyColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import type { Generated } from '@immich/sql-tools';
import { CreateIdColumn, UpdateIdColumn } from 'src/decorators.js';
import {
  asset_favorite_after_delete,
  asset_favorite_after_insert,
  asset_favorite_delete_audit,
} from 'src/schema/functions.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// Per-user favorites overlay (#763). A favorite is a fact about (user, asset), never about an
// asset alone: see specs/2026-07-20-per-user-favorites-design.md §3.
// Carries its own createId/updateId watermarks (+ asset_favorite_audit) because favorites are a
// separately-synced entity. Only the owner's row reaches the asset: the after-insert/after-delete
// triggers project it onto asset."isFavorite", whose updatedAt trigger bumps asset.updateId, so stock
// clients re-sync the owner's favorite. Another user's favorite never touches the asset row (§4.3).
//
// PK is (userId, assetId), deliberately userId-leading — the dominant query is "my favorites".
@Table('asset_favorite')
// No `when` guard: FK cascades from asset/user deletes arrive at trigger depth > 1 and MUST still be
// tombstoned, or those favorites linger on clients. Matches migration 1794000000000's DDL exactly.
@AfterDeleteTrigger({
  scope: 'statement',
  function: asset_favorite_delete_audit,
  referencingOldTableAs: 'old',
})
@AfterInsertTrigger({
  name: 'asset_favorite_after_insert',
  scope: 'statement',
  function: asset_favorite_after_insert,
  referencingNewTableAs: 'inserted_rows',
  when: 'pg_trigger_depth() = 0',
})
@AfterDeleteTrigger({
  name: 'asset_favorite_after_delete',
  scope: 'statement',
  function: asset_favorite_after_delete,
  referencingOldTableAs: 'deleted_rows',
  when: 'pg_trigger_depth() = 0',
})
export class AssetFavoriteTable {
  // index: false — userId is the leading column of the composite PK, so its btree already serves
  // "my favorites" and a separate FK index would be redundant. The migration creates no such index;
  // saying so here is what keeps the declarative schema and a migrated database in agreement
  // (medium test `schema-drift.spec.ts`). Same shape as asset_duplicate_checksum.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
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
