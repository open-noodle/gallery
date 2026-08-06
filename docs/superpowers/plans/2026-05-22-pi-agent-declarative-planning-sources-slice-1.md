# Pi Agent Declarative Planning Sources Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared asset-source DTO schemas, TypeScript vocabulary, and source-mechanism validation helpers needed by later declarative planning slices.

**Architecture:** This slice is contract-only. It creates focused DTO and type/helper modules that later slices can import, but it does not wire `assetSource` into the existing planning tools yet. Runtime operation-plan behavior must remain unchanged until the source resolver and materialization slices exist.

**Tech Stack:** TypeScript, NestJS DTOs via `nestjs-zod`, Zod 4, Vitest.

---

## Scope

Spec: `docs/superpowers/specs/2026-05-22-pi-agent-declarative-planning-sources-design.md`

Slice: `Slice 1: Typed Source And ID Domain Vocabulary`

This plan covers every Slice 1 test and edge case:

- DTO schemas accept valid `search`, `previousSearch`, `selectionHandle`, and `explicitAssets` sources.
- DTO schemas reject missing `kind`, unknown source kinds, empty source refs, raw UUID source refs, and malformed date strings.
- Declarative people/tag/album filters require non-empty names.
- ID-domain helper classifies fixture IDs from a lookup source and returns `unknown` for missing IDs.
- Shared source validation rejects asset-bearing operation inputs with multiple source mechanisms and inputs with no source mechanism.

This plan intentionally does **not**:

- add `assetSource` to `AgentGalleryOperationInputSchema`;
- let `proposeAlbumOperations` accept source-backed operations;
- resolve declarative names to real IDs;
- create source refs from `searchAssets`;
- persist or materialize source-backed plans.

Those are later slices.

## File Structure

- Create `server/src/types/agent-asset-source.types.ts`
  - Owns shared TypeScript unions and pure helper functions for asset-source concepts, ID domains, resolution statuses, and source-mechanism validation.
- Create `server/src/types/agent-asset-source.types.spec.ts`
  - Unit tests for ID-domain classification and source-mechanism validation.
- Create `server/src/dtos/agent-asset-source.dto.ts`
  - Owns Zod schemas and DTO classes for model-facing `AgentAssetSourceInput` and declarative filters.
- Create `server/src/dtos/agent-asset-source.dto.spec.ts`
  - DTO/schema contract tests for accepted source shapes and rejected edge cases.

## Task 1: DTO Contract Tests

**Files:**

- Create: `server/src/dtos/agent-asset-source.dto.spec.ts`

- [ ] **Step 1: Write the failing DTO/schema tests**

Create `server/src/dtos/agent-asset-source.dto.spec.ts` with:

```ts
import {
  AgentAssetSourceInputDto,
  AgentAssetSourceInputSchema,
  AgentDeclarativeAssetFiltersSchema,
  AgentSourceResolutionStatusSchema,
  AgentSourceRefSchema,
} from 'src/dtos/agent-asset-source.dto';
import { factory } from 'test/small.factory';

const validSourceRef = 'asset-source:search:01HX9Z4G3F6Q7R8S9T0V1W2X3Y';

describe('Agent asset source DTOs', () => {
  it('accepts a declarative search source with named filters', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'search',
      mode: 'metadata',
      query: 'South Africa trip',
      filters: {
        country: 'South Africa',
        takenAfter: '2026-01-01T00:00:00.000Z',
        takenBefore: '2026-01-31T23:59:59.999Z',
        people: { match: 'any', names: ['Pierre', 'Aurelia'] },
        tags: { match: 'all', names: ['Travel', 'Family'] },
        albums: { match: 'any', names: ['Trips'] },
        space: { name: 'Family' },
        camera: { make: 'Fujifilm', model: 'X100VI', lensModel: '23mm' },
        rating: 5,
        isFavorite: true,
        isNotInAlbum: false,
        type: 'IMAGE',
        visibility: 'timeline',
        withSharedSpaces: true,
      },
      order: 'desc',
      limit: 100,
      page: 1,
      materialization: 'all-matches-with-limit',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('search');
      expect(result.data.filters?.people?.names).toEqual(['Pierre', 'Aurelia']);
    }
  });

  it('accepts a previous search source ref', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'previousSearch',
      sourceRef: validSourceRef,
    });

    expect(result.success).toBe(true);
  });

  it('accepts a selection handle source', () => {
    const selectionHandleId = factory.uuid();
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'selectionHandle',
      selectionHandleId,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.selectionHandleId).toBe(selectionHandleId);
    }
  });

  it('accepts an explicit asset source and preserves unique asset IDs', () => {
    const assetIds = [factory.uuid(), factory.uuid()];
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'explicitAssets',
      assetIds,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.assetIds).toEqual(assetIds);
    }
  });

  it('exposes a createZodDto class for Nest request DTO use', () => {
    expect(
      AgentAssetSourceInputDto.schema.safeParse({ kind: 'previousSearch', sourceRef: validSourceRef }).success,
    ).toBe(true);
  });

  it('accepts structured source resolution statuses and rejects unknown statuses', () => {
    expect(AgentSourceResolutionStatusSchema.safeParse('success').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('needs_clarification').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('recoverable_error').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('denied').success).toBe(true);
    expect(AgentSourceResolutionStatusSchema.safeParse('failed').success).toBe(false);
  });

  it('rejects a source object with a missing kind', () => {
    const result = AgentAssetSourceInputSchema.safeParse({ sourceRef: validSourceRef });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toContain('kind');
  });

  it('rejects an unknown source kind', () => {
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'copiedIds',
      assetIds: [factory.uuid()],
    });

    expect(result.success).toBe(false);
  });

  it('rejects empty, whitespace, and raw UUID source refs', () => {
    const empty = AgentSourceRefSchema.safeParse('');
    const whitespace = AgentSourceRefSchema.safeParse('   ');
    const rawUuid = AgentSourceRefSchema.safeParse(factory.uuid());

    expect(empty.success).toBe(false);
    expect(whitespace.success).toBe(false);
    expect(rawUuid.success).toBe(false);
  });

  it('rejects malformed declarative date strings', () => {
    const result = AgentDeclarativeAssetFiltersSchema.safeParse({
      takenAfter: 'January 2026',
      takenBefore: '2026-01-31',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['takenAfter', 'takenBefore']),
    );
  });

  it('requires non-empty people, tag, and album names', () => {
    const result = AgentDeclarativeAssetFiltersSchema.safeParse({
      people: { match: 'any', names: [] },
      tags: { match: 'any', names: [''] },
      albums: { match: 'any', names: ['   '] },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join('.'))).toEqual(
      expect.arrayContaining(['people.names', 'tags.names.0', 'albums.names.0']),
    );
  });

  it('rejects explicit asset sources with duplicate asset IDs', () => {
    const assetId = factory.uuid();
    const result = AgentAssetSourceInputSchema.safeParse({
      kind: 'explicitAssets',
      assetIds: [assetId, assetId],
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain('assetIds must be unique');
  });
});
```

- [ ] **Step 2: Run DTO tests and verify the expected red failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts
```

Expected: FAIL because `src/dtos/agent-asset-source.dto` does not exist yet.

## Task 2: DTO Schemas And DTO Class

**Files:**

- Create: `server/src/dtos/agent-asset-source.dto.ts`

- [ ] **Step 1: Implement the minimal DTO/schema module**

Create `server/src/dtos/agent-asset-source.dto.ts` with:

```ts
import { createZodDto } from 'nestjs-zod';
import { AssetTypeSchema, AssetVisibilitySchema } from 'src/enum';
import z from 'zod';

export const AGENT_SOURCE_REF_PREFIX = 'asset-source:';

const uuid = z.uuidv4();
const sourceRefToken = z
  .string()
  .trim()
  .min(8)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const sourceRefKind = z.enum(['search', 'selection']);
const namedFilterName = z.string().trim().min(1).max(120);
const namedFilterNames = z.array(namedFilterName).min(1).max(20);

export const AgentSourceRefSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^asset-source:(search|selection):[A-Za-z0-9_-]{8,120}$/, {
    message: 'sourceRef must use the asset-source:<kind>:<token> format',
  })
  .meta({ id: 'AgentSourceRef' });

export const AgentDeclarativeNameMatchSchema = z.enum(['any', 'all']).meta({ id: 'AgentDeclarativeNameMatch' });

export const AgentDeclarativeNamedFilterSchema = z
  .strictObject({
    match: AgentDeclarativeNameMatchSchema,
    names: namedFilterNames,
  })
  .meta({ id: 'AgentDeclarativeNamedFilter' });

const AgentDeclarativeSpaceFilterSchema = z
  .strictObject({
    name: namedFilterName,
  })
  .meta({ id: 'AgentDeclarativeSpaceFilter' });

