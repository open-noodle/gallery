# Pi Agent MCP Tool Contracts Slice 5 Generated MCP Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and commit a human-readable Pi Agent MCP endpoint and tool guide from the server-owned MCP tool contract so docs stay in sync with runtime behavior.

**Architecture:** Add a small server-side docs renderer that consumes `AgentMcpToolContractService`, emits structured JSON-RPC/tool-argument examples, and renders `docs/superpowers/generated/pi-agent-mcp-tools.md`. Keep DTO schemas and runtime behavior unchanged; tests validate the generated Markdown, parse documented examples through the real Zod schemas, exercise JSON-RPC wrappers through `AgentMcpService`, and fail when the committed doc drifts.

**Tech Stack:** NestJS injectable services, TypeScript, Node `fs/promises` bin script, Zod DTO validation, Vitest unit tests, existing MCP service/registry/contract services.

---

## Scope

This slice implements only `Slice 5: Generated MCP Guide` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Generate `docs/superpowers/generated/pi-agent-mcp-tools.md` from `AgentMcpToolContractService`.
- Include high-level endpoint/auth guidance for `POST /agent/internal/mcp/sessions/{sessionId}` with placeholder auth only.
- Document JSON-RPC wrappers for:
  - `initialize`
  - `tools/list`
  - `tools/call`
- Document one example for every tool contract example and every major argument mode already defined by Slices 1-4.
- Document approval-required and approved retry flow.
- Document planning examples for create album and create-plus-add-assets.
- Document common mistakes and correction hints from the contract.
- State explicitly that no MCP apply/direct mutation tool exists and final writes happen through Gallery plan review UI.
- Add tests that parse all documented tool-argument examples through the matching DTO schemas.
- Add tests that documented JSON-RPC examples use `params.arguments`, not `input` or top-level arguments.
- Add tests that generated docs are committed and up to date.
- Add tests that generated docs do not leak real bearer tokens, provider secrets, filesystem paths, stack traces, or implementation details beyond the documented endpoint shape.

Out of scope:

- Runner prompt cheat sheet integration. That is Slice 6.
- Changing MCP runtime behavior or tool metadata.
- Changing DTO schemas.
- Public or third-party MCP support.
- Frontend assistant UI changes.
- New Gallery domain operations.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

Generation command:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
```

## File Structure

Create:

- `server/src/services/agent-mcp-docs.service.ts`
  - Pure renderer service for generated MCP docs.
  - Exposes structured documented examples so tests do not scrape every assertion from prose.
- `server/src/services/agent-mcp-docs.service.spec.ts`
  - TDD coverage for generated sections, examples, parser compatibility, drift detection, and safety.
- `server/src/bin/sync-agent-mcp-docs.ts`
  - Writes the generated Markdown file from the renderer.
- `docs/superpowers/generated/pi-agent-mcp-tools.md`
  - Generated guide committed to the repo.

Modify:

- `server/package.json`
  - Add `sync:agent-mcp-docs`.
- `server/src/services/agent-mcp.service.spec.ts`
  - Add integration coverage that JSON-RPC examples from the docs renderer go through `AgentMcpService.handle()`.

Do not modify:

- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp-tool-registry.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.ts`
- `agent-runner/src/pi-runtime.mjs`

## Slice 5 Edge Case Matrix

