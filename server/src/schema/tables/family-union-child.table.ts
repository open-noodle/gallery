import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table.js';
import { FamilyUnionTable } from 'src/schema/tables/family-union.table.js';

@Table('family_union_child')
export class FamilyUnionChildTable {
  @ForeignKeyColumn(() => FamilyUnionTable, { onDelete: 'CASCADE', primary: true, index: false })
  unionId!: string;

  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'CASCADE', primary: true })
  identityId!: string;
}
