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
const parseCompose = (path: string) => load(readRepo(path).replaceAll('!reset ', '')) as ComposeFile;

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

  it('dev compose runs the agent-runner with the package watch script', () => {
    const compose = parseCompose('docker/docker-compose.dev.yml');
    const packageJson = JSON.parse(readRepo('agent-runner/package.json')) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toBe('node --watch src/server.mjs');
    expect(compose.services['agent-runner'].command).toEqual(['exec pnpm --dir agent-runner dev']);
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
