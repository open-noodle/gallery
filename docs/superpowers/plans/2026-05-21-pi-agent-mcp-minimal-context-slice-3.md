# Pi Agent MCP Minimal Context Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `readAssetMetadata` compact by default and let Pi request exact metadata field groups or named detail presets.

**Architecture:** Replace the current full-metadata-only `readAssetMetadata` request with a dedicated DTO that supports `detail` presets and `fields`. Reuse the Slice 2 compact metadata row shape so default reads return only basic fields, custom reads return only requested fields, and explicit `detail: allSafe` returns every supported safe field group without extra owner identity or internals.

**Tech Stack:** NestJS service layer, Zod DTOs via `nestjs-zod`, Vitest unit tests, existing MCP registry/schema generation.

---

## Scope

Slice 3 changes only `readAssetMetadata` request/response behavior and generated tool schema coverage.

It must not implement:

- response budgets, `resultSize`, telemetry, or truncation metadata from Slice 4;
- runner compaction from Slice 5;
- prompt/example overhaul from Slice 6 beyond minimal schema descriptions;
- selection handles from Slice 7;
- preview/original media loading through metadata reads.

## Decisions

- Default `readAssetMetadata` detail is `basic`.
- `fields` and `detail` are mutually exclusive for new requests. Use either exact fields or a preset.
- `toolCallId` cannot be combined with `assetIds`, `fields`, or `detail`.
- Supported metadata fields are `type`, `dates`, `location`, `camera`, `tags`, `rating`, `filename`, `favorite`, and `visibility`.
- Supported detail presets:
  - `basic`: `type`, `dates`
  - `descriptive`: `type`, `dates`, `filename`, `favorite`, `rating`, `tags`, `location`
  - `technical`: `type`, `dates`, `filename`, `camera`, `rating`, `visibility`
  - `allSafe`: all supported metadata fields
- Unsupported sensitive/media fields such as `people`, `previews`, `originals`, raw paths, storage keys, and checksums remain unavailable and should fail validation if requested.
- Unknown top-level request keys are rejected for `readAssetMetadata` so callers cannot smuggle preview/original/raw-path flags through ignored properties.
- Large reads are rejected through the existing per-tool/per-session metadata limits with actionable errors. Slice 4 can add partial truncation and telemetry.

## Files

- Modify: `server/src/types/agent-tool.types.ts`
  - Add `AgentAssetMetadataDetail`, `AgentAssetMetadataField`, `AgentAssetMetadataResult`, and `AgentAssetMetadataExifResult`.
- Modify: `server/src/dtos/agent-tool.dto.ts`
  - Replace metadata-read request schema with a dedicated schema supporting `detail` and `fields`.
  - Update metadata-read response schema to return compact metadata result rows plus `summary`, `detail`, and `fields`.
- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
  - Add failing DTO tests for new request fields, presets, validation, and compact response rows.
- Modify: `server/src/services/agent-tool.service.ts`
  - Update `readAssetMetadataDescriptor()` to apply field presets and return compact rows.
  - Reuse or rename the Slice 2 selected metadata mapper so search and read tools stay consistent.
- Modify: `server/src/services/agent-tool.service.spec.ts`
  - Add failing service tests for default compact reads, every field group, every preset, access boundaries, missing rows, null metadata, and limit denials.
- Modify: `server/src/services/agent-mcp.service.spec.ts`
  - Update transformed read metadata expectations for default `detail: 'basic'`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.ts`
  - Add model-facing descriptions for metadata `detail` and `fields`.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Assert generated MCP schema advertises every field group and preset.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Update the read metadata contract usage, argument modes, examples, and common mistakes so generated MCP docs teach `detail` and `fields`.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Assert read metadata examples parse and docs describe every detail preset and field group without exposing private data.

## Contract

Request:

```ts
type AgentReadAssetMetadataToolRequestDto = {
  assetIds?: string[];
  detail?: 'basic' | 'descriptive' | 'technical' | 'allSafe';
  fields?: AgentAssetMetadataField[];
  toolCallId?: string;
};
```

Default transformed request for `{ assetIds: [id] }`:

```ts
{
  assetIds: [id],
  detail: 'basic',
}
```

Success response:

```ts
{
  status: 'success',
  toolCall: AgentToolCallResponseDto,
  summary: string,
  detail?: 'basic' | 'descriptive' | 'technical' | 'allSafe',
  fields: AgentAssetMetadataField[],
  assets: AgentAssetMetadataResult[],
}
```

`AgentAssetMetadataResult` always includes `id` and includes only fields selected by `fields` or the chosen preset.

## Task 1: Write Failing DTO And Registry Tests

**Files:**

- Modify: `server/src/dtos/agent-tool.dto.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`

- [ ] **Step 1: Add metadata request DTO tests**

Inside `describe(AgentReadAssetMetadataToolRequestDto.name, ...)`, update the existing default test and add new tests:

```ts
it('accepts assetIds with the basic metadata detail default', () => {
  const assetId = factory.uuid();
  const result = parseRequest({ assetIds: [assetId] });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual({ assetIds: [assetId], detail: 'basic' });
  }
});

