import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Repo-invariant guard for Slice 19 (findings LOW#19/#24).
//
// `open-api/typescript-sdk/build-old-root/` was a stale, hand-committed copy of compiled
// SDK output (fetch-client.js/.d.ts, index.js/.d.ts, fetch-errors.js/.d.ts) that had
// drifted ~30 endpoints out of date and was referenced by nothing (no import, no build
// script, no branding target — `apply-branding.sh`'s `patch_versions` reference to it was
// already removed in Slice 12). This guard pins the directory's absence so it can't
// silently reappear (e.g. a bad rebase re-adding it, or a future `git checkout` of an old
// ref reintroducing it into a merge).
//
// NOTE: LOW#18 (re-wiring the orphaned `native_class_nullable_items_in_arrays.patch` into
// `open-api/bin/generate-dart-sdk.sh`) is intentionally NOT guarded here. Investigation
// (see specs/2026-07-02-rolling-rebase-audit-findings.md) proved the
// patch no longer applies cleanly against the current template (2 of 3 hunks reject with
// `patch -p1 --dry-run`) because a separate, later template patch
// (`native_class.mustache.patch`) already rewrote the same region for the
// `vendorExtensions.x-is-optional` (`Optional<T>`) pattern. Re-inserting `main`'s exact
// `patch ... <native_class_nullable_items_in_arrays.patch` line into
// `generate-dart-sdk.sh` (which runs under `set -euo pipefail`) would make Dart SDK
// generation fail on every run. That fix needs the patch's hunks re-authored against the
// current template, not a mechanical re-wire, so no guard is added prematurely for it.

const REPO_ROOT = path.resolve(process.cwd(), '../..');

describe('repo hygiene', () => {
  it('LOW#19/#24: open-api/typescript-sdk/build-old-root/ does not exist', () => {
    const staleDir = path.join(
      REPO_ROOT,
      'open-api/typescript-sdk/build-old-root',
    );
    expect(
      fs.existsSync(staleDir),
      `${staleDir} should have been deleted (stale compiled SDK output)`,
    ).toBe(false);
  });
});
