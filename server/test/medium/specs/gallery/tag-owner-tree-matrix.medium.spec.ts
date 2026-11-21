/**
A tag put on a member's photo stays its tagger's tag: ACTOR matrix (CLAUDE.md rule 7, #992).

Upstream assumes every tag on an asset is its owner's: `TagService.updateTags` copies the value of every tag on the
asset into `asset_exif.tags` (and from there the XMP sidecar), and metadata extraction's `applyTagList` re-creates
those values in the OWNER's tag tree and then replaces every `tag_asset` row of the asset with the owner's tags. Since
#992 a space Owner/Editor may tag a member's photo with their own tag, so on the next extraction (which the Editor can
force with `refresh-metadata`) the Editor's tag became a tag in the member's account, named as the Editor chose, and
the Editor's own tag was dropped from the photo.

The rule under test: only the photo owner's tags reach the photo's metadata, and re-extraction replaces only the
owner's tag links. Each cell tags the photo through the real `bulkTagAssets` gate, runs the real metadata extraction on
a real image file, and reads the tag tables afterwards.

Mutation-checked: without the owner filter in getForUpdateTags the space owner and editor cells find their tag in the
photo owner's tree; without it in replaceAssetTags their own tag no longer survives extraction.
*/
import { Kysely } from 'kysely';
import { Stats } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AssetJobRepository } from 'src/repositories/asset-job.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { MetadataRepository } from 'src/repositories/metadata.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { BaseService } from 'src/services/base.service.js';
import { MetadataService } from 'src/services/metadata.service.js';
import { TagService } from 'src/services/tag.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB, newRandomImage } from 'test/utils.js';

const ACTORS = [
  'photo owner',
  'space owner',
  'space editor',
  'space viewer',
  'non-member',
  'admin non-member',
] as const;
type Actor = (typeof ACTORS)[number];

type Outcome = {
  tagged: boolean;
  inPhotoMetadata: boolean;
  inPhotoOwnersTree: boolean;
  survivesExtraction: boolean;
  photoOwnersOwnTagSurvives: boolean;
};

/** The rule, written out per actor. */
const TRUTH: Record<Actor, Outcome> = {
  'photo owner': {
    tagged: true,
    inPhotoMetadata: true,
    inPhotoOwnersTree: true,
    survivesExtraction: true,
    photoOwnersOwnTagSurvives: true,
  },
  'space owner': {
    tagged: true,
    inPhotoMetadata: false,
    inPhotoOwnersTree: false,
    survivesExtraction: true,
    photoOwnersOwnTagSurvives: true,
  },
  'space editor': {
    tagged: true,
    inPhotoMetadata: false,
    inPhotoOwnersTree: false,
    survivesExtraction: true,
    photoOwnersOwnTagSurvives: true,
  },
  'space viewer': {
    tagged: false,
    inPhotoMetadata: false,
    inPhotoOwnersTree: false,
    survivesExtraction: false,
    photoOwnersOwnTagSurvives: true,
  },
  'non-member': {
    tagged: false,
    inPhotoMetadata: false,
    inPhotoOwnersTree: false,
    survivesExtraction: false,
    photoOwnersOwnTagSurvives: true,
  },
  'admin non-member': {
    tagged: false,
    inPhotoMetadata: false,
    inPhotoOwnersTree: false,
    survivesExtraction: false,
    photoOwnersOwnTagSurvives: true,
  },
};

const OWNER_TAG = 'Owner/Kept';

let defaultDatabase: Kysely<DB>;
let imageDir: string;

const setup = () => {
  const { ctx } = newMediumService(BaseService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AssetJobRepository,
      AssetRepository,
      ConfigRepository,
      MetadataRepository,
      SharedSpaceRepository,
      SystemMetadataRepository,
      TagRepository,
      UserRepository,
    ],
    mock: [EventRepository, JobRepository, LoggingRepository, StorageRepository],
  });
  ctx.getMock(EventRepository).emit.mockResolvedValue();
  ctx.getMock(JobRepository).queue.mockResolvedValue();
  ctx.getMock(JobRepository).queueAll.mockResolvedValue();
  ctx.getMock(StorageRepository).stat.mockResolvedValue({
    size: 123_456,
    mtime: new Date(654_321),
    mtimeMs: 654_321,
    birthtimeMs: 654_322,
  } as Stats);
  return ctx;
};

