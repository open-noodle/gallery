import { beforeEach, describe, expect, it } from 'vitest';
import { consumeTypedSearchNames, getTypedSearchDisplayText, storeTypedSearchNames } from './typed-search-name-cache';

describe('typed search name cache', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('stores and consumes names by destination URL', () => {
    storeTypedSearchNames('/photos?q=beach&people=person-1', {
      personNames: new Map([['person-1', 'Anna']]),
      tagNames: new Map([['tag-1', 'Travel']]),
    });

    const result = consumeTypedSearchNames('/photos?q=beach&people=person-1');

    expect(result.personNames).toEqual(new Map([['person-1', 'Anna']]));
    expect(result.tagNames).toEqual(new Map([['tag-1', 'Travel']]));
    expect(consumeTypedSearchNames('/photos?q=beach&people=person-1')).toEqual({
      personNames: new Map(),
      tagNames: new Map(),
    });
  });

  it('ignores malformed storage data', () => {
    sessionStorage.setItem('typed-search:names:/photos', '{not-json');

    expect(consumeTypedSearchNames('/photos')).toEqual({
      personNames: new Map(),
      tagNames: new Map(),
    });
  });

  it('keeps raw typed search display text after consuming names', () => {
    storeTypedSearchNames(
      '/photos?people=person-cat',
      {
        personNames: new Map([['person-cat', 'cat']]),
        tagNames: new Map(),
      },
      'person:cat',
    );

    expect(getTypedSearchDisplayText('/photos?people=person-cat')).toBe('person:cat');
    consumeTypedSearchNames('/photos?people=person-cat');
    expect(getTypedSearchDisplayText('/photos?people=person-cat')).toBe('person:cat');
  });
});
