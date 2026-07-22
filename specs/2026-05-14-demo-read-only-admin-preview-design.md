# Demo Read-Only Admin Preview Design

Date: 2026-05-14
Status: brainstorming

## Context

The public demo currently logs visitors in as `demo@gallery.app`, a non-admin user. That keeps the demo instance safe because demo mode blocks most mutating requests for non-admin users.

The product demo would be stronger if visitors could see the admin control surface: users, queues, system settings, server status, maintenance, storage migration, and library management. Making the demo user a real admin is not safe with the current demo branch because `DemoInterceptor` bypasses demo-mode write protection for admins.

The design goal is to let the demo user preview admin pages without granting actual admin authority or write capability.

## Current Behavior

Frontend admin access is gated by `authManager.user.isAdmin`:

```ts
if (adminRoute && !authManager.user.isAdmin) {
  redirect(307, Route.photos());
}
```

Navigation and command-palette admin entries also use `isAdmin`/`adminOnly` checks.

Backend admin APIs are gated by `@Authenticated({ admin: true })`, which rejects non-admin users before route handlers run:

```ts
if (!authDto.user.isAdmin && adminRoute) {
  throw new ForbiddenException('Forbidden');
}
```

Demo write protection currently lets admins bypass all demo restrictions:

```ts
const isAdmin = request.user?.user?.isAdmin;
if (isAdmin) {
  return next.handle();
}
```

Therefore, making `demo@gallery.app` an admin would allow writes instead of only enabling admin views.

## Goals

- Keep `demo@gallery.app` non-admin in the database.
- Let the demo user open selected admin pages.
- Let the demo user discover selected admin pages and admin commands through global search / command palette.
- Let the demo user read selected admin API data needed by those pages.
- Keep demo write protection active for all mutating admin actions.
- Let mutating admin commands fail on the server instead of adding command-specific preview metadata or disabled command variants.
- Make the UI feel intentionally read-only, not broken.
- Preserve normal admin behavior outside demo mode.
- Keep the implementation demo-branch-only unless the feature later becomes useful upstream.

## Non-Goals

- Do not make the demo user a real admin.
- Do not grant broad admin permissions through API keys, sessions, or database roles.
- Do not expose secrets, tokens, backup downloads, raw config secrets, or destructive maintenance controls in the demo.
- Do not build a full RBAC system.
- Do not make all admin pages perfect in the first pass if a smaller useful preview is safer.

## User Experience

The demo user should see admin navigation entries and be able to open admin pages. Admin pages should have a small read-only demo notice near the page title or action area:

```text
Read-only demo
Admin controls are visible for evaluation. Changes are disabled in this public demo.
```

Primary mutating controls should be hidden or disabled where practical:

- create user
- edit user
- delete/restore user
- save settings
- create or run jobs
- pause/resume queues
- add library
- edit library
- run maintenance actions
- upload/restore database backups
- start storage migration actions

If a control is missed, the server must still reject the request. Prefer the existing demo-mode error when the request reaches `DemoInterceptor`:

```text
This action is not available in demo mode
```

If a mutating admin command is rejected earlier by auth because the first implementation only grants read-preview access, a normal `403 Forbidden` response is also acceptable. The product behavior is still correct: the public demo user cannot change state.

The server-side block is the safety boundary. UI disabling is polish and clarity.

## TDD Discipline

Implementation must be test-driven. Each phase should start with focused failing tests that describe the intended behavior, then the smallest production change to make those tests pass.

Do not implement route access, command visibility, interceptor changes, and UI polish in one untested batch. This feature changes public-demo authorization behavior, so the negative tests are as important as the happy paths.

Required red-test sequence:

1. Backend auth tests prove the configured demo user can access selected admin preview reads while normal non-admin users still cannot.
2. Backend write-protection tests prove the configured demo user cannot mutate selected admin resources.
3. Frontend route-guard tests prove the demo user can enter admin pages without becoming a real admin.
4. Frontend search/command tests prove admin entries appear for demo preview users.
5. Frontend or component tests prove exposed admin pages render the read-only demo notice.

