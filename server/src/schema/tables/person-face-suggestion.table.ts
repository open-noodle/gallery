import {
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
import { PrimaryGeneratedUuidV7Column, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { PersonTable } from 'src/schema/tables/person.table';
import { SharedSpacePersonTable } from 'src/schema/tables/shared-space-person.table';

export type PersonFaceSuggestionStatus = 'pending' | 'confirmed' | 'dismissed';

@Table('person_face_suggestion')
@UpdatedAtTrigger('person_face_suggestion_updatedAt')
@Check({
  name: 'person_face_suggestion_status_chk',
  expression: `"status" IN ('pending', 'confirmed', 'dismissed')`,
})
@Check({
  name: 'person_face_suggestion_exactly_one_target_chk',
  expression: `num_nonnulls("personId", "spacePersonId") = 1`,
})
@Index({
  name: 'person_face_suggestion_personId_status_distance_idx',
  columns: ['personId', 'status', 'distance'],
})
@Index({
  name: 'person_face_suggestion_spacePersonId_status_distance_idx',
  columns: ['spacePersonId', 'status', 'distance'],
  where: '"spacePersonId" IS NOT NULL',
})
@Index({ name: 'person_face_suggestion_assetFaceId_idx', columns: ['assetFaceId'] })
@Index({
  name: 'person_face_suggestion_personId_assetFaceId_uq',
  columns: ['personId', 'assetFaceId'],
  unique: true,
  where: '"personId" IS NOT NULL',
})
@Index({
  name: 'person_face_suggestion_spacePersonId_assetFaceId_uq',
  columns: ['spacePersonId', 'assetFaceId'],
  unique: true,
  where: '"spacePersonId" IS NOT NULL',
})
export class PersonFaceSuggestionTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', index: false, nullable: true })
  personId!: string | null;

  @ForeignKeyColumn(() => SharedSpacePersonTable, { onDelete: 'CASCADE', index: false, nullable: true })
  spacePersonId!: string | null;

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', index: false })
  assetFaceId!: string;

  @Column({ type: 'double precision' })
  distance!: number;

  @Column({ type: 'character varying', default: 'pending' })
  status!: Generated<PersonFaceSuggestionStatus>;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
