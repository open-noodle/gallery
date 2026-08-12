import { Column, ForeignKeyColumn, Generated, Index, Table } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import { FaceRepairScanTable } from 'src/schema/tables/face-repair-scan.table';

@Table('face_repair_scan_flagged_face')
@Index({ name: 'face_repair_scan_flagged_face_scanId_personId_idx', columns: ['scanId', 'personId'] })
export class FaceRepairScanFlaggedFaceTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FaceRepairScanTable, { onDelete: 'CASCADE', index: false })
  scanId!: string;

  @Column({ type: 'uuid' })
  assetFaceId!: string;

  @Column({ type: 'uuid' })
  personId!: string;

  @Column({ type: 'uuid' })
  suspectedOwnerId!: string;
}
