import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Table,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import type { FileRead } from 'src/gallery/utils/asset-version-signature.js';
import { AssetTable } from 'src/schema/tables/asset.table.js';

/** What a file of a shot is: the camera's RAW, the camera's own JPEG/HEIC, or an edit made from them. */
export type AssetVersionKind = 'raw' | 'original' | 'edit';

/** A row is about the shot's base photo (the file shown in the timeline), or a file hidden behind it. */
export type AssetVersionRole = 'base_photo' | 'version';

// Asset versions (specs/2026-11-07-asset-versions-design.md): every file of a combined shot has a row. The base photo
// is the file shown in the timeline; it keeps its id for good, and its row (`role = 'base_photo'`, `assetId` its own
// id) also says what its picture is rendered from (the look). The other files are versions: hidden assets behind it
// (`role = 'version'`). `assetId` is set to null, not cascaded, when the base photo is deleted, so a version is found
// and deleted after it (AssetVersionService.handleCleanup). The base photo's row lives while files are behind it or
// its picture still comes from another file; the reset of that picture removes it.
@Table('asset_version')
@Check({
  name: 'asset_version_role_chk',
  expression: `"role" IN ('base_photo', 'version')`,
})
@Check({
  name: 'asset_version_base_photo_chk',
  expression: `("role" = 'base_photo') = ("versionAssetId" = "assetId")`,
})
@Check({
  name: 'asset_version_look_chk',
  expression: `"role" = 'base_photo' OR ("lookUpdatedAt" IS NULL AND "lookSourceAssetId" IS NULL AND "lookSourceModifiedAt" IS NULL AND "lookQueuedAt" IS NULL)`,
})
export class AssetVersionTable {
  /** The file this row is about. */
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: false })
  versionAssetId!: string;

  /** The base photo of its shot: the file itself on the base photo's row. */
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  assetId!: string | null;

  @Column({ type: 'character varying' })
  role!: AssetVersionRole;

  @Column({ type: 'character varying' })
  kind!: AssetVersionKind;

  /** What made the file: the camera, or the editor an edit came from (`lightroom`, `darktable`, ...). */
  @Column({ type: 'character varying', nullable: true })
  source!: string | null;

  /** How a version was found for its shot (`raw:name`, `edit:time`, ...); `photo` on the base photo's row. */
  @Column({ type: 'character varying' })
  rule!: string;

  /** How a version was shown before it went behind (timeline or archive): switching back shows it that way again. */
  @Column({ type: 'character varying', nullable: true })
  priorVisibility!: string | null;

  /**
  Whether a version was in a stack together with its base photo when it went behind it (it leaves the stack then, and
  a stack left with one asset is dissolved): switching back stacks it under its base photo again only then.
  */
  @Column({ type: 'boolean', default: false })
  wasStacked!: Generated<boolean>;

  /**
  What was read from the file with ExifTool, as the rules take it (asset-version-signature.ts): kept so that the
  files of a combined shot are not read again for every job that finds them. Files that are not combined keep none.
  */
  @Column({ type: 'jsonb', nullable: true })
  read!: FileRead | null;

  /** The file the base photo's picture was last rendered from; null when that file has been deleted since. */
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  lookSourceAssetId!: string | null;

  /** That file's modification time when the picture was rendered from it: an export written again is a new picture. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  lookSourceModifiedAt!: Timestamp | null;

  /**
  When the base photo's picture was last rendered from another file. Set means the photo shows another file's
  picture (its edited files hold it), whatever happened to that file since; the reset clears it.
  */
  @Column({ type: 'timestamp with time zone', nullable: true })
  lookUpdatedAt!: Timestamp | null;

  /** Base photo only: when the cleanup last queued its render; cleared by the render's outcome (`getOutdatedLooks`). */
  @Column({ type: 'timestamp with time zone', nullable: true })
  lookQueuedAt!: Timestamp | null;

  /** When a version's follow-up (phones and Space members drop the hidden file) last completed; null = pending. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  syncedAt!: Timestamp | null;

  /** When the cleanup queued the deletion of this version after its base photo was deleted. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  cleanupQueuedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
