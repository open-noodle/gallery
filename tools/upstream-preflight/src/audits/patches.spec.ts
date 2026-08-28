import { describe, expect, it } from 'vitest';
import { checkPackagePatchText, resolvedImporterVersions } from './patches';

const patch = {
  id: 'immich-ui-command-patch',
  package: '@immich/ui',
  version_source: 'pnpm-workspace.yaml',
  expected_patch: 'patches/@immich__ui@0.79.0.patch',
  required_check: 'fork-patches-check',
};

describe('checkPackagePatchText', () => {
  it('passes when the version source points at the expected patch', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.79.0': patches/@immich__ui@0.79.0.patch\n",
      ['patches/@immich__ui@0.79.0.patch'],
    );

    expect(result.ok).toBe(true);
  });

  it('fails when the expected patch file is missing', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.79.0': patches/@immich__ui@0.79.0.patch\n",
      [],
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'Missing patch file patches/@immich__ui@0.79.0.patch',
    ]);
  });

  it('fails when the version source does not reference the patch', () => {
    const result = checkPackagePatchText(patch, 'patchedDependencies: {}\n', [
      'patches/@immich__ui@0.79.0.patch',
    ]);

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      'pnpm-workspace.yaml does not reference patches/@immich__ui@0.79.0.patch',
    ]);
  });
});

const lock = (version: string) =>
  [
    'importers:',
    '  web:',
    '    dependencies:',
    "      '@immich/ui':",
    '        specifier: ^0.79.0',
    `        version: ${version}`,
    'snapshots:',
    // inline form the parser must NOT read as an importer entry
    "  'other@1.0.0':",
    '    dependencies:',
    "      '@immich/ui': 0.79.0(patch_hash=abc)(svelte@5.0.0)",
    '',
  ].join('\n');

describe('resolvedImporterVersions', () => {
  it('reads the importer version and ignores inline snapshot dependencies', () => {
    expect(
      resolvedImporterVersions(lock('0.79.0(patch_hash=abc)'), '@immich/ui'),
    ).toEqual(['0.79.0(patch_hash=abc)']);
  });
});

describe('checkPackagePatchText lockfile resolution', () => {
  it('passes when the resolved version carries the patch hash', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.79.0': patches/@immich__ui@0.79.0.patch\n",
      ['patches/@immich__ui@0.79.0.patch'],
      lock('0.79.0(patch_hash=abc)(svelte@5.0.0)'),
    );

    expect(result.ok).toBe(true);
  });

  it('fails when an upstream bump left the pin behind, even though the file exists', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.79.0': patches/@immich__ui@0.79.0.patch\n",
      ['patches/@immich__ui@0.79.0.patch'],
      lock('0.86.0(svelte@5.0.0)'),
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      '@immich/ui resolves to 0.86.0 but patches/@immich__ui@0.79.0.patch is pinned to 0.79.0 — re-derive the patch against 0.86.0',
    ]);
  });

  it('fails when the version matches but no patch was applied', () => {
    const result = checkPackagePatchText(
      patch,
      "patchedDependencies:\n  '@immich/ui@0.79.0': patches/@immich__ui@0.79.0.patch\n",
      ['patches/@immich__ui@0.79.0.patch'],
      lock('0.79.0(svelte@5.0.0)'),
    );

    expect(result.ok).toBe(false);
    expect(result.details).toEqual([
      '@immich/ui resolves to 0.79.0 with no patch applied — the fork patch is silently inactive',
    ]);
  });
});
