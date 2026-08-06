# Pi Agent MCP Tool Contracts Slice 4 Planning Examples And Operation Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add contract-backed planning examples and correction hints for album, space, and asset-batch operation plans so smaller models can build reviewable Gallery plans with the right operation shapes.

**Architecture:** Extend the server-owned MCP contract layer with planning-tool contracts for `proposeAlbumOperations`, `reviseProposedOperations`, and `summarizePlan`. Reuse the existing Zod DTOs as structural truth, then use planning contracts for executable examples, operation-mode guidance, planning validation corrections, and planning-tool `tools/list` metadata. Unknown direct mutation tools remain JSON-RPC protocol errors; valid planning tools still create only reviewable plans.

**Tech Stack:** NestJS injectable services, TypeScript, Zod DTO validation, existing MCP service/registry, Vitest service and DTO tests.

---

## Scope

This slice implements only `Slice 4: Planning Examples And Operation Guidance` from `docs/superpowers/specs/2026-05-18-pi-agent-mcp-tool-contracts-design.md`.

In scope:

- Add typed planning-tool contracts for:
  - `proposeAlbumOperations`
  - `reviseProposedOperations`
  - `summarizePlan`
- Keep read contracts and read validation behavior unchanged.
- Add validated planning examples for all currently supported operation families:
  - create an empty album
  - create an album and add assets with a shared `temporaryTargetId`
  - add assets to an existing album
  - remove assets from an existing album
  - update album details
  - set album cover
  - create a space
  - create a space and add assets with a shared `temporaryTargetId`
  - add assets to an existing space
  - remove assets from an existing space
  - update space details
  - rotate assets
  - favorite assets
  - archive assets
  - add tag to assets
  - remove tag from assets
- Add planning common-mistake hints for:
  - missing or non-object `params.arguments`
  - missing `temporaryTargetId` on create operations
  - dependent new-album/new-space operations without a matching create operation
  - wrong `targetKind` for album, space, asset-batch, and image-edit operations
  - duplicate asset ids
  - invalid rotate angle
  - invalid tag payloads
  - direct mutation/apply attempts via invented tool names
- Use planning corrections in `AgentMcpService` validation errors.
- Add planning examples, property descriptions, and argument-mode metadata to planning tool `tools/list` schemas.
- Preserve DTO-derived structural schemas after stripping non-validation contract metadata.
- Preserve existing tool order, annotations, plan-review behavior, and no direct apply tool exposure.

Out of scope:

- Generated human MCP guide.
- Runner prompt cheat sheet.
- New Gallery domain operations or DTO changes.
- Public or third-party MCP support.
- Direct apply or mutation tools.
- Any frontend plan-preview UI behavior.

## TDD Commands

Red commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
```

Green commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
```

Regression commands:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
pnpm --dir server run check
pnpm --dir server run lint
pnpm --dir server run format
```

## File Structure

Modify:

- `server/src/types/agent-mcp-contract.types.ts`
  - Add `AgentMcpPlanningToolName`, `AgentMcpPlanningToolContract`, and planning failure-matrix categories.
- `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add red tests for planning contracts, executable examples, operation coverage, mistake coverage, correction lookup, failure matrix coverage, and defensive copies.
- `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add planning contract definitions, planning examples, common mistakes, `listPlanningToolContracts()`, `getPlanningToolContract()`, `listToolContracts()`, `getPlanningToolValidationCorrection()`, and `listSlice4PlanningFailureMatrixCases()`.
- `server/src/services/agent-mcp.service.spec.ts`
  - Add red runtime coverage for planning validation corrections, Slice 4 planning failure matrix cases, and planning `tools/list` metadata through `AgentMcpService`.
- `server/src/services/agent-mcp.service.ts`
  - Use planning contract corrections for known planning tools.
- `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add red planning `tools/list` metadata tests and update planning structural-schema preservation tests to strip contract metadata.
- `server/src/services/agent-mcp-tool-registry.service.ts`
  - Enrich planning tools from planning contracts without weakening DTO schemas.

Do not modify in this slice:

- `server/src/dtos/agent-operation.dto.ts`
- `server/src/dtos/agent-tool.dto.ts`
- `agent-runner/src/pi-runtime.mjs`
- `docs/superpowers/generated/`
- Frontend assistant UI files

## Slice 4 Edge Case Matrix

| Area                 | Case                                            | Expected Slice 4 Result                                                                                           |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Contract coverage    | Planning tool names                             | Planning contracts exist for propose, revise, and summarize in stable order                                       |
| Example validation   | Planning examples                               | Every planning example parses through the matching planning Zod schema                                            |
| Album examples       | Create/add/remove/update/cover                  | Required album operation examples exist and parse                                                                 |
| Space examples       | Create/add-to-new/add-to-existing/remove/update | Required space operation examples exist and parse                                                                 |
| Asset-batch examples | Rotate/favorite/archive/add-tag/remove-tag      | Required asset-batch and image-edit examples exist and parse                                                      |
| Temporary targets    | New album and new space dependencies            | Examples use matching `temporaryTargetId` values in create and dependent operations                               |
| Target kinds         | Operation-specific targets                      | Examples show the correct `targetKind` for album, space, asset batch, and image edit                              |
| Validation hints     | Missing `arguments`                             | Planning validation error includes planning hint and valid example arguments                                      |
| Validation hints     | Missing create dependency                       | Hint explains creating the temporary target before referencing it                                                 |
| Validation hints     | Wrong target kind                               | Hint explains the correct target kind for the operation family                                                    |
| Validation hints     | Duplicate asset ids                             | Hint explains each asset id must appear only once                                                                 |
| Validation hints     | Bad payload                                     | Rotate angle and tag-payload errors return specific hints                                                         |
| Failure matrix       | Known malformed planning calls                  | Every tool-validation case returns `toolName`, `retryable`, `expected`, `hint`, and example arguments             |
| Safety               | Invented direct mutation/apply tools            | Still JSON-RPC `Unknown tool`; no direct apply tool is exposed                                                    |
| Registry metadata    | Planning `tools/list` examples                  | Planning tool schemas include contract examples and mode metadata                                                 |
| Schema structure     | Planning metadata enrichment                    | Planning schemas equal DTO schemas after stripping descriptions, examples, `oneOf`, and `x-gallery-argumentModes` |
| Security             | Serialized contracts and metadata               | No internal routes, bearer tokens, provider secrets, stack traces, or direct apply tool names leak                |
| Compatibility        | Read tool behavior                              | Slice 1-3 read contract, validation, and registry tests stay green                                                |

---

### Task 1: Add Planning Contract Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Import planning DTO schemas and operation enums**

At the top of `server/src/services/agent-mcp-tool-contract.service.spec.ts`, update imports to include planning schemas and operation enums:

```ts
import { AgentOperationPlanToolRequestSchemas } from 'src/dtos/agent-operation.dto';
import { AgentReadToolRequestSchemas } from 'src/dtos/agent-tool.dto';
import { AgentOperationTargetKind, AgentOperationType, AgentToolName } from 'src/enum';
```

- [ ] **Step 2: Add planning tool constants and expected example names**

After `expectedReadToolNames`, add:

```ts
const expectedPlanningToolNames = [
  AgentToolName.ProposeAlbumOperations,
  AgentToolName.ReviseProposedOperations,
  AgentToolName.SummarizePlan,
] as const;

const expectedProposalExampleNames = [
  'create-empty-album',
  'create-album-and-add-assets',
  'add-assets-to-existing-album',
  'remove-assets-from-existing-album',
  'update-album-details',
  'set-album-cover',
  'create-space',
  'create-space-and-add-assets',
  'add-assets-to-existing-space',
  'remove-assets-from-existing-space',
  'update-space-details',
  'rotate-assets',
  'favorite-assets',
  'archive-assets',
  'add-tag-to-assets',
  'remove-tag-from-assets',
] as const;

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
  AgentOperationType.AssetAddTag,
  AgentOperationType.AssetRemoveTag,
] as const;
```

- [ ] **Step 3: Replace the pre-Slice-4 no-planning-contract test**

Replace the existing test named `does not expose planning contracts before the planning guidance slice` with:

```ts
it('returns exactly the planning-tool contracts in stable order', () => {
  expect(sut.listPlanningToolContracts().map((contract) => contract.name)).toEqual(expectedPlanningToolNames);
});

it('returns all tool contracts in stable MCP tool order', () => {
  expect(sut.listToolContracts().map((contract) => contract.name)).toEqual([
    ...expectedReadToolNames,
    ...expectedPlanningToolNames,
  ]);
});
```

- [ ] **Step 4: Add red tests for validated planning examples**

Add these tests after `defines the required list and album read examples from the spec`:

```ts
it('defines the required planning examples from the spec', () => {
  const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const revise = sut.getPlanningToolContract(AgentToolName.ReviseProposedOperations);
  const summarize = sut.getPlanningToolContract(AgentToolName.SummarizePlan);

  expect(proposal?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining([...expectedProposalExampleNames]),
  );
  expect(revise?.examples.map((example) => example.name)).toEqual(
    expect.arrayContaining(['revise-add-assets-to-existing-album', 'revise-create-empty-album']),
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

it('covers every supported planning operation type with proposal examples', () => {
  const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
  const serializedExamples = JSON.stringify(proposal.examples.map((example) => example.arguments));

  for (const operationType of expectedPlanningOperationTypes) {
    expect(serializedExamples, `${operationType} should have a valid proposal example`).toContain(operationType);
  }
});

it('shows correct temporary target dependencies in planning examples', () => {
  const proposal = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations)!;
  const albumExample = proposal.examples.find((example) => example.name === 'create-album-and-add-assets')!;
  const spaceExample = proposal.examples.find((example) => example.name === 'create-space-and-add-assets')!;

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
  expect(spaceExample.arguments).toMatchObject({
    operations: [
      expect.objectContaining({
        type: AgentOperationType.SpaceCreate,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-family-space',
      }),
      expect.objectContaining({
        type: AgentOperationType.SpaceAddAssets,
        targetKind: AgentOperationTargetKind.NewSpace,
        temporaryTargetId: 'tmp-family-space',
      }),
    ],
  });
});
```

- [ ] **Step 5: Add red tests for planning mistakes, safety, and defensive copies**

Add these tests after the read common-mistake test:

```ts
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

it('returns defensive copies of planning contracts', () => {
  const firstContracts = sut.listPlanningToolContracts();
  firstContracts[0].description = 'mutated description';
  firstContracts[0].examples[0].arguments = { mutated: true };

  expect(sut.listPlanningToolContracts()[0].description).not.toBe('mutated description');
  expect(sut.listPlanningToolContracts()[0].examples[0].arguments).not.toEqual({ mutated: true });
});
```

- [ ] **Step 6: Add red tests for planning correction lookup and failure matrix**

Inside the existing `describe('validation correction lookup', ...)`, append:

```ts
it('returns a planning correction for missing temporary target dependencies', () => {
  const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'operations.0.temporaryTargetId', message: 'No matching create operation for temporaryTargetId' }],
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
    hint: expect.stringContaining('asset_batch'),
    exampleArguments: expect.objectContaining({
      operations: [expect.objectContaining({ targetKind: AgentOperationTargetKind.AssetBatch })],
    }),
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
    exampleArguments: expect.objectContaining({
      operations: [expect.objectContaining({ type: AgentOperationType.AssetRotate })],
    }),
  });
});

it('returns a planning-tool fallback when no common mistake matches', () => {
  const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'summary', message: 'Too small: expected string to have >=1 characters' }],
  });

  expect(correction).toEqual({
    expected:
      'Create a reviewable Gallery operation plan. Put all writes in operations and let Gallery apply the plan after user review.',
    hint: 'Create a reviewable Gallery operation plan. Put all writes in operations and let Gallery apply the plan after user review.',
    exampleArguments: expect.objectContaining({
      summary: 'Create today test album.',
      operations: expect.any(Array),
    }),
  });
});
```

Then add these tests after the validation lookup `describe` block:

```ts
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
  const contractsByName = new Map(sut.listPlanningToolContracts().map((contract) => [contract.name, contract]));

  for (const failureCase of sut.listSlice4PlanningFailureMatrixCases()) {
    if (!failureCase.toolName) {
      continue;
    }

    const mistakeIds = contractsByName.get(failureCase.toolName)?.commonMistakes.map((mistake) => mistake.id) ?? [];

    expect(mistakeIds, `${failureCase.id} should map to ${failureCase.toolName}`).toContain(
      failureCase.expectedContractMistakeId,
    );
  }
});
```

- [ ] **Step 7: Run focused contract tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: FAIL because planning contract methods, planning correction lookup, and Slice 4 failure matrix do not exist.

- [ ] **Step 8: Commit the red contract tests**

```bash
git add server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define mcp planning tool contracts
EOF
)"
```

### Task 2: Implement Planning Contracts

**Files:**

- Modify: `server/src/types/agent-mcp-contract.types.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Test: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [ ] **Step 1: Add planning contract types**

In `server/src/types/agent-mcp-contract.types.ts`, add after `AgentMcpReadToolContract`:

```ts
export type AgentMcpPlanningToolName =
  | AgentToolName.ProposeAlbumOperations
  | AgentToolName.ReviseProposedOperations
  | AgentToolName.SummarizePlan;

