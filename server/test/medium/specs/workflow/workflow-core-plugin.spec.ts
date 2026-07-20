import { WorkflowStepConfig, WorkflowTrigger } from '@immich/plugin-sdk';
import { Kysely } from 'kysely';
import { readFileSync } from 'node:fs';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import { AssetType, AssetVisibility, LogLevel } from 'src/enum';
import { AccessRepository } from 'src/repositories/access.repository';
import { AlbumRepository } from 'src/repositories/album.repository';
import { AssetFavoriteRepository } from 'src/repositories/asset-favorite.repository';
import { AssetRepository } from 'src/repositories/asset.repository';
import { ConfigRepository } from 'src/repositories/config.repository';
import { CryptoRepository } from 'src/repositories/crypto.repository';
import { DatabaseRepository } from 'src/repositories/database.repository';
import { EventRepository } from 'src/repositories/event.repository';
import { LoggingRepository } from 'src/repositories/logging.repository';
import { PluginRepository } from 'src/repositories/plugin.repository';
import { SharedSpaceRepository } from 'src/repositories/shared-space.repository';
import { StorageRepository } from 'src/repositories/storage.repository';
import { UserRepository } from 'src/repositories/user.repository';
import { WorkflowRepository } from 'src/repositories/workflow.repository';
import { DB } from 'src/schema';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service';
import { resolveMethod } from 'src/utils/workflow';
import { MediumTestContext } from 'test/medium.factory';
import { mockEnvData } from 'test/repositories/config.repository.mock';
import { getKyselyDB } from 'test/utils';

let isInitialized = false;

class WorkflowTestContext extends MediumTestContext<WorkflowExecutionService> {
  constructor(database: Kysely<DB>) {
    super(WorkflowExecutionService, {
      database,
      real: [
        AccessRepository,
        AlbumRepository,
        AssetRepository,
        // #763: the assetFavorite core-plugin action calls AssetService.update() with isFavorite set,
        // which now routes through AssetFavoriteRepository (asset_favorite is the per-user overlay,
        // not the legacy asset.isFavorite column). Same wiring reason as SharedSpaceRepository below —
        // the plugin-host AssetService is built via BaseService.create(AssetService, this).
        AssetFavoriteRepository,
        CryptoRepository,
        DatabaseRepository,
        LoggingRepository,
        PluginRepository,
        // Slice 3: AssetService.update() now routes visibility through applyVisibilityTransitionSideEffects,
        // which uses this.sharedSpaceRepository (space purge/restore emits). The plugin-host AssetService is
        // built via BaseService.create(AssetService, this), reading repos off this WorkflowExecutionService —
        // so the harness must wire SharedSpaceRepository (real: no-op for the non-space assets used here).
        SharedSpaceRepository,
        StorageRepository,
        UserRepository,
        WorkflowRepository,
      ],
      mock: [ConfigRepository, EventRepository],
    });
  }

  async init() {
    if (isInitialized) {
      return;
    }

    const mockData = mockEnvData({});
    mockData.resourcePaths.corePlugin = '../packages/plugin-core';
    mockData.plugins.external.allow = false;
    this.getMock(ConfigRepository).getEnv.mockReturnValue(mockData);
    // album.service emits AlbumAssetsAdd/Remove on asset mutations; this harness doesn't exercise
    // space sync, so stub the emit to a no-op (automock throws on unimplemented calls).
    this.getMock(EventRepository).emit.mockResolvedValue();
    this.get(LoggingRepository).setLogLevel(LogLevel.Verbose);

    await this.sut.onPluginSync();
    await this.sut.onPluginLoad();

    isInitialized = true;
  }
}

type WorkflowTemplate = {
  ownerId: string;
  trigger: WorkflowTrigger;
  steps: WorkflowTemplateStep[];
};

type WorkflowTemplateStep = {
  method: string;
  config?: WorkflowStepConfig;
};

const createWorkflow = async (template: WorkflowTemplate) => {
  const workflowRepo = ctx.get(WorkflowRepository);
  const pluginRepo = ctx.get(PluginRepository);

  const methods = await pluginRepo.getForValidation();
  const steps = template.steps.map((step) => {
    const pluginMethod = resolveMethod(methods, step.method);
    if (!pluginMethod) {
      throw new Error(`Plugin method not found: ${step.method}`);
    }

    return { ...step, pluginMethod };
  });

  return workflowRepo.create(
    {
      enabled: true,
      name: 'Test workflow',
      description: 'A workflow to test the core plugin',
      ownerId: template.ownerId,
      trigger: template.trigger,
    },
    steps.map((step) => ({
      enabled: true,
      pluginMethodId: step.pluginMethod.id,
      config: step.config,
    })),
  );
};

let ctx: WorkflowTestContext;

beforeAll(async () => {
  const db = await getKyselyDB();
  ctx = new WorkflowTestContext(db);
  await ctx.init();
}, 30_000);

