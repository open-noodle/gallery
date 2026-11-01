import { Column, ForeignKeyColumn, Table, Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

// Gallery job stamps for an asset, kept beside upstream's asset_job_status so that table stays
// upstream-shaped. A missing row means none of these jobs has run.
@Table('asset_job_status_gallery')
export class AssetJobStatusGalleryTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  assetId!: string;

  @Column({ type: 'timestamp with time zone', nullable: true })
  petsDetectedAt!: Timestamp | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  classifiedAt!: Timestamp | null;

  // Library Cleanup quality analysis
  @Column({ type: 'timestamp with time zone', nullable: true })
  qualityAnalyzedAt!: Timestamp | null;

  // Video faces sampled across the whole video (specs/2026-10-31-video-face-frames-design.md). Set even when the video
  // has no faces, so turning the feature on again does not rescan it.
  @Column({ type: 'timestamp with time zone', nullable: true })
  videoFacesSampledAt!: Timestamp | null;
}
