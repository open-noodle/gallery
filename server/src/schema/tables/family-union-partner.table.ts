import { ForeignKeyColumn, Table } from '@immich/sql-tools';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table';
import { FamilyUnionTable } from 'src/schema/tables/family-union.table';

@Table('family_union_partner')
export class FamilyUnionPartnerTable {
  @ForeignKeyColumn(() => FamilyUnionTable, { onDelete: 'CASCADE', primary: true, index: false })
  unionId!: string;

  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'CASCADE', primary: true })
  identityId!: string;
}
