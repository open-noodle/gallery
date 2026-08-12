import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import { describe, expect, it } from 'vitest';

const manifestPath = join(import.meta.dirname, '../../../packages/plugin-gallery/manifest.json');
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
