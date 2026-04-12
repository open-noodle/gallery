# Cmd/Ctrl+K Multi-Entity Search Palette — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Gallery's inline header search bar with a keyboard-first global palette (Ctrl+K) that surfaces mixed-entity results (photos, people, places, tags) with a right-side preview pane, streaming per-section and gracefully degrading when ML is unhealthy.

**Architecture:** A new `GlobalSearchManager` singleton on the web side orchestrates four provider calls (smart/metadata search, people, places, tag-name client filter over a cached `getAllTags()`) via parallel `AbortController`-composed signals with a 150 ms debounce and 5 s per-provider timeout. Bits UI `Command.Dialog` supplies the ARIA combobox primitive. A small authenticated server endpoint (`GET /api/server/ml-health`) and a targeted per-caller `predict()` timeout fix cover the "ML is hung" failure mode.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), Bits UI `Command`, NestJS 11, Kysely, vitest, Playwright. Fonts and tokens inherit from `@immich/ui` + `app.css`.

**Design doc:** [`docs/plans/2026-04-12-cmdk-search-design.md`](./2026-04-12-cmdk-search-design.md) — read before starting. It specifies all behavioural and visual decisions this plan implements.

**Worktree:** `.worktrees/cmdk-search-research` on branch `research/cmdk-search`. All tasks below run from the worktree root.

---

## Conventions for every task

- **TDD cycle per task:** write failing test → run to confirm failure → minimal implementation → run to confirm pass → commit. Don't skip the confirm-failure step — it's the only proof the test actually exercises the new code.
- **Commits:** one logical unit per commit. Use conventional-commit prefixes: `feat`, `fix`, `test`, `chore`, `docs`. No `Co-Authored-By` trailers (per user's global CLAUDE.md).
- **Per-file lint/check before commit:**
  - Server: `cd server && pnpm check` (tsc) and `pnpm lint` (ESLint)
  - Web: `cd web && pnpm check` (svelte-check + tsc) and `pnpm lint`
  - Don't skip these — CI enforces `--max-warnings 0`
- **Regen after API changes:** if a task changes `server/src/controllers/` or `server/src/dtos/`, run `cd server && pnpm sync:open-api && cd .. && make open-api` and include the regenerated files in the same commit.
- **i18n:** any new user-visible string added during a task needs an i18n key. Don't hand-sort the translation file — run `pnpm --filter=immich-i18n format:fix` in the same commit (per `feedback_i18n_key_sorting`).
- **Thumbnails in web code:** always use `createUrl()` from `$lib/utils/api-utils`, not bare paths (per `feedback_filter_thumbnail_createUrl`).
- **Svelte in `.svelte` files:** use `SvelteMap`/`SvelteSet`, not `Map`/`Set` (per `feedback_svelte_map_lint`); never mutate `$state` from inside `$derived` (per `feedback_svelte_derived_no_mutation`).
- **Mocks in web component tests:** mock `@immich/ui` `IconButton` → `Button` to avoid the Tooltip.Provider context error (per `feedback_iconbutton_test_mock`).

---

## Task 1 — Per-caller `timeoutMs` option in `predict()`

**Files:**

- Modify: `server/src/repositories/machine-learning.repository.ts:186-214` (add `{ timeoutMs }` option)
- Test: `server/src/repositories/machine-learning.repository.spec.ts` (create if missing)

**Context:** `predict()` is called by five ML tasks — `detectFaces`, `encodeImage`, `encodeText`, `ocr`, `detectPets`. A blanket timeout would add aborts to long-running background jobs. We want per-caller opt-in so only `encodeText` (which is on the palette's critical path) gets a timeout.

**Step 1: Write three failing tests**

Add to `machine-learning.repository.spec.ts`:

```ts
describe('predict()', () => {
  it('aborts with AbortError when timeoutMs elapses before response', async () => {
    const slowUrl = 'http://mock-ml-slow';
    // stub fetch to never resolve
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const repo = newMachineLearningRepository({ urls: [slowUrl] });

    await expect(repo['predict']({ imagePath: '/tmp/x.jpg' }, someRequest, { timeoutMs: 50 })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('does not abort when no timeoutMs is provided (backward compat)', async () => {
    let settled = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            settled = true;
            resolve(new Response('{}'));
          }, 200),
        ),
    );
    const repo = newMachineLearningRepository({ urls: ['http://mock-ml'] });
    await repo['predict']({ imagePath: '/tmp/x.jpg' }, someRequest);
    expect(settled).toBe(true);
  });

  it('accepts a different timeoutMs per call (proves the option is per-call)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
    const repo = newMachineLearningRepository({ urls: ['http://mock-ml'] });

    const start = Date.now();
    await expect(repo['predict']({ imagePath: '/tmp/x.jpg' }, someRequest, { timeoutMs: 30 })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(Date.now() - start).toBeLessThan(100);

    const start2 = Date.now();
    await expect(repo['predict']({ imagePath: '/tmp/x.jpg' }, someRequest, { timeoutMs: 250 })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(Date.now() - start2).toBeGreaterThanOrEqual(200);
  });
});
```

**Step 2: Run tests — expect failure**

```bash
cd server && pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
```

Expected: all three tests fail because `predict()` doesn't accept an options argument yet.

**Step 3: Minimal implementation**

Edit `server/src/repositories/machine-learning.repository.ts`. Change the `predict` signature and the `fetch` call:

```ts
private async predict<T>(
  payload: ModelPayload,
  config: MachineLearningRequest,
  options?: { timeoutMs?: number },
): Promise<T> {
  const formData = await this.getFormData(payload, config);
  const signal = options?.timeoutMs !== undefined ? AbortSignal.timeout(options.timeoutMs) : undefined;

  for (const url of [
    ...this.config.urls.filter((url) => this.isHealthy(url)),
    ...this.config.urls.filter((url) => !this.isHealthy(url)),
  ]) {
    try {
      const response = await fetch(new URL('/predict', url), {
        method: 'POST',
        body: formData,
        signal,
      });
      if (response.ok) {
        this.setHealthy(url, true);
        return response.json();
      }
      this.logger.warn(/* ... unchanged ... */);
    } catch (error: Error | unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error; // propagate caller's timeout as-is, don't mark URL unhealthy
      }
      this.logger.warn(/* ... unchanged ... */);
    }
    this.setHealthy(url, false);
  }
  throw new Error(`Machine learning request '${JSON.stringify(config)}' failed for all URLs`);
}
```

Note the `AbortError` re-throw — timeouts are caller errors, not server-health signals, so we don't mark the URL unhealthy.

**Step 4: Run tests — expect pass**

```bash
cd server && pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
```

Expected: all three pass.

**Step 5: Lint, typecheck, commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/repositories/machine-learning.repository.ts server/src/repositories/machine-learning.repository.spec.ts
git commit -m "feat(ml): per-caller timeoutMs option on predict()"
```

---

## Task 2 — Wire `encodeText` to use a 15 s timeout

**Files:**

- Modify: `server/src/repositories/machine-learning.repository.ts:237-241` (`encodeText`)
- Test: `server/src/repositories/machine-learning.repository.spec.ts` (add a case)

**Context:** `encodeText` is the one ML call on the palette's hot path. A 15 s cap is generous for healthy hardware and tight enough that a hung container doesn't wedge palette keystrokes.

**Step 1: Write failing tests**

```ts
it('encodeText aborts after 15s when ML is unresponsive', async () => {
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}));
  const repo = newMachineLearningRepository({ urls: ['http://mock-ml'] });

  const promise = repo.encodeText('hello', { language: 'en', modelName: 'clip' });
  vi.advanceTimersByTime(15_000);
  await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  vi.useRealTimers();
});

it('other ML callers (detectFaces/encodeImage/ocr/detectPets) do not abort at 15s — blast radius check', async () => {
  vi.useFakeTimers();
  let resolved = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          resolved = true;
          resolve(new Response('{}'));
        }, 20_000),
      ),
  );
  const repo = newMachineLearningRepository({ urls: ['http://mock-ml'] });

  const p = repo.detectFaces('/tmp/x.jpg', { modelName: 'inswapper', minScore: 0.7 });
  vi.advanceTimersByTime(20_000);
  await p; // must not throw AbortError
  expect(resolved).toBe(true);
  vi.useRealTimers();
});
```

**Step 2: Run — expect failure**

```bash
cd server && pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
```

Expected: the `encodeText` test fails (no timeout yet).

**Step 3: Implement**

```ts
async encodeText(text: string, { language, modelName }: TextEncodingOptions) {
  const request = { [ModelTask.SEARCH]: { [ModelType.TEXTUAL]: { modelName, options: { language } } } };
  const response = await this.predict<ClipTextualResponse>({ text }, request, { timeoutMs: 15_000 });
  return response[ModelTask.SEARCH];
}
```

**Step 4: Run — expect pass**

```bash
cd server && pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
```

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/repositories/machine-learning.repository.ts server/src/repositories/machine-learning.repository.spec.ts
git commit -m "feat(ml): 15s timeout on encodeText to unstick palette keystrokes"
```

---

## Task 3 — `ServerMlHealthResponseDto`

**Files:**

- Modify: `server/src/dtos/server.dto.ts` (add DTO alongside `ServerAboutResponseDto`)

**Context:** Tiny structural change that unblocks the controller + service tasks. No test — DTOs are plain class declarations.

**Step 1: Add the DTO**

Edit `server/src/dtos/server.dto.ts`. Add near `ServerAboutResponseDto`:

```ts
export class ServerMlHealthResponseDto {
  smartSearchHealthy!: boolean;
}
```

**Step 2: Typecheck + commit**

```bash
cd server && pnpm check
git add server/src/dtos/server.dto.ts
git commit -m "feat(server): ServerMlHealthResponseDto"
```

---

## Task 4 — `ServerService.getMlHealth()` with cache + single-flight

**Files:**

- Modify: `server/src/services/server.service.ts` (add method)
- Modify: `server/src/services/server.service.spec.ts` (add tests)

**Context:** 30 s in-process cache and a single-flight guard bound the amplification factor — concurrent palette openers share one `/ping` probe. Content-type validation defeats reverse-proxy HTML error pages.

**Step 1: Write failing tests**

