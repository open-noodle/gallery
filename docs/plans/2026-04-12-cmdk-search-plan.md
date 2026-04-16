# Cmd/Ctrl+K Multi-Entity Search Palette — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Gallery's inline header search bar with a keyboard-first global palette (Ctrl+K) that surfaces mixed-entity results (photos, people, places, tags) with a right-side preview pane, streaming per-section and gracefully degrading when ML is unhealthy.

**Architecture:** A new `GlobalSearchManager` singleton on the web side orchestrates four provider calls (smart/metadata search, people, places, tag-name client filter over a cached `getAllTags()`) via parallel `AbortController`-composed signals with a 150 ms debounce and 5 s per-provider timeout. `@immich/ui` `Modal` wraps Bits UI `Command.Root` to give the palette a dialog role + focus trap consistent with the rest of Gallery. A small authenticated server endpoint (`GET /api/server/ml-health`) and a targeted per-caller `predict()` timeout fix cover the "ML is hung" failure mode.

**Tech Stack:** SvelteKit 2 + Svelte 5 (runes), `bits-ui` `Command`, `@immich/ui` `Modal`, NestJS 11, Kysely, vitest, Playwright.

**Design doc:** [`docs/plans/2026-04-12-cmdk-search-design.md`](./2026-04-12-cmdk-search-design.md) — read before starting. This plan implements that design.

**Worktree:** `.worktrees/cmdk-search-research` on branch `research/cmdk-search`. Run every task from the worktree root.

---

## Verified ground truth (all checked against real source — trust these)

- **Controller prefix:** `@Controller('server')`, endpoint is `GET /api/server/ml-health`. The SDK generator emits a function whose name matches the controller method (`getAboutInfo`, `getStorage` precedents). Controller method `getMlHealth` → SDK export `getMlHealth`.
- **DTO field names:** `TagResponseDto.name` (not `value`); `MetadataSearchDto.ocr` (not `ocrText`).
- **Helpers:** `createUrl` at `web/src/lib/utils.ts:174`, imported as `import { createUrl } from '$lib/utils'`. `getAssetMediaUrl` at `web/src/lib/utils.ts:233` — takes `{ id, size, cacheKey? }` and returns a usable path. Do NOT additionally wrap in `createUrl`.
- **Manager location:** `web/src/lib/managers/*.svelte.ts` is where rune-stateful singletons live (see `activity-manager`, `auth-manager`, `asset-viewer-manager`). Plain async API wrappers live at `web/src/lib/services/`.
- **Controller test harness:** `mockBaseService(Service)` + `controllerSetup(Controller, providers)` → `ctx`. Auth is asserted via `expect(ctx.authenticate).toHaveBeenCalled()` — do NOT send a Bearer token, the guard is mocked. See `server/src/controllers/server.controller.spec.ts`.
- **ML repo test harness:** `vi.stubGlobal('fetch', mockFetch)` at module scope, `sut = new MachineLearningRepository(automock(LoggingRepository, { args: [, { getEnv: () => ({}) }], strict: false }))` + `sut.setup({...full config...})` in `beforeEach`. See `server/src/repositories/machine-learning.repository.spec.ts`.
- **`@immich/ui` Modal** props: `{ title?, icon?, size?, class?, expandable?, closeOnEsc?, closeOnBackdropClick?, focusOnOpen?, children: Snippet, onClose?, onEscapeKeydown?, onOpenAutoFocus? }`. Handles dialog role, focus trap, Esc, backdrop click. We set `closeOnEsc={false}` and handle Esc in our own `onkeydown` to implement APG two-stage behavior.
- **`bits-ui` Command exports** (`@2.16.3`): `Root, Empty, Group, GroupHeading, GroupItems, Input, Item, LinkItem, List, Viewport, Loading, Separator`. **There is no `Dialog`.** We compose via `@immich/ui` Modal wrapping `Command.Root`.
- **Shortcut key casing:** lowercase only, even with shift. `{ ctrl: true, key: 'k' }`, `{ ctrl: true, shift: true, key: 'k' }`. Verified against `search-bar.svelte:246–247`.
- **SDK signatures** (from `open-api/typescript-sdk/src/fetch-client.ts`):
  - `searchSmart({ smartSearchDto }, opts?)` → `{ assets: { items: AssetResponseDto[], nextPage } }`
  - `searchAssets({ metadataSearchDto }, opts?)` → same return shape
  - `searchPerson({ name, withHidden }, opts?)` → `PersonResponseDto[]`
  - `searchPlaces({ name }, opts?)` → `PlacesResponseDto[]`
  - `getAllTags(opts?)` — takes **no** query args; returns `TagResponseDto[]`
- **`searchQueryType` localStorage key:** already used by `search-bar.svelte:184,196` and `SearchFilterModal.svelte:40,44`. Values: `'smart' | 'metadata' | 'description' | 'ocr'`. UI label "Filename" → stored value `'metadata'`.

---

## Conventions for every task

- **TDD cycle:** write failing test → confirm failure → minimal implementation → confirm pass → lint/check → commit. Do not skip the confirm-failure step.
- **Commits:** one logical unit per commit with `feat|fix|test|chore|docs|i18n(scope):` prefixes. **No `Co-Authored-By` trailers.**
- **Before commit:**
  - Server: `cd server && pnpm check && pnpm lint`
  - Web: `cd web && pnpm check && pnpm lint`
- **API changes** (controllers/DTOs) need SDK regen: `cd server && pnpm sync:open-api && cd .. && make open-api`. Commit the regenerated files in the same commit.
- **i18n:** any new user-visible string needs a key. Never hand-sort — run `pnpm --filter=immich-i18n format:fix` before committing (per `feedback_i18n_key_sorting`).
- **Thumbnails:** `getAssetMediaUrl({ id, size: AssetMediaSize.Thumbnail, cacheKey: asset.thumbhash })` from `$lib/utils`. Do not additionally wrap in `createUrl`.
- **Svelte 5:**
  - `SvelteMap`/`SvelteSet` in `.svelte` files (per `feedback_svelte_map_lint`).
  - Never mutate `$state` from inside `$derived` (per `feedback_svelte_derived_no_mutation`).
- **Component tests:** mock `@immich/ui` `IconButton` → `Button` to avoid Tooltip.Provider context errors (per `feedback_iconbutton_test_mock`).
- **Manager spec `beforeEach`:** always `localStorage.clear()` to prevent test-order dependence.
- **Vitest fake timers + `AbortSignal.timeout`:** vitest's fake timers do NOT intercept `AbortSignal.timeout` by default. For tests that advance past a 5 s timeout, stub `AbortSignal.timeout` via the helper introduced in Task 8.

---

## Task 1 — Per-caller `timeoutMs` option in `predict()`

**Files:**

- Modify: `server/src/repositories/machine-learning.repository.ts` — `predict()` around line 186
- Modify: `server/src/repositories/machine-learning.repository.spec.ts` — add a `describe('predict()')` block

**Context:** `predict()` is the choke point for five ML tasks (`detectFaces`, `encodeImage`, `encodeText`, `ocr`, `detectPets`). A blanket timeout would regress long-running background jobs. Per-caller opt-in means only `encodeText` (the palette hot path) gets a 15 s cap in Task 2.

**Step 1: Write failing tests**

The existing spec already stubs `fetch` via `vi.stubGlobal('fetch', mockFetch)` and constructs `sut` via `new MachineLearningRepository(automock(...))` + `sut.setup({...})`. Use that pattern — do NOT invent a helper. Append:

```ts
describe('predict()', () => {
  it('propagates AbortError when caller-supplied timeoutMs elapses', async () => {
    mockFetch.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('timeout'), { name: 'AbortError' })),
          );
        }),
    );
    await expect(
      sut['predict'](
        { imagePath: '/tmp/x.jpg' },
        { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName: 'clip' } } },
        { timeoutMs: 50 },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not apply any timeout when caller omits timeoutMs (backward compat)', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ [ModelTask.SEARCH]: 'embedding' }) });
    await expect(
      sut['predict'](
        { imagePath: '/tmp/x.jpg' },
        { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName: 'clip' } } },
      ),
    ).resolves.toBeDefined();
    const [, init] = mockFetch.mock.calls[0] as [URL, RequestInit];
    expect(init.signal).toBeUndefined();
  });

  it('different callers can pass different timeoutMs values (option is per-call)', async () => {
    const signalsUsed: (AbortSignal | undefined)[] = [];
    mockFetch.mockImplementation((_url: URL, init: RequestInit) => {
      signalsUsed.push(init.signal ?? undefined);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ [ModelTask.SEARCH]: 'x' }) });
    });
    await sut['predict'](
      { imagePath: '/a' },
      { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName: 'clip' } } },
      { timeoutMs: 100 },
    );
    await sut['predict'](
      { imagePath: '/b' },
      { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName: 'clip' } } },
      { timeoutMs: 5000 },
    );
    await sut['predict']({ imagePath: '/c' }, { [ModelTask.SEARCH]: { [ModelType.VISUAL]: { modelName: 'clip' } } });
    expect(signalsUsed[0]).toBeInstanceOf(AbortSignal);
    expect(signalsUsed[1]).toBeInstanceOf(AbortSignal);
    expect(signalsUsed[2]).toBeUndefined();
    expect(signalsUsed[0]).not.toBe(signalsUsed[1]);
  });
});
```

**Step 2: Run — expect failure**

```bash
cd server && pnpm test -- --run src/repositories/machine-learning.repository.spec.ts
```

Expected: tests fail on the 3rd argument type.

**Step 3: Minimal implementation**

Edit `predict()`:

```ts
private async predict<T>(
  payload: ModelPayload,
  config: MachineLearningRequest,
  options?: { timeoutMs?: number },
): Promise<T> {
  const formData = await this.getFormData(payload, config);
  const signal = options?.timeoutMs === undefined ? undefined : AbortSignal.timeout(options.timeoutMs);

  for (const url of [
    ...this.config.urls.filter((url) => this.isHealthy(url)),
    ...this.config.urls.filter((url) => !this.isHealthy(url)),
  ]) {
    try {
      const response = await fetch(new URL('/predict', url), { method: 'POST', body: formData, signal });
      if (response.ok) {
        this.setHealthy(url, true);
        return response.json();
      }
      this.logger.warn(
        `Machine learning request to "${url}" failed with status ${response.status}: ${response.statusText}`,
      );
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw error; // caller timeout; don't mark URL unhealthy
      }
      this.logger.warn(
        `Machine learning request to "${url}" failed: ${error instanceof Error ? error.message : error}`,
      );
    }
    this.setHealthy(url, false);
  }
  throw new Error(`Machine learning request '${JSON.stringify(config)}' failed for all URLs`);
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
git commit -m "feat(ml): per-caller timeoutMs option on predict()"
```

---

## Task 2 — `encodeText` uses 15 s timeout + non-abort error path test

**Files:**

- Modify: `server/src/repositories/machine-learning.repository.ts` — `encodeText()` around line 237
- Modify: `server/src/repositories/machine-learning.repository.spec.ts`

**Step 1: Write failing tests**

```ts
describe('encodeText()', () => {
  it('15s timeout aborts when ML never responds', async () => {
    vi.useFakeTimers();
    const originalTimeout = AbortSignal.timeout;
    AbortSignal.timeout = (ms: number) => {
      const c = new AbortController();
      setTimeout(() => c.abort(new DOMException('timeout', 'TimeoutError')), ms);
      return c.signal;
    };
    mockFetch.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'AbortError' })));
        }),
    );
    const promise = sut.encodeText('hello', { language: 'en', modelName: 'clip' });
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    AbortSignal.timeout = originalTimeout;
    vi.useRealTimers();
  });

  it('non-abort errors still surface as the multi-URL failure', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(sut.encodeText('hello', { language: 'en', modelName: 'clip' })).rejects.toThrow(/failed for all URLs/);
  });

  it('other ML callers do NOT get the 15s timeout (blast radius)', async () => {
    const signalsUsed: (AbortSignal | undefined)[] = [];
    mockFetch.mockImplementation((_url: URL, init: RequestInit) => {
      signalsUsed.push(init.signal ?? undefined);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ [ModelTask.SEARCH]: 'x', imageHeight: 1, imageWidth: 1 }),
      });
    });
    await sut.encodeImage('/data/upload/thumbs/a/b/c.webp', clipConfig);
    expect(signalsUsed[0]).toBeUndefined();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```ts
async encodeText(text: string, { language, modelName }: TextEncodingOptions) {
  const request = { [ModelTask.SEARCH]: { [ModelType.TEXTUAL]: { modelName, options: { language } } } };
  const response = await this.predict<ClipTextualResponse>({ text }, request, { timeoutMs: 15_000 });
  return response[ModelTask.SEARCH];
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/repositories/machine-learning.repository.ts server/src/repositories/machine-learning.repository.spec.ts
git commit -m "feat(ml): 15s timeout on encodeText for palette hot path"
```

---

## Task 3 — `ServerMlHealthResponseDto` + `MachineLearningRepository.ping()`

**Files:**

- Modify: `server/src/dtos/server.dto.ts` — add DTO near `ServerAboutResponseDto`
- Modify: `server/src/repositories/machine-learning.repository.ts` — add public `ping()` method
- Modify: `server/src/repositories/machine-learning.repository.spec.ts` — add `ping()` cases

**Step 1: Add DTO**

```ts
// server.dto.ts
export class ServerMlHealthResponseDto {
  smartSearchHealthy!: boolean;
}
```

**Step 2: Write failing tests for `ping()`**

```ts
describe('ping()', () => {
  it('returns { ok: true, contentType } when /ping responds with JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    await expect(sut.ping()).resolves.toEqual({ ok: true, contentType: 'application/json' });
  });

  it('returns { ok: false, contentType: null } on timeout/abort', async () => {
    mockFetch.mockImplementation(
      (_url: URL, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('t'), { name: 'AbortError' })));
        }),
    );
    await expect(sut.ping()).resolves.toEqual({ ok: false, contentType: null });
  });

  it('returns { ok: true, contentType: "text/html" } when ML returns HTML', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
    });
    await expect(sut.ping()).resolves.toEqual({ ok: true, contentType: 'text/html' });
  });

  it('returns { ok: false, contentType: null } when no URLs configured', async () => {
    sut.setup({ ...baseConfig, urls: [] });
    await expect(sut.ping()).resolves.toEqual({ ok: false, contentType: null });
  });
});
```

(Extract the existing `setup()` config object in the test file into a shared `baseConfig` local so this test can override `urls: []`.)

**Step 3: Implement**

```ts
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

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/dtos/server.dto.ts server/src/repositories/machine-learning.repository.ts server/src/repositories/machine-learning.repository.spec.ts
git commit -m "feat(server): ServerMlHealthResponseDto and MachineLearningRepository.ping()"
```

---

## Task 4 — `ServerService.getMlHealth()` with cache + single-flight

**Files:**

- Modify: `server/src/services/server.service.ts`
- Modify: `server/src/services/server.service.spec.ts`

**Context:** 30 s in-process cache, single-flight guard, content-type validation. Includes a race-safety test: a stale "false" result landing after a cached "true" must not overwrite.

**Step 1: Write failing tests**

First grep `server.service.spec.ts` to confirm whether it uses `newTestService(ServerService)` or a similar factory. Match that pattern. The mock repository accessor is typically `mocks.machineLearning`.

```ts
describe('getMlHealth()', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    (sut as any).mlHealthCache = undefined;
    (sut as any).mlHealthInFlight = undefined;
  });
  afterEach(() => vi.useRealTimers());

  it('returns true when /ping is 200 + JSON', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'application/json' });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: true });
  });

  it('returns false on ping failure', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: false, contentType: null });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: false });
  });

  it('returns false on 200 text/html (reverse-proxy error page)', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'text/html' });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: false });
  });

  it('returns false when content-type is null', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: null });
    await expect(sut.getMlHealth()).resolves.toEqual({ smartSearchHealthy: false });
  });

  it('caches for 30 seconds', async () => {
    mocks.machineLearning.ping.mockResolvedValue({ ok: true, contentType: 'application/json' });
    await sut.getMlHealth();
    await sut.getMlHealth();
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_001);
    await sut.getMlHealth();
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(2);
  });

  it('single-flight: concurrent callers share one in-flight probe', async () => {
    let resolveProbe!: (v: { ok: boolean; contentType: string }) => void;
    mocks.machineLearning.ping.mockImplementation(() => new Promise((r) => (resolveProbe = r)));
    const [a, b, c] = [sut.getMlHealth(), sut.getMlHealth(), sut.getMlHealth()];
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(1);
    resolveProbe({ ok: true, contentType: 'application/json' });
    const results = await Promise.all([a, b, c]);
    expect(results.every((r) => r.smartSearchHealthy === true)).toBe(true);
  });

  it('stale probe result does not overwrite a fresher cached value', async () => {
    mocks.machineLearning.ping.mockResolvedValueOnce({ ok: true, contentType: 'application/json' });
    await sut.getMlHealth();
    mocks.machineLearning.ping.mockResolvedValueOnce({ ok: false, contentType: null });
    await sut.getMlHealth(); // served from cache; ping not re-called
    expect((sut as any).mlHealthCache.value).toEqual({ smartSearchHealthy: true });
    expect(mocks.machineLearning.ping).toHaveBeenCalledTimes(1);
  });
});
```

**Step 2: Run — expect failure**

If `mocks.machineLearning.ping` is undefined, the automock picks it up as soon as `ping()` exists on the real class (Task 3 adds it). If the test harness uses manual mock factories, add `ping: vi.fn()`.

**Step 3: Implement**

```ts
// server.service.ts
import { ServerMlHealthResponseDto } from 'src/dtos/server.dto';

