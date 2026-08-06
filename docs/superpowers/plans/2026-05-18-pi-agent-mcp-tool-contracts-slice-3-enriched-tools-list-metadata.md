# Pi Agent MCP Tool Contracts Slice 3 Enriched Tools List Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich MCP `tools/list` metadata for read tools with server-owned contract usage, examples, property descriptions, and mode hints while preserving the existing DTO-derived structural schema and tool behavior.

**Architecture:** Inject `AgentMcpToolContractService` into `AgentMcpToolRegistryService` and use read-tool contracts only for read-tool metadata. The registry still derives the base `inputSchema` from Zod DTOs; contract metadata is layered on top as non-validation guidance (`description`, root `examples`, property `description`, `x-gallery-argumentModes`, and `oneOf` only when argument modes are mutually exclusive). Planning tools stay unchanged until Slice 4 adds planning contracts.

**Tech Stack:** NestJS injectable services, TypeScript, Zod JSON Schema generation, existing `AgentMcpToolContractService`, Vitest service tests.

---

## Scope

This slice implements only `Slice 3: Enriched tools/list Metadata` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Enrich read-tool `tools/list` metadata from `AgentMcpToolContractService`.
- Keep the exact Gallery MCP tool list and stable order.
- Keep read/planning tool annotations unchanged.
- Keep every `inputSchema` as an object schema.
- Preserve the DTO-derived structural JSON Schema after stripping non-validation metadata.
- Add valid root-level `inputSchema.examples` for read tools from read-tool contract examples.
- Add property descriptions for read-tool fields:
  - `toolCallId`
  - `assetIds`
  - `albumId`
  - `filters`
  - `limit`
- Add contract argument-mode metadata through `x-gallery-argumentModes`.
- Add `oneOf` mode hints only for read tools whose modes are pairwise exclusive under required/forbidden fields.
- Keep `searchAssets` mode guidance without invalid `oneOf` overlap between broad search and filtered search.
- Preserve defensive copies of registry output.
- Keep `AgentMcpService` behavior green with the registry constructor dependency.

Out of scope:

- Planning-tool contract examples or planning operation guidance.
- Generated MCP guide.
- Runner prompt cheat sheet.
- Validation error payload changes.
- New MCP tools.
- Direct apply or mutation tools.
- Public or third-party MCP support.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/controllers/agent-runner-mcp.controller.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

## File Structure

Modify:

- `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add red tests for enriched read-tool descriptions, examples, property descriptions, argument-mode metadata, `oneOf` mode hints, structural schema preservation, annotations, no apply tools, and defensive copies.
- `server/src/services/agent-mcp.service.spec.ts`
  - Add red runtime coverage proving `tools/list` returns enriched read metadata through `AgentMcpService`, and update the registry construction for the coming dependency injection change.
- `server/src/controllers/agent-runner-mcp.controller.spec.ts`
  - Add the contract service provider to the real MCP service integration setup so the controller-level `tools/list` path stays covered after registry constructor injection.
- `server/src/services/agent-mcp-tool-registry.service.ts`
  - Inject `AgentMcpToolContractService`, enrich read-tool definitions from contracts, preserve planning tools, and layer non-validation metadata on top of generated schemas.

Do not modify in this slice:

- `server/src/services/agent-mcp.service.ts`
- `server/src/services/agent-mcp-tool-contract.service.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `server/src/dtos/agent-operation.dto.ts`
- `agent-runner/src/pi-runtime.mjs`
- `docs/superpowers/generated/`

## Slice 3 Edge Case Matrix

