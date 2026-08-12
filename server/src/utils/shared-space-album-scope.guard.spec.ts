// Static regression guards for the shared-space "linked album" access path.
//
// Two INDEPENDENT scans over the same dynamically-derived file set:
//
//   Scan 1 (album-leg): the recurring space-album defect class is "a 3-path
//     access-scoping branch gains a shared_space_library arm but forgets the
//     shared_space_album arm" (the historical F1 bug). Every shared_space_library
//     scoping reference must have a nearby linked-album marker.
//
//   Scan 2 (visibility-gate): every space asset read must exclude other members'
//     Hidden/Locked assets. This is the class of leak that Fixes A (timeline),
//     B (library-sync), C (activity), D (album search/facets) and I (redaction)
//     closed. Every space-read function must reference a visibility gate.
//
// ── Why this rewrite (fixF / re-audit F3) ──────────────────────────────────
// The previous Scan 2 was structurally too weak and NO-OP'd on the very files
// that leaked:
//   1. It used a HARDCODED file list, so a space read in an unlisted file was
//      invisible.
//   2. It keyed ONLY on `shared_space_*` table literals, but `asset.repository.ts`
//      and `view-repository.ts` scope via the `spaceAssetPathBranches()` helper and
//      contain ZERO such literals — so the guard scanned them as no-ops.
//
// This version fixes both:
//   • The file set is DERIVED DYNAMICALLY — glob every repository + utils/database.ts
//     and keep any file that contains a space-read marker (see SPACE_READ_MARKER).
//   • A space read is detected by HELPER CALL *or* table literal, so helper-only
//     files (asset/view) are now scanned.
//   • The allowlist is keyed by `file::function` (not bare function name), so a
//     collision like getMapMarkers (fixed in map.repository.ts, still album-gapped
//     in shared-space.repository.ts) resolves to the correct site.
//
// ── What Scan 2 catches (self-test) ────────────────────────────────────────
//   • A new/rebased space read that joins shared_space_asset/library/album (or
//     routes through a space helper) and returns asset rows WITHOUT a nearby
//     visibility gate → flagged as an orphan (the timeline/library/activity leak
//     shape).
//   • A helper-scoped read (spaceAssetPathBranches / spaceAlbumAssetExists*) whose
//     caller drops the visibility gate → flagged, because the helpers themselves
//     do NOT carry visibility (they only encode the access PATH, not the gate).
//
//   • It does NOT catch album-scoped reads that never touch a shared_space_* table
//     or space helper (e.g. activity.repository, which filters by albumId with an
//     inline DEFAULT_VISIBILITY gate). Those are outside this guard's detection
//     model by construction; Fix C covers them with its own unit tests.
//
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Server root — vitest runs with cwd at server/ (matches face-identity-query-shape.spec.ts).
const SERVER_ROOT = process.cwd();

const REPO_DIR = 'src/repositories';
const EXTRA_FILES = ['src/utils/database.ts'];

// Fork-owned space-scope helpers. A call to any of these IS a space read (they
// encode the direct/library/album access path). Detected as bare identifiers so a
// call, spread, or import all count.
const SPACE_HELPER =
  /\b(spaceAssetPathBranches|spaceAlbumAssetExists|spaceAlbumAssetExistsSql|spaceContributedAssetExists|spaceDirectAssetExists|spaceLibraryAssetExists|accessibleSpaces|accessibleSpaceAlbums|accessibleLibraries)\b/;

// The raw join tables. A reference to any of these is also a space read.
const SPACE_TABLE = /\bshared_space_(asset|library|album)\b/;

// Either signal means the line participates in a space-scoped read.
const SPACE_READ_MARKER = new RegExp(`${SPACE_HELPER.source}|${SPACE_TABLE.source}`);

