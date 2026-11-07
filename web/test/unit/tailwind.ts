import { compile } from 'tailwindcss';
import tailwindStylesheet from 'tailwindcss/index.css?raw';

/**
Compiles utility class names through the project's real Tailwind and returns the generated CSS.

This exists because a misspelt utility is invisible to every other kind of check. Tailwind emits
nothing for a name it does not recognise — no error, no warning — so the class survives in the
markup, `toContain('...')` still passes, and eslint's
`better-tailwindcss/enforce-consistent-class-order` skips it (it only orders classes it knows).
Compiling is the only way to find out whether a class name actually produces a declaration.

Runs in the browser test tier: Tailwind's stylesheet comes in through Vite's `?raw` import (it is
self-contained, with no `@import` of its own) and Tailwind's `compile` is plain JavaScript. It
belongs to tests rather than app code.

@example
const css = await compileUtilities(['line-clamp-2', 'wrap-break-word']);
expect(css).toContain('overflow-wrap');
*/
export async function compileUtilities(classes: string[]): Promise<string> {
  const compiler = await compile('@import "tailwindcss";', {
    base: '/',
    loadStylesheet: (id: string) => {
      if (id !== 'tailwindcss') {
        throw new Error(`compileUtilities: unexpected stylesheet import "${id}"`);
      }
      return Promise.resolve({ path: 'tailwindcss/index.css', base: '/', content: tailwindStylesheet });
    },
  });
  return compiler.build(classes);
}

/**
True when `css` contains a rule whose selector is exactly `.className`.

The trailing boundary matters: a correct utility name can be a strict prefix of a misspelt one
(`wrap-break-word` and its plural, say), so a plain substring test would report the misspelling as
present whenever the correct name is.
*/
export function hasRuleFor(css: string, className: string): boolean {
  const escaped = className.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
  return new RegExp(String.raw`\.${escaped}(?![\w-])`).test(css);
}
