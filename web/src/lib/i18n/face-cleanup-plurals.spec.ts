import { IntlMessageFormat } from 'intl-messageformat';
import { init, locale, register, waitLocale, _, type Translations } from 'svelte-i18n';
import { get } from 'svelte/store';
import { beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FORK_LOCALES } from '$lib/i18n/fork-locales';
import { convertBCP47 } from '$lib/utils/i18n';

// S12.9/F31: 17 count-bearing `admin.face_cleanup_*` keys used bare `{count}` with no ICU plural clause, so
// they rendered "1 clusters" / "1 faces" for an admin whose review queue happened to be down to one.
beforeAll(async () => {
  register('en', () => import('$i18n/en.json'));
  for (const code of FORK_LOCALES) {
    // H9: zh_Hans / zh_Hant are not valid BCP47 tags. IntlMessageFormat throws when constructed under the
    // underscore code, and svelte-i18n silently swallows that and falls back to the RAW, unparsed message —
    // so a render assertion registered under 'zh_Hans' would pass no matter what the translated content is.
    // Register under the same hyphenated form the app itself uses (initLanguage in $lib/utils.ts →
    // convertBCP47) while still reading the underscore-named source file; see the non-inertness proof below.
    register(convertBCP47(code), () => import(`$i18n/${code}.json`));
  }
  await init({ fallbackLocale: 'en', initialLocale: 'en' });
  await waitLocale('en');
});

const I18N_DIR = path.resolve(process.cwd(), '../i18n');
const en = JSON.parse(fs.readFileSync(path.join(I18N_DIR, 'en.json'), 'utf8')) as { admin: Record<string, string> };

const KEYS = [
  'face_cleanup_confident_count',
  'face_cleanup_footnote_repaired',
  'face_cleanup_footnote_unattributable',
  'face_cleanup_manual_review_move_entire_confirm_body',
  'face_cleanup_review_apply_label',
  'face_cleanup_review_apply_label_added',
  'face_cleanup_review_banner_title',
  'face_cleanup_review_detach_confirm_cta',
  'face_cleanup_review_detach_confirm_title',
  'face_cleanup_review_header_flagged',
  'face_cleanup_review_move_entire_confirm_body',
  'face_cleanup_review_move_entire_confirm_cta',
  'face_cleanup_review_picker_title',
  'face_cleanup_review_rest_staged',
  'face_cleanup_review_rest_title',
  'face_cleanup_review_select_all_flagged',
  'face_cleanup_stat_flagged_sub',
];

