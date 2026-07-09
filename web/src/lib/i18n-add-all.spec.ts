import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); // web/src/lib
const i18nDir = path.resolve(here, '../../../i18n'); // repo-root/i18n

const LOCALES = ['en', 'de', 'fr', 'it', 'nl', 'es'];
const REQUIRED_KEYS = ['add_all_search_results', 'preparing_assets', 'spaces_hidden_too_many_assets'];

const load = (locale: string): Record<string, unknown> =>
  JSON.parse(readFileSync(path.join(i18nDir, `${locale}.json`), 'utf8'));

describe('i18n coverage for add-all-to-collection', () => {
  for (const locale of LOCALES) {
    it(`${locale}.json contains all required keys`, () => {
      const messages = load(locale);
      for (const key of REQUIRED_KEYS) {
        expect(messages[key], `${key} missing in ${locale}.json`).toBeTypeOf('string');
      }
    });
  }
});
