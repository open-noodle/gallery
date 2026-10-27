# Opt-in benchmarks

Not part of any test suite or CI job. Each starts its own Postgres container (the medium-test image), so it never
touches a dev or e2e database.

- `search-options.bench.ts`: `POST /search/options` against what mobile calls today, on a 500,000-asset library.
  Results: `specs/research/2026-10-23-search-options-500k-benchmark.md`.

  ```bash
  cd server
  npx vitest --config test/perf/vitest.config.perf.mjs run test/perf/search-options.bench.ts
  ```

  `BENCH_SCALE=0.01` seeds 1% of the library (a quick smoke run), `BENCH_RUNS` sets the timed runs per case (default
  20, after 2 warm-ups), `BENCH_OUT` and `BENCH_EXPLAIN_OUT` write the results JSON and the `EXPLAIN (ANALYZE, BUFFERS)`
  plans of the slowest case to files.

  `BENCH_DB_URL=postgres://…` runs against an existing database instead of a fresh container. It seeds the database on
  first use and keeps the data (the `bench_world` and `bench_space` tables record what was seeded), so later runs skip
  the seed, which takes about 20 minutes. `BENCH_TIME=<state>:<dimension>[:cold],…` times only those requests, for
  example `BENCH_TIME=11:availability,12:people`. `BENCH_EXPLAIN=<state>:<dimension>` (or `<state>:old`) prints the
  plans of one cold request and skips the timings. State numbers are the ones in the results table.
