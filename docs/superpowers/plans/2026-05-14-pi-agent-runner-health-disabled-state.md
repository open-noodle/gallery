# Pi Agent Runner Health Disabled State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build vertical slice 4 for the Pi agent by exposing runner configuration/health status and a dedicated Assistant page. The page reports whether the runner is configured and healthy, but all session-starting controls remain disabled for this slice because session creation is out of scope.

**Architecture:** Gallery server remains the authority for agent availability. This slice adds an authenticated, read-only runner status endpoint that derives configuration from environment variables and probes the runner health endpoint when configured. The web app adds a first Assistant page that displays the current availability state and disables session-starting controls; it does not create sessions, send messages, call Pi, or mutate albums.

**Tech Stack:** NestJS, Zod DTOs via `nestjs-zod`, environment config via `ConfigRepository`, fetch with `AbortSignal.timeout`, SvelteKit, `@immich/sdk`, Vitest, Testing Library Svelte, OpenAPI generation.

---

## Branch And Dependency Strategy

This plan is written from `explore/pi-agent-brainstorm`, which is the integration branch for the agent slices.

Slice 4 is intentionally independent of slice 2 and slice 3 implementation work:

- Do not read or write `agent_session`.
- Do not read or write `agent_message`.
- Do not add runner session creation.
- Do not add chat or streaming events.
- Do not add tool-call audit or operation-plan tables.

Expected merge conflicts with slice 2 are limited to append/register files:

- `server/src/enum.ts`
- `server/src/constants.ts`
- `server/src/controllers/index.ts`
- `server/src/services/index.ts`
- `server/src/repositories/index.ts`
- generated OpenAPI/mobile SDK files

Resolve those by keeping all agent additions from both slices. There should be no deep logic conflict if this plan keeps to runner health and disabled UI.

## Scope

This slice implements:

- `IMMICH_AGENT_RUNNER_URL` environment configuration.
- `IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS` environment configuration with a default of `2000`.
- `GET /agent/runner/status` authenticated endpoint.
- Runner health probing against `${IMMICH_AGENT_RUNNER_URL}/health`.
- A normalized capability/status DTO for the UI.
- A dedicated `/assistant` page available to signed-in users.
- Sidebar and route helper entry for the Assistant page.
- Disabled UI states for:
  - runner not configured;
  - runner configured but unreachable/unhealthy;
  - runner healthy but session start still unavailable in this slice.

This slice intentionally does not implement:

- A runner sidecar service.
- Docker Compose runner service wiring.
- Session creation.
- Chat transcript.
- Streaming.
- Provider/model calls.
- Read tools.
- Tool approvals.
- Album operation planning or applying.

## Runner Health Contract

When configured, Gallery probes:

```text
GET {IMMICH_AGENT_RUNNER_URL}/health
```

Expected runner response:

```json
{
  "status": "ok",
  "version": "0.1.0",
  "capabilities": {
    "protocolVersion": "2026-05-14",
    "streaming": true,
    "tools": ["echo"],
    "models": []
  }
}
```

The runner does not exist in this slice. Tests mock the fetch boundary.

Gallery response:

```json
{
  "configured": true,
  "healthy": true,
  "reason": "healthy",
  "version": "0.1.0",
  "capabilities": {
    "protocolVersion": "2026-05-14",
    "streaming": true,
    "tools": ["echo"],
    "models": []
  },
  "checkedAt": "2026-05-14T00:00:00.000Z"
}
```

When no runner URL is configured:

```json
{
  "configured": false,
  "healthy": false,
  "reason": "not-configured",
  "version": null,
  "capabilities": null,
  "checkedAt": "2026-05-14T00:00:00.000Z"
}
```

The response does not include the configured runner URL. Users only need availability and capabilities, and omitting the URL avoids exposing internal deployment topology to API clients.

## File Structure

Create:

- `server/src/dtos/agent-runner.dto.ts` - Zod DTOs for runner status and normalized capabilities.
- `server/src/repositories/agent-runner.repository.ts` - fetch boundary for runner `/health`.
- `server/src/repositories/agent-runner.repository.spec.ts` - unit coverage for fetch success/failure/timeout/invalid response normalization.
- `server/src/services/agent-runner.service.ts` - config lookup, not-configured response, short status cache, in-flight dedupe.
- `server/src/services/agent-runner.service.spec.ts` - unit coverage for config behavior, cache, and response mapping.
- `server/src/controllers/agent-runner.controller.ts` - authenticated status endpoint.
- `server/src/controllers/agent-runner.controller.spec.ts` - route auth, permission metadata, and response coverage.
- `web/src/routes/(user)/assistant/+page.ts` - authenticated page load that fetches runner status.
- `web/src/routes/(user)/assistant/+page.svelte` - Assistant page shell.
- `web/src/routes/(user)/assistant/agent-runner-status-panel.svelte` - disabled-state panel component.
- `web/src/routes/(user)/assistant/agent-runner-status-panel.spec.ts` - component tests for disabled and healthy states.
- `web/src/routes/(user)/assistant/page-load.spec.ts` - page load tests for auth and SDK fetch.

Modify:

- `server/src/dtos/env.dto.ts` - add runner env vars.
- `server/src/repositories/config.repository.ts` - expose runner env under `env.agent`.
- `server/src/repositories/config.repository.spec.ts` - env parsing coverage.
- `server/src/repositories/index.ts` - register `AgentRunnerRepository`.
- `server/src/services/index.ts` - register `AgentRunnerService`.
- `server/src/controllers/index.ts` - register `AgentRunnerController`.
- `server/src/enum.ts` - add `AgentRunnerRead` permission and `AgentRunner` API tag.
- `server/src/constants.ts` - add API tag text.
- `web/src/lib/route.ts` - add `Route.assistant()`.
- `web/src/lib/route.spec.ts` - add route helper coverage.
- `web/src/lib/components/shared-components/side-bar/user-sidebar.svelte` - add Assistant nav item.
- `web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts` - add sidebar nav coverage.
- `i18n/en.json` - add Assistant UI strings.
- Generated OpenAPI, TypeScript SDK, and mobile OpenAPI files from `make open-api`.

## API Contract

```text
GET /agent/runner/status
```

Auth:

- Session auth: any signed-in user.
- API key auth: requires `agentRunner.read`.

Response:

```ts
type AgentRunnerStatusDto = {
  configured: boolean;
  healthy: boolean;
  reason: 'not-configured' | 'healthy' | 'unhealthy' | 'timeout' | 'invalid-response';
  version: string | null;
  capabilities: {
    protocolVersion: string | null;
    streaming: boolean;
    tools: string[];
    models: string[];
  } | null;
  checkedAt: Date;
};
```

## Task 1: Environment And DTO Contracts

**Files:**

- Modify: `server/src/dtos/env.dto.ts`
- Modify: `server/src/repositories/config.repository.ts`
- Modify: `server/src/repositories/config.repository.spec.ts`
- Create: `server/src/dtos/agent-runner.dto.ts`

- [ ] **Step 1: Write failing config tests**

Add the runner env vars to the `resetEnv()` list in `server/src/repositories/config.repository.spec.ts`:

```ts
'IMMICH_AGENT_RUNNER_URL',
'IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS',
```

Add these tests inside `describe('getEnv', () => { ... })`:

```ts
describe('agent runner', () => {
  it('should default runner config to disabled with a two second timeout', () => {
    const { agent } = getEnv();

    expect(agent).toMatchObject({
      runnerUrl: undefined,
      runnerHealthTimeoutMs: 2000,
    });
  });

  it('should parse runner URL and health timeout', () => {
    process.env.IMMICH_AGENT_RUNNER_URL = 'http://agent-runner:4477';
    process.env.IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS = '5000';

    const { agent } = getEnv();

    expect(agent).toMatchObject({
      runnerUrl: 'http://agent-runner:4477',
      runnerHealthTimeoutMs: 5000,
    });
  });

  it('should reject invalid runner URLs', () => {
    process.env.IMMICH_AGENT_RUNNER_URL = 'not-a-url';

    expect(() => getEnv()).toThrowError('[IMMICH_AGENT_RUNNER_URL] Invalid URL');
  });

  it('should reject non-positive runner health timeouts', () => {
    process.env.IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS = '0';

    expect(() => getEnv()).toThrowError('[IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS] Too small');
  });
});
```

- [ ] **Step 2: Run config tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/repositories/config.repository.spec.ts
```

Expected: FAIL because `agent.runnerUrl` and `agent.runnerHealthTimeoutMs` are not implemented.

- [ ] **Step 3: Add env schema fields**

In `server/src/dtos/env.dto.ts`, add these fields near `IMMICH_AGENT_SECRET_KEY`:

```ts
IMMICH_AGENT_RUNNER_URL: z.url().optional(),
IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
```

- [ ] **Step 4: Add config repository fields**

In `server/src/repositories/config.repository.ts`, update `EnvData.agent`:

```ts
agent: {
  secretKey?: string;
  runnerUrl?: string;
  runnerHealthTimeoutMs: number;
};
```

Update the `agent` mapping in `getEnv()`:

```ts
agent: {
  secretKey: dto.IMMICH_AGENT_SECRET_KEY,
  runnerUrl: dto.IMMICH_AGENT_RUNNER_URL,
  runnerHealthTimeoutMs: dto.IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS ?? 2000,
},
```

- [ ] **Step 5: Update config repository mock**

In `server/test/repositories/config.repository.mock.ts`, update the `agent` default:

```ts
agent: {
  runnerHealthTimeoutMs: 2000,
},
```

- [ ] **Step 6: Create runner DTOs**

Create `server/src/dtos/agent-runner.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { isoDatetimeToDate } from 'src/validation';
import z from 'zod';

const AgentRunnerStatusReasonSchema = z
  .enum(['not-configured', 'healthy', 'unhealthy', 'timeout', 'invalid-response'])
  .describe('Agent runner availability reason')
  .meta({ id: 'AgentRunnerStatusReason' });

const AgentRunnerCapabilitiesSchema = z
  .object({
    protocolVersion: z.string().nullable().describe('Runner protocol version'),
    streaming: z.boolean().describe('Whether the runner can stream events'),
    tools: z.array(z.string()).describe('Tool names reported by the runner'),
    models: z.array(z.string()).describe('Model IDs reported by the runner'),
  })
  .meta({ id: 'AgentRunnerCapabilitiesDto' });

const AgentRunnerStatusSchema = z
  .object({
    configured: z.boolean().describe('Whether a runner endpoint is configured'),
    healthy: z.boolean().describe('Whether the configured runner is reachable and healthy'),
    reason: AgentRunnerStatusReasonSchema,
    version: z.string().nullable().describe('Runner version when reported'),
    capabilities: AgentRunnerCapabilitiesSchema.nullable().describe('Normalized runner capabilities'),
    checkedAt: isoDatetimeToDate.describe('When this status was checked'),
  })
  .meta({ id: 'AgentRunnerStatusDto' });