```ts
describe('getMlHealth()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // assume a helper to clear the service's internal cache between tests
    sut['mlHealthCache'] = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it('returns smartSearchHealthy=true when /ping returns 200 + JSON', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'application/json' });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: true });
  });

  it('returns false when /ping times out at 2s', async () => {
    mocks.machineLearning.ping.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'AbortError' }));
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: false });
  });

  it('returns false when /ping returns 200 with text/html (reverse-proxy error page)', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'text/html' });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: false });
  });

  it('caches the probe result for 30 seconds', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'application/json' });
    await sut.getMlHealth();
    await sut.getMlHealth();
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_001);
    await sut.getMlHealth();
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent callers share one in-flight probe', async () => {
    let resolveProbe!: (v: any) => void;
    mocks.machineLearning.ping.mockImplementation(() => new Promise((r) => (resolveProbe = r)));

    const [a, b, c] = [sut.getMlHealth(), sut.getMlHealth(), sut.getMlHealth()];
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(1);
    resolveProbe({ ok: true, contentType: 'application/json' });
    await expect(Promise.all([a, b, c])).resolves.toEqual([
      { smartSearchHealthy: true },
      { smartSearchHealthy: true },
      { smartSearchHealthy: true },
    ]);
  });
});
```

You may need to add `ping()` to the `MachineLearningRepository` mock shape — look at `test/fixtures/machine-learning.mock.ts` (or wherever mocks live) for the existing pattern. If no `ping` is stubbed yet, add it to the mock factory.

**Step 2: Run — expect failure**

```bash
cd server && pnpm test -- --run src/services/server.service.spec.ts
```

Expected: `sut.getMlHealth is not a function`, and the mock `ping` method is missing.

**Step 3: Implement**

First add a `ping()` method to `MachineLearningRepository` (if one doesn't already exist). Reuse the existing `/ping` probe in the availability checker but expose it as a public method that returns `{ ok: boolean; contentType: string | null }`:

```ts
// machine-learning.repository.ts
async ping(): Promise<{ ok: boolean; contentType: string | null }> {
  const url = this.config.urls[0];
  if (!url) return { ok: false, contentType: null };
  try {
    const response = await fetch(new URL('/ping', url), { signal: AbortSignal.timeout(2000) });
    return { ok: response.ok, contentType: response.headers.get('content-type') };
  } catch {
    return { ok: false, contentType: null };
  }
}
```

Then add `getMlHealth()` to `ServerService`:

```ts
// server.service.ts
private mlHealthCache?: { value: ServerMlHealthResponseDto; expiresAt: number };
private mlHealthInFlight?: Promise<ServerMlHealthResponseDto>;

async getMlHealth(): Promise<ServerMlHealthResponseDto> {
  const now = Date.now();
  if (this.mlHealthCache && this.mlHealthCache.expiresAt > now) {
    return this.mlHealthCache.value;
  }
  if (this.mlHealthInFlight) {
    return this.mlHealthInFlight;
  }
  this.mlHealthInFlight = (async () => {
    try {
      const { ok, contentType } = await this.machineLearningRepository.ping();
      const healthy = ok && (contentType?.includes('application/json') ?? false);
      const value = { smartSearchHealthy: healthy };
      this.mlHealthCache = { value, expiresAt: Date.now() + 30_000 };
      return value;
    } finally {
      this.mlHealthInFlight = undefined;
    }
  })();
  return this.mlHealthInFlight;
}
```

**Step 4: Run — expect pass**

```bash
cd server && pnpm test -- --run src/services/server.service.spec.ts
```

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/services/server.service.ts server/src/services/server.service.spec.ts \
  server/src/repositories/machine-learning.repository.ts
git commit -m "feat(server): getMlHealth() with 30s cache and single-flight"
```

---

## Task 5 — `GET /api/server/ml-health` controller route

**Files:**

- Modify: `server/src/controllers/server.controller.ts` (add route)
- Modify: `server/src/controllers/server.controller.spec.ts` (add route tests)

**Context:** Thin controller wrapper over `ServerService.getMlHealth()`. Gated on `Permission.ServerAbout` (matches `/about` — available to all authenticated users, not admin-only).

**Step 1: Write failing tests**

```ts
describe('GET /server/ml-health', () => {
  it('returns 401 when unauthenticated', async () => {
    await request(ctx.getHttpServer()).get('/server/ml-health').expect(401);
  });

  it('returns 200 + { smartSearchHealthy: true } when service reports healthy', async () => {
    mocks.server.getMlHealth.mockResolvedValue({ smartSearchHealthy: true });
    const { status, body } = await request(ctx.getHttpServer())
      .get('/server/ml-health')
      .set('Authorization', `Bearer ${authUser.accessToken}`);
    expect(status).toBe(200);
    expect(body).toEqual({ smartSearchHealthy: true });
  });

  it('returns false path', async () => {
    mocks.server.getMlHealth.mockResolvedValue({ smartSearchHealthy: false });
    const { body } = await request(ctx.getHttpServer())
      .get('/server/ml-health')
      .set('Authorization', `Bearer ${authUser.accessToken}`);
    expect(body).toEqual({ smartSearchHealthy: false });
  });
});
```

**Step 2: Run — expect failure (404 route not registered)**

```bash
cd server && pnpm test -- --run src/controllers/server.controller.spec.ts
```

**Step 3: Implement the route**

Add to `server.controller.ts`:

```ts
@Get('ml-health')
@Authenticated({ permission: Permission.ServerAbout })
@Endpoint({
  summary: 'Smart search health',
  description: 'Reports whether the ML server is currently reachable and healthy for smart search.',
  history: new HistoryBuilder().added('v2'),
})
getMlHealth(): Promise<ServerMlHealthResponseDto> {
  return this.service.getMlHealth();
}
```

Add the import at the top:

```ts
import { ServerAboutResponseDto, ServerMlHealthResponseDto /* ... */ } from 'src/dtos/server.dto';
```

**Step 4: Run — expect pass**

```bash
cd server && pnpm test -- --run src/controllers/server.controller.spec.ts
```

**Step 5: Regen OpenAPI + SDKs**

```bash
cd server && pnpm sync:open-api
cd .. && make open-api
```

This updates `open-api/immich-openapi-specs.json`, `open-api/typescript-sdk/src/fetch-client.ts`, and `mobile/openapi/**`. Commit everything together:

```bash
cd server && pnpm check && pnpm lint
git add server/src/controllers/server.controller.ts server/src/controllers/server.controller.spec.ts \
  open-api/ mobile/openapi/
git commit -m "feat(server): GET /server/ml-health endpoint"
```

---

## Task 6 — Add `bits-ui` as a direct web dependency

**Files:**

- Modify: `web/package.json`

**Context:** `bits-ui` is available transitively via `@immich/ui ^0.69.0` (which depends on `bits-ui ^2.15.7`) but is not hoisted to `web/node_modules` under pnpm strict hoisting, so `import { Command } from 'bits-ui'` in web code will fail to resolve.

**Step 1: Look up the exact version `@immich/ui` depends on**

```bash
cat node_modules/.pnpm/@immich+ui@*/node_modules/@immich/ui/package.json | grep -E '"bits-ui"'
```

Record the version string. Use the exact same version in `web/package.json` to avoid hoisting two copies.

**Step 2: Add to `web/package.json` dependencies**

Edit `web/package.json` — add `"bits-ui": "<version-from-step-1>"` in the `dependencies` block, alphabetically next to `@immich/ui`.

**Step 3: Install**

```bash
pnpm install
```

**Step 4: Verify the build + type-check still pass**

```bash
cd web && pnpm check
```

Expected: no errors (this just validates nothing regressed).

**Step 5: Smoke-test the import**

Create a temporary file `web/src/_bits-ui-smoke.ts` with one line:

```ts
import { Command } from 'bits-ui';
export const _check: typeof Command = Command;
```

Run `cd web && pnpm check` again. If it passes, delete the smoke file.

**Step 6: Commit**

```bash
git add web/package.json pnpm-lock.yaml
git commit -m "chore(web): add bits-ui as direct dependency for global search palette"
```

---

## Task 7 — `GlobalSearchManager` skeleton (state + open/close/toggle)

**Files:**

- Create: `web/src/lib/managers/global-search-manager.svelte.ts`
- Create: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Rune-stateful singleton following the Gallery manager convention (see `activity-manager.svelte.ts`, `auth-manager.svelte.ts`). We build it incrementally: skeleton first (open/close), then `setQuery` (Task 8), then providers (Tasks 9–10), then mode switching and cursor identity (Task 11).

**Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalSearchManager } from './global-search-manager.svelte';

describe('GlobalSearchManager', () => {
  let manager: GlobalSearchManager;
  beforeEach(() => {
    manager = new GlobalSearchManager();
  });

  it('starts closed with an empty query', () => {
    expect(manager.open).toBe(false);
    expect(manager.query).toBe('');
  });

  it('open() sets open=true', () => {
    manager.open_();
    expect(manager.open).toBe(true);
  });

  it('close() resets sections to idle and clears active item', () => {
    manager.open_();
    manager.sections.photos = { status: 'loading' };
    manager.activeItemId = 'photo:abc';
    manager.close();
    expect(manager.open).toBe(false);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
    expect(manager.activeItemId).toBe(null);
  });

  it('toggle() flips open state', () => {
    manager.toggle();
    expect(manager.open).toBe(true);
    manager.toggle();
    expect(manager.open).toBe(false);
  });
});
```

Note: `open_` (trailing underscore) is used because `open` is a state field. Or rename the state to `isOpen` — preferable. Let's use `isOpen` throughout.

**Refactor the test to use `isOpen`:**

```ts
describe('GlobalSearchManager', () => {
  let manager: GlobalSearchManager;
  beforeEach(() => {
    manager = new GlobalSearchManager();
  });

  it('starts closed with empty query', () => {
    expect(manager.isOpen).toBe(false);
    expect(manager.query).toBe('');
  });

  it('open() sets isOpen=true', () => {
    manager.open();
    expect(manager.isOpen).toBe(true);
  });

  it('close() resets sections to idle and clears active item', () => {
    manager.open();
    manager.sections.photos = { status: 'loading' };
    manager.activeItemId = 'photo:abc';
    manager.close();
    expect(manager.isOpen).toBe(false);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
    expect(manager.activeItemId).toBe(null);
  });

  it('toggle() flips state', () => {
    manager.toggle();
    expect(manager.isOpen).toBe(true);
    manager.toggle();
    expect(manager.isOpen).toBe(false);
  });
});
```

**Step 2: Run — expect failure**

```bash
cd web && pnpm test -- --run src/lib/managers/global-search-manager.svelte.spec.ts
```

**Step 3: Minimal implementation**

Create `global-search-manager.svelte.ts`:

```ts
export type SearchMode = 'smart' | 'metadata' | 'description' | 'ocr';

export type ProviderStatus<T = unknown> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; items: T[]; total: number }
  | { status: 'timeout' }
  | { status: 'error'; message: string }
  | { status: 'empty' };

export type Sections = {
  photos: ProviderStatus;
  people: ProviderStatus;
  places: ProviderStatus;
  tags: ProviderStatus;
};

const idle: ProviderStatus = { status: 'idle' };

export class GlobalSearchManager {
  isOpen = $state(false);
  query = $state('');
  mode = $state<SearchMode>('smart');
  sections = $state<Sections>({ photos: idle, people: idle, places: idle, tags: idle });
  activeItemId = $state<string | null>(null);
  mlHealthy = $state(true);

  open() {
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    this.sections.photos = idle;
    this.sections.people = idle;
    this.sections.places = idle;
    this.sections.tags = idle;
    this.activeItemId = null;
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }
}
```

**Step 4: Run — expect pass**

```bash
cd web && pnpm test -- --run src/lib/managers/global-search-manager.svelte.spec.ts
```

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): GlobalSearchManager skeleton with open/close/toggle"
```

---

## Task 8 — `setQuery` with debounce, abort, min-query-length

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** The 150 ms debounce coalesces rapid keystrokes. `AbortController` cancellation is distinguished by signal reason — silent (new batch) vs. timeout (5 s). Min-query-length 1 for photos, 2 for others.

**Step 1: Write failing tests**

```ts
import { vi } from 'vitest';

