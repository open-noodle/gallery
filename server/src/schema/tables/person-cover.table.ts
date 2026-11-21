import { Check, Column, ForeignKeyColumn, Table, type Generated, type Timestamp } from '@immich/sql-tools';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';

export type PersonCoverSource = 'auto' | 'manual' | 'unknown';

/**
Where a personal person's cover came from (specs/2026-11-21-person-cover-quality-design.md), beside upstream's person
table so `person.faceAssetId` keeps Immich's meaning. A row holds while `faceId` equals `person.faceAssetId`; one that
no longer holds, or no row, means the cover was picked automatically. `unknown` marks the covers that existed before
this table, written once by its migration. `faceId` has no foreign key: a deleted face just stops matching.
*/
@Table('person_cover')
@Check({ name: 'person_cover_source_chk', expression: `"source" IN ('auto', 'manual', 'unknown')` })
export class PersonCoverTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  personGroupId!: string;

  @Column({ type: 'uuid', nullable: true })
  faceId!: string | null;

  @Column({ type: 'character varying' })
  source!: PersonCoverSource;

  // The job's candidate count and PERSON_COVER_VERSION when it picked; null for manual and unknown covers.
  @Column({ type: 'integer', nullable: true })
  candidateCount!: number | null;

  @Column({ type: 'smallint', nullable: true })
  version!: number | null;

  @Column({ type: 'timestamp with time zone', default: () => 'now()' })
  pickedAt!: Generated<Timestamp>;
}