| Area              | Case                                                             | Expected Slice 5 Result                                                                                                                 |
| ----------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Drift             | Generated doc changes when contract changes                      | Drift test compares committed Markdown to renderer output and fails                                                                     |
| Tool coverage     | New contract tool exists                                         | Guide includes a section for every `listToolContracts()` entry                                                                          |
| Mode coverage     | Tool has multiple modes                                          | Guide includes every `argumentModes` entry and matching examples                                                                        |
| JSON-RPC wrapper  | `tools/call` example                                             | Uses `params.name` and `params.arguments`; never `input` or top-level arguments                                                         |
| Tool args         | Every documented tool-argument example and marked Markdown block | Parses through `AgentReadToolRequestSchemas` or `AgentOperationPlanToolRequestSchemas`                                                  |
| JSON-RPC handling | Initialize/list/call examples                                    | Pass through `AgentMcpService.handle()` with expected success or delegated service call                                                 |
| Approval flow     | Read approval retry                                              | Guide states stop after approval-required and retry with only `toolCallId` if resumed without result                                    |
| Planning          | Create album examples                                            | Guide includes create-empty-album and create-album-and-add-assets examples                                                              |
| Safety            | Direct apply                                                     | Guide states no apply tool exists; generated tool list has no apply/direct mutation tool                                                |
| Security          | Secrets/internal details                                         | Guide uses placeholders only and does not include real tokens, provider secrets, stack traces, filesystem paths, or undocumented routes |
| Prefix clarity    | Pi-visible vs MCP names                                          | Guide distinguishes bare MCP names from future Pi-visible `mcp_gallery_` names                                                          |
| Markdown          | JSON fences                                                      | All generated JSON fences parse as JSON and are stable/prettier-friendly                                                                |

---

### Task 1: Add Generated Docs Red Tests

**Files:**