describe('setQuery', () => {
  let manager: GlobalSearchManager;
  let providerCalls: Array<{ key: string; query: string; mode: SearchMode }> = [];

  beforeEach(() => {
    vi.useFakeTimers();
    providerCalls = [];
    manager = new GlobalSearchManager();
    // inject fake providers
    manager['providers'] = {
      photos: {
        key: 'photos',
        minQueryLength: 1,
        topN: 5,
        run: async (q, m) => {
          providerCalls.push({ key: 'photos', query: q, mode: m });
          return { status: 'ok', items: [], total: 0 };
        },
      },
      people: {
        key: 'people',
        minQueryLength: 2,
        topN: 5,
        run: async (q, m) => {
          providerCalls.push({ key: 'people', query: q, mode: m });
          return { status: 'ok', items: [], total: 0 };
        },
      },
      places: {
        key: 'places',
        minQueryLength: 2,
        topN: 3,
        run: async (q, m) => {
          providerCalls.push({ key: 'places', query: q, mode: m });
          return { status: 'ok', items: [], total: 0 };
        },
      },
      tags: {
        key: 'tags',
        minQueryLength: 2,
        topN: 5,
        run: async (q, m) => {
          providerCalls.push({ key: 'tags', query: q, mode: m });
          return { status: 'ok', items: [], total: 0 };
        },
      },
    };
  });

  afterEach(() => vi.useRealTimers());

  it('empty query resets sections to idle and does not fire providers', async () => {
    manager.setQuery('');
    vi.advanceTimersByTime(200);
    expect(providerCalls).toEqual([]);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
  });

  it('query length 1 only fires photos', async () => {
    manager.setQuery('a');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(providerCalls.map((c) => c.key).sort()).toEqual(['photos']);
  });

  it('query length >= 2 fires all four providers', async () => {
    manager.setQuery('ab');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(providerCalls.map((c) => c.key).sort()).toEqual(['people', 'photos', 'places', 'tags']);
  });

  it('debounces rapid keystrokes — only the last value fires', async () => {
    manager.setQuery('a');
    manager.setQuery('ab');
    manager.setQuery('abc');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    const queries = providerCalls.map((c) => c.query);
    expect(queries.every((q) => q === 'abc')).toBe(true);
  });

  it('new keystroke aborts previous batch silently (no timeout status)', async () => {
    let slowResolve!: (v: any) => void;
    manager['providers'].photos.run = (q, m, signal) =>
      new Promise((resolve, reject) => {
        slowResolve = resolve;
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      });
    manager.setQuery('first');
    vi.advanceTimersByTime(200);
    // first provider is now in flight
    manager.setQuery('second');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    // sections.photos should not be in 'timeout' state — the abort was silent
    expect(manager.sections.photos.status).not.toBe('timeout');
  });

  it('5s timeout sets section to timeout when provider never resolves', async () => {
    manager['providers'].photos.run = (_q, _m, signal) =>
      new Promise((_, reject) => {
        signal.addEventListener('abort', () => {
          reject(Object.assign(new Error('timeout'), { name: 'AbortError' }));
        });
      });
    manager.setQuery('hang');
    vi.advanceTimersByTime(200); // debounce fires
    vi.advanceTimersByTime(5_100); // timeout fires
    await vi.runAllTimersAsync();
    expect(manager.sections.photos.status).toBe('timeout');
  });
});
```

**Step 2: Run — expect failure**

Expected: `setQuery is not a function` or similar.

**Step 3: Implement**

Add to `global-search-manager.svelte.ts`:

```ts
import type { SearchMode, ProviderStatus } from './global-search-manager.svelte'; // self-ref OK

interface Provider<T = unknown> {
  key: keyof Sections;
  run(query: string, mode: SearchMode, signal: AbortSignal): Promise<ProviderStatus<T>>;
  topN: number;
  minQueryLength: number;
}

export class GlobalSearchManager {
  // ... existing state ...
  private providers: Record<keyof Sections, Provider> = makeDefaultProviders();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private batchController: AbortController | null = null;

  setQuery(text: string) {
    if (this.query === text) return;
    this.query = text;
    this.clearDebounce();
    this.abortBatch('superseded');
    if (text.trim() === '') {
      this.resetSectionsToIdle();
      return;
    }
    this.sections.photos = { status: 'loading' };
    this.sections.people = { status: 'loading' };
    this.sections.places = { status: 'loading' };
    this.sections.tags = { status: 'loading' };
    this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
  }

  private runBatch(text: string, mode: SearchMode) {
    this.batchController = new AbortController();
    const batch = this.batchController;
    for (const key of ['photos', 'people', 'places', 'tags'] as const) {
      const p = this.providers[key];
      if (text.length < p.minQueryLength) {
        this.sections[key] = { status: 'idle' };
        continue;
      }
      const signal = AbortSignal.any([batch.signal, AbortSignal.timeout(5000)]);
      p.run(text, mode, signal)
        .then((result) => {
          if (batch === this.batchController) this.sections[key] = result;
        })
        .catch((err: Error) => {
          if (batch !== this.batchController) return; // superseded
          if (err.name === 'AbortError') {
            if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
              this.sections[key] = { status: 'timeout' };
            }
            // silent abort from new batch — no-op
          } else {
            this.sections[key] = { status: 'error', message: err.message };
          }
        });
    }
  }

  private clearDebounce() {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private abortBatch(_reason: 'superseded' | 'close') {
    this.batchController?.abort();
    this.batchController = null;
  }

  private resetSectionsToIdle() {
    const idle: ProviderStatus = { status: 'idle' };
    this.sections.photos = idle;
    this.sections.people = idle;
    this.sections.places = idle;
    this.sections.tags = idle;
  }

  close() {
    this.isOpen = false;
    this.clearDebounce();
    this.abortBatch('close');
    this.resetSectionsToIdle();
    this.activeItemId = null;
  }
}

function makeDefaultProviders(): Record<keyof Sections, Provider> {
  // Stub during tests — Task 9+ replaces with real SDK-backed providers.
  const stub: Provider = {
    key: 'photos',
    minQueryLength: 1,
    topN: 5,
    run: async () => ({ status: 'empty' }),
  };
  return {
    photos: { ...stub, key: 'photos', minQueryLength: 1 },
    people: { ...stub, key: 'people', minQueryLength: 2 },
    places: { ...stub, key: 'places', minQueryLength: 2, topN: 3 },
    tags: { ...stub, key: 'tags', minQueryLength: 2 },
  };
}
```

**Step 4: Run — expect pass**

```bash
cd web && pnpm test -- --run src/lib/managers/global-search-manager.svelte.spec.ts
```

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): GlobalSearchManager setQuery with debounce and abort"
```

---

## Task 9 — Real photos / people / places providers

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (replace stub providers)
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts` (add integration-shaped tests with mocked SDK)

**Context:** Each real provider wraps one SDK call. Smart search and metadata search share the photos slot and branch on `mode`.

**Step 1: Write failing tests**

```ts
import { searchSmart, searchAssets, searchPerson, searchPlaces } from '@immich/sdk';
vi.mock('@immich/sdk');

describe('real providers', () => {
  beforeEach(() => {
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [{ id: 'a' }, { id: 'b' }], nextPage: null } } as any);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'p1', name: 'Alice' }] as any);
    vi.mocked(searchPlaces).mockResolvedValue([{ name: 'Santa Cruz', latitude: 36.97, longitude: -122.03 }] as any);
  });

  it('photos provider uses searchSmart in smart mode', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(searchSmart).toHaveBeenCalledOnce();
    expect(m.sections.photos).toMatchObject({ status: 'ok' });
  });

  it('photos provider uses searchAssets in metadata mode with originalFileName', async () => {
    const m = new GlobalSearchManager();
    m.mode = 'metadata';
    m.setQuery('IMG_0042');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({ metadataSearchDto: expect.objectContaining({ originalFileName: 'IMG_0042' }) }),
      expect.anything(),
    );
  });

  // Similar cases for description ('description' field) and ocr ('ocrText' field if that's the DTO name).

  it('people provider calls searchPerson with the query', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(searchPerson).toHaveBeenCalledWith(
      { name: 'alice', withHidden: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('places provider calls searchPlaces with the query', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('santa');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(searchPlaces).toHaveBeenCalledWith({ name: 'santa' }, expect.anything());
  });
});
```

Check the SDK signatures first — the exact argument shape of `searchSmart`, `searchAssets`, `searchPerson`, `searchPlaces` lives in `open-api/typescript-sdk/src/fetch-client.ts`. Adjust the test to match reality. Also check how existing callers (e.g. `smart-search-results.svelte`) pass the `AbortSignal` — the second argument is usually `Oazapfts.RequestOpts`, and you pass `{ signal }`.

**Step 2: Run — expect failure**

**Step 3: Implement**

Replace the stub providers with real ones:

```ts
import { searchSmart, searchAssets, searchPerson, searchPlaces, type AssetResponseDto } from '@immich/sdk';

