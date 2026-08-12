import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FORK_LOCALES } from '$lib/i18n/fork-locales';

// Why this exists: during the v3.1.0 rebase, a conflict in zh_Hant.json was resolved by a merge that compared
// only TOP-LEVEL keys. main had added keys under the nested `admin` object, so main's whole `admin` subtree
// won — silently taking 229 fork strings (admin.face_cleanup*) with it. zh_Hant kept rendering, the file
// stayed valid JSON with no duplicate keys, and every suite stayed green. It was caught by hand, and only
// because someone went looking.
//
// Nothing else can catch it: component tests render `en`, the placeholder guard next door only inspects keys a
// locale still HAS, and prettier cannot see a missing translation. This is the guard for a fork string
// disappearing from a locale that previously had it.

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
const translated = new Map(FORK_LOCALES.map((code) => [code, read(`${code}.json`)]));
const upstreamOnly = fs
  .readdirSync(I18N_DIR)
  .filter((file) => file.endsWith('.json') && file !== 'en.json' && file !== 'package.json')
  .filter((file) => !FORK_LOCALES.includes(file.replace('.json', '')))
  .map((file) => read(file));

/**
 * A fork string is one this repo wrote, as opposed to one that came from upstream Immich.
 *
 * Derived rather than hardcoded, so it needs no maintenance as fork features grow: a key qualifies when it is
 * in en.json, at least one of the nine has it, and NO upstream-only locale does. Upstream's Weblate never
 * receives fork keys, so "translated here, unknown to every Weblate locale" identifies them cleanly.
 *
 * Deliberately keyed on "at least one" of the nine, never "all nine" — the latter would make the parity
 * assertion below circular and permanently green. It also means a brand-new fork key living only in en.json
 * is not yet a fork string, which is what the project invariant wants: new keys land in en.json alone and get
 * translated in a later pass.
 */
const keysIn = (all: Messages[]): Set<string> => {
  const keys = new Set<string>();
  for (const messages of all) {
    for (const key of Object.keys(messages)) {
      keys.add(key);
    }
  }
  return keys;
};

const inSomeTranslated = keysIn([...translated.values()]);
const inUpstream = keysIn(upstreamOnly);

const forkStrings = Object.keys(en).filter((key) => inSomeTranslated.has(key) && !inUpstream.has(key));

describe('i18n fork-string parity', () => {
  // Positive control. If the detection above ever silently matches nothing — a renamed locale, a moved i18n
  // directory, a flatten() regression — the parity assertion would pass over an empty set and this guard
  // would quietly stop guarding.
  it('detects the fork strings it is meant to protect', () => {
    expect(forkStrings.length).toBeGreaterThan(100);
    // The exact family the zh_Hant regression dropped.
    expect(forkStrings.some((key) => key.startsWith('admin.face_cleanup'))).toBe(true);
    expect(forkStrings.some((key) => key.startsWith('face_suggestion'))).toBe(true);
  });

  it.each(FORK_LOCALES)('%s carries every fork string', (code) => {
    const messages = translated.get(code)!;
    const missing = forkStrings.filter((key) => !Object.hasOwn(messages, key));

    expect(
      missing,
      `${code}.json is missing ${missing.length} fork string(s) that other translated locales have:\n  ${missing
        .slice(0, 30)
        .join('\n  ')}${missing.length > 30 ? `\n  …and ${missing.length - 30} more` : ''}`,
    ).toEqual([]);
  });
});
