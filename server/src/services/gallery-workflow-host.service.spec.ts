import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Mock, describe, expect, it, vi } from 'vitest';
import { AuthDto } from 'src/dtos/auth.dto.js';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto.js';
import { BaseService } from 'src/services/base.service.js';
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service.js';
import { WorkflowExecutionService } from 'src/services/workflow-execution.service.js';
import { newTestService } from 'test/utils.js';

const manifestPath = join(process.cwd(), '..', 'packages/plugin-gallery/manifest.json');
const readManifest = () => JSON.parse(readFileSync(manifestPath, { encoding: 'utf8' }));

describe('gallery plugin manifest', () => {
  // U0 — manifest failure is SILENT at runtime: importFolder catches everything and only warns
  // (workflow-execution.service.ts:269-271), so an invalid manifest ships an image where the
  // feature simply does not exist, with a green test suite.
  it('validates against the server manifest schema', () => {
    const result = PluginManifestDto.schema.safeParse(readManifest());
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('declares exactly the two space actions', () => {
    expect(
      readManifest()
        .methods.map((method: { name: string }) => method.name)
        .sort(),
    ).toEqual(['addToSpace', 'addToSpaceAlbum']);
  });
});

describe('manifest / handler parity', () => {
  // U1 — the dispatcher is string-keyed across the WASM boundary, so a renamed handler would
  // otherwise break only at runtime. Introduced here, in the task that makes it pass, so no commit
  // in this plan ever leaves the suite red.
  it('has a handler for every manifest method and no extras', () => {
    const { sut } = newTestService(GalleryWorkflowHostService);
    expect(sut.methodNames.sort()).toEqual(
      readManifest()
        .methods.map((method: { name: string }) => method.name)
        .sort(),
    );
  });
});

const auth = { user: { id: 'user-1' } } as AuthDto;

const setup = () => newTestService(GalleryWorkflowHostService);

describe(GalleryWorkflowHostService.name, () => {
  // U2 — a stale externally-installed plugin must degrade, not explode.
  it('resolves ok:false for an unknown method instead of rejecting', async () => {
    const { sut } = setup();
    await expect(sut.dispatch(auth, 'noSuchMethod', {})).resolves.toEqual({
      ok: false,
      reason: 'unknown-method',
    });
  });

  // Regression: prototype-chain collision — handlers inherits Object.prototype,
  // so handlers['constructor'], handlers['__proto__'], etc. are truthy and bypass the guard.
  it('does not call prototype chain properties as handlers', async () => {
    const { sut } = setup();
    await expect(sut.dispatch(auth, '__proto__', {})).resolves.toEqual({
      ok: false,
      reason: 'unknown-method',
    });
  });

  it('does not call constructor as a handler', async () => {
    const { sut } = setup();
    await expect(sut.dispatch(auth, 'constructor', {})).resolves.toEqual({
      ok: false,
      reason: 'unknown-method',
    });
  });
});

// A stand-in handler so the invariant is tested once, not per-handler.
class ProbeService extends GalleryWorkflowHostService {
  error: unknown;
  protected override collaborators() {
    return {
      sharedSpace: { addAssets: () => Promise.reject(this.error) },
      album: {},
    } as never;
  }
}

const probe = (error: unknown) => {
  const { sut } = newTestService(ProbeService);
  sut.error = error;
  return sut;
};

describe('never-throws invariant', () => {
  const args = { assetId: '00000000-0000-4000-8000-000000000001', spaceIds: ['00000000-0000-4000-8000-000000000002'] };

  // U3 / U4 — every expected rejection resolves ok:false. If any of these threw, upstream's
  // execute() would catch it and abandon all remaining steps (spec §7).
  it.each([
    ['BadRequestException', new BadRequestException('nope')],
    ['ForbiddenException', new ForbiddenException('nope')],
    ['NotFoundException', new NotFoundException('nope')],
    ['UnauthorizedException', new UnauthorizedException('nope')],
  ])('resolves ok:false for %s', async (_name, error) => {
    await expect(probe(error).dispatch(auth, 'addToSpace', args)).resolves.toMatchObject({ ok: false });
  });

  // U5 — a genuine bug must still fail the run loudly.
  it('propagates an unexpected error', async () => {
    await expect(probe(new TypeError('boom')).dispatch(auth, 'addToSpace', args)).rejects.toThrow('boom');
  });
});

const ASSET = '00000000-0000-4000-8000-0000000000aa';
const SPACE_A = '00000000-0000-4000-8000-00000000000a';
const SPACE_B = '00000000-0000-4000-8000-00000000000b';
const SPACE_C = '00000000-0000-4000-8000-00000000000c';

type Doubles = {
  sharedSpace: { addAssets: Mock; getLinkedAlbums: Mock; linkAlbum: Mock };
  album: { create: Mock; addAssets: Mock; delete: Mock };
};

const makeDoubles = (): Doubles => ({
  sharedSpace: { addAssets: vi.fn(), getLinkedAlbums: vi.fn(), linkAlbum: vi.fn() },
  album: { create: vi.fn(), addAssets: vi.fn(), delete: vi.fn() },
});

class TestableService extends GalleryWorkflowHostService {
  doubles = makeDoubles();
  protected override collaborators() {
    return this.doubles as never;
  }
}

const setupTestable = () => {
  const { sut } = newTestService(TestableService);
  return { sut, doubles: sut.doubles };
};

const run = (sut: TestableService, config: unknown) => sut.dispatch(auth, 'addToSpace', config);

// Hoisted per unicorn/consistent-function-scoping — neither closes over anything from a describe
// block, so both must live at module scope rather than be redeclared inside it.
const linked = (id: string, albumName: string, createdAt: string) => ({ id, albumName, createdAt });
const runAlbum = (sut: TestableService, config: unknown) => sut.dispatch(auth, 'addToSpaceAlbum', config);

describe('addToSpace', () => {
  it('adds the asset once per space', async () => {
    // U6
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_B] })).resolves.toEqual({ ok: true });
    expect(doubles.sharedSpace.addAssets.mock.calls).toEqual([
      [auth, SPACE_A, { assetIds: [ASSET] }],
      [auth, SPACE_B, { assetIds: [ASSET] }],
    ]);
  });

  it('de-duplicates repeated space ids', async () => {
    // U7
    const { sut, doubles } = setupTestable();
    await run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_A] });
    expect(doubles.sharedSpace.addAssets).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty space list', async () => {
    // U8
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: [] })).resolves.toEqual({ ok: true });
    expect(doubles.sharedSpace.addAssets).not.toHaveBeenCalled();
  });

  it('rejects malformed config without calling the service', async () => {
    // U9
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: 'not-an-array' })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
    expect(doubles.sharedSpace.addAssets).not.toHaveBeenCalled();
  });

  it('reports ok:false when the owner may not contribute', async () => {
    // U10 — the reason label is deliberately not asserted (spec D11)
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockRejectedValue(new BadRequestException('not a member'));
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toMatchObject({ ok: false });
  });

  it('reports ok:false when the space is gone', async () => {
    // U11
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockRejectedValue(new NotFoundException('gone'));
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toMatchObject({ ok: false });
  });

  it('succeeds when the asset is already in the space', async () => {
    // U12 — addAssets is idempotent server-side
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockResolvedValue(undefined);
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toEqual({ ok: true });
  });

  it('still attempts later spaces after one is denied', async () => {
    // U13 — per-space isolation
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException('no'))
      .mockResolvedValueOnce(undefined);
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_B, SPACE_C] })).resolves.toMatchObject({
      ok: false,
    });
    expect(doubles.sharedSpace.addAssets.mock.calls.map(([, spaceId]) => spaceId)).toEqual([SPACE_A, SPACE_B, SPACE_C]);
  });

  it('never returns asset changes', async () => {
    // U14 — a `changes` key would make execute() re-read the asset after every step
    const { sut } = setupTestable();
    const result = await run(sut, { assetId: ASSET, spaceIds: [SPACE_A] });
    expect(result).not.toHaveProperty('changes');
  });

  it('passes the auth it was given straight through to the service', async () => {
    // U26 — the token is minted for the ASSET OWNER, not the workflow owner
    // (workflow-execution.service.ts:158-197). The dispatcher must forward it untouched and must
    // never source an identity from anywhere else, or the space access checks mean nothing.
    const { sut, doubles } = setupTestable();
    const otherAuth = { user: { id: 'someone-else' } } as AuthDto;
    await sut.dispatch(otherAuth, 'addToSpace', { assetId: ASSET, spaceIds: [SPACE_A] });
    expect(doubles.sharedSpace.addAssets).toHaveBeenCalledWith(otherAuth, SPACE_A, { assetIds: [ASSET] });
  });
});

