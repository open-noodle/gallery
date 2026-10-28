import { Column, ForeignKeyColumn, Table, type Timestamp } from '@immich/sql-tools';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// person rows parked by 1790900000000-SplitSharedPersonGroups: rows of a shared Immich person group with no
// visible face on their owner's photos, which Gallery's PersonCleanup would delete. The rejoin puts them back.
// Temporary, like person_group_split (see person-group-split.table.ts).
@Table('person_group_split_person')
export class PersonGroupSplitPersonTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  ownerId!: string;

  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  personGroupId!: string;

  @Column({ type: 'timestamp with time zone' })
  createdAt!: Timestamp;

  @Column()
  name!: string;

  @Column()
  thumbnailPath!: string;

  @Column({ type: 'boolean' })
  isHidden!: boolean;

  @Column({ type: 'date', nullable: true })
  birthDate!: Timestamp | null;

  @Column({ type: 'uuid', nullable: true })
  faceAssetId!: string | null;

  @Column({ type: 'boolean' })
  isFavorite!: boolean;

  @Column({ type: 'character varying', nullable: true })
  color!: string | null;
}
