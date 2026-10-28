import { Column, ForeignKeyColumn, PrimaryColumn, Table, type Timestamp } from '@immich/sql-tools';
import { PersonUserRole } from 'src/dtos/person.dto.js';
import { person_user_role_enum } from 'src/schema/enums.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// person_user's rows, held while their groups are split (see person-group-split.table.ts). No FK onto
// person: it keeps shares whose recipient row now lives in another group.
@Table('person_group_split_share')
export class PersonGroupSplitShareTable {
  @PrimaryColumn({ type: 'uuid' })
  personGroupId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  sharedById!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  sharedWithId!: string;

  @Column({ enum: person_user_role_enum })
  role!: PersonUserRole;

  @Column({ type: 'timestamp with time zone' })
  createdAt!: Timestamp;

  @Column({ type: 'timestamp with time zone' })
  updatedAt!: Timestamp;

  @Column({ type: 'uuid' })
  updateId!: string;
}