| Area                   | Case                                                    | Expected Slice 3 Result                                                                                                         |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Tool list shape        | `tools/list` response order                             | Exactly the existing nine tools in stable order                                                                                 |
| Safety                 | Apply/direct mutation names                             | No apply/direct mutation tool appears                                                                                           |
| Read descriptions      | Client ignores schema examples                          | Read descriptions still include the contract usage and approved retry guidance                                                  |
| Schema structure       | Metadata enrichment                                     | After stripping `description`, `examples`, `oneOf`, and `x-gallery-argumentModes`, read schemas equal the DTO-generated schemas |
| Examples               | Read contract examples                                  | Every `inputSchema.examples[]` entry parses through the matching read-tool Zod schema                                           |
| Examples               | Placeholder IDs                                         | Examples use stable UUID placeholders that still parse                                                                          |
| Property descriptions  | `assetIds`, `albumId`, `toolCallId`, `filters`, `limit` | Present where the field exists and contains model-actionable guidance                                                           |
| Mode metadata          | Every read tool                                         | `x-gallery-argumentModes` mirrors contract names, required fields, forbidden fields, and when-to-use text                       |
| `oneOf` hints          | Mutually exclusive modes                                | Asset reads, `readAlbum`, and `listAlbums` expose practical `oneOf` mode hints                                                  |
| `oneOf` hints          | Overlapping search modes                                | `searchAssets` does not expose invalid `oneOf` for overlapping empty-search/filtered-search modes                               |
| Annotations            | Read and planning tools                                 | Existing read-only/planning annotations remain unchanged                                                                        |
| Planning tools         | No planning contracts yet                               | Planning tool schemas/descriptions remain structurally unchanged except existing baseline behavior                              |
| Defensive copies       | Caller mutates returned metadata                        | Later `listTools()` calls return unmodified metadata                                                                            |
| Security               | Serialized metadata                                     | No internal routes, bearer tokens, provider secrets, stack traces, or direct apply instructions leak                            |
| Service integration    | `AgentMcpService` uses registry                         | Existing `initialize`, `tools/list`, and tool-call tests stay green after registry constructor injection                        |
| Controller integration | Real MCP controller setup                               | Controller-level `tools/list` test still compiles Nest providers and returns the enriched registry output                       |

---

### Task 1: Add Registry Metadata Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`
- Modify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Update registry test setup for the contract service**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, add:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
```

Add this helper near `toExpectedInputSchema`:

```ts
const stripContractMetadata = (value: unknown, depth = 0): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripContractMetadata(item, depth + 1));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const clone = { ...(value as Record<string, unknown>) };
  delete clone.description;

  if (depth === 0) {
    delete clone.examples;
    delete clone.oneOf;
    delete clone['x-gallery-argumentModes'];
  }

  for (const [key, nestedValue] of Object.entries(clone)) {
    clone[key] = stripContractMetadata(nestedValue, depth + 1);
  }

  return clone;
};
```

Add a contract service variable and update setup:

```ts
let contractService: AgentMcpToolContractService;
let sut: AgentMcpToolRegistryService;

beforeEach(() => {
  contractService = new AgentMcpToolContractService();
  sut = new AgentMcpToolRegistryService(contractService);
});
```

- [ ] **Step 2: Replace the exact read schema equality test with a structural-preservation test**

Replace the existing `derives read tool input schemas from the existing read tool DTO schemas` test with:

```ts
it('preserves DTO-derived read tool input schema structure after stripping contract metadata', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of expectedReadToolNames) {
    expect(stripContractMetadata(toolsByName.get(toolName)?.inputSchema)).toEqual(
      stripContractMetadata(toExpectedInputSchema(AgentReadToolRequestSchemas[toolName])),
    );
  }
});
```

- [ ] **Step 3: Add red tests for contract-backed read descriptions and examples**

Add these tests after `tells models how to continue approved read requests with toolCallId`:

```ts
it('enriches read tool descriptions from the read tool contracts', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listReadToolContracts()) {
    const tool = toolsByName.get(contract.name);

    expect(tool?.title).toBe(contract.title);
    expect(tool?.description).toContain(contract.description);
    expect(tool?.description).toContain(contract.usage);
    expect(tool?.description).toContain('approval');
    expect(tool?.description).toContain('toolCallId');
    expect(tool?.description).not.toMatch(/\/api|agent\/internal|bearer|token|provider key|stack trace/i);
  }
});

it('publishes valid contract examples on read tool input schemas', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listReadToolContracts()) {
    const tool = toolsByName.get(contract.name);
    const examples = tool?.inputSchema.examples;

    expect(examples).toEqual(contract.examples.map((example) => example.arguments));
    expect(examples).toHaveLength(contract.examples.length);
    for (const exampleArguments of examples as Record<string, unknown>[]) {
      const result = AgentReadToolRequestSchemas[contract.name].safeParse(exampleArguments);

      expect(result.success, `${contract.name} example should parse`).toBe(true);
    }
  }
});
```

- [ ] **Step 4: Add red tests for property descriptions and mode metadata**

Add these tests after the examples test:

```ts
it('adds model-facing property descriptions for read tool argument fields', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));
  const metadata = toolsByName.get(AgentToolName.ReadAssetMetadata)?.inputSchema;
  const search = toolsByName.get(AgentToolName.SearchAssets)?.inputSchema;
  const album = toolsByName.get(AgentToolName.ReadAlbum)?.inputSchema;

  expect(metadata?.properties).toMatchObject({
    assetIds: expect.objectContaining({
      description: expect.stringContaining('new asset read request'),
    }),
    toolCallId: expect.objectContaining({
      description: expect.stringContaining('approved retry'),
    }),
  });
  expect(search?.properties).toMatchObject({
    filters: expect.objectContaining({
      description: expect.stringContaining('Put search filters here'),
    }),
    limit: expect.objectContaining({
      description: expect.stringContaining('10000'),
    }),
    toolCallId: expect.objectContaining({
      description: expect.stringContaining('approved retry'),
    }),
  });
  expect(album?.properties).toMatchObject({
    albumId: expect.objectContaining({
      description: expect.stringContaining('album id returned by listAlbums'),
    }),
    toolCallId: expect.objectContaining({
      description: expect.stringContaining('approved retry'),
    }),
  });
});