describe('addToSpaceAlbum', () => {
  const ALBUM_OLD = '00000000-0000-4000-8000-0000000000e1';
  const ALBUM_NEW = '00000000-0000-4000-8000-0000000000e2';
  const config = { assetId: ASSET, spaceId: SPACE_A, albumName: 'Holidays 2026' };

  it('uses an existing album without creating or linking', async () => {
    // U15 / U20 — linkAlbum enqueues grant reconcile + face sync; firing it per asset floods the queue
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    await expect(runAlbum(sut, config)).resolves.toEqual({ ok: true });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.sharedSpace.linkAlbum).not.toHaveBeenCalled();
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('matches album names ignoring case and surrounding whitespace', async () => {
    // U16
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'holidays 2026', '2026-01-01T00:00:00Z')]);
    await runAlbum(sut, { ...config, albumName: '  Holidays 2026  ' });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('picks the oldest album when names collide', async () => {
    // U17
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([
      linked(ALBUM_NEW, 'Holidays 2026', '2026-06-01T00:00:00Z'),
      linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z'),
    ]);
    await runAlbum(sut, config);
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('breaks a createdAt tie on album id, deterministically', async () => {
    // U18
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([
      linked(ALBUM_NEW, 'Holidays 2026', '2026-01-01T00:00:00Z'),
      linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z'),
    ]);
    await runAlbum(sut, config);
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('creates, links, then adds — in that order', async () => {
    // U19
    const { sut, doubles } = setupTestable();
    const order: string[] = [];
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: ALBUM_NEW });
    });
    doubles.sharedSpace.linkAlbum.mockImplementation(() => {
      order.push('link');
      return Promise.resolve();
    });
    doubles.album.addAssets.mockImplementation(() => {
      order.push('add');
      return Promise.resolve([]);
    });

    await expect(runAlbum(sut, config)).resolves.toEqual({ ok: true });
    expect(order).toEqual(['create', 'link', 'add']);
    expect(doubles.album.create).toHaveBeenCalledWith(auth, { albumName: 'Holidays 2026' });
    expect(doubles.sharedSpace.linkAlbum).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank album name without creating anything', async () => {
    // U21
    const { sut, doubles } = setupTestable();
    await expect(runAlbum(sut, { ...config, albumName: ' '.repeat(3) })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
    expect(doubles.album.create).not.toHaveBeenCalled();
  });

  it('rejects a missing space id', async () => {
    // U22
    const { sut } = setupTestable();
    await expect(runAlbum(sut, { assetId: ASSET, albumName: 'Holidays 2026' })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
  });

  it('succeeds when the asset is already in the album', async () => {
    // U25
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.addAssets.mockResolvedValue([{ id: ASSET, success: false, error: 'duplicate' }]);
    await expect(runAlbum(sut, config)).resolves.toEqual({ ok: true });
  });

  it('reports ok:false when the album cannot be added to', async () => {
    // U24
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.addAssets.mockRejectedValue(new BadRequestException('no rights'));
    await expect(runAlbum(sut, config)).resolves.toMatchObject({ ok: false });
  });

  it('does not create or link when the space albums cannot be read', async () => {
    // U30
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockRejectedValue(new ForbiddenException('not a member'));
    await expect(runAlbum(sut, config)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.sharedSpace.linkAlbum).not.toHaveBeenCalled();
  });

  it('creates no second album when the job is retried', async () => {
    // U27 — BullMQ retries re-run every step of the workflow
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums
      .mockResolvedValueOnce([])
      .mockResolvedValue([linked(ALBUM_NEW, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });

    await runAlbum(sut, config);
    await runAlbum(sut, config);

    expect(doubles.album.create).toHaveBeenCalledTimes(1);
    expect(doubles.sharedSpace.linkAlbum).toHaveBeenCalledTimes(1);
    expect(doubles.album.addAssets).toHaveBeenCalledTimes(2);
  });
});

describe('addToSpaceAlbum compensation', () => {
  const ALBUM_NEW = '00000000-0000-4000-8000-0000000000e2';
  const ALBUM_OLD = '00000000-0000-4000-8000-0000000000e1';
  // Reuses the module-scope `runAlbum(sut, config)` helper — a `run(sut)` closing over a local
  // `config` would need its own module-scope declaration and collide with the existing `run` /
  // `runAlbum` names (unicorn/consistent-function-scoping forbids the closure form inside a describe).
  const config = { assetId: ASSET, spaceId: SPACE_A, albumName: 'Holidays 2026' };

  it('deletes the album it just created when linking is denied', async () => {
    // U23
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });
    doubles.sharedSpace.linkAlbum.mockRejectedValue(new BadRequestException('cannot link'));

    await expect(runAlbum(sut, config)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.delete).toHaveBeenCalledWith(auth, ALBUM_NEW);
    expect(doubles.album.addAssets).not.toHaveBeenCalled();
  });

  it('never deletes a pre-existing album', async () => {
    // U28
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.addAssets.mockRejectedValue(new BadRequestException('no rights'));

    await expect(runAlbum(sut, config)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.delete).not.toHaveBeenCalled();
  });

  it('still resolves ok:false when the compensating delete itself fails', async () => {
    // U29 — otherwise §7 is breached and the rest of the workflow dies
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });
    doubles.sharedSpace.linkAlbum.mockRejectedValue(new BadRequestException('cannot link'));
    doubles.album.delete.mockRejectedValue(new Error('delete blew up'));

    await expect(runAlbum(sut, config)).resolves.toMatchObject({ ok: false });
  });
});

