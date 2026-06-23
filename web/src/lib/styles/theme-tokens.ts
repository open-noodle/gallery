import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Run from the web/ package dir (all plan commands `cd web` first).
const CSS_PATH = resolve(process.cwd(), 'src/styles/gallery-theme.css');

const extractBlock = (css: string, selectorPattern: RegExp): string => {
  const m = css.match(selectorPattern);
  return m ? m[1] : '';
};

const parseVars = (block: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) {
      out[m[1]] = m[2].trim();
    }
  }
  return out;
};

export const readThemeTokens = (): { light: Record<string, string>; dark: Record<string, string> } => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const light = parseVars(extractBlock(css, /:root,\s*\.light\s*\{([\s\S]*?)\n\}/));
  const dark = parseVars(extractBlock(css, /(?:^|\n)\.dark\s*\{([\s\S]*?)\n\}/));
  return { light, dark };
};