describe('core plugin', () => {
  describe('validation', () => {
    it('should have a valid manifest.json', () => {
      const buffer = readFileSync('../packages/plugin-core/manifest.json');
      const result = PluginManifestDto.schema.safeParse(JSON.parse(buffer.toString()));
      if (!result.success) {
        const issues =
          'error' in result
            ? result.error.issues.map((issue) => `  - [${issue.path.join('.')}] ${issue.message}`).join('\n')
            : '';
        const message = `Invalid packages/plugin-core/manifest.json:\n${issues}`;
        expect(result.success, message).toBe(true);
      }

      expect(result.success).toBe(true);
    });
  });

  describe('assetArchive', () => {
    it('should archive an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetArchive' }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Archive,
      });
    });

    it('should unarchive an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Archive });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetArchive', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Timeline,
      });
    });
  });

  describe('assetLock', () => {
    it('should lock an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetLock' }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Locked,
      });
    });

    it('should unlock an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, visibility: AssetVisibility.Locked });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetLock', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id)).resolves.toMatchObject({
        visibility: AssetVisibility.Timeline,
      });
    });
  });

  describe('assetFavorite', () => {
    it('should favorite an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetFavorite' }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      // #763: favorites are a per-user overlay (asset_favorite), not the legacy asset.isFavorite
      // column — the workflow's synthesized auth acts AS the asset owner, so isFavoriteForUser
      // resolved for that same owner is the correct place to assert the write landed.
      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: true,
      });
    });

    it('should unfavorite an asset', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      // #763: seed the per-user overlay row directly — ctx.newAsset's isFavorite option only sets
      // the legacy column, which the read path no longer consults.
      await ctx.get(AssetFavoriteRepository).addAll(user.id, [asset.id]);

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetFavorite', config: { inverse: true } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: false,
      });
    });

    // #763 slice 3 pre-drop: workflow.repository.ts's getForAssetV1 (the workflowAssetV1
    // projection consumed by handleAssetTrigger's read()) must resolve the plugin-facing
    // `isFavorite` field via favoriteExistsForOwner directly, not the legacy raw column — this
    // asserts the PROJECTION itself, independent of the assetFavorite plugin action's write path
    // covered above.
    it('projects the ASSET OWNER favorite onto workflowAssetV1, not another user favorite', async () => {
      const { user: owner } = await ctx.newUser();
      const { user: other } = await ctx.newUser();
      const { asset: ownerFavorited } = await ctx.newAsset({ ownerId: owner.id });
      const { asset: notOwnerFavorited } = await ctx.newAsset({ ownerId: owner.id });

      // Owner favorites via the per-user overlay only — the legacy asset.isFavorite column is
      // never touched.
      await ctx.get(AssetFavoriteRepository).addAll(owner.id, [ownerFavorited.id]);
      // A DIFFERENT user favorites the other asset — its owner never favorited it.
      await ctx.get(AssetFavoriteRepository).addAll(other.id, [notOwnerFavorited.id]);

      await expect(ctx.get(WorkflowRepository).getForAssetV1(ownerFavorited.id)).resolves.toMatchObject({
        isFavorite: true,
      });
      await expect(ctx.get(WorkflowRepository).getForAssetV1(notOwnerFavorited.id)).resolves.toMatchObject({
        isFavorite: false,
      });
    });
  });

  describe('assetAddToAlbums', () => {
    it('should create an album by name', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [], albumName: 'Screenshots' } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      const albums = await ctx.get(AlbumRepository).getAll(user.id);
      expect(albums).toHaveLength(1);

      const album = albums[0]!;
      expect(album.albumName).toEqual('Screenshots');

      const updated = await ctx.get(WorkflowRepository).get(workflow.id);
      expect(updated?.steps[0].config).toEqual({ albumIds: [album.id], albumName: 'Screenshots' });

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should not use the name when there is an albumId', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          { method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album.id], albumName: 'Screenshots' } },
        ],
      });

      const albums = await ctx.get(AlbumRepository).getAll(user.id);
      expect(albums).toHaveLength(1);
      expect(albums[0].albumName).toEqual(album.albumName);

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should add an asset to an album', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      const { album } = await ctx.newAlbum({ ownerId: user.id });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album.id] } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should add an asset to multiple albums', async () => {
      const { user } = await ctx.newUser();
      const [{ asset }, { album: album1 }, { album: album2 }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id }),
        ctx.newAlbum({ ownerId: user.id }),
        ctx.newAlbum({ ownerId: user.id }),
      ]);

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album1.id, album2.id] } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();

      await expect(ctx.get(AlbumRepository).getAssetIds(album1.id, [asset.id])).resolves.toContain(asset.id);
      await expect(ctx.get(AlbumRepository).getAssetIds(album2.id, [asset.id])).resolves.toContain(asset.id);
    });

    it('should require album access', async () => {
      const { user: user1 } = await ctx.newUser();
      const { user: user2 } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user1.id });
      const { album } = await ctx.newAlbum({ ownerId: user2.id });

      const workflow = await createWorkflow({
        ownerId: user1.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [{ method: 'immich-plugin-core#assetAddToAlbums', config: { albumIds: [album.id] } }],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeTruthy();

      await expect(ctx.get(AlbumRepository).getAssetIds(album.id, [asset.id])).resolves.not.toContain(asset.id);
    });
  });

  describe('assetLocationFilter', () => {
    it('should favorite an asset within a given radius', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, latitude: 49.27335322114536, longitude: -123.10387144078764 });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          {
            method: 'immich-plugin-core#assetLocationFilter',
            config: { coordinate: { latitude: 49.28882167994929, longitude: -123.1111530988137, radius: 2 } },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();
      // #763: per-user overlay — the workflow acts as the asset owner.
      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: true,
      });
    });

    it('should not favorite asset outside a given radius', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, latitude: 49.26126605257035, longitude: -123.24895939078196 });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          {
            method: 'immich-plugin-core#assetLocationFilter',
            config: { coordinate: { latitude: 49.28882167994929, longitude: -123.1111530988137, radius: 10 } },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();
      // #763: per-user overlay — the workflow acts as the asset owner.
      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: false,
      });
    });

    it('should favorite asset by location name', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });
      await ctx.newExif({ assetId: asset.id, city: 'Vancouver' });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetMetadataExtraction,
        steps: [
          {
            method: 'immich-plugin-core#assetLocationFilter',
            config: { region: { city: 'Vancouver' } },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();
      // #763: per-user overlay — the workflow acts as the asset owner.
      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: true,
      });
    });
  });

  describe('assetTypeFilter', () => {
    it('should favorite asset if it is a video', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id, type: AssetType.Video });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          {
            method: 'immich-plugin-core#assetTypeFilter',
            config: { allowedTypes: ['VIDEO'] },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();
      // #763: per-user overlay — the workflow acts as the asset owner.
      await expect(ctx.get(AssetRepository).getById(asset.id, {}, user.id)).resolves.toMatchObject({
        isFavoriteForUser: true,
      });
    });
  });

  describe('assetDateFilter', () => {
    it('should favorite assets created during the first 7 days of a specific year and month', async () => {
      const { user } = await ctx.newUser();
      const [{ asset: asset1 }, { asset: asset2 }, { asset: asset3 }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2000-04-01') }),
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2000-04-07T23:59:59Z') }),
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2000-04-08T00:00:00Z') }),
      ]);

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          {
            method: 'immich-plugin-core#assetDateFilter',
            config: {
              startDate: { day: 1, month: 4, year: 2000 },
              endDate: { day: 7, month: 4, year: 2000 },
              recurring: false,
            },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset1.id });
      await expect(ctx.get(AssetRepository).getById(asset1.id)).resolves.toMatchObject({ isFavorite: true });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset2.id });
      await expect(ctx.get(AssetRepository).getById(asset2.id)).resolves.toMatchObject({ isFavorite: true });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset3.id });
      await expect(ctx.get(AssetRepository).getById(asset3.id)).resolves.toMatchObject({ isFavorite: false });
    });

    it('should match recurring dates regardless of the year', async () => {
      const { user } = await ctx.newUser();
      const [{ asset: asset1 }, { asset: asset2 }, { asset: asset3 }] = await Promise.all([
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2026-03-01') }),
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('1998-12-21') }),
        ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2000-04-08T00:00:00Z') }),
      ]);
      await ctx.newAsset({ ownerId: user.id, localDateTime: new Date('2010-06-15') });

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          {
            method: 'immich-plugin-core#assetDateFilter',
            config: {
              startDate: { day: 12, month: 12, year: 2000 },
              endDate: { day: 30, month: 3, year: 2001 },
              recurring: true,
            },
          },
          {
            method: 'immich-plugin-core#assetFavorite',
          },
        ],
      });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset1.id });
      await expect(ctx.get(AssetRepository).getById(asset1.id)).resolves.toMatchObject({ isFavorite: true });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset2.id });
      await expect(ctx.get(AssetRepository).getById(asset2.id)).resolves.toMatchObject({ isFavorite: true });

      await ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset3.id });
      await expect(ctx.get(AssetRepository).getById(asset3.id)).resolves.toMatchObject({ isFavorite: false });
    });
  });

  describe('webhook', () => {
    it('should trigger a webhook on asset upload', async () => {
      const { user } = await ctx.newUser();
      const { asset } = await ctx.newAsset({ ownerId: user.id });

      const fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('') }));
      vi.stubGlobal('fetch', fetchMock);

      const workflow = await createWorkflow({
        ownerId: user.id,
        trigger: WorkflowTrigger.AssetCreate,
        steps: [
          {
            method: 'immich-plugin-core#webhook',
            config: { url: 'http://localhost', method: 'POST' },
          },
        ],
      });

      await expect(ctx.sut.handleAssetTrigger({ workflowId: workflow.id, assetId: asset.id })).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalled();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });
  });
});