type Ctx = ReturnType<typeof setup>;

const tagAs = async (ctx: Ctx, user: { id: string; isAdmin?: boolean }, assetId: string, value: string) => {
  const { tag } = await ctx.newTag({ userId: user.id, value });
  await ctx.getService(TagService).bulkTagAssets(factory.auth({ user: { id: user.id, isAdmin: user.isAdmin } }), {
    tagIds: [tag.id],
    assetIds: [assetId],
  });
  return tag;
};

const buildWorld = async (ctx: Ctx, actorLabel: Actor) => {
  const { user: host } = await ctx.newUser();
  const { user: photoOwner } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: host.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: photoOwner.id, role: SharedSpaceRole.Editor });

  const originalPath = join(imageDir, `${photoOwner.id}.png`);
  await writeFile(originalPath, newRandomImage());
  const { asset } = await ctx.newAsset({ ownerId: photoOwner.id, originalPath });
  await ctx.newExif({ assetId: asset.id, description: '' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: photoOwner.id });
  const ownerTag = await tagAs(ctx, photoOwner, asset.id, OWNER_TAG);

  let actor: { id: string; isAdmin: boolean };
  switch (actorLabel) {
    case 'photo owner': {
      actor = photoOwner;
      break;
    }
    case 'space owner': {
      actor = host;
      break;
    }
    case 'space editor':
    case 'space viewer': {
      ({ user: actor } = await ctx.newUser());
      const role = actorLabel === 'space editor' ? SharedSpaceRole.Editor : SharedSpaceRole.Viewer;
      await ctx.newSharedSpaceMember({ spaceId: space.id, userId: actor.id, role });
      break;
    }
    case 'non-member': {
      ({ user: actor } = await ctx.newUser());
      break;
    }
    case 'admin non-member': {
      ({ user: actor } = await ctx.newUser({ isAdmin: true }));
      break;
    }
  }

  return { photoOwner, asset, ownerTag, actor };
};

const exifTags = async (ctx: Ctx, assetId: string) => {
  const { tags } = await ctx.database
    .selectFrom('asset_exif')
    .select('tags')
    .where('assetId', '=', assetId)
    .executeTakeFirstOrThrow();
  return tags ?? [];
};

const isLinked = async (ctx: Ctx, tagId: string, assetId: string) =>
  !!(await ctx.database
    .selectFrom('tag_asset')
    .select('tagId')
    .where('tagId', '=', tagId)
    .where('assetId', '=', assetId)
    .executeTakeFirst());

const grid: Partial<Record<Actor, Outcome>> = {};

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
  imageDir = await mkdtemp(join(tmpdir(), 'tag-owner-tree-'));
});

describe("a tag put on a member's photo", () => {
  it.each(ACTORS)('actor: %s', async (actorLabel) => {
    const ctx = setup();
    const { photoOwner, asset, ownerTag, actor } = await buildWorld(ctx, actorLabel);
    const value = `Actor/${actorLabel.replaceAll(' ', '-')}`;

    const actorTag = await tagAs(ctx, actor, asset.id, value);
    const tagged = await isLinked(ctx, actorTag.id, asset.id);
    const metadataTags = await exifTags(ctx, asset.id);
    const inPhotoMetadata = metadataTags.includes(value);

    await ctx.getService(MetadataService).handleMetadataExtraction({ id: asset.id });

    const ownersTree = await ctx.database
      .selectFrom('tag')
      .select('value')
      .where('userId', '=', photoOwner.id)
      .execute();
    const outcome: Outcome = {
      tagged,
      inPhotoMetadata,
      inPhotoOwnersTree: ownersTree.some((tag) => tag.value === value),
      survivesExtraction: await isLinked(ctx, actorTag.id, asset.id),
      photoOwnersOwnTagSurvives: await isLinked(ctx, ownerTag.id, asset.id),
    };

    expect(outcome).toEqual(TRUTH[actorLabel]);
    grid[actorLabel] = outcome;
  });

  it('outcome grid', () => {
    expect(Object.keys(grid).toSorted()).toEqual([...ACTORS].toSorted());
    expect(grid).toMatchSnapshot();
  });
});
