import { ForeignKeyColumn, Index, Table } from '@immich/sql-tools';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// The face identity a person is linked to, kept beside upstream's person table so it stays
// upstream-shaped. Keyed by personGroupId: option M (person_personGroupId_key) makes a group hold
// exactly one person. ownerId mirrors person.ownerId so (ownerId, identityId) can stay unique.
// Readers join through person, so a row whose person was deleted ahead of its group is ignored.
@Table('person_identity')
@Index({ name: 'person_identity_ownerId_identityId_key', columns: ['ownerId', 'identityId'], unique: true })
export class PersonIdentityTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  personGroupId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', index: false })
  ownerId!: string;

  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  identityId!: string;
}
