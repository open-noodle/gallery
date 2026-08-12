# Demo Face Repair Read-Only Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin Face Repair console a working, read-only exhibit for the demo user — reads allowed, every mutation still refused.

**Architecture:** Two independent halves. Server-side, eight anchored regexes are added to the GET-only `DEMO_ADMIN_PREVIEW_READ_ROUTES` allowlist so the non-admin demo user can read face-repair data. Client-side, each mutating control is hidden behind `authManager.isReadOnlyDemo` and each page gains a `<ReadOnlyDemoNotice />`, matching the five admin consoles already gated this way. `DemoInterceptor` is not touched.

**Tech Stack:** NestJS 11 + Kysely (server), SvelteKit + Svelte 5 runes (web), Vitest + @testing-library/svelte.

## Global Constraints

- Branch is `demo`. This never merges to `main`. Do not modify `server/src/config.ts`.
- `DemoInterceptor` (`server/src/middleware/demo.interceptor.ts`) must not be modified.
- Every allowlist regex is fully anchored `^…$`. A prefix match would expose the write half.
- `isReadOnlyDemo` hides controls; `canPreviewAdmin` opens routes. Never use `canPreviewAdmin` to hide a control — it would hide it from real admins too.
- Web specs must assert **both** branches (control present when `isReadOnlyDemo` is false, absent when true). A one-sided assertion passes even if the gate is deleted.
- `web/` vitest does not clear mocks between tests. Reset `mockAuthManager.isReadOnlyDemo` in `beforeEach`.
- Prettier is a separate CI gate from eslint. Run it before each commit.

## Already done — do not redo

Section 3 of the spec (seed a real scan through Redis) **was executed on 2026-08-12** against the live
demo database. `face_repair_scan` holds a completed scan `019ff76f-68be-7368-8784-4b58dc854876` with 41
flagged faces / 28 affected people / 8 to repair / 24 review-only. No task below touches demo data. If
the console renders empty after deploying, re-read spec §3 — do not invent new seed data.

## Spec harness note

Tasks 2, 4, 5 and 6 each reference a local `renderX()` helper. These are **not shared** — every spec
file defines its own, following `web/src/routes/admin/maintenance/maintenance-page.spec.ts` verbatim:
the hoisted `mockAuthManager`, the `$lib/managers/auth-manager.svelte` mock with an `isReadOnlyDemo`
getter, the `$lib/components/layouts/AdminPageLayout.svelte` → `@test-data/mocks/admin-page-layout.stub.svelte`
mock, and per-page `@immich/sdk` mocks resolving the minimum data for one row to render. Open that file
first and copy its top 45 lines before writing anything else.

---

### Task 1: Server — allowlist the face-repair reads

**Files:**

- Modify: `server/src/services/auth.service.ts:51-75` (the `DEMO_ADMIN_PREVIEW_READ_ROUTES` array)
- Test: `server/src/services/auth.service.spec.ts:640-716` (the existing `describe('demo admin preview')` block)

**Interfaces:**

- Consumes: existing spec helpers `setDemoMode(boolean)`, `mockSessionFor(user)`, `authenticateAdmin(method, uri)` — already defined in that spec file.
- Produces: nothing consumed by later tasks. Task 2-6 are independent of this one.

- [ ] **Step 1: Write the failing tests**

In `auth.service.spec.ts`, add the eight URIs to the existing `it.each([...])` allow-list array (the one ending `'/api/admin/database-backups',`):

```ts
'/api/admin/face-repair/scan/latest',
'/api/admin/face-repair/scan/defaults',
'/api/admin/face-repair/scan/person/person-id',
'/api/admin/face-repair/person/person-id',
'/api/admin/face-repair/decline',
'/api/admin/face-repair/resolutions',
'/api/admin/face-repair/owner/owner-id/people',
'/api/admin/face-repair/faces/asset-face-id/thumbnail',
```

Then add a new negative block immediately after the existing file-serving-sub-route `it.each`:

```ts
// The face-repair allowlist is read-only by construction: the preview branch requires
// metadata.method === 'GET' before the regex is consulted. These are the same paths as the
// allowlisted reads above, and they must still be refused when the method mutates.
it.each([
  ['POST', '/api/admin/face-repair/scan'],
  ['POST', '/api/admin/face-repair/resolve'],
  ['POST', '/api/admin/face-repair/decline'],
  ['DELETE', '/api/admin/face-repair/decline'],
  ['POST', '/api/admin/face-repair/unconfirm'],
  ['POST', '/api/admin/face-repair/resolutions/remove'],
  ['POST', '/api/admin/face-repair/owner/owner-id/people'],
  ['POST', '/api/admin/face-repair/scan/person/person-id/cluster-faces'],
])('blocks the demo user from %s %s', async (method, uri) => {
  setDemoMode(true);
  mockSessionFor(demoUser);

  await expect(authenticateAdmin(method, uri)).rejects.toBeInstanceOf(ForbiddenException);
});

it('blocks the demo user from an unanchored face-repair path', async () => {
  setDemoMode(true);
  mockSessionFor(demoUser);

  await expect(authenticateAdmin('GET', '/api/admin/face-repair/resolutions/export')).rejects.toBeInstanceOf(
    ForbiddenException,
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && npx vitest run --config test/vitest.config.mjs src/services/auth.service.spec.ts
```

Expected: the eight new allow-list cases FAIL with `ForbiddenException`. The negative cases already pass (nothing is allowlisted yet) — that is correct; they are regression guards, not drivers.

- [ ] **Step 3: Add the allowlist entries**

In `auth.service.ts`, insert immediately before the closing `];` of `DEMO_ADMIN_PREVIEW_READ_ROUTES`:

```ts
  // Face Repair console (demo read-only preview). Anchored like every entry above. The write half of
  // `admin/face-repair` (scan, resolve, decline, unconfirm, cluster-faces, resolutions/remove, and the
  // POST twin of owner/:id/people) is unreachable here regardless: the preview branch below requires
  // `metadata.method === 'GET'` before these regexes are tested, and DemoInterceptor refuses it again.
  // `faces/:assetFaceId/thumbnail` is a file-serving route and is opened deliberately — unlike the
  // maintenance sub-routes it returns a face crop of a photo already public on the demo instance, and
  // without it the console renders as empty grey tiles.
  /^\/api\/admin\/face-repair\/scan\/latest$/,
  /^\/api\/admin\/face-repair\/scan\/defaults$/,
  /^\/api\/admin\/face-repair\/scan\/person\/[^/]+$/,
  /^\/api\/admin\/face-repair\/person\/[^/]+$/,
  /^\/api\/admin\/face-repair\/decline$/,
  /^\/api\/admin\/face-repair\/resolutions$/,
  /^\/api\/admin\/face-repair\/owner\/[^/]+\/people$/,
  /^\/api\/admin\/face-repair\/faces\/[^/]+\/thumbnail$/,
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && npx vitest run --config test/vitest.config.mjs src/services/auth.service.spec.ts src/services/auth.service.demo.spec.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Format and commit**

```bash
cd server && npx prettier --write src/services/auth.service.ts src/services/auth.service.spec.ts
cd .. && git add server/src/services/auth.service.ts server/src/services/auth.service.spec.ts
git commit -m "feat(demo): allow the demo user to read the face-repair console"
```

---

### Task 2: Web — gate the scan page's Rescan and Advanced buttons

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/+page.svelte`
- Create: `web/src/routes/admin/face-cleanup/scan/scan-page.demo.spec.ts`

**Interfaces:**

- Consumes: `authManager.isReadOnlyDemo` (boolean, `web/src/lib/managers/auth-manager.svelte.ts`); `ReadOnlyDemoNotice` (`$lib/components/admin/ReadOnlyDemoNotice.svelte`, no props).
- Produces: the `isReadOnlyDemo` `$derived` local, reused by no other task (each file declares its own).

