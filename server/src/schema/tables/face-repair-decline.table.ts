import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { PersonGroupTable } from 'src/schema/tables/person-group.table';
import { UserTable } from 'src/schema/tables/user.table';

// A persisted admin "leave it" decision for the Face Cleanup console. `type='face'` rows mute a single flagged
// face while it is still suspected toward `suspectedOwnerId`; `type='person'` rows mute a whole cluster while its
// suspected-owner set stays within `suspectedOwnerIds`. Console-only — never touches identity or recognition.
@Table('face_repair_decline')
@Index({
  name: 'face_repair_decline_face_owner_uq',
  columns: ['assetFaceId', 'suspectedOwnerId'],
  unique: true,
})
export class FaceRepairDeclineTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'character varying' })
  type!: 'face' | 'person';

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', nullable: true, index: true })
  assetFaceId!: string | null;

  // Option M: repointed from the deleted person.id to person_group.id (1:1 under M).
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', nullable: true, index: false })
  suspectedOwnerId!: string | null;

  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', nullable: true, index: true })
  personGroupId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  suspectedOwnerIds!: string[] | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true, index: false })
  declinedBy!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
