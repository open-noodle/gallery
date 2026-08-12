import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// S12.10/F31: a repo-wide check for this slice specifically — every `$t('…')` key referenced in the files this
// slice touched must exist in `en.json`, and none of the seven keys this slice REMOVED from en.json may still
// be referenced anywhere in `web/` or `mobile/` (the removal would otherwise silently regress those call
// sites to rendering a raw i18n key at a real user).

const REPO_ROOT = path.resolve(process.cwd(), '..');
const I18N_DIR = path.join(REPO_ROOT, 'i18n');
const WEB_SRC = path.join(REPO_ROOT, 'web/src');
const MOBILE_LIB = path.join(REPO_ROOT, 'mobile/lib');

const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8')) as Record<string, unknown>;

// Flattens the nested en.json object into dotted key paths (e.g. "admin.face_cleanup_unnamed").
const flattenKeys = (obj: Record<string, unknown>, prefix = ''): Set<string> => {
  const keys = new Set<string>();
  for (const [k, v] of Object.entries(obj)) {
    const path_ = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const nested of flattenKeys(v as Record<string, unknown>, path_)) {
        keys.add(nested);
      }
    } else {
      keys.add(path_);
    }
  }
  return keys;
};

const enKeys = flattenKeys(en);

// The files this slice (docs/superpowers/plans/2026-07-30-face-review-remediation-slice-12.md) modified that
// call `$t('…')`. Listed explicitly rather than glob-discovered, so this test is a durable record of what was
// in scope — and a NEW $t call added to one of these files later without a matching en.json key still fails
// this check for as long as the file stays in the list.
const TOUCHED_FILES = [
  'routes/(user)/spaces/[spaceId]/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'routes/(user)/people/[personId]/[[photos=photos]]/[[assetId=id]]/+page.svelte',
  'routes/admin/face-cleanup/[personId]/+page.svelte',
  'routes/admin/face-cleanup/people/[personId]/+page.svelte',
  'routes/admin/face-cleanup/resolutions/+page.svelte',
  'lib/components/faces-page/person-suggestion-banner.svelte',
  'routes/admin/system-settings/MachineLearningSettings.svelte',
].map((p) => path.join(WEB_SRC, p));

// Matches `$t('key')` / `$t("key")` / `$t(\`key\`)`, including the template-literal form used for a computed
// tally key (`` $t(`admin.face_cleanup_review_tally_${…}`) ``) — those are excluded (dynamic, can't be
// statically resolved to one literal key) rather than false-flagged as missing.
const T_CALL = /\$t\(\s*(['"`])([^'"`${}]*)\1/g;

const extractKeys = (source: string): string[] => {
  const found: string[] = [];
  let match;
  while ((match = T_CALL.exec(source))) {
    found.push(match[2]);
  }
  return found;
};

describe('S12.10: $t keys referenced by slice-12-touched files exist in en.json', () => {
  for (const file of TOUCHED_FILES) {
    const relative = path.relative(WEB_SRC, file);
    it(relative, () => {
      expect(fs.existsSync(file), `file not found: ${file}`).toBe(true);
      const source = fs.readFileSync(file, 'utf8');
      const keys = extractKeys(source);
      // Positive control: this file must actually reference at least one key, or the check below is vacuous.
      expect(keys.length).toBeGreaterThan(0);
      const missing = keys.filter((k) => !enKeys.has(k));
      expect(missing, `keys referenced but missing from en.json: ${missing.join(', ')}`).toEqual([]);
    });
  }
});

// The seven keys this slice removed from en.json (and every locale that carried them) — F31 item 1. The other
// two orphaned keys named in the plan (`face_suggestion_confirmed_toast`, `face_suggestion_all_done`) are
// deliberately NOT in this list: this slice leaves them in place for Slice 11 to wire up.
//
// The four `face_cleanup_mode_first_visit_intro` / `face_cleanup_manual_review_bulk_{move,lock,unknown}` keys
// below were retired later, by the console-unification pass that moved the manual review page onto the shared
// dock and modal (superseded by `face_cleanup_review_bulk_*` and the harmonised mode-picker copy) — added here
// rather than to a new list because this is the existing guard for exactly this class of regression.
//
// `face_cleanup_review_back` was retired by the breadcrumb pass: every page's hand-written back-link was
// replaced by the shared breadcrumb trail (routes/admin/face-cleanup/breadcrumbs.ts), leaving the string with
// no call site at all.
const REMOVED_KEYS = [
  'admin.face_cleanup_people_load_more',
  'admin.face_cleanup_resolutions_declines_empty',
  'admin.face_cleanup_resolutions_declines_heading',
  'admin.face_cleanup_resolutions_face_label',
  'admin.face_cleanup_resolutions_locked_to',
  'admin.face_cleanup_resolutions_locks_empty',
  'admin.face_cleanup_resolutions_locks_heading',
  'admin.face_cleanup_mode_first_visit_intro',
  'admin.face_cleanup_manual_review_bulk_move',
  'admin.face_cleanup_manual_review_bulk_lock',
  'admin.face_cleanup_manual_review_bulk_unknown',
  'admin.face_cleanup_review_back',
];

const walkFiles = (dir: string, exts: string[]): string[] => {
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full, exts));
    } else if (exts.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
};

describe('S12.10: keys removed by this slice are unreferenced in web/ and mobile/', () => {
  // Excludes `.spec.ts`/`.spec.svelte` (test files may legitimately reference a removed key's literal string
  // as fixture/documentation data — including, harmlessly, this very audit file's own REMOVED_KEYS list).
  // Production `$t(...)` call sites never live in a spec file.
  const isProductionFile = (file: string) => !file.includes('.spec.');
  const webFiles = walkFiles(WEB_SRC, ['.svelte', '.ts']).filter((file) => isProductionFile(file));
  const mobileFiles = walkFiles(MOBILE_LIB, ['.dart']);

  it('scans a non-trivial number of files (control on the scan itself)', () => {
    expect(webFiles.length).toBeGreaterThan(100);
  });

  it.each(REMOVED_KEYS)('%s is not referenced anywhere in web/src or mobile/lib', (key) => {
    const bareKey = key.split('.').pop()!;
    const hits: string[] = [];
    for (const file of [...webFiles, ...mobileFiles]) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes(bareKey)) {
        hits.push(file);
      }
    }
    expect(hits, `unexpectedly referenced in: ${hits.join(', ')}`).toEqual([]);
  });

  // Positive control: a key that IS still very much referenced (used by these same touched files) must be
  // found by the identical scan mechanism — proving the scan can find a hit, not just fail to find anything.
  it('control: a key that IS still referenced is found by the same scan', () => {
    const hits: string[] = [];
    for (const file of webFiles) {
      const source = fs.readFileSync(file, 'utf8');
      if (source.includes('face_cleanup_resolutions_not_person')) {
        hits.push(file);
      }
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});
