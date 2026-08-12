# Spaces in Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Gallery workflow add its triggering asset to a shared space, or to a named album inside a shared space, without growing the fork's footprint in upstream-owned files.

**Architecture:** A fork-owned WASM plugin (`packages/plugin-gallery`) declares two action methods whose bodies are one-line shims. They reach the server through a single generic host function, `gallery(method, args)`, wired once into upstream's `onPluginLoad()`. All logic lives in a fork-owned NestJS service, `GalleryWorkflowHostService`, which calls `SharedSpaceService` and `AlbumService` so that access control runs exactly as it does for HTTP requests. The service never throws for user-fixable conditions, because a throw would abort every remaining workflow step.

**Tech Stack:** TypeScript, NestJS, Kysely, zod, vitest (server + web), Svelte 5 runes, extism / `@extism/js-pdk` (WASM), esbuild, Playwright-free e2e via supertest.

**Spec:** `docs/superpowers/specs/2026-08-12-spaces-in-workflows-design.md`

## Global Constraints

- **Never touch upstream files beyond the six listed in spec §5.1.** Every other change is fork-owned. If a task seems to need a seventh, stop and raise it.
- **The dispatcher must never throw for user-fixable conditions** (spec §7). A throw propagates out of the WASM sandbox into `execute()`'s catch, which abandons all remaining steps.
- **The dispatcher calls services, never repositories** (spec §6.1) — that is what enforces space membership.
- **`reason` is advisory, log-only** (spec D11). Tests assert `ok === false`, except `invalid-config` and `unknown-method`, which the dispatcher produces itself.
- **Verified commands only.** `make check-server`, `make check-web`, `make lint-all` and friends **do not exist** in this repo despite CLAUDE.md. Use the per-package scripts given in each task.
- **`pnpm test -- --run <path>` silently runs the entire suite** (false green). Always `pnpm test --run <path>` — no `--`.
- **i18n:** any new user-facing string lands in all ten locale files in the same commit — `en`, `de`, `fr`, `it`, `nl`, `pl`, `es`, `ru`, `zh_Hans`, `zh_Hant` — alphabetically placed, then `npx prettier --write i18n/*.json`.
- **No `Co-Authored-By` or "Generated with" trailers** in commits.

## Prerequisites

Run once in a fresh worktree, before Task 1. Server tests will not run without these builds.

```bash
pnpm install
pnpm --filter @immich/sdk build
pnpm --filter @immich/plugin-sdk build
```

## File Structure

**Created (all fork-owned):**

| Path                                                           | Responsibility                                                                |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `packages/plugin-gallery/manifest.json`                        | Method declarations — the source of truth for method names and config schemas |
| `packages/plugin-gallery/package.json`                         | Build scripts, mirroring `plugin-core`                                        |
| `packages/plugin-gallery/tsconfig.json`                        | Compiler config, mirroring `plugin-core`                                      |
| `packages/plugin-gallery/esbuild.js`                           | Bundles `src/index.ts` to CJS for QuickJS                                     |
| `packages/plugin-gallery/bin/prepare-build.mjs`                | Generates `dist/index.d.ts` declaring the `gallery` host import               |
| `packages/plugin-gallery/src/contract.ts`                      | Method-argument types shared by shim and host declaration                     |
| `packages/plugin-gallery/src/host.ts`                          | The `gallery` host-function caller                                            |
| `packages/plugin-gallery/src/index.ts`                         | Two shims — no branching, no logic                                            |
| `server/src/services/gallery-workflow-host.service.ts`         | Dispatcher + every fork handler                                               |
| `server/src/services/gallery-workflow-host.service.spec.ts`    | Unit tests U0–U30                                                             |
| `web/src/lib/components/SchemaSpacePicker.svelte`              | Space picker for the step config form                                         |
| `web/src/lib/components/SchemaSpacePicker.test-wrapper.svelte` | Owns `$state` so tests can assert the bindable prop propagating upward        |
| `web/src/lib/components/SchemaSpacePicker.spec.ts`             | Web tests W1–W7                                                               |
| `e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts`         | End-to-end guard E1–E5                                                        |

**Modified (upstream-owned — the entire permanent seam):**

| Path                                                | Change                                            |
| --------------------------------------------------- | ------------------------------------------------- |
| `server/src/repositories/config.repository.ts`      | `resourcePaths.galleryPlugin` (type + value)      |
| `server/src/services/workflow-execution.service.ts` | `gallery` host function + one `importFolder` call |
| `docker/docker-compose.dev.yml`                     | One bind-mount                                    |
| `web/src/lib/types.ts`                              | `uiHint.type` union gains `'SpaceId'`             |
| `web/src/lib/components/SchemaConfiguration.svelte` | One branch                                        |
| `server/Dockerfile`                                 | Build + copy in the existing `plugins` stage      |

`server/src/services/index.ts` is **not** modified: the dispatcher is constructed with `BaseService.create`, never injected, and declares no `@OnEvent`/`@OnJob`, so Nest never needs to know about it.

---

### Task 1: Plugin manifest and package scaffold

**Files:**

- Create: `packages/plugin-gallery/manifest.json`
- Create: `packages/plugin-gallery/package.json`
- Create: `packages/plugin-gallery/tsconfig.json`
- Create: `packages/plugin-gallery/esbuild.js`
- Test: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: nothing.
- Produces: manifest method names `addToSpace` and `addToSpaceAlbum`; plugin name `gallery-core`; config keys `spaceIds` (string array), `spaceId` (string), `albumName` (string).

- [ ] **Step 1: Write the failing test**