Only after those tests are passing should broader visual polish or additional admin pages be added.

## Recommended Design

### 1. Add Demo Admin Preview Capability

Add a frontend capability separate from real admin status:

```ts
authManager.canPreviewAdmin = $derived(authManager.isDemo || authManager.user.isAdmin);
```

or, if derived state is awkward in the current manager:

```ts
authManager.canViewAdmin = authManager.user.isAdmin || authManager.isDemo;
```

Use this for:

- `/admin` route guard
- admin navigation items
- command palette admin entries
- global search admin entries
- account menu admin entry

Do not change code that checks `authManager.user.isAdmin` for operations that require actual authority. The naming matters: `canPreviewAdmin` should not be mistaken for permission to mutate data.

### 2. Add Backend Demo Admin Read Access

Update backend auth so demo mode can allow a non-admin demo user to read a narrow set of admin routes.

The cleanest local rule is:

```text
If demo mode is enabled
and the authenticated user is the configured demo user
and the route is admin-only
and the HTTP method is safe
and the route is on the admin-preview allowlist
then allow the request through auth.
```

Safe methods should start as:

```text
GET
```

Mutating methods must remain blocked by the server. There are two acceptable implementations:

```text
Preferred: auth allows the configured demo user through admin routes, then DemoInterceptor blocks mutating requests before handlers run.
Fallback: auth allows only preview-safe admin GET routes, so mutating admin commands fail at the auth guard.
```

The preferred implementation gives users the existing demo-mode error and centralizes demo write protection. The fallback is simpler and still safe, but the user may see a generic forbidden error after executing a mutating command.

The allowlist should be explicit. Candidate read endpoints for a first pass:

```text
GET /api/server/statistics
GET /api/server/storage
GET /api/server/version
GET /api/server/features
GET /api/admin/users
GET /api/admin/users/:id
GET /api/admin/users/:id/preferences
GET /api/admin/users/:id/statistics
GET /api/admin/users/:id/sessions
GET /api/libraries
GET /api/libraries/:id
GET /api/libraries/:id/statistics
GET /api/jobs
GET /api/queues
GET /api/queues/:name
GET /api/queues/:name/jobs
GET /api/system-config
GET /api/system-config/defaults
GET /api/system-config/storage-template-options
GET /api/system-metadata/version-check-state
```

The exact endpoint names must be verified against generated OpenAPI and current controllers before implementation. Anything returning sensitive secret material should be excluded or redacted.

Do not include these in the first pass without a separate audit:

```text
GET /api/admin/database-backups
GET /api/admin/database-backups/:filename
GET /api/server/license
GET /api/admin/maintenance/*
```

### 3. Tighten DemoInterceptor Admin Handling

Remove the broad admin bypass:

```ts
if (isAdmin) {
  return next.handle();
}
```

Replace it with one of these:

```text
Option A: No real-admin write bypass in demo mode.
Option B: Real-admin write bypass only for a private operational admin account, not the public demo user.
Option C: Real-admin write bypass only for a tiny allowlist of operational endpoints.
```

Option A is safest for a public demo. If the instance needs operational admin writes, turn demo mode off temporarily or use a deployment-only mechanism rather than a public HTTP bypass.

### 4. Read-Only UI State

Add a shared frontend helper:

```ts
const isReadOnlyDemo = $derived(authManager.isDemo && !authManager.user.isAdmin);
```

Use it to disable page-level actions. Prefer a shared component or helper naming pattern so the checks do not become scattered and ambiguous.

Admin pages should continue to load real data from the demo instance. They should not use hardcoded fake admin content unless an endpoint is too sensitive to expose.

## Scope Options

### Option A: Minimal Safe Preview

Show only admin pages that are mostly read-only already:

- server status
- queues overview and queue detail
- system settings read view
- users list and user detail
- libraries list

