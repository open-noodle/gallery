/**
 * Reads the `/search?query=` parameter. The app writes JSON-encoded search terms there, but a
 * hand-typed, bookmarked or shared `/search?query=beach` is plain text: `JSON.parse` throws on it
 * (and on non-object JSON such as `42` yields a non-object), which used to take the whole page down.
 * JSON that parses to a plain object is returned as-is; anything else becomes a text query.
 */
export const parseSearchTerms = <T extends { query?: string }>(raw: string): T => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as T;
    }
  } catch {
    // not JSON: fall through to a text query
  }
  return { query: raw } as T;
};
