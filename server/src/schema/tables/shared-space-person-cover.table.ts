import { Column, ForeignKeyColumn, Table, type Generated, type Timestamp } from '@immich/sql-tools';
import { SharedSpacePersonTable } from 'src/schema/tables/shared-space-person.table.js';

/**
The last time a space person's cover was set, by the cover job or by hand (specs/2026-11-21-person-cover-quality-design.md).
The source stays on `shared_space_person.representativeFaceSource`; this row holds while `faceId` equals
`shared_space_person.representativeFaceId`. `candidateCount` and `version` are the job's, null for a hand pick.
*/
@Table('shared_space_person_cover')
export class SharedSpacePersonCoverTable {
  @ForeignKeyColumn(() => SharedSpacePersonTable, { onDelete: 'CASCADE', primary: true, index: false })
  spacePersonId!: string;

  @Column({ type: 'uuid', nullable: true })
  faceId!: string | null;

  @Column({ type: 'integer', nullable: true })
  candidateCount!: number | null;

  @Column({ type: 'smallint', nullable: true })
  version!: number | null;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  pickedAt!: Generated<Timestamp>;
}
