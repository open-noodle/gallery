import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentToolName } from 'src/enum';
import {
  agentMcpPromptPlaceholderMap,
  renderAgentMcpPromptPlaceholders,
} from 'src/services/agent-mcp-prompt-placeholders';
import { AgentMcpPromptService } from 'src/services/agent-mcp-prompt.service';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';
import type { AgentMcpPlanningToolName, AgentMcpReadToolName } from 'src/types/agent-mcp-contract.types';

describe('agent MCP prompt placeholders', () => {
  const fixtureIds = Object.keys(agentMcpPromptPlaceholderMap);

  it('defines semantic placeholders for every schema-valid MCP fixture id', () => {
    expect(agentMcpPromptPlaceholderMap).toEqual({
      '00000000-0000-4000-8000-000000000001': '<exact-asset-id-from-readAssetMetadata>',
      '00000000-0000-4000-8000-000000000002': '<another-exact-asset-id-from-readAssetMetadata>',
      '00000000-0000-4000-8000-000000000010': '<album.id from listAlbums/readAlbum>',
      '00000000-0000-4000-8000-000000000020': '<space.id from listSpaces/readSpace>',
      '00000000-0000-4000-8000-000000000021': '<spacePersonIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000030': '<tagIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000040': '<personIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000041': '<another-personIds value from resolveAssetSearchFilters>',
      '00000000-0000-4000-8000-000000000111': '<approved-toolCallId>',
      '00000000-0000-4000-8000-000000000222': '<plan.id from proposed plan>',
      '00000000-0000-4000-8000-000000000333': '<selectionHandle.id from searchAssets>',
      'asset-source:search:00000000-0000-4000-8000-000000000333': '<sourceRef from searchAssets>',
    });
  });

  it('replaces nested fixture ids without mutating the source value', () => {
    const source = {
      operationIds: ['00000000-0000-4000-8000-000000000333'],
      operations: [
        {
          targetId: '00000000-0000-4000-8000-000000000010',
          assetIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
          payload: {
            tagId: '00000000-0000-4000-8000-000000000030',
            untouched: 'not-a-fixture',
          },
        },
      ],
    };

    const rendered = renderAgentMcpPromptPlaceholders(source);

    expect(rendered).toEqual({
      operationIds: ['<selectionHandle.id from searchAssets>'],
      operations: [
        {
          targetId: '<album.id from listAlbums/readAlbum>',
          assetIds: ['<exact-asset-id-from-readAssetMetadata>', '<another-exact-asset-id-from-readAssetMetadata>'],
          payload: {
            tagId: '<tagIds value from resolveAssetSearchFilters>',
            untouched: 'not-a-fixture',
          },
        },
      ],
    });
    expect(source.operations[0].targetId).toBe('00000000-0000-4000-8000-000000000010');
  });

  it('leaves runtime-looking non-fixture ids unchanged', () => {
    const runtimeId = 'a4d2b718-2485-47aa-b45c-0d70f64cfd93';

    expect(renderAgentMcpPromptPlaceholders({ assetIds: [runtimeId] })).toEqual({ assetIds: [runtimeId] });
    expect(fixtureIds).not.toContain(runtimeId);
  });
});

