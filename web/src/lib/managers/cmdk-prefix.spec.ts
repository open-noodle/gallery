import type { PersonResponseDto } from '@immich/sdk';
import { describe, expect, it } from 'vitest';
import { parseScope, personSuggestionsComparator, type ParsedQuery } from './cmdk-prefix';

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

const p = (o: Partial<PersonResponseDto>): PersonResponseDto =>
  ({
    id: '0',
    name: '',
    birthDate: null,
    isHidden: false,
    thumbnailPath: '',
    type: 'person',
    ...o,
  }) as PersonResponseDto;

describe('personSuggestionsComparator', () => {
  it('sorts by updatedAt desc when present on both', () => {
    const a = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-01T00:00:00Z' });
    const b = p({ id: 'b', name: 'Bob', updatedAt: '2026-04-15T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('missing updatedAt treated as oldest', () => {
    const a = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'b', name: 'Bob' }); // no updatedAt
    expect([a, b].sort(personSuggestionsComparator)).toEqual([a, b]);
  });

  it('updatedAt tie → alpha by name', () => {
    const a = p({ id: 'a', name: 'Zack', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'b', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('same name tie → stable by id', () => {
    const a = p({ id: 'b', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    const b = p({ id: 'a', name: 'Alice', updatedAt: '2026-04-10T00:00:00Z' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });

  it('handles both missing updatedAt → alpha by name then id', () => {
    const a = p({ id: 'a', name: 'Bob' });
    const b = p({ id: 'b', name: 'Alice' });
    expect([a, b].sort(personSuggestionsComparator)).toEqual([b, a]);
  });
});
