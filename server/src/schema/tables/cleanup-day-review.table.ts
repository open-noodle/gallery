import { Column, ForeignKeyColumn, Table, type Timestamp } from '@immich/sql-tools';
import { UserTable } from 'src/schema/tables/user.table.js';

// gallery-fork: Library Cleanup (specs/2026-09-23-library-cleanup-design.md)
// Which calendar dates (month*100+day) a user has finished.
@Table('cleanup_day_review')
export class CleanupDayReviewTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  userId!: string;

  @Column({ type: 'smallint', primary: true })
  monthDay!: number;

  @Column({ type: 'timestamp with time zone' })
  reviewedAt!: Timestamp;
}
