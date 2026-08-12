import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AuthDto } from 'src/dtos/auth.dto';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service';
import { newTestService } from 'test/utils';
import { describe, expect, it } from 'vitest';

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

const auth = { user: { id: 'user-1' } } as AuthDto;

describe(GalleryWorkflowHostService.name, () => {
  const setup = () => newTestService(GalleryWorkflowHostService);

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
