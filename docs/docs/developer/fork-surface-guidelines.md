# Fork Surface Guidelines

Use Gallery-owned namespaces for new fork behavior when it is practical:

- server: `server/src/gallery/**`
- web: `web/src/lib/gallery/**`
- mobile: `mobile/lib/gallery/**`
- database migrations: `server/src/schema/migrations-gallery/**`
- CI helpers: `.github/actions/gallery-*/**` and `.github/workflows/gallery-*.yml`

Keep upstream-owned files as small adapters or hook points. When extracting
logic from an upstream-owned file, keep the adapter path in
`upstream_extension_paths` and add the Gallery-owned implementation path to
`owned_paths`.

Do not move code only for namespace purity during an urgent upstream rebase.
Fork-surface report findings are advisory; use them to choose opportunistic
follow-up work when the rebase is otherwise healthy.

Generated artifacts and upstream API clients should stay in their generated
locations. Do not move them into `gallery/*` namespaces.