export type AgentRunnerStatusReason = z.infer<typeof AgentRunnerStatusReasonSchema>;
export type AgentRunnerCapabilities = z.infer<typeof AgentRunnerCapabilitiesSchema>;

export class AgentRunnerStatusDto extends createZodDto(AgentRunnerStatusSchema) {}
```

- [ ] **Step 7: Run config tests and typecheck**

Run:

```bash
pnpm --filter immich run test -- --run src/repositories/config.repository.spec.ts
pnpm --filter immich run check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add server/src/dtos/env.dto.ts server/src/repositories/config.repository.ts server/src/repositories/config.repository.spec.ts server/test/repositories/config.repository.mock.ts server/src/dtos/agent-runner.dto.ts
git commit -m "feat: add agent runner config contracts"
```

## Task 2: Runner Repository Fetch Boundary

**Files:**

- Create: `server/src/repositories/agent-runner.repository.spec.ts`
- Create: `server/src/repositories/agent-runner.repository.ts`
- Modify: `server/src/repositories/index.ts`

- [ ] **Step 1: Write failing repository tests**

Create `server/src/repositories/agent-runner.repository.spec.ts`:

```ts
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe(AgentRunnerRepository.name, () => {
  let sut: AgentRunnerRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    sut = new AgentRunnerRepository();
  });

  it('probes the configured runner health endpoint and normalizes capabilities', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          status: 'ok',
          version: '0.1.0',
          capabilities: {
            protocolVersion: '2026-05-14',
            streaming: true,
            tools: ['echo', 123, 'read_asset_metadata'],
            models: ['gpt-5.1', null],
          },
        }),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo', 'read_asset_metadata'],
        models: ['gpt-5.1'],
      },
    });
    expect(mockFetch).toHaveBeenCalledWith(new URL('/health', 'http://agent-runner:4477'), {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('preserves runner URL path prefixes when appending the health endpoint', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    await sut.getStatus({ url: 'https://gateway.local/pi-runner/', timeoutMs: 2500 });

    expect(mockFetch).toHaveBeenCalledWith(new URL('https://gateway.local/pi-runner/health'), {
      headers: { Accept: 'application/json' },
      signal: expect.any(AbortSignal),
    });
  });

  it('returns unhealthy for non-2xx responses', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 503 });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'unhealthy',
      version: null,
      capabilities: null,
    });
  });

  it('returns invalid-response when healthy response is not JSON', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new Error('invalid json')),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'invalid-response',
      version: null,
      capabilities: null,
    });
  });

  it('returns invalid-response when status is not ok', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'starting' }),
    });

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'invalid-response',
      version: null,
      capabilities: null,
    });
  });

  it('returns timeout for abort timeout errors', async () => {
    const error = new Error('Timeout');
    error.name = 'TimeoutError';
    mockFetch.mockRejectedValue(error);

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });
  });

  it('returns unhealthy for network errors', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    await expect(sut.getStatus({ url: 'http://agent-runner:4477', timeoutMs: 2500 })).resolves.toEqual({
      healthy: false,
      reason: 'unhealthy',
      version: null,
      capabilities: null,
    });
  });
});
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/repositories/agent-runner.repository.spec.ts
```

Expected: FAIL with module resolution error for `src/repositories/agent-runner.repository`.

- [ ] **Step 3: Implement repository**

Create `server/src/repositories/agent-runner.repository.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AgentRunnerCapabilities, AgentRunnerStatusReason } from 'src/dtos/agent-runner.dto';

type RunnerHealthBody = {
  status?: unknown;
  version?: unknown;
  capabilities?: unknown;
};

type AgentRunnerProbeConfig = {
  url: string;
  timeoutMs: number;
};