it('accepts explicit metadata detail presets', () => {
  const assetId = factory.uuid();
  const result = parseRequest({ assetIds: [assetId], detail: 'technical' });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual({ assetIds: [assetId], detail: 'technical' });
  }
});

it('accepts exact metadata fields for custom reads', () => {
  const assetId = factory.uuid();
  const result = parseRequest({ assetIds: [assetId], fields: ['filename', 'rating', 'tags'] });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data).toEqual({ assetIds: [assetId], fields: ['filename', 'rating', 'tags'] });
  }
});

it('rejects metadata reads that combine detail and fields', () => {
  const result = parseRequest({ assetIds: [factory.uuid()], detail: 'basic', fields: ['filename'] });

  expectIssue(result, [], 'Use either detail or fields, not both');
});

it('rejects metadata fields when retrying an approved tool call', () => {
  const result = parseRequest({ toolCallId: factory.uuid(), fields: ['filename'] });

  expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
});

it('rejects metadata detail when retrying an approved tool call', () => {
  const result = parseRequest({ toolCallId: factory.uuid(), detail: 'technical' });

  expectIssue(result, [], 'Provide either assetIds or toolCallId, not both');
});

it('rejects unsupported metadata fields such as previews, originals, and people', () => {
  for (const field of ['previews', 'originals', 'people']) {
    const result = parseRequest({ assetIds: [factory.uuid()], fields: [field] });

    expectIssue(result, ['fields', 0], 'Invalid option');
  }
});

it('rejects unknown top-level keys that try to request media or raw internals', () => {
  for (const key of ['includePreviews', 'includeOriginals', 'rawPath', 'storageKey', 'checksum']) {
    const result = parseRequest({ assetIds: [factory.uuid()], [key]: true } as never);

    expectIssue(result, [], 'Unrecognized key');
  }
});

it('rejects duplicate metadata fields', () => {
  const result = parseRequest({ assetIds: [factory.uuid()], fields: ['filename', 'filename'] });

  expectIssue(result, ['fields'], 'fields must be unique');
});
```

Keep the existing tests for duplicate asset IDs, missing asset IDs, invalid UUIDs, and `10_000` asset ID cap.

- [ ] **Step 2: Update response DTO tests for compact metadata rows**

In `describe(AgentReadAssetMetadataToolResponseDto.name, ...)`, update `serializes success responses with ISO dates and metadata only` so it expects `summary`, `detail`, and `fields`, and verifies a compact basic response:

```ts
it('serializes compact metadata success responses with selected fields only', () => {
  const asset = makeAssets()[0];
  const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
    status: 'success' as const,
    toolCall: makeToolCall(),
    summary: 'Returned basic metadata for 1 asset',
    detail: 'basic' as const,
    fields: ['type', 'dates'],
    assets: [
      {
        id: asset.id,
        type: asset.type,
        localDateTime: new Date('2026-05-14T12:00:00.000Z'),
        fileCreatedAt: new Date('2026-05-14T12:00:00.000Z'),
        fileModifiedAt: new Date('2026-05-14T12:00:00.000Z'),
        exifInfo: { dateTimeOriginal: new Date('2026-05-14T12:00:00.000Z') },
      },
    ],
  });

  expect(result.success).toBe(true);
  if (result.success && result.data.status === 'success') {
    expect(result.data.summary).toBe('Returned basic metadata for 1 asset');
    expect(result.data.detail).toBe('basic');
    expect(result.data.fields).toEqual(['type', 'dates']);
    expect(result.data.assets[0].localDateTime).toBe('2026-05-14T12:00:00.000Z');
    expect(result.data.assets[0]).not.toHaveProperty('originalFileName');
    expect(result.data.assets[0]).not.toHaveProperty('tags');
  }
});
```

Add an allSafe safe-field response test:

```ts
it('serializes allSafe metadata rows with supported safe field groups only', () => {
  const asset = makeAssets()[0];
  const result = AgentReadAssetMetadataToolResponseDto.schema.safeEncode({
    status: 'success' as const,
    toolCall: makeToolCall(),
    summary: 'Returned allSafe metadata for 1 asset',
    detail: 'allSafe' as const,
    fields: ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'],
    assets: [asset],
  });

  expect(result.success).toBe(true);
  if (result.success && result.data.status === 'success') {
    expect(result.data.assets[0].originalFileName).toBe(asset.originalFileName);
    expect(result.data.assets[0].tags).toEqual(asset.tags);
    expect(result.data.assets[0]).not.toHaveProperty('ownerId');
  }
});
```

- [ ] **Step 3: Add generated MCP schema assertions**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, update `adds model-facing property descriptions for read tool argument fields` so `metadata?.properties` includes:

```ts
      detail: expect.objectContaining({
        description: expect.stringContaining('basic'),
      }),
      fields: expect.objectContaining({
        description: expect.stringContaining('filename'),
      }),
