# Fork Surface Guidelines

Put new fork behavior in a Gallery-owned namespace when that is practical:

- server: `server/src/gallery/**`
- web: `web/src/lib/gallery/**`
- mobile: `mobile/lib/gallery/**`
- database migrations: `server/src/schema/migrations-gallery/**`
- CI helpers: `.github/actions/gallery-*/**` and `.github/workflows/gallery-*.yml`

Upstream-owned files stay thin. Keep them as adapters or hook points. When you
extract logic out of one, keep the adapter path in `upstream_extension_paths`
and add the Gallery-owned implementation path to `owned_paths`.

Never move code for namespace purity in the middle of an urgent upstream
rebase. The fork-surface report only advises; pick its findings up as
opportunistic follow-up work once the rebase is otherwise healthy.

Generated artifacts and upstream API clients stay where they are generated. Do
not move them into a `gallery/*` namespace.

## Migration Ladder

Start with new or actively touched fork work. Never bulk-move paths for
tidiness.

1. Put new fork-only implementation code in the preferred namespace for its
   domain.
2. Leave a small adapter in the upstream-owned file when upstream still owns
   the route, component, service, repository, table, or workflow entry point.
3. Add the adapter path to `upstream_extension_paths` and the Gallery-owned
   implementation path to `owned_paths` in `docs/fork/ownership.yml`.
4. Add focused tests around the Gallery-owned module before moving behavior out
   of the upstream-owned file.
5. After the move, run `make fork-ownership-coverage-check` and
   `make upstream-rebase-ready`. Check that the manifest and the reports
   classify the change correctly.

Good first candidates are fork code with stable seams and low upstream
coupling:

- pure web helpers, stores, and view-model logic under `web/src/lib/gallery/**`
- server policy, permission, and orchestration helpers under
  `server/src/gallery/**`
- fork-only workflow actions under `.github/actions/gallery-*/**`
- fork-owned database migrations under `server/src/schema/migrations-gallery/**`

Wait for a stronger reason before moving these:

- generated OpenAPI, mobile OpenAPI, SQL, and Drift outputs
- files whose names or locations are required by upstream frameworks
- table definitions, DTOs, or route files that upstream frequently rewrites
- tiny one-line hook points where the adapter is already the whole change
