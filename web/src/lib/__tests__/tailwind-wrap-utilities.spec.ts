import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileUtilities, hasRuleFor } from '@test-data/tailwind';

/**
 * Guards the whole `wrap-*` utility family against names that compile to nothing.
 *
 * Tailwind v4 renamed v3's `break-words` to the singular `wrap-break-word` and added `wrap-anywhere`
 * / `wrap-normal`. It emits nothing at all for a name it does not recognise, so `wrap-break-words`
 * — the plural, which reads perfectly natural and is what v3 muscle memory produces — silently
 * styles nothing. That shipped twice in this repo: the Filter panel's tag label (#881), where long
 * tag names clipped instead of wrapping, and `Combobox.svelte`, which came in from upstream and so
 * will keep arriving on every rebase until upstream fixes it.
 *
 * Nothing else catches this. eslint's `better-tailwindcss/enforce-consistent-class-order` only
 * orders classes it recognises and leaves unknown ones alone; the unit suite runs on happy-dom,
 * which resolves no stylesheets; and the class name is still right there in the markup, so reading
 * the diff does not help either.
 *
 * Scoped to the `wrap-` prefix deliberately. Every `wrap-*` token in this codebase is a Tailwind
 * utility, so compiling them all is safe; widening the scan to arbitrary prefixes would start
 * picking up `@immich/ui` theme classes and dynamic fragments that legitimately produce no CSS on
 * their own.
 */
const SOURCE_ROOT = path.resolve(process.cwd(), 'src');
const SOURCE_EXTENSIONS = new Set(['.svelte', '.ts', '.js']);
const WRAP_UTILITY = /\bwrap-[a-z][\w-]*\b/g;

async function collectWrapUtilities(): Promise<Map<string, string[]>> {
  const entries = await readdir(SOURCE_ROOT, { recursive: true, withFileTypes: true });
  const sites = new Map<string, string[]>();

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        return;
      }
      const file = path.join(entry.parentPath, entry.name);
      // Skip this guard itself: it names the dead spelling in prose above, which would otherwise
      // register as a usage and fail the very check it exists to perform.
      if (file === import.meta.filename) {
        return;
      }
      const contents = await readFile(file, 'utf8');
      for (const [token] of contents.matchAll(WRAP_UTILITY)) {
        sites.set(token, [...(sites.get(token) ?? []), path.relative(SOURCE_ROOT, file)]);
      }
    }),
  );

  return sites;
}

describe('Tailwind wrap-* utilities', () => {
  it('every wrap-* class used in web sources compiles to real CSS', async () => {
    const sites = await collectWrapUtilities();
    const tokens = [...sites.keys()];

    // Guards the guard: if the scan silently matched nothing (wrong root, changed extensions), the
    // assertion below would pass vacuously over an empty list.
    expect(tokens.length).toBeGreaterThan(0);

    const css = await compileUtilities(tokens);
    const dead = tokens
      .filter((token) => !hasRuleFor(css, token))
      .map((token) => `${token} (used in ${sites.get(token)?.join(', ')})`);

    expect(dead).toEqual([]);
  });

  it('recognises a known-dead spelling, so the check above can actually fail', async () => {
    // Pins the premise the suite rests on: that Tailwind really does emit nothing for the plural.
    // Without this, a future Tailwind release that started accepting `wrap-break-words` would make
    // the scan above unfalsifiable, and it would keep passing while proving nothing.
    const css = await compileUtilities(['wrap-break-words', 'wrap-break-word']);

    expect(hasRuleFor(css, 'wrap-break-words')).toBe(false);
    expect(hasRuleFor(css, 'wrap-break-word')).toBe(true);
  });
});