- [ ] **Step 1: Write the failing test**

Create `scan-page.demo.spec.ts`. Mirror the harness in `web/src/routes/admin/maintenance/maintenance-page.spec.ts`: hoisted `mockAuthManager`, the `auth-manager.svelte` mock exposing `isReadOnlyDemo` via a getter, and the `AdminPageLayout` stub mock. Mock `@immich/sdk`'s `getLatestScan` to resolve a finished scan so the header renders:

```ts
const mockAuthManager = vi.hoisted(() => ({ isReadOnlyDemo: false }));

vi.mock('$lib/managers/auth-manager.svelte', () => ({
  authManager: {
    get isReadOnlyDemo() {
      return mockAuthManager.isReadOnlyDemo;
    },
  },
}));

beforeEach(() => {
  mockAuthManager.isReadOnlyDemo = false; // web vitest does not clear mocks between tests
});

describe('face-cleanup scan page — read-only demo', () => {
  it('shows Rescan and Advanced to a real admin', async () => {
    await renderScanPage();
    expect(screen.queryByRole('button', { name: /re-scan|run first scan/i })).not.toBeNull();
    expect(screen.queryByRole('button', { name: /advanced/i })).not.toBeNull();
  });

  it('hides Rescan and Advanced in read-only demo mode', async () => {
    mockAuthManager.isReadOnlyDemo = true;
    await renderScanPage();
    expect(screen.queryByRole('button', { name: /re-scan|run first scan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /advanced/i })).toBeNull();
  });

  it('renders the read-only notice in demo mode only', async () => {
    await renderScanPage();
    expect(screen.queryByTestId('read-only-demo-notice')).toBeNull();
  });
});
```