// Structural check, applied to every one of the 17: the raw `en.json` message itself must carry an ICU plural
// clause on `count`, not just a bare `{count}` interpolation. This is the check that actually covers all 17 —
// several of them (e.g. "Move all {count}", "{count} flagged") have NO English word that visibly changes
// between singular and plural, so a rendered-text assertion alone cannot tell a fixed key from a broken one
// for those; the raw-message structural check can, and does, for all of them uniformly.
describe('admin.face_cleanup_* count keys carry an ICU plural clause on count (S12.9 structural)', () => {
  it.each(KEYS)('%s', (key) => {
    const message = en.admin[key];
    expect(message, `missing en.json key admin.${key}`).toBeTypeOf('string');
    expect(message).toMatch(/\{count,\s*plural,/);
  });

  // Positive control: a bare, non-plural interpolation (any ordinary `{name}`-style key) must NOT match this
  // pattern — proving the regex itself discriminates rather than matching everything.
  it('does not flag an ordinary non-plural key as having a plural clause (control)', () => {
    expect(en.admin.face_cleanup_resolutions_by_actor ?? 'by {name}').not.toMatch(/\{count,\s*plural,/);
  });
});

// Rendering-level check, for the subset of the 17 whose message contains a noun that visibly changes form
// between singular and plural in English ("face"/"faces", "cluster"/"clusters", "person"/"people", "needs"/
// "need"). The other 5 keys ("Move all {count}", "{count} flagged", "Rest of this cluster ({count})", "Added
// to Apply: {count}", "Select all {count}") have no such word — count 1 vs 2 differ only in the numeral either
// way, so a rendered-text diff can't discriminate a fixed key from a broken one for those; the structural
// check above is what covers them. Word-boundary regexes here, not `toContain`, because "1 cluster" is a
// SUBSTRING of the unfixed "1 clusters" — a plain `toContain` check would pass vacuously on broken output.
const wb = (word: string) => new RegExp(String.raw`\b${word}\b`);

const renderedCases: {
  key: string;
  extra?: Record<string, unknown>;
  singular: RegExp;
  plural: RegExp;
}[] = [
  { key: 'admin.face_cleanup_confident_count', singular: wb('cluster'), plural: wb('clusters') },
  { key: 'admin.face_cleanup_footnote_repaired', singular: wb('face'), plural: wb('faces') },
  { key: 'admin.face_cleanup_footnote_unattributable', singular: wb('face'), plural: wb('faces') },
  {
    key: 'admin.face_cleanup_manual_review_move_entire_confirm_body',
    extra: { name: 'Alice' },
    singular: /all 1 face\b/,
    plural: /all 2 faces\b/,
  },
  { key: 'admin.face_cleanup_review_apply_label', singular: /1 face\b/, plural: /2 faces\b/ },
  {
    key: 'admin.face_cleanup_review_apply_label_added',
    extra: { added: 3 },
    singular: /1 face\b/,
    plural: /2 faces\b/,
  },
  {
    key: 'admin.face_cleanup_review_banner_title',
    singular: /1 face needs\b/,
    plural: /2 faces need\b/,
  },
  { key: 'admin.face_cleanup_review_detach_confirm_cta', singular: /1 face\b/, plural: /2 faces\b/ },
  { key: 'admin.face_cleanup_review_detach_confirm_title', singular: /1 face\b/, plural: /2 faces\b/ },
  {
    key: 'admin.face_cleanup_review_move_entire_confirm_body',
    extra: { owner: 'Berta' },
    singular: /all 1 face\b/,
    plural: /all 2 faces\b/,
  },
  { key: 'admin.face_cleanup_review_picker_title', singular: /1 face\b/, plural: /2 faces\b/ },
  { key: 'admin.face_cleanup_stat_flagged_sub', singular: /1 person\b/, plural: /2 people\b/ },
];

describe('admin.face_cleanup_* count plurals render the correct noun form (S12.9 rendered)', () => {
  it.each(renderedCases)('$key: singular at count 1, plural at count 2', ({ key, extra, singular, plural }) => {
    const $t = get(_);

    const atOne = $t(key as Translations, { values: { count: 1, ...extra } });
    const atTwo = $t(key as Translations, { values: { count: 2, ...extra } });

    // Word-boundary regex, not `toContain`: "1 cluster" is a SUBSTRING of the unfixed "1 clusters", so a
    // plain `toContain` check would pass vacuously on broken (bare-`{count}`) output.
    expect(atOne).toMatch(singular);
    expect(atTwo).toMatch(plural);
    // The bug this guards against directly: bare `{count}` renders the SAME (always-plural) noun form at
    // count 1, so the singular pattern must NOT also match the count=1 render if it were still broken —
    // i.e. this positive/negative pair only both pass once the ICU clause exists.
    expect(atOne).not.toMatch(plural);
  });

  // Positive control: a key that was ALREADY correctly pluralized before this slice (not one of the 17) must
  // keep working exactly as it did — this isn't a rewrite of every plural in the file, only the 17 broken ones.
  it('leaves an already-correct plural key (not one of the 17) working', () => {
    const $t = get(_);
    expect($t('admin.face_cleanup_apply_success', { values: { count: 1 } })).toMatch(/1 person\b/);
    expect($t('admin.face_cleanup_apply_success', { values: { count: 2 } })).toMatch(/2 people\b/);
  });
});

// B3: ICU computes `#` as `value - offset`, so a pre-formatted "2,952" from toLocaleString() yields NaN.
// Below the thousands separator it renders fine, so the bug only appears on large clusters — which are
// exactly the ones whose whole-cluster move is hardest to undo.
describe('count arguments must be raw numbers, not formatted strings', () => {
  const COUNT_KEYS = [
    'face_cleanup_review_rest_title',
    'face_cleanup_review_move_entire_confirm_body',
    'face_cleanup_review_move_entire_confirm_cta',
    'face_cleanup_manual_review_move_entire_confirm_body',
  ];

  it.each(COUNT_KEYS)('%s renders a four-digit count without NaN', (key) => {
    const rendered = get(_)(`admin.${key}` as Translations, { values: { count: 2952, name: 'Anna', owner: 'Anna' } });
    expect(rendered).not.toContain('NaN');
    expect(rendered).toContain('2,952');
  });

  // Proves the assertion above is discriminating: the formatted string DOES produce NaN, so the tests
  // pass because the call sites were fixed, not because the keys happen to be NaN-proof.
  it('is discriminating: a pre-formatted count still produces NaN', () => {
    const rendered = get(_)('admin.face_cleanup_review_move_entire_confirm_cta', {
      values: { count: '2,952' as unknown as number },
    });
    expect(rendered).toContain('NaN');
  });

  // Source-level guard: catches a NEW call site that reintroduces the pattern, which the render tests
  // above cannot see because they call $t directly rather than going through the component.
  it('no face-cleanup route passes toLocaleString() into a translation count', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.svelte') && !entry.name.endsWith('.ts')) {
          continue;
        }
        // Match `toLocaleString(` not `toLocaleString()` — a locale-aware call such as
        // toLocaleString('de-DE') also inserts separators and would evade the narrower pattern.
        if (/count:\s*[^,}]*toLocaleString\(/.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(process.cwd(), full));
        }
      }
    };
    walk(path.resolve(process.cwd(), 'src/routes/admin/face-cleanup'));
    expect(offenders).toEqual([]);
  });
});

// H9: the guard above (S12.9) only ever checked `en.json`. The bug it exists to catch — a count-bearing
// key flattened to bare `{count}` with no ICU plural clause — shipped in all NINE fork-maintained
// translations (de/fr/it/nl/pl/es/ru/zh_Hans/zh_Hant) while that guard stayed green, because it never read
// a translated file at all. This block reads them.
const readAdmin = (code: string): Record<string, string> =>
  (JSON.parse(fs.readFileSync(path.join(I18N_DIR, `${code}.json`), 'utf8')) as { admin: Record<string, string> }).admin;