Hide pages with higher risk or more mutation-heavy workflows:

- storage migration
- maintenance actions
- database backups
- user create/edit
- library create/edit

This is the recommended first implementation.

### Option B: Broad Preview With Disabled Controls

Expose most admin pages and disable known mutating controls. This gives the best product demo but requires a larger audit of each admin page and modal.

This should only happen after Option A has server-side tests proving writes are blocked.

### Option C: Real Admin User With Blocked Writes

Make the demo user admin, then change `DemoInterceptor` so admin writes are blocked. This is tempting because existing route guards would mostly work, but it is riskier because admin state can leak into many places as real authority.

This option is not recommended. It makes it too easy for a future route, interceptor, websocket handler, or background action to treat the public demo user as a real admin.

## Backend Design Notes

Auth currently rejects non-admin users before the interceptor handles the request. Demo admin preview must therefore be handled in auth or route metadata, not only in `DemoInterceptor`.

Potential helper:

```ts
private isDemoAdminPreviewRead(authDto: AuthDto, metadata: RouteMetadata, method: string): boolean {
  const { demo } = this.configRepository.getEnv();
  return (
    demo.enabled &&
    authDto.user.email === demo.email &&
    metadata.adminRoute &&
    method === 'GET' &&
    isDemoAdminPreviewRoute(metadata.uri)
  );
}
```

The auth layer may not currently receive HTTP method in `ValidateRequest`. If not, add it from `AuthGuard.canActivate()` alongside URI metadata. Keep this change narrowly typed and covered by tests.

Route matching should prefer normalized route metadata over raw path strings if available. If only raw path/URI is reliable, keep the allowlist simple and conservative.

## Frontend Design Notes

The frontend change should avoid replacing all `isAdmin` checks globally. Use `canPreviewAdmin` only where the user needs to see navigation or load a route.

Good places to use preview access:

- `web/src/lib/utils/auth.ts` for admin route redirects
- navigation item filtering
- command palette admin item filtering
- global search admin item filtering
- recent command cleanup for admin-only entries
- account info/admin link rendering

Places that should generally keep `isAdmin`:

- logic that decides whether the user can edit another user
- settings save actions
- queue mutating actions
- storage migration actions
- maintenance actions
- upload, delete, restore, and backup actions

For first pass polish, hide or disable obvious page-level mutating controls on the exposed pages when it is cheap and local. Do not spend extra effort on command-palette admin commands. Search and command-palette commands can remain visible and fail server-side when they attempt a write. The server block must be tested as the real protection.

## Security Rules

- Demo admin preview must never set `user.isAdmin = true`.
- Demo admin preview must never grant `Permission.All`.
- Demo admin preview must never bypass demo write protection.
- Non-demo non-admin users must still be rejected from admin routes.
- API keys for the demo user must not gain admin-preview access. Preview access is for the interactive demo session only.
- Shared links must not gain admin-preview access.
- Admin preview read endpoints must not expose secrets. If a config endpoint returns secrets or redacted secrets, verify behavior before exposing it.
- Mutating admin endpoints must not reach route handlers for the demo user.

## Test Strategy

Backend tests:

- demo off, non-admin user cannot access admin read endpoint
- demo on, configured demo user can access allowed admin `GET`
- demo on, configured demo user cannot access non-allowlisted admin `GET`
- demo on, configured demo user cannot access admin `POST`, `PUT`, `PATCH`, or `DELETE`
- demo on, configured demo user cannot mutate system config, users, jobs, queues, libraries, or maintenance endpoints
- demo on, mutating admin requests do not invoke their controller/service handlers
- demo on, normal admin behavior still works or is intentionally blocked by `DemoInterceptor`, depending on the chosen admin-bypass policy
- demo on, non-demo non-admin user cannot access admin preview routes
- demo on, shared-link auth cannot access admin preview routes
- demo on, demo-user API key cannot access admin preview routes
- demo on, `GET /api/admin/database-backups`, backup download, server license, and maintenance endpoints remain blocked unless explicitly audited into scope

