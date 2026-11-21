/**
An asset workflow runs only on its own owner's assets: ACTOR × STEP matrix (CLAUDE.md rule 7).

The asset workflow job runs as the asset's owner, with an elevated session and a host-function token signed for that
owner (WorkflowExecutionService.execute). Upstream can rely on that because every event that queues it names the
asset's owner. In the fork a space Owner or Editor may tag a member's asset (bulkTagAssets through
checkAssetEditAccess, #992), and `AssetTag` names the tagger, which queues the TAGGER's "asset tagged" workflows on the
member's asset. The gate under test is the owner check in `execute()`: a workflow runs only when its owner is the
identity the run acts as.

Every cell runs the real chain with the plugins' real WASM: actor bulkTagAssets → AssetTag → onAssetTagged →
WorkflowAssetTrigger → execute → the step's write (AssetService.update, the album host functions, or the gallery-core
dispatcher). The event bus and the queue are replaced by delivering the captured event and running the captured jobs.
Each cell then reads the database, so a refused run is proven to leave no write behind.

Actors, all holding an "asset tagged" workflow of their own:
  asset owner         a space Editor who owns the asset (the control: their own workflow on their own asset)
  space owner         the space's Owner, who can tag the member's asset
  space editor        another Editor, who can tag the member's asset
  space viewer        cannot tag it (bulkTagAssets drops the id), so nothing is queued
  non-member          cannot see it, so cannot tag it
  admin non-member    a server admin outside the space: admin grants nothing on another user's asset

Steps, each one write a workflow could make as the asset's owner:
  archive / lock      visibility, which rbac-3 keeps owner-only; lock also needs the elevated session the job forges
  favorite            the per-user favourite overlay: whose row gets written
  add to album        the actor's album, shared with the asset owner as Editor, so the owner's identity could add it
  add to space        a second space the actor owns, where the asset owner is an Editor, so the owner could add it

The expectations come from TRUTH below, not from the production helper. The grid is snapshotted at the end.

Mutation-checked: with the owner check removed from execute(), the space owner and space editor rows of every step
fail (the asset is archived, locked, favourited for its owner, added to the album and to the second space), and the
grid snapshot fails.
*/
import { WorkflowStepConfig, WorkflowTrigger } from '@immich/plugin-sdk';
import { Kysely } from 'kysely';
import { AlbumUserRole, AssetVisibility, JobName } from 'src/enum.js';
import { SharedSpaceRole } from 'src/gallery/enum.js';
import { GalleryAssetRepository } from 'src/gallery/repositories/gallery-asset.repository.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumUserRepository } from 'src/repositories/album-user.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository.js';
import { AssetRepository } from 'src/repositories/asset.repository.js';
import { ConfigRepository } from 'src/repositories/config.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { DatabaseRepository } from 'src/repositories/database.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { JobRepository } from 'src/repositories/job.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PluginRepository } from 'src/repositories/plugin.repository.js';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository.js';
import { StorageRepository } from 'src/repositories/storage.repository.js';
import { SystemMetadataRepository } from 'src/repositories/system-metadata.repository.js';
import { TagRepository } from 'src/repositories/tag.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { WorkflowRepository } from 'src/repositories/workflow.repository.js';
import { DB } from 'src/schema/index.js';
import { TagService } from 'src/services/tag.service.js';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service.js';
import { resolveMethod } from 'src/utils/workflow.js';
import { MediumTestContext } from 'test/medium.factory.js';
import { mockEnvData } from 'test/repositories/config.repository.mock.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

const ACTORS = [
  'asset owner',
  'space owner',
  'space editor',
  'space viewer',
  'non-member',
  'admin non-member',
] as const;
type Actor = (typeof ACTORS)[number];

const STEPS = ['archive', 'lock', 'favorite', 'add to album', 'add to space'] as const;
type Step = (typeof STEPS)[number];

/** The rule, written out: who can tag a member's asset, and whose workflow may act on it. */
const TRUTH: Record<Actor, { tags: boolean; runs: boolean }> = {
  'asset owner': { tags: true, runs: true },
  'space owner': { tags: true, runs: false },
  'space editor': { tags: true, runs: false },
  'space viewer': { tags: false, runs: false },
  'non-member': { tags: false, runs: false },
  'admin non-member': { tags: false, runs: false },
};

