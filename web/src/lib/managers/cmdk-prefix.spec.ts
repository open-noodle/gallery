import { describe, expect, it } from 'vitest';
import { parseScope, type ParsedQuery } from './cmdk-prefix';

describe('parseScope', () => {
  const cases: Array<{ input: string; expected: ParsedQuery; why: string }> = [
    { input: '', expected: { scope: 'all', payload: '' }, why: 'empty' },
    { input: '  ', expected: { scope: 'all', payload: '' }, why: 'whitespace-only' },
    { input: 'alice', expected: { scope: 'all', payload: 'alice' }, why: 'no prefix' },
    { input: '@alice', expected: { scope: 'people', payload: 'alice' }, why: '@ canonical' },
    { input: '@ alice', expected: { scope: 'people', payload: 'alice' }, why: 'payload trim' },
    { input: '@', expected: { scope: 'people', payload: '' }, why: 'bare @' },
    { input: '#', expected: { scope: 'tags', payload: '' }, why: 'bare #' },
    { input: '/', expected: { scope: 'collections', payload: '' }, why: 'bare /' },
    { input: '>', expected: { scope: 'nav', payload: '' }, why: 'bare >' },
    { input: '@@alice', expected: { scope: 'people', payload: '@alice' }, why: 'only first char consumed' },
    { input: 'abc@def', expected: { scope: 'all', payload: 'abc@def' }, why: 'prefix must be at [0]' },
    { input: '$abc', expected: { scope: 'all', payload: '$abc' }, why: 'unsupported char kept' },
    { input: '＠alice', expected: { scope: 'all', payload: '＠alice' }, why: 'fullwidth at does not match' },
    { input: '＃xmas', expected: { scope: 'all', payload: '＃xmas' }, why: 'fullwidth hash does not match' },
    { input: '／trip', expected: { scope: 'all', payload: '／trip' }, why: 'fullwidth slash does not match' },
    { input: '＞theme', expected: { scope: 'all', payload: '＞theme' }, why: 'fullwidth greater-than does not match' },
    { input: '/2024/trips', expected: { scope: 'collections', payload: '2024/trips' }, why: 'first / consumed' },
    { input: '\t@alice', expected: { scope: 'people', payload: 'alice' }, why: 'tab stripped' },
    { input: '@   ', expected: { scope: 'people', payload: '' }, why: 'prefix + trailing whitespace = bare' },
    { input: `@${'a'.repeat(255)}`, expected: { scope: 'people', payload: 'a'.repeat(255) }, why: 'max length' },
  ];

  for (const { input, expected, why } of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)} (${why})`, () => {
      expect(parseScope(input)).toEqual(expected);
    });
  }
});