Frontend tests:

- demo user can pass admin route guard
- non-demo non-admin user is redirected away from admin route
- demo user sees admin navigation entries
- demo user sees allowed admin pages in global search results
- demo user sees allowed admin commands in command palette results
- demo user can navigate to allowed admin pages from global search / command palette
- demo user sees admin commands in search/command palette, including mutating commands
- demo user sees read-only demo notice on exposed admin pages
- demo user does not see or cannot use obvious page-level mutating controls on exposed pages where they are cheap to gate
- demo user executing a mutating admin command surfaces the server failure instead of changing state
- real admin users keep normal admin navigation outside demo mode

Smoke tests on live demo:

- demo login
- open `/admin/server-status`
- open `/admin/users`
- open `/admin/queues`
- open `/admin/system-settings`
- search for admin concepts such as `users`, `jobs`, `settings`, and `queues`
- navigate to an allowed admin page from search
- attempt a representative settings save and confirm it is blocked
- attempt a representative queue action and confirm it is blocked
- confirm the underlying database or API state did not change after blocked actions

## Rollout Plan

1. Implement backend preview read access behind demo mode and explicit route allowlist.
2. Remove or narrow the current admin bypass in `DemoInterceptor`.
3. Add frontend `canPreviewAdmin` route/navigation/search access.
4. Expose a small set of low-risk admin pages.
5. Add read-only demo notice and disable obvious page actions.
6. Run targeted backend and frontend tests from the TDD sequence.
7. Run production web/server builds if touched paths require them.
8. Rebase demo branch and deploy to `demo.opennoodle.de`.
9. Verify live read-only admin pages, search discovery, failed commands, and unchanged state after blocked writes.

## Open Questions

- Should real admins be able to write while demo mode is enabled, or should demo mode block all users equally?
- Which admin pages are most valuable for the public demo?
- Should settings pages show current real values, redacted values, or static preview values?
- Should failed writes show the existing generic demo-mode error, or should admin preview pages show a friendlier read-only demo toast?
- Should admin preview access be encoded only in frontend state, or exposed from `/api/server/config` as a named capability like `demoAdminPreview`?
- Should the first implementation use preferred auth-through-interceptor behavior for mutating admin requests, or the simpler GET-only auth fallback?

## Search And Command Palette Behavior

Admin preview is not only direct route access. A demo user should be able to search for admin concepts and see the same discoverable admin surfaces a real admin would naturally find.

Required first-pass searchable items:

- admin users page
- server status page
- queues overview page
- queue detail pages
- system settings page
- library management page

Optional first-pass searchable items:

- maintenance page, if read-only enough after audit
- storage migration page, if read-only enough after audit
- individual system settings subsections
- individual queue actions and other admin commands

Search filtering should use the new preview capability rather than raw `isAdmin`:

```text
Visible if !item.adminOnly
Visible if item.adminOnly && authManager.user.isAdmin
Visible if item.adminOnly && authManager.canPreviewAdmin
```

Do not add extra command-level metadata in the first pass. Showing admin commands is enough. If a demo user executes a mutating admin command, the command should call the normal API path and fail through server-side protection. The preferred implementation fails through `DemoInterceptor`; the simpler GET-only auth fallback fails earlier with `403 Forbidden`.

Recent command cleanup also needs updating. Today stale or forbidden admin recents are purged when the user is not admin. In demo admin preview mode, admin recents should remain valid because the user can discover those commands. Mutating recents do not need special handling beyond the normal failed API response on execution.

## Recommendation

Start with Option A.

Keep the public demo user non-admin, add a demo-only admin preview capability, allow only explicitly listed admin `GET` endpoints to return data for the configured demo user, and remove the broad admin bypass from demo write protection. Mutating admin commands may still be visible, but they must fail server-side and must not reach route handlers. Expose the low-risk admin pages first, then expand page coverage after write-blocking and redaction behavior are proven by tests.
