import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import { AGENT_MCP_GENERATED_DOC_RELATIVE_PATH, AgentMcpDocsService } from 'src/services/agent-mcp-docs.service';
import { agentMcpPromptPlaceholderMap } from 'src/services/agent-mcp-prompt-placeholders';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const forbiddenGeneratedDocPattern =
  /bearer\s+[a-z0-9._-]{10,}|provider[- ]?key|stack trace|\/(?:srv|home|tmp|var|etc|opt|mnt|Users)\/[^\s`)]*|\/api\/agent\/internal|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum(?!FromSearch)/i;
const directMutationToolNamePattern = /(?:^|_)(?:apply|execute|mutate|write|delete|destroy|directWrite)(?:$|_)/i;

const section = (markdown: string, title: string) => {
  const start = markdown.indexOf(title);
  expect(start, `${title} should exist`).toBeGreaterThanOrEqual(0);
  const next = markdown.indexOf('\n## ', start + title.length);
  return markdown.slice(start, next === -1 ? undefined : next);
};

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

  it('documents the high-level album workflow tools as preferred for album-from-search tasks', () => {
    const markdown = sut.generateMarkdown();
    const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

    for (const name of [
      'create-south-africa-pierre-aurelia-album',
      'create-album-from-previous-search',
      'add-search-results-to-album-by-id',
      'add-search-results-to-album-by-name',
    ]) {
      expect(markdown).toContain(name);
      expect(documentedNames).toContain(name);
    }
    expect(markdown).toContain('proposeAlbumFromSearch');
    expect(markdown).toContain('proposeAddAssetsToAlbumFromSearch');
    expect(markdown).toMatch(/preferred/i);
  });

  it('documents the high-level space workflow tools as preferred for space-from-search tasks', () => {
    const markdown = sut.generateMarkdown();
    const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

    for (const name of [
      'create-space-from-declarative-search',
      'create-space-from-previous-search',
      'add-search-results-to-space-by-id',
      'add-search-results-to-space-by-name',
    ]) {
      expect(markdown).toContain(name);
      expect(documentedNames).toContain(name);
    }
    expect(markdown).toContain('proposeSpaceFromSearch');
    expect(markdown).toContain('proposeAddAssetsToSpaceFromSearch');
    expect(markdown).toMatch(/preferred/i);
  });

  it('documents the high-level asset batch workflow tool and approved examples', () => {
    const markdown = sut.generateMarkdown();
    const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

    for (const name of ['favorite-search-results', 'rotate-previous-search-results']) {
      expect(markdown).toContain(name);
      expect(documentedNames).toContain(name);
    }
    expect(markdown).toContain('proposeAssetBatchFromSearch');
    expect(markdown).toMatch(/preferred/i);
  });

  it('includes the space lookup tools and parseable documented examples', () => {
    const markdown = sut.generateMarkdown();
    const examples = sut
      .listDocumentedToolArgumentExamples()
      .filter((example) => [AgentToolName.ListSpaces, AgentToolName.ReadSpace].includes(example.toolName));

    expect(markdown).toContain('`listSpaces`');
    expect(markdown).toContain('`readSpace`');
    expect(markdown).toContain('list-visible-spaces');
    expect(markdown).toContain('read-space-details');
    expect(examples.map((example) => example.exampleName)).toEqual(
      expect.arrayContaining(['list-visible-spaces', 'read-space-details', 'approved-retry']),
    );

    for (const example of examples) {
      expect(
        AgentReadToolRequestSchemas[example.toolName as keyof typeof AgentReadToolRequestSchemas].safeParse(
          example.arguments,
        ).success,
      ).toBe(true);
    }
  });

  it('documents existing-space add and remove asset plans with membership cautions', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('existing_space');
    expect(markdown).toContain('assetIdsTruncated');
    expect(markdown).toContain('assetIdsTruncated');
    expect(markdown).toMatch(/listSpaces.*readSpace/is);
  });

  it('documents large selection handles in the progressive detail workflow', () => {
    const docs = sut.generateMarkdown();

    expect(docs).toContain('Large selections');
    expect(docs).not.toContain('createSelectionHandle');
    expect(docs).not.toContain('detail: "ids"');
    expect(docs).toContain('assetSelectionHandleId');
    expect(docs).toContain('selectionHandle.id');
  });

  it('documents metadata-only curation into derived selection handles', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('`curateSelection`');
    expect(markdown).toContain('targetCount');
    expect(markdown).toContain('metadata-only');
    expect(markdown).toContain('stored objective scores only');
    expect(markdown).toContain('new selectionHandle');
    expect(markdown).not.toContain('choose selected assetIds');
  });

  it('documents existing-space detail updates, supported fields, and no-op guidance', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('space.updateDetails');
    expect(markdown).toContain('spaceName');
    expect(markdown).toContain('description');
    expect(markdown).toContain('color');
    expect(markdown).toMatch(/thumbnail|pets|face|linked|delete/i);
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

  it('parses every marked tool-argument JSON block from the generated Markdown as JSON', () => {
    const markdown = sut.generateMarkdown();
    const blocks = [
      ...markdown.matchAll(
        /<!-- mcp-docs:tool-arguments tool="([^"]+)" example="([^"]+)" -->\n\n```json\n([\s\S]*?)\n```/g,
      ),
    ];

    expect(blocks).toHaveLength(sut.listDocumentedToolArgumentExamples().length);
    for (const [, toolNameValue, exampleName, jsonText] of blocks) {
      expect(Object.values(AgentToolName)).toContain(toolNameValue as AgentToolName);
      expect(() => JSON.parse(jsonText), `${toolNameValue} ${exampleName}`).not.toThrow();
    }
  });

  it('renders model-facing docs examples and wrappers with semantic placeholders instead of fixture UUIDs', () => {
    const markdown = sut.generateMarkdown();
    const rawRenderedInputs = JSON.stringify([
      ...sut.listDocumentedToolArgumentExamples(),
      ...sut.listJsonRpcExamples(),
    ]);

    for (const [fixtureId, placeholder] of Object.entries(agentMcpPromptPlaceholderMap)) {
      expect(markdown).not.toContain(fixtureId);
      if (rawRenderedInputs.includes(fixtureId)) {
        expect(markdown).toContain(placeholder);
      }
    }
  });

  it('keeps pre-rendered documented examples schema-valid and unmodified', () => {
    sut.generateMarkdown();

    const examples = sut.listDocumentedToolArgumentExamples();
    const serializedExamples = JSON.stringify(examples);

    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000001');
    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000020');
    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000111');

    for (const example of examples) {
      const schema =
        example.toolName in AgentReadToolRequestSchemas
          ? AgentReadToolRequestSchemas[example.toolName as keyof typeof AgentReadToolRequestSchemas]
          : AgentOperationPlanToolRequestSchemas[example.toolName as keyof typeof AgentOperationPlanToolRequestSchemas];

      expect(schema.safeParse(example.arguments).success, `${example.toolName} ${example.exampleName}`).toBe(true);
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

  it('documents current search execution bounds for expanded contract fields', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('bounded result pages');
    expect(markdown).toContain('when hasMore is true');
    expect(markdown).toContain(
      'people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types',
    );
    expect(markdown).not.toContain('Only page 1 and order desc are executable');
    expect(markdown).not.toContain('Text modes, later pages, and non-desc order');
    expect(markdown).toContain('search-page-continuation');
    expect(markdown).toContain('search-order-unavailable');
  });

  it('documents the progressive detail workflow and broad-search edge cases', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('## Progressive Detail Workflow');
    expect(markdown).toContain('Resolve names before search');
    expect(markdown).toContain('Search for a handle/sourceRef first');
    expect(markdown).toContain('readSelectionMetadata');
    expect(markdown).toContain('itemRef');
    expect(markdown).toContain('readAssetMetadata` is legacy exact non-search ID usage');
    expect(markdown).toContain('Visual curation');
    expect(markdown).toContain('Technical metadata');
    expect(markdown).not.toContain('then call `readAssetMetadata`');
    expect(markdown).toContain('Large album');
    expect(markdown).toContain('All photos');
    expect(markdown).toContain('ask a narrowing question');
    expect(markdown).toContain('resultSize.truncated');
    expect(markdown).toContain('limit` up to 1000');
    expect(markdown).not.toContain('Do not use limit 1000');
    expect(markdown).not.toContain('"limit": 1000');
  });

  it('documents resolver-to-search fidelity for people OR and shared-space people', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).toContain('### Resolver-to-search fidelity');
    expect(markdown).toContain('copy `resolvedFilters` into `searchAssets.filters` exactly');
    expect(markdown).toContain('Pierre OR Aurelia');
    expect(markdown).toContain('one `personIds` array');
    expect(markdown).toContain('spaceId` and `spacePersonIds` together');
    expect(markdown).toContain('ask a clarifying question');
    expect(markdown).toContain('resolveAssetSearchFilters');
    expect(markdown).toContain('searchAssets');
  });

  it('documents progressive examples from the contract and keeps them parseable', () => {
    const markdown = sut.generateMarkdown();
    const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

    for (const name of ['empty-search', 'bounded-date-location-search', 'read-selection-metadata-sample']) {
      expect(markdown).toContain(name);
      expect(documentedNames).toContain(name);
    }
  });

  it('documents Slice 7 search scenario examples and correction hints', () => {
    const markdown = sut.generateMarkdown();
    const generatedPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
    const committed = readFileSync(generatedPath, 'utf8');

    for (const exampleName of ['create-album-and-add-assets', 'add-assets-to-existing-album']) {
      expect(markdown).toContain(exampleName);
      expect(committed).toContain(exampleName);
    }

    for (const mistakeId of [
      'search-filters-outside-filters',
      'search-filter-name-in-tag-ids',
      'search-filter-name-in-album-ids',
      'search-filter-name-in-person-ids',
      'search-filter-name-in-space-id',
      'search-filter-name-in-space-person-ids',
      'search-query-with-metadata-mode',
      'search-space-person-without-space',
      'search-combined-filters-and-tool-call-id',
    ]) {
      expect(markdown).toContain(mistakeId);
      expect(committed).toContain(mistakeId);
    }
  });

  it('does not leak real secrets, stack traces, filesystem paths, or direct mutation tools', () => {
    const markdown = sut.generateMarkdown();

    expect(markdown).not.toMatch(forbiddenGeneratedDocPattern);
    expect(markdown).toContain('Bearer <agent-runner-token>');
  });

  it('does not expose apply or direct-mutation MCP tools in the generated guide', () => {
    const contracts = contractService.listToolContracts();
    const markdown = sut.generateMarkdown();

    for (const contract of contracts) {
      expect(contract.name, contract.name).not.toMatch(directMutationToolNamePattern);
    }
    expect(markdown).not.toContain('MCP tool name: `apply');
    expect(markdown).not.toContain('MCP tool name: `execute');
    expect(markdown).not.toContain('MCP tool name: `write');
    expect(markdown).not.toContain('MCP tool name: `delete');
  });

  it('documents source-backed planning defaults before the tool catalog', () => {
    const markdown = sut.generateMarkdown();
    const defaults = section(markdown, '## Source-Backed Planning Defaults');

    expect(markdown.indexOf('## Source-Backed Planning Defaults')).toBeLessThan(markdown.indexOf('## Tools'));
    expect(defaults).toContain('Use high-level workflow tools first');
    expect(defaults).toContain('assetSource.search');
    expect(defaults).toContain('assetSource.selectionHandle');
    expect(defaults).toContain('previousSearch.sourceRef');
    expect(defaults).toContain('provider planning rejects raw assetIds');
    expect(defaults).toContain('Gallery materializes IDs server-side');
    expect(defaults).toContain('assetSource.explicitAssets');
    expect(defaults).toMatch(/internal-only|rejected/i);
    expect(defaults).not.toMatch(/paste|copy.*raw assetIds/i);
    expect(defaults).toContain('wrong_id_domain');
    expect(defaults).toContain('needs_clarification');
    expect(defaults).toContain('choiceRefs');
  });

  it('documents end-to-end source-backed album, space, and batch examples without raw UUID copying', () => {
    const markdown = sut.generateMarkdown();
    const defaults = section(markdown, '## Source-Backed Planning Defaults');

    expect(defaults).toContain('create-south-africa-pierre-aurelia-album');
    expect(defaults).toContain('proposeAlbumFromSearch');
    expect(defaults).toContain('proposeSpaceFromSearch');
    expect(defaults).toContain('proposeAssetBatchFromSearch');
    expect(defaults).toContain('"people": {');
    expect(defaults).toContain('"names": ["Pierre", "Aurelia"]');
    expect(defaults).toContain('"sourceRef": "<sourceRef from searchAssets>"');
    expect(defaults).not.toContain('00000000-0000-4000-8000');
    expect(defaults).not.toContain('"personIds"');
    expect(defaults).not.toContain('"assetIds"');
  });

  it('documents selection-backed workflow tools', () => {
    const markdown = sut.generateMarkdown();
    const documentedNames = sut.listDocumentedToolArgumentExamples().map((example) => example.exampleName);

    expect(markdown).toContain('proposeAlbumFromSelection');
    expect(markdown).toContain('proposeAssetBatchFromSelection');
    expect(markdown).toContain('create-album-from-selection');
    expect(markdown).toContain('favorite-selection');
    expect(documentedNames).toEqual(expect.arrayContaining(['create-album-from-selection', 'favorite-selection']));
    expect(markdown).not.toContain('choose selected assetIds');
  });

  it('keeps the committed generated guide in sync with the renderer', () => {
    const generatedPath = resolve(process.cwd(), '..', AGENT_MCP_GENERATED_DOC_RELATIVE_PATH);
    const committed = readFileSync(generatedPath, 'utf8');

    expect(committed).toBe(sut.generateMarkdown());
  });
});
