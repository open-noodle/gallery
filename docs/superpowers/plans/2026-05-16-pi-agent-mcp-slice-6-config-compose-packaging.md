# Pi Agent MCP Slice 6 Config, Compose, And Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the deployment-facing MCP rename by replacing the old tool-gateway env/config with MCP-specific configuration, packaging the first-party Pi runner for production/self-hosted deployments, and making one-click provisioning stable-secret and shared-runner compatible.

**Architecture:** Gallery owns tenant secrets and creates per-session MCP gateway URLs; the runner remains stateless and receives only per-session provider material, model selection, MCP URL, and bearer token. Docker Compose runs `agent-runner` as an internal service using the production server image, while open-noodle provisions per-tenant Gallery with a stable `IMMICH_AGENT_SECRET_KEY` and configurable shared runner URL. Static tests guard the config, compose, and Docker packaging contract so drift is caught before image builds.

**Tech Stack:** NestJS config/env parsing with Zod 4, Vitest server tests, Docker Compose YAML static checks via `js-yaml`, Docker multi-stage build/deploy with pnpm, open-noodle dashboard provisioning with Drizzle, Vitest, ArgoCD/Kubernetes manifests.

---

## Source Context

- Spec: `docs/superpowers/specs/2026-05-16-pi-agent-mcp-server-design.md`, section `Slice 6: Config, Compose, And Packaging`.
- Current Gallery branch: `pi-mcp-server-design-pr`, already includes Slice 5 runner `mcpGateway` protocol.
- Current open-noodle repo: `/home/pierre/dev/open-noodle`, main branch, clean at planning time.
- Current temporary compatibility left by Slice 5:
  - Gallery server config still reads `IMMICH_AGENT_TOOL_GATEWAY_URL` into `toolGatewayUrl`.
  - `AgentRunnerService` maps that temporary field to `mcpGateway`.
  - Dev/e2e compose still use `IMMICH_AGENT_TOOL_GATEWAY_URL`.
  - Production `server/Dockerfile` does not copy `agent-runner` into the final image.
  - open-noodle provisioning does not yet persist or inject `IMMICH_AGENT_SECRET_KEY`.

## Non-Goals

- Do not add a shared agent-runner deployment to open-noodle shared infrastructure in this slice.
- Do not remove the old `/api/agent/internal/tools` route or controller. That is Slice 7.
- Do not remove the runner protocol guard that rejects `toolGateway` request bodies. It protects external callers during the rename.
- Do not pass database, S3, `IMMICH_AGENT_SECRET_KEY`, or tenant-local secrets to the runner service.
- Do not make the agent runner public in compose or Kubernetes.

## File Structure

Gallery repo:

- Modify `server/src/dtos/env.dto.ts` - rename env schema to `IMMICH_AGENT_MCP_GATEWAY_URL`; reject `IMMICH_AGENT_TOOL_GATEWAY_URL` with a clear migration message.
- Modify `server/src/repositories/config.repository.ts` - rename `EnvData.agent.toolGatewayUrl` to `mcpGatewayUrl`.
- Modify `server/src/repositories/config.repository.spec.ts` - cover new env parsing, old env rejection, non-http rejection, defaults.
- Modify `server/src/services/agent-runner.service.ts` - consume `mcpGatewayUrl`; fail session creation clearly when runner is configured without MCP gateway.
- Modify `server/src/services/agent-runner.service.spec.ts` - cover `mcpGatewayUrl` handoff, missing gateway error, old property removal.
- Create `server/src/utils/agent-deployment-config.spec.ts` - static guard for compose files, `example.env`, and production Dockerfile.
- Modify `docker/docker-compose.yml` - add internal production `agent-runner` service using the server image and command `agent-runner`.
- Modify `docker/docker-compose.prod.yml` - add local production `agent-runner` service for source builds.
- Modify `docker/docker-compose.dev.yml` - rename gateway env and remove public runner port.
- Modify `docker/docker-compose.rootless.yml` - add internal rootless `agent-runner` service with no public port.
- Modify `e2e/docker-compose.yml` - rename gateway env and remove public runner port.
- Modify `docker/example.env` - add stable agent env values for self-hosted compose.
- Modify `docs/docs/partials/_docker-compose-install-steps.mdx` - generate `IMMICH_AGENT_SECRET_KEY` once during the install flow.
- Modify `docs/docs/install/environment-variables.md` - document the three agent env vars and old env removal.
- Modify `server/Dockerfile` - add an `agent-runner` build/deploy stage and final image command wrapper.

open-noodle companion repo:

- Modify `/home/pierre/dev/open-noodle/apps/dashboard/app/db/schema.ts` - add `galleryAgentSecretKey`.
- Create `/home/pierre/dev/open-noodle/apps/dashboard/drizzle/0009_gallery_agent_secret_key.sql` - add durable column.
- Modify `/home/pierre/dev/open-noodle/apps/dashboard/app/lib/provisioning/templates.ts` - render agent env for tenant Gallery API pods only.
- Modify `/home/pierre/dev/open-noodle/apps/dashboard/app/lib/provisioning/__tests__/templates.test.ts` - cover runner URL, MCP callback URL, secret references, and no compute/runner secret leakage.
- Modify `/home/pierre/dev/open-noodle/apps/dashboard/app/lib/provisioning/provision.server.ts` - generate and persist `galleryAgentSecretKey` once; apply `gallery-agent` Kubernetes Secret; pass shared-runner-compatible values into manifests.
- Modify `/home/pierre/dev/open-noodle/apps/dashboard/app/lib/provisioning/__tests__/provision.test.ts` - cover stable key reuse, one-time generation, retry idempotency, secret application, and manifest callback URL.

## TDD Rules

- For every task, first add or update tests and run the focused command to see the expected failure.
- Implement the smallest code change that makes the focused tests pass.
- Run the focused regression command for that task before moving on.
- Keep commits small: one commit after each task's green regression run.
- Do not commit generated `.pi-runtime`, `node_modules`, local `.env`, database dumps, or Docker build artifacts.

## Test And Edge Case Matrix

Configuration:

- New `IMMICH_AGENT_MCP_GATEWAY_URL` parses into `agent.mcpGatewayUrl`.
- Old `IMMICH_AGENT_TOOL_GATEWAY_URL` fails with a migration-specific error.
- Setting both old and new env names still fails because the old name must not be silently accepted.
- Non-http MCP gateway URLs fail as `[IMMICH_AGENT_MCP_GATEWAY_URL] MCP gateway URL must use http or https`.
- Missing `IMMICH_AGENT_MCP_GATEWAY_URL` keeps app boot possible but `AgentRunnerService.createSession()` fails clearly when `IMMICH_AGENT_RUNNER_URL` is configured.
- Missing `IMMICH_AGENT_MCP_GATEWAY_URL` makes runner status report `not-configured`, so the UI does not advertise a usable assistant.
- `AgentRunnerService` builds `<base>/sessions/<encoded session id>` from `mcpGatewayUrl`.

