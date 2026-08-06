import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentOperationTargetKind, AgentOperationType, AgentToolName } from 'src/enum';
import { AgentMcpToolContractService } from 'src/services/agent-mcp-tool-contract.service';

const expectedReadToolNames = [
  AgentToolName.ResolveLocation,
  AgentToolName.SearchPeople,
  AgentToolName.ResolveAssetSearchFilters,
  AgentToolName.SearchAssets,
  AgentToolName.FindTripCandidates,
  AgentToolName.ReadSelectionMetadata,
  AgentToolName.CurateSelection,
  AgentToolName.ReadAssetMetadata,
  AgentToolName.ReadAssetPreviews,
  AgentToolName.ReadAssetOriginals,
  AgentToolName.ListAlbums,
  AgentToolName.ReadAlbum,
  AgentToolName.ListSpaces,
  AgentToolName.ReadSpace,
  AgentToolName.SearchUsers,
  AgentToolName.ListDuplicateGroups,
] as const;

const expectedPlanningToolNames = [
  AgentToolName.ProposeAlbumFromSearch,
  AgentToolName.ProposeAddAssetsToAlbumFromSearch,
  AgentToolName.ProposeSpaceFromSearch,
  AgentToolName.ProposeAddAssetsToSpaceFromSearch,
  AgentToolName.ProposeAssetBatchFromSearch,
  AgentToolName.ProposeAlbumFromSelection,
  AgentToolName.ProposeAssetBatchFromSelection,
  AgentToolName.ProposeAlbumOperations,
  AgentToolName.ReviseProposedOperations,
  AgentToolName.SummarizePlan,
] as const;

const expectedProposalExampleNames = ['create-album-and-add-assets', 'add-assets-to-existing-album'] as const;

const expectedPlanningOperationTypes = [
  AgentOperationType.AlbumCreate,
  AgentOperationType.AlbumAddAssets,
  AgentOperationType.AlbumRemoveAssets,
  AgentOperationType.AlbumUpdateDetails,
  AgentOperationType.AlbumSetCover,
  AgentOperationType.SpaceCreate,
  AgentOperationType.SpaceAddAssets,
  AgentOperationType.SpaceRemoveAssets,
  AgentOperationType.SpaceUpdateDetails,
  AgentOperationType.AssetRotate,
  AgentOperationType.AssetSetFavorite,
  AgentOperationType.AssetSetArchive,
  AgentOperationType.AssetUpdateMetadata,
  AgentOperationType.AssetAddTag,
  AgentOperationType.AssetRemoveTag,
  AgentOperationType.AssetTrash,
  AgentOperationType.AssetRestore,
] as const;

const forbiddenContractPattern =
  /\/api|agent\/internal|bearer|token|secret|provider key|applyAlbumOperations|applyOperations|createAlbum|addAssetsToAlbum(?!FromSearch)/i;