export class ServerService extends BaseService {
  private mlHealthCache?: { value: ServerMlHealthResponseDto; expiresAt: number };
  private mlHealthInFlight?: Promise<ServerMlHealthResponseDto>;

  async getMlHealth(): Promise<ServerMlHealthResponseDto> {
    const now = Date.now();
    if (this.mlHealthCache && this.mlHealthCache.expiresAt > now) {
      return this.mlHealthCache.value;
    }
    if (this.mlHealthInFlight) return this.mlHealthInFlight;
    this.mlHealthInFlight = (async () => {
      try {
        const { ok, contentType } = await this.machineLearningRepository.ping();
        const healthy = ok && (contentType?.includes('application/json') ?? false);
        const value: ServerMlHealthResponseDto = { smartSearchHealthy: healthy };
        this.mlHealthCache = { value, expiresAt: Date.now() + 30_000 };
        return value;
      } finally {
        this.mlHealthInFlight = undefined;
      }
    })();
    return this.mlHealthInFlight;
  }
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/services/server.service.ts server/src/services/server.service.spec.ts
git commit -m "feat(server): getMlHealth() with cache, single-flight, content-type check"
```

---

## Task 5 — `GET /api/server/ml-health` controller route

**Files:**

- Modify: `server/src/controllers/server.controller.ts`
- Modify: `server/src/controllers/server.controller.spec.ts`

**Step 1: Write failing tests — follow the real convention**

The existing spec uses `mockBaseService(ServerService)` + `controllerSetup(ServerController, [providers])` with `request(ctx.getHttpServer())` and `expect(ctx.authenticate).toHaveBeenCalled()`. Mirror that pattern:

```ts
describe('GET /server/ml-health', () => {
  it('should be an authenticated route', async () => {
    await request(ctx.getHttpServer()).get('/server/ml-health');
    expect(ctx.authenticate).toHaveBeenCalled();
  });

  it('returns { smartSearchHealthy: true } when service reports healthy', async () => {
    serverService.getMlHealth.mockResolvedValue({ smartSearchHealthy: true });
    const { status, body } = await request(ctx.getHttpServer()).get('/server/ml-health');
    expect(status).toBe(200);
    expect(body).toEqual({ smartSearchHealthy: true });
  });

  it('returns { smartSearchHealthy: false } when service reports unhealthy', async () => {
    serverService.getMlHealth.mockResolvedValue({ smartSearchHealthy: false });
    const { body } = await request(ctx.getHttpServer()).get('/server/ml-health');
    expect(body).toEqual({ smartSearchHealthy: false });
  });
});
```

**Step 2: Run — expect failure (404 route not registered)**

**Step 3: Implement**

Edit `server.controller.ts`, add near `getAboutInfo`:

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

Import update:

```ts
import { ServerAboutResponseDto, ServerMlHealthResponseDto /* ... */ } from 'src/dtos/server.dto';
```

**Step 4: Run + regen SDKs**

```bash
cd server && pnpm test -- --run src/controllers/server.controller.spec.ts
cd server && pnpm sync:open-api
cd .. && make open-api
```

**Step 5: Commit**

```bash
cd server && pnpm check && pnpm lint
git add server/src/controllers/server.controller.ts server/src/controllers/server.controller.spec.ts open-api/ mobile/openapi/
git commit -m "feat(server): GET /server/ml-health endpoint"
```

---

## Task 6 — Add `bits-ui` as a direct web dependency

**Files:**

- Modify: `web/package.json`

**Step 1: Find the pinned constraint**

```bash
cat node_modules/.pnpm/@immich+ui@*/node_modules/@immich/ui/package.json | grep -E '"bits-ui"'
```

Record the constraint string (e.g. `^2.15.7`). Use the **same constraint** in `web/package.json` so pnpm keeps a single hoisted copy.

**Step 2: Add to `dependencies`, alphabetically**

```json
"bits-ui": "^2.15.7",
```

**Step 3: Install + typecheck**

```bash
pnpm install
cd web && pnpm check
```

**Step 4: Commit**

```bash
git add web/package.json pnpm-lock.yaml
git commit -m "chore(web): add bits-ui as direct dependency for global search palette"
```

---

## Task 7 — `GlobalSearchManager` skeleton with instance-bound providers

**Files:**

- Create: `web/src/lib/managers/global-search-manager.svelte.ts`
- Create: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Follows Gallery's rune-singleton manager convention. `providers` is built as an instance method from the start so Task 10's tag provider doesn't need a refactor. `searchQueryType` is sanity-checked on construction.

**Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GlobalSearchManager } from './global-search-manager.svelte';

describe('GlobalSearchManager (skeleton)', () => {
  let manager: GlobalSearchManager;

  beforeEach(() => {
    localStorage.clear();
    manager = new GlobalSearchManager();
  });

  it('starts closed with empty query and smart mode', () => {
    expect(manager.isOpen).toBe(false);
    expect(manager.query).toBe('');
    expect(manager.mode).toBe('smart');
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
    expect(manager.sections.people).toEqual({ status: 'idle' });
    expect(manager.activeItemId).toBe(null);
  });

  it('toggle() flips state', () => {
    manager.toggle();
    expect(manager.isOpen).toBe(true);
    manager.toggle();
    expect(manager.isOpen).toBe(false);
  });

  it('providers is an instance-bound record with four keys', () => {
    expect(Object.keys((manager as any).providers).sort()).toEqual(['people', 'photos', 'places', 'tags']);
  });

  describe('searchQueryType sanity check', () => {
    it('falls back to smart when localStorage value is invalid', () => {
      localStorage.setItem('searchQueryType', 'evil_value');
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
      expect(localStorage.getItem('searchQueryType')).toBe('smart');
    });

    it('falls back to smart when localStorage value is empty string', () => {
      localStorage.setItem('searchQueryType', '');
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
    });

    it('returns smart when key is absent', () => {
      manager = new GlobalSearchManager();
      expect(manager.mode).toBe('smart');
    });

    it('uses persisted value when valid', () => {
      for (const m of ['smart', 'metadata', 'description', 'ocr'] as const) {
        localStorage.setItem('searchQueryType', m);
        manager = new GlobalSearchManager();
        expect(manager.mode).toBe(m);
      }
    });

    it('falls back to smart and does not throw when localStorage access throws (SSR / privacy mode)', () => {
      // Simulates the SSR path via $app/environment `browser=false`, or a privacy-mode browser that throws on access.
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      expect(() => new GlobalSearchManager()).not.toThrow();
      expect(new GlobalSearchManager().mode).toBe('smart');
      spy.mockRestore();
    });
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Minimal implementation**

```ts
// global-search-manager.svelte.ts
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

export interface Provider<T = unknown> {
  key: keyof Sections;
  topN: number;
  minQueryLength: number;
  run(query: string, mode: SearchMode, signal: AbortSignal): Promise<ProviderStatus<T>>;
}

import { browser } from '$app/environment';

const VALID_MODES: ReadonlySet<SearchMode> = new Set(['smart', 'metadata', 'description', 'ocr']);
const idle: ProviderStatus = { status: 'idle' };

function loadSearchQueryType(): SearchMode {
  // SSR gate — localStorage does not exist in Node during SSR render.
  // Gallery's manager convention uses `browser` from $app/environment
  // (see theme-manager.svelte.ts:1,13 for the precedent).
  if (!browser) return 'smart';
  try {
    const stored = localStorage.getItem('searchQueryType');
    if (stored && VALID_MODES.has(stored as SearchMode)) return stored as SearchMode;
    if (stored !== null) localStorage.setItem('searchQueryType', 'smart');
  } catch {
    // localStorage unavailable (privacy mode) — fall through
  }
  return 'smart';
}

export class GlobalSearchManager {
  isOpen = $state(false);
  query = $state('');
  mode = $state<SearchMode>(loadSearchQueryType());
  sections = $state<Sections>({ photos: idle, people: idle, places: idle, tags: idle });
  activeItemId = $state<string | null>(null);
  mlHealthy = $state(true);

  protected providers: Record<keyof Sections, Provider>;
  protected debounceTimer: ReturnType<typeof setTimeout> | null = null;
  protected batchController: AbortController | null = null;
  protected photosController: AbortController | null = null;

  constructor() {
    this.providers = this.buildProviders();
  }

  open() {
    this.isOpen = true;
  }

  close() {
    this.isOpen = false;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.batchController?.abort();
    this.batchController = null;
    this.photosController?.abort();
    this.photosController = null;
    this.sections = { photos: idle, people: idle, places: idle, tags: idle };
    this.activeItemId = null;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  protected buildProviders(): Record<keyof Sections, Provider> {
    const stub = (key: keyof Sections, topN: number, minLen: number): Provider => ({
      key,
      topN,
      minQueryLength: minLen,
      run: async () => ({ status: 'empty' }),
    });
    return {
      photos: stub('photos', 5, 1),
      people: stub('people', 5, 2),
      places: stub('places', 3, 2),
      tags: stub('tags', 5, 2),
    };
  }
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): GlobalSearchManager skeleton with instance-bound providers"
```

---

## Task 8 — `setQuery` with debounce, abort, timeout, min-query-length

**Files:**

- Create: `web/src/lib/managers/__tests__/fake-abort-timeout.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Introduces the `AbortSignal.timeout` stub that every subsequent test block with `vi.useFakeTimers()` will reuse.

**Step 1: Create the `fake-abort-timeout` helper**

```ts
// fake-abort-timeout.ts
let original: typeof AbortSignal.timeout | undefined;

export function installFakeAbortTimeout() {
  original = AbortSignal.timeout;
  AbortSignal.timeout = (ms: number) => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
    return c.signal;
  };
}

export function restoreAbortTimeout() {
  if (original) AbortSignal.timeout = original;
}
```

**Step 2: Write failing tests**

```ts
import { vi } from 'vitest';
import { installFakeAbortTimeout, restoreAbortTimeout } from './__tests__/fake-abort-timeout';

describe('setQuery', () => {
  let manager: GlobalSearchManager;
  let calls: Array<{ key: string; query: string; mode: SearchMode }>;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    manager = new GlobalSearchManager();
    calls = [];
    const makeStub = (key: keyof Sections, minLen: number): Provider => ({
      key,
      topN: 5,
      minQueryLength: minLen,
      run: async (query, mode, signal) => {
        calls.push({ key, query, mode });
        return new Promise<ProviderStatus>((resolve, reject) => {
          signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          setTimeout(() => resolve({ status: 'ok', items: [], total: 0 }), 0);
        });
      },
    });
    (manager as any).providers = {
      photos: makeStub('photos', 1),
      people: makeStub('people', 2),
      places: makeStub('places', 2),
      tags: makeStub('tags', 2),
    };
  });

  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('empty query sets sections to idle', async () => {
    manager.setQuery('');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls).toEqual([]);
    expect(manager.sections.photos).toEqual({ status: 'idle' });
  });

  it('query length 1 fires only photos', async () => {
    manager.setQuery('a');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.key).sort()).toEqual(['photos']);
  });

  it('query length ≥ 2 fires all four providers', async () => {
    manager.setQuery('ab');
    await vi.advanceTimersByTimeAsync(200);
    expect(calls.map((c) => c.key).sort()).toEqual(['people', 'photos', 'places', 'tags']);
  });

  it('debounces rapid keystrokes — only the last value fires', async () => {
    manager.setQuery('a');
    manager.setQuery('ab');
    manager.setQuery('abc');
    await vi.advanceTimersByTimeAsync(200);
    expect(new Set(calls.map((c) => c.query))).toEqual(new Set(['abc']));
  });

  it('new keystroke aborts previous batch silently', async () => {
    (manager as any).providers.photos.run = (q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('first');
    await vi.advanceTimersByTimeAsync(200);
    manager.setQuery('second');
    await vi.advanceTimersByTimeAsync(200);
    expect(manager.sections.photos.status).not.toBe('timeout');
  });

  it('5 s timeout marks section as timeout when provider never resolves', async () => {
    (manager as any).providers.photos.run = (q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('hang');
    await vi.advanceTimersByTimeAsync(200); // fires debounce
    await vi.advanceTimersByTimeAsync(5_100); // fires fake AbortSignal.timeout
    expect(manager.sections.photos.status).toBe('timeout');
  });

  it('close() aborts in-flight batch silently', async () => {
    (manager as any).providers.photos.run = (q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    manager.setQuery('inflight');
    await vi.advanceTimersByTimeAsync(200);
    manager.close();
    expect(manager.sections.photos.status).toBe('idle');
  });
});
```

**Step 3: Implement**

```ts
// Add to GlobalSearchManager
setQuery(text: string) {
  if (this.query === text) return;
  this.query = text;
  this.clearDebounce();
  this.batchController?.abort();
  this.batchController = null;
  this.photosController?.abort();
  this.photosController = null;

  if (text.trim() === '') {
    this.sections = { photos: idle, people: idle, places: idle, tags: idle };
    return;
  }

  this.sections = {
    photos: { status: 'loading' },
    people: { status: 'loading' },
    places: { status: 'loading' },
    tags: { status: 'loading' },
  };
  this.debounceTimer = setTimeout(() => this.runBatch(text, this.mode), 150);
}

protected runBatch(text: string, mode: SearchMode) {
  this.debounceTimer = null;
  const batch = new AbortController();
  const photos = new AbortController();
  this.batchController = batch;
  this.photosController = photos;

  for (const key of ['photos', 'people', 'places', 'tags'] as const) {
    const provider = this.providers[key];
    if (text.length < provider.minQueryLength) {
      this.sections[key] = idle;
      continue;
    }
    const controllers = key === 'photos' ? [batch.signal, photos.signal] : [batch.signal];
    const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);
    provider
      .run(text, mode, signal)
      .then((result) => {
        if (batch === this.batchController) this.sections[key] = result;
      })
      .catch((err: unknown) => {
        if (batch !== this.batchController) return;
        if (err instanceof Error && err.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections[key] = { status: 'timeout' };
          }
          return;
        }
        const message = err instanceof Error ? err.message : 'unknown error';
        this.sections[key] = { status: 'error', message };
      });
  }
}

private clearDebounce() {
  if (this.debounceTimer !== null) {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts web/src/lib/managers/__tests__/fake-abort-timeout.ts
git commit -m "feat(web): setQuery with debounce, abort, and 5s timeout"
```

---

## Task 9 — Real photos / people / places providers

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` — replace stub `buildProviders()`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests**

```ts
import { searchSmart, searchAssets, searchPerson, searchPlaces } from '@immich/sdk';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  searchSmart: vi.fn(),
  searchAssets: vi.fn(),
  searchPerson: vi.fn(),
  searchPlaces: vi.fn(),
  getAllTags: vi.fn(),
  getMlHealth: vi.fn(),
}));

