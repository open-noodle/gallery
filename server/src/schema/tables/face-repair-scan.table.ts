import { Column, CreateDateColumn, ForeignKeyColumn, Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators';
import {
  RepairScanParams,
  RepairScanPerson,
  RepairScanProgress,
  RepairScanTotals,
} from 'src/repositories/face-repair-scan.repository';
import { UserTable } from 'src/schema/tables/user.table';

// Partial unique index restricted to in-flight rows: the DB-level single-flight guard. It makes the
// SELECT-then-INSERT in createScan race-safe — two concurrent triggers can't both persist an in-flight scan (the
// second collides here and is translated to ScanInProgressError).
//
// H7: unique on a CONSTANT expression, not on the `status` column. `UNIQUE (status) WHERE status IN
// ('pending','running')` (the original form) is unique on the VALUE of status, so one 'pending' row AND one
// 'running' row could coexist — the exact race this index exists to close. Every in-flight row now evaluates
// the same expression `(true)`, so at most one can exist regardless of which in-flight status it carries. See
// 1790000000000-FixFaceRepairScanInFlightIndex.
@Table('face_repair_scan')
@Index({
  name: 'face_repair_scan_in_flight_uq',
  unique: true,
  expression: '(true)',
  where: `"status" IN ('pending', 'running')`,
})
export class FaceRepairScanTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @Column({ type: 'character varying', default: 'pending' })
  status!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true, index: false })
  requestedBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  params!: RepairScanParams | null;

  @Column({ type: 'jsonb', nullable: true })
  totals!: RepairScanTotals | null;

  @Column({ type: 'jsonb', default: '[]' })
  persons!: Generated<RepairScanPerson[]>;

  @Column({ type: 'jsonb', nullable: true })
  progress!: RepairScanProgress | null;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  startedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  finishedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