- Create: `server/src/services/agent-mcp-docs.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Create the failing docs service spec**

Create `server/src/services/agent-mcp-docs.service.spec.ts` with these tests:

````ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AGENT_MCP_GENERATED_DOC_RELATIVE_PATH, AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const forbiddenGeneratedDocPattern =
  /bearer\s+[a-z0-9._-]{10,}|provider[- ]?key|stack trace|\/srv\/gallery|\/api\/agent\/internal|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum/i;

describe(AgentMcpDocsService.name, () => {
  let contractService: AgentMcpToolContractService;
  let sut: AgentMcpDocsService;

  beforeEach(() => {
    contractService = new AgentMcpToolContractService();
    sut = new AgentMcpDocsService(contractService);
  });

  it('generates the required MCP guide sections from the contract', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('# Pi Agent MCP Tools');
    expect(markdown).toContain('POST /agent/internal/mcp/sessions/{sessionId}');
    expect(markdown).toContain('Authorization: Bearer <agent-runner-token>');
    expect(markdown).toContain('## JSON-RPC Wrappers');
    expect(markdown).toContain('## Approval Flow');
    expect(markdown).toContain('## Tools');
    expect(markdown).toContain('## Common Mistakes');
    expect(markdown).toContain('No MCP apply tool is exposed');
  });

  it('includes every contract tool and every contract example', () => {
    const markdown = sut.generateMarkdown();

    for (const contract of contractService.listToolContracts()) {
      expect(markdown, contract.name).toContain(`### ${contract.title}`);
      expect(markdown, contract.name).toContain(`\`${contract.name}\``);
      for (const example of contract.examples) {
        expect(markdown, `${contract.name} ${example.name}`).toContain(`#### ${example.name}`);
      }
    }
  });

  it('documents every argument mode and common mistake from the contract', () => {
    const markdown = sut.generateMarkdown();

    for (const contract of contractService.listToolContracts()) {
      for (const mode of contract.argumentModes) {
        expect(markdown, `${contract.name} ${mode.name}`).toContain(`\`${mode.name}\``);
        expect(markdown, `${contract.name} ${mode.whenToUse}`).toContain(mode.whenToUse);
      }
      for (const mistake of contract.commonMistakes) {
        expect(markdown, `${contract.name} ${mistake.id}`).toContain(`\`${mistake.id}\``);
        expect(markdown, `${contract.name} ${mistake.hint}`).toContain(mistake.hint);
      }
    }
  });

  it('exposes structured documented examples that parse through the matching DTO schemas', () => {
    const examples = sut.listDocumentedToolArgumentExamples();

    expect(examples.length).toBeGreaterThan(contractService.listToolContracts().length);
    for (const example of examples) {
      const schema =
        example.toolName in AgentReadToolRequestSchemas
          ? AgentReadToolRequestSchemas[example.toolName as keyof typeof AgentReadToolRequestSchemas]
          : AgentOperationPlanToolRequestSchemas[example.toolName as keyof typeof AgentOperationPlanToolRequestSchemas];
      const result = schema.safeParse(example.arguments);

      expect(result.success, `${example.toolName} ${example.exampleName}`).toBe(true);
    }
  });

  it('parses every marked tool-argument JSON block from the generated Markdown through the referenced DTO schema', () => {
    const markdown = sut.generateMarkdown();
    const blocks = [
      ...markdown.matchAll(
        /<!-- mcp-docs:tool-arguments tool="([^"]+)" example="([^"]+)" -->\n```json\n([\s\S]*?)\n```/g,
      ),
    ];

    expect(blocks).toHaveLength(sut.listDocumentedToolArgumentExamples().length);
    for (const [, toolNameValue, exampleName, jsonText] of blocks) {
      expect(Object.values(AgentToolName)).toContain(toolNameValue as AgentToolName);
      const toolName = toolNameValue as AgentToolName;
      const schema =
        toolName in AgentReadToolRequestSchemas
          ? AgentReadToolRequestSchemas[toolName as keyof typeof AgentReadToolRequestSchemas]
          : AgentOperationPlanToolRequestSchemas[toolName as keyof typeof AgentOperationPlanToolRequestSchemas];
      const parsed = JSON.parse(jsonText);
      const result = schema.safeParse(parsed);

      expect(result.success, `${toolName} ${exampleName}`).toBe(true);
    }
  });

  it('exposes JSON-RPC examples with params.arguments for tools/call', () => {
    const examples = sut.listJsonRpcExamples();

    expect(examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['initialize', 'tools-list', 'tools-call-read', 'tools-call-plan']),
    );
    for (const example of examples.filter((candidate) => candidate.request.method === 'tools/call')) {
      const params = example.request.params as Record<string, unknown>;

      expect(example.request).toMatchObject({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name: expect.any(String),
          arguments: expect.any(Object),
        },
      });
      expect(example.request).not.toHaveProperty('input');
      expect(example.request).not.toHaveProperty('arguments');
      expect(params).not.toHaveProperty('input');
    }
  });

  it('renders parseable JSON code fences', () => {
    const markdown = sut.generateMarkdown();
    const blocks = [...markdown.matchAll(/```json\n([\s\S]*?)\n```/g)].map((match) => match[1]);

    expect(blocks.length).toBeGreaterThan(10);
    for (const block of blocks) {
      expect(() => JSON.parse(block)).not.toThrow();
    }
  });

  it('includes create album and create-plus-add-assets planning examples', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('create-empty-album');
    expect(markdown).toContain('create-album-and-add-assets');
    expect(markdown).toContain('temporaryTargetId');
  });

  it('distinguishes bare MCP tool names from Pi-visible prefixed names', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('Bare MCP tool names');
    expect(markdown).toContain('Pi-visible names may be shown with an `mcp_gallery_` prefix');
    expect(markdown).toContain('`searchAssets`');
    expect(markdown).toContain('`mcp_gallery_searchAssets`');
  });

  it('does not leak real secrets, stack traces, filesystem paths, or direct mutation tools', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).not.toMatch(forbiddenGeneratedDocPattern);
    expect(markdown).toContain('Bearer <agent-runner-token>');
  });

  it('keeps the committed generated guide in sync with the renderer', () => {
    const generatedPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
    const committed = readFileSync(generatedPath, 'utf8');

    expect(committed).toBe(sut.generateMarkdown());
  });
});
````

- [ ] **Step 2: Add failing runtime coverage for generated JSON-RPC examples**

At the top of `server/src/services/agent-mcp.service.spec.ts`, add:

```ts
import { AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
```

After the existing `returns enriched planning tool metadata through tools/list` test, add:

```ts
describe('generated docs JSON-RPC examples', () => {
  let docsService: AgentMcpDocsService;

  beforeEach(() => {
    docsService = new AgentMcpDocsService(contractService);
  });

  it.each(['initialize', 'tools-list'] as const)('handles the documented %s JSON-RPC example', async (name) => {
    const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === name)!;
    const response = await sut.handle(auth, sessionId, example.request);

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: example.request.id,
    });
  });

  it('handles the documented read tools/call JSON-RPC example without wrapper errors', async () => {
    const serviceResult = { status: 'success', toolCall: null, assets: [] };
    toolService.readAssetMetadata.mockResolvedValue(serviceResult as never);
    const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === 'tools-call-read')!;

    const response = (await sut.handle(auth, sessionId, example.request)) as AgentMcpSuccessResponse;

    expect(toolService.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, {
      assetIds: ['00000000-0000-4000-8000-000000000001'],
    });
    expectToolResult(response, 'read-1', serviceResult);
  });

  it('handles the documented planning tools/call JSON-RPC example without wrapper errors', async () => {
    const serviceResult = makePlanningServiceResult();
    operationPlanService.proposeAlbumOperations.mockResolvedValue(serviceResult as never);
    const example = docsService.listJsonRpcExamples().find((candidate) => candidate.name === 'tools-call-plan')!;

    const response = (await sut.handle(auth, sessionId, example.request)) as AgentMcpSuccessResponse;

    expect(operationPlanService.proposeAlbumOperations).toHaveBeenCalledWith(
      auth,
      sessionId,
      expect.objectContaining({
        summary: 'Create today test album.',
        operations: expect.any(Array),
      }),
    );
    expectToolResult(response, 'plan-1', serviceResult);
  });
});
```

- [ ] **Step 3: Run the docs and runtime specs and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because `AgentMcpDocsService` and the generated doc do not exist.

- [ ] **Step 4: Commit the red docs and runtime tests**

```bash
git add server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define generated mcp guide contract
EOF
)"
```

### Task 2: Implement The Docs Renderer

**Files:**

- Create: `server/src/services/agent-mcp-docs.service.ts`
- Test: `server/src/services/agent-mcp-docs.service.spec.ts`

- [ ] **Step 1: Add the docs renderer service**

Create `server/src/services/agent-mcp-docs.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import type { AgentMcpToolContract, AgentMcpToolExample } from 'src/types/agent-mcp-contract.types';

export const AGENT_MCP_GENERATED_DOC_RELATIVE_PATH = 'docs/superpowers/generated/pi-agent-mcp-tools.md';

type AgentMcpDocumentedToolArgumentExample = {
  toolName: AgentToolName;
  toolTitle: string;
  exampleName: string;
  description: string;
  arguments: Record<string, unknown>;
};

type AgentMcpJsonRpcExample = {
  name: string;
  description: string;
  request: Record<string, unknown>;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const markdownJson = (value: unknown): string => `\`\`\`json\n${json(value)}\`\`\``;