Compose and packaging:

- `docker/docker-compose.yml`, `docker/docker-compose.prod.yml`, `docker/docker-compose.dev.yml`, `docker/docker-compose.rootless.yml`, and `e2e/docker-compose.yml` contain no `IMMICH_AGENT_TOOL_GATEWAY_URL`.
- Compose/env examples use `IMMICH_AGENT_MCP_GATEWAY_URL` with `/api/agent/internal/mcp`.
- Self-hosted and e2e `agent-runner` services do not publish port `4477`.
- Runner services do not receive `IMMICH_AGENT_SECRET_KEY`, `DB_*`, `REDIS_*`, or `IMMICH_S3_*`.
- Production `server/Dockerfile` copies agent-runner artifacts into the final image and exposes a stable `agent-runner` command.

open-noodle:

- Provisioning stores `galleryAgentSecretKey` once and reuses it across retries.
- If the key already exists, provisioning does not rotate it.
- If the key is missing, the first provisioning attempt persists a 32-byte base64url key before applying manifests.
- Kubernetes `gallery-agent` Secret contains only `IMMICH_AGENT_SECRET_KEY`.
- Tenant Gallery API manifests reference `gallery-agent` by secret reference and do not inline the key.
- Tenant Gallery API manifests use a shared-runner-compatible `IMMICH_AGENT_RUNNER_URL`.
- Tenant Gallery API manifests use a tenant callback `IMMICH_AGENT_MCP_GATEWAY_URL` ending `/api/agent/internal/mcp`.
- Elastic compute manifests do not receive agent env vars.
- Elastic compute's disabled Helm server values do not receive agent env vars; only the explicit `gallery-serve` API Deployment does.
- No generated manifest sends tenant secrets to a runner deployment because Slice 6 does not create a tenant runner deployment.

## Task 1: Rename Gallery Env Configuration

**Files:**

- Modify: `server/src/dtos/env.dto.ts`
- Modify: `server/src/repositories/config.repository.ts`
- Modify: `server/src/repositories/config.repository.spec.ts`

- [ ] **Step 1: Write failing config tests**

In `server/src/repositories/config.repository.spec.ts`, update the env cleanup list near the top so the old variable is still cleared but the new variable is also cleared:

```ts
const envKeys = [
  'IMMICH_AGENT_SECRET_KEY',
  'IMMICH_AGENT_RUNNER_URL',
  'IMMICH_AGENT_TOOL_GATEWAY_URL',
  'IMMICH_AGENT_MCP_GATEWAY_URL',
  'IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS',
  'IMMICH_AGENT_RUNNER_MESSAGE_STREAM_TIMEOUT_MS',
];
```

Replace the current `should parse tool gateway URL` test and old non-http test with these tests:

```ts
it('should parse MCP gateway URL', () => {
  process.env.IMMICH_AGENT_MCP_GATEWAY_URL = 'http://immich-server:2283/api/agent/internal/mcp';

  const { agent } = getEnv();

  expect(agent.mcpGatewayUrl).toBe('http://immich-server:2283/api/agent/internal/mcp');
  expect(agent).not.toHaveProperty('toolGatewayUrl');
});

it('should reject the retired tool gateway env name', () => {
  process.env.IMMICH_AGENT_TOOL_GATEWAY_URL = 'http://immich-server:2283/api/agent/internal/tools';

  expect(() => getEnv()).toThrowError('[IMMICH_AGENT_TOOL_GATEWAY_URL] Use IMMICH_AGENT_MCP_GATEWAY_URL instead');
});

it('should reject the retired tool gateway env name even when the MCP gateway is also set', () => {
  process.env.IMMICH_AGENT_TOOL_GATEWAY_URL = 'http://immich-server:2283/api/agent/internal/tools';
  process.env.IMMICH_AGENT_MCP_GATEWAY_URL = 'http://immich-server:2283/api/agent/internal/mcp';

  expect(() => getEnv()).toThrowError('[IMMICH_AGENT_TOOL_GATEWAY_URL] Use IMMICH_AGENT_MCP_GATEWAY_URL instead');
});

it('should reject non-http MCP gateway URLs', () => {
  process.env.IMMICH_AGENT_MCP_GATEWAY_URL = 'ftp://immich-server.local';

  expect(() => getEnv()).toThrowError('[IMMICH_AGENT_MCP_GATEWAY_URL] MCP gateway URL must use http or https');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir server test config.repository.spec.ts
```

Expected: FAIL because `agent.mcpGatewayUrl` does not exist and `IMMICH_AGENT_MCP_GATEWAY_URL` is not in `EnvSchema`.

- [ ] **Step 3: Implement the env rename**

In `server/src/dtos/env.dto.ts`, replace the old gateway schema field with:

```ts
    IMMICH_AGENT_MCP_GATEWAY_URL: httpUrl('MCP gateway URL must use http or https').optional(),
    IMMICH_AGENT_TOOL_GATEWAY_URL: z
      .undefined({ error: 'Use IMMICH_AGENT_MCP_GATEWAY_URL instead' })
      .optional(),
```

In `server/src/repositories/config.repository.ts`, change the agent env shape to:

```ts
  agent: {
    secretKey?: string;
    runnerUrl?: string;
    mcpGatewayUrl?: string;
    runnerHealthTimeoutMs: number;
    runnerMessageStreamTimeoutMs: number;
  };
```

In the `agent` mapping inside `getEnv()`, use:

```ts
    agent: {
      secretKey: dto.IMMICH_AGENT_SECRET_KEY,
      runnerUrl: dto.IMMICH_AGENT_RUNNER_URL,
      mcpGatewayUrl: dto.IMMICH_AGENT_MCP_GATEWAY_URL,
      runnerHealthTimeoutMs: dto.IMMICH_AGENT_RUNNER_HEALTH_TIMEOUT_MS ?? 2000,
      runnerMessageStreamTimeoutMs: dto.IMMICH_AGENT_RUNNER_MESSAGE_STREAM_TIMEOUT_MS ?? 300_000,
    },
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir server test config.repository.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/dtos/env.dto.ts server/src/repositories/config.repository.ts server/src/repositories/config.repository.spec.ts
git commit -m "$(cat <<'EOF'
feat: rename agent mcp gateway env
EOF
)"
```

## Task 2: Require MCP Gateway For Runner Sessions

**Files:**