export type AgentMcpPlanningToolContract = AgentMcpToolContract<AgentMcpPlanningToolName>;
```

Replace the `AgentMcpFailureMatrixCase['category']` union with:

```ts
  category:
    | 'request-wrapper'
    | 'read-retry'
    | 'read-request'
    | 'album-read'
    | 'search'
    | 'safety'
    | 'planning-wrapper'
    | 'planning-dependency'
    | 'planning-target'
    | 'planning-payload'
    | 'planning-safety';
```

- [ ] **Step 2: Add planning imports and example ids**

In `server/src/services/agent-mcp-tool-contract.service.ts`, update imports:

```ts
import { AgentOperationTargetKind, AgentOperationType, AgentToolName } from 'src/enum';
```

Add `AgentMcpPlanningToolContract` and `AgentMcpPlanningToolName` to the type imports.

Add these constants near the existing example ids:

```ts
const exampleSecondAssetId = '00000000-0000-4000-8000-000000000002';
const exampleSpaceId = '00000000-0000-4000-8000-000000000020';
const exampleTagId = '00000000-0000-4000-8000-000000000030';
const examplePlanId = '00000000-0000-4000-8000-000000000222';
```

- [ ] **Step 3: Add planning usage, modes, examples, and common mistakes**

Add this block after `readToolContracts`:

```ts
const planningUsage =
  'Create a reviewable Gallery operation plan. Put all writes in operations and let Gallery apply the plan after user review.';

const planningMode: AgentMcpArgumentMode = {
  name: 'operation-plan',
  description: 'Create or revise a reviewable plan without applying changes directly.',
  requiredFields: ['summary', 'operations'],
  forbiddenFields: [],
  whenToUse: 'Use for album, space, and asset-batch organization changes that Gallery should review before applying.',
};

const planIdMode: AgentMcpArgumentMode = {
  name: 'existing-plan',
  description: 'Reference an existing Gallery operation plan.',
  requiredFields: ['planId'],
  forbiddenFields: [],
  whenToUse: 'Use when revising or summarizing a plan Gallery already created.',
};

const createEmptyAlbumExample: AgentMcpToolExample = {
  name: 'create-empty-album',
  description: 'Create a new empty album for later review.',
  arguments: {
    summary: 'Create today test album.',
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create today test album.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-today-test',
        payload: {
          albumName: "today's test",
          description: 'Test album for recently uploaded photos.',
        },
      },
    ],
  },
};

const createAlbumAndAddAssetsExample: AgentMcpToolExample = {
  name: 'create-album-and-add-assets',
  description: 'Create a new album and add selected assets to it.',
  arguments: {
    summary: 'Create today test and add selected photos.',
    operations: [
      {
        type: AgentOperationType.AlbumCreate,
        summary: 'Create today test album.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-today-test',
        payload: { albumName: "today's test", description: 'Selected recent uploads.' },
      },
      {
        type: AgentOperationType.AlbumAddAssets,
        summary: 'Add selected photos to today test.',
        targetKind: AgentOperationTargetKind.NewAlbum,
        temporaryTargetId: 'tmp-today-test',
        assetIds: [exampleAssetId, exampleSecondAssetId],
      },
    ],
  },
};