```

Add field/preset schema assertions:

```ts
const metadataFieldSchema = metadata ? getSchemaDefinition(metadata, 'AgentAssetMetadataField') : undefined;
const metadataDetailSchema = metadata ? getSchemaDefinition(metadata, 'AgentAssetMetadataDetail') : undefined;

expect(metadataDetailSchema).toEqual(
  expect.objectContaining({ enum: ['basic', 'descriptive', 'technical', 'allSafe'] }),
);
expect(metadataFieldSchema).toEqual(
  expect.objectContaining({
    enum: expect.arrayContaining([
      'type',
      'dates',
      'location',
      'camera',
      'tags',
      'rating',
      'filename',
      'favorite',
      'visibility',
    ]),
  }),
);
```

- [ ] **Step 4: Add read metadata contract assertions**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`, add:

```ts
it('documents compact readAssetMetadata detail presets and field-selected reads', () => {
  const contract = sut.getReadToolContract(AgentToolName.ReadAssetMetadata);

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
    ]),
  );
  expect(contract?.examples).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: 'read-basic-metadata',
        arguments: { assetIds: ['00000000-0000-4000-8000-000000000001'], detail: 'basic' },
      }),
      expect.objectContaining({
        name: 'read-selected-metadata-fields',
        arguments: {
          assetIds: ['00000000-0000-4000-8000-000000000001'],
          fields: ['filename', 'rating', 'tags'],
        },
      }),
    ]),
  );
  expect(JSON.stringify(contract)).not.toMatch(/rawPath|storageKey|checksum|original path|bearer|token/i);
});
```

- [ ] **Step 5: Run DTO/registry/contract tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected red failures:

- `detail` and `fields` are unrecognized on `readAssetMetadata`.
- Default metadata request lacks `detail: 'basic'`.
- Response schema still requires full `AgentAssetMetadata` rows.
- Registry schema does not advertise metadata field groups or presets.
- Contract docs/examples do not yet describe compact metadata detail presets or field-selected reads.

## Task 2: Implement DTO And Type Contract

**Files:**

- Modify: `server/src/types/agent-tool.types.ts`
- Modify: `server/src/dtos/agent-tool.dto.ts`

- [ ] **Step 1: Add metadata detail and field types**

In `server/src/types/agent-tool.types.ts`, add near the search field types:

```ts
export type AgentAssetMetadataDetail = 'basic' | 'descriptive' | 'technical' | 'allSafe';

export type AgentAssetMetadataField = AgentSearchAssetsField;

export type AgentAssetMetadataExifResult = AgentSearchAssetExif;

export type AgentAssetMetadataResult = Omit<AgentSearchAssetResult, 'ownerId'>;
```

Also replace:

```ts
export type AgentToolReadAssetMetadataRequestMetadata = AgentToolReadAssetIdsRequestMetadata;
```

with:

```ts
export type AgentToolReadAssetMetadataRequestMetadata = AgentToolReadAssetIdsRequestMetadata & {
  detail?: AgentAssetMetadataDetail;
  fields?: AgentAssetMetadataField[];
};
```

- [ ] **Step 2: Add DTO schemas**

In `server/src/dtos/agent-tool.dto.ts`, replace the inline search field enum with shared values, then create separate schema ids for search and metadata:

```ts
const AgentAssetMetadataFieldValues = [
  'type',
  'dates',
  'location',
  'camera',
  'tags',
  'rating',
  'filename',
  'favorite',
  'visibility',
] as const;

const AgentSearchAssetsFieldSchema = z.enum(AgentAssetMetadataFieldValues).meta({ id: 'AgentSearchAssetsField' });

const AgentAssetMetadataDetailSchema = z
  .enum(['basic', 'descriptive', 'technical', 'allSafe'])
  .meta({ id: 'AgentAssetMetadataDetail' });

const AgentAssetMetadataFieldSchema = z.enum(AgentAssetMetadataFieldValues).meta({ id: 'AgentAssetMetadataField' });
```

- [ ] **Step 3: Replace `AgentReadAssetMetadataToolRequestSchema`**

Replace the current `assetIdRequest(...)` assignment for metadata with a dedicated schema:

```ts
const AgentReadAssetMetadataToolRequestSchema = z
  .strictObject({
    assetIds: z.array(uuid).min(1).max(MAX_ASSET_IDS_PER_TOOL_CALL).optional(),
    detail: AgentAssetMetadataDetailSchema.optional(),
    fields: z.array(AgentAssetMetadataFieldSchema).min(1).max(20).optional(),
    toolCallId: uuid.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.assetIds && value.toolCallId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either assetIds or toolCallId, not both' });
    }

    if ((value.detail || value.fields) && value.toolCallId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide either assetIds or toolCallId, not both' });
    }

    if (!value.assetIds && !value.toolCallId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide assetIds for a new tool request or toolCallId for an approved request',
      });
    }

    if (value.detail && value.fields) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use either detail or fields, not both' });
    }

    if (value.assetIds && new Set(value.assetIds).size !== value.assetIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['assetIds'], message: 'assetIds must be unique' });
    }

    if (value.fields && new Set(value.fields).size !== value.fields.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields'], message: 'fields must be unique' });
    }
  })
  .transform((value) => {
    if (value.toolCallId) {
      return value;
    }

    return value.fields ? value : { ...value, detail: value.detail ?? 'basic' };
  })
  .meta({ id: 'AgentReadAssetMetadataToolRequestDto' });
```

Keep `AgentReadAssetPreviewsToolRequestSchema` and `AgentReadAssetOriginalsToolRequestSchema` using `assetIdRequest(...)`.

- [ ] **Step 4: Add a shared compact asset metadata result schema**

Rename `AgentSearchAssetResultSchema` internals to a shared metadata row schema without changing the existing search response contract:

```ts
const AgentAssetMetadataResultFields = {
  id: uuid,
  type: AssetTypeSchema.optional(),
  originalFileName: z.string().optional(),
  localDateTime: isoDatetimeToDate.optional(),
  fileCreatedAt: isoDatetimeToDate.optional(),
  fileModifiedAt: isoDatetimeToDate.optional(),
  isFavorite: z.boolean().optional(),
  visibility: AssetVisibilitySchema.optional(),
  exifInfo: AgentAssetMetadataExifSchema.partial().nullable().optional(),
  tags: z.array(AgentAssetMetadataTagSchema).optional(),
};

const AgentAssetMetadataResultSchema = z
  .object(AgentAssetMetadataResultFields)
  .meta({ id: 'AgentAssetMetadataResult' });

const AgentSearchAssetResultSchema = z
  .object({ ...AgentAssetMetadataResultFields, ownerId: uuid.optional() })
  .meta({ id: 'AgentSearchAssetResult' });
```

Use a small `AgentAssetMetadataResultFields` object and build both schemas from the same field object; only the search row schema keeps optional `ownerId` for existing search compatibility.

- [ ] **Step 5: Update metadata response schema**

Change `AgentReadAssetMetadataToolSuccessResponseSchema` from:

```ts
assets: z.array(AgentAssetMetadataSchema),
```

to:

```ts
summary,
detail: AgentAssetMetadataDetailSchema.optional(),
fields: z.array(AgentAssetMetadataFieldSchema),
assets: z.array(AgentAssetMetadataResultSchema),
```

- [ ] **Step 6: Run DTO/registry/contract tests and verify green for DTO layer**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected: DTO, registry, and contract tests pass. Service/MCP tests can still fail until the service behavior is updated.

## Task 3: Write Failing Service And MCP Tests

**Files:**

- Modify: `server/src/services/agent-tool.service.spec.ts`
- Modify: `server/src/services/agent-mcp.service.spec.ts`

- [ ] **Step 1: Add default compact metadata read service test**

Near the existing metadata read tests, add:

```ts
it('returns basic metadata by default without filename, tags, location, or camera fields', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      summary: 'Returned basic metadata for 1 asset',
      detail: 'basic',
      fields: ['type', 'dates'],
      assets: [
        expect.objectContaining({
          id: assetId,
          type: AssetType.Image,
          localDateTime: now,
          fileCreatedAt: now,
          fileModifiedAt: now,
          exifInfo: { dateTimeOriginal: now },
        }),
      ],
      toolCall: expect.objectContaining({ responseSummary: 'Returned basic metadata for 1 asset' }),
    }),
  );
  expect(result.status === 'success' ? result.assets[0] : undefined).not.toHaveProperty('originalFileName');
  expect(result.status === 'success' ? result.assets[0] : undefined).not.toHaveProperty('tags');
});
```

Add the same default coverage for stored approval metadata from existing pending approvals that only contain `assetIds`:

```ts
it('defaults approved legacy metadata reads with only assetIds to basic detail', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid()];
  const session = makeSession({ userId: auth.user.id });
  const approved = makeToolCall({
    sessionId: session.id,
    status: AgentToolCallStatus.Approved,
    approvalDecision: AgentToolApprovalDecision.Approved,
    redactedRequestMetadata: { assetIds },
    assetCount: 1,
  });
  const executing = makeToolCall({ ...approved, status: AgentToolCallStatus.Executing });

  sessionRepository.getById.mockResolvedValue(session);
  toolCallRepository.getByIdForSession.mockResolvedValue(approved);
  toolCallRepository.transition
    .mockResolvedValueOnce(executing)
    .mockResolvedValueOnce(makeToolCall({ ...approved, status: AgentToolCallStatus.Completed, completedAt }));
  toolCallRepository.getCountedAssetCountBySession.mockResolvedValue(0);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set(assetIds));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetIds[0])] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { toolCallId: approved.id });

  expect(toolCallRepository.transition).toHaveBeenNthCalledWith(
    2,
    session.id,
    approved.id,
    AgentToolCallStatus.Executing,
    expect.objectContaining({
      responseSummary: 'Returned basic metadata for 1 asset',
      redactedResponseMetadata: { assetIds },
    }),
  );
  expect(result).toEqual(
    expect.objectContaining({
      status: 'success',
      summary: 'Returned basic metadata for 1 asset',
      detail: 'basic',
      fields: ['type', 'dates'],
    }),
  );
});
```

- [ ] **Step 2: Add field group mapping tests**

Add a table test:

```ts
it.each([
  ['type', { type: AssetType.Image }, ['originalFileName']],
  ['filename', { originalFileName: expect.any(String) }, ['tags']],
  ['favorite', { isFavorite: false }, ['visibility']],
  ['visibility', { visibility: AssetVisibility.Timeline }, ['isFavorite']],
  ['tags', { tags: [expect.objectContaining({ value: 'travel' })] }, ['originalFileName']],
  ['rating', { exifInfo: { rating: 5 } }, ['tags']],
  ['location', { exifInfo: expect.objectContaining({ city: 'Berlin', latitude: 52.52 }) }, ['originalFileName']],
  ['camera', { exifInfo: expect.objectContaining({ make: 'Nikon', model: 'Zf', lensModel: '40mm' }) }, ['tags']],
] as const)('returns only requested metadata field group %s', async (field, expectedFields, omittedFields) => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: [field] });

  if (result.status !== 'success') {
    throw new Error(`Expected success response, got ${result.status}`);
  }

  expect(result.detail).toBeUndefined();
  expect(result.fields).toEqual([field]);
  expect(result.assets[0]).toEqual(expect.objectContaining({ id: assetId, ...expectedFields }));
  for (const omittedField of omittedFields) {
    expect(result.assets[0]).not.toHaveProperty(omittedField);
  }
});
```

Add an overlap/null metadata test:

```ts
it('merges overlapping exif field groups and preserves null metadata values', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([
    makeMetadata(assetId, {
      exifInfo: {
        dateTimeOriginal: null,
        city: null,
        state: null,
        country: null,
        make: null,
        model: null,
        lensModel: null,
        latitude: null,
        longitude: null,
        rating: null,
      },
      tags: [],
    }),
  ] as never);

  const result = await sut.readAssetMetadata(auth, session.id, {
    assetIds: [assetId],
    fields: ['dates', 'location', 'camera', 'rating', 'tags'],
  });

  if (result.status !== 'success') {
    throw new Error(`Expected success response, got ${result.status}`);
  }

  expect(result.assets[0].exifInfo).toEqual({
    dateTimeOriginal: null,
    city: null,
    state: null,
    country: null,
    latitude: null,
    longitude: null,
    make: null,
    model: null,
    lensModel: null,
    rating: null,
  });
  expect(result.assets[0].tags).toEqual([]);
});
```

- [ ] **Step 3: Add detail preset tests**

Add:

```ts
it.each([
  ['basic', ['type', 'dates']],
  ['descriptive', ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location']],
  ['technical', ['type', 'dates', 'filename', 'camera', 'rating', 'visibility']],
  ['allSafe', ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility']],
] as const)('applies the %s metadata detail preset', async (detail, expectedFields) => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId, { leaked: 'ignore me' })] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail });

  if (result.status !== 'success') {
    throw new Error(`Expected success response, got ${result.status}`);
  }

  expect(result.detail).toBe(detail);
  expect(result.fields).toEqual(expectedFields);
  expect(result.summary).toBe(`Returned ${detail} metadata for 1 asset`);
  expect(result.assets[0]).not.toHaveProperty('leaked');
});
```

For `allSafe`, also assert every supported field group is present and `ownerId` is absent:

```ts
it('returns every supported metadata field but no owner identity for allSafe detail', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const metadata = makeMetadata(assetId);
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([metadata] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'allSafe' });

  if (result.status !== 'success') {
    throw new Error(`Expected success response, got ${result.status}`);
  }

  expect(result.assets[0]).toEqual({
    id: assetId,
    type: metadata.type,
    originalFileName: metadata.originalFileName,
    localDateTime: metadata.localDateTime,
    fileCreatedAt: metadata.fileCreatedAt,
    fileModifiedAt: metadata.fileModifiedAt,
    isFavorite: metadata.isFavorite,
    visibility: metadata.visibility,
    exifInfo: metadata.exifInfo,
    tags: metadata.tags,
  });
  expect(result.assets[0]).not.toHaveProperty('ownerId');
});
```

- [ ] **Step 4: Add access, missing-row, and limit tests**

Add:

```ts
it('rejects large metadata reads before repository hydration when they exceed the per-tool limit', async () => {
  const auth = AuthFactory.create();
  const assetIds = [newUuid(), newUuid()];
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ limits: { ...permissionPlanSnapshot.limits, maxAssetsPerToolCall: 1 } }),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds, detail: 'basic' });

  expect(result).toEqual({
    status: 'denied',
    reason:
      'Requested 2 assets, but this session allows 1 per metadata read. Request fewer asset IDs or split the metadata read into smaller batches.',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('denies mixed accessible and inaccessible metadata assets before returning partial rows', async () => {
  const auth = AuthFactory.create();
  const accessibleAssetId = newUuid();
  const inaccessibleAssetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([accessibleAssetId]));

  const result = await sut.readAssetMetadata(auth, session.id, {
    assetIds: [accessibleAssetId, inaccessibleAssetId],
    fields: ['filename'],
  });

  expect(result).toEqual({
    status: 'denied',
    reason: 'One or more assets are not accessible',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});

it('records failed compact metadata hydration instead of returning partial assets when rows are missing', async () => {
  const auth = AuthFactory.create();
  const firstAssetId = newUuid();
  const secondAssetId = newUuid();
  const session = makeSession({ userId: auth.user.id, approvalMode: AgentApprovalMode.PlanOnly });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set([firstAssetId, secondAssetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(firstAssetId)] as never);

  const result = await sut.readAssetMetadata(auth, session.id, {
    assetIds: [firstAssetId, secondAssetId],
    fields: ['filename'],
  });

  expect(result).toEqual({
    status: 'denied',
    reason: 'One or more assets were not found during metadata read',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Failed }),
  });
  expect(result).not.toHaveProperty('assets');
});
```

Add explicit permission boundary tests if existing tests do not already cover the exact branch:

```ts
it('allows shared-space metadata only when shared spaces are enabled', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: false, sharedSpaces: true, locked: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkSpaceAccess.mockResolvedValue(new Set([assetId]));
  assetRepository.getAgentMetadataByIds.mockResolvedValue([makeMetadata(assetId)] as never);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['filename'] });

  expect(result).toEqual(
    expect.objectContaining({ status: 'success', assets: [{ id: assetId, originalFileName: `${assetId}.jpg` }] }),
  );
  expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
});

it('denies locked metadata unless permission plan and elevated auth both allow locked assets', async () => {
  const assetId = newUuid();
  const auth = AuthFactory.from().session({ hasElevatedPermission: false }).build();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ assetScope: { owned: true, sharedSpaces: false, locked: true } }),
  });

  sessionRepository.getById.mockResolvedValue(session);
  accessRepository.asset.checkOwnerAccess.mockResolvedValue(new Set());

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], detail: 'basic' });

  expect(result).toEqual(
    expect.objectContaining({ status: 'denied', reason: 'One or more assets are not accessible' }),
  );
  expect(accessRepository.asset.checkOwnerAccess).toHaveBeenCalledWith(auth.user.id, new Set([assetId]), false);
});
```

Add metadata policy coverage for a rich field request:

```ts
it('denies tag metadata reads before repository hydration when metadata reads are disabled', async () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const session = makeSession({
    userId: auth.user.id,
    approvalMode: AgentApprovalMode.PlanOnly,
    permissionPlanSnapshot: makePlan({ read: { metadata: false, previews: false, originals: false } }),
  });

  sessionRepository.getById.mockResolvedValue(session);

  const result = await sut.readAssetMetadata(auth, session.id, { assetIds: [assetId], fields: ['tags'] });

  expect(result).toEqual({
    status: 'denied',
    reason: 'Agent permission policy does not allow metadata reads',
    toolCall: expect.objectContaining({ status: AgentToolCallStatus.Denied }),
  });
  expect(accessRepository.asset.checkOwnerAccess).not.toHaveBeenCalled();
  expect(assetRepository.getAgentMetadataByIds).not.toHaveBeenCalled();
});
```

- [ ] **Step 5: Add MCP transformed request test updates**

In `server/src/services/agent-mcp.service.spec.ts`, update read metadata expectations:

```ts
expect(toolService.readAssetMetadata).toHaveBeenCalledWith(auth, sessionId, {
  assetIds: ['00000000-0000-4000-8000-000000000001'],
  detail: 'basic',
});
```