const sanitizeText = (value: string): string =>
  value
    .replaceAll(/bearer\s+[a-z0-9._-]+/gi, 'Bearer <redacted>')
    .replaceAll(/\/srv\/[^\s`)]*/gi, '<redacted-path>')
    .replaceAll(/provider[- ]?key/gi, 'provider credential')
    .replaceAll(/stack trace/gi, 'error details');

const toolArgumentsSchemaFor = (toolName: AgentToolName) =>
  Object.hasOwn(AgentReadToolRequestSchemas, toolName)
    ? AgentReadToolRequestSchemas[toolName as keyof typeof AgentReadToolRequestSchemas]
    : AgentOperationPlanToolRequestSchemas[toolName as keyof typeof AgentOperationPlanToolRequestSchemas];

@Injectable()
export class AgentMcpDocsService {
  constructor(private readonly contractService: AgentMcpToolContractService) {}

  listDocumentedToolArgumentExamples(): AgentMcpDocumentedToolArgumentExample[] {
    return this.contractService.listToolContracts().flatMap((contract) =>
      contract.examples.map((example) => ({
        toolName: contract.name,
        toolTitle: contract.title,
        exampleName: example.name,
        description: example.description,
        arguments: structuredClone(example.arguments),
      })),
    );
  }

  listJsonRpcExamples(): AgentMcpJsonRpcExample[] {
    const examples = this.listDocumentedToolArgumentExamples();
    const readExample = examples.find((example) => example.toolName === AgentToolName.ReadAssetMetadata);
    const planExample = examples.find((example) => example.toolName === AgentToolName.ProposeAlbumOperations);

    if (!readExample || !planExample) {
      throw new Error('Missing required MCP docs examples');
    }

    return [
      {
        name: 'initialize',
        description: 'Initialize the MCP session.',
        request: {
          jsonrpc: '2.0',
          id: 'init-1',
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'pi-agent-runner', version: '0.1.0' },
          },
        },
      },
      {
        name: 'tools-list',
        description: 'List available Gallery MCP tools.',
        request: { jsonrpc: '2.0', id: 'tools-1', method: 'tools/list' },
      },
      {
        name: 'tools-call-read',
        description: 'Call a read tool with params.arguments.',
        request: {
          jsonrpc: '2.0',
          id: 'read-1',
          method: 'tools/call',
          params: { name: readExample.toolName, arguments: readExample.arguments },
        },
      },
      {
        name: 'tools-call-plan',
        description: 'Create a reviewable operation plan with params.arguments.',
        request: {
          jsonrpc: '2.0',
          id: 'plan-1',
          method: 'tools/call',
          params: { name: planExample.toolName, arguments: planExample.arguments },
        },
      },
    ];
  }

  generateMarkdown(): string {
    const contracts = this.contractService.listToolContracts();
    const lines: string[] = [
      '# Pi Agent MCP Tools',
      '',
      '> Generated from `AgentMcpToolContractService`. Do not edit this file by hand.',
      '',
      '## Endpoint And Authentication',
      '',
      'Use `POST /agent/internal/mcp/sessions/{sessionId}` with `Authorization: Bearer <agent-runner-token>`.',
      'The token is issued for the first-party Pi runner session. Do not use a normal Gallery user API key here.',
      '',
      'Bare MCP tool names are used in JSON-RPC requests. Pi-visible names may be shown with an `mcp_gallery_` prefix; for example `searchAssets` may appear to Pi as `mcp_gallery_searchAssets`.',
      '',
      '## JSON-RPC Wrappers',
      '',
      ...this.listJsonRpcExamples().flatMap((example) => [
        `### ${example.name}`,
        '',
        sanitizeText(example.description),
        '',
        markdownJson(example.request),
        '',
      ]),
      '## Approval Flow',
      '',
      'Read tools may return `status: "approval-required"` with a `toolCall.id`. Stop that turn and let Gallery show the approval UI.',
      'If Gallery resumes the runner with an approved result, use that result. If Gallery resumes without the result, retry the same read tool with only `{ "toolCallId": "<id>" }`.',
      'Do not ask the user to approve in chat and do not create a new read request with the old fields.',
      '',
      '## Tools',
      '',
      ...contracts.flatMap((contract) => this.renderTool(contract)),
      '## Common Mistakes',
      '',
      ...contracts.flatMap((contract) => this.renderMistakes(contract)),
      '## Safety',
      '',
      'No MCP apply tool is exposed. Final writes happen only through Gallery plan review UI after the user reviews and applies a proposed plan.',
      '',
    ];

    return `${lines.join('\n').replaceAll(/\n{3,}/g, '\n\n')}`;
  }

  private renderTool(contract: AgentMcpToolContract): string[] {
    return [
      `### ${contract.title}`,
      '',
      `MCP tool name: \`${contract.name}\``,
      '',
      sanitizeText(contract.description),
      '',
      sanitizeText(contract.usage),
      '',
      'Argument modes:',
      '',
      ...contract.argumentModes.flatMap((mode) => [
        `- \`${mode.name}\`: ${sanitizeText(mode.whenToUse)}`,
        `  Required fields: ${mode.requiredFields.length > 0 ? mode.requiredFields.map((field) => `\`${field}\``).join(', ') : 'none'}.`,
        `  Forbidden fields: ${mode.forbiddenFields.length > 0 ? mode.forbiddenFields.map((field) => `\`${field}\``).join(', ') : 'none'}.`,
      ]),
      '',
      ...contract.examples.flatMap((example) => this.renderExample(contract, example)),
    ];
  }

  private renderExample(contract: AgentMcpToolContract, example: AgentMcpToolExample): string[] {
    const schema = toolArgumentsSchemaFor(contract.name);
    const result = schema.safeParse(example.arguments);
    if (!result.success) {
      throw new Error(`Invalid generated MCP docs example: ${contract.name} ${example.name}`);
    }

    return [
      `#### ${example.name}`,
      '',
      sanitizeText(example.description),
      '',
      `<!-- mcp-docs:tool-arguments tool="${contract.name}" example="${example.name}" -->`,
      markdownJson(example.arguments),
      '',
    ];
  }

  private renderMistakes(contract: AgentMcpToolContract): string[] {
    return [
      `### ${contract.title}`,
      '',
      ...contract.commonMistakes.flatMap((mistake) => [`- \`${mistake.id}\`: ${sanitizeText(mistake.hint)}`]),
      '',
    ];
  }
}
```

- [ ] **Step 2: Run the docs service spec and verify the implementation gap narrows**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL only on the committed generated guide drift test, because `docs/superpowers/generated/pi-agent-mcp-tools.md` is not committed yet. The `src/services/agent-mcp.service.spec.ts` generated-docs JSON-RPC tests should now pass.

- [ ] **Step 3: Commit the renderer**

```bash
git add server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): render mcp guide from tool contracts
EOF
)"
```

### Task 3: Add The Sync Command And Commit Generated Markdown

**Files:**

- Create: `server/src/bin/sync-agent-mcp-docs.ts`
- Create: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Modify: `server/package.json`
- Test: `server/src/services/agent-mcp-docs.service.spec.ts`

- [ ] **Step 1: Add the sync bin**

Create `server/src/bin/sync-agent-mcp-docs.ts`:

```ts
#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { AGENT_MCP_GENERATED_DOC_RELATIVE_PATH, AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const sync = async () => {
  const outputPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
  const docs = new AgentMcpDocsService(new AgentMcpToolContractService()).generateMarkdown();

  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, docs, 'utf8');
  console.log(`Wrote ${AGENT_MCP_GENERATED_DOC_RELATIVE_PATH}`);
};

