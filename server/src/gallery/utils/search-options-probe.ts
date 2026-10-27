/**
 * The column alias every `POST /search/options` availability probe selects. A probe first runs inline under a short
 * `statement_timeout` and is retried materialised when Postgres cancels it (see `getSearchOptionsAvailability`), so
 * that cancellation is expected; the alias lets the query logger tell it apart from a real failure.
 */
export const SEARCH_OPTIONS_PROBE = 'search_options_probe';

/** Postgres cancelled the statement: its `statement_timeout` ran out. */
export const isSearchOptionsProbeTimeout = (error: unknown) =>
  (error as { code?: string } | undefined)?.code === '57014';

/** For the query logger: an availability probe that ran out of its inline budget, which the repository retries. */
export const isExpectedSearchOptionsProbeTimeout = (error: unknown, sql: string) =>
  isSearchOptionsProbeTimeout(error) && sql.includes(SEARCH_OPTIONS_PROBE);
