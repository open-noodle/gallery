import { Column, ForeignKeyColumn, Table } from '@immich/sql-tools';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';

// Marks a person as a pet, kept beside upstream's person table so it stays upstream-shaped: a person
// is a pet exactly when its group has a row here. Keyed by personGroupId (option M: one person per
// group); readers join through person, so a row whose person was deleted ahead of its group is ignored.
@Table('person_pet')
export class PersonPetTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  personGroupId!: string;

  @Column({ type: 'character varying', nullable: true })
  species!: string | null;
}