it('publishes contract argument mode metadata for every read tool', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listReadToolContracts()) {
    const modeMetadata = toolsByName.get(contract.name)?.inputSchema['x-gallery-argumentModes'];

    expect(modeMetadata).toEqual(
      contract.argumentModes.map((mode) => ({
        name: mode.name,
        description: mode.description,
        requiredFields: mode.requiredFields,
        forbiddenFields: mode.forbiddenFields,
        whenToUse: mode.whenToUse,
      })),
    );
  }
});
```

- [ ] **Step 5: Add red tests for practical `oneOf` hints**

Add this test after the mode metadata test:

```ts
it('adds oneOf mode hints only when read tool modes are mutually exclusive', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));
  const previews = toolsByName.get(AgentToolName.ReadAssetPreviews)?.inputSchema;
  const listAlbums = toolsByName.get(AgentToolName.ListAlbums)?.inputSchema;
  const readAlbum = toolsByName.get(AgentToolName.ReadAlbum)?.inputSchema;
  const search = toolsByName.get(AgentToolName.SearchAssets)?.inputSchema;

  expect(previews?.oneOf).toEqual([
    expect.objectContaining({
      title: 'asset-ids',
      required: ['assetIds'],
      not: { anyOf: [{ required: ['toolCallId'] }] },
    }),
    expect.objectContaining({
      title: 'approved-retry',
      required: ['toolCallId'],
      not: {
        anyOf: [
          { required: ['assetIds'] },
          { required: ['albumId'] },
          { required: ['filters'] },
          { required: ['limit'] },
        ],
      },
    }),
  ]);
  expect(listAlbums?.oneOf).toEqual([
    expect.objectContaining({
      title: 'list-visible-albums',
      not: { anyOf: [{ required: ['toolCallId'] }] },
    }),
    expect.objectContaining({
      title: 'approved-retry',
      required: ['toolCallId'],
    }),
  ]);
  expect(readAlbum?.oneOf).toEqual([
    expect.objectContaining({
      title: 'album-id',
      required: ['albumId'],
    }),
    expect.objectContaining({
      title: 'approved-retry',
      required: ['toolCallId'],
    }),
  ]);
  expect(search).not.toHaveProperty('oneOf');
});
```

- [ ] **Step 6: Add red tests for planning preservation and metadata security**

Add these tests before `returns defensive copies of registry metadata`:

```ts
it('leaves planning tool structural schemas unchanged before planning contracts exist', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of expectedPlanningToolNames) {
    const tool = toolsByName.get(toolName);

    expect(tool?.inputSchema).toEqual(toExpectedInputSchema(AgentOperationPlanToolRequestSchemas[toolName]));
    expect(tool?.inputSchema).not.toHaveProperty('examples');
    expect(tool?.inputSchema).not.toHaveProperty('x-gallery-argumentModes');
    expect(tool?.inputSchema).not.toHaveProperty('oneOf');
  }
});