In the generic read tool delegation table, add expectedArgs for `AgentToolName.ReadAssetMetadata`:

```ts
expectedArgs: { assetIds: [assetId], detail: 'basic' }
```

Use a named `assetId` in that table case if needed so the expected args can refer to the same value.

- [ ] **Step 6: Run service/MCP tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected red failures:

- default `readAssetMetadata` still returns full metadata rows;
- service result lacks `summary`, `detail`, and `fields`;
- field/preset mapping is absent;
- MCP service still delegates raw `{ assetIds }` without default `detail: 'basic'`.

## Task 4: Implement Field-Selected Metadata Service

**Files:**

- Modify: `server/src/services/agent-tool.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`

- [ ] **Step 1: Import new types**

Extend the import from `src/types/agent-tool.types`:

```ts
  AgentAssetMetadataDetail,
  AgentAssetMetadataField,
  AgentAssetMetadataResult,
```

- [ ] **Step 2: Rename the selected metadata mapper**

Rename `mapSearchAssetResult(asset, fields)` to:

```ts
private mapSelectedAssetMetadata(asset: AgentAssetMetadata, fields: AgentAssetMetadataField[]): AgentAssetMetadataResult
```

Update the existing search callers to call `mapSelectedAssetMetadata(...)`. `AgentAssetMetadataField` is an alias of the search field type, so this should not change search behavior.

- [ ] **Step 3: Add preset helpers**

Add near the mapper:

```ts
  private getReadMetadataFields(request: AgentReadAssetMetadataToolRequestDto): AgentAssetMetadataField[] {
    if (request.fields) {
      return request.fields;
    }

    return this.getReadMetadataDetailFields(request.detail ?? 'basic');
  }

  private getReadMetadataDetailFields(detail: AgentAssetMetadataDetail): AgentAssetMetadataField[] {
    switch (detail) {
      case 'basic':
        return ['type', 'dates'];
      case 'descriptive':
        return ['type', 'dates', 'filename', 'favorite', 'rating', 'tags', 'location'];
      case 'technical':
        return ['type', 'dates', 'filename', 'camera', 'rating', 'visibility'];
      case 'allSafe':
        return ['type', 'dates', 'location', 'camera', 'tags', 'rating', 'filename', 'favorite', 'visibility'];
    }
  }

  private getReadMetadataSummary(detail: AgentAssetMetadataDetail | undefined, count: number): string {
    const detailLabel = detail ?? 'custom';
    return `Returned ${detailLabel} metadata for ${count} ${count === 1 ? 'asset' : 'assets'}`;
  }
```

- [ ] **Step 3a: Update read metadata contract text and examples**

In `server/src/services/agent-mcp-tool-contract.service.ts`, replace the generic `defineAssetReadContract(...)` use for `AgentToolName.ReadAssetMetadata` with a dedicated contract that keeps `approved-retry` and adds:

```ts
const metadataDetailMode: AgentMcpArgumentMode = {
  name: 'metadata-detail',
  description: 'Read a compact named metadata preset for selected assets.',
  requiredFields: ['assetIds'],
  forbiddenFields: ['fields', 'toolCallId'],
  whenToUse:
    'Use basic by default, descriptive for user-facing curation, technical for camera/visibility checks, and allSafe only when every supported safe field group is necessary.',
};

const metadataFieldsMode: AgentMcpArgumentMode = {
  name: 'metadata-fields',
  description: 'Read exact metadata field groups for selected assets.',
  requiredFields: ['assetIds', 'fields'],
  forbiddenFields: ['detail', 'toolCallId'],
  whenToUse:
    'Use after a compact search when the next reasoning step needs specific fields such as filename, rating, tags, location, or camera.',
};
```

The metadata examples must include `read-basic-metadata`, `read-selected-metadata-fields`, and `approved-retry`; all examples must parse through `AgentReadToolRequestSchemas[AgentToolName.ReadAssetMetadata]`.

- [ ] **Step 4: Update `readAssetMetadataDescriptor()` result type**

Change:

```ts
{ assets: AgentAssetMetadata[] }
```

to:

```ts
{
  summary: string;
  detail?: AgentAssetMetadataDetail;
  fields: AgentAssetMetadataField[];
  assets: AgentAssetMetadataResult[];
}
```

- [ ] **Step 5: Update request summary and audit metadata**

Change `requestSummary` to include the effective detail:

```ts
requestSummary: (request) =>
  `Read ${request.fields ? 'custom' : (request.detail ?? 'basic')} metadata for ${(request.assetIds ?? []).length} asset(s)`,
```

Change `requestMetadata`:

```ts
requestMetadata: (request) => ({
  assetIds: request.assetIds ?? [],
  ...(request.fields ? { fields: request.fields } : { detail: request.detail ?? 'basic' }),
}),
```