// Derive the file set: every repository + utils/database.ts that contains a
// space-read marker. Glob, do not hardcode — a new leaky file is auto-included.
const deriveScopingFiles = (): string[] => {
  const repoFiles = readdirSync(join(SERVER_ROOT, REPO_DIR))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => `${REPO_DIR}/${f}`);
  return [...repoFiles, ...EXTRA_FILES].filter((file) =>
    SPACE_READ_MARKER.test(readFileSync(join(SERVER_ROOT, file), 'utf8')),
  );
};

const SCOPING_FILES = deriveScopingFiles();

// ── shared helpers ─────────────────────────────────────────────────────────

const DECL =
  /^\s*(?:export\s+)?(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(?:function\s+)?([A-Za-z0-9_]+)\s*[(<]/;
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
  // Bare calls to the fork's own gate/scope helpers, e.g. `spaceVisibilityGate(eb),` as the
  // first array element of an `eb.and([...])` conjunct. DECL cannot distinguish a call site
  // from a declaration (both look like `identifier(`), so without this exclusion the backward
  // scan in enclosingFn stops at the call instead of continuing to the real enclosing function
  // (e.g. albumSharedSpaceScope) — misattributing the enclosing fn and defeating its allowlist
  // entry (Slice 1 / security-1 regression).
  'spaceVisibilityGate',
  // Same reason: `spaceAlbumAssetExists(eb, {` / `spaceContributedAssetExists(eb, {` as the first
  // token of a wrapped `.where((eb) => eb.not(...))` arm would otherwise be read as a declaration,
  // misattributing the enclosing membership/retention fn and defeating its VIS_ALLOWLIST entry.
  'spaceAlbumAssetExists',
  'spaceContributedAssetExists',
  // SQL keywords that appear as the first token in raw sql`` template literal lines
  // and would otherwise be misidentified as TypeScript function names by DECL.
  'AND',
  'OR',
  'FROM',
  'WHERE',
  'INNER',
  'LEFT',
  'RIGHT',
  'UNION',
  'SELECT',
  'ON',
  'WITH',
  'GROUP',
  'HAVING',
  'ORDER',
  'LIMIT',
  'OFFSET',
  'NOT',
  'IN',
  'AS',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'SET',
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

const shortName = (file: string) => file.split('/').pop()!;
const key = (file: string, fn: string) => `${shortName(file)}::${fn}`;

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 1 — album-leg coverage
//
// Every `shared_space_library` scoping arm must have album coverage within
// ±WINDOW lines: the raw `shared_space_album` table, or a fork album-scope helper.
// ─────────────────────────────────────────────────────────────────────────────

const ALBUM_MARKER =
  /shared_space_album|spaceAlbumAssetExists|spaceAssetPathBranches|spaceAlbumAssetExistsSql|accessibleSpaceAlbums/;
const LIBRARY_REF = /\bshared_space_library\b/;
const WINDOW = 45;

// Lines that reference shared_space_library but are NOT a 3-path access-scope arm.
const BENIGN_LINE = [
  /(insertInto|deleteFrom|updateTable|backfillQuery|upsertQuery)\(\s*['"]shared_space_library/, // CRUD / sync backfill
  /^'shared_space_library\.\w+',?$/, // column-list entry
  /accessibleLibraries|library_user|library_asset|library_audit/, // library-only sync helpers
];

// Enclosing functions that legitimately reference shared_space_library WITHOUT an
// album arm. Keyed by `<file>::<function>`. Every entry needs a real reason.
const ALBUM_ALLOWLIST: Record<string, string> = {
  // Album-ABSENCE gate (keeps plain non-space album assets visible) — references
  // asset/library absence by design, never an album access arm.
  'database.ts::albumSharedSpaceScope': 'album-absence gate, not an album access arm',
  // Pre-existing intentional RBAC gap: AssetUpdate/edit has no space-album arm
  // (space editors can add/remove but not metadata-edit linked-album assets).
  'access.repository.ts::checkSpaceEditAccess': 'known RBAC gap: AssetUpdate has no space-album arm (pre-existing)',
  // GET /shared-spaces/:id/map-markers unions direct+library only. Visibility-gated
  // (visibleSpaceAssetVisibilities) so no leak — but album-linked markers are absent.
  // Pre-existing album-completeness gap, tracked separately; NOT a visibility hole.
  'shared-space.repository.ts::getMapMarkers':
    'GUARD-DISCOVERED album gap: union(direct,library) omits album arm (pre-existing, follow-up)',
  // Both OR direct+library but omit the album arm, so an album-only asset is
  // invisible to them. Pre-existing; membership/thumbnail lookups (see Scan 2).
  'shared-space.repository.ts::findSpaceForAssetAndUser':
    'GUARD-DISCOVERED album gap: union(direct,library) omits album arm (pre-existing, follow-up)',
  // Thumbnail-face lookup: or(direct,library) omits the album arm, so an album-only
  // linked asset can't supply a fallback thumbnail. Visibility-gated (line 1486), so
  // no visibility leak — a pre-existing album-completeness gap, tracked separately.
  'shared-space.repository.ts::getPersonalThumbnailForSpacePerson':
    'GUARD-DISCOVERED album gap: or(direct,library) omits album arm (pre-existing, follow-up)',
  // Library-path EXIF restore write-infra (Slice 7 / L4): UPDATE asset_exif.updatedAt scoped to
  // space-linked libraries so restored library assets re-stream EXIF. Library-path-specific (the
  // album path has emitAlbumAssetVisibilityRestore); no album arm applies, no asset content served.
  'shared-space.repository.ts::emitLibraryAssetVisibilityRestore':
    'library-path EXIF restore write-infra; no album arm applies (mirrors emitLibraryAssetVisibilityPurge)',
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
      if (ALBUM_ALLOWLIST[key(file, fn)]) {
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
        `spaceAlbumAssetExistsSql) or, if genuinely album-free, add '<file>::<fn>' to\n` +
        `ALBUM_ALLOWLIST with a reason.\n` +
        orphans.join('\n'),
    ).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SCAN 2 — visibility-gate coverage
//
// Every space-scoped ASSET read (joins shared_space_asset/library/album, or routes
// through a space helper, and returns asset rows) must reference the visibility
// gate within ±VIS_WINDOW lines. The gate excludes other members' Hidden/Locked.
//
// A space read is detected by SPACE_READ_MARKER (helper call OR table literal), so
// helper-only files (asset.repository.ts, view-repository.ts) are covered — the
// gap that let Fixes A/C slip past the old table-literal-only scan.
// ─────────────────────────────────────────────────────────────────────────────

// A space read is "visibility-gated" if any of these appear within ±VIS_WINDOW.
//   - spaceVisibilityGate / spaceVisibleAssetVisibilities / visibleSpaceAssetVisibilities:
//     the Kysely `visibility IN (archive,timeline)` gate.
//   - peopleAssetVisibilities: the raw-SQL alias of the same set (face/person stats).
//   - visibilityFilter: the local raw-SQL const `visibility IN (visibleSpaceAssetVisibilities)`
//     interpolated into the space-stats CTEs (countPersons / peopleFaceStatistics).
//   - AssetVisibility.Timeline / AssetVisibility.Archive: an inline visibility '='
//     predicate (map / memory / view use the tighter Timeline-only gate).
//   - *_SYNC_COLUMNS: the query streams a LINK table (libraryId/albumId/spaceId
//     metadata) not asset rows; asset visibility lives in the asset-stream classes.
//   - reviewableAssetVisibility: the face-review engines' gate (src/utils/face-review.ts). It is
//     defined as `eb(column, 'in', spaceVisibleAssetVisibilities)` — the same set, under a name that
//     says why the face-review surfaces need it (no Locked-folder crop reaches a reviewer, because
//     neither the suggestion queue nor the cleanup console re-authenticates).
const VIS_GATE_MARKER =
  /spaceVisibilityGate|spaceVisibleAssetVisibilities|visibleSpaceAssetVisibilities|reviewableAssetVisibility|peopleAssetVisibilities|visibilityFilter|AssetVisibility\.(Timeline|Archive)|SHARED_SPACE_LIBRARY_SYNC_COLUMNS|SHARED_SPACE_ALBUM_SYNC_COLUMNS/;

// Lines that reference a space marker but are NOT an asset-read scoping arm.
const VIS_BENIGN_LINE = [
  /(insertInto|deleteFrom|updateTable|backfillQuery|upsertQuery|auditQuery)\(\s*['"]shared_space/, // CRUD / sync
  /^'shared_space[^']+\.\w+',?$/, // column-list entry
  /shared_space_(asset|library|album)_audit/, // audit tables (tombstones, not reads)
];

// Space reads that legitimately have no nearby visibility gate. Keyed by
// `<file>::<function>`. Every entry states WHY (not "enforced downstream" waves).
const VIS_ALLOWLIST: Record<string, string> = {
  // — Membership / link-metadata lookups: return a spaceId, library id, album id, or
  //   metadata row — never asset rows. No asset content is served, so no gate applies.
  'shared-space.repository.ts::findSpaceForAssetAndUser':
    'membership lookup; returns spaceId, not asset data (on album-leg allowlist too)',
  'shared-space.repository.ts::getLinkedLibraries': 'returns library metadata rows, not asset rows',
  'shared-space.repository.ts::hasLibraryLink': 'boolean link-existence check; no asset data',
  'shared-space.repository.ts::getLinkedAlbums': 'returns album metadata rows for management UI; no asset content',
  'shared-space.repository.ts::getLinkedAlbumsContainingAssets':
    "resolves linked-album id/name for the caller's OWN selected assetIds (remove-from-space message); returns album metadata only, no asset content",
  'shared-space.repository.ts::getSpacesLinkedToAlbum': 'returns space-album link metadata (ids/flags), not asset rows',
  // albums-6: departing-member album-link cleanup + correctness-4 reconcile targeting —
  // both operate on shared_space_album LINK rows (delete-by-ownership / id list), never
  // asset content.
  'shared-space.repository.ts::removeOwnedAlbumLinksAddedBy':
    'deletes shared_space_album link rows the departing member added and owns; RETURNING albumId only, no asset content',
  'shared-space.repository.ts::getLinkedAlbumIds':
    'returns album ids linked to a space (link metadata), not asset rows',
  'shared-space.repository.ts::getSpacesLinkedToLibrary': 'returns library-link metadata (ids/flags), not asset rows',
  // rbac-6: album owner's management view of every space this album is linked into —
  // returns spaceId/spaceName/linkedById/showInTimeline only, never asset rows.
  'shared-space.repository.ts::getAlbumSpaceLinks': 'returns space-album link metadata for the owner; no asset content',

  // — Anti-join membership gates: read direct/library/album rows to check that an
  //   asset is NOT already reachable via another space path (removal / face cleanup).
  //   The read decides membership, it does not return asset content to a client.
  'shared-space.repository.ts::getAssetIdsWithoutOtherSpacePath':
    'anti-join membership check for removals; no asset data',
  'shared-space.repository.ts::getAlbumAssetIdsWithoutOtherSpacePath':
    'anti-join membership check for removals; no asset data',

  // — Remove-path direct-membership check (#751 / S5): reads shared_space_asset to find which of the
  //   selected assets are DIRECT space members, so stack-atomic removal only ever expands from — and
  //   deletes — direct members. Returns member ids for DELETION, never asset content to a client.
  'shared-space.repository.ts::getDirectAssetIds': 'direct-membership id check for removals; no asset content',

  // — addedById attribution: select shared_space_*.addedById (who added the asset),
  //   never asset content. No visibility gate needed.
  'shared-space.repository.ts::getSpacePersonAssetAdderIds': 'returns addedById (user ids), not asset data',
  'shared-space.repository.ts::getSpaceAssetAdder': 'returns addedById attribution only; no asset content',

  // — Sync purge write-infra: INSERT ... SELECT that reads shared_space_asset JOIN
  //   ids (spaceId, assetId) into the audit tombstone table. No asset content read,
  //   and it fires precisely BECAUSE the asset left the visible set (purge event).
  'shared-space.repository.ts::emitDirectAssetVisibilityPurge':
    'reads join ids into audit tombstone (purge write-infra); no asset content returned',
  // — Album-path purge/restore write-infra (Slice 1): INSERT ... SELECT that reads
  //   album_asset (join ids) scoped to shared_space_album (space-linked filter), and
  //   UPDATE album_asset.updatedAt scoped to the same filter. No asset content served;
  //   these are write operations that fire on visibility transitions.
  'shared-space.repository.ts::emitAlbumAssetVisibilityPurge':
    'reads album_asset join ids into audit tombstone (purge write-infra); no asset content returned',
  'shared-space.repository.ts::emitAlbumAssetVisibilityRestore':
    'UPDATE album_asset.updatedAt scoped to space-linked albums (restore write-infra); no asset content returned',
  // — Library-path purge write-infra (Slice 2): INSERT ... SELECT that reads asset
  //   (libraryId, id) scoped to shared_space_library (space-linked filter). No asset
  //   content served; fires on visibility transitions to write tombstones.
  'shared-space.repository.ts::emitLibraryAssetVisibilityPurge':
    'reads asset library ids into audit tombstone (purge write-infra); no asset content returned',
  // — Library-path EXIF restore write-infra (Slice 7 / L4): bumps asset_exif.updatedAt for
  //   space-linked library assets so restored EXIF re-streams. Write-only; no asset content served.
  'shared-space.repository.ts::emitLibraryAssetVisibilityRestore':
    'bumps asset_exif.updatedAt for space-linked library assets (restore write-infra); no asset content returned',
  // — Album-grant reconcile (Slice 8 / M6+M7): bidirectional INSERT/DELETE over shared_space_album
  //   ⋈ member ⋈ album ids to keep shared_space_album_user in sync with live paths. Manages the ACL
  //   itself; never selects or serves asset rows.
  'shared-space.repository.ts::reconcileAlbumGrants':
    'grant reconcile: reads album/member/album ids to INSERT/DELETE grants; manages the ACL, no asset content',

  // — Album-ACCESS grant checks: select ONLY album.id (which albums the user may
  //   read/edit via a space link), never asset rows. Individual asset visibility is
  //   enforced at each DOWNSTREAM asset read — album withAssets (withDefaultVisibility),
  //   activity (Fix C), and album search/facets (Fix D) — all of which are now gated.
  'access.repository.ts::checkSpaceLinkedAlbumAccess':
    'selects album.id only, never asset rows; asset visibility gated at each downstream read (Fixes C/D)',
  'access.repository.ts::checkSpaceLinkedAlbumReadAccess':
    'selects album.id only, never asset rows; asset visibility gated at each downstream read (Fixes C/D)',

  // — Sync scope helper: accessibleLibraries builds a UNION of library ids (owned +
  //   space-linked) used as a subquery scope. It returns library ids, never asset rows;
  //   the asset streams that USE it (LibraryAssetSync/ExifSync) carry the visibility gate.
  'sync.repository.ts::accessibleLibraries': 'returns library ids only (UNION of owned + space-linked), not asset rows',

  // — SharedSpaceSync.getUpserts streams SHARED_SPACE_SYNC_COLUMNS (space name/settings
  //   metadata) scoped by accessibleSpaces — space rows, NOT asset rows. The per-asset
  //   space streams (SharedSpaceAssetSync etc.) carry the visibility gate separately.
  'sync.repository.ts::getUpserts':
    'sync stream of shared_space metadata columns (accessibleSpaces-scoped), not asset rows',
  // LibrarySync.getCreatedAfter streams library_user access-GRANT rows (libraryId,
  // createId) scoped by accessibleLibraries — a per-user grant ledger, not asset
  // rows. The library asset streams (LibraryAssetSync/ExifSync) carry the gate.
  'sync.repository.ts::getCreatedAfter':
    'streams library_user access-grant metadata (accessibleLibraries-scoped), not asset rows',

  // #752 P1-5: album metadata (assetCount/date-range) unions album_asset with member-gated
  // album_space_asset contributions (join through shared_space_album ⋈ shared_space_member). The
  // outer query IS visibility-gated — `.$call(withDefaultVisibility)` on the top-level `asset`
  // selectFrom (Timeline/Archive only, applied uniformly to owner and contributed rows alike) —
  // but the textual VIS_GATE_MARKER scan doesn't recognize `withDefaultVisibility` by name (it's
  // the file-local default-visibility helper, not a space-specific gate identifier). Pinned by
  // timeline-album-contributions.medium.spec.ts (Hidden/trashed contributions vanish from counts).
  'album.repository.ts::getMetadataForIds':
    'gated via withDefaultVisibility ($call-ed on the outer asset query); scanner does not recognize this helper name',

  // Task 9 (D1-b residue): the contributed (`album_space_asset`) arm's live-link gate — a
  // correlated EXISTS against shared_space_album (albumId + spaceId) proving the album is still
  // linked to the space the contribution was made through, mirroring contributionVisibleToMember
  // (sync.repository.ts) / spaceContributedAssetExists. Pure link-existence check — same reasoning
  // as hasLibraryLink / getAssetIdsWithoutOtherSpacePath above — no asset content is read here.
  // Asset visibility for the matched rows is enforced elsewhere (same as the rest of inAlbums,
  // which was never gate-scanned before this arm's shared_space_album reference existed).
  'database.ts::inAlbums':
    'live-link EXISTS(shared_space_album) correlated on albumId+spaceId; link-existence check, no asset content (Task 9)',
};

const VIS_WINDOW = 50;

describe('space-visibility gate guard: every space asset read has a visibility gate', () => {
  it.each(SCOPING_FILES)('%s', (file) => {
    const lines = readFileSync(join(SERVER_ROOT, file), 'utf8').split('\n');
    const orphans: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();

      if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
        continue;
      }
      if (!SPACE_READ_MARKER.test(raw)) {
        continue;
      }
      // The helper/scope module and its import lines are definitions, not reads.
      if (/^import\b/.test(trimmed) || /from 'src\/utils\/shared-space-album-scope'/.test(trimmed)) {
        continue;
      }
      if (VIS_BENIGN_LINE.some((re) => re.test(trimmed))) {
        continue;
      }

      const fn = enclosingFn(lines, i);
      if (VIS_ALLOWLIST[key(file, fn)]) {
        continue;
      }

      const lo = Math.max(0, i - VIS_WINDOW);
      const hi = Math.min(lines.length, i + VIS_WINDOW + 1);
      const covered = lines.slice(lo, hi).some((l) => VIS_GATE_MARKER.test(l));
      if (!covered) {
        orphans.push(`${file}:${i + 1} (in ${fn}): ${trimmed.slice(0, 90)}`);
      }
    }

    expect(
      orphans,
      `space asset read arm(s) with no nearby visibility gate.\n` +
        `Add spaceVisibilityGate / visibleSpaceAssetVisibilities / AssetVisibility.Timeline\n` +
        `to the query, or add '<file>::<fn>' to VIS_ALLOWLIST with a reason.\n` +
        orphans.join('\n'),
    ).toEqual([]);
  });
});