describe('real providers', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(searchSmart).mockResolvedValue({ assets: { items: [{ id: 'a' }, { id: 'b' }], nextPage: null } } as any);
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
    vi.mocked(searchPerson).mockResolvedValue([{ id: 'p1', name: 'Alice' }] as any);
    vi.mocked(searchPlaces).mockResolvedValue([{ name: 'Santa Cruz', latitude: 36.97, longitude: -122.03 }] as any);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('photos uses searchSmart in smart mode', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchSmart).toHaveBeenCalledOnce();
    expect(m.sections.photos.status).toBe('ok');
  });

  it('photos uses searchAssets with originalFileName in metadata mode', async () => {
    localStorage.setItem('searchQueryType', 'metadata');
    const m = new GlobalSearchManager();
    m.setQuery('IMG_0042');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ originalFileName: 'IMG_0042' }),
      }),
      expect.anything(),
    );
  });

  it('photos uses searchAssets with description field in description mode', async () => {
    localStorage.setItem('searchQueryType', 'description');
    const m = new GlobalSearchManager();
    m.setQuery('sunset');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ description: 'sunset' }),
      }),
      expect.anything(),
    );
  });

  it('photos uses searchAssets with ocr field in ocr mode', async () => {
    localStorage.setItem('searchQueryType', 'ocr');
    const m = new GlobalSearchManager();
    m.setQuery('ACME');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataSearchDto: expect.objectContaining({ ocr: 'ACME' }),
      }),
      expect.anything(),
    );
  });

  it('people provider calls searchPerson with name and withHidden=false', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPerson).toHaveBeenCalledWith(
      { name: 'alice', withHidden: false },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('places provider calls searchPlaces with name', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('santa');
    await vi.advanceTimersByTimeAsync(200);
    expect(searchPlaces).toHaveBeenCalledWith(
      { name: 'santa' },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Replace `buildProviders()` with real SDK-backed providers (keep `tags` as a stub until Task 10):

```ts
import {
  searchSmart, searchAssets, searchPerson, searchPlaces,
  type SmartSearchDto, type MetadataSearchDto,
} from '@immich/sdk';

protected buildProviders(): Record<keyof Sections, Provider> {
  const photos: Provider = {
    key: 'photos', topN: 5, minQueryLength: 1,
    run: async (query, mode, signal) => {
      try {
        if (mode === 'smart') {
          const response = await searchSmart({ smartSearchDto: { query, size: 5 } as SmartSearchDto }, { signal });
          const items = response.assets.items;
          return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
        }
        const metadataSearchDto: MetadataSearchDto = {
          size: 5,
          ...(mode === 'metadata' ? { originalFileName: query } : {}),
          ...(mode === 'description' ? { description: query } : {}),
          ...(mode === 'ocr' ? { ocr: query } : {}),
        };
        const response = await searchAssets({ metadataSearchDto }, { signal });
        const items = response.assets.items;
        return items.length === 0 ? { status: 'empty' } : { status: 'ok', items, total: items.length };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
      }
    },
  };

  const people: Provider = {
    key: 'people', topN: 5, minQueryLength: 2,
    run: async (query, _mode, signal) => {
      try {
        const results = await searchPerson({ name: query, withHidden: false }, { signal });
        return results.length === 0
          ? { status: 'empty' }
          : { status: 'ok', items: results.slice(0, 5), total: results.length };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
      }
    },
  };

  const places: Provider = {
    key: 'places', topN: 3, minQueryLength: 2,
    run: async (query, _mode, signal) => {
      try {
        const results = await searchPlaces({ name: query }, { signal });
        return results.length === 0
          ? { status: 'empty' }
          : { status: 'ok', items: results.slice(0, 3), total: results.length };
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') throw err;
        return { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
      }
    },
  };

  const tagsStub: Provider = { key: 'tags', topN: 5, minQueryLength: 2, run: async () => ({ status: 'empty' }) };

  return { photos, people, places, tags: tagsStub };
}
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): photos, people, places providers"
```

---

## Task 10 — Tag provider with cache, 20 k cap, storage-event invalidation

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Step 1: Write failing tests**

```ts
import { getAllTags } from '@immich/sdk';

describe('tag provider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(getAllTags).mockResolvedValue([
      { id: 't1', name: 'beach', color: null } as any,
      { id: 't2', name: 'beer', color: null } as any,
      { id: 't3', name: 'mountain', color: null } as any,
    ]);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('filters tags by case-insensitive substring on name', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('BE');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags.status).toBe('ok');
    const items = (m.sections.tags as { status: 'ok'; items: Array<{ name: string }> }).items;
    expect(items.map((t) => t.name).sort()).toEqual(['beach', 'beer']);
  });

  it('caches getAllTags across keystrokes', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    m.setQuery('mou');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(1);
  });

  it('close() clears cache; reopen refetches', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    m.close();
    m.open();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });

  it('disables tag provider at > 20 000 tags', async () => {
    vi.mocked(getAllTags).mockResolvedValue(
      Array.from({ length: 20_001 }, (_, i) => ({ id: `t${i}`, name: `tag${i}`, color: null })) as any,
    );
    const m = new GlobalSearchManager();
    m.setQuery('tag');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags).toEqual({ status: 'error', message: 'tag_cache_too_large' });
  });

  it('invalidates cache on storage event for cmdk.tags.version', async () => {
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    window.dispatchEvent(new StorageEvent('storage', { key: 'cmdk.tags.version', newValue: '2' }));
    m.setQuery('mou');
    await vi.advanceTimersByTimeAsync(200);
    expect(getAllTags).toHaveBeenCalledTimes(2);
  });

  it('getAllTags failure renders error row, retries on next keystroke', async () => {
    vi.mocked(getAllTags).mockRejectedValueOnce(new Error('boom'));
    const m = new GlobalSearchManager();
    m.setQuery('be');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags.status).toBe('error');
    vi.mocked(getAllTags).mockResolvedValueOnce([{ id: 't1', name: 'beach', color: null }] as any);
    m.setQuery('bea');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.sections.tags.status).toBe('ok');
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```ts
import { getAllTags, type TagResponseDto } from '@immich/sdk';

// Instance fields
private tagsCache: TagResponseDto[] | null = null;
private tagsDisabled = false;
private storageListener?: (e: StorageEvent) => void;

constructor() {
  this.providers = this.buildProviders();
  // Use the same `browser` gate as loadSearchQueryType — skip any DOM wiring during SSR.
  if (browser) {
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
  // ... existing close logic ...
  this.tagsCache = null;
}

private async runTagsProvider(query: string, signal: AbortSignal): Promise<ProviderStatus<TagResponseDto>> {
  if (this.tagsDisabled) return { status: 'error', message: 'tag_cache_too_large' };
  if (this.tagsCache === null) {
    try {
      const all = await getAllTags({ signal });
      if (all.length > 20_000) {
        this.tagsDisabled = true;
        // eslint-disable-next-line no-console
        console.warn('[cmdk] tag cache > 20k, disabling tag provider for session');
        return { status: 'error', message: 'tag_cache_too_large' };
      }
      if (all.length > 5_000) {
        // eslint-disable-next-line no-console
        console.warn(`[cmdk] tag cache is large (${all.length} entries)`);
      }
      this.tagsCache = all;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err;
      return { status: 'error', message: err instanceof Error ? err.message : 'getAllTags failed' };
    }
  }
  const q = query.toLowerCase();
  const matches = this.tagsCache.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 5);
  return matches.length === 0 ? { status: 'empty' } : { status: 'ok', items: matches, total: matches.length };
}
```

Replace the stub in `buildProviders()`:

```ts
const tags: Provider = {
  key: 'tags',
  topN: 5,
  minQueryLength: 2,
  run: (query, _mode, signal) => this.runTagsProvider(query, signal),
};
return { photos, people, places, tags };
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): tag provider with cache, 20k cap, storage-event invalidation"
```

---

## Task 11 — `setMode`, cursor identity, Enter race, ML health promotion

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`

**Context:** Consolidates remaining manager behavior: mode switching, identity-based cursor tracking, the `getActiveItem()` helper used by Enter, and `mlHealthy` retroactive promotion. Cursor identity lives in the manager (not a component `$effect`) so it's unit-testable.

**Step 1: Write failing tests**

```ts
describe('setMode', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('aborts in-flight photos only, re-runs with new mode; people untouched', async () => {
    let photosCalls = 0;
    let peopleCalls = 0;
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => {
      photosCalls++;
      return { status: 'ok', items: [], total: 0 };
    };
    (m as any).providers.people.run = async () => {
      peopleCalls++;
      return { status: 'ok', items: [], total: 0 };
    };
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosCalls).toBe(1);
    expect(peopleCalls).toBe(1);
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(10);
    expect(photosCalls).toBe(2);
    expect(peopleCalls).toBe(1);
  });

  it('setMode during pending debounce restarts timer with new mode', async () => {
    const m = new GlobalSearchManager();
    const photosRun = vi.fn().mockResolvedValue({ status: 'ok', items: [], total: 0 });
    (m as any).providers.photos.run = photosRun;
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(50);
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosRun).toHaveBeenCalledOnce();
    expect(photosRun).toHaveBeenCalledWith('beach', 'metadata', expect.any(AbortSignal));
  });

  it('persists mode to localStorage', () => {
    const m = new GlobalSearchManager();
    m.setMode('ocr');
    expect(localStorage.getItem('searchQueryType')).toBe('ocr');
  });

  it('setMode with empty query is a no-op for providers', async () => {
    const m = new GlobalSearchManager();
    const photosRun = vi.fn();
    (m as any).providers.photos.run = photosRun;
    m.setMode('metadata');
    await vi.advanceTimersByTimeAsync(200);
    expect(photosRun).not.toHaveBeenCalled();
  });
});

describe('cursor identity', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('preserves activeItemId when a later section populates above it', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.people.run = async () => ({ status: 'ok', items: [{ id: 'p1', name: 'Alice' }], total: 1 });
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('alice');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('person:p1');
    expect(m.activeItemId).toBe('person:p1');
    // Simulate a late photos update that replaces photos items
    m.sections.photos = { status: 'ok', items: [{ id: 'a3' }] as any, total: 1 };
    m.reconcileCursor();
    expect(m.activeItemId).toBe('person:p1');
  });

  it('falls back to first top-section row when tracked id disappears', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('photo:a1');
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a9' }], total: 1 });
    m.setQuery('sunset');
    await vi.advanceTimersByTimeAsync(200);
    expect(m.activeItemId).toBe('photo:a9');
  });
});

describe('Enter race', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('getActiveItem captures the currently-highlighted item by reference', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }], total: 1 });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    m.setActiveItem('photo:a1');
    const active = m.getActiveItem();
    expect(active?.kind).toBe('photo');
    expect((active?.data as { id: string }).id).toBe('a1');
  });

  it('Enter on stale cursor returns null (no-op at call site)', () => {
    const m = new GlobalSearchManager();
    m.activeItemId = 'photo:nonexistent';
    expect(m.getActiveItem()).toBe(null);
  });
});

describe('ML health retroactive promotion', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('sets mlHealthy=false when photos times out in smart mode', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = (_q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5_100); // fires fake AbortSignal.timeout
    expect(m.mlHealthy).toBe(false);
  });

  it('does NOT promote banner in non-smart mode', async () => {
    localStorage.setItem('searchQueryType', 'metadata');
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = (_q: string, _m: SearchMode, signal: AbortSignal) =>
      new Promise<ProviderStatus>((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' })));
      });
    m.setQuery('beach');
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(m.mlHealthy).toBe(true);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Add imports to the top of `global-search-manager.svelte.ts`:

```ts
import { goto } from '$app/navigation';
import { addEntry, makePlaceId, type RecentEntry } from '$lib/stores/cmdk-recent';
import { Route } from '$lib/route';
```

Then add to the manager class body:

```ts
export type ActiveItem =
  | { kind: 'photo' | 'person' | 'place' | 'tag'; data: unknown };

// Active-item API
setActiveItem(id: string | null) {
  this.activeItemId = id;
}

getActiveItem(): ActiveItem | null {
  const id = this.activeItemId;
  if (!id) return null;
  const colon = id.indexOf(':');
  if (colon === -1) return null;
  const kind = id.slice(0, colon);
  const rest = id.slice(colon + 1);
  const section = this.sectionForKind(kind);
  if (!section || section.status !== 'ok') return null;
  const items = (section as { items: Array<{ id?: string; latitude?: number; longitude?: number }> }).items;
  const match = items.find((it) => {
    if (it.id !== undefined) return it.id === rest;
    if (kind === 'place' && it.latitude !== undefined && it.longitude !== undefined) {
      return `${it.latitude.toFixed(4)}:${it.longitude.toFixed(4)}` === rest;
    }
    return false;
  });
  return match ? { kind: kind as ActiveItem['kind'], data: match } : null;
}

private sectionForKind(kind: string): ProviderStatus | null {
  switch (kind) {
    case 'photo': return this.sections.photos;
    case 'person': return this.sections.people;
    case 'place': return this.sections.places;
    case 'tag': return this.sections.tags;
    default: return null;
  }
}

// Called from Command.Item onSelect (Task 14) on Enter or click.
// Dispatches navigation by kind and writes a RecentEntry to cmdk.recent.
activate(kind: 'photo' | 'person' | 'place' | 'tag', item: any) {
  const now = Date.now();
  switch (kind) {
    case 'photo':
      addEntry({ kind: 'photo', id: `photo:${item.id}`, assetId: item.id, label: item.originalFileName ?? '', lastUsed: now });
      goto(`/photos/${item.id}`);
      break;
    case 'person':
      addEntry({ kind: 'person', id: `person:${item.id}`, personId: item.id, label: item.name ?? '', thumbnailAssetId: item.faceAssetId, lastUsed: now });
      goto(Route.viewPerson({ id: item.id }));
      break;
    case 'place':
      addEntry({
        kind: 'place',
        id: makePlaceId(item.latitude, item.longitude),
        latitude: item.latitude,
        longitude: item.longitude,
        label: item.name ?? '',
        lastUsed: now,
      });
      // Route.map uses a hash fragment (#zoom/lat/lng), not query params — verified at web/src/lib/route.ts:89.
      goto(Route.map({ zoom: 12, lat: item.latitude, lng: item.longitude }));
      break;
    case 'tag':
      addEntry({ kind: 'tag', id: `tag:${item.id}`, tagId: item.id, label: item.name ?? '', lastUsed: now });
      // Route.search builds the right search payload for a tag filter.
      goto(Route.search({ tagIds: [item.id] }));
      break;
  }
  this.close();
}

// Called when the user presses Enter on a RECENT row. Re-runs text queries in place;
// re-activates entity entries via navigation.
activateRecent(entry: RecentEntry) {
  const now = Date.now();
  addEntry({ ...entry, lastUsed: now });
  if (entry.kind === 'query') {
    this.setMode(entry.mode);
    this.setQuery(entry.text);
    // Do NOT close — let the user see the fresh results in-place.
    return;
  }
  // Entity entries: rebuild a synthetic item matching the stored fields and dispatch.
  switch (entry.kind) {
    case 'photo': goto(`/photos/${entry.assetId}`); break;
    case 'person': goto(Route.viewPerson({ id: entry.personId })); break;
    case 'place': goto(Route.map({ zoom: 12, lat: entry.latitude, lng: entry.longitude })); break;
    case 'tag': goto(Route.search({ tagIds: [entry.tagId] })); break;
  }
  this.close();
}

reconcileCursor() {
  if (this.getActiveItem() !== null) return;
  const order = ['photos', 'people', 'places', 'tags'] as const;
  const kindOf: Record<keyof Sections, string> = {
    photos: 'photo', people: 'person', places: 'place', tags: 'tag',
  };
  for (const key of order) {
    const s = this.sections[key];
    if (s.status === 'ok' && s.items.length > 0) {
      const first = s.items[0] as { id?: string; latitude?: number; longitude?: number };
      if (first.id !== undefined) {
        this.activeItemId = `${kindOf[key]}:${first.id}`;
        return;
      }
      if (key === 'places' && first.latitude !== undefined && first.longitude !== undefined) {
        this.activeItemId = `place:${first.latitude.toFixed(4)}:${first.longitude.toFixed(4)}`;
        return;
      }
    }
  }
  this.activeItemId = null;
}

private onPhotosSettled() {
  if (this.mode !== 'smart') return;
  const s = this.sections.photos.status;
  if (s === 'timeout' || s === 'error') this.mlHealthy = false;
}

/**
 * Aggregate announcement for the aria-live region in global-search.svelte.
 * Only produces a string once every enabled provider has settled to avoid
 * mid-stream torrents (design § Accessibility). Empty string otherwise.
 */
announcementText = $derived.by(() => {
  const s = this.sections;
  const allSettled =
    s.photos.status !== 'loading' && s.people.status !== 'loading' &&
    s.places.status !== 'loading' && s.tags.status !== 'loading';
  if (!allSettled) return '';
  const parts: string[] = [];
  const count = (st: ProviderStatus) => (st.status === 'ok' ? st.total : 0);
  if (count(s.photos) > 0) parts.push(`${count(s.photos)} photos`);
  if (count(s.people) > 0) parts.push(`${count(s.people)} people`);
  if (count(s.places) > 0) parts.push(`${count(s.places)} places`);
  if (count(s.tags) > 0) parts.push(`${count(s.tags)} tags`);
  return parts.join(', ');
});

setMode(newMode: SearchMode) {
  if (newMode === this.mode) return;
  this.mode = newMode;
  localStorage.setItem('searchQueryType', newMode);

  if (this.debounceTimer !== null) {
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => this.runBatch(this.query, this.mode), 150);
    return;
  }
  if (this.query.trim() === '') return;

  this.photosController?.abort();
  const photos = new AbortController();
  this.photosController = photos;
  const batch = this.batchController;
  const signal = AbortSignal.any([
    ...(batch ? [batch.signal] : []),
    photos.signal,
    AbortSignal.timeout(5000),
  ]);
  this.providers.photos
    .run(this.query, this.mode, signal)
    .then((result) => {
      if (batch === this.batchController || batch === null) {
        this.sections.photos = result;
        this.onPhotosSettled();
        this.reconcileCursor();
      }
    })
    .catch((err: unknown) => {
      if (err instanceof Error && err.name === 'AbortError') {
        if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
          this.sections.photos = { status: 'timeout' };
          this.onPhotosSettled();
        }
        return;
      }
      this.sections.photos = { status: 'error', message: err instanceof Error ? err.message : 'unknown error' };
      this.onPhotosSettled();
    });
}
```

**Update `runBatch`** so the photos provider's resolve/reject paths call `onPhotosSettled()` and `reconcileCursor()`, and every provider's resolve path calls `reconcileCursor()`. Replace Task 8's `runBatch` body with:

```ts
protected runBatch(text: string, mode: SearchMode) {
  this.debounceTimer = null;
  const batch = new AbortController();
  const photosLocal = new AbortController();
  this.batchController = batch;
  this.photosController = photosLocal;

  for (const key of ['photos', 'people', 'places', 'tags'] as const) {
    const provider = this.providers[key];
    if (text.length < provider.minQueryLength) {
      this.sections[key] = idle;
      continue;
    }
    const controllers = key === 'photos' ? [batch.signal, photosLocal.signal] : [batch.signal];
    const signal = AbortSignal.any([...controllers, AbortSignal.timeout(5000)]);

    // Wrap in Promise.resolve so a provider that synchronously throws still lands in .catch
    Promise.resolve()
      .then(() => provider.run(text, mode, signal))
      .then((result) => {
        if (batch !== this.batchController) return;
        this.sections[key] = result;
        if (key === 'photos') this.onPhotosSettled();
        this.reconcileCursor();
      })
      .catch((err: unknown) => {
        if (batch !== this.batchController) return;
        if (err instanceof Error && err.name === 'AbortError') {
          if (signal.aborted && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
            this.sections[key] = { status: 'timeout' };
            if (key === 'photos') this.onPhotosSettled();
          }
          return;
        }
        const message = err instanceof Error ? err.message : 'unknown error';
        this.sections[key] = { status: 'error', message };
        if (key === 'photos') this.onPhotosSettled();
      });
  }
}
```

Note the `Promise.resolve().then(() => provider.run(...))` wrapper: it guarantees that a provider which **synchronously throws** (rather than returning a rejected promise) still lands in the `.catch` handler instead of escaping `runBatch` entirely. Add a regression test:

```ts
it('synchronous throw from a provider does not crash runBatch', async () => {
  const m = new GlobalSearchManager();
  (m as any).providers.photos.run = () => {
    throw new Error('sync boom');
  };
  m.setQuery('beach');
  await vi.advanceTimersByTimeAsync(200);
  expect(m.sections.photos).toEqual({ status: 'error', message: 'sync boom' });
});
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/managers/global-search-manager.svelte.ts web/src/lib/managers/global-search-manager.svelte.spec.ts
git commit -m "feat(web): setMode, cursor identity, Enter capture, ML health promotion"
```

---

## Task 12 — `cmdk.recent` localStorage store

**Files:**

- Create: `web/src/lib/stores/cmdk-recent.ts`
- Create: `web/src/lib/stores/cmdk-recent.spec.ts`

**Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addEntry, getEntries, clearEntries, makePlaceId } from './cmdk-recent';

describe('cmdk-recent', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns [] for unset store', () => {
    expect(getEntries()).toEqual([]);
  });

  it('addEntry persists, returns newest first', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    addEntry({ kind: 'query', id: 'q:b', text: 'b', mode: 'smart', lastUsed: 2 });
    expect(getEntries().map((e) => e.id)).toEqual(['q:b', 'q:a']);
  });

  it('dedupes by id, updating lastUsed', () => {
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 1 });
    addEntry({ kind: 'photo', id: 'photo:abc', assetId: 'abc', label: 'X', lastUsed: 5 });
    const entries = getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0].lastUsed).toBe(5);
  });

  it('trims to 20, keeping newest', () => {
    for (let i = 0; i < 25; i++) {
      addEntry({ kind: 'query', id: `q:${i}`, text: `q${i}`, mode: 'smart', lastUsed: i });
    }
    const entries = getEntries();
    expect(entries).toHaveLength(20);
    expect(entries[0].id).toBe('q:24');
    expect(entries[19].id).toBe('q:5');
  });

  it('treats corrupt JSON as empty; next write overwrites', () => {
    localStorage.setItem('cmdk.recent', 'not-valid-json');
    expect(getEntries()).toEqual([]);
    addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 });
    expect(getEntries()).toHaveLength(1);
  });

  it('QuotaExceededError preserves in-memory copy (regression test)', () => {
    addEntry({ kind: 'query', id: 'q:initial', text: 'initial', mode: 'smart', lastUsed: 1 });
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
    });
    addEntry({ kind: 'query', id: 'q:new', text: 'new', mode: 'smart', lastUsed: 2 });
    spy.mockRestore();
    const entries = getEntries();
    expect(entries.some((e) => e.id === 'q:initial')).toBe(true);
    expect(entries.some((e) => e.id === 'q:new')).toBe(true);
  });

  it('handles localStorage unavailable (getItem throws)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(getEntries()).toEqual([]);
    expect(() => addEntry({ kind: 'query', id: 'q:x', text: 'x', mode: 'smart', lastUsed: 1 })).not.toThrow();
    spy.mockRestore();
  });

  it('clearEntries empties the store', () => {
    addEntry({ kind: 'query', id: 'q:a', text: 'a', mode: 'smart', lastUsed: 1 });
    clearEntries();
    expect(getEntries()).toEqual([]);
  });
});

describe('makePlaceId precision', () => {
  it('rounds to 4 decimals so near-identical coords collapse', () => {
    expect(makePlaceId(48.85664567, 2.35221001)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.85661111, 2.35219999)).toBe('place:48.8566:2.3522');
    expect(makePlaceId(48.85664567, 2.35221001)).toBe(makePlaceId(48.85661111, 2.35219999));
  });

  it('coords far apart produce different keys', () => {
    expect(makePlaceId(48.85, 2.35)).not.toBe(makePlaceId(48.86, 2.35));
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```ts
// web/src/lib/stores/cmdk-recent.ts
import type { SearchMode } from '$lib/managers/global-search-manager.svelte';