export type AgentRunnerProbeResult = {
  healthy: boolean;
  reason: Exclude<AgentRunnerStatusReason, 'not-configured'>;
  version: string | null;
  capabilities: AgentRunnerCapabilities | null;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const objectRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const normalizeCapabilities = (value: unknown): AgentRunnerCapabilities => {
  const capabilities = objectRecord(value);
  return {
    protocolVersion: typeof capabilities.protocolVersion === 'string' ? capabilities.protocolVersion : null,
    streaming: capabilities.streaming === true,
    tools: stringArray(capabilities.tools),
    models: stringArray(capabilities.models),
  };
};

const unavailable = (
  reason: Exclude<AgentRunnerStatusReason, 'not-configured' | 'healthy'>,
): AgentRunnerProbeResult => ({
  healthy: false,
  reason,
  version: null,
  capabilities: null,
});

const getRunnerHealthUrl = (url: string) => {
  const healthUrl = new URL(url);
  healthUrl.pathname = `${healthUrl.pathname.replace(/\/$/, '')}/health`;
  return healthUrl;
};

@Injectable()
export class AgentRunnerRepository {
  async getStatus({ url, timeoutMs }: AgentRunnerProbeConfig): Promise<AgentRunnerProbeResult> {
    try {
      const response = await fetch(getRunnerHealthUrl(url), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        return unavailable('unhealthy');
      }

      let body: RunnerHealthBody;
      try {
        body = (await response.json()) as RunnerHealthBody;
      } catch {
        return unavailable('invalid-response');
      }

      if (body.status !== 'ok') {
        return unavailable('invalid-response');
      }

      return {
        healthy: true,
        reason: 'healthy',
        version: typeof body.version === 'string' ? body.version : null,
        capabilities: normalizeCapabilities(body.capabilities),
      };
    } catch (error) {
      return unavailable(error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'unhealthy');
    }
  }
}
```

- [ ] **Step 4: Register repository provider**

In `server/src/repositories/index.ts`, import and add the repository:

```ts
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
```

Add to `repositories`:

```ts
AgentRunnerRepository,
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
pnpm --filter immich run test -- --run src/repositories/agent-runner.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/repositories/agent-runner.repository.ts server/src/repositories/agent-runner.repository.spec.ts server/src/repositories/index.ts
git commit -m "feat: add agent runner health repository"
```

## Task 3: Runner Status Service

**Files:**

- Create: `server/src/services/agent-runner.service.spec.ts`
- Create: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/index.ts`

- [ ] **Step 1: Write failing service tests**

Create `server/src/services/agent-runner.service.spec.ts`:

```ts
import { ConfigRepository } from 'src/repositories/config.repository';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import { automock } from 'test/utils';

describe(AgentRunnerService.name, () => {
  let sut: AgentRunnerService;
  let configRepository: ReturnType<typeof automock<ConfigRepository>>;
  let agentRunnerRepository: ReturnType<typeof automock<AgentRunnerRepository>>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T10:00:00.000Z'));
    configRepository = automock(ConfigRepository);
    agentRunnerRepository = automock(AgentRunnerRepository);
    sut = new AgentRunnerService(configRepository, agentRunnerRepository);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns disabled status without probing when runner URL is missing', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerHealthTimeoutMs: 2000 },
    } as never);

    await expect(sut.getStatus()).resolves.toEqual({
      configured: false,
      healthy: false,
      reason: 'not-configured',
      version: null,
      capabilities: null,
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
    });
    expect(agentRunnerRepository.getStatus).not.toHaveBeenCalled();
  });

  it('probes the configured runner and maps a healthy response', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
    });

    await expect(sut.getStatus()).resolves.toEqual({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
      checkedAt: new Date('2026-05-14T10:00:00.000Z'),
    });
    expect(agentRunnerRepository.getStatus).toHaveBeenCalledWith({
      url: 'http://agent-runner:4477',
      timeoutMs: 3000,
    });
  });

  it('maps unhealthy probes while preserving configured=true', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });

    await expect(sut.getStatus()).resolves.toMatchObject({
      configured: true,
      healthy: false,
      reason: 'timeout',
      version: null,
      capabilities: null,
    });
  });

  it('caches configured runner status briefly', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await sut.getStatus();
    await sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent configured runner status probes', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);

    let resolveProbe: (value: Awaited<ReturnType<AgentRunnerRepository['getStatus']>>) => void;
    agentRunnerRepository.getStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveProbe = resolve;
      }),
    );

    const first = sut.getStatus();
    const second = sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(1);

    resolveProbe!({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      {
        configured: true,
        healthy: true,
        reason: 'healthy',
        version: null,
        capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
        checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
      {
        configured: true,
        healthy: true,
        reason: 'healthy',
        version: null,
        capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
        checkedAt: new Date('2026-05-14T10:00:00.000Z'),
      },
    ]);
  });

  it('refreshes cached status after the cache window', async () => {
    configRepository.getEnv.mockReturnValue({
      agent: { runnerUrl: 'http://agent-runner:4477', runnerHealthTimeoutMs: 3000 },
    } as never);
    agentRunnerRepository.getStatus.mockResolvedValue({
      healthy: true,
      reason: 'healthy',
      version: null,
      capabilities: { protocolVersion: null, streaming: false, tools: [], models: [] },
    });

    await sut.getStatus();
    vi.advanceTimersByTime(15_001);
    await sut.getStatus();

    expect(agentRunnerRepository.getStatus).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/services/agent-runner.service.spec.ts
```

Expected: FAIL with module resolution error for `src/services/agent-runner.service`.

- [ ] **Step 3: Implement service**

Create `server/src/services/agent-runner.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AgentRunnerStatusDto } from 'src/dtos/agent-runner.dto';
import { ConfigRepository } from 'src/repositories/config.repository';
import { AgentRunnerRepository } from 'src/repositories/agent-runner.repository';

const RUNNER_STATUS_CACHE_MS = 15_000;

@Injectable()
export class AgentRunnerService {
  private statusCache?: { value: AgentRunnerStatusDto; expiresAt: number };
  private statusInFlight?: Promise<AgentRunnerStatusDto>;

  constructor(
    private readonly configRepository: ConfigRepository,
    private readonly agentRunnerRepository: AgentRunnerRepository,
  ) {}

  async getStatus(): Promise<AgentRunnerStatusDto> {
    const { runnerUrl, runnerHealthTimeoutMs } = this.configRepository.getEnv().agent;
    if (!runnerUrl) {
      return this.notConfigured();
    }

    const now = Date.now();
    if (this.statusCache && this.statusCache.expiresAt > now) {
      return this.statusCache.value;
    }
    if (this.statusInFlight) {
      return this.statusInFlight;
    }

    this.statusInFlight = (async () => {
      try {
        const probe = await this.agentRunnerRepository.getStatus({ url: runnerUrl, timeoutMs: runnerHealthTimeoutMs });
        const value: AgentRunnerStatusDto = {
          configured: true,
          healthy: probe.healthy,
          reason: probe.reason,
          version: probe.version,
          capabilities: probe.capabilities,
          checkedAt: new Date(),
        };
        this.statusCache = { value, expiresAt: Date.now() + RUNNER_STATUS_CACHE_MS };
        return value;
      } finally {
        this.statusInFlight = undefined;
      }
    })();

    return this.statusInFlight;
  }

  private notConfigured(): AgentRunnerStatusDto {
    return {
      configured: false,
      healthy: false,
      reason: 'not-configured',
      version: null,
      capabilities: null,
      checkedAt: new Date(),
    };
  }
}
```

- [ ] **Step 4: Register service**

In `server/src/services/index.ts`, import and add:

```ts
import { AgentRunnerService } from 'src/services/agent-runner.service';
```

Add to `services`:

```ts
AgentRunnerService,
```

- [ ] **Step 5: Run service tests**

Run:

```bash
pnpm --filter immich run test -- --run src/services/agent-runner.service.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts server/src/services/index.ts
git commit -m "feat: add agent runner status service"
```

## Task 4: Runner Status API

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/constants.ts`
- Create: `server/src/controllers/agent-runner.controller.spec.ts`
- Create: `server/src/controllers/agent-runner.controller.ts`
- Modify: `server/src/controllers/index.ts`

- [ ] **Step 1: Add enum contract**

In `server/src/enum.ts`, add near the existing agent credential permissions:

```ts
AgentRunnerRead = 'agentRunner.read',
```

Add to `ApiTag`:

```ts
AgentRunner = 'Agent runner',
```

In `server/src/constants.ts`, add to `endpointTags`:

```ts
[ApiTag.AgentRunner]: 'AI agent runner health and capability status',
```

- [ ] **Step 2: Write failing controller tests**

Create `server/src/controllers/agent-runner.controller.spec.ts`:

```ts
import { AgentRunnerController } from 'src/controllers/agent-runner.controller';
import { Permission } from 'src/enum';
import { AgentRunnerService } from 'src/services/agent-runner.service';
import request from 'supertest';
import { AuthFactory } from 'test/factories/auth.factory';
import { automock, ControllerContext, controllerSetup } from 'test/utils';

describe(AgentRunnerController.name, () => {
  let ctx: ControllerContext;
  const service = automock(AgentRunnerService, { args: [{} as never, {} as never], strict: false });
  const auth = AuthFactory.create();
  const response = {
    configured: false,
    healthy: false,
    reason: 'not-configured' as const,
    version: null,
    capabilities: null,
    checkedAt: new Date('2026-05-14T00:00:00.000Z'),
  };

  beforeAll(async () => {
    ctx = await controllerSetup(AgentRunnerController, [{ provide: AgentRunnerService, useValue: service }]);
    return () => ctx.close();
  });

  beforeEach(() => {
    service.resetAllMocks();
    ctx.reset();
    ctx.authenticate.mockResolvedValue(auth);
  });

  it('should be an authenticated route with agent runner read permission', async () => {
    service.getStatus.mockResolvedValue(response);

    await request(ctx.getHttpServer()).get('/agent/runner/status');

    expect(ctx.authenticate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ permission: Permission.AgentRunnerRead }),
      }),
    );
  });

  it('should return runner status', async () => {
    service.getStatus.mockResolvedValue({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
      checkedAt: new Date('2026-05-14T00:00:00.000Z'),
    });

    const { status, body } = await request(ctx.getHttpServer()).get('/agent/runner/status');

    expect(status).toBe(200);
    expect(service.getStatus).toHaveBeenCalledWith();
    expect(body).toEqual({
      configured: true,
      healthy: true,
      reason: 'healthy',
      version: '0.1.0',
      capabilities: {
        protocolVersion: '2026-05-14',
        streaming: true,
        tools: ['echo'],
        models: [],
      },
      checkedAt: '2026-05-14T00:00:00.000Z',
    });
  });
});
```

- [ ] **Step 3: Run controller tests and verify they fail**

Run:

```bash
pnpm --filter immich run test -- --run src/controllers/agent-runner.controller.spec.ts
```

Expected: FAIL with module resolution error for `src/controllers/agent-runner.controller`.

- [ ] **Step 4: Implement controller**

Create `server/src/controllers/agent-runner.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Endpoint, HistoryBuilder } from 'src/decorators';
import { AgentRunnerStatusDto } from 'src/dtos/agent-runner.dto';
import { ApiTag, Permission } from 'src/enum';
import { Authenticated } from 'src/middleware/auth.guard';
import { AgentRunnerService } from 'src/services/agent-runner.service';