function buildPhotosDto(query: string, mode: SearchMode) {
  switch (mode) {
    case 'smart':
      return { smartSearchDto: { query, size: 5 } };
    case 'metadata':
      return { metadataSearchDto: { originalFileName: query, size: 5 } };
    case 'description':
      return { metadataSearchDto: { description: query, size: 5 } };
    case 'ocr':
      return { metadataSearchDto: { ocrText: query, size: 5 } }; // verify field name
  }
}

const photosProvider: Provider = {
  key: 'photos',
  minQueryLength: 1,
  topN: 5,
  async run(query, mode, signal) {
    try {
      const dto = buildPhotosDto(query, mode);
      const response =
        mode === 'smart' ? await searchSmart(dto as any, { signal }) : await searchAssets(dto as any, { signal });
      const items = response.assets.items;
      return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      return { status: 'error', message: err.message ?? 'unknown error' };
    }
  },
};

const peopleProvider: Provider = {
  key: 'people',
  minQueryLength: 2,
  topN: 5,
  async run(query, _mode, signal) {
    try {
      const results = await searchPerson({ name: query, withHidden: false }, { signal });
      return results.length === 0 ? { status: 'empty' } : { status: 'ok', items: results, total: results.length };
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      return { status: 'error', message: err.message ?? 'unknown error' };
    }
  },
};

const placesProvider: Provider = {
  key: 'places',
  minQueryLength: 2,
  topN: 3,
  async run(query, _mode, signal) {
    try {
      const results = await searchPlaces({ name: query }, { signal });
      return results.length === 0
        ? { status: 'empty' }
        : { status: 'ok', items: results.slice(0, 3), total: results.length };
    } catch (err: any) {
      if (err.name === 'AbortError') throw err;
      return { status: 'error', message: err.message ?? 'unknown error' };
    }
  },
};

function makeDefaultProviders(): Record<keyof Sections, Provider> {
  return {
    photos: photosProvider,
    people: peopleProvider,
    places: placesProvider,
    tags: tagsProvider, // implemented in Task 10
  };
}
```

**Verify DTO field names:** before running tests, grep `search-bar.svelte` for how it currently builds the metadata DTO so our field names (`originalFileName`, `description`, `ocrText`) match reality. If any differ, adjust `buildPhotosDto`.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): photos, people, places providers for GlobalSearchManager"
```

---

## Task 10 — Tag provider with cached `getAllTags()` + 20 k cap + storage-event invalidation

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests**

```ts
import { getAllTags } from '@immich/sdk';
vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual('@immich/sdk')),
  getAllTags: vi.fn(),
}));

describe('tag provider', () => {
  beforeEach(() => {
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 't1', value: 'beach', color: null },
      { id: 't2', value: 'beer', color: null },
      { id: 't3', value: 'mountain', color: null },
    ] as any);
  });

  it('filters tags by case-insensitive substring', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(m.sections.tags).toMatchObject({
      status: 'ok',
      items: expect.arrayContaining([
        expect.objectContaining({ value: 'beach' }),
        expect.objectContaining({ value: 'beer' }),
      ]),
    });
    expect((m.sections.tags as any).items).toHaveLength(2);
  });

  it('caches getAllTags: only one call across two keystrokes', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    m.setQuery('mou');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(getAllTags).toHaveBeenCalledTimes(1);
  });

  it('cache is cleared on close() and reopen re-fetches', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    m.close();
    m.open();
    m.setQuery('be');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });

  it('disables tag provider at > 20 000 tags and renders a helper', async () => {
    vi.mocked(getAllTags).mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ id: `t${i}`, value: `tag${i}`, color: null })) as any,
    );
    const m = new GlobalSearchManager();
    m.setQuery('tag');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(m.sections.tags).toEqual({ status: 'error', message: 'tag_cache_too_large' });
  });

  it('invalidates cache on storage event for cmdk.tags.version', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    // simulate a cross-tab tag edit
    window.dispatchEvent(new StorageEvent('storage', { key: 'cmdk.tags.version', newValue: '2' }));
    m.setQuery('mou');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Add to `GlobalSearchManager`:

```ts
import { getAllTags, type TagResponseDto } from '@immich/sdk';

export class GlobalSearchManager {
  // ... existing state ...
  private tagsCache: TagResponseDto[] | null = null;
  private tagsDisabled = false;
  private storageListener?: (e: StorageEvent) => void;

  constructor() {
    if (typeof window !== 'undefined') {
      this.storageListener = (e) => {
        if (e.key === 'cmdk.tags.version') this.tagsCache = null;
      };
      window.addEventListener('storage', this.storageListener);
    }
  }

  destroy() {
    if (this.storageListener) window.removeEventListener('storage', this.storageListener);
  }

  close() {
    // ... existing ...
    this.tagsCache = null; // bust on close so reopen refetches
  }

  private async runTagsProvider(query: string, signal: AbortSignal): Promise<ProviderStatus<TagResponseDto>> {
    if (this.tagsDisabled) {
      return { status: 'error', message: 'tag_cache_too_large' };
    }
    if (this.tagsCache === null) {
      try {
        const all = await getAllTags({ signal });
        if (all.length > 20_000) {
          this.tagsDisabled = true;
          // eslint-disable-next-line no-console
          console.warn('[cmdk] tag cache exceeds 20 000 entries, disabling tag provider for session');
          return { status: 'error', message: 'tag_cache_too_large' };
        }
        if (all.length > 5_000) {
          // eslint-disable-next-line no-console
          console.warn(`[cmdk] tag cache is large (${all.length} entries)`);
        }
        this.tagsCache = all;
      } catch (err: any) {
        if (err.name === 'AbortError') throw err;
        return { status: 'error', message: err.message ?? 'getAllTags failed' };
      }
    }
    const q = query.toLowerCase();
    const matches = this.tagsCache!.filter((t) => t.value.toLowerCase().includes(q)).slice(0, 5);
    return matches.length === 0 ? { status: 'empty' } : { status: 'ok', items: matches, total: matches.length };
  }
}
```

Wire it into `makeDefaultProviders`:

```ts
const tagsProvider: Provider = {
  key: 'tags',
  minQueryLength: 2,
  topN: 5,
  run: (query, _mode, signal) => manager.runTagsProvider(query, signal), // needs `this` binding
};
```

Since `tagsProvider` closes over `this`, move the provider factory inside the constructor or make it an instance method. Easiest: replace `makeDefaultProviders()` with an instance method that binds `this` — refactor during implementation.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): tag provider with cache, 20k cap, storage-event invalidation"
```

---

## Task 11 — `setMode`, cursor identity, `searchQueryType` sanity check, `close()` completeness

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests**

```ts
describe('setMode', () => {
  // ... setup similar to Task 9 ...

  it('mode switch aborts only the photos provider and re-runs it', async () => {
    const photosRun = vi.fn().mockResolvedValue({ status: 'ok', items: [], total: 0 });
    const peopleRun = vi.fn().mockResolvedValue({ status: 'ok', items: [], total: 0 });
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = photosRun;
    (m as any).providers.people.run = peopleRun;

    m.setQuery('beach');
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    expect(photosRun).toHaveBeenCalledTimes(1);
    expect(peopleRun).toHaveBeenCalledTimes(1);

    m.setMode('metadata');
    await vi.runAllTimersAsync();
    expect(photosRun).toHaveBeenCalledTimes(2); // re-ran
    expect(peopleRun).toHaveBeenCalledTimes(1); // untouched
  });

  it('mode switch during debounce restarts the timer with the new mode', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    vi.advanceTimersByTime(50); // inside debounce window
    m.setMode('metadata');
    expect((m as any).debounceTimer).not.toBeNull();
    vi.advanceTimersByTime(200);
    await vi.runAllTimersAsync();
    // mode at fire time was metadata — verify via searchAssets invocation
    // (setup searchAssets spy in beforeEach)
  });

  it('persists mode to searchQueryType localStorage', () => {
    const m = new GlobalSearchManager();
    m.setMode('ocr');
    expect(localStorage.getItem('searchQueryType')).toBe('ocr');
  });
});

describe('searchQueryType load', () => {
  it('falls back to smart when corrupted', () => {
    localStorage.setItem('searchQueryType', 'evil_value');
    const m = new GlobalSearchManager();
    expect(m.mode).toBe('smart');
    expect(localStorage.getItem('searchQueryType')).toBe('smart');
  });

  it('uses persisted value when valid', () => {
    localStorage.setItem('searchQueryType', 'metadata');
    const m = new GlobalSearchManager();
    expect(m.mode).toBe('metadata');
  });
});

describe('cursor identity on out-of-order resolution', () => {
  it('preserves activeItemId across section updates', async () => {
    const m = new GlobalSearchManager();
    // fake people provider resolves first with item 'p1'
    // fake photos provider resolves later
    // cursor set to 'p1' between the two
    // assert cursor still on 'p1' after photos lands
    // (detailed setup omitted for brevity — use the pattern from Task 8)
  });

  it('falls back to first row of top section when tracked id disappears', async () => {
    // set activeItemId to 'p1', then setQuery to new text that drops 'p1' from results
    // assert activeItemId is now the first item of sections.photos
  });
});

describe('close() completeness', () => {
  it('close() also aborts preview controller and clears tags cache', () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    (m as any).previewController = new AbortController();
    m.close();
    expect((m as any).previewController).toBeNull();
    expect((m as any).tagsCache).toBeNull();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Add to the manager:

```ts
const VALID_MODES: ReadonlySet<SearchMode> = new Set(['smart', 'metadata', 'description', 'ocr']);