sync().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 2: Add the package script**

In `server/package.json`, add the script next to the other sync scripts:

```json
"sync:agent-mcp-docs": "node ./dist/bin/sync-agent-mcp-docs.js",
```

- [ ] **Step 3: Build and generate the committed doc**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
```

Expected:

```text
Wrote docs/superpowers/generated/pi-agent-mcp-tools.md
```

- [ ] **Step 4: Run the docs service spec and verify drift is green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Inspect the generated doc for obvious readability and safety**

Run:

```bash
sed -n '1,220p' docs/superpowers/generated/pi-agent-mcp-tools.md
rg -n "bearer [a-z0-9._-]{10,}|provider[- ]?key|stack trace|/srv/gallery|/api/agent/internal|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum" docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected:

- The doc starts with `# Pi Agent MCP Tools`.
- The endpoint/auth section uses `Bearer <agent-runner-token>`.
- The `rg` command returns no matches.
- The doc includes `No MCP apply tool is exposed`.

- [ ] **Step 6: Commit the sync command and generated doc**

```bash
git add server/src/bin/sync-agent-mcp-docs.ts server/package.json docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp-docs.service.spec.ts
git commit -m "$(cat <<'EOF'
docs(server): generate pi agent mcp tool guide
EOF
)"
```

### Task 4: Verify JSON-RPC Example Runtime Coverage

**Files:**

- Verify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Run the MCP service spec with the red-first generated-doc tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: PASS. The generated-doc JSON-RPC tests were added red-first in Task 1, and should now pass through `AgentMcpService.handle()` without changing MCP runtime behavior.