Create `server/src/services/gallery-workflow-host.service.spec.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PluginManifestDto } from 'src/dtos/plugin-manifest.dto';
import { describe, expect, it } from 'vitest';

// `import.meta` is not legal here — the server package builds to CommonJS and `tsc --noEmit`
// rejects it (TS1470), even though vitest tolerates it. Server vitest runs with cwd = server/.
const manifestPath = join(process.cwd(), '..', 'packages/plugin-gallery/manifest.json');
const readManifest = () => JSON.parse(readFileSync(manifestPath, { encoding: 'utf8' }));

describe('gallery plugin manifest', () => {
  // U0 — manifest failure is SILENT at runtime: importFolder catches everything and only warns
  // (workflow-execution.service.ts:269-271), so an invalid manifest ships an image where the
  // feature simply does not exist, with a green test suite.
  it('validates against the server manifest schema', () => {
    const result = PluginManifestDto.schema.safeParse(readManifest());
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('declares exactly the two space actions', () => {
    expect(
      readManifest()
        .methods.map((method: { name: string }) => method.name)
        .sort(),
    ).toEqual(['addToSpace', 'addToSpaceAlbum']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: FAIL — `ENOENT: no such file or directory, open '.../packages/plugin-gallery/manifest.json'`

- [ ] **Step 3: Write the manifest**

Create `packages/plugin-gallery/manifest.json`. `name` must satisfy `/^[a-z0-9-]+[a-z0-9]$/` and `version` must be semver (`plugin-manifest.dto.ts:6-8`). `templates` is empty this cut (spec D12).

```json
{
  "name": "gallery-core",
  "version": "1.0.0",
  "title": "Gallery",
  "description": "Gallery workflow actions for shared spaces",
  "author": "Gallery",
  "wasmPath": "dist/plugin.wasm",
  "templates": [],
  "methods": [
    {
      "name": "addToSpace",
      "title": "Add to space",
      "description": "Add the asset to one or more shared spaces",
      "types": ["AssetV1"],
      "hostFunctions": true,
      "schema": {
        "type": "object",
        "properties": {
          "spaceIds": {
            "type": "string",
            "array": true,
            "title": "Spaces",
            "description": "Target shared spaces",
            "uiHint": { "type": "SpaceId" }
          }
        },
        "required": ["spaceIds"]
      }
    },
    {
      "name": "addToSpaceAlbum",
      "title": "Add to space album",
      "description": "Add the asset to an album in a shared space, creating it if needed",
      "types": ["AssetV1"],
      "hostFunctions": true,
      "schema": {
        "type": "object",
        "properties": {
          "spaceId": {
            "type": "string",
            "title": "Space",
            "description": "The shared space that owns the album",
            "uiHint": { "type": "SpaceId", "order": 1 }
          },
          "albumName": {
            "type": "string",
            "title": "Album name",
            "description": "Uses this album if it exists in the space, otherwise creates and links it",
            "uiHint": { "order": 2 }
          }
        },
        "required": ["spaceId", "albumName"]
      }
    }
  ]
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS (2 tests)

- [ ] **Step 5: Add the package scaffold**

Create `packages/plugin-gallery/package.json`:

```json
{
  "name": "@immich/plugin-gallery",
  "version": "1.0.0",
  "description": "Gallery workflow plugin",
  "main": "src/index.ts",
  "scripts": {
    "build": "pnpm build:tsc && pnpm build:wasm",
    "build:tsc": "node bin/prepare-build.mjs && tsc --noEmit && node esbuild.js",
    "build:wasm": "extism-js dist/index.js -i dist/index.d.ts -o dist/plugin.wasm"
  },
  "license": "AGPL-3.0",
  "devDependencies": {
    "@extism/js-pdk": "^1.0.1",
    "@immich/plugin-sdk": "workspace:*",
    "@immich/sdk": "workspace:*",
    "esbuild": "^0.28.0",
    "typescript": "^7.0.0"
  }
}
```

Create `packages/plugin-gallery/esbuild.js` (identical to `plugin-core`'s — CJS and es2020 are required by QuickJS):

```js
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/index.ts'],
  outdir: 'dist',
  bundle: true,
  sourcemap: false,
  minify: false,
  format: 'cjs', // needs to be CJS for now
  target: ['es2020'], // don't go over es2020 because quickjs doesn't support it
});
```

Create `packages/plugin-gallery/tsconfig.json` (copied from `plugin-core`):

```json
{
  "compilerOptions": {
    "allowJs": true,
    "declaration": true,
    "emitDeclarationOnly": true,
    "esModuleInterop": true,
    "lib": ["es2020", "DOM"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "noEmit": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "skipLibCheck": true,
    "strict": true,
    "target": "es2020",
    "types": ["./dist/index.d.ts", "./node_modules/@extism/js-pdk"]
  },
  "exclude": ["node_modules"],
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/plugin-gallery server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): declare the gallery workflow plugin manifest"
```

---

### Task 2: Dispatcher skeleton and the testability seam

**Files:**

- Create: `server/src/services/gallery-workflow-host.service.ts`
- Modify: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: `manifest.json` method names from Task 1.
- Produces:
  - `type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method'`
  - `type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason }`
  - `class GalleryWorkflowHostService extends BaseService` with:
    - `dispatch(auth: AuthDto, method: string, args: unknown): Promise<GalleryDispatchResult>`
    - `get methodNames(): string[]`
    - `protected collaborators(): { sharedSpace: SharedSpaceService; album: AlbumService }`

- [ ] **Step 1: Write the failing tests**

Append to `server/src/services/gallery-workflow-host.service.spec.ts` (keep the Task 1 imports, add these):

```ts
import { AuthDto } from 'src/dtos/auth.dto';
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service';
import { newTestService } from 'test/utils';

const auth = { user: { id: 'user-1' } } as AuthDto;

describe(GalleryWorkflowHostService.name, () => {
  const setup = () => newTestService(GalleryWorkflowHostService);

  // U2 — a stale externally-installed plugin must degrade, not explode.
  it('resolves ok:false for an unknown method instead of rejecting', async () => {
    const { sut } = setup();
    await expect(sut.dispatch(auth, 'noSuchMethod', {})).resolves.toEqual({
      ok: false,
      reason: 'unknown-method',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: FAIL — `Cannot find module 'src/services/gallery-workflow-host.service'`

- [ ] **Step 3: Write the minimal implementation**

Create `server/src/services/gallery-workflow-host.service.ts`:

```ts
import { AuthDto } from 'src/dtos/auth.dto';
import { AlbumService } from 'src/services/album.service';
import { BaseService } from 'src/services/base.service';
import { SharedSpaceService } from 'src/services/shared-space.service';

export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';
export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

type GalleryHandler = (auth: AuthDto, args: unknown) => Promise<GalleryDispatchResult>;

/**
 * Fork-owned dispatcher for every Gallery workflow step.
 *
 * Reached from upstream's `gallery` host function. Constructed with `BaseService.create`, so it is
 * deliberately NOT registered in `services/index.ts` — it has no controller, jobs or events.
 */
export class GalleryWorkflowHostService extends BaseService {
  private services?: { sharedSpace: SharedSpaceService; album: AlbumService };

  /**
   * The single seam that makes this service unit-testable. `newTestService` injects repositories,
   * while `BaseService.create` builds real services from them — so without this, a test could not
   * observe collaborator calls at all. Specs subclass and override it. Memoised so a step does not
   * rebuild both services on every dispatch.
   */
  protected collaborators() {
    this.services ??= {
      sharedSpace: BaseService.create(SharedSpaceService, this),
      album: BaseService.create(AlbumService, this),
    };

    return this.services;
  }

  private readonly handlers: Record<string, GalleryHandler> = {};

  get methodNames(): string[] {
    return Object.keys(this.handlers);
  }

  async dispatch(auth: AuthDto, method: string, args: unknown): Promise<GalleryDispatchResult> {
    const handler = this.handlers[method];
    if (!handler) {
      this.logger.warn(`Unknown gallery workflow method: ${method}`);
      return { ok: false, reason: 'unknown-method' };
    }

    return handler(auth, args);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS — U0 and U2. **Every commit in this plan leaves the suite green**; U1 (manifest/handler parity) is deliberately introduced in Task 5, the task where both handlers exist to make it pass, rather than sitting red across three commits and reddening CI if anything is pushed mid-plan.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/gallery-workflow-host.service.ts server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): add the gallery workflow dispatcher skeleton"
```

---

### Task 3: The never-throws invariant

**Files:**

- Modify: `server/src/services/gallery-workflow-host.service.ts`
- Modify: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: `GalleryDispatchResult`, `dispatch` from Task 2.
- Produces: `protected runGuarded<T>(label: string, work: () => Promise<T>): Promise<T | typeof SKIPPED>` and the exported sentinel `SKIPPED`, used by both handlers.

- [ ] **Step 1: Write the failing tests**

Add the import to the **top** of the file, alongside the existing imports, and the class and `describe`
block at **module scope** — not nested inside the existing `describe`. Imports are only legal at module
scope, and a class declared inside a `describe` trips lint, which runs with `--max-warnings 0`.

```ts
// ↓ goes with the other imports at the top of the file
import { BadRequestException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
```

```ts
// ↓ module scope, after the existing describe blocks

// A stand-in handler so the invariant is tested once, not per-handler.
class ProbeService extends GalleryWorkflowHostService {
  error: unknown;
  protected override collaborators() {
    return {
      sharedSpace: { addAssets: () => Promise.reject(this.error) },
      album: {},
    } as never;
  }
}

describe('never-throws invariant', () => {
  const probe = (error: unknown) => {
    const { sut } = newTestService(ProbeService);
    sut.error = error;
    return sut;
  };

  const args = { assetId: '00000000-0000-4000-8000-000000000001', spaceIds: ['00000000-0000-4000-8000-000000000002'] };

  // U3 / U4 — every expected rejection resolves ok:false. If any of these threw, upstream's
  // execute() would catch it and abandon all remaining steps (spec §7).
  it.each([
    ['BadRequestException', new BadRequestException('nope')],
    ['ForbiddenException', new ForbiddenException('nope')],
    ['NotFoundException', new NotFoundException('nope')],
    ['UnauthorizedException', new UnauthorizedException('nope')],
  ])('resolves ok:false for %s', async (_name, error) => {
    await expect(probe(error).dispatch(auth, 'addToSpace', args)).resolves.toMatchObject({ ok: false });
  });

  // U5 — a genuine bug must still fail the run loudly.
  it('propagates an unexpected error', async () => {
    await expect(probe(new TypeError('boom')).dispatch(auth, 'addToSpace', args)).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: FAIL — all five resolve `{ ok: false, reason: 'unknown-method' }` because `addToSpace` has no handler yet.

- [ ] **Step 3: Add the guard helper**

Add to `gallery-workflow-host.service.ts`, above the class:

```ts
import { HttpException } from '@nestjs/common';

/** Returned by `runGuarded` when an expected, user-fixable failure was swallowed. */
export const SKIPPED = Symbol('skipped');
```

And inside the class:

```ts
  /**
   * Runs collaborator work, swallowing user-fixable failures.
   *
   * Anything derived from HttpException is a condition the user can fix (not a member, no
   * contribution rights, space deleted). Those must not escape: a throw here unwinds into
   * upstream's `execute()` catch, which abandons every remaining step of the workflow.
   * Everything else is a bug and propagates.
   */
  protected async runGuarded<T>(label: string, work: () => Promise<T>): Promise<T | typeof SKIPPED> {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof HttpException)) {
        throw error;
      }

      this.logger.warn(`${label} skipped: ${error}`);
      return SKIPPED;
    }
  }
```

- [ ] **Step 4: Add a placeholder `addToSpace` handler so the invariant is exercised**

Replace the empty handlers map with:

```ts
  private readonly handlers: Record<string, GalleryHandler> = {
    addToSpace: (auth, args) => this.handleAddToSpace(auth, args),
  };

  private async handleAddToSpace(auth: AuthDto, args: unknown): Promise<GalleryDispatchResult> {
    const { spaceIds, assetId } = args as { spaceIds: string[]; assetId: string };
    const { sharedSpace } = this.collaborators();

    const result = await this.runGuarded('addToSpace', () =>
      sharedSpace.addAssets(auth, spaceIds[0], { assetIds: [assetId] }),
    );

    return result === SKIPPED ? { ok: false, reason: 'no-access' } : { ok: true };
  }
```

This is intentionally minimal — Task 4 replaces the body with the validated, multi-space version. It exists now only so the invariant has something to run through.

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS for U2–U5. U1 still red (one handler of two).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/gallery-workflow-host.service.ts server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): guard gallery workflow steps against escaping exceptions"
```

---

### Task 4: `addToSpace`

**Files:**

- Modify: `server/src/services/gallery-workflow-host.service.ts`
- Modify: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: `runGuarded`, `SKIPPED`, `collaborators()`.
- Produces: a fully validated `addToSpace` handler. Config contract: `{ assetId: string (uuid), spaceIds: string[] (uuid) }`.

- [ ] **Step 1: Write the failing tests**

Add a reusable double and the scenarios:

```ts
const ASSET = '00000000-0000-4000-8000-0000000000aa';
const SPACE_A = '00000000-0000-4000-8000-00000000000a';
const SPACE_B = '00000000-0000-4000-8000-00000000000b';
const SPACE_C = '00000000-0000-4000-8000-00000000000c';

type Doubles = {
  sharedSpace: { addAssets: Mock; getLinkedAlbums: Mock; linkAlbum: Mock };
  album: { create: Mock; addAssets: Mock; delete: Mock };
};

const makeDoubles = (): Doubles => ({
  sharedSpace: { addAssets: vi.fn(), getLinkedAlbums: vi.fn(), linkAlbum: vi.fn() },
  album: { create: vi.fn(), addAssets: vi.fn(), delete: vi.fn() },
});

class TestableService extends GalleryWorkflowHostService {
  doubles = makeDoubles();
  protected override collaborators() {
    return this.doubles as never;
  }
}

const setupTestable = () => {
  const { sut } = newTestService(TestableService);
  return { sut, doubles: sut.doubles };
};

describe('addToSpace', () => {
  const run = (sut: TestableService, config: unknown) => sut.dispatch(auth, 'addToSpace', config);

  it('adds the asset once per space', async () => {
    // U6
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_B] })).resolves.toEqual({ ok: true });
    expect(doubles.sharedSpace.addAssets.mock.calls).toEqual([
      [auth, SPACE_A, { assetIds: [ASSET] }],
      [auth, SPACE_B, { assetIds: [ASSET] }],
    ]);
  });

  it('de-duplicates repeated space ids', async () => {
    // U7
    const { sut, doubles } = setupTestable();
    await run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_A] });
    expect(doubles.sharedSpace.addAssets).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an empty space list', async () => {
    // U8
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: [] })).resolves.toEqual({ ok: true });
    expect(doubles.sharedSpace.addAssets).not.toHaveBeenCalled();
  });

  it('rejects malformed config without calling the service', async () => {
    // U9
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { assetId: ASSET, spaceIds: 'not-an-array' })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
    expect(doubles.sharedSpace.addAssets).not.toHaveBeenCalled();
  });

  it('reports ok:false when the owner may not contribute', async () => {
    // U10 — the reason label is deliberately not asserted (spec D11)
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockRejectedValue(new BadRequestException('not a member'));
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toMatchObject({ ok: false });
  });

  it('reports ok:false when the space is gone', async () => {
    // U11
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockRejectedValue(new NotFoundException('gone'));
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toMatchObject({ ok: false });
  });

  it('succeeds when the asset is already in the space', async () => {
    // U12 — addAssets is idempotent server-side
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets.mockResolvedValue(undefined);
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A] })).resolves.toEqual({ ok: true });
  });

  it('still attempts later spaces after one is denied', async () => {
    // U13 — per-space isolation
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.addAssets
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new ForbiddenException('no'))
      .mockResolvedValueOnce(undefined);
    await expect(run(sut, { assetId: ASSET, spaceIds: [SPACE_A, SPACE_B, SPACE_C] })).resolves.toMatchObject({
      ok: false,
    });
    expect(doubles.sharedSpace.addAssets.mock.calls.map(([, spaceId]) => spaceId)).toEqual([SPACE_A, SPACE_B, SPACE_C]);
  });

  it('never returns asset changes', async () => {
    // U14 — a `changes` key would make execute() re-read the asset after every step
    const { sut } = setupTestable();
    const result = await run(sut, { assetId: ASSET, spaceIds: [SPACE_A] });
    expect(result).not.toHaveProperty('changes');
  });

  it('passes the auth it was given straight through to the service', async () => {
    // U26 — the token is minted for the ASSET OWNER, not the workflow owner
    // (workflow-execution.service.ts:158-197). The dispatcher must forward it untouched and must
    // never source an identity from anywhere else, or the space access checks mean nothing.
    const { sut, doubles } = setupTestable();
    const otherAuth = { user: { id: 'someone-else' } } as AuthDto;
    await sut.dispatch(otherAuth, 'addToSpace', { assetId: ASSET, spaceIds: [SPACE_A] });
    expect(doubles.sharedSpace.addAssets).toHaveBeenCalledWith(otherAuth, SPACE_A, { assetIds: [ASSET] });
  });
});
```

````

Add `import { type Mock, vi } from 'vitest';` to the imports.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
````

Expected: FAIL on U7, U8, U9, U13 (the placeholder handler only ever touches `spaceIds[0]` and does not validate).

- [ ] **Step 3: Replace the placeholder handler**

Add the schema near the top of `gallery-workflow-host.service.ts`. Note the default import — that is
the form every DTO in this codebase uses.

```ts
import z from 'zod';

