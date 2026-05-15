import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column, UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table';
import { PersonTable } from 'src/schema/tables/person.table';

export type PersonFaceSuggestionStatus = 'pending' | 'confirmed' | 'dismissed';

@Table('person_face_suggestion')
@UpdatedAtTrigger('person_face_suggestion_updatedAt')
@Check({
  name: 'person_face_suggestion_status_chk',
  expression: `"status" IN ('pending', 'confirmed', 'dismissed')`,
})
@Index({
  name: 'person_face_suggestion_personId_status_distance_idx',
  columns: ['personId', 'status', 'distance'],
})
@Index({ name: 'person_face_suggestion_assetFaceId_idx', columns: ['assetFaceId'] })
@Unique({ name: 'person_face_suggestion_personId_assetFaceId_uq', columns: ['personId', 'assetFaceId'] })
export class PersonFaceSuggestionTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => PersonTable, { onDelete: 'CASCADE', index: false })
  personId!: string;

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