describe(AgentMcpPromptService.name, () => {
  const maxPromptLength = 4850;
  let contractService: AgentMcpToolContractService;
  let sut: AgentMcpPromptService;

  beforeEach(() => {
    contractService = new AgentMcpToolContractService();
    sut = new AgentMcpPromptService(contractService);
  });

  it('generates a compact runner cheat sheet from the contract', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Gallery MCP tool-use cheat sheet');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
    expect(prompt).toContain('mcp_gallery_resolveAssetSearchFilters');
    expect(prompt).toContain('R: Known ID filters');
    expect(prompt).toContain('Default write:');
    expect(prompt).toContain('mcp_gallery_proposeAlbumFromSearch');
    expect(prompt).toContain('mcp_gallery_proposeAddAssetsToAlbumFromSearch');
    expect(prompt).toContain('mcp_gallery_proposeSpaceFromSearch');
    expect(prompt).toContain('mcp_gallery_proposeAddAssetsToSpaceFromSearch');
    expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSearch');
    expect(prompt).toContain('mcp_gallery_proposeAlbumFromSelection');
    expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSelection');
    expect(prompt).toContain('curateSelection');
    expect(prompt).toContain('proposeAlbumFromSelection');
    expect(prompt).not.toContain('choose selected assetIds');
    expect(prompt).not.toContain('Tmcp_gallery');
    expect(prompt).not.toContain('RKnown');
    expect(prompt).not.toContain('Wcall');
    expect(prompt).toContain('mcp_gallery_searchAssets');
    expect(prompt).toContain('mcp_gallery_readAssetMetadata');
    expect(prompt).toContain('mcp_gallery_listSpaces');
    expect(prompt).toContain('mcp_gallery_readSpace');
    expect(prompt).toContain('mcp_gallery_proposeAlbumOperations');
  });

  it('lists every required runner tool in the Tool: line', () => {
    const prompt = sut.generatePromptCheatSheet();
    const toolLine = prompt.split('\n').find((line) => line.startsWith('Tool: '));
    const listedTools = toolLine?.replace('Tool: ', '').split(',') ?? [];

    expect(toolLine).toBeDefined();
    expect(listedTools).toEqual(
      expect.arrayContaining([
        'mcp_gallery_resolveAssetSearchFilters',
        'mcp_gallery_searchAssets',
        'mcp_gallery_readSelectionMetadata',
        'mcp_gallery_readAssetMetadata',
        'mcp_gallery_readAssetPreviews',
        'mcp_gallery_readAssetOriginals',
        'mcp_gallery_listSpaces',
        'mcp_gallery_readSpace',
        'mcp_gallery_proposeAlbumFromSearch',
        'mcp_gallery_proposeAddAssetsToAlbumFromSearch',
        'mcp_gallery_proposeSpaceFromSearch',
        'mcp_gallery_proposeAddAssetsToSpaceFromSearch',
        'mcp_gallery_proposeAssetBatchFromSearch',
        'mcp_gallery_proposeAlbumFromSelection',
        'mcp_gallery_proposeAssetBatchFromSelection',
        'mcp_gallery_proposeAlbumOperations',
      ]),
    );
  });

  it('teaches source-backed workflow tools as the default write path', () => {
    const prompt = sut.generatePromptCheatSheet();
    const defaultWrite = prompt.split('\n').find((line) => line.startsWith('Default write:'));

    expect(prompt).toContain('Default write:');
    expect(defaultWrite).toContain('mcp_gallery_proposeAlbumFromSearch');
    expect(defaultWrite).toContain('mcp_gallery_proposeAddAssetsToAlbumFromSearch');
    expect(defaultWrite).toContain('mcp_gallery_proposeSpaceFromSearch');
    expect(defaultWrite).toContain('mcp_gallery_proposeAddAssetsToSpaceFromSearch');
    expect(defaultWrite).toContain('mcp_gallery_proposeAssetBatchFromSearch');
    expect(defaultWrite).toContain('mcp_gallery_proposeAlbumFromSelection');
    expect(defaultWrite).toContain('mcp_gallery_proposeAssetBatchFromSelection');
    expect(prompt).toContain(
      'After curateSelection: selection tools, or proposeAlbumOperations for asset.trash, with selectionHandle.id; no asset IDs.',
    );
    expect(prompt).toContain('assetSource.search');
    expect(prompt).toContain('assetSource.selectionHandle');
    expect(prompt).toContain('previousSearch.sourceRef');
    expect(prompt).toContain('provider planning rejects raw assetIds');
    expect(prompt).toContain('Gallery materializes IDs server-side');
    expect(prompt).toContain('assetSource.explicitAssets');
    expect(prompt).toMatch(/internal-only|rejected/i);
    expect(prompt).not.toMatch(/explicit IDs only for small inspected sets/i);
    expect(prompt).not.toMatch(/paste|copy.*raw assetIds/i);
    expect(prompt).toContain('wrong_id_domain');
    expect(prompt).toContain('needs_clarification');
    expect(prompt).toContain('choiceRefs');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('teaches the handle-first recent trip album workflow', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Trip albums: findTripCandidates first');
    expect(prompt).toContain('recommendation.action');
    expect(prompt).toContain('use_top_candidate');
    expect(prompt).toContain('ask_user');
    expect(prompt).toContain('none');
    expect(prompt).toContain('generic handle->proposeAlbumFromSelection');
    expect(prompt).toContain('highlights default 10->curateSelection');
    expect(prompt).not.toMatch(/trip album requests.*searchAssets/i);
    expect(prompt).not.toMatch(/copy .*assetIds/i);
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('teaches metadata edits as reviewable search-backed plans with explicit coordinates only', () => {
    const prompt = sut.generatePromptCheatSheet();
    const examples = sut.listPromptExamples();
    const batchExample = examples.find(
      (example) =>
        example.toolName === AgentToolName.ProposeAssetBatchFromSearch &&
        example.exampleName === 'favorite-search-results',
    );

    expect(batchExample?.arguments).toMatchObject({
      assetSource: { kind: 'search' },
    });
    expect(prompt).toContain('asset.updateMetadata');
    expect(prompt).toContain('mcp_gallery_proposeAssetBatchFromSearch');
    expect(prompt).toMatch(/metadata edits?.*reviewable/i);
    expect(prompt).toMatch(/coordinates?.*latitude.*longitude/i);
    expect(prompt).toMatch(/place names?.*ask/i);
    expect(prompt).not.toContain('placeName');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('renders schema-valid source-backed prompt snippets with required workflow fields', () => {
    const prompt = sut.generatePromptCheatSheet();
    const lineJson = (prefix: string) => {
      const line = prompt.split('\n').find((candidate) => candidate.startsWith(prefix));

      expect(line, prefix).toBeDefined();
      return JSON.parse(line!.slice(prefix.length)) as Record<string, unknown>;
    };
    const albumSearch = lineJson('assetSource.search: mcp_gallery_proposeAlbumFromSearch ');
    const previousSearch = lineJson('previousSearch.sourceRef after inspect: mcp_gallery_proposeAlbumFromSearch ');

    expect(albumSearch).toMatchObject({
      albumName: 'SA P&A',
      assetSource: { kind: 'search' },
    });
    expect(previousSearch).toMatchObject({
      albumName: 'F',
      assetSource: { kind: 'previousSearch' },
    });
    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse(albumSearch).success,
    ).toBe(true);
    (previousSearch.assetSource as Record<string, unknown>).sourceRef =
      'asset-source:search:00000000-0000-4000-8000-000000000333';
    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumFromSearch].safeParse(previousSearch).success,
    ).toBe(true);
  });

  it('does not tell Pi deterministic people, space, or visibility filters are unavailable', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain(
      'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types.',
    );
    expect(prompt).toContain('if hasMore, use nextPage as page');
    expect(prompt).toContain('Text search: smart/ocr/description/filename require query');
    expect(prompt).not.toContain('Only page 1 and order desc are executable');
    expect(prompt).not.toContain('Text modes, later pages, and non-desc order are not available yet');
    expect(prompt).not.toContain('People, space, and visibility fields are contract fields but are not available yet.');
  });

  it('teaches Pi to resolve names before passing ID filters to searchAssets', () => {
    const prompt = sut.generatePromptCheatSheet();
    const examples = sut.listPromptExamples();

    expect(prompt).toContain('mcp_gallery_resolveAssetSearchFilters');
    expect(prompt).toContain('Resolve names before searchAssets');
    expect(prompt).toContain('"tags":["Travel"]');
    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: AgentToolName.ResolveAssetSearchFilters,
          exampleName: 'resolve-named-filters',
          arguments: { tags: ['Travel'], albums: ['Berlin'] },
        }),
      ]),
    );
  });

  it('renders the South Africa Pierre Aurelia regression as an assetSource.search workflow', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Pierre');
    expect(prompt).toContain('Aurelia');
    expect(prompt).toContain('mcp_gallery_proposeAlbumFromSearch');
    expect(prompt).toContain('"assetSource":{"kind":"search"');
    expect(prompt).toContain('"people":{"match":"any","names":["Pierre","Aurelia"]}');
    expect(prompt).toContain('"country":"South Africa"');
    expect(prompt).toContain('"takenAfter":"2026-01-01T00:00:00.000Z"');
    expect(prompt).toContain('"takenBefore":"2026-02-01T00:00:00.000Z"');
    expect(prompt).not.toContain('"personIds":["<personIds value from resolveAssetSearchFilters>"');
  });

  it('shows shared-space person resolver-to-search guidance with spaceId and spacePersonIds together', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Shared-space people');
    expect(prompt).toContain('"spaceId":"<space.id from listSpaces/readSpace>"');
    expect(prompt).toContain('"spacePersonIds":["<spacePersonIds value from resolveAssetSearchFilters>"]');
    expect(prompt).toMatch(/ask(?: .*clarifying)?/i);
    expect(prompt).not.toMatch(/run .*broad search .*missing/i);
  });

  it('teaches compact natural-language search patterns for Slice 7 prompts', () => {
    const prompt = sut.generatePromptCheatSheet();
    const patternLine =
      'Patterns: unalbumed=isNotInAlbum; 5-star videos=rating 5+type VIDEO; OCR invoice=mode ocr+query invoice; names=resolve names first.';

    expect(prompt).toContain(patternLine);
    expect(prompt).toContain('unalbumed');
    expect(prompt).toContain('isNotInAlbum');
    expect(prompt).toContain('rating 5');
    expect(prompt).toContain('type VIDEO');
    expect(prompt).toContain('OCR invoice');
    expect(prompt).toContain('mode ocr');
    expect(prompt).toContain('resolve names');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('teaches progressive detail before broad metadata reads', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Progressive: resolve names -> search handle');
    expect(prompt).toContain('readSelectionMetadata');
    expect(prompt).toContain('itemRef');
    expect(prompt).toContain('readAssetMetadata legacy exact non-search IDs only');
    expect(prompt).toContain('limit up to 1000');
    expect(prompt).not.toContain('No 1k');
    expect(prompt).not.toContain('Do not use limit 1000');
    expect(prompt).toContain('if truncated/hasMore, page/ask');
    expect(prompt).not.toContain('"detail":"ids"');
    expect(prompt).not.toContain('"detail":"handle","fields"');
    expect(prompt).toContain('"detail":"summary"');
    expect(prompt).toContain('"fields":["dates","location"]');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('renders large-selection handle guidance without encouraging pasted asset ids', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).not.toContain('createSelectionHandle');
    expect(prompt).toContain('assetSelectionHandleId');
    expect(prompt).toContain('provider planning rejects raw assetIds');
    expect(prompt).toMatch(/low-level planning uses handles\/sources.*album\.addAssets.*space\.addAssets/is);
  });

  it('includes compact visual and technical metadata guidance without direct writes', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain(
      'Best/highlights require bounded album/space/date/search/selection; use curateSelection for metadata-only suggested narrowing. Quality cleanup can use stored quality constraints; no preview inspection; handle->planning.',
    );
    expect(prompt).toContain(
      'Technical metadata: search handle, then readSelectionMetadata fields camera/dates/filename; readAssetMetadata legacy exact non-search IDs only',
    );
    expect(prompt).not.toContain('"limit":1000');
    expect(prompt).not.toContain('mcp_gallery_apply');
  });

  it('teaches highlight curation as bounded suggestions and quality cleanup as stored-score filtering', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('mcp_gallery_curateSelection');
    expect(prompt).toContain('metadata-only');
    expect(prompt).toContain('stored quality constraints');
    expect(prompt).toContain('curateSelection');
    expect(prompt).not.toContain('choose 15 assetIds');
    expect(prompt).toMatch(/highlights?.*bounded/i);
    expect(prompt).toMatch(/best.*highlights?.*album.*space.*date.*search.*selection/i);
    expect(prompt).toMatch(/suggested|recommend/i);
    expect(prompt).toContain('no preview inspection');
    expect(prompt).not.toMatch(/selected assetIds only|selected ids only/i);
    expect(prompt).not.toContain('analyzeAssetQuality');
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('selects existing search metadata preview and plan examples for highlight curation', () => {
    const examples = sut.listPromptExamples();

    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolName: AgentToolName.CurateSelection,
          exampleName: 'curate-metadata-highlights',
        }),
        expect.objectContaining({
          toolName: AgentToolName.ReadAssetPreviews,
          exampleName: 'read-selected-assets',
        }),
        expect.objectContaining({
          toolName: AgentToolName.ProposeAlbumOperations,
          exampleName: 'create-album-and-add-assets',
        }),
      ]),
    );
  });

  it('teaches people organization as resolve, search, then propose plan', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('Resolve names before searchAssets');
    expect(prompt).toContain('people');
    expect(prompt).toContain('spacePersonIds');
    expect(prompt).toContain('Use returned personIds or spaceId plus spacePersonIds');
    expect(prompt).toContain('propose');
  });

  it('uses Pi-visible tool names and does not use bare tool-call names as instructions', () => {
    const prompt = sut.generatePromptCheatSheet();

    for (const contract of contractService.listToolContracts()) {
      expect(prompt).toContain(`mcp_gallery_${contract.name}`);
    }

    expect(prompt).toContain('mcp_gallery_proposeAlbumOperations');
    expect(prompt).not.toContain('use proposeAlbumOperations');
  });

  it('includes approval retry guidance from contract-owned read tool modes', () => {
    const prompt = sut.generatePromptCheatSheet();
    const metadataContract = contractService
      .listToolContracts()
      .find((contract) => contract.name === AgentToolName.ReadAssetMetadata);
    const retryMode = metadataContract?.argumentModes.find((mode) => mode.name === 'approved-retry');

    expect(prompt).toContain(metadataContract?.approvalRetry?.instruction);
    expect(prompt).toContain('toolCallId');
    expect(prompt).toMatch(/retry uses only .*toolCallId/is);
    expect(prompt).toMatch(/omit old request fields/is);
    expect(prompt).toContain(retryMode?.forbiddenFields.join(', '));
  });

  it('includes create album and create-plus-add-assets planning examples', () => {
    const prompt = sut.generatePromptCheatSheet();
    const examples = sut.listPromptExamples();

    expect(prompt).toContain('album.create');
    expect(prompt).toContain('album.addAssets');
    expect(prompt).toContain('temporaryTargetId');
    expect(examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ exampleName: 'create-album-and-add-assets' }),
        expect.objectContaining({ exampleName: 'add-assets-to-existing-album' }),
      ]),
    );
  });

  it('includes a normal space lookup example that validates against the read schemas', () => {
    const prompt = sut.generatePromptCheatSheet();
    const examples = sut.listPromptExamples();
    const listSpaces = examples.find(
      (example) => example.toolName === AgentToolName.ListSpaces && example.exampleName === 'list-visible-spaces',
    );
    const readSpace = examples.find(
      (example) => example.toolName === AgentToolName.ReadSpace && example.exampleName === 'read-space-details',
    );

    expect(prompt).toContain('Space lookup');
    expect(prompt).toContain('mcp_gallery_listSpaces');
    expect(prompt).toContain('mcp_gallery_readSpace');
    expect(listSpaces?.arguments).toEqual({});
    expect(readSpace?.arguments).toEqual({ spaceId: '00000000-0000-4000-8000-000000000020' });
    AgentReadToolRequestSchemas[AgentToolName.ListSpaces].parse(listSpaces?.arguments);
    AgentReadToolRequestSchemas[AgentToolName.ReadSpace].parse(readSpace?.arguments);
  });

  it('includes existing-space asset plan examples and membership guidance', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('mcp_gallery_listSpaces');
    expect(prompt).toContain('mcp_gallery_readSpace');
    expect(prompt).toContain('space.addAssets');
    expect(prompt).toContain('removeAssets');
    expect(prompt).toContain('"targetKind":"existing_space"');
    expect(prompt).toContain('assetIdsTruncated');
    expect(prompt).toMatch(/exclude .*already .*space/i);
    expect(prompt).toMatch(/only remove .*already .*space/i);
    expect(prompt).toMatch(/ambiguous|multiple spaces/i);
    expect(prompt).toMatch(/no matching space|no space/i);
    expect(prompt).toMatch(/no matching assets|no photos/i);
  });

  it('guides the runner through existing-space detail updates without direct writes', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('mcp_gallery_listSpaces');
    expect(prompt).toContain('mcp_gallery_readSpace');
    expect(prompt).toContain('space.updateDetails');
    expect(prompt).toContain('spaceName');
    expect(prompt).toContain('description');
    expect(prompt).toContain('color');
    expect(prompt).toMatch(/already|no-op|no change/i);
    expect(prompt).toContain('Never update thumbnails/pets/faces/linked libraries/delete spaces.');
    expect(prompt).not.toContain('mcp_gallery_updateSpace');
  });

  it('tells the runner not to propose no-op or ambiguous existing-space detail plans', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toMatch(/ambiguous|ask/i);
    expect(prompt).toMatch(/no matching space|ask/i);
    expect(prompt).toMatch(/already|no change|no-op/i);
    expect(prompt).toMatch(/same name|same description|same color/i);
  });

  it('tells the runner what to do when existing-space membership is complete or truncated', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toMatch(/assetIdsTruncated.*false/i);
    expect(prompt).toMatch(/exclude .*already .*space/i);
    expect(prompt).toMatch(/only remove .*already .*space/i);
    expect(prompt).toMatch(/assetIdsTruncated.*true/i);
    expect(prompt).toMatch(/narrow|ask/i);
  });

  it('guides the runner not to propose empty existing-space asset plans', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toMatch(/all .*already .*space|already .*in .*space/i);
    expect(prompt).toMatch(/none .*in .*space|not .*in .*space/i);
    expect(prompt).toMatch(/no matching assets|no photos/i);
  });

  it('guides the runner to ask before planning ambiguous or missing spaces', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toMatch(/ambiguous|multiple spaces/i);
    expect(prompt).toMatch(/no matching space|no space/i);
    expect(prompt).toMatch(/ask before planning|ask/i);
  });

  it('documents validation-error recovery', () => {
    const prompt = sut.generatePromptCheatSheet();
    const planningContract = contractService
      .listToolContracts()
      .find((contract) => contract.name === AgentToolName.ProposeAlbumOperations);
    const mistake = planningContract?.commonMistakes.find((candidate) => candidate.exampleName);

    expect(prompt).toContain('exampleArguments');
    expect(prompt).toMatch(/retry once .*correction is obvious/is);
    expect(prompt).toMatch(/params\.arguments.*MCP tools\/call request/i);
    expect(prompt).toContain(mistake?.hint);
  });

  it('teaches Pi to retry recoverable validation tool errors before reporting internal failures', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).toContain('retry with corrected arguments');
    expect(prompt).toContain('Retry mcp_gallery_proposeAlbumOperations with exact');
    expect(prompt).toContain('<selectionHandle.id from searchAssets>');
    expect(prompt).toContain('Not an internal Gallery issue on first failure');
    expect(prompt).toContain('if corrected retry fails again, explain missing/blocked');
    expect(prompt).toContain('approval-required pauses');
    expect(prompt).not.toMatch(/denied .*recoverable/i);
    expect(prompt.length).toBeLessThanOrEqual(maxPromptLength);
  });

  it('renders model-facing prompt examples with semantic placeholders instead of fixture UUIDs', () => {
    const prompt = sut.generatePromptCheatSheet();

    for (const fixtureId of Object.keys(agentMcpPromptPlaceholderMap)) {
      expect(prompt).not.toContain(fixtureId);
    }

    expect(prompt).toContain('readAssetMetadata');
    expect(prompt).not.toContain('<asset-id-from-searchAssets>');
    expect(prompt).toContain('<space.id from listSpaces/readSpace>');
    expect(prompt).toContain('<approved-toolCallId>');
    expect(prompt).toContain('<selectionHandle.id from searchAssets>');
  });

  it('does not advertise legacy search id prompt guidance', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).not.toContain('<asset-id-from-searchAssets>');
    expect(prompt).not.toContain('selected assetIds only');
    expect(prompt).not.toContain('search ids first');
    expect(prompt).not.toContain('search handle->metadata');
    expect(prompt).not.toContain('search handle/sourceRef, then readAssetMetadata');
    expect(prompt).not.toContain('createSelectionHandle');
  });

  it('keeps structured prompt examples schema-valid and unmodified before rendering', () => {
    sut.generatePromptCheatSheet();

    const examples = sut.listPromptExamples();
    const serializedExamples = JSON.stringify(examples);

    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000001');
    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000020');
    expect(serializedExamples).toContain('00000000-0000-4000-8000-000000000111');

    for (const example of examples) {
      if (example.toolName in AgentReadToolRequestSchemas) {
        AgentReadToolRequestSchemas[example.toolName as AgentMcpReadToolName].parse(example.arguments);
        continue;
      }

      AgentOperationPlanToolRequestSchemas[example.toolName as AgentMcpPlanningToolName].parse(example.arguments);
    }
  });

  it('keeps validation-correction example arguments schema-valid and unmodified after prompt rendering', () => {
    sut.generatePromptCheatSheet();

    const correction = contractService.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
      requestShape: 'tool-arguments',
      issues: [{ path: 'operations.0.assetIds', message: 'Too big: expected array to have <=10000 items' }],
    });

    const serializedCorrection = JSON.stringify(correction?.exampleArguments);

    expect(serializedCorrection).toContain('00000000-0000-4000-8000-000000000333');
    expect(serializedCorrection).not.toContain('<asset-id-from-searchAssets>');
    AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].parse(correction?.exampleArguments);
  });

  it('derives write safety guidance from the contract safety flags', () => {
    const prompt = sut.generatePromptCheatSheet();

    for (const contract of contractService.listToolContracts()) {
      expect(contract.safety.allowsDirectMutation, contract.name).toBe(false);
      expect(contract.safety.requiresGalleryApplyForWrites, contract.name).toBe(true);
    }
    expect(prompt).toContain('No direct apply/write');
    expect(prompt).toContain('Gallery applies after review');
  });

  it('does not expose direct apply or unsafe implementation details', () => {
    const prompt = sut.generatePromptCheatSheet();

    expect(prompt).not.toMatch(/bearer\s+[a-z0-9._~+/-]+=*/i);
    expect(prompt).not.toMatch(/provider-key/i);
    expect(prompt).not.toMatch(/stack trace/i);
    expect(prompt).not.toMatch(/(^|\s)\/(?:home|tmp|var|usr|etc)\//);
    expect(prompt).not.toContain('/agent/internal/mcp');
    expect(prompt).not.toMatch(/applyAlbumOperations|applyOperations/);
    expect(prompt).not.toMatch(/mcp_gallery_apply\w*/);
    expect(prompt).not.toMatch(/mcp_gallery_\w*(apply|execute|mutate|write|delete|destroy|directWrite)\w*/i);
  });

  it('validates every structured prompt example against the tool DTO schemas', () => {
    const readToolNames = new Set<AgentToolName>(
      contractService.listReadToolContracts().map((contract) => contract.name),
    );

    for (const example of sut.listPromptExamples()) {
      if (readToolNames.has(example.toolName)) {
        AgentReadToolRequestSchemas[example.toolName as AgentMcpReadToolName].parse(example.arguments);
        continue;
      }

      AgentOperationPlanToolRequestSchemas[example.toolName as AgentMcpPlanningToolName].parse(example.arguments);
    }
  });

  it('exports a generated ESM module that round-trips exact prompt text', async () => {
    const moduleText = sut.generateAgentRunnerModule();
    const directory = await mkdtemp(join(tmpdir(), 'gallery-mcp-prompt-'));
    const modulePath = join(directory, 'prompt.mjs');

    try {
      expect(moduleText).toContain('Generated by server/src/bin/sync-agent-mcp-prompt.ts');
      expect(moduleText).toContain('export const galleryMcpPromptCheatSheet =');

      await writeFile(modulePath, moduleText);
      const imported = (await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)) as {
        galleryMcpPromptCheatSheet: string;
      };

      expect(imported.galleryMcpPromptCheatSheet).toBe(sut.generatePromptCheatSheet());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps the committed runner prompt module in sync with the renderer', async () => {
    const modulePath = join(
      process.cwd(),
      '..',
      'agent-runner',
      'src',
      'generated',
      'gallery-mcp-prompt-cheat-sheet.mjs',
    );
    const imported = (await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`)) as {
      galleryMcpPromptCheatSheet: string;
    };

    expect(imported.galleryMcpPromptCheatSheet).toBe(sut.generatePromptCheatSheet());
  });
});