/** What each step leaves in the database when it ran, and when it did not. */
const EFFECT: Record<Step, { ran: unknown; untouched: unknown }> = {
  archive: { ran: AssetVisibility.Archive, untouched: AssetVisibility.Timeline },
  lock: { ran: AssetVisibility.Locked, untouched: AssetVisibility.Timeline },
  favorite: { ran: ['asset owner'], untouched: [] },
  'add to album': { ran: true, untouched: false },
  'add to space': { ran: true, untouched: false },
};

class Context extends MediumTestContext<typeof WorkflowExecutionService> {
  constructor(database: Kysely<DB>) {
    super(WorkflowExecutionService, {
      database,
      real: [
        AccessRepository,
        AlbumRepository,
        AlbumUserRepository,
        AssetFavoriteRepository,
        AssetRepository,
        CryptoRepository,
        DatabaseRepository,
        GalleryAssetRepository,
        PartnerRepository,
        PluginRepository,
        SharedSpaceRepository,
        StorageRepository,
        SystemMetadataRepository,
        TagRepository,
        UserRepository,
        WorkflowRepository,
      ],
      mock: [ConfigRepository, EventRepository, JobRepository, LoggingRepository, WebsocketRepository],
    });
  }

  async init() {
    const env = mockEnvData({});
    env.resourcePaths.corePlugin = '../packages/plugin-core';
    env.resourcePaths.galleryPlugin = '../packages/plugin-gallery';
    env.plugins.external.allow = false;
    this.getMock(ConfigRepository).getEnv.mockReturnValue(env);
    this.getMock(EventRepository).emit.mockResolvedValue();
    this.getMock(JobRepository).queue.mockResolvedValue();
    this.getMock(JobRepository).queueAll.mockResolvedValue();
    this.getMock(WebsocketRepository).clientSend.mockReturnValue();

    await this.sut.onPluginSync();
    await this.sut.onPluginLoad();
  }
}

let ctx: Context;

const METHODS: Record<Step, string> = {
  archive: 'immich-plugin-core#assetArchive',
  lock: 'immich-plugin-core#assetLock',
  favorite: 'immich-plugin-core#assetFavorite',
  'add to album': 'immich-plugin-core#assetAddToAlbums',
  'add to space': 'gallery-core#addToSpace',
};