it('does not leak secrets, routes, stack traces, or direct apply guidance through enriched metadata', () => {
  const serialized = JSON.stringify(sut.listTools());

  expect(serialized).not.toMatch(
    /\/api|agent\/internal|bearer|token|provider key|stack trace|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum/i,
  );
});
```

- [ ] **Step 7: Add runtime `tools/list` red coverage**

In `server/src/services/agent-mcp.service.spec.ts`, update the setup to use the coming registry constructor dependency. Replace the current setup order:

```ts
registry = new AgentMcpToolRegistryService();
contractService = new AgentMcpToolContractService();
```

with:

```ts
contractService = new AgentMcpToolContractService();
registry = new AgentMcpToolRegistryService(contractService);
```

Add this test after `returns the registered Gallery MCP tools for tools/list`:

```ts
it('returns enriched read tool metadata through tools/list', async () => {
  const response = (await sut.handle(auth, sessionId, {
    jsonrpc: '2.0',
    id: 'tools-enriched-read-metadata',
    method: 'tools/list',
  })) as AgentMcpSuccessResponse;
  const result = response.result as {
    tools: Array<{ name: AgentToolName; description: string; inputSchema: Record<string, unknown> }>;
  };
  const previews = result.tools.find((tool) => tool.name === AgentToolName.ReadAssetPreviews);

  expect(previews?.description).toContain('Use assetIds for a new request');
  expect(previews?.inputSchema.examples).toEqual([
    { assetIds: ['00000000-0000-4000-8000-000000000001'] },
    { toolCallId: '00000000-0000-4000-8000-000000000111' },
  ]);
  expect(previews?.inputSchema['x-gallery-argumentModes']).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'asset-ids', requiredFields: ['assetIds'], forbiddenFields: ['toolCallId'] }),
      expect.objectContaining({ name: 'approved-retry', requiredFields: ['toolCallId'] }),
    ]),
  );
  expect(previews?.inputSchema.oneOf).toEqual(expect.any(Array));
});
```

- [ ] **Step 8: Update controller integration setup for the coming registry dependency**

In `server/src/controllers/agent-runner-mcp.controller.spec.ts`, import:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
```

In the `with the real MCP service` provider list, add the contract service before `AgentMcpToolRegistryService`:

```ts
        AgentMcpToolContractService,
        AgentMcpToolRegistryService,
```

- [ ] **Step 9: Run focused tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because `AgentMcpToolRegistryService` does not accept `AgentMcpToolContractService`, read schema examples/mode metadata/property descriptions are missing, and runtime `tools/list` does not yet expose the enriched metadata. The controller spec setup change is intentionally verified after the constructor injection implementation lands, because it may continue passing before then.

- [ ] **Step 10: Commit the red tests**

```bash
git add server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define enriched mcp tools list metadata
EOF
)"
```

### Task 2: Enrich Read Tool Registry Metadata

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Test: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`
- Test: `server/src/controllers/agent-runner-mcp.controller.spec.ts`

- [ ] **Step 1: Import contract service and read contract types**

In `server/src/services/agent-mcp-tool-registry.service.ts`, add:

```ts
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import type { AgentMcpArgumentMode, AgentMcpReadToolContract } from 'src/types/agent-mcp-contract.types';
```

- [ ] **Step 2: Add metadata helpers**

Add these helpers after `toInputSchema`:

```ts
const propertyDescriptions: Record<string, string> = {
  assetIds:
    'For a new asset read request, use asset ids returned by Gallery tools. Do not combine assetIds with toolCallId.',
  albumId:
    'For a new album read request, use an album id returned by listAlbums. Do not combine albumId with toolCallId.',
  filters:
    'Put search filters here. Do not place date, location, favorite, rating, album, tag, camera, or media fields at the argument root.',
  limit: 'Maximum search results to return. Use a positive integer no greater than 10000.',
  toolCallId:
    'For an approved retry only. Use the toolCall.id from an approval-required response and omit original request fields.',
};

const buildReadToolDescription = (contract: AgentMcpReadToolContract): string =>
  `${contract.description} ${contract.usage} If approval is required, stop and wait for Gallery; then retry the approved request with only toolCallId.`;

const addPropertyDescriptions = (inputSchema: Record<string, unknown>): void => {
  const properties = inputSchema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return;
  }

  for (const [fieldName, description] of Object.entries(propertyDescriptions)) {
    const property = (properties as Record<string, unknown>)[fieldName];
    if (property && typeof property === 'object' && !Array.isArray(property)) {
      (property as Record<string, unknown>).description = description;
    }
  }
};

const toArgumentModeMetadata = (mode: AgentMcpArgumentMode): Record<string, unknown> => ({
  name: mode.name,
  description: mode.description,
  requiredFields: mode.requiredFields,
  forbiddenFields: mode.forbiddenFields,
  whenToUse: mode.whenToUse,
});