- Modify: `server/src/services/agent-runner.service.ts`
- Modify: `server/src/services/agent-runner.service.spec.ts`

- [ ] **Step 1: Write failing service tests**

In `server/src/services/agent-runner.service.spec.ts`, rename every mock env object property from `toolGatewayUrl` to `mcpGatewayUrl`.

Update the gateway URL tests to use MCP paths:

```ts
mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
```

Update the existing `creates a runner session through the configured runner` test so it includes an MCP gateway URL, creates a token, and expects a non-null gateway:

```ts
configRepository.getEnv.mockReturnValue({
  agent: {
    runnerUrl: 'http://agent-runner:4477',
    runnerHealthTimeoutMs: 3000,
    runnerMessageStreamTimeoutMs: 120_000,
    mcpGatewayUrl: 'http://immich-server:2283/api/agent/internal/mcp',
  },
} as never);
toolTokenService.create.mockReturnValue('tool-token');
```

Use this expected body assertion in that test:

```ts
expect(agentRunnerRepository.createSession).toHaveBeenCalledWith({
  url: 'http://agent-runner:4477',
  timeoutMs: 3000,
  body: expect.objectContaining({
    gallerySessionId: '00000000-0000-4000-8000-000000000100',
    model: 'gpt-5.1',
    mcpGateway: {
      url: 'http://immich-server:2283/api/agent/internal/mcp/sessions/00000000-0000-4000-8000-000000000100',
      token: 'tool-token',
    },
  }),
});
```

Add this focused missing-gateway test near the session creation tests:

```ts
it('throws a clear error when the runner is configured without an MCP gateway', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      mcpGatewayUrl: undefined,
      runnerHealthTimeoutMs: 3000,
      runnerMessageStreamTimeoutMs: 300_000,
    },
  } as never);

  await expect(sut.createSession(makeCreateSessionBody())).rejects.toThrow('Agent MCP gateway is not configured');
  expect(agentRunnerRepository.createSession).not.toHaveBeenCalled();
  expect(toolTokenService.create).not.toHaveBeenCalled();
});
```

Add this focused status test near the runner status tests:

```ts
it('reports the runner as not configured when the MCP gateway is missing', async () => {
  configRepository.getEnv.mockReturnValue({
    agent: {
      runnerUrl: 'http://agent-runner:4477',
      mcpGatewayUrl: undefined,
      runnerHealthTimeoutMs: 3000,
    },
  } as never);

  await expect(sut.getStatus()).resolves.toMatchObject({
    configured: false,
    healthy: false,
    reason: 'not-configured',
    capabilities: null,
  });
  expect(agentRunnerRepository.getStatus).not.toHaveBeenCalled();
});
```

Keep the existing assertion that the runner body does not contain `toolGateway`:

```ts
expect(agentRunnerRepository.createSession.mock.calls[0][0].body).not.toHaveProperty('toolGateway');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: FAIL because `AgentRunnerService` still reads `toolGatewayUrl` and still allows a null gateway.

- [ ] **Step 3: Implement the service rename and clear startup failure**

In `server/src/services/agent-runner.service.ts`, replace the config destructuring and gateway setup with:

```ts
const { runnerUrl, runnerHealthTimeoutMs, mcpGatewayUrl } = this.configRepository.getEnv().agent;
if (!runnerUrl) {
  throw new BadRequestException('Agent runner is not configured');
}
if (!mcpGatewayUrl) {
  throw new BadRequestException('Agent MCP gateway is not configured');
}

const mcpGateway = {
  url: buildMcpSessionUrl(mcpGatewayUrl, body.gallerySessionId),
  token: this.toolTokenService.create({
    sessionId: body.gallerySessionId,
    userId,
    expiresAt: body.permissionPlan.limits.expiresInMinutes
      ? new Date(Date.now() + body.permissionPlan.limits.expiresInMinutes * 60_000)
      : new Date(Date.now() + 2 * 60 * 60_000),
  }),
};
```

Leave the runner request body as:

```ts
      body: { ...body, mcpGateway },
```

In `getStatus()`, require both `runnerUrl` and `mcpGatewayUrl` before probing the runner:

```ts
const { runnerUrl, runnerHealthTimeoutMs, mcpGatewayUrl } = this.configRepository.getEnv().agent;
if (!runnerUrl || !mcpGatewayUrl) {
  return this.notConfigured();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
pnpm --dir server test agent-runner.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/agent-runner.service.ts server/src/services/agent-runner.service.spec.ts
git commit -m "$(cat <<'EOF'
feat: require mcp gateway for agent runner sessions
EOF
)"
```

## Task 3: Add Static Deployment Drift Tests

**Files:**

- Create: `server/src/utils/agent-deployment-config.spec.ts`
- Modify later in this plan: `docker/docker-compose.yml`
- Modify later in this plan: `docker/docker-compose.prod.yml`
- Modify later in this plan: `docker/docker-compose.dev.yml`
- Modify later in this plan: `docker/docker-compose.rootless.yml`
- Modify later in this plan: `e2e/docker-compose.yml`
- Modify later in this plan: `docker/example.env`
- Modify later in this plan: `docs/docs/partials/_docker-compose-install-steps.mdx`
- Modify later in this plan: `server/Dockerfile`

- [ ] **Step 1: Write the failing static tests**

Create `server/src/utils/agent-deployment-config.spec.ts`:

```ts
import { load } from 'js-yaml';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type ComposeService = {
  command?: string | string[];
  environment?: Record<string, unknown> | string[];
  ports?: unknown[];
  depends_on?: unknown;
  image?: string;
  build?: unknown;
};

type ComposeFile = {
  services: Record<string, ComposeService>;
};

const repoRoot = join(process.cwd(), '..');
const readRepo = (path: string) => readFileSync(join(repoRoot, path), 'utf8');
const parseCompose = (path: string) => load(readRepo(path)) as ComposeFile;

const envObject = (service: ComposeService): Record<string, unknown> => {
  if (!service.environment) {
    return {};
  }
  if (Array.isArray(service.environment)) {
    return Object.fromEntries(
      service.environment.map((entry) => {
        const [key, ...value] = entry.split('=');
        return [key, value.join('=')];
      }),
    );
  }
  return service.environment;
};

const textFiles = [
  'docker/docker-compose.yml',
  'docker/docker-compose.prod.yml',
  'docker/docker-compose.dev.yml',
  'docker/docker-compose.rootless.yml',
  'e2e/docker-compose.yml',
  'docker/example.env',
  'docs/docs/partials/_docker-compose-install-steps.mdx',
  'server/Dockerfile',
];

