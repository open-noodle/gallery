import {
  AfterDeleteTrigger,
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { person_delete_audit } from 'src/schema/functions';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { FaceIdentityTable } from 'src/schema/tables/face-identity.table';
import { PersonGroupTable } from 'src/schema/tables/person-group.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('person')
@Index({
  name: 'idx_person_name_trigram',
  using: 'gin',
  expression: 'f_unaccent("name") gin_trgm_ops',
})
@UpdatedAtTrigger('person_updatedAt')
@AfterDeleteTrigger({
  scope: 'statement',
  function: person_delete_audit,
  referencingOldTableAs: 'old',
  when: 'pg_trigger_depth() <= 1',
})
@Check({ name: 'person_birthDate_chk', expression: `"birthDate" <= CURRENT_DATE` })
@Index({
  name: 'person_ownerId_identityId_key',
  columns: ['ownerId', 'identityId'],
  unique: true,
  where: '"identityId" IS NOT NULL',
})
@Index({ name: 'person_identityId_idx', columns: ['identityId'], where: '"identityId" IS NOT NULL' })
// Option M: Gallery does not adopt upstream's cluster-groups FEATURE — cross-user recognition is
// answered by shared spaces + `face_identity` instead. That decision means a person_group never
// holds more than one `person` row, which is what lets the fork keep addressing a person by
// `personGroupId` alone (see PersonRepository.getByGroupIdOnly / withPersonAnyOwner) even though
// upstream's primary key is the composite (ownerId, personGroupId).
//
// This index makes that a database-enforced fact rather than a convention. Every person-insert path
// creates exactly one row per group today; if a future rebase ever pulls in an upstream path that
// adds a second owner's row to an existing group, this fails loudly at write time instead of
// silently making every `personGroupId`-keyed lookup ambiguous.
//
// Dropping this index is the first step of ever turning cluster groups ON — do not remove it
// casually.
@Index({ name: 'person_personGroupId_key', columns: ['personGroupId'], unique: true })
export class PersonTable {
  @ForeignKeyColumn(() => UserTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    primary: true,
    // [ownerId, personGroupId] is the PK constraint
    index: false,
  })
  ownerId!: string;

  @ForeignKeyColumn(() => PersonGroupTable, {
    onDelete: 'CASCADE',
    onUpdate: 'CASCADE',
    primary: true,
  })
  personGroupId!: string;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @Column({ default: '' })
  name!: Generated<string>;

  @Column({ default: '' })
  thumbnailPath!: Generated<string>;

  @Column({ type: 'boolean', default: false })
  isHidden!: Generated<boolean>;

  @Column({ type: 'date', nullable: true })
  birthDate!: Timestamp | null;

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'SET NULL', nullable: true })
  faceAssetId!: string | null;

  @Column({ type: 'boolean', default: false })
  isFavorite!: Generated<boolean>;

  @Column({ type: 'character varying', nullable: true, default: null })
  color!: string | null;

  @Column({ type: 'character varying', default: 'person' })
  type!: Generated<string>;

  @Column({ type: 'character varying', nullable: true })
  species!: string | null;

  @ForeignKeyColumn(() => FaceIdentityTable, { onDelete: 'SET NULL', nullable: true, index: false })
  identityId!: string | null;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
