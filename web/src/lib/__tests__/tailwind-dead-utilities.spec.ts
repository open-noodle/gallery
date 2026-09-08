import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileUtilities, hasRuleFor } from '@test-data/tailwind';

/**
 * Guards whole utility families against names that compile to nothing.
 *
 * Tailwind emits nothing at all for a name it does not recognise, so a near-miss spelling silently
 * styles nothing. Two families have shipped that way already:
 *
 * - `wrap-*`: Tailwind v4 renamed v3's `break-words` to the singular `wrap-break-word` and added
 *   `wrap-anywhere` / `wrap-normal`. The plural `wrap-break-words` reads perfectly natural and is
 *   what v3 muscle memory produces. It shipped twice — the Filter panel's tag label (#881), where
 *   long tag names clipped instead of wrapping, and `Combobox.svelte`, which came in from upstream
 *   and so will keep arriving on every rebase until upstream fixes it.
 * - `grid-cols-*`: the singular `grid-col-2` sat in the reassign and merge people pickers, so both
 *   grids silently fell back to one column and rendered one enormous face per row on a phone
 *   (#1082).
 *
 * Nothing else catches this. eslint's `better-tailwindcss/enforce-consistent-class-order` only
 * orders classes it recognises and leaves unknown ones alone; the unit suite runs on happy-dom,
 * which resolves no stylesheets; and the class name is still right there in the markup, so reading
 * the diff does not help either.
 *
 * Scoped to specific prefixes deliberately. Every token matched below is a Tailwind utility in this
 * codebase, so compiling them all is safe; widening the scan to arbitrary prefixes would start
 * picking up `@immich/ui` theme classes and dynamic fragments that legitimately produce no CSS on
 * their own.
 */
const SOURCE_ROOT = path.resolve(process.cwd(), 'src');
const SOURCE_EXTENSIONS = new Set(['.svelte', '.ts', '.js']);

const FAMILIES = [
  { name: 'wrap-*', pattern: /\bwrap-[a-z][\w-]*\b/g },
  // Track rows alongside columns: they share the singular/plural trap.
  { name: 'grid-cols-* / grid-rows-*', pattern: /\bgrid-(?:cols?|rows?)-[a-z0-9][\w-]*\b/g },
];

async function collectUtilities(pattern: RegExp): Promise<Map<string, string[]>> {
  const entries = await readdir(SOURCE_ROOT, { recursive: true, withFileTypes: true });
  const sites = new Map<string, string[]>();

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
        return;
      }
      const file = path.join(entry.parentPath, entry.name);
      // Skip this guard itself: it names the dead spellings in prose above, which would otherwise
      // register as usages and fail the very check it exists to perform.
      if (file === import.meta.filename) {
        return;
      }
      const contents = await readFile(file, 'utf8');
      for (const [token] of contents.matchAll(pattern)) {
        sites.set(token, [...(sites.get(token) ?? []), path.relative(SOURCE_ROOT, file)]);
      }
    }),
  );

  return sites;
}

describe('Tailwind utilities that compile to nothing', () => {
  it.each(FAMILIES)('every $name class used in web sources compiles to real CSS', async ({ pattern }) => {
    const sites = await collectUtilities(pattern);
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

  it('recognises the known-dead spellings, so the checks above can actually fail', async () => {
    // Pins the premise the suite rests on: that Tailwind really does emit nothing for these
    // near-misses. Without this, a future Tailwind release that started accepting them would make
    // the scans above unfalsifiable, and they would keep passing while proving nothing.
    const css = await compileUtilities(['wrap-break-words', 'wrap-break-word', 'grid-col-2', 'grid-cols-2']);

    expect(hasRuleFor(css, 'wrap-break-words')).toBe(false);
    expect(hasRuleFor(css, 'wrap-break-word')).toBe(true);
    expect(hasRuleFor(css, 'grid-col-2')).toBe(false);
    expect(hasRuleFor(css, 'grid-cols-2')).toBe(true);
  });
});
