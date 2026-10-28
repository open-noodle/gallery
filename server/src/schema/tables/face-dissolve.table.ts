import { Column, CreateDateColumn, ForeignKeyColumn, type Generated, Index, Table, Timestamp } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators.js';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

// One admin dissolve of a person (specs/2026-09-06-dissolve-person-design.md, Revision 2). It records which detected
// faces the dissolve hid, so the Face Cleanup "Dissolved" page can restore them. The hiding itself lives in upstream's
// own column (asset_face.deletedAt); this table only remembers who did it, so dropping it loses the undo, not the data.
@Table('face_dissolve')
@Index({ name: 'face_dissolve_createdAt_id_idx', columns: ['createdAt', 'id'] })
export class FaceDissolveTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', index: true })
  ownerId!: string;

  // No FK: the dissolve usually deletes the person, and the record must outlive it.
  @Column({ type: 'uuid' })
  personGroupId!: string;

  @Column({ type: 'character varying', default: '' })
  personName!: Generated<string>;

  @Column({ type: 'character varying' })
  scope!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', nullable: true, index: false })
  actorId!: string | null;

  @Column({ type: 'integer' })
  hiddenCount!: number;

  @Column({ type: 'integer' })
  deletedCount!: number;

  @Column({ type: 'integer' })
  unassignedCount!: number;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  restoredAt!: Timestamp | null;
}

// A face one dissolve hid. Cascades with the face: a face that is hard-deleted later (a forced "Detect faces (all)",
// a re-scan that no longer finds it, its photo being deleted) can no longer be restored, and its row goes with it.
@Table('face_dissolve_face')
export class FaceDissolveFaceTable {
  @ForeignKeyColumn(() => FaceDissolveTable, { onDelete: 'CASCADE', primary: true, index: false })
  dissolveId!: string;

  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', primary: true, index: true })
  assetFaceId!: string;
}