- [ ] **Step 2: Confirm no production MCP runtime files changed**

Run:

```bash
git diff -- server/src/services/agent-mcp.service.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-contract.service.ts
```

Expected: no diff. If the runtime coverage fails, fix the docs renderer examples or tests; do not change MCP production behavior in this slice.

### Task 5: Regression And Hardening Review

**Files:**

- Verify: `server/src/services/agent-mcp-docs.service.ts`
- Verify: `server/src/services/agent-mcp-docs.service.spec.ts`
- Verify: `server/src/bin/sync-agent-mcp-docs.ts`
- Verify: `server/package.json`
- Verify: `docs/superpowers/generated/pi-agent-mcp-tools.md`
- Verify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Run focused regression**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-docs.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run server typecheck**

Run:

```bash
pnpm --dir server run check
```

Expected: PASS.

- [ ] **Step 3: Run server lint**

Run:

```bash
pnpm --dir server run lint
```

Expected: PASS.

- [ ] **Step 4: Run server format check**

Run:

```bash
pnpm --dir server run format
```

Expected: PASS.

- [ ] **Step 5: Verify generated docs are reproducible after a clean build**

Run:

```bash
pnpm --dir server run build
pnpm --dir server run sync:agent-mcp-docs
git diff --exit-code -- docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected: PASS with no generated doc diff.

- [ ] **Step 6: Inspect final diff for scope and safety**

Run:

```bash
git diff --stat origin/explore/pi-agent-brainstorm..HEAD
git diff -- server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/bin/sync-agent-mcp-docs.ts server/package.json docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp.service.spec.ts
rg -n "bearer [a-z0-9._-]{10,}|provider[- ]?key|stack trace|/srv/gallery|/api/agent/internal|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum" docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected:

- Only Slice 5 files changed.
- Generated doc is committed.
- Tests validate drift and parseability.
- Generated doc uses placeholder auth only.
- No direct apply or direct mutation tool is documented as available.
- No runtime behavior or DTO schema changed.

- [ ] **Step 7: Commit any hardening cleanup**

If review reveals a cleanup is needed, make the smallest change, rerun the failed focused command, then commit:

```bash
git add server/src/services/agent-mcp-docs.service.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/bin/sync-agent-mcp-docs.ts server/package.json docs/superpowers/generated/pi-agent-mcp-tools.md server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): harden generated mcp guide
EOF
)"
```

If no cleanup is needed, do not create an empty commit.

## Self-Review Checklist

- [ ] The plan uses TDD: docs renderer red tests, renderer implementation, drift red/green, JSON-RPC integration coverage, regression gates.
- [ ] The generated guide is committed at `docs/superpowers/generated/pi-agent-mcp-tools.md`.
- [ ] The guide is generated from `AgentMcpToolContractService`, not hand-maintained examples.
- [ ] The guide includes endpoint/auth shape using placeholder auth only.
- [ ] The guide includes JSON-RPC wrappers for `initialize`, `tools/list`, and `tools/call`.
- [ ] Every documented tool-argument example parses through the same DTO schema used by runtime `tools/call`.
- [ ] `tools/call` examples use `params.arguments`, not `input` or top-level `arguments`.
- [ ] The guide includes approval-required and approved retry guidance.
- [ ] The guide includes create-empty-album and create-album-and-add-assets planning examples.
- [ ] The guide states no MCP apply tool exists and final writes happen through Gallery plan review UI.
- [ ] The guide distinguishes bare MCP tool names from Pi-visible `mcp_gallery_` names.
- [ ] Drift tests fail when the committed generated Markdown does not match renderer output.
- [ ] Safety tests reject real bearer tokens, provider secrets, stack traces, filesystem paths, undocumented internal routes, and available direct mutation/apply tools.
- [ ] Regression commands cover docs, contracts, MCP service, registry, controller integration, DTOs, typecheck, lint, and format.
