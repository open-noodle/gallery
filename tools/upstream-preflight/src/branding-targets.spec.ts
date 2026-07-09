import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 12 (findings M6, M8, LOW#20, LOW#21, LOW#22).
//
// `branding/apply-branding.sh` rewrites upstream Immich references to the fork
// brand at Docker-build time by sed'ing specific files. When upstream renames or
// moves one of those files during a rebase, the sed's target string silently
// stops matching and that file ships UNBRANDED (leaks Immich). Neither the build
// nor CI fails, because the branding pass is best-effort per file.
//
// This guard makes that failure loud: for every load-bearing branding target it
// asserts BOTH
//   (a) apply-branding.sh still references the current path, and
//   (b) that path exists in the tree.
// So it fails the NEXT rebase if upstream renames the file again (existence
// check) or if the branding target reverts to a stale path (reference check).
// It also pins config.json's upstream base version.

const REPO_ROOT = path.resolve(process.cwd(), '../..');
const APPLY_BRANDING = fs.readFileSync(
  path.join(REPO_ROOT, 'branding/scripts/apply-branding.sh'),
  'utf8',
);
const CONFIG = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, 'branding/config.json'), 'utf8'),
);

// Each target's current, correct repo-relative path. apply-branding.sh must
// reference it and it must exist on disk.
const TARGETS: { finding: string; path: string }[] = [
  // M6 — sidebar server-status component renamed server-status.svelte -> ServerStatus.svelte
  {
    finding: 'M6',
    path: 'web/src/lib/components/shared-components/side-bar/ServerStatus.svelte',
  },
  // LOW#22 — ErrorLayout.svelte moved to web/src/routes/
  { finding: 'LOW#22', path: 'web/src/routes/ErrorLayout.svelte' },
  // LOW#20 — cli/ moved to packages/cli, open-api/typescript-sdk/ moved to packages/sdk
  { finding: 'LOW#20', path: 'packages/cli/package.json' },
  { finding: 'LOW#20', path: 'packages/sdk/package.json' },
  // LOW#21 — iOS bundle-id patch target (existence invariant)
  { finding: 'LOW#21', path: 'mobile/ios/Runner.xcodeproj/project.pbxproj' },
];

describe('branding target paths', () => {
  for (const { finding, path: rel } of TARGETS) {
    it(`${finding}: apply-branding.sh references an existing ${rel}`, () => {
      expect(
        fs.existsSync(path.join(REPO_ROOT, rel)),
        `${rel} is missing from the tree`,
      ).toBe(true);
      expect(
        APPLY_BRANDING.includes(rel),
        `apply-branding.sh does not reference ${rel}`,
      ).toBe(true);
    });
  }

  // M8 — the branch is rebased onto upstream Immich v3.0.2, so
  // `branding/config.json` upstream.version is bumped to match. The
  // gallery-revert-to-immich-validation workflow boots the Gallery `:main` image
  // (now v3-based) against `ghcr.io/immich-app/immich-server:v${upstream.version}`,
  // and revert-to-immich.sql reverses no post-v3.0.2 upstream migrations because the
  // v3.0.1→v3.0.2 delta added none. Keep this pinned to the base Immich version.
  it('M8: config.json upstream.version is 3.0.2 (base is immich v3.0.2)', () => {
    expect(CONFIG.upstream.version).toBe('3.0.2');
  });
});