describe('agent runner deployment config', () => {
  it('does not reference the retired tool gateway env name', () => {
    for (const path of textFiles) {
      expect(readRepo(path), path).not.toContain('IMMICH_AGENT_TOOL_GATEWAY_URL');
    }
  });

  it('documents self-hosted MCP runner env values in example.env', () => {
    const exampleEnv = readRepo('docker/example.env');

    expect(exampleEnv).toContain('IMMICH_AGENT_RUNNER_URL=http://agent-runner:4477');
    expect(exampleEnv).toContain('IMMICH_AGENT_MCP_GATEWAY_URL=http://immich-server:2283/api/agent/internal/mcp');
    expect(exampleEnv).toContain('IMMICH_AGENT_SECRET_KEY=');
    expect(exampleEnv).not.toContain('dev-agent-secret-key-change-me');
  });

  it('the Docker Compose install flow generates the agent secret once', () => {
    const installSteps = readRepo('docs/docs/partials/_docker-compose-install-steps.mdx');

    expect(installSteps).toContain('openssl rand -base64 32');
    expect(installSteps).toContain('IMMICH_AGENT_SECRET_KEY=');
    expect(installSteps).toContain('grep -q');
  });

  it.each([
    ['docker/docker-compose.dev.yml', 'immich-server'],
    ['e2e/docker-compose.yml', 'immich-server'],
  ])('%s configures the server with an MCP gateway env', (path, serviceName) => {
    const compose = parseCompose(path);
    const env = envObject(compose.services[serviceName]);

    expect(env.IMMICH_AGENT_RUNNER_URL).toBe('http://agent-runner:4477');
    expect(env.IMMICH_AGENT_MCP_GATEWAY_URL).toMatch(/\/api\/agent\/internal\/mcp$/);
    expect(env).not.toHaveProperty('IMMICH_AGENT_TOOL_GATEWAY_URL');
  });

  it.each([
    ['docker/docker-compose.yml'],
    ['docker/docker-compose.prod.yml'],
    ['docker/docker-compose.dev.yml'],
    ['docker/docker-compose.rootless.yml'],
    ['e2e/docker-compose.yml'],
  ])('%s runs agent-runner without publishing its port or receiving tenant secrets', (path) => {
    const compose = parseCompose(path);
    const service = compose.services['agent-runner'];
    expect(service, `${path} missing agent-runner service`).toBeDefined();
    expect(service.ports ?? []).toEqual([]);

    const env = envObject(service);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.PORT).toBe(4477);
    expect(env).not.toHaveProperty('IMMICH_AGENT_SECRET_KEY');
    expect(Object.keys(env).filter((key) => key.startsWith('DB_'))).toEqual([]);
    expect(Object.keys(env).filter((key) => key.startsWith('REDIS_'))).toEqual([]);
    expect(Object.keys(env).filter((key) => key.startsWith('IMMICH_S3_'))).toEqual([]);
  });

  it('rootless compose uses the Gallery server image for both server and bundled runner', () => {
    const compose = parseCompose('docker/docker-compose.rootless.yml');

    expect(compose.services['immich-server'].image).toBe(
      'ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}',
    );
    expect(compose.services['agent-runner'].image).toBe(compose.services['immich-server'].image);
  });

  it('production Dockerfile packages a stable agent-runner command in the final image', () => {
    const dockerfile = readRepo('server/Dockerfile');

    expect(dockerfile).toContain('FROM builder AS agent-runner');
    expect(dockerfile).toContain('COPY ./agent-runner ./agent-runner/');
    expect(dockerfile).toContain('pnpm --filter @open-noodle/agent-runner');
    expect(dockerfile).toContain('/output/agent-runner-pruned');
    expect(dockerfile).toContain('COPY --from=agent-runner /output/agent-runner-pruned ./agent-runner');
    expect(dockerfile).toContain('server/bin/agent-runner');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
pnpm --dir server test agent-deployment-config.spec.ts
```

Expected: FAIL because compose files still reference the old env, `docker/docker-compose.yml` has no `agent-runner` service, dev/e2e publish port `4477`, and `server/Dockerfile` does not package the runner.

- [ ] **Step 3: Commit the failing test if working in strict red-green history**

Only commit this red test if the team wants visible red commits. Otherwise keep it staged with Task 4 and Task 5 implementation.

```bash
git add server/src/utils/agent-deployment-config.spec.ts
git commit -m "$(cat <<'EOF'
test: cover agent runner deployment config
EOF
)"
```

## Task 4: Update Compose And Env Examples

**Files:**

- Modify: `docker/docker-compose.yml`
- Modify: `docker/docker-compose.prod.yml`
- Modify: `docker/docker-compose.dev.yml`
- Modify: `docker/docker-compose.rootless.yml`
- Modify: `e2e/docker-compose.yml`
- Modify: `docker/example.env`
- Modify: `docs/docs/partials/_docker-compose-install-steps.mdx`

- [ ] **Step 1: Implement self-hosted compose service**

In `docker/docker-compose.yml`, add `agent-runner` to `immich-server.depends_on`:

```yaml
depends_on:
  - redis
  - database
  - agent-runner
```

Add this service next to `immich-server`:

```yaml
agent-runner:
  container_name: gallery_agent_runner
  image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}
  command: ['agent-runner']
  environment:
    HOST: 0.0.0.0
    PORT: 4477
  restart: always
```

Do not add a `ports:` block to the runner service.

- [ ] **Step 2: Implement source-prod compose service**

In `docker/docker-compose.prod.yml`, add `agent-runner` to `immich-server.depends_on`:

```yaml
depends_on:
  - redis
  - database
  - agent-runner
```

Add this service:

```yaml
agent-runner:
  container_name: gallery_agent_runner
  image: immich-server:latest
  build:
    context: ../
    dockerfile: server/Dockerfile
  command: ['agent-runner']
  environment:
    HOST: 0.0.0.0
    PORT: 4477
  restart: always
```

- [ ] **Step 3: Implement rootless compose service**

In `docker/docker-compose.rootless.yml`, first replace the upstream server image:

```yaml
image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}
```

Then add `agent-runner` to `immich-server.depends_on`:

```yaml
depends_on:
  - redis
  - database
  - agent-runner
```

Add this service:

```yaml
agent-runner:
  container_name: gallery_agent_runner
  image: ghcr.io/open-noodle/gallery-server:${IMMICH_VERSION:-release}
  command: ['agent-runner']
  user: '1000:1000'
  security_opt:
    - no-new-privileges:true
  cap_drop:
    - NET_RAW
  environment:
    HOST: 0.0.0.0
    PORT: 4477
  restart: always
