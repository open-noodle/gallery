import { beforeEach, describe, expect, it } from 'vitest';
import { consumeTypedSearchNames, storeTypedSearchNames } from './typed-search-name-cache';

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
});