const AgentDeclarativeCameraFilterSchema = z
  .strictObject({
    make: z.string().trim().min(1).max(120).optional(),
    model: z.string().trim().min(1).max(120).optional(),
    lensModel: z.string().trim().min(1).max(120).optional(),
  })
  .refine((value) => value.make !== undefined || value.model !== undefined || value.lensModel !== undefined, {
    message: 'Provide make, model, or lensModel',
  })
  .meta({ id: 'AgentDeclarativeCameraFilter' });

export const AgentDeclarativeAssetFiltersSchema = z
  .strictObject({
    takenAfter: z.iso.datetime().optional(),
    takenBefore: z.iso.datetime().optional(),
    country: z.string().trim().nullable().optional(),
    city: z.string().trim().nullable().optional(),
    state: z.string().trim().nullable().optional(),
    people: AgentDeclarativeNamedFilterSchema.optional(),
    tags: AgentDeclarativeNamedFilterSchema.optional(),
    albums: AgentDeclarativeNamedFilterSchema.optional(),
    space: AgentDeclarativeSpaceFilterSchema.optional(),
    camera: AgentDeclarativeCameraFilterSchema.optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    isFavorite: z.boolean().optional(),
    isNotInAlbum: z.boolean().optional(),
    type: AssetTypeSchema.optional(),
    visibility: AssetVisibilitySchema.optional(),
    withSharedSpaces: z.boolean().optional(),
  })
  .meta({ id: 'AgentDeclarativeAssetFilters' });

const AgentSearchAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('search'),
    mode: z.enum(['metadata', 'smart', 'description', 'ocr', 'filename']).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    filters: AgentDeclarativeAssetFiltersSchema.optional(),
    order: z.enum(['asc', 'desc', 'relevance']).optional(),
    limit: z.number().int().min(1).max(10_000).optional(),
    page: z.number().int().min(1).optional(),
    materialization: z.enum(['bounded-page', 'all-matches-with-limit']).optional(),
  })
  .meta({ id: 'AgentSearchAssetSourceInput' });

const AgentPreviousSearchAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('previousSearch'),
    sourceRef: AgentSourceRefSchema,
  })
  .meta({ id: 'AgentPreviousSearchAssetSourceInput' });

const AgentSelectionHandleAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('selectionHandle'),
    selectionHandleId: uuid,
  })
  .meta({ id: 'AgentSelectionHandleAssetSourceInput' });

const uniqueAssetIds = z
  .array(uuid)
  .min(1)
  .max(10_000)
  .superRefine((assetIds, ctx) => {
    if (new Set(assetIds).size !== assetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [],
        message: 'assetIds must be unique',
      });
    }
  });

const AgentExplicitAssetsAssetSourceInputSchema = z
  .strictObject({
    kind: z.literal('explicitAssets'),
    assetIds: uniqueAssetIds,
  })
  .meta({ id: 'AgentExplicitAssetsAssetSourceInput' });

export const AgentAssetSourceInputSchema = z
  .discriminatedUnion('kind', [
    AgentSearchAssetSourceInputSchema,
    AgentPreviousSearchAssetSourceInputSchema,
    AgentSelectionHandleAssetSourceInputSchema,
    AgentExplicitAssetsAssetSourceInputSchema,
  ])
  .meta({ id: 'AgentAssetSourceInput' });

export const AgentSourceResolutionStatusSchema = z
  .enum(['success', 'needs_clarification', 'recoverable_error', 'denied'])
  .meta({ id: 'AgentSourceResolutionStatus' });

export const buildAgentSourceRef = (kind: z.output<typeof sourceRefKind>, token: z.output<typeof sourceRefToken>) =>
  `${AGENT_SOURCE_REF_PREFIX}${kind}:${token}`;

export class AgentAssetSourceInputDto extends createZodDto(AgentAssetSourceInputSchema) {}
```

- [ ] **Step 2: Run DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts
```

Expected: PASS all tests in `agent-asset-source.dto.spec.ts`.

## Task 3: Type And Helper Contract Tests

**Files:**

- Create: `server/src/types/agent-asset-source.types.spec.ts`

- [ ] **Step 1: Write failing helper tests**

Create `server/src/types/agent-asset-source.types.spec.ts` with:

```ts
import {
  classifyAgentIdDomainFromLookup,
  countAgentAssetSourceMechanisms,
  validateAgentAssetSourceMechanismCount,
  validateNoAgentAssetSourceMechanisms,
} from 'src/types/agent-asset-source.types';
import { factory } from 'test/small.factory';

describe('Agent asset source types and helpers', () => {
  it('classifies known IDs from Set-backed table lookups and array-backed metadata sources', () => {
    const assetId = factory.uuid();
    const personId = factory.uuid();
    const albumId = factory.uuid();
    const spaceId = factory.uuid();
    const tagId = factory.uuid();
    const selectionHandleId = factory.uuid();
    const sourceRef = 'asset-source:search:01HX9Z4G3F6Q7R8S9T0V1W2X3Y';

    const lookup = {
      asset: new Set([assetId]),
      person: new Set([personId]),
      album: new Set([albumId]),
      space: new Set([spaceId]),
      tag: new Set([tagId]),
      selectionHandle: new Set([selectionHandleId]),
      sourceRef: [sourceRef],
    };

    expect(classifyAgentIdDomainFromLookup(assetId, lookup)).toBe('asset');
    expect(classifyAgentIdDomainFromLookup(personId, lookup)).toBe('person');
    expect(classifyAgentIdDomainFromLookup(albumId, lookup)).toBe('album');
    expect(classifyAgentIdDomainFromLookup(spaceId, lookup)).toBe('space');
    expect(classifyAgentIdDomainFromLookup(tagId, lookup)).toBe('tag');
    expect(classifyAgentIdDomainFromLookup(selectionHandleId, lookup)).toBe('selectionHandle');
    expect(classifyAgentIdDomainFromLookup(sourceRef, lookup)).toBe('sourceRef');
  });

  it('returns unknown safely for missing, empty, or ambiguous IDs', () => {
    const duplicateId = factory.uuid();
    const lookup = {
      asset: new Set([duplicateId]),
      person: new Set([duplicateId]),
    };

    expect(classifyAgentIdDomainFromLookup(factory.uuid(), lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup('', lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup(undefined, lookup)).toBe('unknown');
    expect(classifyAgentIdDomainFromLookup(duplicateId, lookup)).toBe('unknown');
  });

  it('counts source mechanisms from assetSource, assetIds, and assetSelectionHandleId', () => {
    expect(
      countAgentAssetSourceMechanisms({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
      }),
    ).toBe(1);
    expect(countAgentAssetSourceMechanisms({ assetIds: [factory.uuid()] })).toBe(1);
    expect(countAgentAssetSourceMechanisms({ assetSelectionHandleId: factory.uuid() })).toBe(1);
    expect(
      countAgentAssetSourceMechanisms({
        assetSource: { kind: 'selectionHandle', selectionHandleId: factory.uuid() },
        assetIds: [factory.uuid()],
        assetSelectionHandleId: factory.uuid(),
      }),
    ).toBe(3);
  });

  it('validates exactly one mechanism for asset-bearing operation inputs', () => {
    expect(validateAgentAssetSourceMechanismCount({ assetIds: [factory.uuid()] })).toEqual({
      valid: true,
      mechanism: 'assetIds',
      fields: ['assetIds'],
    });

    expect(validateAgentAssetSourceMechanismCount({})).toEqual({
      valid: false,
      reason: 'missing_source_mechanism',
      fields: [],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });

    expect(
      validateAgentAssetSourceMechanismCount({
        assetSource: { kind: 'previousSearch', sourceRef: 'asset-source:search:abc12345' },
        assetSelectionHandleId: factory.uuid(),
      }),
    ).toEqual({
      valid: false,
      reason: 'multiple_source_mechanisms',
      fields: ['assetSource', 'assetSelectionHandleId'],
      message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
    });
  });

  it('validates that non-asset operation inputs omit all source mechanisms', () => {
    expect(validateNoAgentAssetSourceMechanisms({})).toEqual({ valid: true, fields: [] });
    expect(validateNoAgentAssetSourceMechanisms({ assetIds: [factory.uuid()] })).toEqual({
      valid: false,
      reason: 'unexpected_source_mechanism',
      fields: ['assetIds'],
      message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
    });
  });
});
```

