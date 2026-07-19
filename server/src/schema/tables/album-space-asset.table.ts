import {
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { CreateIdColumn, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AlbumTable } from 'src/schema/tables/album.table';
import { AssetTable } from 'src/schema/tables/asset.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

// A cross-owner contribution: a space photo the contributor does NOT own, bookmarked into a
// space-linked album (#764). Deliberately NOT `album_asset` — it must never become a permanent
// `checkAlbumAccess` grant for the album owner. Visibility is re-derived from live space membership
// + the live album↔space link on every read (see spaceContributedAssetExists). The adder's OWN
// photos take the ordinary `album_asset` path instead.
//
// Sync watermarks mirror `shared_space_asset` (spec §4): `createId` anchors the per-album backfill,
// `updateId` (bumped by the `album_space_asset_updatedAt` BEFORE-UPDATE trigger) drives incremental
// upserts. The row's DATA columns are immutable; `updateId` is bumped only on a deliberate
// `updatedAt` touch (visibility restore — see SharedSpaceRepository.emitAlbumAssetVisibilityRestore)
// so a contribution re-appears on devices that purged it when its asset was un-hidden.
@Table({ name: 'album_space_asset' })
@UpdatedAtTrigger('album_space_asset_updatedAt')
@Index({ name: 'album_space_asset_spaceId_idx', columns: ['spaceId'] })
export class AlbumSpaceAssetTable {
  // index: false — albumId is the leading column of the composite PK, so a separate FK index is redundant.
  @ForeignKeyColumn(() => AlbumTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    nullable: false,
    primary: true,
    index: false,
  })
  albumId!: string;

  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false, primary: true })
  assetId!: string;

  // Provenance + tether: the space the contribution flows through. The read gate joins this to a
  // LIVE shared_space_album link and a LIVE shared_space_member row for the viewer.
  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', nullable: false, index: false })
  spaceId!: string;

  // Who contributed it (any space Editor). SET NULL so a deleted user doesn't erase the contribution.
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  addedById!: string | null;

  @CreateDateColumn()
  addedAt!: Generated<Timestamp>;

  @CreateIdColumn({ index: true })
  createId!: Generated<string>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;
}
