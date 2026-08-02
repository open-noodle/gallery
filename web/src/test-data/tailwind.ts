import { compile } from 'tailwindcss';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Compiles utility class names through the project's real Tailwind and returns the generated CSS.
 *
 * This exists because a misspelt utility is invisible to every other kind of check. Tailwind emits
 * nothing for a name it does not recognise — no error, no warning — so the class survives in the
 * markup, `toContain('...')` still passes, eslint's
 * `better-tailwindcss/enforce-consistent-class-order` skips it (it only orders classes it knows),
 * and happy-dom resolves no stylesheets at all. Compiling is the only way to find out whether a
 * class name actually produces a declaration.
 *
 * Node-only (reads Tailwind's stylesheet off disk), so it belongs to tests rather than app code.
 *
 * @example
 * const css = await compileUtilities(['line-clamp-2', 'wrap-break-word']);
 * expect(css).toContain('overflow-wrap');
 */
export async function compileUtilities(classes: string[]): Promise<string> {
  const require = createRequire(import.meta.url);
  const compiler = await compile('@import "tailwindcss";', {
    base: process.cwd(),
    loadStylesheet: async (id: string) => {
      const file = id === 'tailwindcss' ? require.resolve('tailwindcss/index.css') : id;
      return { path: file, base: path.dirname(file), content: await readFile(file, 'utf8') };
    },
  });
  return compiler.build(classes);
}

/**
 * True when `css` contains a rule whose selector is exactly `.className`.
 *
 * The trailing boundary matters: a correct utility name can be a strict prefix of a misspelt one
 * (`wrap-break-word` and its plural, say), so a plain substring test would report the misspelling as
 * present whenever the correct name is.
 */
export function hasRuleFor(css: string, className: string): boolean {
  const escaped = className.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  return new RegExp(String.raw`\.${escaped}(?![\w-])`).test(css);
}