The `AgentToolReadAssetMetadataRequestMetadata` type must be updated in `server/src/types/agent-tool.types.ts` to allow `{ assetIds, detail? fields? }`.

- [ ] **Step 6: Update execution**

Replace the old full metadata return:

```ts
return { assets };
```

with:

```ts
const detail = request.fields ? undefined : (request.detail ?? 'basic');
const fields = this.getReadMetadataFields(request);
const selectedAssets = assets.map((asset) => this.mapSelectedAssetMetadata(asset, fields));
const summary = this.getReadMetadataSummary(detail, selectedAssets.length);

return {
  summary,
  ...(detail ? { detail } : {}),
  fields,
  assets: selectedAssets,
};
```

- [ ] **Step 7: Update descriptor callbacks**

Change:

```ts
responseSummary: (result) => this.getReturnedMetadataSummary(result.assets.length),
```

to:

```ts
responseSummary: (result) => result.summary,
```

Keep:

```ts
responseMetadata: (result) => ({ assetIds: result.assets.map((asset) => asset.id) }),
resultAssetCount: (result) => result.assets.length,
```

- [ ] **Step 8: Preserve null EXIF field behavior**

Update `mapSelectedAssetMetadata` so if any EXIF-backed group is requested and `asset.exifInfo` is `null`, the result includes `exifInfo: null`.

Use this local flag:

```ts
let requestedExif = false;
```

Set it for `dates`, `location`, `camera`, and `rating`. At the end:

```ts
if (Object.keys(exifInfo).length > 0) {
  result.exifInfo = exifInfo;
} else if (requestedExif) {
  result.exifInfo = null;
}
```

- [ ] **Step 9: Run service/MCP tests and update old expectations**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts
```

Expected: all tests pass after updating old full-metadata expectations to assert the compact Slice 3 response shape. Do not change search tests unless the mapper rename requires import/type updates.

## Task 5: Final Verification And Commit

**Files:**

- Modified files from Tasks 1-4.

- [ ] **Step 1: Run all related tests**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-tool.dto.spec.ts src/services/agent-tool.service.spec.ts src/services/agent-mcp.service.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts src/services/agent-mcp-docs.service.spec.ts src/controllers/agent-tool.controller.spec.ts src/controllers/agent-runner-mcp.controller.spec.ts src/services/agent-runner-flow.integration.spec.ts
```

Expected: all listed specs pass.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm --dir server check
```

Expected: TypeScript passes.

- [ ] **Step 3: Inspect diff for future-slice drift**

Run:

```bash
git diff -- server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/services/agent-mcp-docs.service.spec.ts server/src/controllers/agent-tool.controller.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md
```

Expected:

- `readAssetMetadata` defaults to compact `basic` metadata.
- `detail: allSafe` returns all supported safe field groups and omits `ownerId`/internals.
- Search compact defaults are not changed beyond a mapper rename.
- No `resultSize`, response budgets, runner compaction, prompt overhaul, or selection handles are introduced.

- [ ] **Step 4: Commit**

Run:

```bash
git add server/src/types/agent-tool.types.ts server/src/dtos/agent-tool.dto.ts server/src/dtos/agent-tool.dto.spec.ts server/src/services/agent-tool.service.ts server/src/services/agent-tool.service.spec.ts server/src/services/agent-mcp.service.ts server/src/services/agent-mcp.service.spec.ts server/src/services/agent-mcp-tool-registry.service.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts server/src/controllers/agent-tool.controller.spec.ts docs/superpowers/generated/pi-agent-mcp-tools.md docs/superpowers/plans/2026-05-21-pi-agent-mcp-minimal-context-slice-3.md
git commit -m "feat: add field-selected metadata reads"
```

- [ ] **Step 5: Push**

Run:

```bash
git push
```

Expected: branch `explore/pi-agent-brainstorm` pushes to `origin/explore/pi-agent-brainstorm`.

## Plan Review Checklist

- TDD order is explicit: DTO/schema red first, service/MCP red before service implementation.
- Every Slice 3 TDD requirement is covered:
  - DTO and service tests before implementation;
  - default compact read;
  - every field group maps to expected response fields;
  - metadata policy, shared scope, locked scope, preview/original/people non-exposure;
  - large reads rejected before hydration with existing actionable limit error;
  - generated MCP schema and contract docs describe field groups and detail presets.
- Every Slice 3 edge case is covered:
  - duplicate asset IDs;
  - missing/deleted assets through hydration failure;
  - assets without EXIF;
  - assets without tags;
  - mixed accessible/inaccessible assets;
  - null metadata values;
  - overlapping `dates`, `location`, `camera`, and `rating` field groups.
  - unknown top-level media/raw-internal request keys.
- Future slices are excluded.