- [ ] **Step 2: Run helper tests and verify the expected red failure**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/types/agent-asset-source.types.spec.ts
```

Expected: FAIL because `src/types/agent-asset-source.types` does not exist yet.

## Task 4: Shared Types And Pure Helpers

**Files:**

- Create: `server/src/types/agent-asset-source.types.ts`

- [ ] **Step 1: Implement the minimal shared type/helper module**

Create `server/src/types/agent-asset-source.types.ts` with:

```ts
import { AssetType, AssetVisibility } from 'src/enum';
import { AgentSearchAssetsMode, AgentSearchAssetsOrder } from 'src/types/agent-tool.types';

export type AgentAssetSourceKind = 'search' | 'previousSearch' | 'selectionHandle' | 'explicitAssets';
export type AgentSourceRef = string;
export type AgentSourceResolutionStatus = 'success' | 'needs_clarification' | 'recoverable_error' | 'denied';
export type AgentDeclarativeNameMatch = 'any' | 'all';
export type AgentAssetSourceMaterialization = 'bounded-page' | 'all-matches-with-limit';

export type AgentDeclarativeNamedFilter = {
  match: AgentDeclarativeNameMatch;
  names: string[];
};

export type AgentDeclarativeAssetFilters = {
  takenAfter?: string;
  takenBefore?: string;
  country?: string | null;
  city?: string | null;
  state?: string | null;
  people?: AgentDeclarativeNamedFilter;
  tags?: AgentDeclarativeNamedFilter;
  albums?: AgentDeclarativeNamedFilter;
  space?: { name: string };
  camera?: { make?: string; model?: string; lensModel?: string };
  rating?: number | null;
  isFavorite?: boolean;
  isNotInAlbum?: boolean;
  type?: AssetType;
  visibility?: AssetVisibility;
  withSharedSpaces?: boolean;
};

export type AgentAssetSourceInput =
  | {
      kind: 'search';
      mode?: AgentSearchAssetsMode;
      query?: string;
      filters?: AgentDeclarativeAssetFilters;
      order?: AgentSearchAssetsOrder;
      limit?: number;
      page?: number;
      materialization?: AgentAssetSourceMaterialization;
    }
  | {
      kind: 'previousSearch';
      sourceRef: AgentSourceRef;
    }
  | {
      kind: 'selectionHandle';
      selectionHandleId: string;
    }
  | {
      kind: 'explicitAssets';
      assetIds: string[];
    };

export type AgentIdDomain =
  | 'asset'
  | 'person'
  | 'album'
  | 'space'
  | 'tag'
  | 'selectionHandle'
  | 'sourceRef'
  | 'unknown';

export type AgentIdDomainLookup = Partial<
  Record<Exclude<AgentIdDomain, 'unknown'>, ReadonlySet<string> | readonly string[]>
>;

export const AGENT_ID_DOMAIN_ORDER = [
  'asset',
  'person',
  'album',
  'space',
  'tag',
  'selectionHandle',
  'sourceRef',
] as const satisfies readonly Exclude<AgentIdDomain, 'unknown'>[];

export const classifyAgentIdDomainFromLookup = (
  id: string | null | undefined,
  lookup: AgentIdDomainLookup,
): AgentIdDomain => {
  if (!id) {
    return 'unknown';
  }

  const matches = AGENT_ID_DOMAIN_ORDER.filter((domain) => {
    const ids = lookup[domain];
    if (!ids) {
      return false;
    }

    return ids instanceof Set ? ids.has(id) : ids.includes(id);
  });

  return matches.length === 1 ? matches[0] : 'unknown';
};

export type AgentAssetSourceMechanismField = 'assetSource' | 'assetIds' | 'assetSelectionHandleId';

export type AgentAssetSourceMechanismInput = {
  assetSource?: unknown;
  assetIds?: readonly string[];
  assetSelectionHandleId?: string;
};

export type AgentAssetSourceMechanismValidationResult =
  | {
      valid: true;
      mechanism: AgentAssetSourceMechanismField;
      fields: AgentAssetSourceMechanismField[];
    }
  | {
      valid: false;
      reason: 'missing_source_mechanism' | 'multiple_source_mechanisms';
      fields: AgentAssetSourceMechanismField[];
      message: string;
    };

export type AgentNoAssetSourceMechanismValidationResult =
  | {
      valid: true;
      fields: AgentAssetSourceMechanismField[];
    }
  | {
      valid: false;
      reason: 'unexpected_source_mechanism';
      fields: AgentAssetSourceMechanismField[];
      message: string;
    };

export const AGENT_ASSET_SOURCE_MECHANISM_FIELDS = [
  'assetSource',
  'assetIds',
  'assetSelectionHandleId',
] as const satisfies readonly AgentAssetSourceMechanismField[];

