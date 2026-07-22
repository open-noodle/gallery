# Demo Read-Only Admin Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. REQUIRED SUB-SKILL: Use superpowers:test-driven-development for every code task. Use superpowers:verification-before-completion before claiming this phase is done. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the public demo user discover and view selected admin pages without making the user a real admin or allowing admin writes.

**Architecture:** Keep `demo@gallery.app` non-admin and add a demo-only preview capability. Backend auth allows only the configured demo user to read an explicit allowlist of admin endpoints in demo mode, while mutating requests stay blocked before handlers run. Frontend route, navigation, global search, command, and recent-entry filtering use the preview capability for discoverability, while actual edit authority keeps using `user.isAdmin`.

**Tech Stack:** NestJS auth guard/service/interceptor, Svelte 5 auth manager and global search manager, `@immich/sdk`, Vitest, Testing Library Svelte, existing demo branch infrastructure.

---

## Source Spec

- Read: `docs/superpowers/specs/2026-05-14-demo-read-only-admin-preview-design.md`

## Phase Boundary

This plan implements the first safe preview slice:

- Demo user can load these admin pages:
  - `/admin/server-status`
  - `/admin/users`
  - `/admin/queues`
  - `/admin/system-settings`
  - `/admin/library-management`
- Demo user can discover admin navigation and admin commands through global search / command palette.
- Demo user stays `isAdmin: false`.
- Mutating admin requests from the demo user fail server-side and do not reach handlers.
- Obvious page-level mutating actions on exposed pages are hidden or disabled where that is local and cheap.
- Demo-only implementation commits are consolidated before pushing, preserving the demo branch shape of `origin/main` plus one demo commit.

This plan does not implement:

- Full read-only audit of maintenance, database backup, storage migration, or license pages.
- Extra command metadata for disabled commands.
- Making the demo user a real admin.
- Upstream-ready RBAC.

## File Structure

Backend files:

- Modify: `server/src/services/auth.service.ts`
  - Add demo admin preview read access in `authenticate()`.
  - Add a small allowlist helper for admin preview reads.
  - Extend `ValidateRequest` metadata to include request method and auth source behavior.
- Modify: `server/src/services/auth.service.spec.ts`
  - Add red/green tests for demo preview admin reads and blocked writes.
- Modify: `server/src/middleware/auth.guard.ts`
  - Pass `request.method` into `AuthService.authenticate()`.
- Modify: `server/src/middleware/demo.interceptor.ts`
  - Remove broad admin bypass in demo mode or narrow it so the public demo user never bypasses write protection.
- Modify: `server/src/middleware/demo.interceptor.spec.ts`
  - Update admin bypass tests and add mutating admin request coverage.

Frontend files:

- Modify: `web/src/lib/managers/auth-manager.svelte.ts`
  - Add `canPreviewAdmin` and `isReadOnlyDemo` getters.
- Add: `web/src/lib/managers/auth-manager.svelte.spec.ts`
  - Cover preview capability combinations and logout/reset behavior.
- Modify: `web/src/lib/utils/auth.ts`
  - Let demo preview users pass admin route guard.
- Add: `web/src/lib/utils/auth.spec.ts`
  - Cover admin route guard for real admin, demo preview, non-demo non-admin, and unauthenticated users.
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
  - Replace admin-only filtering with a shared preview-aware predicate.
  - Keep admin recents valid in demo preview mode.
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`
  - Cover admin navigation, commands, top matches, and recents for demo preview user.
- Modify: `web/src/lib/managers/navigation-items.ts`
  - Fix stale admin server statistics navigation route if still present.
- Modify: `web/src/lib/managers/navigation-items.spec.ts`
  - Pin admin navigation routes used by search to real route helper paths.
- Modify: `web/src/lib/components/shared-components/navigation-bar/account-info-panel.svelte`
  - Show admin entry for demo preview users.
- Add or modify: account-info-panel test if an existing test file exists; otherwise cover the shared preview condition through `ReadOnlyDemoNotice` and route/search tests.
- Modify exposed admin page components only where page-level actions are trivial to gate.

Optional frontend polish files:

- Modify: `i18n/en.json`
  - Add a short `read_only_demo` / `read_only_demo_admin_description` string if no suitable string exists.
- Add: `web/src/lib/components/admin/ReadOnlyDemoNotice.svelte`
  - Small reusable notice for exposed admin pages if more than two pages need the same markup.

## TDD Rules

- Each task starts by adding focused failing tests.
- Run the focused test command and confirm the expected red failure.
- Implement only the production code needed for that task.
- Run the same focused tests and confirm green.
- Commit after each task if implementing interactively.
- Do not broaden page coverage until backend negative tests prove writes are blocked.

## Task 0: Baseline And Endpoint Confirmation

**Files:**

- Read: `docs/superpowers/specs/2026-05-14-demo-read-only-admin-preview-design.md`
- Read: `server/src/controllers/user-admin.controller.ts`
- Read: `server/src/controllers/library.controller.ts`
- Read: `server/src/controllers/job.controller.ts`
- Read: `server/src/controllers/queue.controller.ts`
- Read: `server/src/controllers/system-config.controller.ts`
- Read: `server/src/controllers/server.controller.ts`
- No production edits.

- [ ] **Step 1: Confirm working branch and clean scope**

Run:

```bash
git status --short
git branch --show-current
```

Expected:

- Branch is the demo implementation worktree branch.
- Only intentional docs files are dirty before implementation.
- Do not revert unrelated files.

- [ ] **Step 2: Run current demo server tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/middleware/demo.interceptor.spec.ts src/services/auth.service.demo.spec.ts src/services/server.service.spec.ts
```

