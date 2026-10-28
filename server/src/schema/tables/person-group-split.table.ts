import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// One row per person moved out of a multi-owner Immich person group by 1790900000000-SplitSharedPersonGroups,
// so the rejoin (down(), scripts/revert-to-immich.sql) can put it back. Temporary: emptied and dropped
// once Gallery keeps several owners' rows per group. See src/gallery/utils/person-group-split.ts.
@Table('person_group_split')
export class PersonGroupSplitTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  splitGroupId!: string;

  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  originalGroupId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  ownerId!: string;
}
