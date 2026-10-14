import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { SharedLinkTable } from 'src/schema/tables/shared-link.table.js';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table.js';

// #1018: the shared space a share link was created from, when it was created from one. It is the
// tether that lets the link serve assets the creator does not own: on every read those are re-derived
// from live space state (membership + the asset still being in the space), never from the
// `shared_link_asset` row alone. Deleting the space deletes this row, which degrades the link to the
// creator's own assets instead of destroying it (1798000000000-AddSharedLinkSpaceTable).
@Table('shared_link_space')
export class SharedLinkSpaceTable {
  @ForeignKeyColumn(() => SharedLinkTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  sharedLinkId!: string;

  @ForeignKeyColumn(() => SharedSpaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: true })
  spaceId!: string;
}