// Derived from en.json rather than hardcoded: a hardcoded list silently stops covering every key added
// after it was written. Any admin.face_cleanup_* whose English value carries an ICU plural clause is in
// scope; every fork locale's translation of it must carry one too.
const PLURAL_KEYS = Object.entries(en.admin)
  .filter(([key, value]) => key.startsWith('face_cleanup_') && /\{count,\s*plural/.test(value))
  .map(([key]) => key);

describe('the nine fork locales keep an ICU plural clause on every count-bearing face_cleanup key', () => {
  // Positive control: if this list were ever empty (a renamed prefix, a moved i18n directory), every
  // assertion below would pass vacuously over zero cases.
  it('finds at least one plural-bearing key to check across the nine locales (control)', () => {
    expect(PLURAL_KEYS.length).toBeGreaterThan(0);
  });

  describe.each(FORK_LOCALES)('%s', (code) => {
    const translated = readAdmin(code);

    it.each(PLURAL_KEYS)('%s keeps an ICU plural clause', (key) => {
      const value = translated[key];
      if (value === undefined) {
        // Missing entirely falls back to English (renders correctly, just untranslated) — that is
        // fork-string-parity.spec.ts's concern, not this guard's.
        return;
      }
      expect(value).toMatch(/\{count,\s*plural/);
    });
  });
});

// H9 / CRITICAL: zh_Hans and zh_Hant are not valid BCP47 language tags. `new IntlMessageFormat(msg,
// 'zh_Hans')` throws, and svelte-i18n silently swallows that internally and falls back to returning the
// message TEMPLATE completely unparsed — same text no matter what `count` value is passed in. A render
// assertion registered under the underscore code would therefore pass on totally broken content: it is
// inert, not passing because the translation is correct. The app itself never hits this because
// `initLanguage` (`$lib/utils.ts`) always registers through `convertBCP47`, which this file's `beforeAll`
// now mirrors. These tests prove that choice is load-bearing, not decorative.
describe('zh_Hans / zh_Hant stay evaluated, not inert, once registered under their hyphenated BCP47 form', () => {
  it('IntlMessageFormat throws under the underscore code and does not under the hyphenated one', () => {
    const message = readAdmin('zh_Hans').face_cleanup_confident_count;
    expect(() => new IntlMessageFormat(message, 'zh_Hans')).toThrow();
    expect(() => new IntlMessageFormat(message, 'zh-Hans')).not.toThrow();
  });

  it.each(['zh_Hans', 'zh_Hant'] as const)(
    '%s renders through svelte-i18n with the count actually substituted, not the raw ICU source',
    async (code) => {
      const hyphenated = convertBCP47(code);
      await locale.set(hyphenated);
      await waitLocale(hyphenated);
      const $t = get(_);

      const atOne = $t('admin.face_cleanup_confident_count' as Translations, { values: { count: 1 } });
      const atFive = $t('admin.face_cleanup_confident_count' as Translations, { values: { count: 5 } });

      // An inert fallback prints the SAME unparsed template regardless of the count passed in — the values
      // argument is never consulted because IntlMessageFormat never got constructed. A real evaluation
      // substitutes `#`, so the two renders differ and each contains its own digit.
      expect(atOne).not.toBe(atFive);
      expect(atOne).toContain('1');
      expect(atFive).toContain('5');
      expect(atFive).not.toMatch(/\{count,\s*plural/);
    },
  );
});

// H9: `i18n/nl.json`'s face_cleanup_review_picker_create wraps its placeholder in plain apostrophes —
// `'{query}'` — which in ICU MessageFormat is not a quote mark at all: a bare `'` opens a quoted-literal
// section that runs to the next `'`, so `{query}` prints as literal text instead of being substituted.
// Every other locale uses a quote style ICU does not treat specially (guillemets, curly quotes, or in this
// fix's case a plain double quote, matching English's own `"{query}"`).
describe('nl face_cleanup_review_picker_create no longer opens an ICU literal on the query placeholder', () => {
  it('substitutes {query} instead of printing it literally', () => {
    const message = readAdmin('nl').face_cleanup_review_picker_create;
    const rendered = new IntlMessageFormat(message, 'nl').format({ query: 'Anna' });
    expect(rendered).toContain('Anna');
    expect(rendered).not.toContain('{query}');
  });

  // Positive control: proves the assertion above is discriminating — the OLD apostrophe-quoted shape
  // really does leak the placeholder literally, rather than the assertion passing regardless of content.
  it('is discriminating: the old apostrophe-quoted shape really does leak the placeholder literally (control)', () => {
    const broken = "Nieuwe persoon '{query}' aanmaken";
    const rendered = new IntlMessageFormat(broken, 'nl').format({ query: 'Anna' });
    expect(rendered).not.toContain('Anna');
    expect(rendered).toContain('{query}');
  });
});
