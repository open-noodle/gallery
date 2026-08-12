import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FORK_LOCALES } from '$lib/i18n/fork-locales';

// Why this exists: the Face Cleanup console shipped a German banner that rendered, literally,
// "{moving} von {name}s {faceCount} Gesichtern…" — a translation of a REWRITTEN English string whose old
// placeholders no longer existed, so svelte-i18n had no values to substitute and printed the braces. A user
// reported it. French carried the identical bug, and two community locales had translated the ARGUMENT NAME
// itself ("{संख्या}", "{bulan}"), which fails the same way.
//
// Nothing caught any of it: CI's "Test i18n" job only runs prettier, and a stale-but-present translation is
// invisible to a formatter, to TypeScript, and to every component test (they render `en`). This is the guard.
//
// Scope: FORK_LOCALES only (plus en.json as the reference). The remaining ~80 locale files are
// translator-owned (Weblate); this suite must never fail on content the fork does not maintain, or a
// future rebase goes red for a stale translation nobody here can fix. Slice 15b: this used to iterate
// every file in I18N_DIR regardless of ownership, which is why mr.json and ms.json were hand-patched to
// keep the suite green — those patches are reverted now that the scope is correct.

const I18N_DIR = path.resolve(process.cwd(), '../i18n');

// Extract the ICU arguments a message actually references.
//
// A naive /\{(\w+)\}/ is wrong and produces false positives everywhere: in `{n, plural, one {hour} other {…}}`
// the `{hour}` is a plural BRANCH MESSAGE, not an argument. Parse the ICU grammar instead — `{arg}`,
// `{arg, type}`, and `{arg, plural|select|selectordinal, keyword {message} …}` — recursing into branch messages
// (so `{count, plural, one {# item (created {date})}}` correctly yields both `count` and `date`) while never
// mistaking a branch's text for an argument.
const argumentsOf = (message: string): string[] => {
  const found = new Set<string>();

  const walk = (text: string, index: number): number => {
    let i = index;
    while (i < text.length) {
      if (text[i] === '}') {
        return i;
      }
      if (text[i] !== '{') {
        i++;
        continue;
      }

      i++; // past '{'
      let name = '';
      while (i < text.length && text[i] !== ',' && text[i] !== '}') {
        name += text[i++];
      }
      name = name.trim();
      if (name) {
        found.add(name);
      }
      if (text[i] === '}') {
        i++;
        continue;
      }

      i++; // past ','
      let type = '';
      while (i < text.length && text[i] !== ',' && text[i] !== '}') {
        type += text[i++];
      }
      type = type.trim();
      if (text[i] === '}') {
        i++;
        continue;
      }

      i++; // past ',' — into the branch section
      if (['plural', 'select', 'selectordinal'].includes(type)) {
        while (i < text.length && text[i] !== '}') {
          while (i < text.length && text[i] !== '{' && text[i] !== '}') {
            i++; // skip the branch keyword (one / other / =0 / …)
          }
          if (text[i] !== '{') {
            break;
          }
          i = walk(text, i + 1) + 1; // recurse INTO the branch message
        }
        if (text[i] === '}') {
          i++;
        }
      } else {
        let depth = 1;
        while (i < text.length && depth > 0) {
          if (text[i] === '{') {
            depth++;
          } else if (text[i] === '}') {
            depth--;
          }
          i++;
        }
      }
    }
    return i;
  };

  walk(message, 0);
  return [...found].sort();
};

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
const locales = FORK_LOCALES.map((locale) => `${locale}.json`).sort();

describe('i18n placeholders', () => {
  it('parses ICU arguments without mistaking plural branches for placeholders', () => {
    expect(argumentsOf('Hello {name}')).toEqual(['name']);
    expect(argumentsOf('Every {hours, plural, one {hour} other {{hours, number} hours}}')).toEqual(['hours']);
    expect(argumentsOf('{count, plural, one {# item (created {date})} other {# items}}')).toEqual(['count', 'date']);
    expect(argumentsOf('Nothing to substitute')).toEqual([]);
  });

  it('every locale exists and is non-empty', () => {
    expect(locales.length).toBeGreaterThan(0);
  });

  // The load-bearing assertion. A translation may freely OMIT an argument (the sentence just reads differently),
  // but it must never reference one that en.json does not supply — svelte-i18n has no value to substitute and
  // prints the raw "{brace}" to the user. That is exactly what shipped to a German admin.
  it.each(locales)('%s references no placeholder that en.json does not supply', (file) => {
    const locale = read(file);
    const orphans: string[] = [];

    for (const [key, message] of Object.entries(locale)) {
      if (!Object.hasOwn(en, key)) {
        continue; // a key en.json no longer has is dead weight, not a rendering bug — it is never looked up
      }
      const supplied = new Set(argumentsOf(en[key]));
      for (const argument of argumentsOf(message)) {
        if (!supplied.has(argument)) {
          orphans.push(`${key} → {${argument}}`);
        }
      }
    }

    expect(orphans, `${file} would render these placeholders literally:\n  ${orphans.join('\n  ')}`).toEqual([]);
  });
});
