import { Column, ForeignKeyColumn, Generated, Index, Table } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table';

@Table('face_repair_scan_flagged_face')
@Index({ name: 'face_repair_scan_flagged_face_scanId_personGroupId_idx', columns: ['scanId', 'personGroupId'] })
export class FaceRepairScanFlaggedFaceTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FaceRepairScanTable, { onDelete: 'CASCADE', index: false })
  scanId!: string;

  @Column({ type: 'uuid' })
  assetFaceId!: string;

  // Option M: snapshot of the person this face was flagged against; holds a person_group id
  // now that person.id is gone. Not an FK (it is a point-in-time scan snapshot).
  @Column({ type: 'uuid' })
  personGroupId!: string;

  @Column({ type: 'uuid' })
  suspectedOwnerId!: string;
}