const STORAGE_KEY = 'cmdk.recent';
const MAX_ENTRIES = 20;

export type RecentEntry =
  | { kind: 'query'; id: string; text: string; mode: SearchMode; lastUsed: number }
  | { kind: 'photo'; id: string; assetId: string; label: string; lastUsed: number }
  | { kind: 'person'; id: string; personId: string; label: string; thumbnailAssetId?: string; lastUsed: number }
  | { kind: 'place'; id: string; latitude: number; longitude: number; label: string; lastUsed: number }
  | { kind: 'tag'; id: string; tagId: string; label: string; lastUsed: number };

let memory: RecentEntry[] | null = null;
let warnedOnce = false;

function warn(err: unknown) {
  if (warnedOnce) return;
  warnedOnce = true;
  // eslint-disable-next-line no-console
  console.warn('[cmdk.recent]', err);
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

function rawWrite(entries: RecentEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (err) {
    warn(err);
  }
}

export function getEntries(): RecentEntry[] {
  if (memory === null) memory = rawRead();
  return [...memory].sort((a, b) => b.lastUsed - a.lastUsed);
}

export function addEntry(entry: RecentEntry) {
  if (memory === null) memory = rawRead();
  const deduped = memory.filter((e) => e.id !== entry.id);
  deduped.push(entry);
  deduped.sort((a, b) => b.lastUsed - a.lastUsed);
  memory = deduped.slice(0, MAX_ENTRIES);
  rawWrite(memory);
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

- Create: `web/src/lib/components/global-search/rows/{photo,person,place,tag}-row.svelte`
- Create: `web/src/lib/components/global-search/__tests__/{photo,person,place,tag}-row.spec.ts`

**Context:** Presentation components taking a single `{ item }` prop — they render visual content only. `role="option"`, `aria-selected`, and the active-row tint are provided by the parent `Command.Item` wrapper in Task 14 (bits-ui handles those automatically). Use `getAssetMediaUrl` directly (no `createUrl` wrap). Tag rows read `tag.name` (not `.value`).

**Step 1: Write failing tests** (example — `photo-row`):

```ts
import { render, screen } from '@testing-library/svelte';
import PhotoRow from '../rows/photo-row.svelte';

describe('photo-row', () => {
  it('renders filename and subtitle', () => {
    render(PhotoRow, {
      props: {
        item: {
          id: 'a1',
          originalFileName: 'sunset.jpg',
          exifInfo: { dateTimeOriginal: '2024-03-01T00:00:00Z', city: 'Santa Cruz' },
        },
      },
    });
    expect(screen.getByText('sunset.jpg')).toBeInTheDocument();
    expect(screen.getByText(/Santa Cruz/)).toBeInTheDocument();
  });

  it('uses getAssetMediaUrl for the thumbnail', () => {
    const { container } = render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'x.jpg' } },
    });
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toContain('/api/');
  });

  it('does NOT set role="option" (Command.Item wraps it and provides the role)', () => {
    const { container } = render(PhotoRow, {
      props: { item: { id: 'a1', originalFileName: 'x.jpg' } },
    });
    expect(container.querySelector('[role="option"]')).toBeNull();
  });
});
```

Write analogous specs for person/place/tag rows. The tag row test uses `item.name` (not `.value`). The place row test uses `item.name` (the place name) and a country subtitle.

**Step 2: Run — expect failure**

**Step 3: Implement** — sample `photo-row.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';

  interface Props { item: AssetResponseDto; }
  let { item }: Props = $props();

  const subtitle = $derived(
    [item.exifInfo?.dateTimeOriginal?.slice(0, 10), item.exifInfo?.city].filter(Boolean).join(' · '),
  );
  const thumbUrl = $derived(
    getAssetMediaUrl({ id: item.id, size: AssetMediaSize.Thumbnail, cacheKey: (item as { thumbhash?: string }).thumbhash }),
  );
</script>

<div class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 data-[selected=true]:bg-primary/10">
  <img src={thumbUrl} alt="" class="h-10 w-10 rounded-md object-cover" loading="lazy" />
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.originalFileName}</div>
    {#if subtitle}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
    {/if}
  </div>
</div>
```

The `data-[selected=true]:bg-primary/10` Tailwind selector applies the active tint when bits-ui's `Command.Item` sets `data-selected="true"` on its rendered element, which cascades to the child row. This replaces the prior `isActive` prop-based styling — bits-ui drives selection, we just style on its data attributes.

`person-row.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type PersonResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props { item: PersonResponseDto & { numberOfAssets?: number }; }
  let { item }: Props = $props();

  const thumbUrl = $derived(
    item.faceAssetId ? getAssetMediaUrl({ id: item.faceAssetId, size: AssetMediaSize.Thumbnail }) : '',
  );
</script>

<div class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 data-[selected=true]:bg-primary/10">
  {#if thumbUrl}
    <img src={thumbUrl} alt="" class="h-10 w-10 rounded-full object-cover" loading="lazy" />
  {:else}
    <div class="h-10 w-10 rounded-full bg-subtle/40" aria-hidden="true"></div>
  {/if}
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name || $t('cmdk_unnamed_person')}</div>
    {#if item.numberOfAssets !== undefined}
      <div class="text-xs text-gray-500 dark:text-gray-400">{item.numberOfAssets} photos</div>
    {/if}
  </div>
</div>
```

`place-row.svelte`:

```svelte
<script lang="ts">
  import Icon from '$lib/elements/Icon.svelte';
  import { mdiMapMarker } from '@mdi/js';
  import type { PlacesResponseDto } from '@immich/sdk';

  interface Props { item: PlacesResponseDto; }
  let { item }: Props = $props();

  const subtitle = $derived([item.admin1name, item.countryName].filter(Boolean).join(' · '));
</script>

<div class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 data-[selected=true]:bg-primary/10">
  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-subtle/40">
    <Icon path={mdiMapMarker} size="18" class="text-gray-500 dark:text-gray-400" />
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name}</div>
    {#if subtitle}
      <div class="truncate text-xs text-gray-500 dark:text-gray-400">{subtitle}</div>
    {/if}
  </div>
</div>
```

`tag-row.svelte`:

```svelte
<script lang="ts">
  import Icon from '$lib/elements/Icon.svelte';
  import { mdiTag } from '@mdi/js';
  import type { TagResponseDto } from '@immich/sdk';

  interface Props { item: TagResponseDto; }
  let { item }: Props = $props();
</script>

<div class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 data-[selected=true]:bg-primary/10">
  <div class="flex h-8 w-8 items-center justify-center rounded-md bg-subtle/40">
    {#if item.color}
      <span class="h-2 w-2 rounded-full" style:background-color={item.color}></span>
    {:else}
      <Icon path={mdiTag} size="18" class="text-gray-500 dark:text-gray-400" />
    {/if}
  </div>
  <div class="min-w-0 flex-1">
    <div class="truncate text-sm font-medium">{item.name}</div>
  </div>
</div>
```

- `recent-row.svelte` — thin dispatcher that takes `{ entry: RecentEntry }` and renders the matching row component based on `entry.kind`:

```svelte
<script lang="ts">
  import type { RecentEntry } from '$lib/stores/cmdk-recent';
  import PhotoRow from './photo-row.svelte';
  import PersonRow from './person-row.svelte';
  import PlaceRow from './place-row.svelte';
  import TagRow from './tag-row.svelte';

  interface Props { entry: RecentEntry; }
  let { entry }: Props = $props();
</script>

{#if entry.kind === 'query'}
  <div class="flex h-[52px] items-center gap-3 rounded-lg px-3 py-2 data-[selected=true]:bg-primary/10">
    <span class="text-sm text-gray-500 dark:text-gray-400">🔍</span>
    <div class="truncate text-sm">{entry.text}</div>
  </div>
{:else if entry.kind === 'photo'}
  <PhotoRow item={{ id: entry.assetId, originalFileName: entry.label }} />
{:else if entry.kind === 'person'}
  <PersonRow item={{ id: entry.personId, name: entry.label, faceAssetId: entry.thumbnailAssetId }} />
{:else if entry.kind === 'place'}
  <PlaceRow item={{ name: entry.label, latitude: entry.latitude, longitude: entry.longitude }} />
{:else if entry.kind === 'tag'}
  <TagRow item={{ id: entry.tagId, name: entry.label, color: null }} />
{/if}
```

Add a `recent-row.spec.ts` test that verifies each `kind` dispatches to the right component.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/rows/ web/src/lib/components/global-search/__tests__/
git commit -m "feat(web): row components for global search palette"
```

---

## Task 14 — Section component + palette root (`@immich/ui` Modal + `Command.Root`)

**Files:**

- Create: `web/src/lib/components/global-search/global-search-section.svelte`
- Create: `web/src/lib/components/global-search/global-search.svelte`
- Create: `web/src/lib/components/global-search/__tests__/global-search.spec.ts`

**Step 1: Write failing tests**

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event'; // default import — Gallery convention
import { vi } from 'vitest';
import GlobalSearch from '../global-search.svelte';
import { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';

describe('global-search root', () => {
  let user: ReturnType<typeof userEvent.setup>;
  beforeEach(() => {
    localStorage.clear();
    user = userEvent.setup();
  });

  it('renders dialog when open (accessible name via sr-only label)', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByRole('dialog', { name: /global search/i })).toBeInTheDocument();
  });

  it('does NOT render a visible Modal title header', () => {
    const m = new GlobalSearchManager();
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    // Modal's title prop is not set, so no CardTitle header should render.
    // The only "global search" text should be inside an sr-only element.
    const visibleHeaders = container.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (const h of visibleHeaders) {
      expect(h.textContent).not.toMatch(/global search/i);
    }
  });

  it('Esc once clears input, twice closes (APG two-stage)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    await user.type(input, 'hello');
    await user.keyboard('{Escape}');
    expect(input.value).toBe('');
    expect(m.isOpen).toBe(true);
    await user.keyboard('{Escape}');
    expect(m.isOpen).toBe(false);
  });

  it('Ctrl+K inside the palette closes (not captured by vimBindings)', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.keyboard('{Control>}k{/Control}');
    expect(m.isOpen).toBe(false);
  });

  it('backdrop click closes the palette', async () => {
    const m = new GlobalSearchManager();
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    // Modal's backdrop is an overlay element; click it directly.
    // The exact selector depends on @immich/ui Modal internals; grep for the real class during implementation.
    const overlay = container.querySelector('[data-dialog-overlay], [role="presentation"]') as HTMLElement | null;
    if (overlay) {
      await user.click(overlay);
      expect(m.isOpen).toBe(false);
    } else {
      // Fallback: fire a pointerdown on document outside the dialog content
      await user.click(document.body);
      expect(m.isOpen).toBe(false);
    }
  });

  it('helper row appears on cold open, disappears after first keystroke', async () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    expect(screen.getByText(/start typing/i)).toBeInTheDocument();
    await user.type(screen.getByRole('combobox'), 'a');
    expect(screen.queryByText(/start typing/i)).toBeNull();
  });

  it('auto-highlights first row when results arrive', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 1000 });
  });

  it('ArrowDown moves cursor to next row (bits-ui Command.Item keyboard nav)', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }, { id: 'a2' }], total: 2 });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'), { timeout: 1000 });
    await user.keyboard('{ArrowDown}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a2'), { timeout: 500 });
  });

  it('Home jumps to first row, End jumps to last row', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({
      status: 'ok',
      items: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }],
      total: 3,
    });
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
    await user.keyboard('{End}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a3'));
    await user.keyboard('{Home}');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
  });

  it('aria-live region renders final aggregate once all providers settle', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({ status: 'ok', items: [{ id: 'a1' }], total: 42 });
    (m as any).providers.people.run = async () => ({ status: 'ok', items: [{ id: 'p1' }], total: 5 });
    (m as any).providers.places.run = async () => ({ status: 'empty' });
    (m as any).providers.tags.run = async () => ({ status: 'empty' });
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => {
      const live = container.querySelector('[aria-live="polite"]');
      expect(live?.textContent ?? '').toMatch(/42 photos.*5 people/);
    });
  });

  it('aria-live is empty while any provider is still loading', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = () => new Promise(() => {}); // never resolves
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    const live = container.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe('');
  });

  it('combobox has maxlength="256"', () => {
    const m = new GlobalSearchManager();
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    const input = screen.getByRole('combobox') as HTMLInputElement;
    expect(input.maxLength).toBe(256);
  });

  it('Enter on a highlighted photo row calls manager.activate("photo", item)', async () => {
    const m = new GlobalSearchManager();
    (m as any).providers.photos.run = async () => ({
      status: 'ok',
      items: [{ id: 'a1', originalFileName: 'x.jpg' }],
      total: 1,
    });
    const activateSpy = vi.spyOn(m, 'activate').mockImplementation(() => {});
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    await user.type(screen.getByRole('combobox'), 'beach');
    await vi.waitFor(() => expect(m.activeItemId).toBe('photo:a1'));
    await user.keyboard('{Enter}');
    expect(activateSpy).toHaveBeenCalledWith('photo', expect.objectContaining({ id: 'a1' }));
  });

  it('ML banner hides when switching to metadata, re-shows when switching back to smart (while mlHealthy=false)', async () => {
    const m = new GlobalSearchManager();
    m.mlHealthy = false;
    m.open();
    render(GlobalSearch, { props: { manager: m } });
    // In smart mode the banner is visible
    expect(screen.getByText(/smart search is unavailable/i)).toBeInTheDocument();
    // Switch to metadata — banner hides
    m.setMode('metadata');
    await vi.waitFor(() => expect(screen.queryByText(/smart search is unavailable/i)).toBeNull());
    // Switch back to smart — banner reappears
    m.setMode('smart');
    await vi.waitFor(() => expect(screen.getByText(/smart search is unavailable/i)).toBeInTheDocument());
  });

  it('respects prefers-reduced-motion (class lands on palette shell)', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    }));
    const m = new GlobalSearchManager();
    m.open();
    const { container } = render(GlobalSearch, { props: { manager: m } });
    // `motion-reduce:` utility classes live on the Modal root. Grep the rendered DOM for any
    // element whose className contains 'motion-reduce:' — avoids asserting on a specific
    // element position that may shift when Modal internals change.
    const allElements = container.querySelectorAll('*');
    const hasReducedMotion = Array.from(allElements).some((el) => el.className?.toString().includes('motion-reduce:'));
    expect(hasReducedMotion).toBe(true);
  });
});
```

**Note:** Ctrl+Enter (open in new tab) is intentionally NOT unit-tested — `Command.Item.onSelect` does not expose modifier state, so "open in new tab" lives in the E2E layer (Task 19) where a real browser handles `Cmd/Ctrl+Click`. Flagged as a documented limitation rather than a coverage gap.

**Step 2: Run — expect failure**

**Step 3: Implement**

`global-search-section.svelte`:

```svelte
<script lang="ts" generics="T extends { id?: string }">
  import type { ProviderStatus } from '$lib/managers/global-search-manager.svelte';
  import type { Snippet } from 'svelte';
  import { t } from 'svelte-i18n';

  interface Props {
    heading: string;
    status: ProviderStatus<T>;
    renderRow: Snippet<[T]>;
    idPrefix: 'photo' | 'person' | 'place' | 'tag';
    onActivate: (item: T) => void;
    onSeeAll?: () => void;
  }
  let { heading, status, renderRow, idPrefix, onActivate, onSeeAll }: Props = $props();

  function itemKey(item: T): string {
    const id = (item as { id?: string }).id;
    if (id !== undefined) return `${idPrefix}:${id}`;
    const place = item as { latitude?: number; longitude?: number };
    if (place.latitude !== undefined && place.longitude !== undefined) {
      return `${idPrefix}:${place.latitude.toFixed(4)}:${place.longitude.toFixed(4)}`;
    }
    return '';
  }
</script>

{#if status.status !== 'idle'}
  <Command.Group class="mb-4">
    <Command.GroupHeading class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
      {heading}
    </Command.GroupHeading>
    <Command.GroupItems>
      {#if status.status === 'loading'}
        <!-- Uses Gallery's global Skeleton component (web/src/lib/elements/Skeleton.svelte) which
             renders the same textured background-image tile the rest of the app uses, not a solid-color
             Tailwind animate-pulse. Matches Skeleton.svelte:45's 2s cubic-bezier cadence. -->
        {#each Array(3) as _}
          <div class="mx-3 mb-1">
            <Skeleton height={52} />
          </div>
        {/each}
      {:else if status.status === 'ok'}
        {#each status.items as item (itemKey(item))}
          <Command.Item value={itemKey(item)} onSelect={() => onActivate(item)}>
            {@render renderRow(item)}
          </Command.Item>
        {/each}
        {#if onSeeAll && status.total > status.items.length}
          <button
            type="button"
            onclick={onSeeAll}
            class="mt-1 flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-primary tabular-nums"
          >
            <span>{$t('cmdk_see_all', { values: { count: status.total } })}</span>
            <span aria-hidden="true">→</span>
          </button>
        {/if}
      {:else if status.status === 'timeout'}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_slow_results')}</div>
      {:else if status.status === 'error'}
        <div class="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">
          {#if status.message === 'tag_cache_too_large'}
            {$t('cmdk_tag_cache_too_large')}
          {:else}
            {$t('cmdk_couldnt_load', { values: { entity: heading } })}
          {/if}
        </div>
      {/if}
    </Command.GroupItems>
  </Command.Group>
{/if}
```

Section component imports:

```ts
import Skeleton from '$lib/elements/Skeleton.svelte';
```

`Command.Group` / `GroupHeading` / `GroupItems` already emit `role="group"` + `aria-labelledby` — no manual ARIA wiring needed. `Command.Item` emits `role="option"` + `aria-selected` + handles keyboard nav / scroll-into-view / click-to-select for free.

`global-search.svelte`:

```svelte
<script lang="ts">
  import { Modal } from '@immich/ui';
  import { Command } from 'bits-ui';
  import { t } from 'svelte-i18n';
  import type { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import GlobalSearchSection from './global-search-section.svelte';
  import PhotoRow from './rows/photo-row.svelte';
  import PersonRow from './rows/person-row.svelte';
  import PlaceRow from './rows/place-row.svelte';
  import TagRow from './rows/tag-row.svelte';
  import { getEntries } from '$lib/stores/cmdk-recent';

  interface Props { manager: GlobalSearchManager }
  let { manager }: Props = $props();

  let inputValue = $state(manager.query);

  $effect(() => {
    manager.setQuery(inputValue);
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (inputValue !== '') {
        inputValue = '';
        e.preventDefault();
        return;
      }
      manager.close();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey && e.key === 'k') {
      manager.close();
      e.preventDefault();
      return;
    }
    // Home / End: jump cursor to first / last item. Bits-UI Command.Item does not
    // handle these natively; we query the rendered Command.Item elements and set
    // the manager's active id to the first/last one so the selection bridge fires.
    if (e.key === 'Home' || e.key === 'End') {
      const items = document.querySelectorAll<HTMLElement>('[cmdk-item]');
      if (items.length === 0) return;
      const target = e.key === 'Home' ? items[0] : items[items.length - 1];
      const value = target.getAttribute('data-value');
      if (value) {
        manager.setActiveItem(value);
        e.preventDefault();
      }
    }
  }

  const showHelper = $derived(inputValue.trim() === '' && getEntries().length === 0);
</script>

<!--
  Modal notes:
  - No `title` prop: passing title renders a visible CardTitle header (Modal.svelte:132-142).
    A cmdk palette should have no visible title bar; the input IS the title.
  - `closeOnBackdropClick={true}`: default is FALSE (Modal.svelte:43), so we must opt in
    for design § "Closing: click outside the modal closes" to work.
  - `closeOnEsc={false}`: we handle Esc ourselves via onKeyDown for APG two-stage behavior.
  - A visually-hidden span inside provides the dialog's accessible name.

  Command.Root notes:
  - `vimBindings={false}`: default is TRUE (command.svelte:22). Leaving it enabled captures
    Ctrl+K / Ctrl+J / Ctrl+N / Ctrl+P inside the palette and collides with "Ctrl+K closes".
    Disabling it means ArrowDown/ArrowUp are the only nav keys — which is what we want.
  - `bind:value={selectedValue}`: Command.Root drives selection among its Command.Item
    children. We mirror selectedValue → manager.activeItemId via $effect.
  - `shouldFilter={false}`: results come from the server, not from Command's built-in filter.
-->
<!-- Task 14 ships the single-pane version. Task 14b amends this template to add
     the footer. Task 16 amends it again to add the two-pane preview layout. -->
<Modal
  size="large"
  closeOnEsc={false}
  closeOnBackdropClick={true}
  onClose={() => manager.close()}
  class="motion-reduce:transition-none motion-reduce:transform-none !p-0"
>
  {#snippet children()}
    <span class="sr-only" id="global-search-label">{$t('global_search')}</span>
    <Command.Root
      shouldFilter={false}
      vimBindings={false}
      bind:value={selectedValue}
      aria-labelledby="global-search-label"
      class="flex flex-col"
    >
      <Command.Input
        bind:value={inputValue}
        placeholder={$t('cmdk_placeholder')}
        maxlength={256}
        onkeydown={onKeyDown}
        class="w-full border-b border-gray-200 bg-transparent px-4 py-3 text-sm focus:outline-none dark:border-gray-700"
      />

      <!-- ML banner sits inside the list area, above the result list (design § ML health rendering). -->
      {#if manager.mode === 'smart' && !manager.mlHealthy && inputValue.trim() !== ''}
        <div class="mx-3 mt-3 rounded-md bg-subtle/60 px-3 py-2 text-xs">
          {$t('cmdk_smart_unavailable')}
          <button type="button" onclick={() => manager.setMode('metadata')} class="ml-2 text-primary transition-colors duration-[80ms] ease-out">
            {$t('cmdk_try_filename')}
          </button>
        </div>
      {/if}

      <Command.List class="min-h-[420px] max-h-[60vh] flex-1 overflow-y-auto py-2">
        {#if inputValue.trim() === ''}
          <!-- Empty state: RECENT if entries exist, else helper row. SUGGESTED is in design § Non-goals. -->
          {#if recentEntries.length > 0}
            <Command.Group>
              <Command.GroupHeading class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {$t('cmdk_recent_heading')}
              </Command.GroupHeading>
              <Command.GroupItems>
                {#each recentEntries as entry (entry.id)}
                  <Command.Item value={entry.id} onSelect={() => manager.activateRecent(entry)}>
                    <RecentRow {entry} />
                  </Command.Item>
                {/each}
              </Command.GroupItems>
            </Command.Group>
          {:else}
            <div class="p-6 text-center text-[13px] font-normal text-gray-500 dark:text-gray-400">
              {$t('cmdk_helper')}
            </div>
          {/if}
        {:else}
          <GlobalSearchSection heading={$t('cmdk_photos_heading')} status={manager.sections.photos} idPrefix="photo" onActivate={(item) => manager.activate('photo', item)}>
            {#snippet renderRow(item)}<PhotoRow {item} />{/snippet}
          </GlobalSearchSection>
          <GlobalSearchSection heading={$t('cmdk_people_heading')} status={manager.sections.people} idPrefix="person" onActivate={(item) => manager.activate('person', item)}>
            {#snippet renderRow(item)}<PersonRow {item} />{/snippet}
          </GlobalSearchSection>
          <GlobalSearchSection heading={$t('cmdk_places_heading')} status={manager.sections.places} idPrefix="place" onActivate={(item) => manager.activate('place', item)}>
            {#snippet renderRow(item)}<PlaceRow {item} />{/snippet}
          </GlobalSearchSection>
          <GlobalSearchSection heading={$t('cmdk_tags_heading')} status={manager.sections.tags} idPrefix="tag" onActivate={(item) => manager.activate('tag', item)}>
            {#snippet renderRow(item)}<TagRow {item} />{/snippet}
          </GlobalSearchSection>
        {/if}
      </Command.List>

      <!-- aria-live region announces final aggregate once all enabled providers settle (design § Accessibility). -->
      <div aria-live="polite" aria-atomic="true" class="sr-only">{manager.announcementText}</div>
    </Command.Root>
  {/snippet}
</Modal>
```

**Note on Modal width:** `@immich/ui` Modal's `size="large"` maps to `md:max-w-(--breakpoint-md)` = 767 px at ≥ 768 px, full-width minus padding below. This gives a 2-tier width (767 px / full-width) rather than the design's 3-tier (767/639/full). The design dimensions table lists 639 px at 640–1023 px but that would require overriding Modal's internal `max-width` class, which fights the design system. Accept Modal's 2-tier behavior for v1 and update the design dimensions table to match (see design-doc fixes at the end of this plan). The preview pane remains gated at ≥ 1024 px so the behavioral contract still matches.

**Selection state bridge and imports.** Add to the `<script>` block:

```ts
import { getEntries, type RecentEntry } from '$lib/stores/cmdk-recent';
import RecentRow from './rows/recent-row.svelte';
// NOTE: GlobalSearchFooter (Task 14b) and GlobalSearchPreview (Task 16) are
// NOT imported here in Task 14's initial commit. Task 14 ships a single-pane
// palette with no footer. Task 14b amends global-search.svelte to import and
// mount the footer. Task 16 amends it again to import GlobalSearchPreview,
// add the two-pane layout, and render the preview pane at ≥ 1024 px. Each
// task's diff is additive and each intermediate commit typechecks cleanly.

let selectedValue = $state<string>('');
const recentEntries = $derived<RecentEntry[]>(inputValue.trim() === '' ? getEntries() : []);

// Bridge Command.Root selection state into manager.activeItemId so
// the manager-side cursor stays in sync with bits-ui's internal selection.
$effect(() => {
  if (selectedValue) manager.setActiveItem(selectedValue);
});

// When reconcileCursor updates activeItemId (e.g. auto-highlight on first results),
// push it back into Command.Root so bits-ui highlights the same row.
$effect(() => {
  if (manager.activeItemId && manager.activeItemId !== selectedValue) {
    selectedValue = manager.activeItemId;
  }
});
```

The section component (`global-search-section.svelte`) must wrap each row in `<Command.Item value={itemKey(item)} onSelect={() => onActivate(item)}>` and take `onActivate: (item: T) => void` instead of `activeItemId`. Update Task 14's section-component snippet accordingly:

```svelte
<!-- inside the ok branch -->
{#each status.items as item (itemKey(item))}
  <Command.Item value={itemKey(item)} onSelect={() => onActivate(item)}>
    {@render renderRow(item)}
  </Command.Item>
{/each}
```

Bits UI's `Command.Item` handles `role="option"` + `aria-selected` + scroll-into-view automatically. That means **row components do NOT set `role="option"` or `aria-selected`** — they just render visual content. Update Task 13 accordingly (see below).

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search.svelte \
  web/src/lib/components/global-search/global-search-section.svelte \
  web/src/lib/components/global-search/__tests__/global-search.spec.ts
git commit -m "feat(web): GlobalSearch root + section via @immich/ui Modal"
```

---

## Task 14b — Mode selector footer

**Files:**

- Create: `web/src/lib/components/global-search/global-search-footer.svelte`
- Create: `web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts`
- Modify: `web/src/lib/components/global-search/global-search.svelte` — add the import and mount the footer at the bottom of `<Command.Root>`

**Context:** The palette footer is a segmented control letting the user switch between Smart / Filename / Description / OCR without leaving the palette. Per the design, the mode label uses GoogleSansCode (11 px / 500 / uppercase / tabular). The selected pill slides 180 ms on change. Mode persists to `searchQueryType` localStorage (handled by `manager.setMode()` in Task 11). `Ctrl+/` keyboard shortcut is registered in Task 15's `+layout.svelte`.

**Step 1: Write failing tests**

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import GlobalSearchFooter from '../global-search-footer.svelte';
import { GlobalSearchManager } from '$lib/managers/global-search-manager.svelte';

describe('global-search-footer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders four segmented-control options', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    for (const label of [/smart/i, /filename/i, /description/i, /ocr/i]) {
      expect(screen.getByRole('radio', { name: label })).toBeInTheDocument();
    }
  });

  it('reflects manager.mode as the checked radio', () => {
    const manager = new GlobalSearchManager();
    manager.setMode('metadata');
    render(GlobalSearchFooter, { props: { manager } });
    expect((screen.getByRole('radio', { name: /filename/i }) as HTMLInputElement).checked).toBe(true);
  });

  it('clicking a segment calls manager.setMode with the right value', async () => {
    const user = userEvent.setup();
    const manager = new GlobalSearchManager();
    const spy = vi.spyOn(manager, 'setMode');
    render(GlobalSearchFooter, { props: { manager } });
    await user.click(screen.getByRole('radio', { name: /description/i }));
    expect(spy).toHaveBeenCalledWith('description');
  });

  it('displays the Ctrl+/ keybind hint', () => {
    const manager = new GlobalSearchManager();
    render(GlobalSearchFooter, { props: { manager } });
    expect(screen.getByText(/ctrl\+\//i)).toBeInTheDocument();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```svelte
<!-- global-search-footer.svelte -->
<script lang="ts">
  import type { GlobalSearchManager, SearchMode } from '$lib/managers/global-search-manager.svelte';
  import { t } from 'svelte-i18n';

  interface Props { manager: GlobalSearchManager; }
  let { manager }: Props = $props();

  // "Filename" label maps to stored value 'metadata' — preserve the existing Gallery key.
  const options: Array<{ value: SearchMode; labelKey: string }> = [
    { value: 'smart', labelKey: 'cmdk_mode_smart' },
    { value: 'metadata', labelKey: 'cmdk_mode_filename' },
    { value: 'description', labelKey: 'cmdk_mode_description' },
    { value: 'ocr', labelKey: 'cmdk_mode_ocr' },
  ];
</script>

<div class="flex items-center justify-between border-t border-gray-200 px-4 py-2 dark:border-gray-700">
  <!-- Segmented control as a radiogroup so keyboard and AT users can tab to it and the selection is announced. -->
  <div role="radiogroup" aria-label={$t('cmdk_search_mode')} class="flex gap-0 rounded-md bg-subtle/40 p-0.5 font-mono text-[11px] font-medium uppercase">
    {#each options as opt (opt.value)}
      <label class="relative">
        <input
          type="radio"
          name="cmdk-mode"
          value={opt.value}
          checked={manager.mode === opt.value}
          onchange={() => manager.setMode(opt.value)}
          class="sr-only"
        />
        <span
          class="block cursor-pointer rounded-sm px-2.5 py-1 tabular-nums transition-colors duration-[180ms] ease-out {manager.mode === opt.value ? 'bg-primary/10 text-primary' : 'text-gray-500 dark:text-gray-400'}"
        >
          {$t(opt.labelKey)}
        </span>
      </label>
    {/each}
  </div>

  <!-- Keybind hint: Ctrl+/ cycles modes (design § Search mode selector). -->
  <span class="font-mono text-[11px] text-gray-500 dark:text-gray-400">
    <kbd class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 dark:border-gray-700">Ctrl+/</kbd>
    <span class="ml-1">{$t('cmdk_cycle_mode_hint')}</span>
  </span>
</div>
```

**Why radiogroup instead of a button segmented control.** The semantic accessibility is much cleaner: screen readers announce the selected value, keyboard users can use arrow keys natively (`role="radiogroup"` gives you this for free), and `manager.mode` binds symmetrically. The visible styling is the pill slider; the inputs are `sr-only`.

**Mount the footer in `global-search.svelte`.** Add the import and the mount point at the end of `<Command.Root>` (right after the `aria-live` region):

```svelte
<script lang="ts">
  // ... existing imports ...
  import GlobalSearchFooter from './global-search-footer.svelte';
</script>

<!-- ... existing Command.Root children ... -->
  <Command.List>...</Command.List>
  <div aria-live="polite" aria-atomic="true" class="sr-only">{manager.announcementText}</div>
  <GlobalSearchFooter {manager} />
</Command.Root>
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search-footer.svelte \
  web/src/lib/components/global-search/__tests__/global-search-footer.spec.ts \
  web/src/lib/components/global-search/global-search.svelte
git commit -m "feat(web): mode selector footer with segmented radiogroup"
```

**Note:** i18n keys `cmdk_mode_smart`, `cmdk_mode_filename`, `cmdk_mode_description`, `cmdk_mode_ocr`, `cmdk_search_mode`, `cmdk_cycle_mode_hint` are added in Task 18.

---

## Task 15 — Trigger button, layout wiring, delete legacy Ctrl+K, update ShortcutsModal

**Files:**

- Create: `web/src/lib/components/global-search/global-search-trigger.svelte`
- Modify: `web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte` (lines 86–91)
- Modify: `web/src/routes/+layout.svelte` (register Ctrl+K, re-register Ctrl+Shift+K, mount `<GlobalSearch>`)
- Modify: `web/src/lib/components/shared-components/search-bar/search-bar.svelte:246` (delete `Ctrl+K` document binding)
- Modify: `web/src/lib/modals/ShortcutsModal.svelte`
- Modify: `web/src/lib/managers/global-search-manager.svelte.ts` (export singleton)

**Step 1: Add the singleton export and write failing tests**

Append to `global-search-manager.svelte.ts`:

```ts
export const globalSearchManager = new GlobalSearchManager();
```

Tests:

`featureFlagsManager.value` is a getter that throws when `#value` is undefined and returns a snapshot when set (verified in `feature-flags-manager.svelte.ts`). Assigning `.search` to the returned object won't update the private rune field. Mock the whole module to control the flag cleanly:

```ts
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event'; // default import
import { vi } from 'vitest';

// Hoisted mock of feature-flags-manager — use a mutable object so tests can flip `.search`.
const mockFlags = { value: { search: true } };
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({
  featureFlagsManager: mockFlags,
}));

import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
import GlobalSearchTrigger from '../global-search-trigger.svelte';

describe('trigger + feature flag', () => {
  beforeEach(() => {
    mockFlags.value.search = true;
    globalSearchManager.close();
  });

  it('trigger renders when flag is on', () => {
    render(GlobalSearchTrigger);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('trigger hides when flag is off', () => {
    mockFlags.value.search = false;
    render(GlobalSearchTrigger);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('clicking trigger opens the palette', async () => {
    const user = userEvent.setup();
    render(GlobalSearchTrigger);
    await user.click(screen.getByRole('button'));
    expect(globalSearchManager.isOpen).toBe(true);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

Trigger component:

```svelte
<!-- global-search-trigger.svelte -->
<script lang="ts">
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { mdiMagnify } from '@mdi/js';
  import Icon from '$lib/elements/Icon.svelte';
  import { t } from 'svelte-i18n';
</script>

{#if featureFlagsManager.value.search}
  <button
    type="button"
    onclick={() => globalSearchManager.open()}
    class="flex w-full items-center gap-2 rounded-lg border border-gray-200 bg-subtle/60 px-3 py-2 text-sm text-gray-500 hover:bg-subtle dark:border-gray-700 dark:text-gray-400"
  >
    <Icon path={mdiMagnify} size="16" />
    <span class="flex-1 text-left">{$t('cmdk_search')}</span>
    <!-- Keybind chip: pill styling per design § Atmosphere line 413 -->
    <kbd class="rounded-sm border border-gray-200 bg-subtle/60 px-1.5 py-0.5 font-mono text-[11px] font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">⌘K</kbd>
  </button>
{/if}
```

Edit `navigation-bar.svelte` lines 86–91 — replace the existing `{#if featureFlagsManager.value.search}<SearchBar grayTheme />{/if}` with just `<GlobalSearchTrigger />` (the trigger self-gates):

```svelte
<div class="hidden w-full max-w-5xl flex-1 tall:ps-0 sm:block">
  <GlobalSearchTrigger />
</div>
```

**Leave the mobile `<IconButton>` at lines 93–105 unchanged.**

Edit `search-bar.svelte` line 246 — delete only the Ctrl+K binding:

```svelte
<svelte:document
  use:shortcuts={[
    { shortcut: { ctrl: true, shift: true, key: 'k' }, onShortcut: onFilterClick },
  ]}
/>
```

Edit `+layout.svelte` — register the global bindings and mount:

```svelte
<script lang="ts">
  import { globalSearchManager } from '$lib/managers/global-search-manager.svelte';
  import { featureFlagsManager } from '$lib/managers/feature-flags-manager.svelte';
  import GlobalSearch from '$lib/components/global-search/global-search.svelte';
  // ... existing imports (modalManager, SearchFilterModal) ...
</script>

<svelte:document
  use:shortcuts={[
    {
      shortcut: { ctrl: true, key: 'k' },
      onShortcut: () => {
        if (featureFlagsManager.value.search) globalSearchManager.toggle();
      },
    },
    {
      shortcut: { ctrl: true, shift: true, key: 'k' },
      onShortcut: () => modalManager.show(SearchFilterModal, {}),
    },
    {
      // Ctrl+/ cycles the palette's search mode — only while the palette is open.
      shortcut: { ctrl: true, key: '/' },
      onShortcut: () => {
        if (!globalSearchManager.isOpen) return;
        const order: SearchMode[] = ['smart', 'metadata', 'description', 'ocr'];
        const next = order[(order.indexOf(globalSearchManager.mode) + 1) % order.length];
        globalSearchManager.setMode(next);
      },
    },
    // ... existing Ctrl+Shift+M etc ...
  ]}
/>
{#if globalSearchManager.isOpen}
  <GlobalSearch manager={globalSearchManager} />
{/if}
```

**Note:** Grep `web/src/routes` and `web/src/lib/managers/modal-manager*` for the real modalManager API before writing — the exact method name may be `.show`, `.open`, or something else. Match what's already in use.

Edit `ShortcutsModal.svelte` around line 34–35 — change the `Ctrl+K` row's description to `shortcut_open_global_search` and add a new `Ctrl+/` row for `shortcut_cycle_search_mode`. `Ctrl+Shift+K` stays.

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/global-search-trigger.svelte \
  web/src/lib/components/shared-components/navigation-bar/navigation-bar.svelte \
  web/src/routes/+layout.svelte \
  web/src/lib/components/shared-components/search-bar/search-bar.svelte \
  web/src/lib/modals/ShortcutsModal.svelte \
  web/src/lib/managers/global-search-manager.svelte.ts
git commit -m "feat(web): wire trigger, global Ctrl+K, and layout mount"
```

---

## Task 16 — Preview pane components

**Files:**

- Create: `web/src/lib/components/global-search/global-search-preview.svelte`
- Create: `web/src/lib/components/global-search/previews/{photo,person,place,tag}-preview.svelte`
- Create: `web/src/lib/components/global-search/__tests__/{photo,person,place,tag}-preview.spec.ts`
- Modify: `web/src/lib/stores/media-query-manager.svelte.ts` — add a `minLg` getter
- Modify: `web/src/lib/components/global-search/global-search.svelte` — wrap `Command.List` in a two-pane flex layout and mount `<GlobalSearchPreview>` when `minLg` is true

**Context:** Type-dispatched preview. Each preview has its own dwell timer + AbortController. Empty-state strings for place and tag cover the "user has no photos at this scope" case. Mount only on viewports ≥ 1024 px.

**Breakpoint helper.** Gallery's `media-query-manager.svelte.ts` at `web/src/lib/stores/` (verified) exposes `pointerCoarse`, `maxMd`, `isFullSidebar`, `reducedMotion` — none gives "≥ 1024 px." Add a `minLg` getter to the same file so the palette doesn't invent a bespoke listener:

```ts
// web/src/lib/stores/media-query-manager.svelte.ts
import { MediaQuery } from 'svelte/reactivity';

const pointerCoarse = new MediaQuery('pointer:coarse');
const maxMd = new MediaQuery('max-width: 767px');
const sidebar = new MediaQuery('min-width: 850px');
const reducedMotion = new MediaQuery('prefers-reduced-motion: reduce');
const minLg = new MediaQuery('min-width: 1024px'); // NEW

export const mediaQueryManager = {
  get pointerCoarse() {
    return pointerCoarse.current;
  },
  get maxMd() {
    return maxMd.current;
  },
  get isFullSidebar() {
    return sidebar.current;
  },
  get reducedMotion() {
    return reducedMotion.current;
  },
  get minLg() {
    return minLg.current;
  }, // NEW
};
```

**Step 1: Write failing tests** (sample — `tag-preview`):

```ts
import { render, screen } from '@testing-library/svelte';
import TagPreview from '../previews/tag-preview.svelte';
import { searchAssets } from '@immich/sdk';

vi.mock('@immich/sdk', async () => ({
  ...(await vi.importActual<typeof import('@immich/sdk')>('@immich/sdk')),
  searchAssets: vi.fn(),
}));

describe('tag-preview', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('defers the fetch 300 ms after mount', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
    render(TagPreview, { props: { tag: { id: 't1', name: 'beach', color: null } } });
    await vi.advanceTimersByTimeAsync(200);
    expect(searchAssets).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(searchAssets).toHaveBeenCalledOnce();
  });

  it('renders "No photos tagged yet" on empty response', async () => {
    vi.mocked(searchAssets).mockResolvedValue({ assets: { items: [], nextPage: null } } as any);
    render(TagPreview, { props: { tag: { id: 't1', name: 'beach', color: null } } });
    await vi.advanceTimersByTimeAsync(400);
    await Promise.resolve();
    expect(screen.getByText(/no photos tagged/i)).toBeInTheDocument();
  });

  it('discards late response when tag prop changes', async () => {
    let resolveFirst!: (v: any) => void;
    vi.mocked(searchAssets).mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    const { rerender } = render(TagPreview, { props: { tag: { id: 't1', name: 'beach', color: null } } });
    await vi.advanceTimersByTimeAsync(400);
    vi.mocked(searchAssets).mockResolvedValueOnce({ assets: { items: [{ id: 'b1' }], nextPage: null } } as any);
    rerender({ tag: { id: 't2', name: 'mountain', color: null } });
    await vi.advanceTimersByTimeAsync(400);
    resolveFirst({ assets: { items: [{ id: 'a1' }], nextPage: null } });
    await Promise.resolve();
    // Final rendered grid should reflect the second fetch, not the first
    expect(screen.queryByText(/beach/i)).toBeNull();
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement** — sample `tag-preview.svelte`:

```svelte
<script lang="ts">
  import { searchAssets, AssetMediaSize, type TagResponseDto, type AssetResponseDto } from '@immich/sdk';
  import { getAssetMediaUrl } from '$lib/utils';
  import { t } from 'svelte-i18n';

  interface Props { tag: TagResponseDto; }
  let { tag }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;

  $effect(() => {
    const gen = ++generation;
    const tagId = tag.id;
    photos = [];
    loaded = false;
    const dwell = setTimeout(async () => {
      const ctrl = new AbortController();
      try {
        const response = await searchAssets(
          { metadataSearchDto: { tagIds: [tagId], size: 6 } },
          { signal: ctrl.signal },
        );
        if (gen !== generation) return;
        photos = response.assets.items;
      } catch {
        // ignore
      } finally {
        if (gen === generation) loaded = true;
      }
    }, 300);
    return () => clearTimeout(dwell);
  });
</script>

<div class="p-5">
  <div class="text-base font-semibold">{tag.name}</div>
  {#if loaded && photos.length === 0}
    <div class="mt-3 text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_no_tagged_photos')}</div>
  {:else if loaded}
    <div class="mt-3 grid grid-cols-3 gap-2">
      {#each photos as photo (photo.id)}
        <img
          src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
          alt=""
          class="h-[72px] w-[72px] rounded-md object-cover"
        />
      {/each}
    </div>
  {/if}
</div>
```

`photo-preview.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, type AssetResponseDto } from '@immich/sdk';
  import { Button } from '@immich/ui';
  import { t } from 'svelte-i18n';
  import { goto } from '$app/navigation';

  interface Props { photo: AssetResponseDto; }
  let { photo }: Props = $props();

  const thumbUrl = $derived(
    getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Preview, cacheKey: (photo as { thumbhash?: string }).thumbhash }),
  );
  const dateLine = $derived(
    [photo.exifInfo?.dateTimeOriginal?.slice(0, 10), photo.exifInfo?.city].filter(Boolean).join(' · '),
  );
  const cameraLine = $derived(
    [photo.exifInfo?.make, photo.exifInfo?.fNumber, photo.exifInfo?.exposureTime].filter(Boolean).join(' · '),
  );
</script>

<div class="flex h-full flex-col gap-3 p-5">
  <img
    src={thumbUrl}
    alt={photo.originalFileName ?? ''}
    class="aspect-[4/3] w-full rounded-md object-cover"
    loading="lazy"
  />
  <div class="min-w-0">
    <div class="truncate text-base font-semibold">{photo.originalFileName}</div>
    {#if dateLine}
      <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{dateLine}</div>
    {/if}
    {#if cameraLine}
      <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{cameraLine}</div>
    {/if}
  </div>
  <div class="mt-auto flex gap-2">
    <Button variant="ghost" size="small" onclick={() => goto(`/photos/${photo.id}`)}>
      {$t('cmdk_open')}
    </Button>
    <!-- "Add to album" deferred to v1.1 — it needs the album picker modal which is out of scope for this PR. -->
  </div>
</div>
```

`person-preview.svelte`:

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type PersonResponseDto, type AssetResponseDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props { person: PersonResponseDto & { numberOfAssets?: number }; }
  let { person }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;

  const thumbUrl = $derived(
    person.faceAssetId ? getAssetMediaUrl({ id: person.faceAssetId, size: AssetMediaSize.Preview }) : '',
  );

  $effect(() => {
    const gen = ++generation;
    const id = person.id;
    photos = [];
    loaded = false;
    const dwell = setTimeout(async () => {
      const ctrl = new AbortController();
      try {
        const response = await searchAssets({ metadataSearchDto: { personIds: [id], size: 4 } }, { signal: ctrl.signal });
        if (gen !== generation) return;
        photos = response.assets.items;
      } catch {
        // ignored
      } finally {
        if (gen === generation) loaded = true;
      }
    }, 300);
    return () => clearTimeout(dwell);
  });
</script>

<div class="flex h-full flex-col items-center gap-3 p-5">
  {#if thumbUrl}
    <img src={thumbUrl} alt={person.name ?? ''} class="h-[120px] w-[120px] rounded-full object-cover" />
  {:else}
    <div class="h-[120px] w-[120px] rounded-full bg-subtle/40"></div>
  {/if}
  <div class="text-center">
    <div class="text-lg font-semibold">{person.name || $t('cmdk_unnamed_person')}</div>
    {#if person.numberOfAssets !== undefined}
      <div class="text-xs font-normal text-gray-500 dark:text-gray-400">{person.numberOfAssets} photos</div>
    {/if}
  </div>
  {#if loaded && photos.length > 0}
    <div class="mt-2 flex gap-2">
      {#each photos as photo (photo.id)}
        <img
          src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
          alt=""
          class="h-12 w-12 rounded-md object-cover"
        />
      {/each}
    </div>
  {/if}
</div>
```

`place-preview.svelte`:

The design calls for a static map tile, but **Gallery does not ship a static-map-tile helper** (no OSM static API caller, no Leaflet-to-image helper). Mounting a full Leaflet instance per cursor move would cost real performance. **v1 drops the map tile and renders the recent-photos strip + place name only.** v1.1 can add a static map when we decide on a tile source (OpenStreetMap's static tile API or a Mapbox static image endpoint).

```svelte
<script lang="ts">
  import { getAssetMediaUrl } from '$lib/utils';
  import { AssetMediaSize, searchAssets, type PlacesResponseDto, type AssetResponseDto } from '@immich/sdk';
  import Icon from '$lib/elements/Icon.svelte';
  import { mdiMapMarker } from '@mdi/js';
  import { t } from 'svelte-i18n';

  interface Props { place: PlacesResponseDto; }
  let { place }: Props = $props();

  let photos = $state<AssetResponseDto[]>([]);
  let loaded = $state(false);
  let generation = 0;

  $effect(() => {
    const gen = ++generation;
    const { latitude, longitude } = place;
    photos = [];
    loaded = false;
    const dwell = setTimeout(async () => {
      const ctrl = new AbortController();
      try {
        // MetadataSearchDto has no latitude/longitude — only city/state/country.
        // Use the geocoder's place name to filter. Pass state and country as
        // disambiguation for cities with repeated names (Springfield, Paris, etc.).
        const response = await searchAssets(
          {
            metadataSearchDto: {
              city: place.name,
              state: place.admin1name ?? undefined,
              country: place.countryName ?? undefined,
              size: 4,
            },
          },
          { signal: ctrl.signal },
        );
        if (gen !== generation) return;
        photos = response.assets.items;
      } catch {
        // ignored
      } finally {
        if (gen === generation) loaded = true;
      }
    }, 300);
    return () => clearTimeout(dwell);
  });

  const subtitle = $derived([place.admin1name, place.countryName].filter(Boolean).join(' · '));
</script>

<div class="flex h-full flex-col gap-3 p-5">
  <div class="flex items-center gap-2">
    <Icon path={mdiMapMarker} size="24" class="text-gray-500 dark:text-gray-400" />
    <div class="min-w-0 flex-1">
      <div class="truncate text-base font-semibold">{place.name}</div>
      {#if subtitle}
        <div class="truncate text-xs font-normal text-gray-500 dark:text-gray-400">{subtitle}</div>
      {/if}
    </div>
  </div>
  {#if loaded}
    {#if photos.length > 0}
      <div class="flex gap-2">
        {#each photos as photo (photo.id)}
          <img
            src={getAssetMediaUrl({ id: photo.id, size: AssetMediaSize.Thumbnail })}
            alt=""
            class="h-12 w-12 rounded-md object-cover"
          />
        {/each}
      </div>
    {:else}
      <div class="text-xs text-gray-500 dark:text-gray-400">{$t('cmdk_no_photos_here')}</div>
    {/if}
  {/if}
</div>
```

Dispatcher:

```svelte
<!-- global-search-preview.svelte -->
<script lang="ts">
  import type { ActiveItem } from '$lib/managers/global-search-manager.svelte';
  import PhotoPreview from './previews/photo-preview.svelte';
  import PersonPreview from './previews/person-preview.svelte';
  import PlacePreview from './previews/place-preview.svelte';
  import TagPreview from './previews/tag-preview.svelte';
  import { t } from 'svelte-i18n';

  interface Props { activeItem: ActiveItem | null; }
  let { activeItem }: Props = $props();
</script>

{#if activeItem === null}
  <div class="flex h-full items-center justify-center text-sm text-gray-500 dark:text-gray-400 opacity-40">
    {$t('cmdk_nothing_to_preview')}
  </div>
{:else if activeItem.kind === 'photo'}
  <PhotoPreview photo={activeItem.data as any} />
{:else if activeItem.kind === 'person'}
  <PersonPreview person={activeItem.data as any} />
{:else if activeItem.kind === 'place'}
  <PlacePreview place={activeItem.data as any} />
{:else if activeItem.kind === 'tag'}
  <TagPreview tag={activeItem.data as any} />
{/if}
```

**Amend `global-search.svelte` to mount the preview pane at ≥ 1024 px** (using the `minLg` getter added above in step 1). This is the second modification of `global-search.svelte` in the task sequence — Task 14b already added the footer import and mount.

Import additions:

```ts
import GlobalSearchPreview from './global-search-preview.svelte';
import { mediaQueryManager } from '$lib/stores/media-query-manager.svelte';

const showPreview = $derived(mediaQueryManager.minLg);
```

Wrap `Command.List` (and the ML banner above it) in a flex container so the preview pane lives as a sibling to the list:

```svelte
<!-- Replace Task 14's single-column body with a two-pane flex -->
<div class="flex flex-1 min-h-[420px]">
  <div class="flex flex-1 flex-col {showPreview ? 'border-r border-gray-200 dark:border-gray-700' : ''}">
    {#if manager.mode === 'smart' && !manager.mlHealthy && inputValue.trim() !== ''}
      <!-- ML banner (unchanged from Task 14) -->
    {/if}
    <Command.List class="flex-1 overflow-y-auto py-2">
      <!-- ... unchanged sections ... -->
    </Command.List>
  </div>
  {#if showPreview}
    <div data-cmdk-preview class="w-[280px] shrink-0 overflow-y-auto">
      <GlobalSearchPreview activeItem={manager.getActiveItem()} />
    </div>
  {/if}
</div>
```

The `aria-live` region and `<GlobalSearchFooter {manager} />` stay siblings of the flex container inside `Command.Root`.

**Additional test to add to `global-search.spec.ts`:**

```ts
it('preview pane does not mount below 1024 px', () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 1024px)' ? false : true,
    media: query,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  }));
  const m = new GlobalSearchManager();
  m.open();
  const { container } = render(GlobalSearch, { props: { manager: m } });
  // Preview pane carries a known data attribute or test-id
  expect(container.querySelector('[data-cmdk-preview]')).toBeNull();
});
```

**Step 4: Run — expect pass**

**Step 5: Commit**

```bash
cd web && pnpm check && pnpm lint
git add web/src/lib/components/global-search/previews/ \
  web/src/lib/components/global-search/global-search-preview.svelte \
  web/src/lib/components/global-search/global-search.svelte \
  web/src/lib/components/global-search/__tests__/ \
  web/src/lib/stores/media-query-manager.svelte.ts
git commit -m "feat(web): preview pane with dwell, staleness, empty states"
```

---

## Task 17 — ML health probe on open + banner

**Files:**

- Modify: `web/src/lib/managers/global-search-manager.svelte.ts`
- Modify: `web/src/lib/managers/global-search-manager.svelte.spec.ts`
- Modify: `web/src/lib/components/global-search/global-search.svelte` — add banner

**Context:** `open()` stays synchronous and fire-and-forgets the probe.

**Step 1: Write failing tests**

```ts
import { getMlHealth } from '@immich/sdk';

describe('ML health probe', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    installFakeAbortTimeout();
    vi.mocked(getMlHealth).mockResolvedValue({ smartSearchHealthy: true } as any);
  });
  afterEach(() => {
    restoreAbortTimeout();
    vi.useRealTimers();
  });

  it('probes on first open, caches for session', async () => {
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    m.close();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(getMlHealth).toHaveBeenCalledOnce();
  });

  it('sets mlHealthy=false when probe reports unhealthy', async () => {
    vi.mocked(getMlHealth).mockResolvedValue({ smartSearchHealthy: false } as any);
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.mlHealthy).toBe(false);
  });

  it('trusts current state if probe throws', async () => {
    vi.mocked(getMlHealth).mockRejectedValue(new Error('net'));
    const m = new GlobalSearchManager();
    m.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(m.mlHealthy).toBe(true);
  });
});
```

**Step 2: Run — expect failure**

**Step 3: Implement**

```ts
import { getMlHealth } from '@immich/sdk';

private mlProbed = false;

open() {
  this.isOpen = true;
  if (!this.mlProbed) {
    this.mlProbed = true;
    void this.probeMlHealth();
  }
}

private async probeMlHealth() {
  try {
    const result = await getMlHealth();
    this.mlHealthy = result.smartSearchHealthy;
  } catch {
    // Retroactive promotion (onPhotosSettled in Task 11) handles mid-session failure.
  }
}
```

In `global-search.svelte`, render the banner inside the Photos section when `manager.mode === 'smart' && !manager.mlHealthy`:

```svelte
{#if manager.mode === 'smart' && !manager.mlHealthy}
  <div class="mx-3 mb-2 rounded-md bg-subtle/60 px-3 py-2 text-xs">
    {$t('cmdk_smart_unavailable')}
    <button type="button" onclick={() => manager.setMode('metadata')} class="text-primary">
      {$t('cmdk_try_filename')}
    </button>
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
git commit -m "feat(web): ML health probe on open + banner"
```

---

## Task 18 — i18n keys

**Files:**

- Modify: `i18n/en.json`

**Step 1: Add keys**

Add to `i18n/en.json` (unsorted — formatter handles it):

```
cmdk_helper: "Start typing — photos, people, places, tags."
cmdk_placeholder: "Search Gallery"
cmdk_search: "Search…"
cmdk_photos_heading: "Photos"
cmdk_people_heading: "People"
cmdk_places_heading: "Places"
cmdk_tags_heading: "Tags"
cmdk_recent_heading: "Recent"
cmdk_see_all: "See all {count}"
cmdk_smart_unavailable: "Smart search is unavailable"
cmdk_try_filename: "Try Filename mode"
cmdk_slow_results: "Search is slow — results may be incomplete"
cmdk_couldnt_load: "Couldn't load {entity} — retry"
cmdk_no_photos_here: "No photos here yet"
cmdk_no_tagged_photos: "No photos tagged yet"
cmdk_open: "Open"
cmdk_tag_cache_too_large: "Too many tags to search in-browser — use the Tags page"
cmdk_nothing_to_preview: "Select a result to preview"
cmdk_unnamed_person: "Unnamed person"
cmdk_search_mode: "Search mode"
cmdk_mode_smart: "Smart"
cmdk_mode_filename: "Filename"
cmdk_mode_description: "Description"
cmdk_mode_ocr: "OCR"
cmdk_cycle_mode_hint: "cycle mode"
global_search: "Global search"
shortcut_open_global_search: "Open global search"
shortcut_cycle_search_mode: "Cycle search mode"
```

**Step 2: Sort**

```bash
pnpm --filter=immich-i18n format:fix
```

**Step 3: Verify**

```bash
cd web && pnpm check
```

**Step 4: Commit**

```bash
git add i18n/
git commit -m "i18n(web): keys for global search palette"
```

---

## Task 19 — E2E: basic flows

**Files:**

- Create: `e2e/src/specs/web/global-search.e2e-spec.ts`

**Context:** Use `utils.adminSetup()` (real helper at `e2e/src/utils.ts:329`), not an invented `createAdminUser`. Drain metadata extraction before asserting on tag rows. Keyboard-only, no hover.

**Step 1: Write the test**

```ts
import { test, expect } from '@playwright/test';
import { utils } from 'src/utils';

test.describe('global search palette', () => {
  let adminAccessToken: string;

  test.beforeAll(async () => {
    await utils.resetDatabase();
    const admin = await utils.adminSetup();
    adminAccessToken = admin.accessToken;
    // Upload a seeded test asset using the existing helper (utils.ts:375).
    // Find a test fixture under e2e/test-assets/ (grep existing specs for a known file name).
    await utils.createAsset(admin.accessToken);
    // Drain metadata extraction before asserting on tag/filename-based results
    // (per feedback_e2e_metadata_extraction_wait, utils.ts:805).
    await utils.waitForQueueFinish(admin.accessToken, 'metadataExtraction');
  });

  test('Ctrl+K opens, type query, Enter on photo opens viewer', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByRole('combobox').fill('sunset');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 8000 });

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/photos\/[a-f0-9-]+/);
  });

  test('Esc clears input, second Esc closes (APG)', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('beach');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('combobox')).toHaveValue('');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('mode switch via Ctrl+/ re-runs photos', async ({ page }) => {
    await page.goto('/photos');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('IMG');
    await expect(page.getByRole('option').first()).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Control+/');
    // Assert segmented control moved — exact locator depends on final DOM
  });
});
```

**Step 2: Run + commit**

```bash
cd e2e && pnpm test:web -- global-search
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): global search palette basic flows"
```

---

## Task 20 — E2E: ML banner + feature flag

**Files:**

- Modify: `e2e/src/specs/web/global-search.e2e-spec.ts`

**Context:** CI runs with ML disabled, so `getMlHealth` naturally returns `false`. The feature-flag toggle uses the existing system-config admin endpoint — grep `e2e/src/specs/` for existing tests that mutate `server.features` or similar to find the real helper.

**Step 1: Write the tests**

```ts
test('ML unhealthy banner appears in smart mode', async ({ page }) => {
  await page.goto('/photos');
  await page.keyboard.press('Control+k');
  await expect(page.getByText(/smart search is unavailable/i)).toBeVisible();
});

test('Try Filename mode button switches mode and hides banner', async ({ page }) => {
  await page.goto('/photos');
  await page.keyboard.press('Control+k');
  await page.getByRole('button', { name: /try filename mode/i }).click();
  await expect(page.getByText(/smart search is unavailable/i)).toBeHidden();
});

test('feature flag off hides trigger and disables Ctrl+K', async ({ page }) => {
  // Grep e2e/src for the existing pattern that updates system config / features
  // e.g. updateConfig({ systemConfigDto: { server: { ... } } })
  // Apply the equivalent of server.features.search = false
  await page.goto('/photos');
  await expect(page.locator('button:has-text("Search…")')).toBeHidden();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog')).toBeHidden();
  // Restore the flag
});
```

**Step 2: Run + commit**

```bash
cd e2e && pnpm test:web -- global-search
git add e2e/src/specs/web/global-search.e2e-spec.ts
git commit -m "test(e2e): ML banner and feature flag gating"
```

---

## Task 21 — Visual QA + final suites

**Files:** none modified — verification only.

**Step 1: Dev stack**

```bash
make dev
```

**Step 2: Seed data**

Use the `env-prep` skill or manually upload assets covering photos, people, places, tags.

**Step 3: Manual visual QA**

At 1024 px, 720 px, 480 px in light and dark modes, confirm:

- Two-pane layout ≥ 1024 px, single-pane elsewhere
- Mobile (< 640 px): palette edge-to-edge; existing magnify IconButton → `/search` still works
- Active row `bg-primary/10` tint visible in both themes
- Skeleton pulse matches global `Skeleton.svelte` cadence
- `prefers-reduced-motion` drops animations to instant (DevTools Rendering panel)
- Navbar reflow: trigger button doesn't crush other nav elements

**Step 4: ML down/up**

```bash
grep -E 'machine-learning|ml' docker/docker-compose.dev.yml | head -5
# find the real service name, then:
docker compose -f docker/docker-compose.dev.yml stop <ml-service-name>
# open palette, confirm banner
docker compose -f docker/docker-compose.dev.yml start <ml-service-name>
```

**Step 5: Final suites (sequential, per `feedback_no_parallel_tests`)**

```bash
cd server && pnpm check && pnpm lint && pnpm test
cd ../web && pnpm check && pnpm lint && pnpm test
cd ../e2e && pnpm test:web -- global-search
```

All green before opening the PR.

---

## Summary of commits

```
 1. feat(ml): per-caller timeoutMs option on predict()
 2. feat(ml): 15s timeout on encodeText for palette hot path
 3. feat(server): ServerMlHealthResponseDto and MachineLearningRepository.ping()
 4. feat(server): getMlHealth() with cache, single-flight, content-type check
 5. feat(server): GET /server/ml-health endpoint
 6. chore(web): add bits-ui as direct dependency for global search palette
 7. feat(web): GlobalSearchManager skeleton with instance-bound providers
 8. feat(web): setQuery with debounce, abort, and 5s timeout
 9. feat(web): photos, people, places providers
10. feat(web): tag provider with cache, 20k cap, storage-event invalidation
11. feat(web): setMode, cursor identity, Enter capture, ML health promotion
12. feat(web): cmdk.recent localStorage store with quota-preserving writes
13. feat(web): row components for global search palette
14. feat(web): GlobalSearch root + section via @immich/ui Modal (two-pane layout, preview mount)
14b. feat(web): mode selector footer with segmented radiogroup
15. feat(web): wire trigger, global Ctrl+K, Ctrl+/, and layout mount
16. feat(web): preview pane with dwell, staleness, empty states (photo/person/place/tag)
17. feat(web): ML health probe on open + banner
18. i18n(web): keys for global search palette
19. test(e2e): global search palette basic flows
20. test(e2e): ML banner and feature flag gating
```

Task 21 is verification — no commit unless QA uncovers a fix.

---

## Executor notes

- **Read the design doc first.** This plan is the _how_; the design doc is the _what_ and _why_.
- **Match existing Gallery conventions** if the plan and reality disagree. Grep for real helper names and paths before inventing.
- **Never skip the confirm-failure TDD step.** It's the only proof your test exercises the new code.
- **One commit per task.** 20 reviewable commits beat 1 monster commit.
- **Svelte 5:** don't mutate `$state` from inside `$derived` (per `feedback_svelte_derived_no_mutation`); use `SvelteMap`/`SvelteSet` in `.svelte` files (per `feedback_svelte_map_lint`).
- **Never merge PRs without explicit user confirmation** (per `feedback_never_merge_without_asking`). This plan produces the branch; merging is a separate explicit step.
