import { CreateDateColumn, ForeignKeyColumn, Table, Timestamp, type Generated } from '@immich/sql-tools';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// A user's favorite for a face identity they hold no person of: the fallback behind person."isFavorite", which wins
// whenever the user owns a person linked to the identity (specs/2026-11-20-favorite-space-people-design.md).
// Keyed by (userId, identityId), the same key as person_identity's unique index.
@Table('face_identity_favorite')
export class FaceIdentityFavoriteTable {
  // index: false, userId leads the composite PK, so its btree already serves "my favorites".
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  userId!: string;

  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  identityId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
