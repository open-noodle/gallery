import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FORK_LOCALES } from '$lib/i18n/fork-locales';

// Why this exists, and why fork-string-parity.spec.ts next door does not already cover it:
//
// fork-string-parity.spec.ts defines a "fork string" as a key that is in en.json AND in at least
// ONE of the nine translated locales — deliberately, so that a brand-new key living only in
// en.json (not yet translated by anyone) doesn't trip the parity assertion before a translation
// pass has had a chance to happen. That is the right rule for steady-state fork development, but
// it has a blind spot: a key that a slice added to en.json and then forgot to add to EVERY SINGLE
// one of the nine locales is, by that same definition, not a "fork string" yet — no translated
// locale has it, so fork-string-parity isn't tracking it at all. It would stay silently unguarded
// forever, because the moment exactly one locale gets it by hand, the OTHER eight are still free
// to be missing it without failing anything.
//
// That is exactly the state a sloppy slice of a brand-new feature can leave behind. This spec
// closes the gap for family relationships specifically: every `family_*` key in en.json — the
// top-level ones and the ones nested under `admin.*` — must exist in ALL nine translated locales,
// with no "at least one" escape hatch. A key present only in en.json fails here, on day one,
// rather than waiting for someone else to translate it into one locale first.

const I18N_DIR = path.resolve(process.cwd(), '../i18n');

type Messages = Record<string, string>;

const flatten = (value: Record<string, unknown>, prefix = '', out: Messages = {}): Messages => {
  for (const [key, child] of Object.entries(value)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flatten(child as Record<string, unknown>, dotted, out);
    } else {
      out[dotted] = String(child);
    }
  }
  return out;
};

const read = (file: string): Messages =>
  flatten(JSON.parse(fs.readFileSync(path.join(I18N_DIR, file), 'utf8')) as Record<string, unknown>);

const en = read('en.json');

// Every family-relationships key in en.json: top-level `family_*` keys (e.g. `family_canvas_title`)
// and keys nested under `admin.*` whose dotted path contains "family" (e.g.
// `admin.family_admin_access_level_view`). Matched by substring on the full dotted path rather than
// `startsWith('family')` on the leaf name, so this also covers any future nested namespace the
// feature adds keys under — not just `admin`.
const familyKeys = Object.keys(en).filter((key) => /family/i.test(key));

const topLevelFamilyKeys = familyKeys.filter((key) => !key.includes('.'));
const nestedAdminFamilyKeys = familyKeys.filter((key) => key.startsWith('admin.'));

describe('family relationships i18n completeness', () => {
  // Positive control, deliberately split into both halves. A guard that only walked top-level
  // keys would pass vacuously on the 17 nested `admin.*family*` keys while reporting green — the
  // exact failure mode this spec exists to avoid repeating.
  it('detects the family keys it is meant to protect, in both halves', () => {
    expect(topLevelFamilyKeys.length).toBeGreaterThanOrEqual(30);
    expect(nestedAdminFamilyKeys.length).toBeGreaterThanOrEqual(15);
    // Every family key found is accounted for by one of the two halves above — there is no third
    // namespace this scan is silently missing.
    expect(familyKeys.length).toBe(topLevelFamilyKeys.length + nestedAdminFamilyKeys.length);
  });

  it.each(FORK_LOCALES)('%s carries every family_* key, top-level and nested under admin.*', (code) => {
    const messages = read(`${code}.json`);
    const missing = familyKeys.filter((key) => !Object.hasOwn(messages, key));

    expect(missing, `${code}.json is missing ${missing.length} family key(s):\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