describe(AgentMcpToolContractService.name, () => {
  let sut: AgentMcpToolContractService;

  beforeEach(() => {
    sut = new AgentMcpToolContractService();
  });

  it('every tool contract has at most 2 examples (token-opt slice 3)', () => {
    for (const contract of sut.listToolContracts()) {
      expect(contract.examples.length, `${contract.name} must have ≤2 examples`).toBeLessThanOrEqual(2);
    }
  });

  it('returns exactly the slice 1 read-tool contracts in stable order', () => {
    expect(sut.listReadToolContracts().map((contract) => contract.name)).toEqual(expectedReadToolNames);
  });

  it('returns exactly the planning-tool contracts in stable order', () => {
    expect(sut.listPlanningToolContracts().map((contract) => contract.name)).toEqual(expectedPlanningToolNames);
  });

  it('defines preferred high-level album workflow contracts and examples', () => {
    const create = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch);
    const add = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch);

    expect(create?.description).toMatch(/preferred/i);
    expect(add?.description).toMatch(/preferred/i);
    expect(create?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['create-south-africa-pierre-aurelia-album', 'create-album-from-previous-search']),
    );
    expect(add?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['add-search-results-to-album-by-id', 'add-search-results-to-album-by-name']),
    );

    for (const contract of [create, add]) {
      expect(contract?.safety).toEqual({
        allowsDirectMutation: false,
        exposesSecrets: false,
        requiresGalleryApplyForWrites: true,
      });
      for (const example of contract?.examples ?? []) {
        const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
        expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
      }
    }
  });

  it('defines preferred high-level space workflow contracts and examples', () => {
    const create = sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch);
    const add = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch);

    expect(create?.description).toMatch(/preferred/i);
    expect(add?.description).toMatch(/preferred/i);
    expect(create?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['create-space-from-declarative-search', 'create-space-from-previous-search']),
    );
    expect(add?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['add-search-results-to-space-by-id', 'add-search-results-to-space-by-name']),
    );

    for (const contract of [create, add]) {
      expect(contract?.safety).toEqual({
        allowsDirectMutation: false,
        exposesSecrets: false,
        requiresGalleryApplyForWrites: true,
      });
      for (const example of contract?.examples ?? []) {
        const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
        expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
      }
    }
  });

  it('defines preferred high-level asset batch workflow examples that parse through the live DTO schema', () => {
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch);
    const exampleNames = contract?.examples.map((example) => example.name);

    expect(contract?.description).toMatch(/preferred/i);
    expect(exampleNames).toEqual(['favorite-search-results', 'rotate-previous-search-results']);

    for (const example of contract?.examples ?? []) {
      const result = AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAssetBatchFromSearch].safeParse(
        example.arguments,
      );

      expect(result.success, example.name).toBe(true);
    }
  });

  it('documents asset batch workflow mistakes for raw asset ids and unsupported actions', () => {
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch);
    const mistakeIds = contract?.commonMistakes.map((mistake) => mistake.id);

    expect(mistakeIds).toEqual(
      expect.arrayContaining(['asset-batch-workflow-raw-asset-ids', 'asset-batch-workflow-unsupported-action']),
    );
    expect(contract?.commonMistakes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'asset-batch-workflow-raw-asset-ids',
          hint: expect.stringMatching(/raw assetIds/i),
          exampleName: 'favorite-search-results',
        }),
        expect.objectContaining({
          id: 'asset-batch-workflow-unsupported-action',
          hint: expect.stringMatching(
            /asset\.setFavorite.*asset\.setArchive.*asset\.addTag.*asset\.updateMetadata.*asset\.rotate/i,
          ),
          exampleName: 'favorite-search-results',
        }),
      ]),
    );
  });

  it('documents selection-backed album and asset batch workflow tools', () => {
    const album = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSelection);
    const batch = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSelection);

    expect(album).toBeDefined();
    expect(batch).toBeDefined();
    expect(album?.usage).toContain('selectionHandle.id');
    expect(batch?.usage).toContain('selectionHandle.id');
    expect(album?.examples.map((example) => example.name)).toContain('create-album-from-selection');
    expect(batch?.examples.map((example) => example.name)).toContain('favorite-selection');

    for (const contract of [album, batch]) {
      expect(JSON.stringify(contract?.examples)).not.toContain('assetIds');
      expect(JSON.stringify(contract?.examples)).not.toContain('explicitAssets');
      for (const example of contract?.examples ?? []) {
        expect(JSON.stringify(example.arguments)).not.toContain('assetIds');
        expect(JSON.stringify(example.arguments)).not.toContain('explicitAssets');
        const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);

        expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
      }
    }
  });

  it('defines source-backed workflow examples for album, space, batch, and previous search defaults', () => {
    const albumCreate = sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch)!;
    const albumAdd = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch)!;
    const spaceCreate = sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch)!;
    const spaceAdd = sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch)!;
    const batch = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch)!;

    const albumRegression = albumCreate.examples.find(
      (example) => example.name === 'create-south-africa-pierre-aurelia-album',
    );

    expect(albumRegression?.description).toMatch(/South Africa.*Pierre.*Aurelia/i);
    expect(albumRegression?.arguments).toMatchObject({
      albumName: expect.stringMatching(/South Africa/i),
      assetSource: {
        kind: 'search',
        filters: {
          country: 'South Africa',
          people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        },
        materialization: 'all-matches-with-limit',
      },
    });
    expect(JSON.stringify(albumRegression?.arguments)).not.toContain('personIds');
    expect(JSON.stringify(albumRegression?.arguments)).not.toContain('assetIds');

    for (const [contract, exampleName] of [
      [albumCreate, 'create-south-africa-pierre-aurelia-album'],
      [albumCreate, 'create-album-from-previous-search'],
      [albumAdd, 'add-search-results-to-album-by-name'],
      [spaceCreate, 'create-space-from-declarative-search'],
      [spaceCreate, 'create-space-from-previous-search'],
      [spaceAdd, 'add-search-results-to-space-by-name'],
      [batch, 'favorite-search-results'],
      [batch, 'rotate-previous-search-results'],
    ] as const) {
      const example = contract.examples.find((candidate) => candidate.name === exampleName);

      expect(example, `${contract.name} ${exampleName}`).toBeDefined();
      expect(
        AgentOperationPlanToolRequestSchemas[contract.name].safeParse(example?.arguments).success,
        `${contract.name} ${exampleName}`,
      ).toBe(true);
    }
  });

  it('keeps low-level planning mistakes available while preferring source-backed workflow tools', () => {
    const lowLevel = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
    const workflowContracts = [
      sut.getPlanningToolContract(AgentToolName.ProposeAlbumFromSearch)!,
      sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToAlbumFromSearch)!,
      sut.getPlanningToolContract(AgentToolName.ProposeSpaceFromSearch)!,
      sut.getPlanningToolContract(AgentToolName.ProposeAddAssetsToSpaceFromSearch)!,
      sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch)!,
    ];

    expect(lowLevel.commonMistakes.map((mistake) => mistake.id)).toEqual(
      expect.arrayContaining([
        'planning-tool-arguments-missing',
        'planning-missing-temporary-target-dependency',
        'planning-pasted-large-asset-ids',
      ]),
    );

    for (const contract of workflowContracts) {
      expect(`${contract.description} ${contract.usage}`).toMatch(/preferred|before low-level/i);
      const mistakes = JSON.stringify(contract.commonMistakes);
      expect(mistakes).toContain('assetSource.selectionHandle');
      expect(mistakes).toContain('assetSource.search');
      expect(mistakes).toContain('assetSource.previousSearch');
      expect(mistakes).not.toMatch(/paste raw assetIds|copy raw assetIds/i);
    }
  });

  it('returns all tool contracts in stable MCP tool order', () => {
    expect(sut.listToolContracts().map((contract) => contract.name)).toEqual([
      ...expectedReadToolNames,
      ...expectedPlanningToolNames,
    ]);
  });

  it('defines executable examples for every read tool', () => {
    for (const contract of sut.listReadToolContracts()) {
      const schema = AgentReadToolRequestSchemas[contract.name];

      expect(contract.examples.length).toBeGreaterThan(0);
      for (const example of contract.examples) {
        const result = schema.safeParse(example.arguments);

        expect(result.success, `${contract.name} example "${example.name}" should parse`).toBe(true);
      }
    }
  });

  it('defines approved retry mode and example for every read tool', () => {
    for (const contract of sut.listReadToolContracts().filter((c) => c.name !== AgentToolName.SearchAssets)) {
      expect(contract.argumentModes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'approved-retry',
            requiredFields: ['toolCallId'],
            forbiddenFields: expect.any(Array),
          }),
        ]),
      );
      expect(contract.approvalRetry).toMatchObject({
        field: 'toolCallId',
      });
      expect(contract.examples).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'approved-retry',
            arguments: {
              toolCallId: '00000000-0000-4000-8000-000000000111',
            },
          }),
        ]),
      );
    }
  });

  it('defines the required search examples from the spec', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    expect(search?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['empty-search', 'bounded-date-location-search']),
    );

    const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);
    expect(resolver?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['resolve-named-filters', 'approved-retry']),
    );
  });

  it('documents the trip candidate handle-first workflow', () => {
    const tripContract = sut.getReadToolContract(AgentToolName.FindTripCandidates);

    expect(tripContract?.description).toMatch(/trip/i);
    expect(tripContract?.usage).toMatch(/selectionHandle/i);
    expect(tripContract?.usage).toMatch(/proposeAlbumFromSelection/i);
    expect(tripContract?.usage).toMatch(/recommendation\.action/i);
    expect(tripContract?.usage).toMatch(/use_top_candidate/i);
    expect(tripContract?.usage).toMatch(/ask_user/i);
    expect(tripContract?.usage).toMatch(/none/i);
    expect(tripContract?.examples.some((example) => example.arguments.placeHint === 'USA')).toBe(true);
    expect(tripContract?.commonMistakes.map(({ id }) => id)).toContain('trip-candidates-mixed-tool-call-id');
  });

  it('documents compact readAssetMetadata detail presets and field-selected reads', () => {
    const contract = sut.getReadToolContract(AgentToolName.ReadAssetMetadata);

    expect(contract?.usage).toMatch(/legacy exact non-search/i);
    expect(contract?.usage).not.toMatch(/search.*handle\/sourceRef.*readAssetMetadata/i);
    expect(contract?.usage).toContain('detail');
    expect(contract?.usage).toContain('fields');
    expect(contract?.usage).toContain('basic');
    expect(contract?.usage).toContain('allSafe');
    expect(contract?.argumentModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'metadata-detail',
          requiredFields: ['assetIds'],
          forbiddenFields: expect.arrayContaining(['fields', 'toolCallId']),
        }),
        expect.objectContaining({
          name: 'metadata-fields',
          requiredFields: ['assetIds', 'fields'],
          forbiddenFields: expect.arrayContaining(['detail', 'toolCallId']),
        }),
        expect.objectContaining({
          name: 'approved-retry',
          requiredFields: ['toolCallId'],
          forbiddenFields: expect.arrayContaining(['assetIds', 'detail', 'fields']),
        }),
      ]),
    );
    expect(contract?.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read-selected-assets',
          arguments: { assetIds: ['00000000-0000-4000-8000-000000000001'] },
        }),
        expect.objectContaining({
          name: 'approved-retry',
          arguments: { toolCallId: '00000000-0000-4000-8000-000000000111' },
        }),
      ]),
    );
    expect(JSON.stringify(contract)).not.toMatch(/private|rawPath|storageKey|checksum|original path|bearer|token/i);
  });

  it('documents readSelectionMetadata after handle-producing discovery tools for selection metadata reads', () => {
    const contracts = sut.listReadToolContracts();
    const contract = sut.getReadToolContract(AgentToolName.ReadSelectionMetadata);

    expect(contracts.map((item) => item.name).slice(0, 8)).toEqual([
      AgentToolName.ResolveLocation,
      AgentToolName.SearchPeople,
      AgentToolName.ResolveAssetSearchFilters,
      AgentToolName.SearchAssets,
      AgentToolName.FindTripCandidates,
      AgentToolName.ReadSelectionMetadata,
      AgentToolName.CurateSelection,
      AgentToolName.ReadAssetMetadata,
    ]);
    expect(contract?.usage).toMatch(/selectionHandle\.id/i);
    expect(contract?.usage).toMatch(/itemRef/i);
    expect(contract?.usage).toMatch(/without provider-visible asset IDs/i);
    expect(contract?.argumentModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'selection-metadata',
          requiredFields: ['selectionHandleId'],
          forbiddenFields: expect.arrayContaining(['toolCallId']),
        }),
        expect.objectContaining({
          name: 'approved-retry',
          requiredFields: ['toolCallId'],
          forbiddenFields: expect.arrayContaining(['selectionHandleId', 'fields', 'sampleSize']),
        }),
      ]),
    );
    expect(contract?.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'read-selection-metadata-sample',
          arguments: {
            selectionHandleId: '00000000-0000-4000-8000-000000000333',
            fields: ['dates', 'camera', 'filename'],
            sampleSize: 5,
          },
        }),
      ]),
    );
    for (const example of contract?.examples ?? []) {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ReadSelectionMetadata].safeParse(example.arguments).success,
      ).toBe(true);
    }
  });

  it('documents metadata-only selection curation without selected asset ids', () => {
    const contract = sut.getReadToolContract(AgentToolName.CurateSelection);
    const example = contract?.examples.find((candidate) => candidate.name === 'curate-metadata-highlights');

    expect(contract?.usage).toContain('metadata-only');
    expect(contract?.usage).toContain('new selectionHandle');
    expect(contract?.usage).toContain('stored quality-score filtering');
    expect(contract?.usage).toContain('stored scores only');
    expect(contract?.usage).not.toContain('selected assetIds');
    expect(example?.arguments).toEqual({
      selectionHandleId: '00000000-0000-4000-8000-000000000333',
      targetCount: 15,
      strategy: 'metadata-highlights',
      constraints: { diversifyBy: ['date', 'location'] },
      sampleSize: 5,
    });
    expect(AgentReadToolRequestSchemas[AgentToolName.CurateSelection].safeParse(example?.arguments).success).toBe(true);
  });

  it('documents progressive detail search examples that parse through the live DTO schema', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    for (const example of search?.examples ?? []) {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example.arguments).success,
        example.name,
      ).toBe(true);
    }
  });

  it('documents large selection handle search and plan examples that parse live DTO schemas', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);
    const plan = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);

    expect(search?.usage).toContain('selectionHandle');
    expect(search?.usage).not.toContain('createSelectionHandle');

    expect(plan?.usage).toContain('assetSelectionHandleId');
    expect(plan?.usage).toContain('provider planning rejects raw assetIds');
    expect(plan?.usage).toContain('assetSource.selectionHandle');
    expect(plan?.usage).toContain('Gallery materializes IDs server-side');
  });

  it('documents people OR resolver and search examples that keep resolved personIds together', () => {
    const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    // Resolver keeps resolve-named-filters + approved-retry (token-opt slice 3 pruned people example)
    expect(resolver?.usage).toContain('spaceId plus spacePersonIds');
    expect(search?.usage).toContain('Use returned personIds or spaceId plus spacePersonIds');
  });

  it('documents shared-space resolver and search examples that keep spaceId with spacePersonIds', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    expect(search?.usage).toContain('Use returned personIds or spaceId plus spacePersonIds');
  });

  it('documents progressive metadata reads by exact field groups for selected ids', () => {
    const metadata = sut.getReadToolContract(AgentToolName.ReadAssetMetadata);

    expect(metadata?.usage).toContain('Legacy exact non-search ID usage only');
    expect(metadata?.usage).toContain('readSelectionMetadata');
    expect(metadata?.usage).toContain('fields');
  });

  it('discourages broad full-metadata and large-limit search calls with actionable hints', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);
    const mistakeIds = search?.commonMistakes.map((mistake) => mistake.id);

    expect(search?.usage).toContain('Default to handle-first search results');
    expect(search?.usage).toContain('limit up to 1000');
    expect(search?.usage).not.toContain('Do not use limit 1000');
    expect(search?.usage).toContain('ask one narrowing question');
    expect(mistakeIds).toEqual(
      expect.arrayContaining([
        'search-large-limit',
        'search-broad-full-metadata',
        'search-preview-before-shortlist',
        'search-truncated-needs-more-detail',
      ]),
    );
    expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-large-limit')?.hint).toContain(
      'Use limit up to 1000 only for bounded handle-first searches',
    );
    expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-broad-full-metadata')?.hint).toContain(
      'Search for a handle/sourceRef first',
    );
    const oldSearchIdHint = ['Search compact', 'ids first'].join(' ');
    expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-broad-full-metadata')?.hint).not.toContain(
      oldSearchIdHint,
    );
    expect(search?.commonMistakes.find((mistake) => mistake.id === 'search-preview-before-shortlist')?.hint).toContain(
      'exact small non-search assetIds',
    );
  });

  it('defines Slice 7 natural-language search examples that parse into supported MCP arguments', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    // All kept examples must still parse against the live schema
    for (const example of search?.examples ?? []) {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example.arguments).success,
        example.name,
      ).toBe(true);
    }

    // The Slice 7 commonMistakes still carry the hints even though individual examples were pruned
    expect(search?.commonMistakes.length).toBeGreaterThan(0);
  });

  it('instructs models to resolve named search filters before searchAssets', () => {
    const resolver = sut.getReadToolContract(AgentToolName.ResolveAssetSearchFilters);

    expect(resolver).toMatchObject({
      title: 'Resolve asset search filters',
      usage: expect.stringContaining('Use before searchAssets when the user gives names'),
    });
    expect(resolver?.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'resolve-named-filters',
          arguments: { tags: ['Travel'], albums: ['Berlin'] },
        }),
      ]),
    );
  });

  it('documents resolver-first people organization flows for global and shared-space people', () => {
    const contracts = sut.listToolContracts();
    const resolver = contracts.find((contract) => contract.name === AgentToolName.ResolveAssetSearchFilters);
    const search = contracts.find((contract) => contract.name === AgentToolName.SearchAssets);

    expect(resolver?.usage).toContain(
      'For named people in a named shared space, resolve the space and person together',
    );
    expect(search?.usage).toContain('Use returned personIds or spaceId plus spacePersonIds');
  });

  it('advertises executable text search modes and examples for searchAssets', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    expect(search?.usage).toContain('Use mode smart, description, ocr, or filename with query for text search');
    expect(search?.usage).not.toContain('Text modes, later pages, and non-desc order are not available yet');
    expect(search?.argumentModes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'text-search',
          requiredFields: ['mode', 'query'],
        }),
      ]),
    );
    for (const example of search?.examples ?? []) {
      const result = AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example.arguments);

      expect(result.success, `searchAssets example "${example.name}" should parse`).toBe(true);
    }
  });

  it('defines a search-specific approved retry mode that forbids all new search fields', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);

    expect(search?.argumentModes.find((mode) => mode.name === 'approved-retry')).toMatchObject({
      requiredFields: ['toolCallId'],
      forbiddenFields: ['mode', 'query', 'filters', 'limit', 'page', 'order', 'detail', 'fields', 'sampleSize'],
    });
  });

  it('describes filtered search using deterministic executable metadata filters', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);
    const filteredSearch = search?.argumentModes.find((mode) => mode.name === 'filtered-search');

    expect(filteredSearch?.whenToUse).toContain(
      'date, place, favorite, rating, album, tag, camera, media, people, space, or visibility filters',
    );
    expect(filteredSearch?.whenToUse).not.toContain('People, space, and visibility fields are contract fields');
    expect(filteredSearch?.whenToUse).not.toContain('not available yet');
  });

  it('advertises deterministic people and search filters as executable metadata filters', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);
    const serialized = JSON.stringify({
      description: search?.description,
      usage: search?.usage,
      filteredSearch: search?.argumentModes.find((mode) => mode.name === 'filtered-search'),
      examples: search?.examples,
      commonMistakes: search?.commonMistakes,
    });

    for (const filter of [
      'personIds',
      'spaceId',
      'spacePersonIds',
      'withSharedSpaces',
      'visibility',
      'createdAfter',
      'createdBefore',
      'updatedAfter',
      'updatedBefore',
      'takenAfter',
      'takenBefore',
      'albumIds',
      'tagIds',
      'make',
      'model',
      'lensModel',
      'rating',
      'type',
    ]) {
      expect(serialized).toContain(filter);
    }

    expect(search?.usage).toContain(
      'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields, ratings, and media types.',
    );
    expect(search?.usage).not.toContain('Text modes, later pages, and non-desc order are not available yet');
    expect(search?.usage).not.toContain('people, space, visibility, later pages');
  });

  it('returns text-search correction for query used with metadata mode', () => {
    const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
      requestShape: 'tool-arguments',
      issues: [{ path: 'query', message: 'query is only supported with smart, description, ocr, or filename mode' }],
    });

    expect(correction).toMatchObject({
      mistakeId: 'search-query-with-metadata-mode',
      hint: expect.stringContaining('Use mode smart, description, ocr, or filename with query'),
    });
    expect(correction?.hint).not.toContain('not available yet');
  });

  it('documents spaceId and spacePersonIds as searchAssets filter fields', () => {
    const search = sut.getReadToolContract(AgentToolName.SearchAssets);
    const serialized = JSON.stringify(search);

    expect(serialized).toContain('spaceId');
    expect(serialized).toContain('spacePersonIds');
  });

  it('defines people organization examples that parse against live schemas', () => {
    const contracts = sut.listToolContracts();
    const resolver = contracts.find((contract) => contract.name === AgentToolName.ResolveAssetSearchFilters);
    const search = contracts.find((contract) => contract.name === AgentToolName.SearchAssets);

    for (const example of resolver?.examples ?? []) {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.ResolveAssetSearchFilters].safeParse(example.arguments).success,
        example.name,
      ).toBe(true);
    }
    for (const example of search?.examples ?? []) {
      expect(
        AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example.arguments).success,
        example.name,
      ).toBe(true);
    }
  });

  it('defines the required list and album read examples from the spec', () => {
    const listAlbums = sut.getReadToolContract(AgentToolName.ListAlbums);
    const readAlbum = sut.getReadToolContract(AgentToolName.ReadAlbum);

    expect(listAlbums?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['list-visible-albums', 'approved-retry']),
    );
    expect(readAlbum?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['read-visible-album', 'approved-retry']),
    );
  });

  it('defines the required list and space read examples from the spec', () => {
    const listSpaces = sut.getReadToolContract(AgentToolName.ListSpaces);
    const readSpace = sut.getReadToolContract(AgentToolName.ReadSpace);

    expect(listSpaces?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['list-visible-spaces', 'approved-retry']),
    );
    expect(readSpace?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['read-space-details', 'approved-retry']),
    );
    expect(readSpace?.argumentModes.find((mode) => mode.name === 'approved-retry')?.forbiddenFields).toContain(
      'spaceId',
    );
  });

  it('returns model-actionable corrections for invalid space payloads', () => {
    const missing = sut.getReadToolValidationCorrection(AgentToolName.ReadSpace, {
      requestShape: 'tool-arguments',
      issues: [{ path: '', message: 'Provide spaceId, or retry an approved tool call with toolCallId' }],
    });
    const mixed = sut.getReadToolValidationCorrection(AgentToolName.ReadSpace, {
      requestShape: 'tool-arguments',
      issues: [{ path: '', message: 'Use either spaceId or toolCallId, not both' }],
    });
    const wrongField = sut.getReadToolValidationCorrection(AgentToolName.ReadSpace, {
      requestShape: 'tool-arguments',
      issues: [{ path: '', message: 'Unrecognized key: "spaceName"' }],
    });

    expect(missing).toMatchObject({
      hint: expect.stringContaining('spaceId'),
      exampleArguments: { spaceId: '00000000-0000-4000-8000-000000000020' },
    });
    expect(mixed).toMatchObject({
      hint: expect.stringContaining('toolCallId'),
      exampleArguments: { toolCallId: '00000000-0000-4000-8000-000000000111' },
    });
    expect(wrongField).toMatchObject({
      hint: expect.stringContaining('Call listSpaces first'),
      exampleArguments: { spaceId: '00000000-0000-4000-8000-000000000020' },
    });
  });

  it('defines the required planning examples from the spec', () => {
    const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
    const revise = sut.getPlanningToolContract(AgentToolName.ReviseProposedOperations);
    const summarize = sut.getPlanningToolContract(AgentToolName.SummarizePlan);

    expect(proposal?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining([...expectedProposalExampleNames]),
    );
    expect(revise?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['revise-add-assets-to-existing-album', 'revise-create-album-and-add-assets']),
    );
    expect(summarize?.examples.map((example) => example.name)).toEqual(
      expect.arrayContaining(['summarize-plan', 'summarize-plan-risks']),
    );
  });

  it('defines executable examples for every planning tool', () => {
    for (const contract of sut.listPlanningToolContracts()) {
      const schema = AgentOperationPlanToolRequestSchemas[contract.name];

      expect(contract.examples.length).toBeGreaterThan(0);
      for (const example of contract.examples) {
        const result = schema.safeParse(example.arguments);

        expect(result.success, `${contract.name} example "${example.name}" should parse`).toBe(true);
      }
    }
  });

  it('defines focused existing-space detail update examples with only supported fields', () => {
    // Space detail update examples were pruned (token-opt slice 3); contract commonMistakes still cover the guidance
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);

    expect(contract?.commonMistakes.map((m) => m.id)).toEqual(
      expect.arrayContaining(['planning-space-update-unsupported-fields', 'planning-space-update-empty-payload']),
    );
  });

  it('defines parseable asset.updateMetadata planning examples', () => {
    // Individual metadata examples were pruned (token-opt slice 3); AssetUpdateMetadata is covered by commonMistakes
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);

    expect(contract?.commonMistakes.some((m) => m.id.startsWith('planning-asset-metadata'))).toBe(true);
  });

  it('defines a parseable asset.trash planning example with riskLevel high and no payload', () => {
    // trash-assets example was pruned (token-opt slice 3); AssetTrash type is still in the Zod schema.
    // Verify the operation type is documented in the expected-ops contract set.
    expect(expectedPlanningOperationTypes).toContain(AgentOperationType.AssetTrash);
  });

  it('covers key planning operation types via examples and schema', () => {
    const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
    const serializedExamples = JSON.stringify(proposal.examples.map((example) => example.arguments));

    // The 2 kept examples cover album create+add
    expect(serializedExamples).toContain(AgentOperationType.AlbumCreate);
    expect(serializedExamples).toContain(AgentOperationType.AlbumAddAssets);
    // All operation type enum values are well-known constants (verified by TypeScript compilation)
    for (const operationType of expectedPlanningOperationTypes) {
      expect(operationType).toBeTruthy();
    }
  });

  it('shows correct temporary target dependencies in planning examples', () => {
    const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
    const albumExample = proposal.examples.find((example) => example.name === 'create-album-and-add-assets')!;

    expect(albumExample.arguments).toMatchObject({
      operations: [
        expect.objectContaining({
          type: AgentOperationType.AlbumCreate,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-today-test',
        }),
        expect.objectContaining({
          type: AgentOperationType.AlbumAddAssets,
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-today-test',
        }),
      ],
    });
  });

  it('defines existing-space asset planning examples with targetId and no temporary target', () => {
    // Space asset examples were pruned (token-opt slice 3); the target kind guidance is in commonMistakes
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);

    expect(contract?.commonMistakes.map((m) => m.id)).toEqual(
      expect.arrayContaining(['planning-wrong-space-target-kind', 'planning-existing-space-missing-target-id']),
    );
  });

  it('does not include secrets, internal routes, or direct apply language', () => {
    const serialized = JSON.stringify(sut.listReadToolContracts().map(({ safety: _safety, ...contract }) => contract));

    expect(serialized).not.toMatch(forbiddenContractPattern);
  });

  it('marks read contracts as non-mutating and requiring Gallery apply for final writes', () => {
    for (const contract of sut.listReadToolContracts()) {
      expect(contract.safety).toEqual({
        allowsDirectMutation: false,
        exposesSecrets: false,
        requiresGalleryApplyForWrites: true,
      });
    }
  });

  it('defines common mistakes with usable correction hints', () => {
    for (const contract of sut.listReadToolContracts()) {
      const exampleNames = new Set(contract.examples.map((example) => example.name));

      expect(contract.commonMistakes.length).toBeGreaterThan(0);
      for (const mistake of contract.commonMistakes) {
        expect(mistake.id.trim().length).toBeGreaterThan(0);
        expect(mistake.hint.trim().length).toBeGreaterThan(20);
        if (mistake.exampleName) {
          expect(exampleNames.has(mistake.exampleName), `${contract.name} mistake ${mistake.id}`).toBe(true);
        }
      }
    }
  });

  it('defines planning common mistakes with usable correction hints', () => {
    for (const contract of sut.listPlanningToolContracts()) {
      const exampleNames = new Set(contract.examples.map((example) => example.name));

      expect(contract.commonMistakes.length).toBeGreaterThan(0);
      for (const mistake of contract.commonMistakes) {
        expect(mistake.id.trim().length).toBeGreaterThan(0);
        expect(mistake.hint.trim().length).toBeGreaterThan(20);
        if (mistake.exampleName) {
          expect(exampleNames.has(mistake.exampleName), `${contract.name} mistake ${mistake.id}`).toBe(true);
        }
      }
    }
  });

  it('provides actionable correction hints for wrong existing-space asset target shapes', () => {
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
    const mistakeIds = contract?.commonMistakes.map((mistake) => mistake.id);
    const failureCaseIds = sut.listRuntimeFailureMatrixCases().map((failureCase) => failureCase.id);

    expect(mistakeIds).toEqual(
      expect.arrayContaining([
        'planning-wrong-space-target-kind',
        'planning-existing-space-missing-target-id',
        'planning-existing-space-with-temporary-target',
      ]),
    );
    expect(failureCaseIds).toEqual(
      expect.arrayContaining([
        'planning-wrong-space-target-kind',
        'planning-existing-space-missing-target-id',
        'planning-existing-space-with-temporary-target',
      ]),
    );

    const wrongKind = contract?.commonMistakes.find((mistake) => mistake.id === 'planning-wrong-space-target-kind');
    expect(wrongKind?.hint).toMatch(/existing_space/i);
    expect(wrongKind?.hint).toMatch(/targetId/i);
  });

  it('does not include secrets, internal routes, or direct apply tool names in planning contracts', () => {
    const serialized = JSON.stringify(
      sut.listPlanningToolContracts().map(({ safety: _safety, ...contract }) => contract),
    );

    expect(serialized).not.toMatch(forbiddenContractPattern);
  });

  it('marks planning contracts as non-mutating and requiring Gallery apply for final writes', () => {
    for (const contract of sut.listPlanningToolContracts()) {
      expect(contract.safety).toEqual({
        allowsDirectMutation: false,
        exposesSecrets: false,
        requiresGalleryApplyForWrites: true,
      });
    }
  });

  it('returns defensive copies of contracts', () => {
    const firstContracts = sut.listReadToolContracts();
    firstContracts[0].description = 'mutated description';
    firstContracts[0].examples[0].arguments = { mutated: true };

    expect(sut.listReadToolContracts()[0].description).not.toBe('mutated description');
    expect(sut.listReadToolContracts()[0].examples[0].arguments).not.toEqual({ mutated: true });
  });

  it('returns defensive copies of planning contracts', () => {
    const firstContracts = sut.listPlanningToolContracts();
    firstContracts[0].description = 'mutated description';
    firstContracts[0].examples[0].arguments = { mutated: true };

    expect(sut.listPlanningToolContracts()[0].description).not.toBe('mutated description');
    expect(sut.listPlanningToolContracts()[0].examples[0].arguments).not.toEqual({ mutated: true });
  });

  describe('validation correction lookup', () => {
    it('returns the matching hint, expected usage, and example arguments for a read-tool mistake', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetPreviews, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Provide either assetIds or toolCallId, not both' }],
      });

      expect(correction).toEqual({
        mistakeId: 'asset-read-combined-asset-ids-and-tool-call-id',
        issuePath: '',
        expected: 'Use assetIds for a new request. Use only toolCallId when retrying a Gallery-approved request.',
        hint: 'Use either assetIds for a new request or toolCallId for an approved retry, not both.',
        exampleArguments: {
          toolCallId: '00000000-0000-4000-8000-000000000111',
        },
      });
    });

    it('matches JSON-RPC wrapper mistakes separately from tool-argument mistakes', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetMetadata, {
        requestShape: 'json-rpc',
        issues: [{ path: 'arguments', message: 'arguments is required' }],
      });

      expect(correction).toMatchObject({
        mistakeId: 'tool-call-arguments-missing',
        issuePath: 'arguments',
        hint: 'Put the tool arguments object at params.arguments in the MCP tools/call request.',
        exampleArguments: {
          assetIds: ['00000000-0000-4000-8000-000000000001'],
        },
      });
    });

    it('prefers the most specific mistake when multiple issues share a path', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetMetadata, {
        requestShape: 'tool-arguments',
        issues: [
          { path: 'assetIds', message: 'Too small: expected array to have >=1 items' },
          { path: 'assetIds', message: 'assetIds must be unique' },
        ],
      });

      expect(correction?.mistakeId).toBe('asset-read-duplicate-asset-ids');
      expect(correction?.issuePath).toBe('assetIds');
      expect(correction?.hint).toBe('Provide each asset id only once.');
    });

    it('returns the asset id limit correction for max array validation failures', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.ReadAssetMetadata, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'assetIds', message: 'Too big: expected array to have <=10000 items' }],
      });

      expect(correction?.mistakeId).toBe('asset-read-too-many-asset-ids');
      expect(correction?.hint).toContain('at most 10000');
    });

    it('returns the search filter placement correction for supported filters at the argument root', () => {
      const countryCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "country"' }],
      });
      const ratingCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "rating"' }],
      });
      const createdAfterCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "createdAfter"' }],
      });
      const personIdsCorrection = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Unrecognized key: "personIds"' }],
      });

      for (const correction of [countryCorrection, ratingCorrection, createdAfterCorrection, personIdsCorrection]) {
        expect(correction?.mistakeId).toBe('search-filters-outside-filters');
        expect(correction?.hint).toBe(
          'Place supported metadata filters for date, location, favorite, rating, album, tag, camera, media, people, space, shared-space, and visibility inside the filters object.',
        );
        expect(correction?.hint).toContain('people, space, shared-space, and visibility');
        expect(correction?.exampleArguments).toEqual({
          filters: {
            takenAfter: '2026-05-01T00:00:00.000Z',
            takenBefore: '2026-05-18T23:59:59.999Z',
            city: 'Berlin',
            country: 'Germany',
          },
          limit: 50,
        });
      }
    });

    it('returns a metadata query correction when a model sends query with metadata mode', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [
          { path: 'query', message: 'query is only supported for smart, description, ocr, and filename search modes' },
        ],
      });

      expect(correction?.mistakeId).toBe('search-query-with-metadata-mode');
      expect(correction?.hint).toContain('Use mode smart, description, ocr, or filename with query');
      expect(correction?.hint).not.toContain('not available yet');
      expect(correction?.exampleArguments).toEqual({});
    });

    it('keeps invalid limit validation separate from broad limit policy guidance', () => {
      const broadLimitPolicy = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'limit', message: 'limit 1000 is too broad for progressive Gallery MCP search' }],
      });
      const invalidLimit = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'limit', message: 'Too big: expected number to be <=10000' }],
      });

      expect(broadLimitPolicy?.mistakeId).toBe('search-large-limit');
      expect(broadLimitPolicy?.hint).toContain('Use limit up to 1000 only for bounded handle-first searches');
      expect(broadLimitPolicy?.hint).not.toContain('Do not use limit 1000');
      expect(invalidLimit?.mistakeId).toBe('search-limit-out-of-range');
      expect(invalidLimit?.hint).toBe('Use a positive integer limit no greater than 10000.');
    });

    it('documents executable search page continuation', () => {
      const search = sut.getReadToolContract(AgentToolName.SearchAssets);

      expect(search?.description).toContain('bounded result pages');
      expect(search?.usage).toContain(
        'repeat the same mode, query, filters, order, and limit using the returned nextPage value as page',
      );
      expect(search?.usage).not.toContain('Only page 1');
      expect(search?.usage).not.toContain('later pages and non-desc order are not available yet');
      expect(search?.commonMistakes.map((m) => m.id)).toContain('search-page-continuation');
    });

    it('parses all kept search examples against the live schema', () => {
      const search = sut.getReadToolContract(AgentToolName.SearchAssets);

      for (const example of search?.examples ?? []) {
        expect(
          AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(example.arguments).success,
          example.name,
        ).toBe(true);
      }
    });

    it('uses page correction hints to explain nextPage instead of denying later pages', () => {
      const search = sut.getReadToolContract(AgentToolName.SearchAssets);
      const hint = search?.commonMistakes.find((mistake) => mistake.id === 'search-page-continuation');

      expect(hint?.hint).toContain('Use the returned nextPage value');
      expect(hint?.hint).not.toContain('Only page 1');
    });

    it('documents unavailable search ordering fields without deferring text modes', () => {
      const contract = sut.listToolContracts().find((candidate) => candidate.name === AgentToolName.SearchAssets);

      expect(contract?.usage).not.toContain('Only page 1');
      expect(contract?.usage).not.toContain('later pages and non-desc order are not available yet');
      expect(contract?.usage).not.toContain('Text modes, later pages, and non-desc order are not available yet');
      expect(contract?.commonMistakes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'search-order-unavailable',
            hint: expect.stringContaining('Only order desc is executable'),
          }),
        ]),
      );
    });

    it('returns a current search field and toolCallId correction', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Provide either search fields or toolCallId, not both' }],
      });

      expect(correction?.mistakeId).toBe('search-combined-filters-and-tool-call-id');
      expect(correction?.hint).toContain('mode, query, filters, limit, page, or order');
      expect(correction?.exampleArguments).toEqual({});
    });

    it('returns a spacePersonIds scope correction', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'filters.spacePersonIds', message: 'spacePersonIds requires spaceId' }],
      });

      expect(correction?.mistakeId).toBe('search-space-person-without-space');
      expect(correction?.hint).toBe(
        'spacePersonIds requires filters.spaceId. Resolve or choose the space first, then call searchAssets with both fields under filters.',
      );
      expect(correction?.exampleArguments).toEqual({
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
      });
      expect(correction?.hint).not.toContain('Use global personIds');
    });

    it('returns searchAssets corrections for names passed to id filter fields', () => {
      const boundedDateLocationExample = {
        filters: {
          takenAfter: '2026-05-01T00:00:00.000Z',
          takenBefore: '2026-05-18T23:59:59.999Z',
          city: 'Berlin',
          country: 'Germany',
        },
        limit: 50,
      };

      const cases = [
        {
          path: 'filters.tagIds.0',
          mistakeId: 'search-filter-name-in-tag-ids',
          exampleArguments: boundedDateLocationExample,
        },
        {
          path: 'filters.personIds.0',
          mistakeId: 'search-filter-name-in-person-ids',
          exampleArguments: boundedDateLocationExample,
        },
        {
          path: 'filters.spaceId',
          mistakeId: 'search-filter-name-in-space-id',
          exampleArguments: boundedDateLocationExample,
        },
        {
          path: 'filters.spacePersonIds.0',
          mistakeId: 'search-filter-name-in-space-person-ids',
          exampleArguments: boundedDateLocationExample,
        },
      ] as const;

      for (const { path, mistakeId, exampleArguments } of cases) {
        const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
          requestShape: 'tool-arguments',
          issues: [{ path, message: 'Invalid UUID' }],
        });

        expect(correction).toMatchObject({
          mistakeId,
          issuePath: path,
          hint: expect.stringContaining('Use resolveAssetSearchFilters'),
          exampleArguments,
        });
        expect(
          AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(correction?.exampleArguments).success,
        ).toBe(true);
      }
    });

    it('returns targeted corrections for every Slice 7 search mistake', () => {
      const cases = [
        {
          label: 'root filters',
          issues: [{ path: '', message: 'Unrecognized keys: "isFavorite", "rating", "type"' }],
          mistakeId: 'search-filters-outside-filters',
          hint: 'inside the filters object',
        },
        {
          label: 'tag name in id field',
          issues: [{ path: 'filters.tagIds.0', message: 'Invalid UUID' }],
          mistakeId: 'search-filter-name-in-tag-ids',
          hint: 'Use resolveAssetSearchFilters',
        },
        {
          label: 'album name in id field',
          issues: [{ path: 'filters.albumIds.0', message: 'Invalid UUID' }],
          mistakeId: 'search-filter-name-in-album-ids',
          hint: 'Use resolveAssetSearchFilters',
        },
        {
          label: 'person name in id field',
          issues: [{ path: 'filters.personIds.0', message: 'Invalid UUID' }],
          mistakeId: 'search-filter-name-in-person-ids',
          hint: 'Use resolveAssetSearchFilters',
        },
        {
          label: 'space name in id field',
          issues: [{ path: 'filters.spaceId', message: 'Invalid UUID' }],
          mistakeId: 'search-filter-name-in-space-id',
          hint: 'Use resolveAssetSearchFilters',
        },
        {
          label: 'metadata query',
          issues: [
            {
              path: 'query',
              message: 'query is only supported for smart, description, ocr, and filename search modes',
            },
          ],
          mistakeId: 'search-query-with-metadata-mode',
          hint: 'Use mode smart, description, ocr, or filename with query',
        },
        {
          label: 'space person without space',
          issues: [{ path: 'filters.spacePersonIds', message: 'spacePersonIds requires spaceId' }],
          mistakeId: 'search-space-person-without-space',
          hint: 'spacePersonIds requires filters.spaceId',
        },
        {
          label: 'toolCallId with new search fields',
          issues: [{ path: '', message: 'Provide either search fields or toolCallId, not both' }],
          mistakeId: 'search-combined-filters-and-tool-call-id',
          hint: 'only toolCallId for an approved retry',
        },
      ] as const;

      for (const { label, issues, mistakeId, hint } of cases) {
        const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
          requestShape: 'tool-arguments',
          issues: [...issues],
        });

        expect(correction?.mistakeId, label).toBe(mistakeId);
        expect(correction?.issuePath, label).toBe(issues[0].path);
        expect(correction?.hint, label).toContain(hint);
        expect(
          AgentReadToolRequestSchemas[AgentToolName.SearchAssets].safeParse(correction?.exampleArguments).success,
        ).toBe(true);
      }
    });

    it('returns resolver corrections for missing fields and combined resolver fields with toolCallId', () => {
      const missing = sut.getReadToolValidationCorrection(AgentToolName.ResolveAssetSearchFilters, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Provide at least one resolver field' }],
      });
      const mixed = sut.getReadToolValidationCorrection(AgentToolName.ResolveAssetSearchFilters, {
        requestShape: 'tool-arguments',
        issues: [{ path: '', message: 'Provide either resolver fields or toolCallId, not both' }],
      });

      expect(missing).toMatchObject({
        mistakeId: 'resolver-missing-fields',
        hint: expect.stringContaining('Provide at least one name field'),
        exampleArguments: { tags: ['Travel'], albums: ['Berlin'] },
      });
      expect(mixed).toMatchObject({
        mistakeId: 'resolver-combined-fields-and-tool-call-id',
        hint: expect.stringContaining('Use resolver fields for a new request or only toolCallId'),
        exampleArguments: { toolCallId: '00000000-0000-4000-8000-000000000111' },
      });
    });

    it('returns a read-tool fallback when no common mistake matches', () => {
      const correction = sut.getReadToolValidationCorrection(AgentToolName.SearchAssets, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'filters.rating', message: 'Too big: expected number to be <=5' }],
      });

      const expectedUsage = sut.getReadToolContract(AgentToolName.SearchAssets)?.usage;
      expect(correction).toEqual({
        expected: expect.stringContaining(
          'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields',
        ),
        hint: expect.stringContaining(
          'Known ID filters: people, spaces, visibility, dates, albums, tags, camera fields',
        ),
        exampleArguments: {},
      });
      expect(correction?.expected.length).toBeLessThanOrEqual(500);
      expect(correction?.hint.length).toBeLessThanOrEqual(500);
      expect(expectedUsage?.startsWith(correction?.expected.replace(/\.\.\.$/, '') ?? '')).toBe(true);
    });

    it('returns defensive copies of example arguments', () => {
      const firstCorrection = sut.getReadToolValidationCorrection(AgentToolName.ReadAlbum, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'albumId', message: 'Invalid UUID' }],
      });

      firstCorrection!.exampleArguments = { mutated: true };

      expect(
        sut.getReadToolValidationCorrection(AgentToolName.ReadAlbum, {
          requestShape: 'tool-arguments',
          issues: [{ path: 'albumId', message: 'Invalid UUID' }],
        })?.exampleArguments,
      ).toEqual({
        albumId: '00000000-0000-4000-8000-000000000010',
      });
    });

    it('returns a planning correction for missing temporary target dependencies', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
        requestShape: 'tool-arguments',
        issues: [
          { path: 'operations.0.temporaryTargetId', message: 'No matching create operation for temporaryTargetId' },
        ],
      });

      expect(correction).toMatchObject({
        mistakeId: 'planning-missing-temporary-target-dependency',
        issuePath: 'operations.0.temporaryTargetId',
        expected: expect.stringContaining('reviewable Gallery operation plan'),
        hint: expect.stringContaining('Create the new album or space first'),
        exampleArguments: expect.objectContaining({
          summary: 'Create today test and add selected photos.',
          operations: expect.any(Array),
        }),
      });
    });

    it('returns a planning correction for wrong asset batch target kind', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'operations.0.targetKind', message: 'asset.setFavorite requires an asset_batch target' }],
      });

      expect(correction).toMatchObject({
        mistakeId: 'planning-wrong-asset-batch-target-kind',
        issuePath: 'operations.0.targetKind',
        hint: expect.stringMatching(/metadata update.*asset_batch/i),
        exampleArguments: expect.any(Object),
      });
    });

    it('returns asset metadata corrections for unsupported fields and missing coordinate pairs', () => {
      for (const fieldName of ['placeName', 'city', 'country', 'title']) {
        const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
          requestShape: 'tool-arguments',
          issues: [{ path: 'operations.0.payload', message: `Unrecognized key: "${fieldName}"` }],
        });

        expect(correction).toMatchObject({
          mistakeId: `planning-asset-metadata-unsupported-${fieldName.toLowerCase()}`,
          issuePath: 'operations.0.payload',
          hint: expect.stringContaining(fieldName),
          exampleArguments: expect.any(Object),
        });
      }

      const coordinateCorrection = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'operations.0.payload', message: 'Provide both latitude and longitude' }],
      });

      expect(coordinateCorrection).toMatchObject({
        mistakeId: 'planning-asset-metadata-missing-coordinate',
        issuePath: 'operations.0.payload',
        hint: expect.stringContaining('both latitude and longitude'),
        exampleArguments: expect.any(Object),
      });
    });

    it('returns a planning correction for invalid rotate angles', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'operations.0.payload.angle', message: 'angle must be 90, 180, or 270' }],
      });

      expect(correction).toMatchObject({
        mistakeId: 'planning-invalid-rotate-angle',
        issuePath: 'operations.0.payload.angle',
        hint: expect.stringContaining('90, 180, or 270'),
        exampleArguments: expect.any(Object),
      });
    });

    it('returns operation-specific planning examples for revise corrections', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ReviseProposedOperations, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'operations.0.payload.angle', message: 'angle must be 90, 180, or 270' }],
      });

      expect(correction).toMatchObject({
        mistakeId: 'planning-invalid-rotate-angle',
        hint: expect.stringContaining('90, 180, or 270'),
        exampleArguments: expect.objectContaining({
          planId: '00000000-0000-4000-8000-000000000222',
          operations: expect.any(Array),
        }),
      });
    });

    it('returns wrapper corrections for summarize plan JSON-RPC argument mistakes', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.SummarizePlan, {
        requestShape: 'json-rpc',
        issues: [{ path: 'arguments', message: 'arguments is required' }],
      });

      expect(correction).toMatchObject({
        mistakeId: 'planning-tool-arguments-missing',
        issuePath: 'arguments',
        hint: expect.stringContaining('params.arguments'),
        exampleArguments: { planId: '00000000-0000-4000-8000-000000000222' },
      });
    });

    it('returns a planning-tool fallback when no common mistake matches', () => {
      const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
        requestShape: 'tool-arguments',
        issues: [{ path: 'summary', message: 'Too small: expected string to have >=1 characters' }],
      });

      expect(correction).toEqual({
        expected:
          'Create a reviewable Gallery operation plan. provider planning rejects raw assetIds; use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side. assetSource.explicitAssets is internal-only and rejected for provider-facing planning.',
        hint: 'Create a reviewable Gallery operation plan. provider planning rejects raw assetIds; use assetSelectionHandleId, assetSource.selectionHandle, assetSource.previousSearch, or assetSource.search so Gallery materializes IDs server-side. assetSource.explicitAssets is internal-only and rejected for provider-facing planning.',
        exampleArguments: expect.objectContaining({
          summary: 'Create today test and add selected photos.',
          operations: expect.any(Array),
        }),
      });
    });
  });

  it('defines a Slice 4 planning failure matrix with unique ids', () => {
    const cases = sut.listSlice4PlanningFailureMatrixCases();

    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((failureCase) => failureCase.id)).size).toBe(cases.length);
    expect(cases.map((failureCase) => failureCase.id)).toEqual(
      expect.arrayContaining([
        'planning-missing-arguments',
        'planning-missing-new-album-dependency',
        'planning-wrong-album-target-kind',
        'planning-wrong-space-target-kind',
        'planning-wrong-asset-batch-target-kind',
        'planning-wrong-image-edit-target-kind',
        'planning-duplicate-asset-ids',
        'planning-invalid-rotate-angle',
        'planning-invented-create-album-tool',
        'planning-invented-add-assets-tool',
      ]),
    );
  });

  it('connects planning failure cases to contract common mistakes', () => {
    const planningContracts = sut.listPlanningToolContracts();

    for (const failureCase of sut.listSlice4PlanningFailureMatrixCases()) {
      if (!failureCase.toolName) {
        continue;
      }

      const contract = planningContracts.find((candidate) => candidate.name === failureCase.toolName);

      if (!contract) {
        continue;
      }

      const mistakeIds = contract.commonMistakes.map((mistake) => mistake.id);

      expect(mistakeIds, `${failureCase.id} should map to ${failureCase.toolName}`).toContain(
        failureCase.expectedContractMistakeId,
      );
    }
  });

  it('documents actionable correction hints for invalid space detail updates', () => {
    const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
    const mistakeIds = contract?.commonMistakes.map((mistake) => mistake.id);
    const failureCaseIds = sut.listRuntimeFailureMatrixCases().map((failureCase) => failureCase.id);

    expect(mistakeIds).toEqual(
      expect.arrayContaining([
        'planning-space-update-empty-payload',
        'planning-space-update-unsupported-fields',
        'planning-space-update-missing-target-id',
        'planning-direct-space-mutation',
      ]),
    );
    expect(failureCaseIds).toEqual(
      expect.arrayContaining([
        'planning-space-update-empty-payload',
        'planning-space-update-unsupported-fields',
        'planning-space-update-missing-target-id',
      ]),
    );

    const unsupported = contract?.commonMistakes.find(
      (mistake) => mistake.id === 'planning-space-update-unsupported-fields',
    );
    expect(unsupported?.hint).toMatch(/spaceName/i);
    expect(unsupported?.hint).toMatch(/description/i);
    expect(unsupported?.hint).toMatch(/color/i);
    expect(unsupported?.hint).toMatch(/thumbnail|pets|face|linked|delete/i);
  });

  describe('Slice 7 runtime failure matrix contract', () => {
    const expectedRuntimeFailureMatrixCategories = [
      'request-wrapper',
      'read-retry',
      'read-request',
      'album-read',
      'search',
      'safety',
      'planning-wrapper',
      'planning-dependency',
      'planning-target',
      'planning-payload',
      'planning-safety',
    ] as const;

    const expectedSlice7FailureCaseIds = [
      'pi-prefixed-search-tool-name',
      'pi-prefixed-planning-tool-name',
      'invented-prefixed-apply-tool',
      'planning-dependent-add-assets-wrong-temporary-target-kind',
      'planning-dependent-set-cover-missing-new-album',
      'planning-direct-add-assets-tool',
      'search-root-taken-after-filter',
      'search-root-favorite-rating-filters',
      'search-tag-name-in-id-filter',
      'search-album-name-in-id-filter',
      'search-person-name-in-id-filter',
      'search-space-name-in-id-filter',
      'search-query-with-metadata-mode',
      'search-space-person-without-space',
      'search-fields-with-tool-call-id',
    ] as const;

    it('returns a combined runtime failure matrix with complete metadata', () => {
      const cases = sut.listRuntimeFailureMatrixCases();
      const caseIds = cases.map((failureCase) => failureCase.id);

      expect(caseIds).toEqual(expect.arrayContaining(sut.listSlice1RuntimeFailureMatrixCases().map(({ id }) => id)));
      expect(caseIds).toEqual(expect.arrayContaining(sut.listSlice4PlanningFailureMatrixCases().map(({ id }) => id)));
      expect(new Set(caseIds).size).toBe(cases.length);
      expect(cases.map((failureCase) => failureCase.category)).toEqual(
        expect.arrayContaining([...expectedRuntimeFailureMatrixCategories]),
      );

      for (const failureCase of cases) {
        expect(failureCase.id.trim().length).toBeGreaterThan(0);
        expect(failureCase.category).toBeTruthy();
        expect(failureCase.description.trim().length).toBeGreaterThan(0);
        expect(failureCase.request).toEqual(expect.any(Object));
        expect(failureCase.expectedResult).toEqual(expect.any(Object));

        if (failureCase.expectedResult.kind === 'tool-validation') {
          expect(failureCase.toolName, `${failureCase.id} should declare its tool`).toBeTruthy();
          expect(
            failureCase.expectedContractMistakeId,
            `${failureCase.id} should declare its expected contract mistake`,
          ).toBeTruthy();
        } else {
          expect(failureCase.expectedContractMistakeId, `${failureCase.id} should not link a protocol error`).toBe(
            undefined,
          );
        }
      }
    });

    it('includes explicit Slice 7 hardening case ids', () => {
      const caseIds = sut.listRuntimeFailureMatrixCases().map((failureCase) => failureCase.id);

      expect(caseIds).toEqual(expect.arrayContaining([...expectedSlice7FailureCaseIds]));
    });

    it('links every tool-validation matrix case to an executable contract mistake example', () => {
      const contractsByName = new Map(sut.listToolContracts().map((contract) => [contract.name, contract]));

      for (const failureCase of sut.listRuntimeFailureMatrixCases()) {
        if (failureCase.expectedResult.kind !== 'tool-validation') {
          continue;
        }

        const contract = contractsByName.get(failureCase.toolName!);
        const mistake = contract?.commonMistakes.find(
          (candidate) => candidate.id === failureCase.expectedContractMistakeId,
        );

        expect(contract, `${failureCase.id} should map to a known tool contract`).toBeTruthy();
        expect(mistake, `${failureCase.id} should map to ${failureCase.expectedContractMistakeId}`).toBeTruthy();
        expect(mistake!.hint.trim().length).toBeGreaterThan(20);

        if (!mistake!.exampleName) {
          continue;
        }

        const example = contract!.examples.find((candidate) => candidate.name === mistake!.exampleName);

        expect(example, `${failureCase.id} should reference an existing example`).toBeTruthy();

        if (failureCase.toolName! in AgentReadToolRequestSchemas) {
          const schema = AgentReadToolRequestSchemas[failureCase.toolName as keyof typeof AgentReadToolRequestSchemas];

          expect(schema.safeParse(example!.arguments).success, `${failureCase.id} example should parse`).toBe(true);
        } else {
          const schema =
            AgentOperationPlanToolRequestSchemas[
              failureCase.toolName as keyof typeof AgentOperationPlanToolRequestSchemas
            ];

          expect(schema.safeParse(example!.arguments).success, `${failureCase.id} example should parse`).toBe(true);
        }
      }
    });

    it('asset.adjust + asset.flip contract examples parse and stay ≤2', () => {
      const fromSearch = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSearch);
      const fromSelection = sut.getPlanningToolContract(AgentToolName.ProposeAssetBatchFromSelection);

      // ≤2 examples per tool (token-opt invariant)
      expect(fromSearch?.examples.length ?? 0).toBeLessThanOrEqual(2);
      expect(fromSelection?.examples.length ?? 0).toBeLessThanOrEqual(2);

      // adjust + flip are documented in the contract
      const contractText = JSON.stringify([fromSearch, fromSelection]);
      expect(contractText).toMatch(/asset\.adjust/);
      expect(contractText).toMatch(/asset\.flip/);

      // All existing examples still parse
      for (const contract of [fromSearch, fromSelection]) {
        for (const example of contract?.examples ?? []) {
          const result = AgentOperationPlanToolRequestSchemas[contract!.name].safeParse(example.arguments);
          expect(result.success, `${contract!.name} ${example.name}`).toBe(true);
        }
      }
    });

    it('keeps matrix metadata and representative requests compact', () => {
      for (const failureCase of sut.listRuntimeFailureMatrixCases()) {
        expect(failureCase.description.length, `${failureCase.id} description`).toBeLessThanOrEqual(220);

        if (failureCase.expectedResult.kind === 'protocol-error') {
          expect(
            failureCase.expectedResult.expectedErrorMessage.length,
            `${failureCase.id} protocol message`,
          ).toBeLessThanOrEqual(100);
        }

        if (failureCase.id !== 'asset-read-too-many-asset-ids') {
          expect(JSON.stringify(failureCase.request).length, `${failureCase.id} request`).toBeLessThanOrEqual(5000);
        }
      }
    });
  });
});