const GALLERY_PLUGIN_ID = '00000000-0000-4000-8000-0000000000f1';
const OTHER_PLUGIN_ID = '00000000-0000-4000-8000-0000000000f2';

const step = (pluginId: string, methodName: string, config: object) => ({ pluginId, methodName, config });

describe('runStep', () => {
  // OD-18: gallery-core's WASM exports are no-ops, so its steps must run here instead.
  const data = { asset: { id: ASSET } };

  it('dispatches a gallery-core step with the asset and step config', async () => {
    const { sut, mocks } = newTestService(GalleryWorkflowHostService);
    mocks.plugin.getForLoad.mockResolvedValue([{ id: GALLERY_PLUGIN_ID, name: 'gallery-core' }] as never);
    const dispatch = vi.spyOn(sut, 'dispatch').mockResolvedValue({ ok: true });

    await expect(
      sut.runStep(step(GALLERY_PLUGIN_ID, 'addToSpace', { spaceIds: [SPACE_A] }), 'user-1', data),
    ).resolves.toBe(true);
    expect(dispatch).toHaveBeenCalledWith(auth, 'addToSpace', { spaceIds: [SPACE_A], assetId: ASSET });
  });

  it('leaves a same-named method of another plugin to the WASM runtime', async () => {
    const { sut, mocks } = newTestService(GalleryWorkflowHostService);
    mocks.plugin.getForLoad.mockResolvedValue([{ id: GALLERY_PLUGIN_ID, name: 'gallery-core' }] as never);
    const dispatch = vi.spyOn(sut, 'dispatch');

    await expect(sut.runStep(step(OTHER_PLUGIN_ID, 'addToSpace', {}), 'user-1', data)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not look up the plugin for a method gallery-core does not have', async () => {
    const { sut, mocks } = newTestService(GalleryWorkflowHostService);

    await expect(sut.runStep(step(OTHER_PLUGIN_ID, 'assetAddToAlbums', {}), 'user-1', data)).resolves.toBe(false);
    expect(mocks.plugin.getForLoad).not.toHaveBeenCalled();
  });

  it('leaves a disabled gallery-core step to upstream, which fails it like any unloaded plugin', async () => {
    // Upstream reads `enabled` only in getForLoad; a disabled plugin is never loaded, so callMethod throws.
    const { sut, mocks } = newTestService(GalleryWorkflowHostService);
    mocks.plugin.getForLoad.mockResolvedValue([]);
    const dispatch = vi.spyOn(sut, 'dispatch');

    await expect(sut.runStep(step(GALLERY_PLUGIN_ID, 'addToSpace', {}), 'user-1', data)).resolves.toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('reads the enabled plugins once per repository, not once per run', async () => {
    const { sut, mocks } = newTestService(GalleryWorkflowHostService);
    mocks.plugin.getForLoad.mockResolvedValue([{ id: GALLERY_PLUGIN_ID, name: 'gallery-core' }] as never);
    vi.spyOn(sut, 'dispatch').mockResolvedValue({ ok: true });
    const again = BaseService.create(GalleryWorkflowHostService, sut);

    await sut.runStep(step(GALLERY_PLUGIN_ID, 'addToSpace', {}), 'user-1', data);
    await again.runStep(step(OTHER_PLUGIN_ID, 'addToSpace', {}), 'user-1', data);
    expect(mocks.plugin.getForLoad).toHaveBeenCalledTimes(1);
  });
});

describe('WorkflowExecutionService with a gallery-core step', () => {
  it('runs the step in TypeScript and never calls the WASM plugin', async () => {
    const { sut, mocks } = newTestService(WorkflowExecutionService);
    mocks.workflow.getForWorkflowRun.mockResolvedValue({
      id: 'workflow-1',
      trigger: 'AssetCreate',
      logging: false,
      steps: [
        {
          id: 'step-1',
          config: { spaceIds: [SPACE_A] },
          pluginId: GALLERY_PLUGIN_ID,
          methodName: 'addToSpace',
          types: ['AssetV1'],
          hostFunctions: false,
          allowedHosts: [],
        },
      ],
    } as never);
    mocks.workflow.getForAssetV1.mockResolvedValue({ id: ASSET, ownerId: 'user-1' } as never);
    mocks.plugin.getForLoad.mockResolvedValue([{ id: GALLERY_PLUGIN_ID, name: 'gallery-core' }] as never);
    const dispatch = vi.spyOn(GalleryWorkflowHostService.prototype, 'dispatch').mockResolvedValue({ ok: true });

    await sut.handleAssetTrigger({ workflowId: 'workflow-1', assetId: ASSET, trigger: 'AssetCreate' } as never);

    expect(dispatch).toHaveBeenCalledWith(auth, 'addToSpace', { spaceIds: [SPACE_A], assetId: ASSET });
    expect(mocks.plugin.callMethod).not.toHaveBeenCalled();
    dispatch.mockRestore();
  });
});
