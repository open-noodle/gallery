import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = join(process.cwd(), '..');

const repoPath = (path: string) => join(repoRoot, path);
const readRepo = (path: string) => readFileSync(repoPath(path), 'utf8');
const existsRepo = (path: string) => existsSync(repoPath(path));
const runnerSourceFiles = () =>
  readdirSync(repoPath('agent-runner/src'))
    .filter((path) => path.endsWith('.mjs'))
    .map((path) => `agent-runner/src/${path}`);

describe('legacy agent gateway removal', () => {
  it('does not keep retired first-party runner custom tool modules or imports', () => {
    expect(existsRepo('agent-runner/src/gallery-tools.mjs')).toBe(false);
    expect(existsRepo('agent-runner/src/gallery-tool-client.mjs')).toBe(false);

    for (const path of runnerSourceFiles()) {
      const source = readRepo(path);
      expect(source, path).not.toContain('gallery-tools');
      expect(source, path).not.toContain('gallery-tool-client');
      expect(source, path).not.toContain('galleryToolNames');
    }
  });

  it('does not keep the retired internal tools HTTP gateway controller wiring', () => {
    expect(existsRepo('server/src/controllers/agent-runner-tool.controller.ts')).toBe(false);
    expect(existsRepo('server/src/controllers/agent-runner-tool.controller.spec.ts')).toBe(false);

    expect(readRepo('server/src/controllers/index.ts')).not.toContain('AgentRunnerToolController');
    expect(readRepo('server/src/controllers/index.ts')).not.toContain('agent-runner-tool.controller');
    expect(readRepo('server/src/services/index.ts')).not.toContain('agent-runner-tool.controller');
    expect(readRepo('server/src/services/index.ts')).not.toContain('AgentRunnerToolGuard');
  });

  it('does not keep legacy toolGateway runner protocol plumbing', () => {
    expect(readRepo('agent-runner/src/server.mjs')).not.toContain('toolGateway');
    expect(readRepo('agent-runner/src/server.test.mjs')).not.toContain('toolGateway');
  });

  it('keeps runner capability examples MCP-shaped instead of direct Gallery custom tool names', () => {
    const serverTest = readRepo('agent-runner/src/server.test.mjs');

    expect(serverTest).not.toContain("tools: ['proposeAlbumOperations']");
    expect(serverTest).not.toContain("tools: ['searchAssets'");
    expect(serverTest).toContain("tools: ['mcp:gallery']");
  });
});