```

- [ ] **Step 4: Rename dev and e2e server env and remove runner published ports**

In `docker/docker-compose.dev.yml`, replace:

```yaml
IMMICH_AGENT_TOOL_GATEWAY_URL: http://immich-server:2283/api/agent/internal/tools
```

with:

```yaml
IMMICH_AGENT_MCP_GATEWAY_URL: http://immich-server:2283/api/agent/internal/mcp
```

Remove this block from the `agent-runner` service:

```yaml
ports:
  - 4477:4477
```

In `e2e/docker-compose.yml`, replace:

```yaml
IMMICH_AGENT_TOOL_GATEWAY_URL: http://immich-server:2285/api/agent/internal/mcp
```

with:

```yaml
IMMICH_AGENT_MCP_GATEWAY_URL: http://immich-server:2285/api/agent/internal/mcp
```

Remove this block from the `agent-runner` service:

```yaml
ports:
  - 4477:4477
```

- [ ] **Step 5: Add self-hosted env examples**

In `docker/example.env`, add this block below `DB_PASSWORD=postgres` and above "The values below this line do not need to be changed":

```dotenv
# Agent assistant configuration.
# Generate a stable secret once and keep it unchanged across restarts.
# Example: openssl rand -base64 32
IMMICH_AGENT_SECRET_KEY=
IMMICH_AGENT_RUNNER_URL=http://agent-runner:4477
IMMICH_AGENT_MCP_GATEWAY_URL=http://immich-server:2283/api/agent/internal/mcp
```

- [ ] **Step 6: Update install flow to generate the stable secret**

In `docs/docs/partials/_docker-compose-install-steps.mdx`, add this command block immediately after the `.env` download command:

````md
```bash title="Generate the agent assistant secret"
if grep -q '^IMMICH_AGENT_SECRET_KEY=$' .env; then
  AGENT_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
  sed -i.bak "s|^IMMICH_AGENT_SECRET_KEY=$|IMMICH_AGENT_SECRET_KEY=${AGENT_SECRET}|" .env
  rm -f .env.bak
fi
```
````

Add this bullet to Step 2:

```md
- Keep `IMMICH_AGENT_SECRET_KEY` unchanged after the first install. Gallery uses it for assistant provider credential encryption and session-scoped MCP runner tokens.
```

- [ ] **Step 7: Run static tests to verify compose/env changes**

Run:

```bash
pnpm --dir server test agent-deployment-config.spec.ts
```

Expected: still FAIL on the Dockerfile packaging assertions only.

- [ ] **Step 8: Commit**

```bash
git add docker/docker-compose.yml docker/docker-compose.prod.yml docker/docker-compose.dev.yml docker/docker-compose.rootless.yml e2e/docker-compose.yml docker/example.env docs/docs/partials/_docker-compose-install-steps.mdx server/src/utils/agent-deployment-config.spec.ts
git commit -m "$(cat <<'EOF'
feat: wire compose to internal mcp agent runner
EOF
)"
```

## Task 5: Package Agent Runner In The Production Image

**Files:**

- Modify: `server/Dockerfile`
- Existing test: `server/src/utils/agent-deployment-config.spec.ts`

- [ ] **Step 1: Add the agent-runner Docker build stage**

In `server/Dockerfile`, after the `cli` stage and before the `plugins` stage, add:

```dockerfile
FROM builder AS agent-runner

WORKDIR /usr/src/app
COPY ./agent-runner ./agent-runner/
RUN --mount=type=cache,id=pnpm-agent-runner,target=/buildcache/pnpm-store \
  --mount=type=bind,source=package.json,target=package.json \
  --mount=type=bind,source=.pnpmfile.cjs,target=.pnpmfile.cjs \
  --mount=type=bind,source=pnpm-lock.yaml,target=pnpm-lock.yaml \
  --mount=type=bind,source=pnpm-workspace.yaml,target=pnpm-workspace.yaml \
  --mount=type=bind,source=patches,target=patches \
  pnpm --filter @open-noodle/agent-runner --frozen-lockfile --prod --no-optional deploy /output/agent-runner-pruned
```

- [ ] **Step 2: Copy the runner and add a command wrapper**

In the final production image stage, after the CLI copy, add:

```dockerfile
COPY --from=agent-runner /output/agent-runner-pruned ./agent-runner
```

Replace:

```dockerfile
RUN ln -s ../../cli/bin/immich server/bin/immich
```

with:

```dockerfile
RUN ln -s ../../cli/bin/immich server/bin/immich && \
  printf '%s\n' '#!/usr/bin/env bash' 'cd /usr/src/app/agent-runner' 'exec node src/server.mjs "$@"' > server/bin/agent-runner && \
  chmod +x server/bin/agent-runner
```

The existing `ENV PATH="${PATH}:/usr/src/app/server/bin"` then makes `agent-runner` available to Compose.

- [ ] **Step 3: Run static tests**

Run:

```bash
pnpm --dir server test agent-deployment-config.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run a practical Dockerfile build check**

Run:

```bash
docker build --target agent-runner -f server/Dockerfile .
```

Expected: PASS. If local Docker is unavailable, record the Docker daemon error in the implementation notes and rely on the static test plus CI image build.

- [ ] **Step 5: Commit**

```bash
git add server/Dockerfile server/src/utils/agent-deployment-config.spec.ts
git commit -m "$(cat <<'EOF'
feat: package agent runner in server image
EOF
)"
```

## Task 6: Add open-noodle Stable Secret And Shared Runner Manifest Support

**Repo:** `/home/pierre/dev/open-noodle`

**Files:**

- Modify: `apps/dashboard/app/db/schema.ts`
- Create: `apps/dashboard/drizzle/0009_gallery_agent_secret_key.sql`
- Modify: `apps/dashboard/app/lib/provisioning/templates.ts`
- Modify: `apps/dashboard/app/lib/provisioning/__tests__/templates.test.ts`
- Modify: `apps/dashboard/app/lib/provisioning/provision.server.ts`
- Modify: `apps/dashboard/app/lib/provisioning/__tests__/provision.test.ts`

- [ ] **Step 1: Create a worktree or branch for open-noodle**

Run from `/home/pierre/dev/open-noodle`:

```bash
git checkout -b pi-agent-mcp-slice-6-provisioning
```

Expected: branch created from current `main`.

- [ ] **Step 2: Write failing template tests**

In `apps/dashboard/app/lib/provisioning/__tests__/templates.test.ts`, add tests under `describe("galleryApplicationYaml", ...)`:

```ts
it('renders agent MCP env using a tenant callback URL and secret reference', () => {
  const yaml = galleryApplicationYaml('abc123', 'eu-west-par', '0.9.3', 'release', true, {
    runnerUrl: 'http://gallery-agent-runner.shared-infra.svc.cluster.local:4477',
    mcpGatewayUrl: 'http://gallery-server.user-abc123.svc.cluster.local:2283/api/agent/internal/mcp',
  });

  expect(yaml).toContain('IMMICH_AGENT_RUNNER_URL: http://gallery-agent-runner.shared-infra.svc.cluster.local:4477');
  expect(yaml).toContain(
    'IMMICH_AGENT_MCP_GATEWAY_URL: http://gallery-server.user-abc123.svc.cluster.local:2283/api/agent/internal/mcp',
  );
  expect(yaml).toContain('IMMICH_AGENT_SECRET_KEY:');
  expect(yaml).toContain('name: gallery-agent');
  expect(yaml).toContain('key: IMMICH_AGENT_SECRET_KEY');
  expect(yaml).not.toContain('IMMICH_AGENT_TOOL_GATEWAY_URL');
  expect(yaml).not.toContain('agent-secret-key-change-me');
});
```

Add tests under `describe("elasticGalleryManifests", ...)`:

```ts
it('renders agent env only on gallery-serve and never on gallery-compute', () => {
  const manifests = elasticGalleryManifests('abc123', 'eu-west-par', '0.9.3', 'release', {
    runnerUrl: 'http://gallery-agent-runner.shared-infra.svc.cluster.local:4477',
    mcpGatewayUrl: 'http://gallery-server.user-abc123.svc.cluster.local:2283/api/agent/internal/mcp',
  });

  expect(manifests.galleryServeDeployment).toContain('IMMICH_AGENT_RUNNER_URL');
  expect(manifests.galleryServeDeployment).toContain('IMMICH_AGENT_MCP_GATEWAY_URL');
  expect(manifests.galleryServeDeployment).toContain('name: gallery-agent');
  expect(manifests.galleryApplication).not.toContain('IMMICH_AGENT_RUNNER_URL');
  expect(manifests.galleryApplication).not.toContain('IMMICH_AGENT_MCP_GATEWAY_URL');
  expect(manifests.galleryApplication).not.toContain('IMMICH_AGENT_SECRET_KEY');
  expect(manifests.galleryComputeDeployment).not.toContain('IMMICH_AGENT_RUNNER_URL');
  expect(manifests.galleryComputeDeployment).not.toContain('IMMICH_AGENT_MCP_GATEWAY_URL');
  expect(manifests.galleryComputeDeployment).not.toContain('IMMICH_AGENT_SECRET_KEY');
});
```

- [ ] **Step 3: Run template tests to verify they fail**

Run from `/home/pierre/dev/open-noodle`:

```bash
npm --workspace dashboard test -- app/lib/provisioning/__tests__/templates.test.ts
```

Expected: FAIL because template functions do not accept agent config and do not render agent env.

- [ ] **Step 4: Implement template support**

In `apps/dashboard/app/lib/provisioning/templates.ts`, add:

```ts
export type GalleryAgentConfig = {
  runnerUrl: string;
  mcpGatewayUrl: string;
};

export function defaultGalleryAgentConfig(uid: string): GalleryAgentConfig {
  return {
    runnerUrl:
      process.env.GALLERY_AGENT_RUNNER_URL ?? 'http://gallery-agent-runner.shared-infra.svc.cluster.local:4477',
    mcpGatewayUrl: `http://gallery-server.user-${uid}.svc.cluster.local:2283/api/agent/internal/mcp`,
  };
}