Expected: PASS before implementation.

- [ ] **Step 3: Run current search/auth-adjacent web tests**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/global-search-manager.svelte.spec.ts src/lib/managers/navigation-items.spec.ts src/routes/auth/login/page.spec.ts
```

Expected: PASS before implementation.

- [ ] **Step 4: Confirm endpoint names**

Run:

```bash
rg "@(Controller|Get|Post|Put|Patch|Delete)|Authenticated" server/src/controllers/user-admin.controller.ts server/src/controllers/library.controller.ts server/src/controllers/job.controller.ts server/src/controllers/queue.controller.ts server/src/controllers/system-config.controller.ts server/src/controllers/system-metadata.controller.ts server/src/controllers/server.controller.ts
```

Expected: confirms the first-pass backend reads needed by exposed admin pages:

```text
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
GET /api/server/statistics
```

These non-admin server endpoints may also be used by the pages, but they do not need the demo admin auth allowlist because their controller metadata is not admin-only:

```text
GET /api/server/storage
GET /api/server/version
GET /api/server/features
```

Excluded until separate audit:

```text
/api/admin/database-backups*
/api/server/license
/api/admin/maintenance*
/api/storage-migration*
```

## Task 1: Backend Auth Allows Demo Preview Reads Only

**Files:**

- Modify: `server/src/services/auth.service.spec.ts`
- Modify: `server/src/services/auth.service.ts`
- Modify: `server/src/middleware/auth.guard.ts`

- [ ] **Step 1: Add failing backend auth tests**

Add a `describe('demo admin preview')` block near the existing `validate - user token` tests in `server/src/services/auth.service.spec.ts`.

Use this helper inside the block:

```ts
const demoUser = UserFactory.create({ email: 'demo@gallery.app', isAdmin: false });
const nonDemoUser = UserFactory.create({ email: 'visitor@gallery.app', isAdmin: false });

const mockSessionFor = (user: UserAdmin) => {
  const session = SessionFactory.create();
  mocks.session.getByToken.mockResolvedValue({
    id: session.id,
    updatedAt: session.updatedAt,
    user,
    isPendingSyncReset: false,
    pinExpiresAt: null,
    appVersion: null,
    oauthSid: null,
  });
};

const authenticateAdmin = (method: string, uri: string) =>
  sut.authenticate({
    headers: { cookie: 'immich_access_token=auth_token' },
    queryParams: {},
    metadata: { adminRoute: true, sharedLinkRoute: false, uri, method },
  });
```

Add these tests:

```ts
it('allows the configured demo user to read allowlisted admin routes in demo mode', async () => {
  mocks.config.getEnv.mockReturnValue({
    ...mocks.config.getEnv(),
    demo: { enabled: true, email: 'demo@gallery.app', password: 'demo' },
  });
  mockSessionFor(demoUser);

  await expect(authenticateAdmin('GET', '/api/admin/users')).resolves.toMatchObject({
    user: expect.objectContaining({ email: 'demo@gallery.app', isAdmin: false }),
  });
});

it('blocks the configured demo user from non-allowlisted admin reads', async () => {
  mocks.config.getEnv.mockReturnValue({
    ...mocks.config.getEnv(),
    demo: { enabled: true, email: 'demo@gallery.app', password: 'demo' },
  });
  mockSessionFor(demoUser);

  await expect(authenticateAdmin('GET', '/api/admin/database-backups')).rejects.toBeInstanceOf(ForbiddenException);
});

it('blocks demo user mutating admin requests before route handlers can run', async () => {
  mocks.config.getEnv.mockReturnValue({
    ...mocks.config.getEnv(),
    demo: { enabled: true, email: 'demo@gallery.app', password: 'demo' },
  });
  mockSessionFor(demoUser);

  await expect(authenticateAdmin('PUT', '/api/system-config')).rejects.toBeInstanceOf(ForbiddenException);
});

it('blocks non-demo non-admin users from demo preview admin routes', async () => {
  mocks.config.getEnv.mockReturnValue({
    ...mocks.config.getEnv(),
    demo: { enabled: true, email: 'demo@gallery.app', password: 'demo' },
  });
  mockSessionFor(nonDemoUser);

  await expect(authenticateAdmin('GET', '/api/admin/users')).rejects.toBeInstanceOf(ForbiddenException);
});

