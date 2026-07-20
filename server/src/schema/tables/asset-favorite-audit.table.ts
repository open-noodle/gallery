import { Column, CreateDateColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';

// Delete-audit for the asset_favorite per-user overlay (#763). Trigger-driven
// (asset_favorite_delete_audit fires AFTER DELETE ... FOR EACH STATEMENT), so it captures both an
// explicit unfavorite and every FK cascade (asset delete, user delete). `id` is a UUIDv7 in the
// same watermark domain as the other *_audit tables — see
// docs/superpowers/specs/2026-07-20-per-user-favorites-design.md §4.3 — so slice 6's sync delete
// stream can page on it like the others.
@Table('asset_favorite_audit')
@Index({ name: 'asset_favorite_audit_userId_id_idx', columns: ['userId', 'id'] })
export class AssetFavoriteAuditTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'uuid', index: true })
  userId!: string;

  @Column({ type: 'uuid', index: true })
  assetId!: string;

  @CreateDateColumn({ default: () => 'clock_timestamp()', index: true })
  deletedAt!: Generated<Timestamp>;
}