constructor() {
  // ... existing storage-event listener ...
  const stored = localStorage.getItem('searchQueryType');
  if (stored && VALID_MODES.has(stored as SearchMode)) {
    this.mode = stored as SearchMode;
  } else if (stored) {
    localStorage.setItem('searchQueryType', 'smart');
  }
}

setMode(newMode: SearchMode) {
  if (newMode === this.mode) return;
  this.mode = newMode;
  localStorage.setItem('searchQueryType', newMode);
  if (this.debounceTimer !== null) {
    // restart debounce with fresh timer — batch will use the new mode
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => this.runBatch(this.query, this.mode), 150);
    return;
  }
  if (this.query.trim() === '') return;
  // re-run photos only
  this.batchController?.abort(); // aborts in-flight photos (and anything else, but people/places/tags have already resolved)
  const batch = new AbortController();
  this.batchController = batch;
  const signal = AbortSignal.any([batch.signal, AbortSignal.timeout(5000)]);
  this.providers.photos.run(this.query, this.mode, signal)
    .then((result) => { if (batch === this.batchController) this.sections.photos = result; })
    .catch((err: Error) => { /* ... same handler ... */ });
}
```

Note on setMode: aborting the batch controller also aborts people/places/tags in-flight, but in practice those resolve in < 100 ms while Photos is still going, so they're usually done. If the user mode-switches within 100 ms of the debounce fire, People/Places/Tags _might_ be in flight and would get silently aborted — they'd then be re-triggered... no, they wouldn't because we only re-run photos. **Design gap caught late.**

Simpler correct alternative: use per-provider controllers, not a shared batch controller. But that's a bigger refactor. Punt for now and document: "mode switch during the first ~100 ms of a batch may silently abort People/Places/Tags without re-running them; they'll stay empty until the user types again. Acceptable because it's a narrow timing window."

Actually — simpler: add a new `photosController` field, separate from the batch controller. Mode switch aborts only `photosController`. Do this now:

```ts
private photosController: AbortController | null = null;

private runBatch(text: string, mode: SearchMode) {
  this.batchController = new AbortController();
  this.photosController = new AbortController();
  const batch = this.batchController;
  const photosCtrl = this.photosController;

  // Photos uses composite of batch + photos signals
  const photosSignal = AbortSignal.any([batch.signal, photosCtrl.signal, AbortSignal.timeout(5000)]);
  this.providers.photos.run(text, mode, photosSignal)
    .then((r) => { if (batch === this.batchController) this.sections.photos = r; })
    .catch((err) => this.handleProviderError('photos', err, photosSignal, batch));

  // People/Places/Tags use only batch
  for (const key of ['people', 'places', 'tags'] as const) {
    const p = this.providers[key];
    if (text.length < p.minQueryLength) { this.sections[key] = { status: 'idle' }; continue; }
    const signal = AbortSignal.any([batch.signal, AbortSignal.timeout(5000)]);
    p.run(text, mode, signal)
      .then((r) => { if (batch === this.batchController) this.sections[key] = r; })
      .catch((err) => this.handleProviderError(key, err, signal, batch));
  }
}

setMode(newMode: SearchMode) {
  // ... guards and persistence ...
  if (this.query.trim() === '') return;
  this.photosController?.abort();
  const photosCtrl = new AbortController();
  this.photosController = photosCtrl;
  const batch = this.batchController; // reuse current batch
  const signal = AbortSignal.any([batch!.signal, photosCtrl.signal, AbortSignal.timeout(5000)]);
  this.providers.photos.run(this.query, this.mode, signal)
    .then((r) => { if (batch === this.batchController) this.sections.photos = r; })
    .catch((err) => this.handleProviderError('photos', err, signal, batch!));
}
```

Cursor identity and preview cleanup:

```ts
setActiveItem(id: string | null) {
  this.activeItemId = id;
  this.previewController?.abort();
  this.previewController = null;
}

// After sections update, verify activeItemId still points at a visible row.
// Simplest: `$effect` in the palette component that, when sections change, checks
// if activeItemId is still resolvable and if not, falls back to the first visible row.
// Implementation goes in the root component (Task 13), not here.
```

Close completeness:

```ts
private previewController: AbortController | null = null;

close() {
  this.isOpen = false;
  this.clearDebounce();
  this.abortBatch('close');
  this.photosController?.abort();
  this.photosController = null;
  this.previewController?.abort();
  this.previewController = null;
  this.tagsCache = null;
  this.resetSectionsToIdle();
  this.activeItemId = null;
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): setMode, cursor identity scaffolding, searchQueryType sanity, close() completeness"
```

---

## Task 12 — `cmdk.recent` localStorage store

**Files:**

- Create: `web/src/lib/stores/cmdk-recent.ts`
- Create: `web/src/lib/stores/cmdk-recent.spec.ts`

**Context:** Quota/corruption/unavailable handling is the whole point — this store must never throw and must preserve existing data on write failure.

**Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addEntry, getEntries, clearEntries, makePlaceId, type RecentEntry } from './cmdk-recent';

describe('cmdk-recent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] for unset store', () => {
    expect(getEntries()).toEqual([]);
  });

  it('addEntry persists and getEntries returns newest first', () => {
    addEntry({ kind: 'query', id: 'q:beach', text: 'beach', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:mountain', text: 'mountain', mode: 'smart', lastUsed: 2 });
    const entries = getEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('q:mountain');
  });

  it('dedupes by id, updating lastUsed in place', () => {
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'Sunset', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'Sunset', lastUsed: 2 });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(2);
  });

  it('trims to 20 entries, keeping most recently used', () => {
    for (let i = 0; i < 25; i++) {
      addEntry({ kind: 'query', id: `q:${i}`, text: `q${i}`, mode: 'smart', lastUsed: i });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].id).toBe('q:24');
    expect(entries[19].id).toBe('q:5');
  });

  it('treats corrupt JSON as empty and does not throw', () => {
    localStorage.setItem('cmdk.recent', 'not-valid-json');
    expect(getEntries()).toEqual([]);
    // subsequent add works (overwrites the corrupt value)
    addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 });
    expect(getEntries()).toHaveLength(1);
  });

  it('QuotaExceededError preserves in-memory copy (regression test)', () => {
    addEntry({ kind: 'query', id: 'q:initial', text: 'initial', mode: 'smart', lastUsed: 1 });
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    addEntry({ kind: 'query', id: 'q:new', text: 'new', mode: 'smart', lastUsed: 2 });
    setItemSpy.mockRestore();
    // Reading back: the initial entry must still be there (not zeroed out)
    expect(getEntries().some((e) => e.id === 'q:initial')).toBe(true);
  });

  it('handles localStorage entirely unavailable (privacy mode)', () => {
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: access denied');
    });
    expect(getEntries()).toEqual([]);
    // addEntry is a silent no-op; does not throw
    expect(() => addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 })).not.toThrow();
    getItemSpy.mockRestore();
  });
});

describe('makePlaceId', () => {
  it('rounds to 4 decimals so near-identical coords collapse', () => {
    expect(makePlaceId(48.85664567, 2.35221001)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.85669999, 2.35219999)).toBe('place:48.8567:2.3522'); // actually different at 4 decimals
    expect(makePlaceId(48.85664567, 2.35221001)).toBe(makePlaceId(48.8566, 2.3522));
  });
});
```

Note: double-check the `makePlaceId` test logic — the second assertion above might be wrong depending on rounding. Confirm via a REPL during implementation.

**Step 2: Run — expect failure**

**Step 3: Implement**

Create `web/src/lib/stores/cmdk-recent.ts`:

```ts
import type { SearchMode } from '$lib/managers/global-search-manager.svelte';

const STORAGE_KEY = 'cmdk.recent';
const MAX_ENTRIES = 20;

export type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: string; assetId: string; label: string; lastUsed: number }
  | { kind: 'person'; id: string; personId: string; label: string; thumbnailAssetId?: string; lastUsed: number }
  | { kind: 'place'; id: string; latitude: number; longitude: number; label: string; lastUsed: number }
  | { kind: 'tag'; id: string; tagId: string; label: string; lastUsed: number };

let warnedOnce = false;
function warn(err: unknown) {
  if (warnedOnce) return;
  warnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn('[cmdk.recent] storage issue:', err);
}

function rawRead(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    warn(err);
    return [];
  }
}

function rawWrite(entries: RecentEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (err) {
    warn(err);
    return false;
  }
}

// In-memory shadow. Preserved across QuotaExceeded write failures so the
// session keeps the data even if persistence fails.
let memory: RecentEntry[] | null = null;

export function getEntries(): RecentEntry[] {
  if (memory !== null) return [...memory].sort((a, b) => b.lastUsed - a.lastUsed);
  memory = rawRead();
  return [...memory].sort((a, b) => b.lastUsed - a.lastUsed);
}

export function addEntry(entry: RecentEntry) {
  if (memory === null) memory = rawRead();
  const deduped = memory.filter((e) => e.id !== entry.id);
  deduped.unshift(entry);
  const trimmed = deduped.sort((a, b) => b.lastUsed - a.lastUsed).slice(0, MAX_ENTRIES);
  memory = trimmed;
  rawWrite(trimmed); // best effort — memory stays populated even if write fails
}

export function clearEntries() {
  memory = [];
  rawWrite([]);
}

export function makePlaceId(lat: number, lng: number): string {
  return `place:${lat.toFixed(4)}:${lng.toFixed(4)}`;
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/stores/cmdk-recent.ts web/src/lib/stores/cmdk-recent.spec.ts
git commit -m "feat(web): cmdk.recent localStorage store with quota-preserving writes"
```

---

## Task 13 — Row components (photo, person, place, tag)

**Files:**

- Create: `web/src/lib/components/global-search/rows/photo-row.svelte`
- Create: `web/src/lib/components/global-search/rows/person-row.svelte`
- Create: `web/src/lib/components/global-search/rows/place-row.svelte`
- Create: `web/src/lib/components/global-search/rows/tag-row.svelte`
- Create: one `__tests__/<row>.spec.ts` per component

**Context:** Four small presentation components. Each takes a typed `item` prop, a `isActive` prop, and renders the row. Exact visual specs in the design doc § "Visual identity and motion" and § "Row shape per entity type".

**Step 1: Write failing tests** (example for `photo-row`)