it('does not grant demo preview access when demo mode is off', async () => {
  mocks.config.getEnv.mockReturnValue({
    ...mocks.config.getEnv(),
    demo: { enabled: false, email: 'demo@gallery.app', password: 'demo' },
  });
  mockSessionFor(demoUser);

  await expect(authenticateAdmin('GET', '/api/admin/users')).rejects.toBeInstanceOf(ForbiddenException);
});
```

If `mocks.config.getEnv()` cannot be spread safely because the mock returns `undefined`, first capture a full default in `beforeEach`:

```ts
const env = mocks.config.getEnv();
mocks.config.getEnv.mockReturnValue({ ...env, demo: { enabled: true, email: 'demo@gallery.app', password: 'demo' } });
```

- [ ] **Step 2: Run auth tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/services/auth.service.spec.ts --testNamePattern "demo admin preview|should throw if admin route"
```

Expected: FAIL because `ValidateRequest.metadata.method` does not exist and non-admin demo users are still rejected from admin routes.

- [ ] **Step 3: Pass request method from `AuthGuard`**

Modify `server/src/services/auth.service.ts` `ValidateRequest` metadata:

```ts
metadata: {
  sharedLinkRoute: boolean;
  adminRoute: boolean;
  /** `false` explicitly means no permission is required, which otherwise defaults to `all` */
  permission?: Permission | false;
  uri: string;
  method: string;
};
```

Modify `server/src/middleware/auth.guard.ts`:

```ts
request.user = await this.authService.authenticate({
  headers: request.headers,
  queryParams: request.query as Record<string, string>,
  metadata: { adminRoute, sharedLinkRoute, permission, uri: request.path, method: request.method },
});
```

Update existing `sut.authenticate()` test calls in `server/src/services/auth.service.spec.ts` with `method: 'GET'` in metadata. Use a mechanical edit only for this file, then review the diff.

- [ ] **Step 4: Add demo preview allowlist implementation**

In `server/src/services/auth.service.ts`, add helpers near the top of the file after constants/imports:

```ts
const DEMO_ADMIN_PREVIEW_READ_ROUTES = [
  /^\/api\/admin\/users$/,
  /^\/api\/admin\/users\/[^/]+$/,
  /^\/api\/admin\/users\/[^/]+\/preferences$/,
  /^\/api\/admin\/users\/[^/]+\/statistics$/,
  /^\/api\/admin\/users\/[^/]+\/sessions$/,
  /^\/api\/libraries$/,
  /^\/api\/libraries\/[^/]+$/,
  /^\/api\/libraries\/[^/]+\/statistics$/,
  /^\/api\/jobs$/,
  /^\/api\/queues$/,
  /^\/api\/queues\/[^/]+$/,
  /^\/api\/queues\/[^/]+\/jobs$/,
  /^\/api\/system-config$/,
  /^\/api\/system-config\/defaults$/,
  /^\/api\/system-config\/storage-template-options$/,
  /^\/api\/system-metadata\/version-check-state$/,
  /^\/api\/server\/statistics$/,
];

const isDemoAdminPreviewReadRoute = (uri: string) => DEMO_ADMIN_PREVIEW_READ_ROUTES.some((route) => route.test(uri));
```

Then update `authenticate()` admin-route block:

```ts
if (!authDto.user.isAdmin && adminRoute) {
  const { demo } = this.configRepository.getEnv();
  const isDemoPreviewRead =
    demo.enabled &&
    authDto.user.email === demo.email &&
    metadata.method === 'GET' &&
    !authDto.apiKey &&
    !authDto.sharedLink &&
    isDemoAdminPreviewReadRoute(uri);

  if (!isDemoPreviewRead) {
    this.logger.warn(`Denied access to admin only route: ${uri}`);
    throw new ForbiddenException('Forbidden');
  }
}
```

This implements the simpler GET-only auth fallback. Mutating admin commands remain visible in the frontend but fail with `403 Forbidden`.

- [ ] **Step 5: Run auth tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/services/auth.service.spec.ts --testNamePattern "demo admin preview|should throw if admin route|validate - api key|validate - shared key"
```

Expected: PASS.

- [ ] **Step 6: Commit backend auth preview**

```bash
git add server/src/services/auth.service.ts server/src/services/auth.service.spec.ts server/src/middleware/auth.guard.ts
git commit -m "feat(demo): allow read-only admin preview auth"
```

## Task 2: DemoInterceptor Blocks Admin Writes In Demo Mode

**Files:**

- Modify: `server/src/middleware/demo.interceptor.spec.ts`
- Modify: `server/src/middleware/demo.interceptor.ts`

- [ ] **Step 1: Replace broad admin-bypass test with failing write-block tests**

In `server/src/middleware/demo.interceptor.spec.ts`, replace:

```ts
it('should allow all requests for admin users', () => {
  ...
});
```

with:

```ts
it('should block mutating requests for admin users in demo mode', () => {
  configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
  const context = createContext('DELETE', '/api/assets', { email: 'admin@test.com', isAdmin: true });

  expect(() => interceptor.intercept(context, callHandler)).toThrow(ForbiddenException);
  expect(callHandler.handle).not.toHaveBeenCalled();
});

