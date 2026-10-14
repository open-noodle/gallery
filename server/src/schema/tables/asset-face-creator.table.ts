import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// Who drew a face box by hand, via the space face-assign endpoint. Detected faces have no row.
// Deletability of a hand-drawn box is decided by this row, never by sourceType (see
// 2026-08-23-space-editor-face-assignment-design.md §6.6). Deleting the user deletes the row, so the
// face stops counting as editor-drawn (1798100000000-AddAssetFaceCreatorTable).
@Table('asset_face_creator')
export class AssetFaceCreatorTable {
  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetFaceId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  userId!: string;
}