**Confirmed 2026-08-12:** `ReadOnlyDemoNotice.svelte` has no `data-testid`. Add
`data-testid="read-only-demo-notice"` to its root `<div>` (the one inside `{#if isReadOnlyDemo}`) as part
of this step — Tasks 4 and 6 assert on it. Do not change its self-gating `{#if}`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/scan/scan-page.demo.spec.ts
```

Expected: the "hides…" case FAILS — both buttons are still rendered.

- [ ] **Step 3: Implement the gate**

In `scan/+page.svelte`, add to the imports:

```ts
import ReadOnlyDemoNotice from '$lib/components/admin/ReadOnlyDemoNotice.svelte';
import { authManager } from '$lib/managers/auth-manager.svelte';
```

Add near the other `$derived` declarations:

```ts
const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);
```

Wrap the Advanced and Rescan `<Button>` elements (the pair after the `View resolutions` button and its divider) in a single block, keeping the divider inside so it does not dangle:

```svelte
{#if !isReadOnlyDemo}
  <div class="mx-0.5 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true"></div>
  <!-- existing Advanced <Button> ... -->
  <!-- existing Rescan <Button> ... -->
{/if}
```

Render `<ReadOnlyDemoNotice />` as the first child of the page's content container, matching `web/src/routes/admin/queues/+page.svelte:46`.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/scan/scan-page.demo.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
cd web && npx prettier --write src/routes/admin/face-cleanup/scan/+page.svelte src/routes/admin/face-cleanup/scan/scan-page.demo.spec.ts src/lib/components/admin/ReadOnlyDemoNotice.svelte
cd .. && git add web/src/routes/admin/face-cleanup/scan web/src/lib/components/admin/ReadOnlyDemoNotice.svelte
git commit -m "feat(demo): hide face-repair scan actions in read-only demo"
```

---

### Task 3: Web — gate the two triage lanes

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/scan/ConfidentLane.svelte` (approve button, ~line 56)
- Modify: `web/src/routes/admin/face-cleanup/scan/ReviewFirstLane.svelte` (dismiss button, ~line 236)
- Create: `web/src/routes/admin/face-cleanup/scan/lanes.demo.spec.ts`

**Interfaces:**

- Consumes: `authManager.isReadOnlyDemo`. Both lanes read it directly rather than taking a prop — the same way `web/src/lib/components/maintenance/MaintenanceBackupEntry.svelte` does. Do not add a prop; the parent already passes `model`/`people` and threading a flag through would diverge from the established pattern.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `lanes.demo.spec.ts` using the same hoisted-`mockAuthManager` harness as Task 2. Render each lane directly with a minimal fixture (one person, one flagged face) and assert both branches:

```ts
it('ConfidentLane shows the approve action to a real admin', () => {
  render(ConfidentLane, { props: { model: laneModel(), applying: false, onApprove: vi.fn() } });
  expect(screen.queryByRole('button', { name: /apply|approve/i })).not.toBeNull();
});

it('ConfidentLane hides the approve action in read-only demo mode', () => {
  mockAuthManager.isReadOnlyDemo = true;
  render(ConfidentLane, { props: { model: laneModel(), applying: false, onApprove: vi.fn() } });
  expect(screen.queryByRole('button', { name: /apply|approve/i })).toBeNull();
});

it('ReviewFirstLane shows the dismiss action to a real admin', () => {
  render(ReviewFirstLane, { props: { people: [reviewPerson()], users: [], onDismiss: vi.fn() } });
  expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeNull();
});

it('ReviewFirstLane hides the dismiss action in read-only demo mode', () => {
  mockAuthManager.isReadOnlyDemo = true;
  render(ReviewFirstLane, { props: { people: [reviewPerson()], users: [], onDismiss: vi.fn() } });
  expect(screen.queryByRole('button', { name: /dismiss/i })).toBeNull();
});
```

Build `laneModel()` / `reviewPerson()` from the real prop types — read the `Props` type at the top of each lane and construct the minimum that renders one row. Do not cast to `any`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/scan/lanes.demo.spec.ts
```

Expected: both "hides…" cases FAIL.

- [ ] **Step 3: Implement the gates**

In each lane add:

```ts
import { authManager } from '$lib/managers/auth-manager.svelte';

const isReadOnlyDemo = $derived(authManager.isReadOnlyDemo);
```

Wrap `ConfidentLane`'s approve `<Button onclick={onApprove}>` and `ReviewFirstLane`'s dismiss `<Button onclick={() => handleDismiss(person)}>` in `{#if !isReadOnlyDemo}…{/if}`.

Leave `model.toggleExcluded` (ConfidentLane ~line 116) alone: it mutates local selection state only, never the server, and hiding it would strip the per-person detail affordance the exhibit is meant to show.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/scan/lanes.demo.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
cd web && npx prettier --write "src/routes/admin/face-cleanup/scan/*.svelte" src/routes/admin/face-cleanup/scan/lanes.demo.spec.ts
cd .. && git add web/src/routes/admin/face-cleanup/scan
git commit -m "feat(demo): hide face-repair lane actions in read-only demo"
```

---

### Task 4: Web — gate the resolutions Undo button

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/resolutions/+page.svelte` (undo button, ~line 328)
- Create: `web/src/routes/admin/face-cleanup/resolutions/resolutions-page.demo.spec.ts`

**Interfaces:**

- Consumes: `authManager.isReadOnlyDemo`, `ReadOnlyDemoNotice`. The undo button already carries `data-testid="undo-button"` — assert on that, not on its label.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Same harness as Task 2. Mock the SDK's resolutions fetch to return one item so a row renders:

```ts
it('shows Undo to a real admin', async () => {
  await renderResolutionsPage();
  expect(screen.queryByTestId('undo-button')).not.toBeNull();
});

it('hides Undo in read-only demo mode', async () => {
  mockAuthManager.isReadOnlyDemo = true;
  await renderResolutionsPage();
  expect(screen.queryByTestId('undo-button')).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/resolutions/resolutions-page.demo.spec.ts
```

Expected: the "hides Undo" case FAILS.

- [ ] **Step 3: Implement the gate**

Add the `authManager` import, the `isReadOnlyDemo` `$derived`, wrap the undo `<Button>` in `{#if !isReadOnlyDemo}…{/if}`, and render `<ReadOnlyDemoNotice />` at the top of the content container.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/resolutions/resolutions-page.demo.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
cd web && npx prettier --write src/routes/admin/face-cleanup/resolutions/+page.svelte src/routes/admin/face-cleanup/resolutions/resolutions-page.demo.spec.ts
cd .. && git add web/src/routes/admin/face-cleanup/resolutions
git commit -m "feat(demo): hide face-repair undo in read-only demo"
```

---

### Task 5: Web — gate the per-person Apply action

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/[personId]/+page.svelte` (apply button, ~line 948, inside the `{#snippet apply()}` block of the `footer` snippet)
- Create: `web/src/routes/admin/face-cleanup/[personId]/person-page.demo.spec.ts`

**Interfaces:**

- Consumes: `authManager.isReadOnlyDemo`. The apply button already carries `data-testid="apply-btn"`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
it('shows Apply to a real admin', async () => {
  await renderPersonPage();
  expect(screen.queryByTestId('apply-btn')).not.toBeNull();
});

it('hides Apply in read-only demo mode', async () => {
  mockAuthManager.isReadOnlyDemo = true;
  await renderPersonPage();
  expect(screen.queryByTestId('apply-btn')).toBeNull();
});
```

This page renders its action bar through `AdminPageLayout`'s `footer` snippet, so the spec must use the shared `@test-data/mocks/admin-page-layout.stub.svelte` — that stub renders `footer`. Using a different stub silently drops the whole bar and both assertions become meaningless.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run "src/routes/admin/face-cleanup/[personId]/person-page.demo.spec.ts"
```

Expected: the "hides Apply" case FAILS.

- [ ] **Step 3: Implement the gate**

Add the `authManager` import and `isReadOnlyDemo` `$derived`, then wrap the apply `<Button …data-testid="apply-btn">` in `{#if !isReadOnlyDemo}…{/if}`. Keep the surrounding `{#snippet apply()}` intact — gate the button, not the snippet, so the footer layout does not collapse.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run "src/routes/admin/face-cleanup/[personId]/person-page.demo.spec.ts"
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
cd web && npx prettier --write "src/routes/admin/face-cleanup/[personId]/+page.svelte" "src/routes/admin/face-cleanup/[personId]/person-page.demo.spec.ts"
cd .. && git add "web/src/routes/admin/face-cleanup/[personId]"
git commit -m "feat(demo): hide face-repair apply in read-only demo"
```

---

### Task 6: Web — notices on the overview and people pages

**Files:**

- Modify: `web/src/routes/admin/face-cleanup/+page.svelte`
- Modify: `web/src/routes/admin/face-cleanup/people/+page.svelte`
- Create: `web/src/routes/admin/face-cleanup/overview.demo.spec.ts`

**Interfaces:**

- Consumes: `ReadOnlyDemoNotice`, and the `data-testid="read-only-demo-notice"` added in Task 2.
- Produces: nothing.

Both pages are already read-only (their buttons are `href` navigation and retry/load-more). They need the notice only, so a visitor understands why the actions elsewhere are missing.

- [ ] **Step 1: Write the failing test**

```ts
it('renders the read-only notice on the overview in demo mode', async () => {
  mockAuthManager.isReadOnlyDemo = true;
  await renderOverview();
  expect(screen.queryByTestId('read-only-demo-notice')).not.toBeNull();
});

it('omits the notice for a real admin', async () => {
  await renderOverview();
  expect(screen.queryByTestId('read-only-demo-notice')).toBeNull();
});
```

**Confirmed 2026-08-12:** `ReadOnlyDemoNotice.svelte` already self-gates — its whole body sits inside
`{#if isReadOnlyDemo}` (line 7). Render it unconditionally at every call site; do **not** wrap it in a
second `{#if}`.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/overview.demo.spec.ts
```

Expected: the "renders…" case FAILS.

- [ ] **Step 3: Add the notices**

Add the `ReadOnlyDemoNotice` import and render it as the first child of each page's content container.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd web && npx vitest run src/routes/admin/face-cleanup/overview.demo.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Format and commit**

```bash
cd web && npx prettier --write src/routes/admin/face-cleanup/+page.svelte src/routes/admin/face-cleanup/people/+page.svelte src/routes/admin/face-cleanup/overview.demo.spec.ts
cd .. && git add web/src/routes/admin/face-cleanup
git commit -m "feat(demo): note read-only mode on the face-repair overview"
```

---

### Task 7: Full verification, build, deploy

**Files:** none modified.

- [ ] **Step 1: Full server suite**

```bash
cd server && npx vitest run --config test/vitest.config.mjs 2>&1 | tail -5
```

Expected: exactly **11 pre-existing failures** across `pet-detection.service.spec.ts` (6), `system-config.service.spec.ts` (4), `search.service.spec.ts` (1). Any twelfth failure is yours — fix it. See `rebase-demo-branch` step 8 for why these three are expected on demo.

- [ ] **Step 2: Full web suite**

```bash
cd web && npx vitest run 2>&1 | grep -E "Test Files|Tests " | tail -3
```

Expected: 0 failures. The face-cleanup specs that already existed must stay green — they run with `isReadOnlyDemo` false.

- [ ] **Step 3: Prettier gate**

```bash
git diff --name-only origin/main..HEAD -- 'server/**/*.ts' | sed 's|^server/||' | (cd server && xargs npx prettier --check)
git diff --name-only origin/main..HEAD -- 'web/**/*.ts' 'web/**/*.svelte' | sed 's|^web/||' | (cd web && xargs npx prettier --check)
```

Expected: "All matched files use Prettier code style!"

- [ ] **Step 4: Push and build**

```bash
git push origin HEAD:demo
gh --repo open-noodle/gallery workflow run gallery-rc-build.yml --ref demo -f rc_tag=demo-v5.4.0-2 -f fork_version=5.4.0
```

- [ ] **Step 5: Deploy**

Wait until at least 30 minutes after the previous demo rollout (19:09 UTC on 2026-08-12), then:

```bash
cd ~/dev/platform && ./scripts/deploy-demo.sh --rollback v5.4.0-2
```

- [ ] **Step 6: Verify live**

```bash
TOKEN=$(curl -s -X POST https://demo.opennoodle.de/api/auth/demo-login -H 'Content-Type: application/json' -d '{}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')
for p in scan/latest scan/defaults resolutions decline; do
  curl -s -o /dev/null -w "GET $p -> %{http_code}\n" "https://demo.opennoodle.de/api/admin/face-repair/$p" -H "Authorization: Bearer $TOKEN"
done
curl -s -o /dev/null -w 'POST scan -> %{http_code}\n' -X POST https://demo.opennoodle.de/api/admin/face-repair/scan \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

Expected: the four GETs return **200**, the POST returns **403**. Before this change all four GETs returned 403 while `/api/queues` returned 200 — that contrast is the baseline.

- [ ] **Step 7: Advisory-lock check**

```bash
export KUBECONFIG=~/.kube/noodle-k3s.yaml
kubectl -n demo get pods -l app=gallery-server -o custom-columns='NAME:.metadata.name,IP:.status.podIP'
kubectl -n demo exec gallery-postgres-1 -c postgres -- psql -U postgres -d gallery -c \
  "SELECT l.objid, a.client_addr FROM pg_locks l JOIN pg_stat_activity a USING (pid) WHERE l.locktype='advisory' AND l.objid=42;"
```

`client_addr` must equal the surviving pod's IP. Run only once a single pod remains.