it('should allow GET requests for admin users in demo mode', () => {
  configRepository.getEnv.mockReturnValue({ demo: { enabled: true, email: 'demo@test.com', password: '' } });
  const context = createContext('GET', '/api/admin/users', { email: 'admin@test.com', isAdmin: true });

  interceptor.intercept(context, callHandler);

  expect(callHandler.handle).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run interceptor tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/middleware/demo.interceptor.spec.ts
```

Expected: FAIL because admin users still bypass all demo restrictions.

- [ ] **Step 3: Remove broad admin bypass**

In `server/src/middleware/demo.interceptor.ts`, delete:

```ts
const isAdmin = request.user?.user?.isAdmin;
if (isAdmin) {
  return next.handle();
}
```

Keep the existing method and safe-prefix checks unchanged.

- [ ] **Step 4: Run interceptor tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/middleware/demo.interceptor.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit interceptor hardening**

```bash
git add server/src/middleware/demo.interceptor.ts server/src/middleware/demo.interceptor.spec.ts
git commit -m "fix(demo): block admin writes in demo mode"
```

## Task 3: Frontend Preview Capability And Admin Route Guard

**Files:**

- Add: `web/src/lib/managers/auth-manager.svelte.spec.ts`
- Modify: `web/src/lib/managers/auth-manager.svelte.ts`
- Add: `web/src/lib/utils/auth.spec.ts`
- Modify: `web/src/lib/utils/auth.ts`

- [ ] **Step 1: Write failing AuthManager capability tests**

Create `web/src/lib/managers/auth-manager.svelte.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { authManager } from './auth-manager.svelte';

const user = (isAdmin: boolean) =>
  ({
    id: 'user-1',
    email: 'demo@gallery.app',
    name: 'Demo User',
    isAdmin,
  }) as never;

describe('AuthManager demo admin preview', () => {
  afterEach(() => {
    authManager.isDemo = false;
    authManager.reset();
  });

  it('lets real admins preview admin', () => {
    authManager.setUser(user(true));
    authManager.setPreferences({} as never);

    expect(authManager.canPreviewAdmin).toBe(true);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });

  it('lets demo non-admin users preview admin without becoming admin', () => {
    authManager.isDemo = true;
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    expect(authManager.user.isAdmin).toBe(false);
    expect(authManager.canPreviewAdmin).toBe(true);
    expect(authManager.isReadOnlyDemo).toBe(true);
  });

  it('does not let normal non-admin users preview admin', () => {
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    expect(authManager.canPreviewAdmin).toBe(false);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });

  it('clears demo read-only status on reset', () => {
    authManager.isDemo = true;
    authManager.setUser(user(false));
    authManager.setPreferences({} as never);

    authManager.reset();

    expect(authManager.canPreviewAdmin).toBe(false);
    expect(authManager.isReadOnlyDemo).toBe(false);
  });
});
```

- [ ] **Step 2: Run AuthManager tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts
```

Expected: FAIL because `canPreviewAdmin` and `isReadOnlyDemo` do not exist.

- [ ] **Step 3: Implement AuthManager getters**

Add to `AuthManager` in `web/src/lib/managers/auth-manager.svelte.ts` after `get authenticated()`:

```ts
get canPreviewAdmin() {
  return !!this.#user && (this.#user.isAdmin || this.isDemo);
}

get isReadOnlyDemo() {
  return !!this.#user && this.isDemo && !this.#user.isAdmin;
}
```

- [ ] **Step 4: Run AuthManager tests and verify green**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing route guard tests**

Create `web/src/lib/utils/auth.spec.ts`:

```ts
import { redirect } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate } from './auth';

const mockAuthManager = vi.hoisted(() => ({
  authenticated: true,
  canPreviewAdmin: false,
  load: vi.fn(),
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    load: mockAuthManager.load,
    get authenticated() {
      return mockAuthManager.authenticated;
    },
    get canPreviewAdmin() {
      return mockAuthManager.canPreviewAdmin;
    },
  },
}));

vi.mock('@sveltejs/kit', () => ({
  redirect: vi.fn((status: number, location: string) => {
    throw Object.assign(new Error('redirect'), { status, location });
  }),
}));

describe('authenticate admin preview guard', () => {
  beforeEach(() => {
    mockAuthManager.authenticated = true;
    mockAuthManager.canPreviewAdmin = false;
    mockAuthManager.load.mockReset();
    vi.mocked(redirect).mockClear();
  });

  it('allows demo preview users into admin routes', async () => {
    mockAuthManager.canPreviewAdmin = true;

    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('allows real admins into admin routes', async () => {
    mockAuthManager.canPreviewAdmin = true;

    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects normal non-admin users away from admin routes', async () => {
    await expect(authenticate(new URL('https://gallery.test/admin/users'), { admin: true })).rejects.toMatchObject({
      status: 307,
      location: '/photos',
    });
  });

  it('redirects unauthenticated users to login before admin preview checks', async () => {
    mockAuthManager.authenticated = false;

    await expect(
      authenticate(new URL('https://gallery.test/admin/users?tab=all'), { admin: true }),
    ).rejects.toMatchObject({
      status: 307,
      location: '/auth/login?continue=%2Fadmin%2Fusers%3Ftab%3Dall',
    });
  });
});
```

- [ ] **Step 6: Run route guard tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/utils/auth.spec.ts
```

Expected: FAIL because `authenticate()` still checks `authManager.user.isAdmin`.

- [ ] **Step 7: Update route guard**

Modify `web/src/lib/utils/auth.ts`:

```ts
if (adminRoute && !authManager.canPreviewAdmin) {
  redirect(307, Route.photos());
}
```

- [ ] **Step 8: Run route guard and AuthManager tests**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts src/lib/utils/auth.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit frontend capability**

```bash
git add web/src/lib/managers/auth-manager.svelte.ts web/src/lib/managers/auth-manager.svelte.spec.ts web/src/lib/utils/auth.ts web/src/lib/utils/auth.spec.ts
git commit -m "feat(demo): add admin preview capability"
```

## Task 4: Global Search, Commands, And Recents Use Preview Capability

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/navigation-items.spec.ts`
- Modify: `web/src/lib/managers/navigation-items.ts`

- [ ] **Step 1: Update test auth mock shape**

In `web/src/lib/managers/global-search-manager.svelte.spec.ts`, change the hoisted `mockUser` shape:

```ts
mockUser: {
  current: { id: 'test-user', isAdmin: true },
  isDemo: false,
} as {
  current: { id: string; isAdmin: boolean } | null;
  isDemo: boolean;
},
```

Update the auth-manager mock:

```ts
authManager: {
  get authenticated() {
    return mockUser.current !== null;
  },
  get user() {
    return mockUser.current;
  },
  get canPreviewAdmin() {
    return !!mockUser.current && (mockUser.current.isAdmin || mockUser.isDemo);
  },
},
```

Update `afterEach()`:

```ts
mockUser.current = { id: 'test-user', isAdmin: true };
mockUser.isDemo = false;
```

- [ ] **Step 2: Add failing global search tests**

Add tests near existing admin filtering tests:

```ts
it('shows admin navigation results for demo preview users', async () => {
  mockUser.current = { id: 'demo-user', isAdmin: false };
  mockUser.isDemo = true;
  const manager = new GlobalSearchManager();

  manager.setQuery('users');
  await vi.advanceTimersByTimeAsync(150);

  expect(manager.sections.navigation.status).toBe('ok');
  expect((manager.sections.navigation as { items: { route: string }[] }).items.map((item) => item.route)).toContain(
    '/admin/users',
  );
});

it('shows admin command results for demo preview users', async () => {
  mockUser.current = { id: 'demo-user', isAdmin: false };
  mockUser.isDemo = true;
  const manager = new GlobalSearchManager();

  manager.setQuery('job');
  await vi.advanceTimersByTimeAsync(150);

  expect(manager.sections.commands.status).toBe('ok');
  expect((manager.sections.commands as { items: { adminOnly?: boolean }[] }).items.some((item) => item.adminOnly)).toBe(
    true,
  );
});

it('keeps admin navigation recents valid for demo preview users', () => {
  mockUser.current = { id: 'demo-user', isAdmin: false };
  mockUser.isDemo = true;
  resetRecentStore();
  addEntry({ kind: 'navigate', id: 'nav:admin:users', route: '/admin/users', adminOnly: true });
  const manager = new GlobalSearchManager();

  manager.activateRecent(getEntries()[0]);

  expect(getEntries()).toHaveLength(1);
});
```

Also add a route drift test to `web/src/lib/managers/navigation-items.spec.ts`:

```ts
it('uses the real server status route for server statistics navigation', () => {
  expect(NAVIGATION_ITEMS.find((item) => item.id === 'nav:admin:server-stats')?.route).toBe(Route.systemStatistics());
});
```

Import `Route` from `$lib/route` in that spec.

- [ ] **Step 3: Run global search tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/global-search-manager.svelte.spec.ts --testNamePattern "demo preview|admin navigation|admin command|admin recent"
pnpm --dir web exec vitest --run src/lib/managers/navigation-items.spec.ts --testNamePattern "server statistics navigation"
```

Expected: FAIL because global search still filters admin-only items by raw `isAdmin`, and the route drift test fails if `nav:admin:server-stats` still points at `/admin/system-statistics`.

- [ ] **Step 4: Implement preview-aware helper**

In `web/src/lib/managers/global-search-manager.svelte.ts`, add a small local helper near the manager class:

```ts
const canUseAdminSurface = () => authManager.canPreviewAdmin;
```

Replace these local patterns:

```ts
const isAdmin = (authManager.authenticated ? authManager.user : undefined)?.isAdmin ?? false;
if (item.adminOnly && !isAdmin) {
  continue;
}
```

with:

```ts
const canPreviewAdmin = canUseAdminSurface();
if (item.adminOnly && !canPreviewAdmin) {
  continue;
}
```

Apply the replacement in:

- `filterNavAndCommands()`
- `activateRecent()`
- `topNavigationMatch`
- `topCommandMatch`
- any other admin-only filtering in this file found by:

```bash
rg "adminOnly && !isAdmin|isAdmin =" web/src/lib/managers/global-search-manager.svelte.ts
```

Then fix `web/src/lib/managers/navigation-items.ts` if needed:

```ts
route: Route.systemStatistics(),
```

- [ ] **Step 5: Run global search tests and verify green**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/global-search-manager.svelte.spec.ts src/lib/managers/navigation-items.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit search preview**

```bash
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts web/src/lib/managers/navigation-items.ts web/src/lib/managers/navigation-items.spec.ts
git commit -m "feat(demo): show admin search results in preview mode"
```

## Task 5: Admin Entry And Read-Only Notice

**Files:**

- Modify: `web/src/lib/components/shared-components/navigation-bar/account-info-panel.svelte`
- Add: `web/src/lib/components/admin/ReadOnlyDemoNotice.svelte`
- Add: `web/src/lib/components/admin/ReadOnlyDemoNotice.spec.ts`
- Add or modify: `web/src/lib/components/shared-components/navigation-bar/account-info-panel.spec.ts` if local component mocks stay small.
- Modify: exposed admin page components:
  - `web/src/routes/admin/server-status/+page.svelte`
  - `web/src/routes/admin/users/(list)/+layout.svelte`
  - `web/src/routes/admin/queues/+page.svelte`
  - `web/src/routes/admin/system-settings/+page.svelte`
  - `web/src/routes/admin/library-management/(list)/+layout.svelte`

- [ ] **Step 1: Add failing UI preview tests**

Add `web/src/lib/components/admin/ReadOnlyDemoNotice.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ReadOnlyDemoNotice from './ReadOnlyDemoNotice.svelte';

const mockAuthManager = vi.hoisted(() => ({
  isReadOnlyDemo: false,
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

describe('ReadOnlyDemoNotice', () => {
  afterEach(() => {
    mockAuthManager.isReadOnlyDemo = false;
  });

  it('renders the read-only demo notice for demo preview users', () => {
    mockAuthManager.isReadOnlyDemo = true;

    render(ReadOnlyDemoNotice);

    expect(screen.getByText('Read-only demo')).toBeInTheDocument();
    expect(screen.getByText(/Changes are disabled/i)).toBeInTheDocument();
  });

  it('does not render for normal users and real admins', () => {
    render(ReadOnlyDemoNotice);

    expect(screen.queryByText('Read-only demo')).not.toBeInTheDocument();
  });
});
```

If `account-info-panel.svelte` can be rendered with small local mocks, add a focused test that proves the Administration link is visible when `authManager.canPreviewAdmin` is true and `authManager.user.isAdmin` is false. If mocking that component pulls in modal/avatar/i18n complexity, rely on the AuthManager route/search tests plus this notice component test, and keep the plan scoped.

- [ ] **Step 2: Run UI preview tests and verify red**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/components/admin/ReadOnlyDemoNotice.spec.ts
```

Expected: FAIL because `ReadOnlyDemoNotice.svelte` does not exist yet.

- [ ] **Step 3: Update account menu admin condition**

In `web/src/lib/components/shared-components/navigation-bar/account-info-panel.svelte`, replace:

```svelte
{#if authManager.user.isAdmin}
```

with:

```svelte
{#if authManager.canPreviewAdmin}
```

Only change the menu/link visibility. Leave edit or authority decisions elsewhere on `user.isAdmin`.

- [ ] **Step 4: Add reusable read-only notice**

Create `web/src/lib/components/admin/ReadOnlyDemoNotice.svelte`:

```svelte
<script lang="ts">
  import { authManager } from '$lib/managers/auth-manager.svelte';
</script>

{#if authManager.isReadOnlyDemo}
  <div class="rounded-md border border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-950 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-100">
    <p class="font-medium">Read-only demo</p>
    <p>Admin controls are visible for evaluation. Changes are disabled in this public demo.</p>
  </div>
{/if}
```

- [ ] **Step 5: Run notice tests and verify green**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/components/admin/ReadOnlyDemoNotice.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Render notice on first-pass admin pages**

Import and place `<ReadOnlyDemoNotice />` near the top of each exposed page:

```svelte
import ReadOnlyDemoNotice from '$lib/components/admin/ReadOnlyDemoNotice.svelte';
```

Add it below the page title/header area in:

- `web/src/routes/admin/server-status/+page.svelte`
- `web/src/routes/admin/users/(list)/+layout.svelte`
- `web/src/routes/admin/queues/+page.svelte`
- `web/src/routes/admin/system-settings/+page.svelte`
- `web/src/routes/admin/library-management/(list)/+layout.svelte`

- [ ] **Step 7: Cheaply gate obvious page actions**

Only gate local, obvious action buttons on exposed pages. Do not chase command-palette actions.

Examples:

```svelte
{#if !authManager.isReadOnlyDemo}
  <Button ...>Create</Button>
{/if}
```

or:

```svelte
<Button disabled={authManager.isReadOnlyDemo} ...>
```

Use this for:

- create user button in `users/(list)/+layout.svelte`
- create/run job controls in `queues/+page.svelte` if directly rendered there
- save settings action in `system-settings/+page.svelte` if directly rendered there
- create library button in `library-management/(list)/+layout.svelte`

- [ ] **Step 8: Run focused frontend tests and build**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts src/lib/utils/auth.spec.ts src/lib/managers/global-search-manager.svelte.spec.ts src/lib/components/admin/ReadOnlyDemoNotice.spec.ts
pnpm --dir web build
```

Expected: tests PASS and build PASS. Existing Svelte warnings are acceptable if they match the current baseline.

- [ ] **Step 9: Commit UI preview polish**

```bash
git add web/src/lib/components/shared-components/navigation-bar/account-info-panel.svelte web/src/lib/components/admin/ReadOnlyDemoNotice.svelte web/src/lib/components/admin/ReadOnlyDemoNotice.spec.ts web/src/routes/admin/server-status/+page.svelte web/src/routes/admin/users/\\(list\\)/+layout.svelte web/src/routes/admin/queues/+page.svelte web/src/routes/admin/system-settings/+page.svelte web/src/routes/admin/library-management/\\(list\\)/+layout.svelte
git commit -m "feat(demo): show read-only admin preview UI"
```

## Task 6: Full Verification And Demo Rebuild Readiness

**Files:**

- No planned production edits unless tests reveal a bug.

- [ ] **Step 1: Run backend demo/security tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/services/auth.service.spec.ts src/middleware/demo.interceptor.spec.ts src/services/auth.service.demo.spec.ts src/services/server.service.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run frontend preview/search tests**

Run:

```bash
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts src/lib/utils/auth.spec.ts src/lib/managers/global-search-manager.svelte.spec.ts src/lib/managers/navigation-items.spec.ts src/routes/auth/login/page.spec.ts
pnpm --dir web exec vitest --run src/lib/components/admin/ReadOnlyDemoNotice.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run production builds**

Run:

```bash
pnpm --dir server build
pnpm --dir web build
```

Expected: PASS.

- [ ] **Step 4: Check no real-admin mutation path was introduced**

Run:

```bash
rg "isAdmin\\).*next.handle|authManager.user.isAdmin \\|\\| authManager.isDemo|Permission.All" server/src web/src
```

Expected:

- No broad `isAdmin` bypass in `DemoInterceptor`.
- No code sets demo users to admin.
- No demo preview path grants `Permission.All`.

- [ ] **Step 5: Manual local smoke with dev server if available**

If the dev stack is running, log in as demo and verify:

```text
/admin/server-status loads
/admin/users loads
/admin/queues loads
/admin/system-settings loads
/admin/library-management loads
global search for "users" shows /admin/users
global search for "queue" shows admin queue entries
settings save or queue mutation fails server-side
```

If the dev stack is not running, skip local browser smoke and rely on live demo smoke after deploy.

- [ ] **Step 6: Commit verification fixes after a failed check**

When verification reveals a code issue, fix it, then run:

```bash
git add server/src/services/auth.service.ts server/src/services/auth.service.spec.ts server/src/middleware/demo.interceptor.ts server/src/middleware/demo.interceptor.spec.ts web/src/lib/managers/auth-manager.svelte.ts web/src/lib/utils/auth.ts web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/navigation-items.ts web/src/lib/components/admin/ReadOnlyDemoNotice.svelte web/src/lib/components/admin/ReadOnlyDemoNotice.spec.ts
git commit -m "fix(demo): harden admin preview verification"
```

When verification does not reveal a code issue, do not create an empty commit.

## Task 7: Consolidate, Rebase Demo Branch, And Deploy

**Files:**

- Uses skill: `rebase-demo-branch`
- Uses skill: `deploy-gallery-demo`
- No manual code edits expected.

- [ ] **Step 1: Consolidate local implementation commits into one demo commit**

The demo branch is maintained as `origin/main` plus one demo rebuild commit. If Tasks 1-6 created multiple local commits, preserve a backup branch and squash them before pushing:

```bash
git fetch origin main demo --tags --force
git status --short
git branch demo-admin-preview-backup HEAD
git reset --soft origin/main
git commit -m "chore(demo): rebuild demo branch from main + cherry-picked demo commits"
```

Expected:

- `demo-admin-preview-backup` preserves the pre-squash implementation history.
- `git log --oneline origin/main..HEAD` shows exactly one demo commit.
- The one demo commit includes the existing demo infrastructure, unnamed-person hiding behavior, banner layout fixes, and the new read-only admin preview changes.

- [ ] **Step 2: Rebuild demo branch from latest main**

Follow the `rebase-demo-branch` skill. Only remove/recreate `.worktrees/demo-rebuild` after Step 1 has created the backup branch and `git status --short` is clean. Important checks:

```bash
cd /home/pierre/dev/gallery
git fetch origin main demo --tags --force
git worktree remove .worktrees/demo-rebuild 2>/dev/null || true
git branch -D demo-rebuild 2>/dev/null || true
git worktree add .worktrees/demo-rebuild -b demo-rebuild origin/main
cd .worktrees/demo-rebuild
git cherry-pick origin/demo
```

If the read-only admin preview work was created on a separate backup or feature branch instead of already being included in `origin/demo`, cherry-pick or squash that work into the demo rebuild before verification. Resolve conflicts by preserving:

- existing demo infrastructure
- unnamed-person hidden behavior
- demo install banner layout fixes
- new read-only admin preview changes

After conflict resolution, re-check:

```bash
git log --oneline origin/main..HEAD
```

Expected: exactly one demo commit before force-pushing.

- [ ] **Step 3: Regenerate OpenAPI if backend DTO/routes changed**

If Task 1 only changes auth behavior and no DTO/openapi metadata, OpenAPI should not change. Still run a check:

```bash
git diff --name-only HEAD^..HEAD | rg 'server/src/dtos|server/src/controllers|open-api|mobile/openapi' || true
```

If controller/DTO/OpenAPI files changed, run:

```bash
make open-api
```

Use the temporary `wget` shim if the environment still lacks `wget`.

- [ ] **Step 4: Run demo branch verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm --dir server build
pnpm --dir server exec vitest --config test/vitest.config.mjs --run src/services/auth.service.spec.ts src/middleware/demo.interceptor.spec.ts src/services/auth.service.demo.spec.ts src/services/server.service.spec.ts
pnpm --dir web exec vitest --run src/lib/managers/auth-manager.svelte.spec.ts src/lib/utils/auth.spec.ts src/lib/managers/global-search-manager.svelte.spec.ts src/lib/managers/navigation-items.spec.ts src/lib/components/admin/ReadOnlyDemoNotice.spec.ts src/routes/auth/login/page.spec.ts
pnpm --dir web build
```

Expected: PASS.

- [ ] **Step 5: Force-push demo branch**

```bash
git branch -D demo-backup 2>/dev/null || true
git branch demo-backup origin/demo
git push origin demo-rebuild:demo --force
git -C /home/pierre/dev/gallery branch -f demo HEAD
```

- [ ] **Step 6: Deploy demo**

Run:

```bash
cd /home/pierre/dev/open-noodle
./scripts/deploy-demo.sh
```

Expected:

- Builds a tag like `demo-v<current-version>-<n>`.
- Pushes GHCR image.
- Commits/pushes GitOps pin.
- ArgoCD rollout succeeds.

- [ ] **Step 7: Live verification**

Run:

```bash
KUBECONFIG=$HOME/.kube/noodle-k3s.yaml kubectl -n demo rollout status deploy/gallery-server --timeout=180s
KUBECONFIG=$HOME/.kube/noodle-k3s.yaml kubectl -n demo get deploy gallery-server -o jsonpath='{.spec.template.spec.containers[0].image}{"\n"}{.status.readyReplicas}{"/"}{.status.replicas}{" ready\n"}'
curl -fsS https://demo.opennoodle.de/api/server/config | jq '{demoMode, demoAutoLogin, isInitialized, isOnboarded}'
```

Browser smoke:

```text
Open https://demo.opennoodle.de/admin/users
Open https://demo.opennoodle.de/admin/queues
Open https://demo.opennoodle.de/admin/system-settings
Search for "users", "jobs", "settings", and "queues"
Execute one mutating admin command and confirm it fails
Confirm no state changed after the failed command
```

- [ ] **Step 8: Verify unnamed people stayed hidden**

Run:

```bash
token=$(curl -fsS -X POST https://demo.opennoodle.de/api/auth/demo-login | jq -r '.accessToken')
curl -fsS -H "Authorization: Bearer $token" 'https://demo.opennoodle.de/api/people?withHidden=false' | jq '{total, hidden, names: [.people[].name], unnamed: ([.people[] | select((.name // "") | gsub("\\s"; "") == "")] | length)}'
curl -fsS -H "Authorization: Bearer $token" 'https://demo.opennoodle.de/api/shared-spaces/3c5807bd-748a-49c6-8cdc-55be96d14dd2/people' | jq '{total: length, names: map(.name), unnamed: ([.[] | select((.name // "") | gsub("\\s"; "") == "")] | length)}'
```

Expected:

```text
unnamed: 0
```

## Self-Review Checklist

- [ ] Spec requirement: demo user remains non-admin. Covered by Task 1, Task 3, Task 6.
- [ ] Spec requirement: selected admin pages load. Covered by Task 1, Task 3, Task 5, Task 7.
- [ ] Spec requirement: admin search/commands visible. Covered by Task 4 and Task 7.
- [ ] Spec requirement: mutating admin commands fail server-side. Covered by Task 1, Task 2, Task 4, Task 7.
- [ ] Spec requirement: no secrets/backups/license/maintenance exposure in first pass. Covered by Task 1 allowlist and tests.
- [ ] Spec requirement: TDD. Every implementation task starts with failing tests and expected red/green commands.
- [ ] No placeholders: all steps have concrete files, commands, and expected behavior.