const AddToSpaceArgs = z.object({
  assetId: z.uuidv4(),
  spaceIds: z.array(z.uuidv4()),
});
```

Replace `handleAddToSpace` with:

```ts
  private async handleAddToSpace(auth: AuthDto, args: unknown): Promise<GalleryDispatchResult> {
    const parsed = AddToSpaceArgs.safeParse(args);
    if (!parsed.success) {
      this.logger.warn(`addToSpace: invalid config — ${parsed.error.message}`);
      return { ok: false, reason: 'invalid-config' };
    }

    const { assetId, spaceIds } = parsed.data;
    const { sharedSpace } = this.collaborators();
    let skipped = false;

    // Per-space isolation: one denied space must not stop the others (spec §7).
    for (const spaceId of new Set(spaceIds)) {
      const result = await this.runGuarded(`addToSpace(${spaceId})`, () =>
        sharedSpace.addAssets(auth, spaceId, { assetIds: [assetId] }),
      );

      skipped ||= result === SKIPPED;
    }

    return skipped ? { ok: false, reason: 'no-access' } : { ok: true };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS for U2–U14.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/gallery-workflow-host.service.ts server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): add the addToSpace workflow action"
```

---

### Task 5: `addToSpaceAlbum` — resolve or create

**Files:**

- Modify: `server/src/services/gallery-workflow-host.service.ts`
- Modify: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: everything from Tasks 3–4.
- Produces: the `addToSpaceAlbum` handler. Config contract: `{ assetId: string (uuid), spaceId: string (uuid), albumName: string (trimmed, non-empty) }`. This makes U1 green.

- [ ] **Step 1: Write the failing tests**

```ts
// U1 — the dispatcher is string-keyed across the WASM boundary, so a renamed handler would
// otherwise break only at runtime. Introduced here, in the task that makes it pass, so no commit
// in this plan ever leaves the suite red.
describe('manifest / handler parity', () => {
  it('has a handler for every manifest method and no extras', () => {
    const { sut } = newTestService(GalleryWorkflowHostService);
    expect(sut.methodNames.sort()).toEqual(
      readManifest()
        .methods.map((method: { name: string }) => method.name)
        .sort(),
    );
  });
});