export const getAgentAssetSourceMechanismFields = (
  input: AgentAssetSourceMechanismInput,
): AgentAssetSourceMechanismField[] =>
  AGENT_ASSET_SOURCE_MECHANISM_FIELDS.filter((field) => input[field] !== undefined);

export const countAgentAssetSourceMechanisms = (input: AgentAssetSourceMechanismInput) =>
  getAgentAssetSourceMechanismFields(input).length;

export const validateAgentAssetSourceMechanismCount = (
  input: AgentAssetSourceMechanismInput,
): AgentAssetSourceMechanismValidationResult => {
  const fields = getAgentAssetSourceMechanismFields(input);

  if (fields.length === 1) {
    return { valid: true, mechanism: fields[0], fields };
  }

  return {
    valid: false,
    reason: fields.length === 0 ? 'missing_source_mechanism' : 'multiple_source_mechanisms',
    fields,
    message: 'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
  };
};

export const validateNoAgentAssetSourceMechanisms = (
  input: AgentAssetSourceMechanismInput,
): AgentNoAssetSourceMechanismValidationResult => {
  const fields = getAgentAssetSourceMechanismFields(input);

  if (fields.length === 0) {
    return { valid: true, fields };
  }

  return {
    valid: false,
    reason: 'unexpected_source_mechanism',
    fields,
    message: 'Omit assetSource, assetIds, and assetSelectionHandleId for operations that do not operate on assets',
  };
};
```

- [ ] **Step 2: Run helper tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/types/agent-asset-source.types.spec.ts
```

Expected: PASS all tests in `agent-asset-source.types.spec.ts`.

## Task 5: Focused And Broader Verification

**Files:**

- Verify: `server/src/dtos/agent-asset-source.dto.spec.ts`
- Verify: `server/src/types/agent-asset-source.types.spec.ts`
- Verify: `server/src/dtos/agent-operation.dto.spec.ts`
- Verify: `server/src/dtos/agent-tool.dto.spec.ts`

- [ ] **Step 1: Run the new focused tests together**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-asset-source.dto.spec.ts src/types/agent-asset-source.types.spec.ts
```

Expected: PASS.

- [ ] **Step 2: Run affected existing DTO tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/dtos/agent-tool.dto.spec.ts
```

Expected: PASS. This confirms Slice 1 did not change existing operation/tool DTO behavior.

- [ ] **Step 3: Run server lint on CI-compatible command**

Run:

```bash
pnpm --dir server run lint
```

Expected: PASS.

- [ ] **Step 4: Format changed files**

Run:

```bash
pnpm --dir server run format:fix
```

Expected: command completes and only intended formatting changes remain.

- [ ] **Step 5: Check git diff**

Run:

```bash
git diff -- server/src/dtos/agent-asset-source.dto.ts server/src/dtos/agent-asset-source.dto.spec.ts server/src/types/agent-asset-source.types.ts server/src/types/agent-asset-source.types.spec.ts
git status --short
```

Expected: only the four Slice 1 files are changed for implementation, plus this plan file if it was not already committed.

## Task 6: Commit And Push Slice 1

**Files:**

- Commit all Slice 1 implementation files and this plan file.

- [ ] **Step 1: Commit Slice 1**

Run:

```bash
git add docs/superpowers/plans/2026-05-22-pi-agent-declarative-planning-sources-slice-1.md \
  server/src/dtos/agent-asset-source.dto.ts \
  server/src/dtos/agent-asset-source.dto.spec.ts \
  server/src/types/agent-asset-source.types.ts \
  server/src/types/agent-asset-source.types.spec.ts
git commit -m "feat(server): add Pi asset source contracts"
```

Expected: commit succeeds.

- [ ] **Step 2: Push the branch**

Run:

```bash
git push origin explore/pi-agent-brainstorm
```

Expected: push succeeds.

## Review Checklist Before Execution

- The plan uses TDD: every implementation task starts with failing tests and records expected red failures.
- DTO tests cover all four source variants and required rejection edge cases from the spec.
- Helper tests cover ID-domain classification, missing IDs, ambiguous IDs, exactly-one asset source validation, and no-source validation.
- Existing operation planning behavior is intentionally unchanged until later slices.
- The plan does not implement source-ref creation, declarative resolver behavior, source-backed plan persistence, workflow tools, UI, prompt/docs, or activity changes.
