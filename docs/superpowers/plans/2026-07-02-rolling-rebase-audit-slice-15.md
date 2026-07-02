# Slice 15 — LOW#10: command-palette "Server Stats" → real route

**Spec:** `docs/superpowers/specs/2026-07-02-rolling-rebase-audit-remediation.md` §"Slice 15"
**Findings:** `docs/plans/2026-07-02-rolling-rebase-audit-findings.md` LOW (hygiene/debt list)
**Branch / worktree:** `rebase/upstream-rolling-20260509-active`

---

## Step A — ground truth

`web/src/lib/managers/navigation-items.ts` builds the command palette's static
catalog (`NAVIGATION_ITEMS`). The `ADMIN_PAGES` entry `nav:admin:server-stats`
hardcodes:

```ts
route: '/admin/system-statistics',
```

No such route exists. The real page lives at `web/src/routes/admin/server-status/`
(`+page.svelte` present), and the fork already centralizes route strings in
`web/src/lib/route.ts`'s `Route` object, which has:

```ts
systemStatistics: () => '/admin/server-status',
```

Sibling items in `USER_PAGES` already use the `Route` helper where one exists
(`route: Route.memories()` for the memories item) rather than a hardcoded
string, so `Route.systemStatistics()` is the idiomatic fix — matches the
existing convention in the same file.

Confirmed via directory listing:
- `web/src/routes/admin/system-statistics` — does not exist.
- `web/src/routes/admin/server-status/+page.svelte` — exists.

### Route resolution is non-trivial (SvelteKit route groups + optional params)

All the other `NAVIGATION_ITEMS` routes were checked to make sure a *generic*
"route resolves to a real page" guard is possible without false positives:

- Admin routes (`/admin/...`) map directly onto `web/src/routes/admin/...`.
- User-page routes (`/photos`, `/albums`, `/people`, `/tags`, `/map`,
  `/sharing`, `/spaces`, `/trash`, `/favorites`, `/archive`, `/memories`) all
  live under the SvelteKit route **group** `web/src/routes/(user)/...` —
  `(user)` does not appear in the URL and must be transparently skipped when
  resolving a pathname to a directory.
- Several of those (`photos`, `tags`, `map`, `trash`, `favorites`, `archive`)
  additionally nest their `+page.svelte` under one or two **optional param**
  segments, e.g. `photos/[[assetId=id]]/+page.svelte` or
  `tags/[[photos=photos]]/[[assetId=id]]/+page.svelte`. An optional param
  segment (`[[name=matcher]]`) may be skipped entirely when resolving a
  shorter pathname, so the resolver must try "descend without consuming a
  segment" for those too.
- `systemSettings` items use a query string (`/admin/system-settings?isOpen=<key>`)
  that must be stripped before directory resolution.

So the RED/GREEN guard needs a small recursive resolver that: strips
query/hash, splits the pathname into segments, and walks
`web/src/routes` consuming literal directories, transparently entering
route-group directories (`(name)`) without consuming a segment, and
optionally entering `[[name=matcher]]` directories either consuming or
skipping a segment — succeeding if some path through the tree reaches a
directory containing `+page.svelte`.

Every current route in `NAVIGATION_ITEMS` resolves this way **except** the
Server Stats item's `/admin/system-statistics`, which is exactly the finding.

---

## Step B — files / tests / impl

### Files changed

1. `web/src/lib/managers/navigation-items.spec.ts` — new guard test(s) added
   to the existing `describe('NAVIGATION_ITEMS schema', ...)` block: a
   resolver helper plus an assertion that every item's route resolves to a
   real `+page.svelte`, and a targeted assertion that the Server Stats item
   resolves specifically to `/admin/server-status`.
2. `web/src/lib/managers/navigation-items.ts` — replace the hardcoded
   `'/admin/system-statistics'` with `Route.systemStatistics()` (the `Route`
   import already exists in this file for `Route.memories()`).

### Test — RED first

Add to `navigation-items.spec.ts`:

- A `resolveRoute(pathname)` helper (scoped to the test file) implementing the
  walk described in Step A, rooted at `web/src/routes`.
- `it('every navigation item route resolves to a real page component', ...)`
  — for every `NAVIGATION_ITEMS` entry, strip `?`/`#` suffix and assert
  `resolveRoute(pathname)` is `true`.
- `it('Server Stats resolves to /admin/server-status', ...)` — find the
  `nav:admin:server-stats` item and assert `item.route === '/admin/server-status'`
  (via `Route.systemStatistics()`) and that it resolves.

**Expected RED:** the "every navigation item route resolves" test fails for
`nav:admin:server-stats` — `/admin/system-statistics` has no matching
directory in `web/src/routes/admin/`. The "Server Stats resolves to
/admin/server-status" test also fails (route is `/admin/system-statistics`).

**Command:** `cd web && npx vitest run src/lib/managers/navigation-items.spec.ts`

### Minimal impl (GREEN)

In `navigation-items.ts`, `ADMIN_PAGES`'s `nav:admin:server-stats` entry:

```ts
route: '/admin/system-statistics',
```

→

```ts
route: Route.systemStatistics(),
```

No other changes — `Route` is already imported at the top of the file.

### Edge cases covered

- The resolver guard covers **every** palette route, not just this one, so a
  future stale/renamed route anywhere in `NAVIGATION_ITEMS` (system-settings
  accordion routes, admin pages, user pages) is caught, not just Server Stats.
- Route groups (`(user)`) and optional-param segments (`[[assetId=id]]`,
  `[[photos=photos]]`) are handled generically so the guard doesn't need a
  per-route special case.
- Query-string routes (`/admin/system-settings?isOpen=<key>`) are stripped
  before resolution so they aren't misread as literal path segments.

### GREEN commands

```
cd web && npx vitest run src/lib/managers/navigation-items.spec.ts
```

(File-scoped only per parallel-mode rules — no whole-project `pnpm check`.)

### Commit

`fix(web): command-palette Server Stats targets real route (LOW #10)`

(Left uncommitted per orchestrator instructions — this line records the
intended message for the orchestrator's commit.)