const planningProposalExamples: AgentMcpToolExample[] = [
  createEmptyAlbumExample,
  createAlbumAndAddAssetsExample,
  {
    name: 'add-assets-to-existing-album',
    description: 'Add selected assets to an existing album.',
    arguments: {
      summary: 'Add selected photos to an existing album.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId, exampleSecondAssetId],
        },
      ],
    },
  },
  {
    name: 'remove-assets-from-existing-album',
    description: 'Remove selected assets from an existing album.',
    arguments: {
      summary: 'Remove selected photos from an album.',
      operations: [
        {
          type: AgentOperationType.AlbumRemoveAssets,
          summary: 'Remove selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    },
  },
  {
    name: 'update-album-details',
    description: 'Rename or describe an existing album.',
    arguments: {
      summary: 'Update album details.',
      operations: [
        {
          type: AgentOperationType.AlbumUpdateDetails,
          summary: 'Rename album.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          payload: { albumName: 'Today highlights', description: 'Curated recent photos.' },
        },
      ],
    },
  },
  {
    name: 'set-album-cover',
    description: 'Set an existing album cover from a selected asset.',
    arguments: {
      summary: 'Set album cover.',
      operations: [
        {
          type: AgentOperationType.AlbumSetCover,
          summary: 'Set cover photo.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    },
  },
  {
    name: 'create-space',
    description: 'Create a new shared space.',
    arguments: {
      summary: 'Create a family space.',
      operations: [
        {
          type: AgentOperationType.SpaceCreate,
          summary: 'Create Family space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-family-space',
          payload: { spaceName: 'Family', description: 'Shared family photos.', color: 'blue' },
        },
      ],
    },
  },
  {
    name: 'create-space-and-add-assets',
    description: 'Create a new shared space and add selected assets.',
    arguments: {
      summary: 'Create a family space and add selected photos.',
      operations: [
        {
          type: AgentOperationType.SpaceCreate,
          summary: 'Create Family space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-family-space',
          payload: { spaceName: 'Family', description: 'Shared family photos.', color: 'blue' },
        },
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos to Family space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-family-space',
          assetIds: [exampleAssetId, exampleSecondAssetId],
          payload: {},
        },
      ],
    },
  },
  {
    name: 'add-assets-to-existing-space',
    description: 'Add selected assets to an existing shared space.',
    arguments: {
      summary: 'Add selected photos to an existing space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos to Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          assetIds: [exampleAssetId, exampleSecondAssetId],
          payload: {},
        },
      ],
    },
  },
  {
    name: 'remove-assets-from-existing-space',
    description: 'Remove selected assets from an existing shared space.',
    arguments: {
      summary: 'Remove selected photos from a space.',
      operations: [
        {
          type: AgentOperationType.SpaceRemoveAssets,
          summary: 'Remove selected photos from Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          assetIds: [exampleAssetId],
          payload: {},
        },
      ],
    },
  },
  {
    name: 'update-space-details',
    description: 'Update an existing shared space.',
    arguments: {
      summary: 'Update Family space details.',
      operations: [
        {
          type: AgentOperationType.SpaceUpdateDetails,
          summary: 'Rename Family space.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          payload: { spaceName: 'Family 2026', description: 'Updated family highlights.', color: 'amber' },
        },
      ],
    },
  },
  {
    name: 'rotate-assets',
    description: 'Rotate selected image assets.',
    arguments: {
      summary: 'Rotate selected images.',
      operations: [
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate selected images clockwise.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds: [exampleAssetId],
          payload: { angle: 90 },
        },
      ],
    },
  },
  {
    name: 'favorite-assets',
    description: 'Mark selected assets as favorites.',
    arguments: {
      summary: 'Favorite selected photos.',
      operations: [
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId, exampleSecondAssetId],
          payload: { favorite: true },
        },
      ],
    },
  },
  {
    name: 'archive-assets',
    description: 'Archive selected assets.',
    arguments: {
      summary: 'Archive selected photos.',
      operations: [
        {
          type: AgentOperationType.AssetSetArchive,
          summary: 'Archive selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId],
          payload: { archived: true },
        },
      ],
    },
  },
  {
    name: 'add-tag-to-assets',
    description: 'Add a tag to selected assets.',
    arguments: {
      summary: 'Tag selected photos.',
      operations: [
        {
          type: AgentOperationType.AssetAddTag,
          summary: 'Add Travel tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId],
          payload: { tagName: 'Travel' },
        },
      ],
    },
  },
  {
    name: 'remove-tag-from-assets',
    description: 'Remove a tag from selected assets.',
    arguments: {
      summary: 'Remove tag from selected photos.',
      operations: [
        {
          type: AgentOperationType.AssetRemoveTag,
          summary: 'Remove tag from selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId],
          payload: { tagId: exampleTagId },
        },
      ],
    },
  },
];
```

Add common mistakes:

```ts
const planningCommonMistakes: AgentMcpCommonMistake[] = [
  {
    id: 'planning-tool-arguments-missing',
    match: { missingField: 'arguments', requestShape: 'json-rpc' },
    hint: 'Put the planning tool arguments object at params.arguments in the MCP tools/call request.',
    exampleName: 'create-empty-album',
  },
  {
    id: 'planning-tool-arguments-not-object',
    match: { issuePath: 'arguments', requestShape: 'json-rpc' },
    hint: 'The params.arguments value must be a JSON object with summary and operations.',
    exampleName: 'create-empty-album',
  },
  {
    id: 'planning-missing-create-temporary-target-id',
    match: { issuePath: 'operations.0.temporaryTargetId', messageIncludes: 'Required' },
    hint: 'New album and space create operations need a temporaryTargetId so later operations can reference them.',
    exampleName: 'create-empty-album',
  },
  {
    id: 'planning-missing-temporary-target-dependency',
    match: { messageIncludes: 'No matching create operation for temporaryTargetId' },
    hint: 'Create the new album or space first, then reference the same temporaryTargetId from dependent add-assets or cover operations.',
    exampleName: 'create-album-and-add-assets',
  },
  {
    id: 'planning-wrong-album-target-kind',
    match: { messageIncludes: 'album operations require an album target' },
    hint: 'Album operations must use targetKind existing_album with targetId, or new_album with temporaryTargetId when the operation allows new albums.',
    exampleName: 'add-assets-to-existing-album',
  },
  {
    id: 'planning-wrong-space-target-kind',
    match: { messageIncludes: 'space operations require a space target' },
    hint: 'Space operations must use targetKind existing_space with targetId, or new_space with temporaryTargetId when the operation allows new spaces.',
    exampleName: 'create-space-and-add-assets',
  },
  {
    id: 'planning-wrong-asset-batch-target-kind',
    match: { messageIncludes: 'requires an asset_batch target' },
    hint: 'Favorite, archive, add-tag, and remove-tag operations must use targetKind asset_batch without targetId or temporaryTargetId.',
    exampleName: 'favorite-assets',
  },
  {
    id: 'planning-wrong-image-edit-target-kind',
    match: { messageIncludes: 'requires an image_edit_batch target' },
    hint: 'Rotate operations must use targetKind image_edit_batch without targetId or temporaryTargetId.',
    exampleName: 'rotate-assets',
  },
  {
    id: 'planning-duplicate-asset-ids',
    match: { messageIncludes: 'assetIds must be unique' },
    hint: 'Provide each asset id only once within a planning operation.',
    exampleName: 'favorite-assets',
  },
  {
    id: 'planning-invalid-rotate-angle',
    match: { messageIncludes: 'angle must be 90, 180, or 270' },
    hint: 'Rotate payload angle must be exactly 90, 180, or 270.',
    exampleName: 'rotate-assets',
  },
  {
    id: 'planning-invalid-tag-payload',
    match: { messageIncludes: 'Provide exactly one of tagId or tagName' },
    hint: 'Asset add-tag payload must provide exactly one of tagId or tagName.',
    exampleName: 'add-tag-to-assets',
  },
];

const revisePlanningCommonMistakes: AgentMcpCommonMistake[] = planningCommonMistakes.map((mistake) => ({
  ...mistake,
  exampleName: 'revise-add-assets-to-existing-album',
}));
```

- [ ] **Step 4: Add planning contracts and failure matrix**

Add:

```ts
const proposeAlbumOperationsContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ProposeAlbumOperations,
  title: 'Propose album operations',
  description: 'Create a reviewable Gallery operation plan for albums, spaces, and asset batches.',
  usage: planningUsage,
  argumentModes: [planningMode],
  examples: planningProposalExamples,
  commonMistakes: planningCommonMistakes,
  safety,
};

const reviseProposedOperationsContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.ReviseProposedOperations,
  title: 'Revise proposed operations',
  description: 'Revise an existing reviewable Gallery operation plan from user feedback.',
  usage:
    'Revise an existing reviewable Gallery operation plan by providing planId, summary, and replacement operations.',
  argumentModes: [planIdMode, planningMode],
  examples: [
    {
      name: 'revise-add-assets-to-existing-album',
      description: 'Revise a plan to add selected assets to an existing album.',
      arguments: {
        planId: examplePlanId,
        feedback: 'Use the existing album instead of creating a new one.',
        summary: 'Add selected photos to an existing album.',
        operations: [
          {
            type: AgentOperationType.AlbumAddAssets,
            summary: 'Add selected photos.',
            targetKind: AgentOperationTargetKind.ExistingAlbum,
            targetId: exampleAlbumId,
            assetIds: [exampleAssetId, exampleSecondAssetId],
          },
        ],
      },
    },
    {
      name: 'revise-create-empty-album',
      description: 'Revise a plan to create an empty album.',
      arguments: {
        planId: examplePlanId,
        feedback: 'Create the album first and wait before adding photos.',
        ...createEmptyAlbumExample.arguments,
      },
    },
  ],
  commonMistakes: [
    {
      id: 'planning-revision-missing-plan-id',
      match: { missingField: 'planId', requestShape: 'tool-arguments' },
      hint: 'Revisions must include the planId returned by the previous proposed plan.',
      exampleName: 'revise-add-assets-to-existing-album',
    },
    ...revisePlanningCommonMistakes,
  ],
  safety,
};