describe('addToSpaceAlbum', () => {
  const ALBUM_OLD = '00000000-0000-4000-8000-0000000000e1';
  const ALBUM_NEW = '00000000-0000-4000-8000-0000000000e2';
  const linked = (id: string, albumName: string, createdAt: string) => ({ id, albumName, createdAt });
  const run = (sut: TestableService, config: unknown) => sut.dispatch(auth, 'addToSpaceAlbum', config);
  const config = { assetId: ASSET, spaceId: SPACE_A, albumName: 'Holidays 2026' };

  it('uses an existing album without creating or linking', async () => {
    // U15 / U20 — linkAlbum enqueues grant reconcile + face sync; firing it per asset floods the queue
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    await expect(run(sut, config)).resolves.toEqual({ ok: true });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.sharedSpace.linkAlbum).not.toHaveBeenCalled();
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('matches album names ignoring case and surrounding whitespace', async () => {
    // U16
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'holidays 2026', '2026-01-01T00:00:00Z')]);
    await run(sut, { ...config, albumName: '  Holidays 2026  ' });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('picks the oldest album when names collide', async () => {
    // U17
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([
      linked(ALBUM_NEW, 'Holidays 2026', '2026-06-01T00:00:00Z'),
      linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z'),
    ]);
    await run(sut, config);
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('breaks a createdAt tie on album id, deterministically', async () => {
    // U18
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([
      linked(ALBUM_NEW, 'Holidays 2026', '2026-01-01T00:00:00Z'),
      linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z'),
    ]);
    await run(sut, config);
    expect(doubles.album.addAssets).toHaveBeenCalledWith(auth, ALBUM_OLD, { ids: [ASSET] });
  });

  it('creates, links, then adds — in that order', async () => {
    // U19
    const { sut, doubles } = setupTestable();
    const order: string[] = [];
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve({ id: ALBUM_NEW });
    });
    doubles.sharedSpace.linkAlbum.mockImplementation(() => {
      order.push('link');
      return Promise.resolve();
    });
    doubles.album.addAssets.mockImplementation(() => {
      order.push('add');
      return Promise.resolve([]);
    });

    await expect(run(sut, config)).resolves.toEqual({ ok: true });
    expect(order).toEqual(['create', 'link', 'add']);
    expect(doubles.album.create).toHaveBeenCalledWith(auth, { albumName: 'Holidays 2026' });
    expect(doubles.sharedSpace.linkAlbum).toHaveBeenCalledTimes(1);
  });

  it('rejects a blank album name without creating anything', async () => {
    // U21
    const { sut, doubles } = setupTestable();
    await expect(run(sut, { ...config, albumName: '   ' })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
    expect(doubles.album.create).not.toHaveBeenCalled();
  });

  it('rejects a missing space id', async () => {
    // U22
    const { sut } = setupTestable();
    await expect(run(sut, { assetId: ASSET, albumName: 'Holidays 2026' })).resolves.toEqual({
      ok: false,
      reason: 'invalid-config',
    });
  });

  it('succeeds when the asset is already in the album', async () => {
    // U25
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.addAssets.mockResolvedValue([{ id: ASSET, success: false, error: 'duplicate' }]);
    await expect(run(sut, config)).resolves.toEqual({ ok: true });
  });

  it('reports ok:false when the album cannot be added to', async () => {
    // U24
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([linked(ALBUM_OLD, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.addAssets.mockRejectedValue(new BadRequestException('no rights'));
    await expect(run(sut, config)).resolves.toMatchObject({ ok: false });
  });

  it('does not create or link when the space albums cannot be read', async () => {
    // U30
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockRejectedValue(new ForbiddenException('not a member'));
    await expect(run(sut, config)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.create).not.toHaveBeenCalled();
    expect(doubles.sharedSpace.linkAlbum).not.toHaveBeenCalled();
  });

  it('creates no second album when the job is retried', async () => {
    // U27 — BullMQ retries re-run every step of the workflow
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums
      .mockResolvedValueOnce([])
      .mockResolvedValue([linked(ALBUM_NEW, 'Holidays 2026', '2026-01-01T00:00:00Z')]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });

    await run(sut, config);
    await run(sut, config);

    expect(doubles.album.create).toHaveBeenCalledTimes(1);
    expect(doubles.sharedSpace.linkAlbum).toHaveBeenCalledTimes(1);
    expect(doubles.album.addAssets).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: FAIL — every `addToSpaceAlbum` case resolves `{ ok: false, reason: 'unknown-method' }`.

- [ ] **Step 3: Implement the handler**

Add the schema beside `AddToSpaceArgs`:

```ts
const AddToSpaceAlbumArgs = z.object({
  assetId: z.uuidv4(),
  spaceId: z.uuidv4(),
  albumName: z.string().trim().min(1),
});
```

Register the handler:

```ts
  private readonly handlers: Record<string, GalleryHandler> = {
    addToSpace: (auth, args) => this.handleAddToSpace(auth, args),
    addToSpaceAlbum: (auth, args) => this.handleAddToSpaceAlbum(auth, args),
  };
```

And add:

```ts
  private async handleAddToSpaceAlbum(auth: AuthDto, args: unknown): Promise<GalleryDispatchResult> {
    const parsed = AddToSpaceAlbumArgs.safeParse(args);
    if (!parsed.success) {
      this.logger.warn(`addToSpaceAlbum: invalid config — ${parsed.error.message}`);
      return { ok: false, reason: 'invalid-config' };
    }

    const { assetId, spaceId, albumName } = parsed.data;
    const { sharedSpace, album } = this.collaborators();

    const outcome = await this.runGuarded(`addToSpaceAlbum(${spaceId})`, async () => {
      const albumId = await this.resolveSpaceAlbum(auth, spaceId, albumName);
      await album.addAssets(auth, albumId, { ids: [assetId] });
    });

    return outcome === SKIPPED ? { ok: false, reason: 'no-access' } : { ok: true };
  }

  /** Finds the named album among a space's linked albums, creating and linking it when absent. */
  private async resolveSpaceAlbum(auth: AuthDto, spaceId: string, albumName: string): Promise<string> {
    const { sharedSpace, album } = this.collaborators();
    const target = albumName.toLowerCase();

    const matches = (await sharedSpace.getLinkedAlbums(auth, spaceId))
      .filter((candidate) => candidate.albumName.trim().toLowerCase() === target)
      // Oldest wins, tie-broken on id, so repeated runs converge on one album rather than fan out.
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

    const existing = matches[0];
    if (existing) {
      return existing.id;
    }

    const created = await album.create(auth, { albumName });
    await sharedSpace.linkAlbum(auth, spaceId, created.id);

    return created.id;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS for U1–U22, U24, U25, U27, U30. U1 is now green — both handlers exist.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/gallery-workflow-host.service.ts server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): add the addToSpaceAlbum workflow action"
```

---

### Task 6: Orphan-album compensation

**Files:**

- Modify: `server/src/services/gallery-workflow-host.service.ts`
- Modify: `server/src/services/gallery-workflow-host.service.spec.ts`

**Interfaces:**

- Consumes: `resolveSpaceAlbum` from Task 5.
- Produces: compensation behaviour — `album.delete` is called only for an album this invocation created, and only when `linkAlbum` fails.

**Why:** `album.create` succeeds for anybody (it makes a _personal_ album), but `linkAlbum` can be denied for a member without link rights. Without compensation, a denied link strands an album the user never asked for.

- [ ] **Step 1: Write the failing tests**

```ts
describe('addToSpaceAlbum compensation', () => {
  const ALBUM_NEW = '00000000-0000-4000-8000-0000000000e2';
  const ALBUM_OLD = '00000000-0000-4000-8000-0000000000e1';
  const config = { assetId: ASSET, spaceId: SPACE_A, albumName: 'Holidays 2026' };
  const run = (sut: TestableService) => sut.dispatch(auth, 'addToSpaceAlbum', config);

  it('deletes the album it just created when linking is denied', async () => {
    // U23
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });
    doubles.sharedSpace.linkAlbum.mockRejectedValue(new BadRequestException('cannot link'));

    await expect(run(sut)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.delete).toHaveBeenCalledWith(auth, ALBUM_NEW);
    expect(doubles.album.addAssets).not.toHaveBeenCalled();
  });

  it('never deletes a pre-existing album', async () => {
    // U28
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([
      { id: ALBUM_OLD, albumName: 'Holidays 2026', createdAt: '2026-01-01T00:00:00Z' },
    ]);
    doubles.album.addAssets.mockRejectedValue(new BadRequestException('no rights'));

    await expect(run(sut)).resolves.toMatchObject({ ok: false });
    expect(doubles.album.delete).not.toHaveBeenCalled();
  });

  it('still resolves ok:false when the compensating delete itself fails', async () => {
    // U29 — otherwise §7 is breached and the rest of the workflow dies
    const { sut, doubles } = setupTestable();
    doubles.sharedSpace.getLinkedAlbums.mockResolvedValue([]);
    doubles.album.create.mockResolvedValue({ id: ALBUM_NEW });
    doubles.sharedSpace.linkAlbum.mockRejectedValue(new BadRequestException('cannot link'));
    doubles.album.delete.mockRejectedValue(new Error('delete blew up'));

    await expect(run(sut)).resolves.toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: U23 FAIL (`album.delete` never called); U29 FAIL (the raw `Error` from `delete` propagates and rejects).

- [ ] **Step 3: Implement compensation**

Replace the create branch of `resolveSpaceAlbum`:

```ts
const created = await album.create(auth, { albumName });

try {
  await sharedSpace.linkAlbum(auth, spaceId, created.id);
} catch (error) {
  // Compensate: this invocation created the album, so this invocation removes it. A
  // pre-existing album is never touched here, because this branch only runs after a create.
  await this.discardAlbum(auth, created.id);
  throw error;
}

return created.id;
```

And add:

```ts
  /**
   * Best-effort cleanup of an album this invocation created. Swallows every failure: a throw here
   * would escape `runGuarded`'s HttpException filter and abandon the remaining workflow steps.
   */
  private async discardAlbum(auth: AuthDto, albumId: string): Promise<void> {
    try {
      await this.collaborators().album.delete(auth, albumId);
    } catch (error) {
      this.logger.error(`addToSpaceAlbum: failed to clean up orphan album ${albumId}`, error);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
```

Expected: PASS — U0–U30, 31 scenarios.

- [ ] **Step 5: Run the server gates**

```bash
cd server && pnpm check && pnpm lint && npx prettier --check src/services/gallery-workflow-host.service.ts src/services/gallery-workflow-host.service.spec.ts
```

Expected: no type errors, no lint warnings, formatting clean. `vitest` does **not** typecheck, so this step is not optional.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/gallery-workflow-host.service.ts server/src/services/gallery-workflow-host.service.spec.ts
git commit -m "feat(spaces): compensate orphan albums when linking into a space fails"
```

---

### Task 7: The WASM shims

**Files:**

- Create: `packages/plugin-gallery/bin/prepare-build.mjs`
- Create: `packages/plugin-gallery/src/contract.ts`
- Create: `packages/plugin-gallery/src/host.ts`
- Create: `packages/plugin-gallery/src/index.ts`

**Interfaces:**

- Consumes: manifest method names (Task 1); the dispatch result shape (Task 2).
- Produces: `dist/plugin.wasm` exporting `addToSpace` and `addToSpaceAlbum`, importing the host function `gallery`.

**No unit tests — deliberately** (spec §10.4). This code runs inside extism and depends on the `Host` and `Memory` globals, so testing it would mean mocking the runtime rather than exercising it. It is therefore held to a hard rule: **no branching, no logic, one `gallery(...)` call per method.** If a shim ever needs a conditional, that conditional belongs in the dispatcher. Coverage comes from Task 11.

- [ ] **Step 1: Write the type generator**

Upstream's `plugin-sdk prepareBuild` emits `dist/index.d.ts` from the SDK's own `availableFunctions` list, which does not include `gallery` — and `extism-js -i` reads _that_ file to decide which host imports the wasm declares. So this package generates its own.

Create `packages/plugin-gallery/bin/prepare-build.mjs`:

```js
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Upstream's five, plus the fork's single generic dispatcher. The first five are declared only so
// that the plugin-sdk `wrapper()` helper behaves identically to upstream's plugin; the shims call
// `gallery` exclusively. Keep in sync with `functions` in workflow-execution.service.ts.
const hostFunctions = [
  'searchAlbums',
  'createAlbum',
  'addAssetsToAlbum',
  'addAssetsToAlbums',
  'httpRequest',
  'gallery',
];

const output = 'dist/index.d.ts';
const content = readFileSync('manifest.json', { encoding: 'utf-8' });
const methods = JSON.parse(content).methods.map(({ name }) => name);

mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  `
declare module 'extism:host' {
  interface user {
${hostFunctions.map((name) => `    ${name}(ptr: PTR): I64;`).join('\n')}
  }
}

declare module 'main' {
${methods.map((method) => `  export function ${method}(): I32;`).join('\n')}
}

export type Manifest = ${content};
`,
);
```

- [ ] **Step 2: Write the contract and host caller**

Create `packages/plugin-gallery/src/contract.ts`:

```ts
export type GallerySkipReason = 'invalid-config' | 'no-access' | 'not-found' | 'unknown-method';

export type GalleryDispatchResult = { ok: true } | { ok: false; reason: GallerySkipReason };

export type GalleryMethodArgs = {
  addToSpace: { assetId: string; spaceIds: string[] };
  addToSpaceAlbum: { assetId: string; spaceId: string; albumName: string };
};
```

Create `packages/plugin-gallery/src/host.ts`:

```ts
import type { GalleryDispatchResult, GalleryMethodArgs } from './contract.js';

type HostResult<T> = { success: true; response: T } | { success: false; status: number; message: string };

/**
 * Calls the fork's single generic host function.
 *
 * The server-side dispatcher never throws for user-fixable conditions, so `success: false` here
 * means something genuinely unexpected happened — which must fail the run rather than be swallowed.
 */
export const gallery =
  (authToken: string) =>
  <M extends keyof GalleryMethodArgs>(method: M, args: GalleryMethodArgs[M]): GalleryDispatchResult => {
    const host = Host.getFunctions();
    const input = Memory.fromString(JSON.stringify({ authToken, args: [method, args] }));
    const handle = Memory.find(host.gallery(input.offset));

    try {
      const result = JSON.parse(handle.readString()) as HostResult<GalleryDispatchResult>;
      if (!result.success) {
        throw new Error(`gallery(${method}) failed with ${result.status}: ${JSON.stringify(result.message)}`);
      }

      return result.response;
    } finally {
      handle.free();
      input.free();
    }
  };
```

- [ ] **Step 3: Write the shims**

Create `packages/plugin-gallery/src/index.ts`:

```ts
import { wrapper } from '@immich/plugin-sdk';
import type { Manifest } from '../dist/index.d.ts';
import { gallery } from './host.js';

const methods = wrapper<Manifest>({
  addToSpace: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpace', {
      assetId: data.asset.id,
      spaceIds: config.spaceIds,
    });

    return {};
  },

  addToSpaceAlbum: ({ data, config, workflow }) => {
    gallery(workflow.authToken)('addToSpaceAlbum', {
      assetId: data.asset.id,
      spaceId: config.spaceId,
      albumName: config.albumName,
    });

    return {};
  },
});

const {
  addToSpace,
  addToSpaceAlbum,

  // should be empty. ensures that every field is destructured
  ...rest
} = methods;

export { addToSpace, addToSpaceAlbum };

'All methods must be destructured and exported' satisfies string & typeof rest;
```

- [ ] **Step 4: Build the plugin and verify the wasm exists**

```bash
pnpm --filter @immich/plugin-gallery install
mise exec --no-deps github:extism/js-pdk@1.6.0 -- pnpm --filter @immich/plugin-gallery build
ls -l packages/plugin-gallery/dist/plugin.wasm
```

Expected: `dist/plugin.wasm` exists and is non-empty. Confirm `dist/index.d.ts` contains a `gallery(ptr: PTR): I64;` line — without it the host function is not bound and the plugin will fail to instantiate at boot:

```bash
grep -c 'gallery(ptr: PTR): I64;' packages/plugin-gallery/dist/index.d.ts
```

Expected: `1`

- [ ] **Step 5: Commit**

```bash
git add packages/plugin-gallery
git commit -m "feat(spaces): build the gallery workflow plugin wasm shims"
```

---

### Task 8: The upstream server seam

**Files:**

- Modify: `server/src/repositories/config.repository.ts:100` (type) and `:363` (value)
- Modify: `server/src/services/workflow-execution.service.ts:59` and `:110-124`
- Modify: `docker/docker-compose.dev.yml:76`

**Interfaces:**

- Consumes: `GalleryWorkflowHostService.dispatch` (Task 2); `dist/plugin.wasm` (Task 7).
- Produces: a running host function named `gallery`, and the plugin imported from `resourcePaths.galleryPlugin`.

- [ ] **Step 1: Add the resource path**

In `server/src/repositories/config.repository.ts`, add to the `resourcePaths` type beside `corePlugin: string;`:

```ts
corePlugin: string;
galleryPlugin: string;
```

and beside the value at line 363:

```ts
      corePlugin: join(buildFolder, 'plugins', 'immich-plugin-core'),
      galleryPlugin: join(buildFolder, 'plugins', 'gallery-core'),
```

- [ ] **Step 2: Import the fork plugin at bootstrap**

In `workflow-execution.service.ts`, inside `onPluginSync`, directly after the existing `corePlugin` import:

```ts
await this.importFolder(resourcePaths.corePlugin, { force: environment === ImmichEnvironment.Development });
await this.importFolder(resourcePaths.galleryPlugin, { force: environment === ImmichEnvironment.Development });
```

- [ ] **Step 3: Wire the host function**

Add the import at the top of `workflow-execution.service.ts`:

```ts
import { GalleryWorkflowHostService } from 'src/services/gallery-workflow-host.service';
```

Inside `onPluginLoad`, beside the existing `albumService` construction:

```ts
const galleryHost = BaseService.create(GalleryWorkflowHostService, this);
```

Next to the other wrapped functions:

```ts
// Gallery fork: one generic dispatcher, so fork actions and filters never add lines here again.
const gallery = this.wrap<[method: string, args: unknown]>((authDto, ctx, args) =>
  galleryHost.dispatch(authDto, ...args),
);
```

Then add `gallery` to both objects:

```ts
const functions = {
  searchAlbums,
  createAlbum,
  addAssetsToAlbum,
  addAssetsToAlbums,
  httpRequest,
  gallery,
};

const stubs: typeof functions = {
  searchAlbums: dummy,
  createAlbum: dummy,
  addAssetsToAlbum: dummy,
  addAssetsToAlbums: dummy,
  httpRequest: dummy,
  gallery: dummy,
};
```

- [ ] **Step 4: Mount the plugin in the dev stack**

In `docker/docker-compose.dev.yml`, after the existing bind-mount at line 76:

```yaml
- ../packages/plugin-core:/build/plugins/immich-plugin-core
- ../packages/plugin-gallery:/build/plugins/gallery-core
```

- [ ] **Step 5: Verify the seam compiles and the plugin loads**

```bash
cd server && pnpm check && pnpm lint
```

Expected: clean. Then start the dev stack and confirm the import:

```bash
make dev
docker compose -f docker/docker-compose.dev.yml logs immich-server | grep -i 'gallery-core'
```

Expected: a line reading `Imported plugin gallery-core@1.0.0 (2 methods) from /build/plugins/gallery-core` and a later `Loaded plugin with host functions: gallery-core@1.0.0/worker`. **A missing plugin folder only produces a warning**, so the absence of these lines — not a crashed container — is the failure signal.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/config.repository.ts server/src/services/workflow-execution.service.ts docker/docker-compose.dev.yml
git commit -m "feat(spaces): expose a generic gallery host function to workflow plugins"
```

---

### Task 9: The space picker in the step config form

**Files:**

- Create: `web/src/lib/components/SchemaSpacePicker.svelte`
- Create: `web/src/lib/components/SchemaSpacePicker.test-wrapper.svelte`
- Create: `web/src/lib/components/SchemaSpacePicker.spec.ts`
- Modify: `web/src/lib/types.ts:103`
- Modify: `web/src/lib/components/SchemaConfiguration.svelte:81`
- Modify: `i18n/en.json` + the nine translated locales

**Interfaces:**

- Consumes: `uiHint.type === 'SpaceId'` emitted by the manifest (Task 1).
- Produces: `SchemaSpacePicker` with props `{ label: string; description?: string; array?: boolean; spaceIds: string[] }` (bindable), matching `SchemaAlbumPicker`'s shape so `SchemaConfiguration`'s existing `getUiHintValue`/`setUiHintValue` bridge scalar and array configs unchanged.

**Note:** do **not** reuse `space-card.svelte` for the chosen-space chip — it is a full card with a collage, member avatars, a pin menu and a route link. The chip here is a plain name plus a remove button.

- [ ] **Step 1: Write the failing tests**

A `$bindable` prop is **not** readable off the render result in Svelte 5 runes mode. This repo's
established pattern is a `.test-wrapper.svelte` that owns the `$state` and renders it into a
`data-testid`, which the spec asserts with `toHaveTextContent` — see
`web/src/lib/components/spaces/space-albums-controls.test-wrapper.svelte`.

Create `web/src/lib/components/SchemaSpacePicker.test-wrapper.svelte`:

```svelte
<script lang="ts">
  import SchemaSpacePicker from './SchemaSpacePicker.svelte';

  type Props = { array?: boolean; initial?: string[] };
  let { array = false, initial = [] }: Props = $props();

  let spaceIds = $state(initial);
</script>

<!-- Expose the wrapper's own state so tests can assert upward propagation. -->
<span data-testid="wrapper-space-ids">{spaceIds.join(',')}</span>
<SchemaSpacePicker label="Spaces" {array} bind:spaceIds />
```

Create `web/src/lib/components/SchemaSpacePicker.spec.ts`:

```ts
import SchemaSpacePickerWrapper from '$lib/components/SchemaSpacePicker.test-wrapper.svelte';
import { getAllSpaces } from '@immich/sdk';
import { modalManager } from '@immich/ui';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Module mocks, matching the pattern used across this suite. `vi.spyOn` on these is not the
// convention here, and an unmocked @immich/sdk would attempt a real fetch under happy-dom.
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/sdk')>()),
  getAllSpaces: vi.fn(),
}));

vi.mock('@immich/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@immich/ui')>()),
  modalManager: { show: vi.fn() },
}));

const space = (id: string, name: string) => ({ id, name }) as never;
const boundValue = () => screen.getByTestId('wrapper-space-ids');

describe('SchemaSpacePicker', () => {
  beforeEach(() => {
    // This suite does not clear mocks between tests, so reset explicitly.
    vi.mocked(modalManager.show).mockReset();
    vi.mocked(getAllSpaces)
      .mockReset()
      .mockResolvedValue([space('space-1', 'Family')]);
  });

  const renderPicker = (props: { array?: boolean; initial?: string[] } = {}) =>
    render(SchemaSpacePickerWrapper, { array: props.array ?? false, initial: props.initial ?? [] });

  it('renders a choose button and no chip when nothing is selected', async () => {
    // W1
    renderPicker();
    expect(await screen.findByRole('button', { name: 'Choose' })).toBeInTheDocument();
    expect(screen.queryByTestId('space-chip')).toBeNull();
    expect(boundValue()).toHaveTextContent('');
  });

  it('stores the chosen space id and shows its name', async () => {
    // W2
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    renderPicker();
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }));
    expect(await screen.findByText('Friends')).toBeInTheDocument();
    expect(boundValue()).toHaveTextContent('space-2');
  });

  it('appends in array mode', async () => {
    // W3
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    renderPicker({ array: true, initial: ['space-1'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }));
    expect(boundValue()).toHaveTextContent('space-1,space-2');
  });

  it('replaces in single mode', async () => {
    // W4
    vi.mocked(modalManager.show).mockResolvedValue(space('space-2', 'Friends'));
    renderPicker({ array: false, initial: ['space-1'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }));
    expect(boundValue()).toHaveTextContent('space-2');
  });

  it('leaves the value untouched when the modal is dismissed', async () => {
    // W5
    vi.mocked(modalManager.show).mockResolvedValue(undefined as never);
    renderPicker({ initial: ['space-1'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Choose' }));
    expect(boundValue()).toHaveTextContent('space-1');
  });

  it('removes a selected space', async () => {
    // W6
    renderPicker({ array: true, initial: ['space-1'] });
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(boundValue()).toHaveTextContent('');
  });

  it('renders a removable placeholder for a space that no longer resolves', async () => {
    // W7 — a workflow outlives the spaces it points at; an unhandled throw here would take down
    // the whole step editor, including the field the user needs in order to fix it.
    vi.mocked(getAllSpaces).mockResolvedValue([]);
    renderPicker({ array: true, initial: ['deleted-space'] });
    expect(await screen.findByText('Space unavailable')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd web && pnpm test --run src/lib/components/SchemaSpacePicker.spec.ts
```

Expected: FAIL — `Failed to resolve import "$lib/components/SchemaSpacePicker.svelte"`. Check the reported **file count is 1** — a web vitest run that matches zero files reports green.

- [ ] **Step 3: Add the i18n key to all ten locales**

Insert alphabetically into each file:

| File                | Entry                                                     |
| ------------------- | --------------------------------------------------------- |
| `i18n/en.json`      | `"workflow_space_unavailable": "Space unavailable",`      |
| `i18n/de.json`      | `"workflow_space_unavailable": "Space nicht verfügbar",`  |
| `i18n/fr.json`      | `"workflow_space_unavailable": "Espace indisponible",`    |
| `i18n/it.json`      | `"workflow_space_unavailable": "Space non disponibile",`  |
| `i18n/nl.json`      | `"workflow_space_unavailable": "Space niet beschikbaar",` |
| `i18n/pl.json`      | `"workflow_space_unavailable": "Space niedostępny",`      |
| `i18n/es.json`      | `"workflow_space_unavailable": "Space no disponible",`    |
| `i18n/ru.json`      | `"workflow_space_unavailable": "Space недоступен",`       |
| `i18n/zh_Hans.json` | `"workflow_space_unavailable": "Space 不可用",`           |
| `i18n/zh_Hant.json` | `"workflow_space_unavailable": "Space 無法使用",`         |

Most locales keep "Space" as an untranslated product noun (matching their existing `"spaces"` entries); French translates it to "Espace". `choose` and `remove` already exist in every locale and are reused.

```bash
npx prettier --write i18n/*.json
```

- [ ] **Step 4: Write the component**

Create `web/src/lib/components/SchemaSpacePicker.svelte`:

```svelte
<script lang="ts">
  import SpacePickerModal from '$lib/modals/SpacePickerModal.svelte';
  import { getAllSpaces, type SharedSpaceResponseDto } from '@immich/sdk';
  import { Button, Label, modalManager, Text } from '@immich/ui';
  import { t } from 'svelte-i18n';

  type Props = {
    label: string;
    description?: string;
    spaceIds: string[];
    array?: boolean;
  };

  let { array, label, description, spaceIds = $bindable([]) }: Props = $props();

  let spaces = $state<SharedSpaceResponseDto[]>([]);

  $effect(() => {
    // Use async/await, not a .then().catch() chain: the `tscompat` ESLint plugin crashes on those
    // member expressions (convertToMDNName), which fails `pnpm lint` in CI.
    const load = async () => {
      try {
        spaces = await getAllSpaces();
      } catch {
        // A workflow outlives the spaces it points at. Failing to resolve names must never take the
        // step editor down — unresolved ids fall back to a removable placeholder.
        spaces = [];
      }
    };

    void load();
  });

  const nameFor = (id: string) => spaces.find((space) => space.id === id)?.name;

  const onChoose = async () => {
    const space = await modalManager.show(SpacePickerModal);
    if (!space) {
      return;
    }

    // Merge the picked space into local state so its name renders immediately. Without this the
    // chip would fall back to the "unavailable" placeholder until the next getAllSpaces() resolve.
    if (!spaces.some((known) => known.id === space.id)) {
      spaces = [...spaces, space];
    }

    spaceIds = array ? [...spaceIds, space.id] : [space.id];
  };

  const onRemove = (index: number) => {
    spaceIds = spaceIds.filter((_, i) => i !== index);
  };
</script>

<div class="flex flex-col gap-2">
  <div class="flex flex-col gap-0.5">
    <Label for="space-picker" size="small" class="font-medium" {label} />
    {#if description}
      <Text color="muted" size="small">{description}</Text>
    {/if}
  </div>

  <div class="flex flex-col gap-2">
    {#each spaceIds as spaceId, i (i)}
      <div class="flex items-center justify-between gap-2 rounded-lg border p-2" data-testid="space-chip">
        <Text size="small">{nameFor(spaceId) ?? $t('workflow_space_unavailable')}</Text>
        <Button size="small" shape="round" color="secondary" onclick={() => onRemove(i)}>{$t('remove')}</Button>
      </div>
    {/each}

    <!-- Always shown, even in single mode with a value already picked: clicking Choose again
         replaces it. Gating this on `array || spaceIds.length === 0` makes W4 and W5 unreachable,
         because in single mode there would be no way to open the picker to replace a selection. -->
    <Button size="small" shape="round" color="secondary" onclick={() => onChoose()}>{$t('choose')}</Button>
  </div>
</div>
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd web && pnpm test --run src/lib/components/SchemaSpacePicker.spec.ts
```

Expected: PASS, 7 tests, 1 file.

- [ ] **Step 6: Wire it into the config form**

In `web/src/lib/types.ts:103`:

```ts
    type?: 'AlbumId' | 'AssetId' | 'PersonId' | 'SpaceId';
```

In `web/src/lib/components/SchemaConfiguration.svelte`, immediately after the `AlbumId` branch (and importing the component alongside `SchemaAlbumPicker`):

```svelte
{:else if schema.uiHint?.type === 'SpaceId'}
  <SchemaSpacePicker {label} {description} array={schema.array} bind:spaceIds={getUiHintValue, setUiHintValue} />
```

Place it **after** the `AlbumId` branch and **not** before the `schema.type === 'object'` branch above it — a string-typed property is matched there correctly and the placement stays order-independent.

- [ ] **Step 7: Run the web gates**

```bash
cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint
cd .. && npx prettier --check i18n/*.json
```

Expected: all clean.

- [ ] **Step 8: Commit**

```bash
git add web/src/lib/components/SchemaSpacePicker.svelte web/src/lib/components/SchemaSpacePicker.test-wrapper.svelte web/src/lib/components/SchemaSpacePicker.spec.ts web/src/lib/types.ts web/src/lib/components/SchemaConfiguration.svelte i18n/
git commit -m "feat(spaces): add a space picker to the workflow step config form"
```

---

### Task 10: Ship the plugin in the production image

**Files:**

- Modify: `server/Dockerfile:73-93` (plugins stage) and `:105-106` (copy)

**Interfaces:**

- Consumes: `packages/plugin-gallery` build (Task 7); `resourcePaths.galleryPlugin` (Task 8).
- Produces: `/build/plugins/gallery-core/{dist,manifest.json}` in the runtime image.

- [ ] **Step 1: Add the package to the plugins stage**

After the existing `COPY ./packages/plugin-core ./packages/plugin-core/`:

```dockerfile
COPY ./packages/plugin-gallery ./packages/plugin-gallery/
```

- [ ] **Step 2: Build it alongside plugin-core**

Extend both pnpm invocations in the plugins-stage `RUN`:

```dockerfile
  pnpm --filter @immich/sdk --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery install --frozen-lockfile && \
  mise exec --no-deps --jobs=1 github:extism/js-pdk@1.6.0 -- \
    pnpm --filter @immich/plugin-sdk --filter @immich/plugin-core --filter @immich/plugin-gallery build
```

- [ ] **Step 3: Copy it into the runtime image**

After the two existing plugin-core `COPY --from=plugins` lines:

```dockerfile
COPY --from=plugins /app/packages/plugin-gallery/dist /build/plugins/gallery-core/dist
COPY --from=plugins /app/packages/plugin-gallery/manifest.json /build/plugins/gallery-core/manifest.json
```

- [ ] **Step 4: Build the image and verify both plugins import**

```bash
docker build -f server/Dockerfile -t gallery-server-plugincheck .
docker run --rm gallery-server-plugincheck ls /build/plugins/gallery-core/dist/plugin.wasm
```

Expected: the path is listed. A silently absent plugin folder is the failure mode this step exists to catch.

- [ ] **Step 5: Commit**

```bash
git add server/Dockerfile
git commit -m "build(spaces): ship the gallery workflow plugin in the server image"
```

---

### Task 11: End-to-end coverage

**Files:**

- Create: `e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts`

**Interfaces:**

- Consumes: everything above.
- Produces: the only guard against upstream silently deleting the seam.

**Why this file matters:** if a future rebase drops the `gallery` line from `onPluginLoad`, wasm instantiation fails, the plugin never loads, and nothing else in the repo notices — `fork-patches-check` covers pnpm patches only, and `ci-invariants` matches forbidden patterns under `.github/workflows` only.

- [ ] **Step 1: Write the tests**

Follow the conventions in the existing fork-authored `e2e/src/specs/server/api/workflow.e2e-spec.ts` (note: its header comment calls the workflows controller "fork-only", which is wrong — the controller is upstream; do not copy that claim).

```ts
import { WorkflowTrigger, type LoginResponseDto } from '@immich/sdk';
import { createUserDto } from 'src/fixtures';
import { app, asBearerAuth, utils } from 'src/utils';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

// Coverage for the fork-only gallery-core workflow plugin (packages/plugin-gallery) and the
// `gallery` host function it reaches through. If the host-function seam in onPluginLoad is ever
// removed, the plugin fails to instantiate and every test here goes red — which is the point.

/** Polls until `check` returns truthy. waitForQueueFinish reports "done" while work remains. */
const until = async <T>(check: () => Promise<T>, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) {
      return result;
    }

    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for the workflow to run');
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

describe('/workflows (spaces)', () => {
  let admin: LoginResponseDto;
  let user: LoginResponseDto;

  beforeAll(async () => {
    await utils.resetDatabase();
    admin = await utils.adminSetup();
    user = await utils.userSetup(admin.accessToken, createUserDto.create('wf-spaces'));
  });

  const createSpace = async (name: string) => {
    const { body } = await request(app)
      .post('/shared-spaces')
      .set(asBearerAuth(user.accessToken))
      .send({ name })
      .expect(201);
    return body.id as string;
  };

  const createWorkflow = (steps: unknown[]) =>
    request(app)
      .post('/workflows')
      .set(asBearerAuth(user.accessToken))
      .send({ trigger: WorkflowTrigger.AssetCreate, name: 'spaces', steps })
      .expect(201);

  it('adds an uploaded asset to the configured space', async () => {
    // E1 — there is no GET /shared-spaces/:id/assets; the space detail endpoint computes
    // assetCount (shared-space.service.ts get()), which is what we poll.
    const spaceId = await createSpace('E1 space');
    await createWorkflow([{ method: 'gallery-core#addToSpace', config: { spaceIds: [spaceId] } }]);

    await utils.createAsset(user.accessToken);

    await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}`).set(asBearerAuth(user.accessToken));
      return body?.assetCount === 1;
    });
  });

  it('creates, links and fills a space album that does not exist yet', async () => {
    // E2
    const spaceId = await createSpace('E2 space');
    await createWorkflow([{ method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Auto album' } }]);

    const asset = await utils.createAsset(user.accessToken);

    const album = await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}/albums`).set(asBearerAuth(user.accessToken));
      return body?.find?.((item: { albumName: string }) => item.albumName === 'Auto album');
    });

    const { body: detail } = await request(app)
      .get(`/albums/${album.id}`)
      .set(asBearerAuth(user.accessToken))
      .expect(200);
    expect(detail.assets.map((item: { id: string }) => item.id)).toContain(asset.id);
  });

  it('reuses the same album for a second asset', async () => {
    // E3 — proves resolve-by-name, and that linkAlbum did not fire twice
    const spaceId = await createSpace('E3 space');
    await createWorkflow([{ method: 'gallery-core#addToSpaceAlbum', config: { spaceId, albumName: 'Shared album' } }]);

    await utils.createAsset(user.accessToken);
    await until(async () => {
      const { body } = await request(app).get(`/shared-spaces/${spaceId}/albums`).set(asBearerAuth(user.accessToken));
      return body?.length === 1 ? body : undefined;
    });

    await utils.createAsset(user.accessToken);
    await new Promise((resolve) => setTimeout(resolve, 3000));

    const { body: albums } = await request(app)
      .get(`/shared-spaces/${spaceId}/albums`)
      .set(asBearerAuth(user.accessToken));
    expect(albums).toHaveLength(1);
  });

  it('keeps running the workflow when a space action is not permitted', async () => {
    // E4 — the §7 invariant, observed from outside: the second step must still take effect.
    // A well-formed but nonexistent space id is used rather than deleting a real one, so the
    // test does not depend on the delete endpoint's status code.
    const missingSpaceId = '00000000-0000-4000-8000-0000000000ff';

    await createWorkflow([
      { method: 'gallery-core#addToSpace', config: { spaceIds: [missingSpaceId] } },
      { method: 'immich-plugin-core#assetFavorite', config: { inverse: true } },
    ]);

    const asset = await utils.createAsset(user.accessToken);

    await until(async () => {
      const { body } = await request(app).get(`/assets/${asset.id}`).set(asBearerAuth(user.accessToken));
      return body?.isFavorite === true;
    });
  });

  it('rejects a workflow that references an unknown gallery method', async () => {
    // E5
    await request(app)
      .post('/workflows')
      .set(asBearerAuth(user.accessToken))
      .send({
        trigger: WorkflowTrigger.AssetCreate,
        name: 'bad',
        steps: [{ method: 'gallery-core#noSuchMethod', config: {} }],
      })
      .expect(400);
  });
});
```

- [ ] **Step 2: Run the suite**

```bash
cd e2e && pnpm test --run src/specs/server/api/workflow-spaces.e2e-spec.ts
```

Expected: PASS, 5 tests. If E1 and E2 fail together with the plugin absent from the server logs, the seam from Task 8 is not in the running image — re-check Step 5 of Task 8 before touching these tests.

- [ ] **Step 3: Commit**

```bash
git add e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts
git commit -m "test(spaces): cover the gallery workflow actions end to end"
```

---

### Task 12: Register fork ownership and run the full gates

**Files:**

- Modify: `docs/fork/ownership.yml`

**Interfaces:**

- Consumes: every path created or modified above.
- Produces: a green `make fork-ownership-coverage-check`.

- [ ] **Step 1: Declare the new fork-owned paths**

Under the shared-spaces feature in `docs/fork/ownership.yml`, add to `owned_paths`:

```yaml
- packages/plugin-gallery/**
- server/src/services/gallery-workflow-host.service.ts
- server/src/services/gallery-workflow-host.service.spec.ts
- web/src/lib/components/SchemaSpacePicker.svelte
- web/src/lib/components/SchemaSpacePicker.test-wrapper.svelte
- web/src/lib/components/SchemaSpacePicker.spec.ts
- e2e/src/specs/server/api/workflow-spaces.e2e-spec.ts
```

- [ ] **Step 2: Declare the upstream files the fork extends**

Add to `upstream_extension_paths`:

```yaml
- server/src/services/workflow-execution.service.ts
- server/src/repositories/config.repository.ts
- web/src/lib/types.ts
- web/src/lib/components/SchemaConfiguration.svelte
```

`server/Dockerfile` and `docker/docker-compose.dev.yml` are already covered by the existing infrastructure entries — confirm before adding duplicates.

- [ ] **Step 3: Verify coverage**

```bash
make fork-ownership-coverage-check
```

Expected: `Ownership manifest covers N fork files`.

- [ ] **Step 4: Run every gate**

```bash
cd server && pnpm check && pnpm lint && pnpm test --run src/services/gallery-workflow-host.service.spec.ts
cd ../web && pnpm check:typescript && pnpm check:svelte && pnpm lint && pnpm test --run src/lib/components/SchemaSpacePicker.spec.ts
cd .. && npx prettier --check i18n/*.json docs/superpowers/specs/2026-08-12-spaces-in-workflows-design.md docs/superpowers/plans/2026-08-12-spaces-in-workflows.md
```

Expected: all clean. Note there is **no** `make check-server` / `make lint-all` in this repo, despite CLAUDE.md — those targets do not exist.

- [ ] **Step 5: Commit**

```bash
git add docs/fork/ownership.yml
git commit -m "chore(spaces): register the gallery workflow plugin in the fork ownership manifest"
```

---

## Verification Checklist

Before opening a PR, confirm each of these by running the command and reading the output — not by recalling that a task passed.

- [ ] `cd server && pnpm test --run src/services/gallery-workflow-host.service.spec.ts` reports **31 passing** scenarios (U0–U30)
- [ ] `cd web && pnpm test --run src/lib/components/SchemaSpacePicker.spec.ts` reports **1 file, 7 tests** — a zero-file run reports green
- [ ] `cd e2e && pnpm test --run src/specs/server/api/workflow-spaces.e2e-spec.ts` reports **5 passing**
- [ ] `cd server && pnpm check && pnpm lint` clean — vitest does not typecheck
- [ ] `cd web && pnpm check:typescript && pnpm check:svelte && pnpm lint` clean
- [ ] `npx prettier --check i18n/*.json` clean, and all ten locales carry `workflow_space_unavailable`
- [ ] `make fork-ownership-coverage-check` green
- [ ] `git diff --stat $(git merge-base origin/main HEAD)..HEAD` touches **exactly nine** upstream-owned files, +27/−5 in total: `workflow-execution.service.ts` (+10), `Dockerfile` (+5/−2), `SchemaConfiguration.svelte` (+3), `config.repository.ts` (+2), `mise.toml` (+2/−2), `test.yml` (+2), `config.repository.mock.ts` (+1), `docker-compose.dev.yml` (+1), `types.ts` (+1/−1). Diff against the **merge base**, not `origin/main` directly — main advances during a long branch and diffing against its tip shows unrelated upstream work as if it were yours.
- [ ] The dev stack can actually load the plugin: `mise.toml`'s `[tasks.plugins]` builds `@immich/plugin-gallery`. Without it the bind-mount serves a folder with no wasm and the feature is **silently** absent — `importFolder` only logs a warning.