@ApiTags(ApiTag.AgentRunner)
@Controller('agent/runner')
export class AgentRunnerController {
  constructor(private service: AgentRunnerService) {}

  @Get('status')
  @Authenticated({ permission: Permission.AgentRunnerRead })
  @Endpoint({
    summary: 'Get agent runner status',
    description: 'Retrieve AI agent runner configuration, health, and capability status.',
    history: new HistoryBuilder().added('v2.7.5').alpha('v2.7.5'),
  })
  getAgentRunnerStatus(): Promise<AgentRunnerStatusDto> {
    return this.service.getStatus();
  }
}
```

- [ ] **Step 5: Register controller**

In `server/src/controllers/index.ts`, import and add:

```ts
import { AgentRunnerController } from 'src/controllers/agent-runner.controller';
```

Add to `controllers`:

```ts
AgentRunnerController,
```

- [ ] **Step 6: Run controller tests**

Run:

```bash
pnpm --filter immich run test -- --run src/controllers/agent-runner.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add server/src/enum.ts server/src/constants.ts server/src/controllers/agent-runner.controller.ts server/src/controllers/agent-runner.controller.spec.ts server/src/controllers/index.ts
git commit -m "feat: add agent runner status api"
```

## Task 5: Generated API Artifacts

**Files:**

- Modify: `open-api/immich-openapi-specs.json`
- Modify: `open-api/typescript-sdk/src/fetch-client.ts`
- Modify: `mobile/openapi/**`
- Include `open-api/typescript-sdk/build/**` only when `git status --short open-api/typescript-sdk/build` shows tracked generated changes after the SDK build.

- [ ] **Step 1: Generate OpenAPI artifacts**

Run:

```bash
make open-api
```

If the local machine lacks `wget`, use the existing repo script unchanged and run with a temporary shell shim:

```bash
bash -lc 'function wget(){ if [[ "$1" == "-O" ]]; then command curl -fsSL -o "$2" "$3"; else command curl -fsSL "$@"; fi; }; export -f wget; cd open-api && bash ./bin/generate-open-api.sh'
```

Expected: command exits 0.

- [ ] **Step 2: Inspect generated response exposure**

Run:

```bash
rg -n "AgentRunnerStatusDto|agent/runner/status|agentRunner.read" open-api/immich-openapi-specs.json open-api/typescript-sdk/src/fetch-client.ts mobile/openapi/lib
```

Expected:

- `GET /agent/runner/status` appears.
- `AgentRunnerStatusDto` appears.
- `agentRunner.read` appears in the permission enum.
- No runner URL appears in `AgentRunnerStatusDto`.

- [ ] **Step 3: Build SDK**

Run:

```bash
pnpm --filter @immich/sdk build
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add open-api/immich-openapi-specs.json open-api/typescript-sdk mobile/openapi
git commit -m "chore: update agent runner api artifacts"
```

## Task 6: Assistant Page Disabled State

**Files:**

- Modify: `web/src/lib/route.ts`
- Modify: `web/src/lib/route.spec.ts`
- Modify: `web/src/lib/components/shared-components/side-bar/user-sidebar.svelte`
- Modify: `web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`
- Modify: `i18n/en.json`
- Create: `web/src/routes/(user)/assistant/+page.ts`
- Create: `web/src/routes/(user)/assistant/+page.svelte`
- Create: `web/src/routes/(user)/assistant/agent-runner-status-panel.svelte`
- Create: `web/src/routes/(user)/assistant/agent-runner-status-panel.spec.ts`
- Create: `web/src/routes/(user)/assistant/page-load.spec.ts`

- [ ] **Step 1: Write failing page load tests**

Create `web/src/routes/(user)/assistant/page-load.spec.ts`:

```ts
const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const runnerStatus = {
  configured: false,
  healthy: false,
  reason: 'not-configured' as const,
  version: null,
  capabilities: null,
  checkedAt: '2026-05-14T00:00:00.000Z',
};

describe('/assistant load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
    sdkMock.getAgentRunnerStatus.mockResolvedValue(runnerStatus);
  });

  it('authenticates the user and returns translated metadata with runner status', async () => {
    const url = new URL('http://localhost/assistant');

    await expect(load({ url } as never)).resolves.toEqual({
      meta: { title: 'assistant' },
      runnerStatus,
    });
    expect(authenticate).toHaveBeenCalledWith(url);
    expect(sdkMock.getAgentRunnerStatus).toHaveBeenCalledWith();
  });
});
```

- [ ] **Step 2: Write failing status panel tests**

Create `web/src/routes/(user)/assistant/agent-runner-status-panel.spec.ts`:

```ts
import { render, screen } from '@testing-library/svelte';
import AgentRunnerStatusPanel from './agent-runner-status-panel.svelte';

vi.mock('svelte-i18n', async () => {
  const { readable } = await import('svelte/store');
  const messages: Record<string, string> = {
    assistant: 'Assistant',
    assistant_runner_not_configured: 'Runner not configured',
    assistant_runner_unavailable: 'Runner unavailable',
    assistant_runner_healthy: 'Runner healthy',
    assistant_start_session: 'Start session',
    assistant_protocol: 'Protocol {protocol}',
  };

  return {
    t: readable((key: string, options?: { values?: Record<string, string> }) =>
      (messages[key] ?? key).replace('{protocol}', options?.values?.protocol ?? ''),
    ),
  };
});

describe(AgentRunnerStatusPanel.name, () => {
  it('shows disabled state when the runner is not configured', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: false,
          healthy: false,
          reason: 'not-configured',
          version: null,
          capabilities: null,
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner not configured');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });

  it('shows disabled state when the configured runner is unhealthy', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: true,
          healthy: false,
          reason: 'timeout',
          version: null,
          capabilities: null,
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner unavailable');
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });

  it('shows healthy runner capabilities while keeping session start disabled for this slice', () => {
    render(AgentRunnerStatusPanel, {
      props: {
        status: {
          configured: true,
          healthy: true,
          reason: 'healthy',
          version: '0.1.0',
          capabilities: {
            protocolVersion: '2026-05-14',
            streaming: true,
            tools: ['echo'],
            models: [],
          },
          checkedAt: '2026-05-14T00:00:00.000Z',
        },
      },
    });

    expect(screen.getByTestId('assistant-status-reason')).toHaveTextContent('Runner healthy');
    expect(screen.getByText('Protocol 2026-05-14')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start session' })).toBeDisabled();
  });
});
```

- [ ] **Step 3: Run web tests and verify they fail**

Run:

```bash
pnpm --filter immich-web test -- --run 'src/routes/(user)/assistant/page-load.spec.ts' 'src/routes/(user)/assistant/agent-runner-status-panel.spec.ts'
```

Expected: FAIL because the route and panel do not exist.

- [ ] **Step 4: Add failing route helper coverage**

In `web/src/lib/route.spec.ts`, add:

```ts
describe(Route.assistant.name, () => {
  it('should link to the assistant page', () => {
    expect(Route.assistant()).toBe('/assistant');
  });
});
```

- [ ] **Step 5: Add failing sidebar coverage**

In `web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts`, add:

```ts
it('shows an assistant link', () => {
  render(UserSidebar);

  expect(screen.getByRole('link', { name: /^assistant$/i })).toHaveAttribute('href', '/assistant');
});
```

- [ ] **Step 6: Run route and sidebar tests and verify they fail**

Run:

```bash
pnpm --filter immich-web test -- --run src/lib/route.spec.ts src/lib/components/shared-components/side-bar/user-sidebar.spec.ts
```

Expected: FAIL because `Route.assistant()` and the Assistant sidebar item do not exist.

- [ ] **Step 7: Add route helper**

In `web/src/lib/route.ts`, add near the user routes:

```ts
// assistant
assistant: () => '/assistant',
```

- [ ] **Step 8: Add i18n strings**

In `i18n/en.json`, add these keys in sorted order:

```json
"assistant": "Assistant",
"assistant_configured": "Configured",
"assistant_healthy": "Healthy",
"assistant_no": "no",
"assistant_protocol": "Protocol {protocol}",
"assistant_runner": "Runner {version}",
"assistant_runner_healthy": "Runner healthy",
"assistant_runner_not_configured": "Runner not configured",
"assistant_runner_unavailable": "Runner unavailable",
"assistant_start_session": "Start session",
"assistant_streaming": "Streaming",
"assistant_subtitle": "Album organization assistant",
"assistant_yes": "yes",
```

- [ ] **Step 9: Add Assistant sidebar item**

In `web/src/lib/components/shared-components/side-bar/user-sidebar.svelte`, add icon imports:

```ts
mdiRobot,
mdiRobotOutline,
```

Add the nav item after Explore and before Map:

```svelte
<NavbarItem title={$t('assistant')} href={Route.assistant()} icon={mdiRobotOutline} activeIcon={mdiRobot} />
```

- [ ] **Step 10: Implement page load**

Create `web/src/routes/(user)/assistant/+page.ts`:

```ts
import { authenticate } from '$lib/utils/auth';
import { getFormatter } from '$lib/utils/i18n';
import { getAgentRunnerStatus } from '@immich/sdk';
import type { PageLoad } from './$types';

export const load = (async ({ url }) => {
  await authenticate(url);
  const $t = await getFormatter();

  return {
    meta: {
      title: $t('assistant'),
    },
    runnerStatus: await getAgentRunnerStatus(),
  };
}) satisfies PageLoad;
```

- [ ] **Step 11: Implement status panel**

Create `web/src/routes/(user)/assistant/agent-runner-status-panel.svelte`:

```svelte
<script lang="ts">
  import { Icon, Text } from '@immich/ui';
  import { mdiAlertCircleOutline, mdiCheckCircleOutline, mdiRobotOutline } from '@mdi/js';
  import type { AgentRunnerStatusDto } from '@immich/sdk';
  import { t } from 'svelte-i18n';

  interface Props {
    status: AgentRunnerStatusDto;
  }

  let { status }: Props = $props();

  const reasonKey = $derived.by(() => {
    if (!status.configured) {
      return 'assistant_runner_not_configured';
    }
    if (!status.healthy) {
      return 'assistant_runner_unavailable';
    }
    return 'assistant_runner_healthy';
  });

  const icon = $derived(status.healthy ? mdiCheckCircleOutline : mdiAlertCircleOutline);
  const iconClass = $derived(status.healthy ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400');
  const protocol = $derived(status.capabilities?.protocolVersion ?? 'unknown');
</script>

<section
  class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 text-black dark:text-white md:px-8"
  aria-labelledby="assistant-title"
>
  <div class="flex items-center gap-3">
    <Icon icon={mdiRobotOutline} class="text-primary" size="32" />
    <div>
      <h1 id="assistant-title" class="text-2xl font-semibold">{$t('assistant')}</h1>
      <Text size="small" color="muted">{$t('assistant_subtitle')}</Text>
    </div>
  </div>

  <div class="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-immich-dark-gray">
    <div class="flex items-start gap-4">
      <Icon icon={icon} class={iconClass} size="28" />
      <div class="min-w-0 flex-1">
        <div data-testid="assistant-status-reason" class="text-lg font-medium">{$t(reasonKey)}</div>
        <div class="mt-2 grid gap-2 text-sm text-gray-600 dark:text-gray-300">
          <div>{$t('assistant_configured')}: {$t(status.configured ? 'assistant_yes' : 'assistant_no')}</div>
          <div>{$t('assistant_healthy')}: {$t(status.healthy ? 'assistant_yes' : 'assistant_no')}</div>
          {#if status.version}
            <div>{$t('assistant_runner', { values: { version: status.version } })}</div>
          {/if}
          {#if status.capabilities}
            <div>{$t('assistant_protocol', { values: { protocol } })}</div>
            <div>
              {$t('assistant_streaming')}: {$t(status.capabilities.streaming ? 'assistant_yes' : 'assistant_no')}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>

  <div class="flex flex-col gap-2 sm:flex-row">
    <button
      type="button"
      disabled
      class="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 font-medium text-white opacity-50"
    >
      {$t('assistant_start_session')}
    </button>
  </div>
</section>
```

- [ ] **Step 12: Implement page shell**

Create `web/src/routes/(user)/assistant/+page.svelte`:

```svelte
<script lang="ts">
  import UserPageLayout from '$lib/components/layouts/user-page-layout.svelte';
  import type { PageData } from './$types';
  import AgentRunnerStatusPanel from './agent-runner-status-panel.svelte';

  interface Props {
    data: PageData;
  }

  let { data }: Props = $props();
</script>

<UserPageLayout title={data.meta.title}>
  <AgentRunnerStatusPanel status={data.runnerStatus} />
</UserPageLayout>
```

- [ ] **Step 13: Run web tests**

Run:

```bash
pnpm --filter immich-web test -- --run 'src/routes/(user)/assistant/page-load.spec.ts' 'src/routes/(user)/assistant/agent-runner-status-panel.spec.ts' src/lib/route.spec.ts src/lib/components/shared-components/side-bar/user-sidebar.spec.ts
```

Expected: PASS.

- [ ] **Step 14: Commit**

```bash
git add i18n/en.json web/src/lib/route.ts web/src/lib/route.spec.ts web/src/lib/components/shared-components/side-bar/user-sidebar.svelte web/src/lib/components/shared-components/side-bar/user-sidebar.spec.ts 'web/src/routes/(user)/assistant'
git commit -m "feat: add disabled assistant page"
```

## Task 7: Verification And Slice Review

**Files:**

- All files touched in this plan.

- [ ] **Step 1: Run focused server tests**

Run:

```bash
pnpm --filter immich run test -- --run src/repositories/config.repository.spec.ts src/repositories/agent-runner.repository.spec.ts src/services/agent-runner.service.spec.ts src/controllers/agent-runner.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
pnpm --filter immich-web test -- --run 'src/routes/(user)/assistant/page-load.spec.ts' 'src/routes/(user)/assistant/agent-runner-status-panel.spec.ts' src/lib/route.spec.ts src/lib/components/shared-components/side-bar/user-sidebar.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run type and format checks**

Run:

```bash
pnpm --filter immich run check
pnpm --filter immich-web run check:typescript
pnpm --filter immich-web run check:svelte
pnpm --filter immich run format
pnpm --filter immich-web run format
```

Expected: all commands exit 0.

- [ ] **Step 4: Run API artifact check**

Run:

```bash
git diff --check
pnpm --filter @immich/sdk build
```

Expected: both commands exit 0.

- [ ] **Step 5: Manual review checklist**

Review the final diff and verify:

- `GET /agent/runner/status` is read-only.
- The endpoint is authenticated with `agentRunner.read`.
- API key permissions include `agentRunner.read`.
- Runner URL is not returned to clients.
- No code imports or references `agent_session`.
- No code imports or references `agent_message`.
- The Assistant page has no create-session action wired.
- The disabled button is always disabled in this slice.
- Assistant route, sidebar entry, page title, and panel strings use the existing route/i18n conventions.
- Generated OpenAPI/mobile/TypeScript SDK files include the endpoint.

- [ ] **Step 6: Commit any verification fixes**

If any verification command required code or formatting changes:

```bash
git add server/src web/src open-api mobile
git commit -m "fix: harden agent runner disabled state"
```

If there are no changes, do not create an empty commit.

## Final Verification Commands

Before opening or updating a PR, run:

```bash
pnpm --filter immich run test -- --run src/repositories/config.repository.spec.ts src/repositories/agent-runner.repository.spec.ts src/services/agent-runner.service.spec.ts src/controllers/agent-runner.controller.spec.ts
pnpm --filter immich-web test -- --run 'src/routes/(user)/assistant/page-load.spec.ts' 'src/routes/(user)/assistant/agent-runner-status-panel.spec.ts' src/lib/route.spec.ts src/lib/components/shared-components/side-bar/user-sidebar.spec.ts
pnpm --filter immich run check
pnpm --filter immich-web run check:typescript
pnpm --filter immich-web run check:svelte
pnpm --filter @immich/sdk build
git diff --check
```

## Plan Self-Review

- Spec coverage: Implements slice 4 only: runner config/env, health/capability check, disabled Assistant page, and unavailable-runner behavior.
- TDD coverage: Each backend and frontend unit starts with failing tests, followed by minimal implementation and focused verification.
- Independence: The plan avoids `agent_session`, `agent_message`, runner protocol sessions, chat, streaming, tools, and album operations.
- Edge cases covered: missing config, invalid env URL, invalid timeout, runner non-2xx, timeout, network error, invalid JSON, unhealthy status body, capability normalization, route permission metadata, disabled UI states.
- Generated artifacts: Full `make open-api` is required so CI does not fail on mobile OpenAPI drift.
