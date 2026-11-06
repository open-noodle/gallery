import { Column, CreateDateColumn, ForeignKeyColumn, Table } from '@immich/sql-tools';
import type { Generated, Timestamp } from '@immich/sql-tools';
import { AssetFaceTable } from 'src/schema/tables/asset-face.table.js';

/** One sampled sighting of a video face: `t` in the original's timeline, box in the best frame's pixel space. */
export type VideoFaceSighting = { t: number; x1: number; y1: number; x2: number; y2: number; score: number };

// The best frame of a video face found by sampling the whole video (specs/2026-10-31-video-face-frames-design.md).
// Beside asset_face rather than on it, so asset_face keeps Immich's meaning: the face's box and imageWidth/imageHeight
// are in this frame's pixel space, and this row says which frame that is.
@Table('asset_face_video_frame')
export class AssetFaceVideoFrameTable {
  @ForeignKeyColumn(() => AssetFaceTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  faceId!: string;

  @Column({ type: 'text' })
  path!: string;

  @Column({ type: 'double precision' })
  timeSeconds!: number;

  @Column({ type: 'real' })
  quality!: number;

  @Column({ type: 'jsonb', default: '[]' })
  sightings!: Generated<VideoFaceSighting[]>;

  @Column({ type: 'smallint' })
  version!: number;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