const summarizePlanContract: AgentMcpPlanningToolContract = {
  name: AgentToolName.SummarizePlan,
  title: 'Summarize plan',
  description: 'Summarize an existing Gallery operation plan for user review.',
  usage: 'Summarize an existing reviewable Gallery operation plan by providing planId and optional focus.',
  argumentModes: [planIdMode],
  examples: [
    {
      name: 'summarize-plan',
      description: 'Summarize the whole plan.',
      arguments: { planId: examplePlanId },
    },
    {
      name: 'summarize-plan-risks',
      description: 'Summarize plan risks and selected changes.',
      arguments: { planId: examplePlanId, focus: 'risks and selected changes' },
    },
  ],
  commonMistakes: [
    {
      id: 'planning-summary-missing-plan-id',
      match: { missingField: 'planId', requestShape: 'tool-arguments' },
      hint: 'Summaries must include the planId returned by the proposed plan.',
      exampleName: 'summarize-plan',
    },
  ],
  safety,
};

const planningToolContracts: AgentMcpPlanningToolContract[] = [
  proposeAlbumOperationsContract,
  reviseProposedOperationsContract,
  summarizePlanContract,
];
```

Add a Slice 4 failure matrix using `toolCallRequest`:

```ts
const slice4PlanningFailureMatrixCases: AgentMcpFailureMatrixCase[] = [
  {
    id: 'planning-missing-arguments',
    category: 'planning-wrapper',
    description: 'Model omits params.arguments for a planning tool.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequestWithParams('planning-missing-arguments', { name: AgentToolName.ProposeAlbumOperations }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'arguments' },
    expectedContractMistakeId: 'planning-tool-arguments-missing',
  },
  {
    id: 'planning-missing-new-album-dependency',
    category: 'planning-dependency',
    description: 'Model references a new album temporary target without a matching create operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-missing-new-album-dependency', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add to a missing new album.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add photos to missing album.',
          targetKind: AgentOperationTargetKind.NewAlbum,
          temporaryTargetId: 'tmp-missing-album',
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-missing-temporary-target-dependency',
  },
  {
    id: 'planning-missing-new-space-dependency',
    category: 'planning-dependency',
    description: 'Model references a new space temporary target without a matching create operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-missing-new-space-dependency', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add to a missing new space.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add photos to missing space.',
          targetKind: AgentOperationTargetKind.NewSpace,
          temporaryTargetId: 'tmp-missing-space',
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.temporaryTargetId' },
    expectedContractMistakeId: 'planning-missing-temporary-target-dependency',
  },
  {
    id: 'planning-wrong-album-target-kind',
    category: 'planning-target',
    description: 'Model uses a space target for an album operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-album-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add album assets with wrong target.',
      operations: [
        {
          type: AgentOperationType.AlbumAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingSpace,
          targetId: exampleSpaceId,
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-album-target-kind',
  },
  {
    id: 'planning-wrong-space-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for a space operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-space-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Add space assets with wrong target.',
      operations: [
        {
          type: AgentOperationType.SpaceAddAssets,
          summary: 'Add selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-space-target-kind',
  },
  {
    id: 'planning-wrong-asset-batch-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for an asset batch operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-asset-batch-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Favorite with wrong target.',
      operations: [
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: { favorite: true },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-asset-batch-target-kind',
  },
  {
    id: 'planning-wrong-image-edit-target-kind',
    category: 'planning-target',
    description: 'Model uses an album target for an image edit operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-wrong-image-edit-target-kind', AgentToolName.ProposeAlbumOperations, {
      summary: 'Rotate with wrong target.',
      operations: [
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate selected photos.',
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: exampleAlbumId,
          assetIds: [exampleAssetId],
          payload: { angle: 90 },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.targetKind' },
    expectedContractMistakeId: 'planning-wrong-image-edit-target-kind',
  },
  {
    id: 'planning-duplicate-asset-ids',
    category: 'planning-payload',
    description: 'Model repeats the same asset id inside one planning operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-duplicate-asset-ids', AgentToolName.ProposeAlbumOperations, {
      summary: 'Favorite duplicate photos.',
      operations: [
        {
          type: AgentOperationType.AssetSetFavorite,
          summary: 'Favorite selected photos.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId, exampleAssetId],
          payload: { favorite: true },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.assetIds' },
    expectedContractMistakeId: 'planning-duplicate-asset-ids',
  },
  {
    id: 'planning-invalid-rotate-angle',
    category: 'planning-payload',
    description: 'Model uses an unsupported rotate angle.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-invalid-rotate-angle', AgentToolName.ProposeAlbumOperations, {
      summary: 'Rotate badly.',
      operations: [
        {
          type: AgentOperationType.AssetRotate,
          summary: 'Rotate selected photos.',
          targetKind: AgentOperationTargetKind.ImageEditBatch,
          assetIds: [exampleAssetId],
          payload: { angle: 45 },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload.angle' },
    expectedContractMistakeId: 'planning-invalid-rotate-angle',
  },
  {
    id: 'planning-invalid-tag-payload',
    category: 'planning-payload',
    description: 'Model provides both tagId and tagName for an add-tag operation.',
    toolName: AgentToolName.ProposeAlbumOperations,
    request: toolCallRequest('planning-invalid-tag-payload', AgentToolName.ProposeAlbumOperations, {
      summary: 'Tag ambiguously.',
      operations: [
        {
          type: AgentOperationType.AssetAddTag,
          summary: 'Add ambiguous tag.',
          targetKind: AgentOperationTargetKind.AssetBatch,
          assetIds: [exampleAssetId],
          payload: { tagId: exampleTagId, tagName: 'Travel' },
        },
      ],
    }),
    expectedResult: { kind: 'tool-validation', expectedIssuePath: 'operations.0.payload' },
    expectedContractMistakeId: 'planning-invalid-tag-payload',
  },
  {
    id: 'planning-invented-create-album-tool',
    category: 'planning-safety',
    description: 'Model invents a direct create album tool instead of proposing a plan.',
    request: toolCallRequest('planning-invented-create-album-tool', 'createAlbum', {
      albumName: "today's test",
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
  {
    id: 'planning-invented-add-assets-tool',
    category: 'planning-safety',
    description: 'Model invents a direct add assets tool instead of proposing a plan.',
    request: toolCallRequest('planning-invented-add-assets-tool', 'addAssetsToAlbum', {
      albumId: exampleAlbumId,
      assetIds: [exampleAssetId],
    }),
    expectedResult: { kind: 'protocol-error', expectedErrorMessage: 'Unknown tool' },
  },
];
```

- [ ] **Step 5: Add planning contract service methods**

First, broaden `missingField` matching in `mistakeMatchingIssue()` so Zod missing-field messages from planning DTOs can match common mistakes:

```ts
if (match.missingField) {
  return request.issues.find(
    (issue) =>
      issue.path === match.missingField &&
      (issue.message.includes('required') || issue.message.includes('Invalid input')),
  );
}
```

In `AgentMcpToolContractService`, add:

```ts
  listPlanningToolContracts(): AgentMcpPlanningToolContract[] {
    return structuredClone(planningToolContracts);
  }

  getPlanningToolContract(name: AgentMcpPlanningToolName): AgentMcpPlanningToolContract | undefined {
    return this.listPlanningToolContracts().find((contract) => contract.name === name);
  }

  listToolContracts(): AgentMcpToolContract[] {
    return [...this.listReadToolContracts(), ...this.listPlanningToolContracts()];
  }

  listSlice4PlanningFailureMatrixCases(): AgentMcpFailureMatrixCase[] {
    return structuredClone(slice4PlanningFailureMatrixCases);
  }

  getPlanningToolValidationCorrection(
    name: AgentMcpPlanningToolName,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection | undefined {
    const contract = this.getPlanningToolContract(name);
    if (!contract) {
      return;
    }

    return this.getValidationCorrection(contract, request);
  }
```

Extract the existing read correction body into a private shared helper:

```ts
  private getValidationCorrection(
    contract: AgentMcpToolContract,
    request: AgentMcpValidationCorrectionRequest,
  ): AgentMcpValidationCorrection {
    const matchingCorrection = contract.commonMistakes
      .map((mistake) => ({ mistake, issue: mistakeMatchingIssue(mistake, request) }))
      .filter((correction): correction is { mistake: AgentMcpCommonMistake; issue: AgentMcpValidationIssue } =>
        Boolean(correction.issue),
      )
      .toSorted((left, right) => mistakeSpecificity(right.mistake) - mistakeSpecificity(left.mistake))[0];

    if (!matchingCorrection) {
      return {
        expected: contract.usage,
        hint: contract.usage,
        exampleArguments: cloneArguments(contract.examples[0]?.arguments),
      };
    }

    const { mistake: matchingMistake, issue: matchingIssue } = matchingCorrection;
    const example = matchingMistake.exampleName
      ? contract.examples.find((candidate) => candidate.name === matchingMistake.exampleName)
      : undefined;

    return {
      mistakeId: matchingMistake.id,
      issuePath: matchingIssue.path,
      expected: contract.usage,
      hint: matchingMistake.hint,
      exampleArguments: cloneArguments(example?.arguments),
    };
  }
```

Then make `getReadToolValidationCorrection()` call `this.getValidationCorrection(contract, request)`.

- [ ] **Step 6: Run contract tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the planning contract implementation**

```bash
git add server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): add mcp planning tool contracts
EOF
)"
```

### Task 3: Add Planning Validation Runtime Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add Slice 4 planning failure matrix runtime tests**

Inside `describe('planning argument validation', ...)`, before the existing `it.each([...])('returns isError tool result for malformed planning arguments'...)`, add:

```ts
it.each(
  new AgentMcpToolContractService()
    .listSlice4PlanningFailureMatrixCases()
    .filter((failureCase) => failureCase.expectedResult.kind === 'tool-validation'),
)('keeps runtime validation baseline for Slice 4 planning case $id', async (failureCase) => {
  const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

  if (failureCase.expectedResult.kind !== 'tool-validation') {
    throw new Error(`Expected tool-validation case for ${failureCase.id}`);
  }

  expectEnrichedToolValidationError(response, {
    toolName: failureCase.toolName!,
    path: failureCase.expectedResult.expectedIssuePath,
  });
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
  expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
  expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
});

it.each([
  {
    id: 'planning-missing-arguments',
    hintIncludes: 'params.arguments',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-missing-new-album-dependency',
    hintIncludes: 'Create the new album or space first',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-wrong-album-target-kind',
    hintIncludes: 'existing_album',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-wrong-space-target-kind',
    hintIncludes: 'existing_space',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-wrong-asset-batch-target-kind',
    hintIncludes: 'asset_batch',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-wrong-image-edit-target-kind',
    hintIncludes: 'image_edit_batch',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-duplicate-asset-ids',
    hintIncludes: 'only once',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-invalid-rotate-angle',
    hintIncludes: '90, 180, or 270',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
  {
    id: 'planning-invalid-tag-payload',
    hintIncludes: 'exactly one of tagId or tagName',
    expectedIncludes: 'reviewable Gallery operation plan',
  },
])('returns an actionable planning correction for $id', async (expectation) => {
  const failureCase = contractService
    .listSlice4PlanningFailureMatrixCases()
    .find((candidate) => candidate.id === expectation.id)!;

  const response = (await sut.handle(auth, sessionId, failureCase.request)) as AgentMcpSuccessResponse;

  if (failureCase.expectedResult.kind !== 'tool-validation' || !failureCase.toolName) {
    throw new Error(`Expected tool-validation planning case for ${failureCase.id}`);
  }

  expectEnrichedToolValidationError(response, {
    toolName: failureCase.toolName,
    path: failureCase.expectedResult.expectedIssuePath,
    hintIncludes: expectation.hintIncludes,
    expectedIncludes: expectation.expectedIncludes,
  });

  const result = response.result as AgentMcpToolCallResult;
  expect((result.structuredContent as Record<string, unknown>).exampleArguments).toEqual(expect.any(Object));
});

it.each(
  new AgentMcpToolContractService()
    .listSlice4PlanningFailureMatrixCases()
    .filter((failureCase) => failureCase.expectedResult.kind === 'protocol-error'),
)('keeps runtime protocol-error baseline for Slice 4 planning case $id', async (failureCase) => {
  const response = await sut.handle(auth, sessionId, failureCase.request);

  if (failureCase.expectedResult.kind !== 'protocol-error') {
    throw new Error(`Expected protocol-error case for ${failureCase.id}`);
  }

  expect(response).toMatchObject({
    jsonrpc: '2.0',
    id: failureCase.request.id,
    error: {
      message: failureCase.expectedResult.expectedErrorMessage,
    },
  });
  expect(operationPlanService.proposeAlbumOperations).not.toHaveBeenCalled();
  expect(operationPlanService.reviseProposedOperations).not.toHaveBeenCalled();
  expect(operationPlanService.summarizePlan).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Replace the pre-Slice-4 generic planning fallback test**

Replace the test named `adds generic retry metadata for planning tools before planning contracts exist` with:

```ts
it('adds contract-derived correction fields for planning tools', async () => {
  const response = (await sut.handle(auth, sessionId, {
    jsonrpc: '2.0',
    id: `${AgentToolName.ProposeAlbumOperations}-call`,
    method: 'tools/call',
    params: {
      name: AgentToolName.ProposeAlbumOperations,
    },
  })) as AgentMcpSuccessResponse;
  const result = response.result as AgentMcpToolCallResult;

  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    status: 'error',
    error: 'Invalid tool arguments',
    toolName: AgentToolName.ProposeAlbumOperations,
    retryable: true,
    issues: [
      { path: 'arguments', message: 'arguments is required', hint: expect.stringContaining('params.arguments') },
    ],
    expected: expect.stringContaining('reviewable Gallery operation plan'),
    hint: expect.stringContaining('params.arguments'),
    exampleArguments: expect.objectContaining({
      summary: 'Create today test album.',
      operations: expect.any(Array),
    }),
  });
  expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
});
```

- [ ] **Step 3: Run MCP service tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because planning tools still do not use `getPlanningToolValidationCorrection()`.

- [ ] **Step 4: Commit the red runtime tests**

```bash
git add server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define mcp planning validation guidance
EOF
)"
```

### Task 4: Implement Planning Validation Corrections

**Files:**

- Modify: `server/src/services/agent-mcp.service.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add planning correction type guard**

In `server/src/services/agent-mcp.service.ts`, replace `isReadToolNameForCorrection()` with:

```ts
  private validationCorrectionFor(
    toolName: AgentToolName,
    issues: readonly { path: string; message: string }[],
    requestShape: 'json-rpc' | 'tool-arguments',
  ) {
    const request = {
      requestShape,
      issues: issues.map((issue) => ({ path: issue.path, message: issue.message })),
    };

    if (this.isReadToolName(toolName)) {
      return this.toolContractService.getReadToolValidationCorrection(toolName, request);
    }

    if (this.isPlanningToolName(toolName)) {
      return this.toolContractService.getPlanningToolValidationCorrection(toolName, request);
    }

    return undefined;
  }
```

Then replace the `correction` initialization in `validationIssuesResult()` with:

```ts
const correction = this.validationCorrectionFor(toolName, issues, requestShape);
```

Remove the now-unused `isReadToolNameForCorrection()` method.

- [ ] **Step 2: Run MCP service tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Commit the runtime implementation**

```bash
git add server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): use planning mcp validation guidance
EOF
)"
```

### Task 5: Add Planning Tools List Metadata Red Tests

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Update planning schema structural-preservation test**

Replace `derives planning tool input schemas from the existing planning tool DTO schemas` with:

```ts
it('preserves DTO-derived planning tool input schema structure after stripping contract metadata', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const toolName of expectedPlanningToolNames) {
    expect(stripContractMetadata(toolsByName.get(toolName)?.inputSchema)).toEqual(
      stripContractMetadata(toExpectedInputSchema(AgentOperationPlanToolRequestSchemas[toolName])),
    );
  }
});
```

Delete the test named `leaves planning tool structural schemas unchanged before planning contracts exist`.

- [ ] **Step 2: Add red tests for planning `tools/list` metadata**

Add these tests after the read mode metadata test:

```ts
it('enriches planning tool descriptions from the planning tool contracts', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listPlanningToolContracts()) {
    const tool = toolsByName.get(contract.name);

    expect(tool?.title).toBe(contract.title);
    expect(tool?.description).toContain(contract.description);
    expect(tool?.description).toContain(contract.usage);
    expect(tool?.description).toContain('review');
    expect(tool?.description).not.toMatch(/\/api|agent\/internal|bearer|token|provider key|stack trace/i);
  }
});

it('publishes valid contract examples on planning tool input schemas', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listPlanningToolContracts()) {
    const tool = toolsByName.get(contract.name);
    const examples = tool?.inputSchema.examples;

    expect(examples).toEqual(contract.examples.map((example) => example.arguments));
    expect(examples).toHaveLength(contract.examples.length);
    for (const exampleArguments of examples as Record<string, unknown>[]) {
      const result = AgentOperationPlanToolRequestSchemas[contract.name].safeParse(exampleArguments);

      expect(result.success, `${contract.name} example should parse`).toBe(true);
    }
  }
});

it('adds model-facing property descriptions for planning tool argument fields', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));
  const proposal = toolsByName.get(AgentToolName.ProposeAlbumOperations)?.inputSchema;
  const revision = toolsByName.get(AgentToolName.ReviseProposedOperations)?.inputSchema;
  const summary = toolsByName.get(AgentToolName.SummarizePlan)?.inputSchema;

  expect(proposal?.properties).toMatchObject({
    summary: expect.objectContaining({ description: expect.stringContaining('human-readable plan summary') }),
    operations: expect.objectContaining({ description: expect.stringContaining('reviewable Gallery operations') }),
  });
  expect(revision?.properties).toMatchObject({
    planId: expect.objectContaining({ description: expect.stringContaining('existing proposed plan') }),
    feedback: expect.objectContaining({ description: expect.stringContaining('user feedback') }),
  });
  expect(summary?.properties).toMatchObject({
    planId: expect.objectContaining({ description: expect.stringContaining('existing proposed plan') }),
    focus: expect.objectContaining({ description: expect.stringContaining('optional summary focus') }),
  });
});

it('publishes contract argument mode metadata for every planning tool without oneOf noise', () => {
  const toolsByName = new Map(sut.listTools().map((tool) => [tool.name, tool]));

  for (const contract of contractService.listPlanningToolContracts()) {
    const tool = toolsByName.get(contract.name);

    expect(tool?.inputSchema['x-gallery-argumentModes']).toEqual(
      contract.argumentModes.map((mode) => ({
        name: mode.name,
        description: mode.description,
        requiredFields: mode.requiredFields,
        forbiddenFields: mode.forbiddenFields,
        whenToUse: mode.whenToUse,
      })),
    );
    expect(tool?.inputSchema).not.toHaveProperty('oneOf');
  }
});
```

- [ ] **Step 3: Add runtime `tools/list` red coverage for planning metadata**

In `server/src/services/agent-mcp.service.spec.ts`, add this test after `returns enriched read tool metadata through tools/list`:

```ts
it('returns enriched planning tool metadata through tools/list', async () => {
  const response = (await sut.handle(auth, sessionId, {
    jsonrpc: '2.0',
    id: 'tools-enriched-planning-metadata',
    method: 'tools/list',
  })) as AgentMcpSuccessResponse;
  const result = response.result as {
    tools: Array<{ name: AgentToolName; description: string; inputSchema: Record<string, unknown> }>;
  };
  const proposal = result.tools.find((tool) => tool.name === AgentToolName.ProposeAlbumOperations);

  expect(proposal?.description).toContain('reviewable Gallery operation plan');
  expect(proposal?.inputSchema.examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        summary: 'Create today test album.',
        operations: expect.any(Array),
      }),
      expect.objectContaining({
        summary: 'Create today test and add selected photos.',
        operations: expect.any(Array),
      }),
    ]),
  );
  expect(proposal?.inputSchema['x-gallery-argumentModes']).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: 'operation-plan', requiredFields: ['summary', 'operations'] }),
    ]),
  );
});
```

- [ ] **Step 4: Run registry and MCP service tests and verify they fail**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: FAIL because planning tools do not yet receive contract examples, property descriptions, or mode metadata.

- [ ] **Step 5: Commit the red registry and service tests**

```bash
git add server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
test(server): define mcp planning tools list metadata
EOF
)"
```

### Task 6: Implement Planning Tools List Metadata

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Test: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Test: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Generalize registry contract enrichment**

In `server/src/services/agent-mcp-tool-registry.service.ts`, update type imports to include `AgentMcpToolContract` and remove the now-obsolete `AgentMcpReadToolContract` import:

```ts
import type { AgentMcpArgumentMode, AgentMcpToolContract } from 'src/types/agent-mcp-contract.types';
```

Rename `fieldDescriptions` to `propertyDescriptions` and include planning fields:

```ts
const propertyDescriptions = {
  assetIds: 'Asset ids for a new asset read request or planning operation. Use ids returned by Gallery tools.',
  albumId: 'The album id returned by listAlbums for a new album read request.',
  filters: 'Put search filters here for date, place, camera, favorite, rating, album, tag, and media searches.',
  limit: 'Maximum number of results to return. Use a positive integer up to 10000.',
  toolCallId: 'Use only for an approved retry after Gallery approves a pending read request.',
  summary: 'A human-readable plan summary describing what Gallery should review.',
  operations: 'The reviewable Gallery operations to propose or revise. Do not apply changes directly.',
  planId: 'The id of an existing proposed plan returned by Gallery.',
  feedback: 'Optional user feedback explaining how to revise the existing plan.',
  focus: 'Optional summary focus, such as risks, selected changes, or skipped operations.',
} as const satisfies Record<string, string>;
```

Change `enrichReadTool()` to a generic `enrichToolFromContract()`:

```ts
const enrichToolFromContract = (
  tool: AgentMcpToolDefinition,
  contract: AgentMcpToolContract,
): AgentMcpToolDefinition => {
  const inputSchema = structuredClone(tool.inputSchema);
  const properties = inputSchema.properties;

  if (properties && typeof properties === 'object' && !Array.isArray(properties)) {
    for (const [field, description] of Object.entries(propertyDescriptions)) {
      const property = (properties as Record<string, unknown>)[field];

      if (property && typeof property === 'object' && !Array.isArray(property)) {
        (property as Record<string, unknown>).description = description;
      }
    }
  }

  inputSchema.examples = contract.examples.map((example) => structuredClone(example.arguments));
  inputSchema['x-gallery-argumentModes'] = contract.argumentModes.map((mode) => toArgumentModeMetadata(mode));

  if (contract.argumentModes.length > 1 && modesArePairwiseExclusive(contract.argumentModes)) {
    inputSchema.oneOf = contract.argumentModes.map((mode) => toOneOfModeHint(mode));
  }

  return {
    ...tool,
    title: contract.title,
    description: `${contract.description} ${contract.usage} Modes: ${contract.argumentModes
      .map((mode) => `${mode.name}: ${mode.whenToUse}`)
      .join(' ')}`,
    inputSchema,
  };
};
```

- [ ] **Step 2: Build registry tools from all contracts**

Replace `getReadContract()` with:

```ts
const getToolContract = (
  contractsByName: ReadonlyMap<AgentToolName, AgentMcpToolContract>,
  toolName: AgentToolName,
): AgentMcpToolContract => {
  const contract = contractsByName.get(toolName);

  if (!contract) {
    throw new Error(`Missing MCP tool contract for ${toolName}`);
  }

  return contract;
};
```

Change the `buildTools` signature:

```ts
const buildTools = (contractsByName: ReadonlyMap<AgentToolName, AgentMcpToolContract>): AgentMcpToolDefinition[] =>
```

Change the final `.map()` to enrich both read and planning tools:

```ts
  ].map((tool) =>
    Object.hasOwn(AgentReadToolRequestSchemas, tool.name) || Object.hasOwn(AgentOperationPlanToolRequestSchemas, tool.name)
      ? enrichToolFromContract(tool, getToolContract(contractsByName, tool.name))
      : tool,
  );
