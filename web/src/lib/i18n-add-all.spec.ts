import { describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

// upstream i18n/ plus the Gallery overlay; the path is relative to web/.
const i18nDir = '../i18n/gallery/merged';

const LOCALES = ['en', 'de', 'fr', 'it', 'nl', 'es'];
const REQUIRED_KEYS = ['add_all_search_results', 'preparing_assets', 'spaces_hidden_too_many_assets'];

const load = async (locale: string): Promise<Record<string, unknown>> =>
  JSON.parse(await commands.readFile(`${i18nDir}/${locale}.json`, 'utf8'));

describe('i18n coverage for add-all-to-collection', () => {
  for (const locale of LOCALES) {
    it(`${locale}.json contains all required keys`, async () => {
      const messages = await load(locale);
      for (const key of REQUIRED_KEYS) {
        expect(messages[key], `${key} missing in ${locale}.json`).toBeTypeOf('string');
      }
    });
  }
});