```ts
import { render, screen } from '@testing-library/svelte';
import PhotoRow from '../photo-row.svelte';

describe('photo-row', () => {
  it('renders filename and subtitle', () => {
    render(PhotoRow, {
      props: {
        item: {
          id: 'a1',
          originalFileName: 'sunset.jpg',
          exifInfo: { dateTimeOriginal: '2024-03-01', city: 'Santa Cruz' },
        },
        isActive: false,
      },
    });
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Santa Cruz/)).toBeInTheDocument();
  });

  it('uses createUrl() for the thumbnail src', () => {
    render(PhotoRow, { props: { item: { id: 'a1', originalFileName: 'x.jpg' }, isActive: false } });
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toMatch(/^\/api\//); // createUrl prepends /api
  });

  it('applies bg-primary/10 tint when active', () => {
    const { container } = render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'x.jpg' }, isActive: true },
    });
    const row = container.querySelector('[data-cmdk-row]');
    expect(row?.className).toContain('bg-primary/10');
  });
});
```

Similar specs for person/place/tag rows — test the right thumbnail (round face for person, icon for place/tag), right fields rendered, right ARIA.

**Step 2: Run — expect failure (file not found)**

**Step 3: Implement** each row component, ~30 lines each. Sample `photo-row.svelte`:

```svelte
<script lang="ts">
  import { createUrl } from '$lib/utils/api-utils';
  import { getAssetThumbnailUrl } from '$lib/utils/asset-utils';

  interface Props {
    item: { id: string; originalFileName: string; exifInfo?: { dateTimeOriginal?: string; city?: string } };
    isActive: boolean;
  }
  let { item, isActive }: Props = $props();

  const subtitle = $derived([item.exifInfo?.dateTimeOriginal?.slice(0, 10), item.exifInfo?.city].filter(Boolean).join(' · '));
  const thumbUrl = $derived(createUrl(getAssetThumbnailUrl({ id: item.id, size: 'thumbnail' })));
</script>

<div
  data-cmdk-row
  class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 {isActive ? 'bg-primary/10' : ''}"
  role="option"
  aria-selected={isActive}
>
  <img src={thumbUrl} alt="" class="h-10 w-10 rounded-md object-cover" loading="lazy" />
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.originalFileName}</div>
    {#if subtitle}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
    {/if}
  </div>
</div>
```

Other rows follow the same pattern. Verify `getAssetThumbnailUrl` is the right helper — grep existing row components for precedent.

**Step 4: Run — expect pass**