```

In the constructor, use all tool contracts:

```ts
const contractsByName = new Map(this.contractService.listToolContracts().map((contract) => [contract.name, contract]));
```

- [ ] **Step 3: Run registry and MCP service tests and verify they pass**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp.service.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Commit registry implementation**

```bash
git add server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp.service.spec.ts
git commit -m "$(cat <<'EOF'
feat(server): enrich mcp planning tools list metadata
EOF
)"
```

### Task 7: Regression And Hardening Review

**Files:**

- Verify: `server/src/types/agent-mcp-contract.types.ts`
- Verify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Verify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
- Verify: `server/src/services/agent-mcp.service.ts`
- Verify: `server/src/services/agent-mcp.service.spec.ts`
- Verify: `server/src/services/agent-mcp-tool-registry.service.ts`
- Verify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Run focused regression suite**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
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

- [ ] **Step 5: Inspect final diff for scope and safety**

Run:

```bash
git diff --stat origin/explore/pi-agent-brainstorm..HEAD
git diff -- server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
```

Expected:

- Planning contracts exist for propose, revise, and summarize.
- Every planning example parses through the matching DTO schema.
- Planning failure matrix cases produce actionable hints or remain protocol errors.
- `tools/list` planning schemas include examples and mode metadata.
- DTO schemas are not edited.
- No direct apply or direct mutation tool is added.
- No secrets, internal routes, bearer tokens, stack traces, filesystem paths, or raw request bodies appear in contracts, metadata, or validation payloads.
- Read-tool contract behavior remains green.

- [ ] **Step 6: Commit any hardening cleanup**

If review reveals a cleanup is needed, make the smallest change, rerun the failed focused command, then commit:

```bash
git add server/src/types/agent-mcp-contract.types.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts
git commit -m "$(cat <<'EOF'
fix(server): harden mcp planning tool guidance
EOF
)"
```

If no cleanup is needed, do not create an empty commit.

## Self-Review Checklist

- [ ] The plan uses TDD: red contract tests, contract implementation, red runtime tests, runtime implementation, red registry tests, registry implementation, and regression gates.
- [ ] Planning examples cover album create/add/remove/update/cover operations.
- [ ] Planning examples cover space create/add-to-new/add-to-existing/remove/update operations.
- [ ] Planning examples cover asset rotate/favorite/archive/add-tag/remove-tag operations.
- [ ] Public contract service methods, including `listToolContracts()`, have focused tests.
- [ ] Every planning example uses valid placeholder UUIDs and parses through the matching planning DTO schema.
- [ ] Temporary target examples show matching create and dependent operations.
- [ ] Planning corrections cover missing arguments, missing dependencies, wrong target kinds, duplicate asset IDs, invalid rotate angle, and invalid tag payloads.
- [ ] Invented direct mutation/apply tools remain JSON-RPC protocol errors.
- [ ] Planning `tools/list` metadata includes examples, property descriptions, and argument-mode metadata without weakening DTO schemas, both in registry tests and through `AgentMcpService`.
- [ ] Tool order, annotations, read contracts, approval flow, plan review, and no-apply safety remain unchanged.
- [ ] Regression commands cover contract, MCP service, registry, controller integration, operation DTOs, read DTOs, typecheck, lint, and format.
