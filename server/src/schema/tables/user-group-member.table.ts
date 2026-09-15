import { CreateDateColumn, ForeignKeyColumn, type Generated, Table, Timestamp } from '@immich/sql-tools';
import { UserGroupTable } from 'src/schema/tables/user-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

@Table('user_group_member')
export class UserGroupMemberTable {
  @ForeignKeyColumn(() => UserGroupTable, { onDelete: 'CASCADE', primary: true, index: false })
  groupId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', primary: true })
  userId!: string;

  @CreateDateColumn()
  addedAt!: Generated<Timestamp>;
}