function galleryAgentEnvYaml(config: GalleryAgentConfig, indent: string): string {
  return `${indent}IMMICH_AGENT_SECRET_KEY:
${indent}  valueFrom:
${indent}    secretKeyRef:
${indent}      name: gallery-agent
${indent}      key: IMMICH_AGENT_SECRET_KEY
${indent}IMMICH_AGENT_RUNNER_URL: ${config.runnerUrl}
${indent}IMMICH_AGENT_MCP_GATEWAY_URL: ${config.mcpGatewayUrl}
`;
}
```

Change `galleryApplicationYaml` signature to:

```ts
export function galleryApplicationYaml(
  uid: string,
  s3Region: string,
  chartVersion: string = DEFAULT_GALLERY_CHART_VERSION,
  galleryImageTag: string = DEFAULT_GALLERY_IMAGE_TAG,
  serverEnabled = true,
  agentConfig: GalleryAgentConfig = defaultGalleryAgentConfig(uid),
): string {
```

Inside `galleryApplicationYaml`, add this under the Helm `env:` block after `IMMICH_S3_SERVE_MODE: redirect`:

```ts
${serverEnabled ? galleryAgentEnvYaml(agentConfig, "          ") : ""}
```

Change `galleryEnvYaml` signature to:

```ts
function galleryEnvYaml(
  s3Region: string,
  workerInclude: "api" | "microservices",
  agentConfig?: GalleryAgentConfig,
): string {
```

Append agent env only for API workers:

```ts
${workerInclude === "api" && agentConfig ? `          - name: IMMICH_AGENT_SECRET_KEY
            valueFrom:
              secretKeyRef:
                name: gallery-agent
                key: IMMICH_AGENT_SECRET_KEY
          - name: IMMICH_AGENT_RUNNER_URL
            value: ${agentConfig.runnerUrl}
          - name: IMMICH_AGENT_MCP_GATEWAY_URL
            value: ${agentConfig.mcpGatewayUrl}
` : ""}`;
```

Change `galleryServeDeploymentYaml` signature to include `agentConfig`:

```ts
export function galleryServeDeploymentYaml(
  uid: string,
  s3Region: string,
  galleryImageTag: string = DEFAULT_GALLERY_IMAGE_TAG,
  agentConfig: GalleryAgentConfig = defaultGalleryAgentConfig(uid),
): string {
```

Call:

```ts
${galleryEnvYaml(s3Region, "api", agentConfig)}
```

Change `elasticGalleryManifests` signature to include `agentConfig` and pass it to `galleryApplicationYaml` and `galleryServeDeploymentYaml`:

```ts
export function elasticGalleryManifests(
  uid: string,
  s3Region: string,
  chartVersion: string = DEFAULT_GALLERY_CHART_VERSION,
  galleryImageTag: string = DEFAULT_GALLERY_IMAGE_TAG,
  agentConfig: GalleryAgentConfig = defaultGalleryAgentConfig(uid),
): ElasticGalleryManifests {
```

- [ ] **Step 5: Add durable key schema and migration**

In `apps/dashboard/app/db/schema.ts`, add the column near `galleryAdminApiKey`:

```ts
  galleryAgentSecretKey: text("gallery_agent_secret_key"),
```

Create `apps/dashboard/drizzle/0009_gallery_agent_secret_key.sql`:

```sql
ALTER TABLE "subscriptions" ADD COLUMN "gallery_agent_secret_key" text;
```

Run the dashboard's drizzle snapshot generation command if the repo uses generated snapshots in CI:

```bash
npm --workspace dashboard run db:generate
```

Expected: generated metadata reflects `gallery_agent_secret_key`.

- [ ] **Step 6: Write failing provisioning tests**

In `apps/dashboard/app/lib/provisioning/__tests__/provision.test.ts`, update the schema mock:

```ts
  subscriptions: {
    id: "id",
    uid: "uid",
    status: "status",
    subdomain: "subdomain",
    provisioningLockedUntil: "provisioning_locked_until",
    galleryAgentSecretKey: "gallery_agent_secret_key",
  },
```

Update `subscription()` to include:

```ts
    galleryAgentSecretKey: null,
```

Add these tests near the existing manifest tests:

```ts
it('persists a stable Gallery agent secret before applying tenant manifests', async () => {
  mockRunStep.mockImplementation(executeProvisioningSteps);
  selectRows = [
    subscription({
      galleryAgentSecretKey: null,
      s3AccessKeyId: 'access',
      s3SecretAccessKey: 'secret',
    }),
  ];
  const { resumeProvisioning } = await import('../provision.server');

  await resumeProvisioning('sub-1');

  const generatedSecretUpdate = updateSetCalls.find(
    (values) => typeof values === 'object' && values !== null && 'galleryAgentSecretKey' in values,
  ) as { galleryAgentSecretKey: string } | undefined;
  expect(generatedSecretUpdate?.galleryAgentSecretKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(mockApplySecret).toHaveBeenCalledWith('user-uid123', 'gallery-agent', {
    IMMICH_AGENT_SECRET_KEY: generatedSecretUpdate?.galleryAgentSecretKey,
  });
});

it('reuses an existing Gallery agent secret across provisioning retries', async () => {
  mockRunStep.mockImplementation(executeProvisioningSteps);
  selectRows = [
    subscription({
      galleryAgentSecretKey: 'stable-agent-secret',
      s3AccessKeyId: 'access',
      s3SecretAccessKey: 'secret',
    }),
  ];
  const { resumeProvisioning } = await import('../provision.server');

  await resumeProvisioning('sub-1');

  expect(updateSetCalls).not.toContainEqual(expect.objectContaining({ galleryAgentSecretKey: expect.any(String) }));
  expect(mockApplySecret).toHaveBeenCalledWith('user-uid123', 'gallery-agent', {
    IMMICH_AGENT_SECRET_KEY: 'stable-agent-secret',
  });
});

it('commits manifests with shared-runner URL and tenant MCP callback URL', async () => {
  vi.stubEnv('GALLERY_AGENT_RUNNER_URL', 'http://shared-agent-runner.shared-infra.svc.cluster.local:4477');
  mockRunStep.mockImplementation(executeProvisioningSteps);
  selectRows = [
    subscription({
      galleryAgentSecretKey: 'stable-agent-secret',
      s3AccessKeyId: 'access',
      s3SecretAccessKey: 'secret',
    }),
  ];
  const { resumeProvisioning } = await import('../provision.server');

  await resumeProvisioning('sub-1');

  const manifests = mockCommitUserManifests.mock.calls[0][1];
  expect(manifests.galleryApplication).toContain(
    'IMMICH_AGENT_RUNNER_URL: http://shared-agent-runner.shared-infra.svc.cluster.local:4477',
  );
  expect(manifests.galleryApplication).toContain(
    'IMMICH_AGENT_MCP_GATEWAY_URL: http://gallery-server.user-uid123.svc.cluster.local:2283/api/agent/internal/mcp',
  );
  expect(manifests.galleryApplication).not.toContain('stable-agent-secret');
});
```

- [ ] **Step 7: Run provisioning tests to verify they fail**

Run:

```bash
npm --workspace dashboard test -- app/lib/provisioning/__tests__/provision.test.ts
```

Expected: FAIL because no secret is generated/applied and manifests do not include agent env.

- [ ] **Step 8: Implement stable secret provisioning**

In `apps/dashboard/app/lib/provisioning/provision.server.ts`, add imports:

```ts
import { defaultGalleryAgentConfig } from './templates';
```

Add helper functions near `ensureUid`:

```ts
function generateGalleryAgentSecretKey(): string {
  return randomBytes(32).toString('base64url');
}

async function ensureGalleryAgentSecretKey(subscriptionId: string, existingSecret: string | null): Promise<string> {
  if (existingSecret) return existingSecret;
  const secret = generateGalleryAgentSecretKey();
  await db
    .update(subscriptions)
    .set({ galleryAgentSecretKey: secret, updatedAt: new Date() })
    .where(eq(subscriptions.id, subscriptionId));
  return secret;
}
```

After `const ns = \`user-${uid}\`;`, load or create the secret:

```ts
const agentSecretKey = await ensureGalleryAgentSecretKey(subscriptionId, refreshed.galleryAgentSecretKey);
const galleryAgentConfig = defaultGalleryAgentConfig(uid);
```

In the `k8s_secrets` step, after applying `s3-credentials`, apply the agent secret:

```ts
await withProvisioningTimeout('apply Gallery agent secret', EXTERNAL_CALL_TIMEOUT_MS, () =>
  applySecret(ns, 'gallery-agent', {
    IMMICH_AGENT_SECRET_KEY: agentSecretKey,
  }),
);
```

In the `gitops_manifests` step, pass `galleryAgentConfig`:

```ts
const galleryManifests = ELASTIC_GALLERY_COMPUTE_ENABLED
  ? elasticGalleryManifests(uid, s3Region, undefined, undefined, galleryAgentConfig)
  : { galleryApplication: galleryApplicationYaml(uid, s3Region, undefined, undefined, true, galleryAgentConfig) };
```

- [ ] **Step 9: Run open-noodle focused tests**

Run:

```bash
npm --workspace dashboard test -- app/lib/provisioning/__tests__/templates.test.ts app/lib/provisioning/__tests__/provision.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit open-noodle changes**

```bash
git add apps/dashboard/app/db/schema.ts apps/dashboard/drizzle/0009_gallery_agent_secret_key.sql apps/dashboard/app/lib/provisioning/templates.ts apps/dashboard/app/lib/provisioning/__tests__/templates.test.ts apps/dashboard/app/lib/provisioning/provision.server.ts apps/dashboard/app/lib/provisioning/__tests__/provision.test.ts
git commit -m "$(cat <<'EOF'
feat: provision stable gallery agent secrets
EOF
)"
```

## Task 7: Documentation And Stale Reference Sweep

**Files:**

- Modify: `docs/docs/install/environment-variables.md`
- Existing: `server/src/utils/agent-deployment-config.spec.ts`
- Existing: Slice 6 changed files

- [ ] **Step 1: Update installation env docs**

In `docs/docs/install/environment-variables.md`, add a section after the worker env table:

```md
## Agent Assistant

| Variable                       | Description                                                                                                                                                                                                                     | Default | Services | Workers |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------ | :------- | :------ |
| `IMMICH_AGENT_SECRET_KEY`      | Stable secret used by Gallery to encrypt assistant provider credentials and sign session-scoped MCP runner tokens. Generate once and keep unchanged across restarts.                                                            |         | server   | api     |
| `IMMICH_AGENT_RUNNER_URL`      | Internal HTTP URL of the first-party agent runner. In Docker Compose this is `http://agent-runner:4477`.                                                                                                                        |         | server   | api     |
| `IMMICH_AGENT_MCP_GATEWAY_URL` | Internal HTTP base URL the runner uses to call back into Gallery's MCP endpoint. In Docker Compose this is `http://immich-server:2283/api/agent/internal/mcp`. Gallery appends `/sessions/<sessionId>` for each runner session. |         | server   | api     |

`IMMICH_AGENT_TOOL_GATEWAY_URL` is retired. Use `IMMICH_AGENT_MCP_GATEWAY_URL`.
Do not pass `IMMICH_AGENT_SECRET_KEY`, database credentials, Redis credentials, or S3 credentials to the `agent-runner` service.
```

- [ ] **Step 2: Run stale reference checks**

Run from the Gallery repo:

```bash
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL|toolGatewayUrl" docker e2e docs/docs docker/example.env
```

Expected: no output.

Run:

```bash
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL|toolGatewayUrl" server/src
```

Expected: only `server/src/dtos/env.dto.ts` and `server/src/repositories/config.repository.spec.ts` reference `IMMICH_AGENT_TOOL_GATEWAY_URL`, solely to reject and test the retired env name. No `toolGatewayUrl` output remains.

Run:

```bash
rg -n "/api/agent/internal/tools" server/src docker e2e docs/docs docker/example.env
```

Expected: no output.

Run:

```bash
rg -n "toolGateway" agent-runner/src server/src
```

Expected: only runner request-body rejection remains in `agent-runner/src/server.mjs` and its server test, unless Slice 7 removes that guard later.

- [ ] **Step 3: Run Gallery regression commands**

Run:

```bash
pnpm --dir server test config.repository.spec.ts agent-runner.service.spec.ts agent-deployment-config.spec.ts
pnpm --dir server exec eslint src/dtos/env.dto.ts src/repositories/config.repository.ts src/repositories/config.repository.spec.ts src/services/agent-runner.service.ts src/services/agent-runner.service.spec.ts src/utils/agent-deployment-config.spec.ts --max-warnings 0
pnpm --dir agent-runner test
git diff --check
```

Expected: PASS for every command.

- [ ] **Step 4: Run open-noodle regression commands**

Run from `/home/pierre/dev/open-noodle`:

```bash
npm --workspace dashboard test -- app/lib/provisioning/__tests__/templates.test.ts app/lib/provisioning/__tests__/provision.test.ts
git diff --check
```

Expected: PASS for every command.

- [ ] **Step 5: Commit Gallery docs and sweep**

```bash
git add docs/docs/install/environment-variables.md
git commit -m "$(cat <<'EOF'
docs: document mcp agent runner deployment
EOF
)"
```

## Task 8: Final Verification And Handoff

**Files:**

- Verify all Gallery and open-noodle files touched by Slice 6.

- [ ] **Step 1: Run final Gallery verification**

Run from the Gallery repo:

```bash
pnpm --dir server test config.repository.spec.ts agent-runner.service.spec.ts agent-deployment-config.spec.ts agent-runner.repository.spec.ts agent-session.service.spec.ts agent-runner.controller.spec.ts
pnpm --dir server exec eslint src/dtos/env.dto.ts src/repositories/config.repository.ts src/repositories/config.repository.spec.ts src/services/agent-runner.service.ts src/services/agent-runner.service.spec.ts src/utils/agent-deployment-config.spec.ts --max-warnings 0
pnpm --dir agent-runner test
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL|toolGatewayUrl" docker e2e docs/docs docker/example.env
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL|toolGatewayUrl" server/src
rg -n "/api/agent/internal/tools" server/src docker e2e docs/docs docker/example.env
rg -n "toolGateway" agent-runner/src server/src
git diff --check
git status --short --branch
```

Expected:

- focused server tests pass;
- eslint exits 0;
- agent-runner tests pass;
- first `rg` command produces no output;
- second `rg` command only reports `server/src/dtos/env.dto.ts` and `server/src/repositories/config.repository.spec.ts` for old env rejection, and no `toolGatewayUrl`;
- third `rg` command produces no output;
- fourth `rg` command only reports the runner protocol legacy rejection if still intentionally retained;
- `git diff --check` exits 0;
- status shows only intentional Slice 6 files before commit, then clean after commit.

- [ ] **Step 2: Run final open-noodle verification**

Run from `/home/pierre/dev/open-noodle`:

```bash
npm --workspace dashboard test -- app/lib/provisioning/__tests__/templates.test.ts app/lib/provisioning/__tests__/provision.test.ts
rg -n "IMMICH_AGENT_TOOL_GATEWAY_URL|agent-secret-key-change-me" apps/dashboard/app/lib/provisioning apps/dashboard/drizzle
git diff --check
git status --short --branch
```

Expected:

- focused open-noodle tests pass;
- `rg` produces no output;
- `git diff --check` exits 0;
- status shows only intentional Slice 6 files before commit, then clean after commit.

- [ ] **Step 3: Push branches**

Run from each repo after commits:

```bash
git push -u origin HEAD
```

Expected: both branches push without force.

## Implementation Notes

- `IMMICH_AGENT_SECRET_KEY` remains Gallery-local. It is required by the Gallery server, not the runner.
- A shared runner deployment only needs `HOST` and `PORT`; it receives per-session provider and MCP material in runner session requests.
- In self-hosted Docker Compose, reusing the server image for `agent-runner` avoids a second published artifact and proves the production image packaging path.
- In open-noodle, `GALLERY_AGENT_RUNNER_URL` should be the only provisioning setting needed to move from a future co-located runner to a shared-infra runner. The MCP gateway URL remains tenant-specific and points back to `gallery-server.user-<uid>.svc.cluster.local`.
- If Docker is unavailable locally, the Dockerfile static test and CI image build become the verification for packaging.