/** The space, the member's asset, the actor, and the targets a step could write to as the asset owner. */
const buildWorld = async (actorLabel: Actor) => {
  const { user: host } = await ctx.newUser();
  const { user: assetOwner } = await ctx.newUser();
  const { space } = await ctx.newSharedSpace({ createdById: host.id });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: host.id, role: SharedSpaceRole.Owner });
  await ctx.newSharedSpaceMember({ spaceId: space.id, userId: assetOwner.id, role: SharedSpaceRole.Editor });
  const { asset } = await ctx.newAsset({ ownerId: assetOwner.id });
  await ctx.newExif({ assetId: asset.id, description: '' });
  await ctx.newSharedSpaceAsset({ spaceId: space.id, assetId: asset.id, addedById: assetOwner.id });

  let actor: { id: string; isAdmin: boolean };
  switch (actorLabel) {
    case 'asset owner': {
      actor = assetOwner;
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

  const { result: album } = await ctx.newAlbum({ ownerId: actor.id, albumName: `actor album ${actorLabel}` });
  const { space: target } = await ctx.newSharedSpace({ createdById: actor.id });
  await ctx.newSharedSpaceMember({ spaceId: target.id, userId: actor.id, role: SharedSpaceRole.Owner });
  if (actor.id !== assetOwner.id) {
    await ctx.newAlbumUser({ albumId: album.id, userId: assetOwner.id, role: AlbumUserRole.Editor });
    await ctx.newSharedSpaceMember({ spaceId: target.id, userId: assetOwner.id, role: SharedSpaceRole.Editor });
  }

  const labels = new Map([
    [assetOwner.id, 'asset owner'],
    [host.id, 'space owner'],
    [actor.id, actorLabel],
  ]);

  return { actor, assetOwner, asset, album, target, labels };
};

type World = Awaited<ReturnType<typeof buildWorld>>;

const newWorkflow = async (world: World, step: Step) => {
  const method = resolveMethod(await ctx.get(PluginRepository).getForValidation(), METHODS[step]);
  if (!method) {
    throw new Error(`Plugin method not found: ${METHODS[step]}`);
  }

  const config: WorkflowStepConfig | null =
    step === 'add to album'
      ? { albumIds: [world.album.id] }
      : step === 'add to space'
        ? { spaceIds: [world.target.id] }
        : null;
  await ctx
    .get(WorkflowRepository)
    .create(
      { ownerId: world.actor.id, name: `${step} when tagged`, trigger: WorkflowTrigger.AssetTagged, enabled: true },
      [{ pluginMethodId: method.id, config, enabled: true }],
    );
};

/** Tags as the actor, then delivers the emitted AssetTag events and runs the jobs they queued, as the workers would. */
const tagAndRunWorkflows = async ({ actor, asset }: World) => {
  ctx.getMock(EventRepository).emit.mockClear();
  ctx.getMock(JobRepository).queueAll.mockClear();

  const { tag } = await ctx.newTag({ userId: actor.id, value: `tag-${asset.id}` });
  await ctx.getService(TagService).bulkTagAssets(factory.auth({ user: { id: actor.id, isAdmin: actor.isAdmin } }), {
    tagIds: [tag.id],
    assetIds: [asset.id],
  });

  const events = ctx
    .getMock(EventRepository)
    .emit.mock.calls.filter(([name]) => name === 'AssetTag')
    .map(([, payload]) => payload as { assetId: string; userId: string });
  for (const event of events) {
    await ctx.sut.onAssetTagged(event);
  }

  const jobs = ctx
    .getMock(JobRepository)
    .queueAll.mock.calls.flatMap(([items]) => items)
    .filter((job) => job.name === JobName.WorkflowAssetTrigger);
  for (const job of jobs) {
    await ctx.sut.handleAssetTrigger(job.data as never);
  }

  const tagged = await ctx.database
    .selectFrom('tag_asset')
    .select('assetId')
    .where('tagId', '=', tag.id)
    .where('assetId', '=', asset.id)
    .executeTakeFirst();
  return { tagged: !!tagged };
};

const observe = async (world: World, step: Step): Promise<unknown> => {
  const { asset } = world;
  switch (step) {
    case 'archive':
    case 'lock': {
      const row = await ctx.database
        .selectFrom('asset')
        .select('visibility')
        .where('id', '=', asset.id)
        .executeTakeFirstOrThrow();
      return row.visibility;
    }
    case 'favorite': {
      const rows = await ctx.database
        .selectFrom('asset_favorite')
        .select('userId')
        .where('assetId', '=', asset.id)
        .execute();
      return rows.map(({ userId }) => world.labels.get(userId) ?? userId).toSorted();
    }
    case 'add to album': {
      const row = await ctx.database
        .selectFrom('album_asset')
        .select('assetId')
        .where('albumId', '=', world.album.id)
        .where('assetId', '=', asset.id)
        .executeTakeFirst();
      return !!row;
    }
    case 'add to space': {
      const row = await ctx.database
        .selectFrom('shared_space_asset')
        .select('assetId')
        .where('spaceId', '=', world.target.id)
        .where('assetId', '=', asset.id)
        .executeTakeFirst();
      return !!row;
    }
  }
};

const grid: Partial<Record<Actor, Partial<Record<Step, string>>>> = {};

beforeAll(async () => {
  ctx = new Context(await getKyselyDB());
  await ctx.init();
}, 30_000);

describe('asset workflows run only on their own owner’s assets', () => {
  describe.each(STEPS)('step: %s', (step) => {
    it.each(ACTORS)('actor: %s', async (actorLabel) => {
      const world = await buildWorld(actorLabel);
      await newWorkflow(world, step);
      // Every target starts untouched, so a cell that expects no effect cannot pass vacuously.
      await expect(observe(world, step)).resolves.toEqual(EFFECT[step].untouched);

      const { tagged } = await tagAndRunWorkflows(world);
      const effect = await observe(world, step);

      const { tags, runs } = TRUTH[actorLabel];
      expect(tagged).toBe(tags);
      expect(effect).toEqual(runs ? EFFECT[step].ran : EFFECT[step].untouched);

      grid[actorLabel] ??= {};
      grid[actorLabel][step] = `${tagged ? 'tagged' : 'not tagged'}, ${JSON.stringify(effect)}`;
    });
  });

  it('outcome grid', () => {
    expect(Object.keys(grid).toSorted()).toEqual([...ACTORS].toSorted());
    expect(grid).toMatchSnapshot();
  });
});
