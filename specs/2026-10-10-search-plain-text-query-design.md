# Search page: plain-text `query` parameter

## Problem

`/search` reads its terms from the `query` URL parameter and passes it straight to `JSON.parse`. The
page writes JSON there itself, but a hand-typed, bookmarked or shared URL such as
`/search?query=beach` is plain text. `JSON.parse('beach')` throws inside a `$derived`, and the whole
route renders blank (console: `SyntaxError: Unexpected token 'b', "beach" is not valid JSON`).
Non-object JSON (`?query=42`, `?query=true`) parses, but the result is not a `SearchTerms` object.

## Change

`parseSearchTerms(raw)` replaces the bare `JSON.parse`:

- JSON that parses to a plain object is used as the search terms, unchanged from before.
- Anything else, invalid JSON or JSON that is not an object, becomes `{ query: raw }`, a text
  (smart) search for the literal string.

No URL the app writes changes meaning; only URLs that used to crash now search.

## Tests

`search-page.spec.ts`:

- `?query=beach` issues a smart search with `query: 'beach'`.
- `?query=42` issues a smart search with `query: '42'`.

Both fail on the previous code (the first throws, the second never searches).