Per `feedback_iconbutton_test_mock`, if any row uses `@immich/ui IconButton`, mock it to `Button` in the vitest setup.

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/rows/
git commit -m "feat(web): row components for global search palette"
```

---

## Task 14 — Section component + palette root (Command.Dialog)

**Files:**

- Create: `web/src/lib/components/global-search/global-search-section.svelte`
- Create: `web/src/lib/components/global-search/global-search.svelte`
- Create: `__tests__/global-search.spec.ts`

**Context:** `global-search-section.svelte` renders heading + skeleton or item rows + optional "See all" footer. `global-search.svelte` is the `Command.Dialog` root that pulls from `GlobalSearchManager`.

**Step 1: Write failing tests**

```ts
import { render, screen } from '@testing-library/svelte';
import GlobalSearch from '../global-search.svelte';
import { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';

describe('global-search root', () => {
  it('renders dialog role when open', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByRole('dialog', { name: /global search/i })).toBeInTheDocument();
  });

  it('renders sections with skeleton when loading', () => {
    const m = new GlobalSearchManager();
    m.open();
    m.sections.photos = { status: 'loading' };
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByTestId('skeleton-photos')).toBeInTheDocument();
  });

  it('Esc press once clears input, twice closes', async () => {
    const m = new GlobalSearchManager();
    m.open();
    m.setQuery('hello');
    const { user } = render(GlobalSearch, { props: { manager: m } });
    await user.keyboard('{Escape}');
    expect(m.query).toBe('');
    expect(m.isOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(m.isOpen).toBe(false);
  });

  it('Ctrl+K closes when already open', async () => {
    const m = new GlobalSearchManager();
    m.open();
    const { user } = render(GlobalSearch, { props: { manager: m } });
    await user.keyboard('{Control>}k{/Control}');
    expect(m.isOpen).toBe(false);
  });

  it('renders helper row when RECENT and SUGGESTED are empty', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByText(/start typing — photos, people, places, tags/i)).toBeInTheDocument();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

`global-search-section.svelte`:

```svelte
<script lang="ts" generics="T">
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  interface Props<T> {
    heading: string;
    status: ProviderStatus<T>;
    topN: number;
    renderRow: (item: T, isActive: boolean) => unknown; // use snippet
    onSeeAll?: () => void;
    activeItemId: string | null;
    getItemId: (item: T) => string;
    testId?: string;
  }
  let { heading, status, renderRow, onSeeAll, activeItemId, getItemId, testId }: Props<T> = $props();
</script>

<div role="group" aria-labelledby="{heading}-heading" class="mb-4">
  <div id="{heading}-heading" class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
    {heading}
  </div>
  {#if status.status === 'loading'}
    <div data-testid="skeleton-{testId}">
      {#each { length: 3 }}
        <div class="h-[52px] animate-pulse rounded-lg bg-subtle/50" />
      {/each}
    </div>
  {:else if status.status === 'ok'}
    {#each status.items as item (getItemId(item))}
      {@render renderRow(item, getItemId(item) === activeItemId)}
    {/each}
    {#if status.total > status.items.length && onSeeAll}
      <button type="button" onclick={onSeeAll} class="mt-1 flex w-full items-center justify-between px-3 py-2 text-xs text-primary">
        <span>See all {status.total}</span>
        <span>→</span>
      </button>
    {/if}
  {:else if status.status === 'timeout'}
    <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Search is slow — results may be incomplete</div>
  {:else if status.status === 'error'}
    <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">Couldn't load {heading.toLowerCase()} — retry</div>
  {:else if status.status === 'empty'}
    <!-- skip -->
  {/if}
</div>
```

`global-search.svelte`:

```svelte
<script lang="ts">
  import { Command } from 'bits-ui';
  import type { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { t } from 'svelte-i18n';
  import GlobalSearchSection from './global-search-section.svelte';
  import PhotoRow from './rows/photo-row.svelte';
  import PersonRow from './rows/person-row.svelte';
  import PlaceRow from './rows/place-row.svelte';
  import TagRow from './rows/tag-row.svelte';
  import { getEntries } from '$lib/stores/cmdk-recent';

  interface Props { manager: GlobalSearchManager; }
  let { manager }: Props = $props();

  let inputValue = $state('');
  $effect(() => { manager.setQuery(inputValue); });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (inputValue !== '') {
        inputValue = '';
        e.preventDefault();
      } else {
        manager.close();
        e.preventDefault();
      }
    }
    if (e.ctrlKey && e.key === 'k') {
      manager.close();
      e.preventDefault();
    }
  }

  const showEmptyState = $derived(
    inputValue.trim() === '' &&
    manager.sections.photos.status === 'idle',
  );
  const recentEntries = $derived(showEmptyState ? getEntries() : []);
</script>

<Command.Dialog
  bind:open={manager.isOpen}
  label={$t('global_search')}
  class="... /* from design doc dimensions */"
>
  <Command.Root shouldFilter={false}>
    <Command.Input bind:value={inputValue} placeholder={$t('cmdk_placeholder')} onkeydown={onKeyDown} maxlength={256} />
    <Command.List>
      {#if showEmptyState}
        {#if recentEntries.length > 0}
          <!-- RECENT section -->
        {:else}
          <div class="p-6 text-center text-sm text-gray-500 dark:text-gray-400">
            {$t('cmdk_helper')}
          </div>
        {/if}
      {:else}
        <GlobalSearchSection heading="PHOTOS" status={manager.sections.photos} topN={5} /* ... */ />
        <GlobalSearchSection heading="PEOPLE" status={manager.sections.people} topN={5} /* ... */ />
        <GlobalSearchSection heading="PLACES" status={manager.sections.places} topN={3} /* ... */ />
        <GlobalSearchSection heading="TAGS" status={manager.sections.tags} topN={5} /* ... */ />
      {/if}
    </Command.List>
  </Command.Root>
</Command.Dialog>
```

This is a sketch — fill in the remaining prop wiring (renderRow snippets, onSeeAll handlers) during implementation. The `i18n` keys `global_search`, `cmdk_placeholder`, `cmdk_helper` are added in Task 18 but we reference them here as placeholders and add them properly later.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search.svelte \
  web/src/lib/components/global-search/global-search-section.svelte \
  web/src/lib/components/global-search/__tests__/global-search.spec.ts
git commit -m "feat(web): GlobalSearch root + section component with Command.Dialog"
```

---

## Task 15 — Trigger button, layout registration, delete old Ctrl+K, update ShortcutsModal

**Files:**

- Create: `web/src/lib/components/global-search/global-search-trigger.svelte`
- Modify: `web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte:86–89` (desktop slot only)
- Modify: `web/src/routes/+layout.svelte` (register `Ctrl+K`, re-register `Ctrl+Shift+K`, mount `<GlobalSearch />`)
- Modify: `web/src/lib/components/shared-components/search-bar/search-bar.svelte:246` (delete the `Ctrl+K` document binding)
- Modify: `web/src/lib/modals/ShortcutsModal.svelte:34–35` (update rows)

**Context:** This is the "everything clicks into place" task. The mobile `<IconButton>` at `navigation-bar.svelte:93–105` is **not** touched — mobile users keep their direct link to `/search`.

**Step 1: Write failing E2E-style tests** (in a component test — full E2E is Task 20)

```ts
// In global-search.spec.ts
it('global Ctrl+K opens the palette from a +layout.svelte mount', async () => {
  render(Layout, { props: { children: null } });
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(screen.getByRole('dialog', { name: /global search/i })).toBeInTheDocument();
});

it('feature flag off: Ctrl+K is a no-op and trigger is hidden', async () => {
  featureFlagsManager.value.search = false;
  render(Layout, { props: { children: null } });
  expect(screen.queryByRole('button', { name: /search/i })).toBeNull();
  await userEvent.keyboard('{Control>}k{/Control}');
  expect(screen.queryByRole('dialog')).toBeNull();
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Create `global-search-trigger.svelte`:

```svelte
<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { mdiMagnify } from '@mdi/js';
  import Icon from '$lib/elements/Icon.svelte';
</script>

{#if featureFlagsManager.value.search}
  <button
    type="button"
    onclick={() => globalSearchManager.open()}
    class="flex items-center gap-2 rounded-lg border border-gray-200 bg-subtle/60 px-3 py-2 text-sm text-gray-500 hover:bg-subtle dark:border-gray-700 dark:text-gray-400"
  >
    <Icon path={mdiMagnify} size="16" />
    <span class="flex-1 text-left">Search…</span>
    <span class="font-mono text-[11px]">⌘K</span>
  </button>
{/if}
```

Create a singleton export at the top of `global-search-manager.svelte.ts`:

```ts
export const globalSearchManager = new GlobalSearchManager();
```

Edit `navigation-bar.svelte:86–89`:

```svelte
{#if $sideBarSettings.showBar}
  <div class="hidden w-full max-w-5xl flex-1 tall:ps-0 sm:block">
    <GlobalSearchTrigger />
  </div>
{/if}
```

Leave lines 93–105 (mobile magnify IconButton with `href={Route.search()}`) untouched.

Edit `+layout.svelte` — add near the existing shortcut registrations:

```svelte
<svelte:document
  use:shortcuts={[
    {
      shortcut: { ctrl: true, key: 'k' },
      onShortcut: () => {
        if (featureFlagsManager.value.search) globalSearchManager.toggle();
      },
    },
    {
      shortcut: { ctrl: true, shift: true, key: 'K' },
      onShortcut: () => modalManager.open(SearchFilterModal),
    },
    // ... existing Ctrl+Shift+M etc ...
  ]}
/>
{#if globalSearchManager.isOpen}
  <GlobalSearch manager={globalSearchManager} />
{/if}
```

Edit `search-bar.svelte:246` — remove the Ctrl+K binding:

```svelte
<!-- BEFORE -->
<svelte:document
  use:shortcuts={[
    { shortcut: { ctrl: true, key: 'k' }, onShortcut: () => input?.select() },
    { shortcut: { ctrl: true, shift: true, key: 'K' }, onShortcut: onFilterClick },
  ]}
/>

<!-- AFTER -->
<svelte:document
  use:shortcuts={[
    { shortcut: { ctrl: true, shift: true, key: 'K' }, onShortcut: onFilterClick },
  ]}
/>
```

Edit `ShortcutsModal.svelte:34–35` — update the description for `Ctrl+K` to "Open global search" and add a new row for `Ctrl+/` → "Cycle search mode".

**Step 4: Run — expect pass**

```bash
cd web && pnpm test
```

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search-trigger.svelte \
  web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte \
  web/src/routes/+layout.svelte \
  web/src/lib/components/shared-components/search-bar/search-bar.svelte \
  web/src/lib/modals/ShortcutsModal.svelte
git commit -m "feat(web): wire trigger button, global Ctrl+K, and layout mount"
```

---

## Task 16 — Preview pane components

**Files:**

- Create: `web/src/lib/components/global-search/global-search-preview.svelte`
- Create: `web/src/lib/components/global-search/previews/photo-preview.svelte`
- Create: `web/src/lib/components/global-search/previews/person-preview.svelte`
- Create: `web/src/lib/components/global-search/previews/place-preview.svelte`
- Create: `web/src/lib/components/global-search/previews/tag-preview.svelte`
- Tests: `__tests__/<preview>.spec.ts` per component

**Context:** Type-dispatched preview. Generation-counter staleness check. 300 ms dwell before fetching. Empty-state text for place / tag when the user has no photos in the scope.

**Step 1: Write failing tests** (sample for tag-preview)

```ts
it('defers fetch for 300ms after cursor stop', async () => {
  vi.useFakeTimers();
  const fetchSpy = vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
  render(TagPreview, { props: { tag: { id: 't1', value: 'beach' }, active: true } });
  vi.advanceTimersByTime(200);
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(150);
  await vi.runAllTimersAsync();
  expect(fetchSpy).toHaveBeenCalledOnce();
});

it('discards late response after active item changes', async () => {
  // Mount preview for tag A, fast-forward past 300ms, inflight fetch.
  // Unmount / prop change to tag B.
  // Resolve tag A's fetch.
  // Assert the rendered grid still reflects tag B, not tag A.
});

it('shows "No photos tagged yet" when fetch returns empty', async () => {
  vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
  render(TagPreview, { props: { tag: { id: 't1', value: 'beach' }, active: true } });
  await vi.runAllTimersAsync();
  expect(screen.getByText(/no photos tagged yet/i)).toBeInTheDocument();
});
```

Similar specs for `photo-preview` (EXIF strip), `person-preview` (face + recent strip), `place-preview` (static map + "No photos here yet" empty state).

**Step 2: Run — expect failure**

**Step 3: Implement**

Each preview follows this skeleton:

```svelte
<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { searchAssets } from '@immich/sdk';

  interface Props { tag: { id: string; value: string }; active: boolean; }
  let { tag, active }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;
  let dwellTimer: ReturnType<typeof setTimeout> | null = null;
  let ctrl: AbortController | null = null;

  $effect(() => {
    const gen = ++generation;
    const tagId = tag.id;
    if (dwellTimer) clearTimeout(dwellTimer);
    ctrl?.abort();
    photos = [];
    loaded = false;
    dwellTimer = setTimeout(async () => {
      ctrl = new AbortController();
      try {
        const response = await searchAssets({ metadataSearchDto: { tagIds: [tagId], size: 6 } }, { signal: ctrl.signal });
        if (gen !== generation) return;
        photos = response.assets.items;
        loaded = true;
      } catch (err: any) {
        if (err.name !== 'AbortError') loaded = true;
      }
    }, 300);
    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
      ctrl?.abort();
    };
  });
</script>

<div class="p-5">
  <div class="text-base font-semibold">{tag.value}</div>
  {#if !loaded}
    <!-- tiny spinner -->
  {:else if photos.length === 0}
    <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">No photos tagged yet</div>
  {:else}
    <div class="mt-3 grid grid-cols-3 gap-2">
      {#each photos as photo (photo.id)}
        <img src={createUrl(/* thumb url */)} alt="" class="h-[72px] w-[72px] rounded-md object-cover" />
      {/each}
    </div>
  {/if}
</div>
```

`global-search-preview.svelte` is a type dispatcher:

```svelte
<script lang="ts">
  import PhotoPreview from './previews/photo-preview.svelte';
  import PersonPreview from './previews/person-preview.svelte';
  import PlacePreview from './previews/place-preview.svelte';
  import TagPreview from './previews/tag-preview.svelte';

  interface Props { activeItem: { kind: 'photo' | 'person' | 'place' | 'tag'; data: unknown } | null; }
  let { activeItem }: Props = $props();
</script>

{#if activeItem === null}
  <div class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400 opacity-40">
    <!-- faded Gallery logo -->
  </div>
{:else if activeItem.kind === 'photo'}
  <PhotoPreview photo={activeItem.data} />
{:else if activeItem.kind === 'person'}
  <PersonPreview person={activeItem.data} />
{:else if activeItem.kind === 'place'}
  <PlacePreview place={activeItem.data} />
{:else if activeItem.kind === 'tag'}
  <TagPreview tag={activeItem.data} active={true} />
{/if}
```

Mount `<GlobalSearchPreview>` in `global-search.svelte` only when viewport ≥ 1024 px. Gate via a media-query rune: `const showPreview = $derived(mediaQuery.matches('(min-width: 1024px)'))`. Check `media-query-manager.svelte.ts` for the existing helper pattern.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search-preview.svelte \
  web/src/lib/components/global-search/previews/ \
  web/src/lib/components/global-search/__tests__/
git commit -m "feat(web): preview pane components with staleness + empty states"
```

---

## Task 17 — ML health client probe + banner + retroactive promotion

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (add `probeMlHealth()`, retroactive promotion hook)
- Modify: `web/src/lib/components/global-search/global-search.svelte` (render banner)
- Tests: extend `global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests**

```ts
import { getServerMlHealth } from '@immich/sdk';
vi.mock('@immich/sdk');

describe('ML health', () => {
  beforeEach(() => {
    vi.mocked(getServerMlHealth).mockResolvedValue({ smartSearchHealthy: true } as any);
  });

  it('probes on first open, caches for session', async () => {
    const m = new GlobalSearchManager();
    await m.open();
    await m.close();
    await m.open();
    expect(getServerMlHealth).toHaveBeenCalledOnce();
  });

  it('sets mlHealthy=false when probe reports unhealthy', async () => {
    vi.mocked(getServerMlHealth).mockResolvedValue({ smartSearchHealthy: false } as any);
    const m = new GlobalSearchManager();
    await m.open();
    expect(m.mlHealthy).toBe(false);
  });

  it('retroactively sets mlHealthy=false when photos provider times out in smart mode', async () => {
    const m = new GlobalSearchManager();
    await m.open();
    expect(m.mlHealthy).toBe(true);
    m.sections.photos = { status: 'timeout' }; // simulated
    m['onPhotosStatusChange'](); // trigger the retroactive check
    expect(m.mlHealthy).toBe(false);
  });

  it('does not promote banner on non-smart mode photos failure', async () => {
    const m = new GlobalSearchManager();
    m.mode = 'metadata';
    await m.open();
    m.sections.photos = { status: 'error', message: 'x' };
    m['onPhotosStatusChange']();
    expect(m.mlHealthy).toBe(true);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

In the manager:

```ts
import { getServerMlHealth } from '@immich/sdk';

private mlProbed = false;

async open() {
  this.isOpen = true;
  if (!this.mlProbed) {
    this.mlProbed = true;
    try {
      const result = await getServerMlHealth();
      this.mlHealthy = result.smartSearchHealthy;
    } catch {
      // fall back to trusting; retroactive promotion covers it
      this.mlHealthy = true;
    }
  }
}

private onPhotosStatusChange() {
  if (this.mode !== 'smart') return;
  const s = this.sections.photos.status;
  if (s === 'timeout' || s === 'error') this.mlHealthy = false;
}
```

Hook `onPhotosStatusChange` into the provider result handlers in `runBatch` and `setMode`.

In `global-search.svelte`, render the banner inside the Photos section when `manager.mode === 'smart' && !manager.mlHealthy`:

```svelte
{#if manager.mode === 'smart' && !manager.mlHealthy}
  <div class="mx-3 mb-2 rounded-md bg-subtle/60 px-3 py-2 text-xs">
    Smart search is unavailable.
    <button type="button" onclick={() => manager.setMode('metadata')} class="text-primary">Try Filename mode</button>
  </div>
{/if}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts \
  web/src/lib/managers/global-search-manager.svelte.spec.ts \
  web/src/lib/components/global-search/global-search.svelte
git commit -m "feat(web): ML health probe, retroactive banner promotion"
```

---

## Task 18 — i18n keys

**Files:**

- Modify: `i18n/en.json` (and any other language files that exist as source)

**Step 1: Add keys**

Keys to add (with placeholder values — translators fill in):

```
cmdk_helper: "Start typing — photos, people, places, tags."
cmdk_placeholder: "Search Gallery"
cmdk_photos_heading: "Photos"
cmdk_people_heading: "People"
cmdk_places_heading: "Places"
cmdk_tags_heading: "Tags"
cmdk_recent_heading: "Recent"
cmdk_suggested_heading: "Suggested"
cmdk_see_all_photos: "See all {count} photos"
cmdk_smart_unavailable: "Smart search is unavailable"
cmdk_try_filename: "Try Filename mode"
cmdk_slow_results: "Search is slow — results may be incomplete"
cmdk_couldnt_load: "Couldn't load {entity} — retry"
cmdk_no_photos_here: "No photos here yet"
cmdk_no_tagged_photos: "No photos tagged yet"
cmdk_open_action: "Open"
cmdk_add_to_album: "Add to album"
cmdk_tag_cache_too_large: "Too many tags to search in-browser — use the Tags page"
global_search: "Global search"
shortcut_open_global_search: "Open global search"
shortcut_cycle_search_mode: "Cycle search mode"
```

Add them to `i18n/en.json` in whatever place makes sense (or as a new block) — **do not hand-sort**. Let the formatter do it.

**Step 2: Sort and format**

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 3: Verify web build still passes**

```bash
cd web && pnpm check
```

**Step 4: Commit**

```bash
git add i18n/
git commit -m "i18n(web): keys for global search palette"
```

---

## Task 19 — E2E: basic flows (open, type, navigate, activate)

**Files:**

- Create: `e2e/src/specs/web/global-search.e2e-spec.ts`

**Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { utils } from '../../utils';

test.describe('global search palette', () => {
  test.beforeAll(async () => {
    await utils.resetDatabase();
    await utils.createAdminUser();
    // Seed a few assets with known filenames, tags, etc.
    // Drain metadata extraction before asserting on tag-based rows (per feedback_e2e_metadata_extraction_wait).
  });

  test('Ctrl+K opens the palette, types, and navigates a photo', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: /global search/i })).toBeVisible();

    await page.getByRole('combobox').fill('sunset');
    await expect(page.getByTestId('skeleton-photos')).toBeVisible();
    await expect(page.getByTestId('skeleton-photos')).toBeHidden({ timeout: 8000 });

    // first photo row
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/photos\/[a-f0-9-]+/);
  });

  test('Esc clears then closes (APG two-stage)', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('beach');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toHaveValue('');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('mode switch via Ctrl+/ re-runs photos but not people', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('IMG');
    await expect(page.getByTestId('skeleton-photos')).toBeHidden({ timeout: 8000 });
    const peopleCountBefore = await page.getByTestId('row-people').count();
    await page.keyboard.press('Control+/');
    // Photos re-renders
    await expect(page.getByTestId('skeleton-photos')).toBeVisible();
    // People unchanged
    expect(await page.getByTestId('row-people').count()).toBe(peopleCountBefore);
  });
});
```

**Step 2: Run**

```bash
cd e2e && pnpm test:web -- global-search
```

Debug any failures. For flaky parts, gate assertions on `expect.poll`.

**Step 3: Commit**

```bash
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): global search palette basic flows"
```

---

## Task 20 — E2E: ML-unhealthy banner + feature-flag gate

**Files:**

- Modify: `e2e/src/specs/web/global-search.e2e-spec.ts`

**Context:** Gallery's CI runs with ML disabled (per `feedback_ci_preexisting_failures`), which is the natural environment for asserting the banner appears. The feature-flag test needs to toggle `features.search = false` via the admin API or fixture.

**Step 1: Write failing tests**

```ts
test('ML unhealthy: banner appears on palette open in smart mode', async ({ page }) => {
  // ML is disabled in CI, so getMlHealth returns false naturally.
  await page.goto('/photos');
  await page.keyboard.press('Control+k');
  await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
});

test('clicking "Try Filename mode" in the banner switches mode and hides it', async ({ page }) => {
  await page.goto('/photos');
  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: /try filename mode/i }).click();
  await expect(page.getByText(/smart search is unavailable/i)).toBeHidden();
  // mode selector shows Filename now
  await expect(page.getByRole('radio', { name: 'Filename', checked: true })).toBeVisible();
});

test('feature-flag off: Ctrl+K is a no-op and trigger hides', async ({ page }) => {
  await utils.setFeatureFlag('search', false);
  await page.goto('/photos');
  await expect(page.getByRole('button', { name: /search/i })).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeHidden();
  await utils.setFeatureFlag('search', true); // restore
});
```

**Step 2: Run**

```bash
cd e2e && pnpm test:web -- global-search
```

**Step 3: Commit**

```bash
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): ML banner and feature-flag gating"
```

---

## Task 21 — Visual QA pass + final lint/check/test

**Files:** none modified — this is a verification task.

**Step 1: Start the dev stack**

```bash
make dev
```

Wait for web/server/ml to be ready.

**Step 2: Manual QA checklist**

Walk through each item in the design doc's "Visual QA (manual)" section. Specifically at three viewports (1024 × 768, 720 × 600, 480 × 800) in both light and dark modes:

- [ ] Two-pane layout ≥ 1024 px: preview renders, divider is a hairline, no shadow between panes
- [ ] Mid viewport (640–1023 px): preview hidden cleanly, no empty right column
- [ ] Mobile (< 640 px): palette edge-to-edge minus 16 px margin
- [ ] Mobile: existing magnify button still navigates to `/search` (unchanged)
- [ ] Active row tint (`bg-primary/10`) visible in both themes
- [ ] Skeleton pulse matches global `Skeleton.svelte` cadence
- [ ] Motion feels right at specified durations
- [ ] `prefers-reduced-motion` drops everything to instant (enable via DevTools Rendering panel)
- [ ] Navbar reflow is not awkward — trigger button sits in place of old wide SearchBar without crushing other nav elements
- [ ] Each provider returns sensible results for a real query against seeded data (`make env-prep` first)
- [ ] Mode switch via `Ctrl+/` cycles and persists
- [ ] Empty state helper row reads naturally

**Step 3: Toggle ML on/off and confirm banner**

Stop the ML container:

```bash
docker compose -f docker/docker-compose.dev.yml stop immich-machine-learning
```

Open the palette, confirm the Smart-unavailable banner appears. Click "Try Filename mode", confirm the banner hides and photos re-render. Restart ML:

```bash
docker compose -f docker/docker-compose.dev.yml start immich-machine-learning
```

**Step 4: Final automated suites**

```bash
cd server && pnpm check && pnpm lint && pnpm test
cd ../web && pnpm check && pnpm lint && pnpm test
cd ../e2e && pnpm test:web -- global-search
```

All must be green. Per `feedback_no_parallel_tests`, run these sequentially, not in parallel.

**Step 5: Commit the QA sign-off as a doc entry (optional)**

If anything was discovered and fixed during QA, make fix-up commits. Otherwise this task has no commit.

---

## Summary of commits

If everything lands cleanly, the branch will have roughly these commits in order:

1. `feat(ml): per-caller timeoutMs option on predict()`
2. `feat(ml): 15s timeout on encodeText to unstick palette keystrokes`
3. `feat(server): ServerMlHealthResponseDto`
4. `feat(server): getMlHealth() with 30s cache and single-flight`
5. `feat(server): GET /server/ml-health endpoint`
6. `chore(web): add bits-ui as direct dependency for global search palette`
7. `feat(web): GlobalSearchManager skeleton with open/close/toggle`
8. `feat(web): GlobalSearchManager setQuery with debounce and abort`
9. `feat(web): photos, people, places providers for GlobalSearchManager`
10. `feat(web): tag provider with cache, 20k cap, storage-event invalidation`
11. `feat(web): setMode, cursor identity scaffolding, searchQueryType sanity, close() completeness`
12. `feat(web): cmdk.recent localStorage store with quota-preserving writes`
13. `feat(web): row components for global search palette`
14. `feat(web): GlobalSearch root + section component with Command.Dialog`
15. `feat(web): wire trigger button, global Ctrl+K, and layout mount`
16. `feat(web): preview pane components with staleness + empty states`
17. `feat(web): ML health probe, retroactive banner promotion`
18. `i18n(web): keys for global search palette`
19. `test(e2e): global search palette basic flows`
20. `test(e2e): ML banner and feature-flag gating`
21. _(optional QA fix-ups)_

---

## Notes for the executor

- **Read the design doc first.** This plan specifies the _how_; the design doc specifies the _what_ and _why_. Every decision in this plan traces back to a section in the design doc.
- **When in doubt, prefer the existing Gallery convention** over the plan's guess — the plan was written with full review but the codebase evolves. If a test file imports something that doesn't exist, grep for the real helper and use it. If `SvelteMap`/`SvelteSet` / `getAssetThumbnailUrl` / `createUrl` live at different paths than I've written, use the real paths.
- **Don't skip the confirm-failure step of TDD.** It's the only evidence the test actually exercises the new code.
- **Commit every task separately** — the 20+ commits are a feature, not a bug. They make code review tractable and rollback surgical.
- **Svelte 5 specifics:** if you hit "can't mutate $state inside $derived" warnings, extract the mutation into an `$effect`(per`feedback_svelte_derived_no_mutation`).
- **Never merge PRs without explicit user confirmation** (per `feedback_never_merge_without_asking`). This plan produces the branch; merging is a separate explicit step.
