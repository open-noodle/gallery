import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  Index,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
} from '@immich/sql-tools';
import { UpdatedAtTrigger, UpdateIdColumn } from 'src/decorators';
import { UserTable } from 'src/schema/tables/user.table';

@Table('family_union')
@UpdatedAtTrigger('family_union_updatedAt')
// Deduplicates the ordinary 2-partner case. `partnerKey` carries the sorted identity
// pair AND the start date, so the same couple may marry twice (E60) while a genuine
// duplicate collapses. NULL below two partners, so those are never deduplicated (E5).
@Index({
  name: 'family_union_partner_key_uq',
  columns: ['partnerKey'],
  unique: true,
  where: '"partnerKey" IS NOT NULL',
})
export class FamilyUnionTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column({ type: 'character varying', default: 'partnered' })
  status!: Generated<string>;

  @Column({ type: 'date', nullable: true })
  startDate!: string | null;

  @Column({ type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ type: 'text', nullable: true })
  partnerKey!: string | null;

  // SET NULL, never CASCADE — deleting a user must not delete the family history
  // they recorded (E23).
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  // Required by the shared `updated_at()` trigger function (see UpdatedAtTrigger above),
  // which unconditionally sets both NEW."updatedAt" and NEW."updateId" — every table using
  // that trigger must carry this column, same as face_identity and shared_space_person.
  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
