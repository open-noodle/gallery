import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Generated,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
} from '@immich/sql-tools';
import { SharedLinkType } from 'src/enum';
import { AlbumTable } from 'src/schema/tables/album.table';
import { SharedSpaceTable } from 'src/schema/tables/shared-space.table';
import { UserTable } from 'src/schema/tables/user.table';

@Table('shared_link')
export class SharedLinkTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @Column({ type: 'character varying', nullable: true })
  description!: string | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  userId!: string;

  @Column({ type: 'bytea', index: true, unique: true })
  key!: Buffer; // use to access the individual asset

  @Column()
  type!: SharedLinkType;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @Column({ type: 'timestamp with time zone', nullable: true })
  expiresAt!: Timestamp | null;

  @Column({ type: 'boolean', default: false })
  allowUpload!: boolean;

  @ForeignKeyColumn(() => AlbumTable, { nullable: true, onDelete: 'CASCADE', onUpdate: 'CASCADE' })
  albumId!: string | null;

  @Column({ type: 'boolean', default: true })
  allowDownload!: Generated<boolean>;

  @Column({ type: 'boolean', default: true })
  showExif!: Generated<boolean>;

  @Column({ type: 'character varying', nullable: true })
  password!: string | null;

  @Column({ type: 'character varying', nullable: true, unique: true })
  slug!: string | null;

  // #1018: the shared space this link was created from, when it was created from one.
  // It is the tether that lets the link serve assets the creator does not own: on every
  // read those are re-derived from live space state (membership + the asset still being in
  // the space), never from the `shared_link_asset` row alone. SET NULL rather than CASCADE —
  // deleting the space must degrade the link to the creator's own assets, not destroy it.
  @ForeignKeyColumn(() => SharedSpaceTable, { nullable: true, onDelete: 'SET NULL', onUpdate: 'CASCADE' })
  spaceId!: string | null;
}
