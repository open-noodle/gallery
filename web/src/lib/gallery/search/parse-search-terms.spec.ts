import { parseSearchTerms } from '$lib/gallery/search/parse-search-terms';

describe('parseSearchTerms', () => {
  it('returns JSON-encoded search terms unchanged', () => {
    expect(parseSearchTerms('{"originalFileName":"beach","isFavorite":true}')).toEqual({
      originalFileName: 'beach',
      isFavorite: true,
    });
  });

  it('reads plain text as a text query', () => {
    expect(parseSearchTerms('beach')).toEqual({ query: 'beach' });
  });

  it.each(['42', 'true', 'null', '"beach"', '[1,2]'])('reads non-object JSON %s as a text query', (raw) => {
    expect(parseSearchTerms(raw)).toEqual({ query: raw });
  });
});
