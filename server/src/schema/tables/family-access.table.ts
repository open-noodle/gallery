import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Table, Timestamp } from '@immich/sql-tools';
import { UserTable } from 'src/schema/tables/user.table';

// A fork-owned table rather than a column on `user`: user.table.ts is pure upstream and
// carries no fork columns, so a column there would conflict on every rebase. This also
// buys `grantedById` for an audit trail at no extra cost.
@Table('family_access')
export class FamilyAccessTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', primary: true })
  userId!: string;

  @Column({ type: 'character varying' })
  level!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  grantedById!: string | null;

  @CreateDateColumn()
  grantedAt!: Generated<Timestamp>;
}