const toModeSchema = (mode: AgentMcpArgumentMode): Record<string, unknown> => {
  const modeSchema: Record<string, unknown> = {
    title: mode.name,
    description: `${mode.description} ${mode.whenToUse}`,
  };

  if (mode.requiredFields.length > 0) {
    modeSchema.required = mode.requiredFields;
  }

  if (mode.forbiddenFields.length > 0) {
    modeSchema.not = {
      anyOf: mode.forbiddenFields.map((field) => ({ required: [field] })),
    };
  }

  return modeSchema;
};

const areModesPairwiseExclusive = (modes: AgentMcpArgumentMode[]): boolean =>
  modes.every((leftMode, leftIndex) =>
    modes.every((rightMode, rightIndex) => {
      if (leftIndex === rightIndex) {
        return true;
      }

      return (
        leftMode.requiredFields.some((field) => rightMode.forbiddenFields.includes(field)) ||
        rightMode.requiredFields.some((field) => leftMode.forbiddenFields.includes(field))
      );
    }),
  );

const enrichInputSchemaFromContract = (
  inputSchema: Record<string, unknown>,
  contract: AgentMcpReadToolContract,
): Record<string, unknown> => {
  const enrichedSchema = structuredClone(inputSchema);

  addPropertyDescriptions(enrichedSchema);
  enrichedSchema.examples = contract.examples.map((example) => structuredClone(example.arguments));
  enrichedSchema['x-gallery-argumentModes'] = contract.argumentModes.map(toArgumentModeMetadata);

  if (areModesPairwiseExclusive(contract.argumentModes)) {
    enrichedSchema.oneOf = contract.argumentModes.map(toModeSchema);
  }

  return enrichedSchema;
};
```

- [ ] **Step 3: Add contract-aware tool definition support**

Change `AgentMcpToolDefinitionInput` to include a read contract:

```ts
type AgentMcpToolDefinitionInput = Omit<AgentMcpToolDefinition, 'inputSchema'> & {
  schema: ZodType;
  contract?: AgentMcpReadToolContract;
};
```

Replace `defineTool` with:

```ts
const defineTool = ({ schema, contract, ...tool }: AgentMcpToolDefinitionInput): AgentMcpToolDefinition => {
  const inputSchema = toInputSchema(schema);

  if (!contract) {
    return {
      ...tool,
      inputSchema,
    };
  }

  return {
    ...tool,
    title: contract.title,
    description: buildReadToolDescription(contract),
    inputSchema: enrichInputSchemaFromContract(inputSchema, contract),
  };
};
```

- [ ] **Step 4: Build read tools with contract metadata**

Change `buildTools` to accept read contracts:

```ts
const buildTools = (toolContractService: AgentMcpToolContractService): AgentMcpToolDefinition[] => {
  const readContractsByName = new Map(
    toolContractService.listReadToolContracts().map((contract) => [contract.name, contract]),
  );
  const getReadContract = (name: AgentMcpReadToolContract['name']): AgentMcpReadToolContract => {
    const contract = readContractsByName.get(name);
    if (!contract) {
      throw new Error(`Missing MCP read tool contract for ${name}`);
    }

    return contract;
  };

  return [
    defineTool({
      name: AgentToolName.SearchAssets,
      title: 'Search assets',
      description: `Search the photo library by date, place, camera metadata, favorites, media type, rating, tags, albums, and result limit.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.SearchAssets],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.SearchAssets),
    }),
    defineTool({
      name: AgentToolName.ReadAssetMetadata,
      title: 'Read asset metadata',
      description: `Read metadata for selected assets, including timestamps, location labels, camera fields, rating, favorites, visibility, and tags.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetMetadata],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.ReadAssetMetadata),
    }),
    defineTool({
      name: AgentToolName.ReadAssetPreviews,
      title: 'Read asset previews',
      description: `Read preview media references for selected assets after Gallery approval when approval is required.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetPreviews],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.ReadAssetPreviews),
    }),
    defineTool({
      name: AgentToolName.ReadAssetOriginals,
      title: 'Read asset originals',
      description: `Read original media references for selected assets after Gallery approval when approval is required.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAssetOriginals],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.ReadAssetOriginals),
    }),
    defineTool({
      name: AgentToolName.ListAlbums,
      title: 'List albums',
      description: `List albums visible to the authenticated session user.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ListAlbums],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.ListAlbums),
    }),
    defineTool({
      name: AgentToolName.ReadAlbum,
      title: 'Read album',
      description: `Read one visible album with its summary fields and asset identifiers.${approvedRequestInstruction}`,
      schema: AgentReadToolRequestSchemas[AgentToolName.ReadAlbum],
      annotations: readToolAnnotations,
      contract: getReadContract(AgentToolName.ReadAlbum),
    }),
    defineTool({
      name: AgentToolName.ProposeAlbumOperations,
      title: 'Propose album operations',
      description: 'Create a proposed album operation plan for user review without applying gallery changes.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.ReviseProposedOperations,
      title: 'Revise proposed operations',
      description: 'Create a revised album operation plan from feedback without applying gallery changes.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.ReviseProposedOperations],
      annotations: planningToolAnnotations,
    }),
    defineTool({
      name: AgentToolName.SummarizePlan,
      title: 'Summarize plan',
      description: 'Summarize the current proposed album operation plan for user review.',
      schema: AgentOperationPlanToolRequestSchemas[AgentToolName.SummarizePlan],
      annotations: planningToolAnnotations,
    }),
  ];
};
```

Keep the existing planning definitions exactly as they are except for moving them inside the returned array.

- [ ] **Step 5: Inject the contract service into the registry**

Replace the registry class with:

```ts
@Injectable()
export class AgentMcpToolRegistryService {
  private readonly tools: AgentMcpToolDefinition[];

  constructor(private readonly toolContractService: AgentMcpToolContractService) {
    this.tools = buildTools(this.toolContractService);
  }

  listTools(): AgentMcpToolDefinition[] {
    return this.tools.map((tool) => cloneTool(tool));
  }
}
```

- [ ] **Step 6: Verify service tests already use the registry dependency**

Confirm `server/src/services/agent-mcp.service.spec.ts` already has this setup from Task 1:

```ts
contractService = new AgentMcpToolContractService();
registry = new AgentMcpToolRegistryService(contractService);
```

Leave the existing `AgentMcpService` constructor unchanged.

- [ ] **Step 7: Run focused registry tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected: PASS.

- [ ] **Step 8: Run MCP service and controller integration tests and verify constructor integration stays green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the green implementation**

```bash
git add server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): enrich mcp tools list read metadata
EOF
)"
```

### Task 3: Regression And Hardening Review

**Files:**

- Verify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Verify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Verify: `server/src/services/agent-mcp.service.spec.ts`
- Verify: `server/src/controllers/agent-runner-mcp.controller.spec.ts`
- Verify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-tool.dto.spec.ts
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

- [ ] **Step 5: Inspect final diff for scope and schema safety**

Run:

```bash
git diff --stat origin/explore/pi-agent-brainstorm..HEAD
git diff -- server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
```

Expected:

- Registry reads contracts from `AgentMcpToolContractService`.
- Read-tool metadata is enriched.
- Planning tool metadata remains on existing baseline.
- DTO schemas are not edited.
- `AgentMcpService` implementation is not edited.
- Controller integration setup includes the registry contract dependency.
- No direct apply tool or direct mutation tool appears.
- No secrets, internal routes, bearer tokens, stack traces, filesystem paths, or raw request bodies appear in metadata.

- [ ] **Step 6: Commit any review-only cleanup**

If review reveals a cleanup is needed, make the smallest change, rerun the failed focused command, then commit:

```bash
git add server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts server/src/controllers/agent-runner-mcp.controller.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): harden mcp tools list metadata
EOF
)"
```

If no cleanup is needed, do not create an empty commit.

## Self-Review Checklist

- [ ] The plan uses TDD: each behavior task has red tests, a red run, implementation, green run, and commits.
- [ ] Read-tool `tools/list` descriptions include contract purpose, usage, approval guidance, and `toolCallId`.
- [ ] Read-tool `inputSchema.examples` come from contract examples and parse through read DTO schemas.
- [ ] Read-tool property descriptions cover `toolCallId`, `assetIds`, `albumId`, `filters`, and `limit` where present.
- [ ] `x-gallery-argumentModes` mirrors contract mode names, required fields, forbidden fields, and when-to-use text.
- [ ] `oneOf` is present only for mutually exclusive read-tool modes and absent for overlapping `searchAssets` modes.
- [ ] Structural JSON Schema equality is preserved after stripping contract metadata.
- [ ] Tool order, annotations, planning schemas, and no-apply safety remain unchanged.
- [ ] Runtime `tools/list` through `AgentMcpService` returns enriched read metadata.
- [ ] Controller-level `tools/list` through the real Nest provider setup stays green after registry constructor injection.
- [ ] Regression commands cover registry, contract, service, controller integration, DTO, typecheck, lint, and format.
