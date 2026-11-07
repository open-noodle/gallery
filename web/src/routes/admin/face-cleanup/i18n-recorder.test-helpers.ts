import { t } from 'svelte-i18n';
import { afterAll, beforeAll } from 'vitest';

export type RecordedTranslation = { key: string; values?: Record<string, unknown> };

/**
Records every (key, values) pair a component asks `$t` to translate, so a test can assert which string was
chosen and what was interpolated into it: the test locale renders keys verbatim and drops the values.

A `vi.mock('svelte-i18n')` cannot do this in browser mode: `test/unit/setup.ts` loads svelte-i18n before any
spec's mocks register, and an already-loaded module is never swapped out. The components subscribe to this
same `t` store, so wrapping its `subscribe` reaches them; rendering is untouched.
*/
export const recordTranslations = () => {
  const translations: RecordedTranslation[] = [];
  const subscribe = t.subscribe;

  beforeAll(() => {
    t.subscribe = (run, invalidate) =>
      subscribe((format) => {
        const recording: typeof format = (id, options) => {
          const key = typeof id === 'string' ? id : id.id;
          const values = (typeof id === 'string' ? options : id)?.values as Record<string, unknown> | undefined;
          translations.push({ key, values });
          return format(id, options);
        };
        run(recording);
      }, invalidate);
  });

  afterAll(() => {
    t.subscribe = subscribe;
  });

  return translations;
};
