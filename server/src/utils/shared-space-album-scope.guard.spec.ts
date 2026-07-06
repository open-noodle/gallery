// Slice 4 — backstop guard (spec §2.5). The recurring space-album defect class is
// "a 3-path access-scoping branch gains a shared_space_library arm but forgets the
// shared_space_album arm" (the historical F1 bug). This test scans every scoping
// file and asserts that each shared_space_library scoping reference has a nearby
// linked-album marker — either raw `shared_space_album` OR a call to one of the
// fork-owned album-scope helpers. It fires on any future clone (fork or upstream
// rebase) that omits the album leg.
//
// Benign non-scope references (CRUD, column lists, library-only sync helpers) are
// filtered by pattern; genuine non-3-path sites are named in ALLOWLIST with a
// reason. Two ALLOWLIST entries are GAPS this very guard discovered — see below.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Server root — vitest runs with cwd at server/ (matches face-identity-query-shape.spec.ts).
const SERVER_ROOT = process.cwd();

const SCOPING_FILES = [
  'src/repositories/shared-space.repository.ts',
  'src/repositories/sync.repository.ts',
  'src/repositories/face-identity.repository.ts',
  'src/repositories/search.repository.ts',
  'src/repositories/asset.repository.ts',
  'src/repositories/access.repository.ts',
  'src/utils/database.ts',
  'src/repositories/map.repository.ts',
  'src/repositories/view-repository.ts',
  'src/repositories/memory.repository.ts',
  'src/repositories/tag.repository.ts',
  'src/repositories/download.repository.ts',
];

// A shared_space_library reference has "album coverage" if any of these appear
// within +-WINDOW lines: the raw album table, or a fork album-scope helper call.
const ALBUM_MARKER =
  /shared_space_album|spaceAlbumAssetExists|spaceAssetPathBranches|spaceAlbumAssetExistsSql|accessibleSpaceAlbums/;
const LIBRARY_REF = /\bshared_space_library\b/;
const WINDOW = 45;

// Lines that reference shared_space_library but are NOT a 3-path access-scope arm.
const BENIGN_LINE = [
  /(insertInto|deleteFrom|updateTable|backfillQuery)\(\s*['"]shared_space_library/, // CRUD / sync backfill
  /^'shared_space_library\.\w+',?$/, // column-list entry
  /accessibleLibraries|library_user|library_asset|library_audit/, // library-only sync helpers
];

// Enclosing functions that legitimately reference shared_space_library WITHOUT an
// album arm. Keyed by function name (robust to line drift). Every entry needs a reason.
const ALLOWLIST: Record<string, string> = {
  // Album-ABSENCE gate (keeps plain non-space album assets visible) — references
  // asset/library absence by design, never an album access arm.
  albumSharedSpaceScope: 'album-absence gate, not an album access arm',
  // Pre-existing intentional RBAC gap: AssetUpdate/edit has no space-album arm
  // (space editors can add/remove but not metadata-edit linked-album assets). Out
  // of scope for this behavior-preserving consolidation; tracked separately.
  checkSpaceEditAccess: 'known RBAC gap: AssetUpdate has no space-album arm (pre-existing)',
  // Pre-existing coverage gap: this map-markers path never had an album leg.
  getMapMarkers: 'known coverage gap: shared-space map markers omit the album path (pre-existing)',
  // GUARD-DISCOVERED pre-existing missing-album gaps (not in the review's inventory,
  // which only grepped shared_space_album). Both OR direct+library but omit the
  // album arm, so an album-only asset is invisible to them. Flagged for follow-up;
  // NOT fixed here (unplanned behavior change).
  findSpaceForAssetAndUser: 'GUARD-DISCOVERED gap: union(direct,library) omits album arm (pre-existing, follow-up)',
  getPersonalThumbnailForSpacePerson:
    'GUARD-DISCOVERED gap: or(direct,library) omits album arm (pre-existing, follow-up)',
};

const DECL = /^\s*(?:export\s+)?(?:async\s+)?(?:function\s+)?([A-Za-z0-9_]+)\s*[(<]/;
const NON_DECL = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'eb',
  'qb',
  'join',
  'map',
  'filter',
  'forEach',
  'then',
]);

const enclosingFn = (lines: string[], i: number): string => {
  for (let j = i; j >= 0; j--) {
    const m = DECL.exec(lines[j]);
    if (m && !NON_DECL.has(m[1])) {
      return m[1];
    }
  }
  return '<module>';
};

describe('space-album scope guard: every library scoping arm has album coverage', () => {
  it.each(SCOPING_FILES)('%s', (file) => {
    const lines = readFileSync(join(SERVER_ROOT, file), 'utf8').split('\n');
    const orphans: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue;
      }
      if (!LIBRARY_REF.test(raw)) {
        continue;
      }
      if (BENIGN_LINE.some((re) => re.test(trimmed))) {
        continue;
      }
      const fn = enclosingFn(lines, i);
      if (ALLOWLIST[fn]) {
        continue;
      }
      const lo = Math.max(0, i - WINDOW);
      const hi = Math.min(lines.length, i + WINDOW + 1);
      const covered = lines.slice(lo, hi).some((l) => ALBUM_MARKER.test(l));
      if (!covered) {
        orphans.push(`${file}:${i + 1} (in ${fn}): ${trimmed.slice(0, 90)}`);
      }
    }

    expect(
      orphans,
      `shared_space_library scoping arm(s) with no adjacent shared_space_album arm/helper.\n` +
        `Add the album leg (route it through spaceAlbumAssetExists / spaceAssetPathBranches /\n` +
        `spaceAlbumAssetExistsSql) or, if genuinely album-free, add the enclosing function to\n` +
        `ALLOWLIST with a reason.\n` +
        orphans.join('\n'),
    ).toEqual([]);
  });
});
