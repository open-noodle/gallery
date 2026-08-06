# Pi Agent Asset Metadata Edits Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `asset.updateMetadata` operation to the agent planning DTO contract with strict payload validation, MCP JSON schema coverage, and model-facing correction hints for common invalid metadata payloads.

**Architecture:** Extend the existing operation discriminated union in `server/src/dtos/agent-operation.dto.ts`. The new operation remains a reviewable `asset_batch` plan operation and only validates the proposed payload shape in this slice. It reuses the existing asset source selection helpers and target validation. MCP exposure flows through the existing `AgentOperationPlanToolRequestSchemas` and registry JSON-schema generation; correction hints live with the planning tool contract metadata.

**Tech Stack:** TypeScript, NestJS DTOs, Zod 4, Vitest, existing Gallery MCP tool registry and contract services.

---

## Scope

This is Slice 1 from `docs/superpowers/specs/2026-05-25-pi-agent-asset-metadata-edits-design.md`.

Implement only:

- Add `AgentOperationType.AssetUpdateMetadata = 'asset.updateMetadata'`.
- Add an `asset.updateMetadata` planning operation schema using `targetKind: 'asset_batch'`.
- Add strict metadata payload validation for:
  - `description?: string`
  - `rating?: 1 | 2 | 3 | 4 | 5 | null`
  - `dateTimeOriginal?: string`
  - `dateTimeRelative?: number`
  - `timeZone?: string`
  - `latitude?: number`
  - `longitude?: number`
- Reject empty payloads, unknown payload fields, invalid rating shapes, invalid or conflicting date fields, blank or invalid time zones, missing coordinate pairs, null coordinates, and out-of-range or non-finite coordinates.
- Verify non-empty descriptions are trimmed while `description: ""` remains accepted as a clear-description operation.
- Verify generated MCP input schemas expose `asset.updateMetadata` and document `dateTimeRelative` as an integer minute offset.
- Add model-facing planning correction hints for unsupported metadata fields such as `placeName`, `city`, `country`, and `title`, and for missing coordinate pairs.

Do not implement:

- Permission model changes or `writeScope.updateAssetMetadata`.
- Operation-plan persistence/materialization changes.
- Apply behavior or calls to `assetService.updateAll`.
- UI review rendering.
- Assistant prompt-flow changes.
- Capability matrix/docs updates beyond this plan.
- Forward geocoding or place-name resolution.

## Files

- Modify: `server/src/enum.ts`
  - Add the new `AgentOperationType.AssetUpdateMetadata` enum member near the other asset operation types.
- Modify: `server/src/dtos/agent-operation.dto.ts`
  - Add a reusable `assetUpdateMetadataPayloadSchema`.
  - Add `updateMetadataOperationSchema`.
  - Include the new operation in `AgentGalleryOperationInputSchema`.
  - Add payload property descriptions so JSON schema tells models that `dateTimeRelative` is an integer minute offset and coordinates must be explicit latitude/longitude, not place names.
- Modify: `server/src/dtos/agent-operation.dto.spec.ts`
  - Add acceptance and rejection tests for the new operation and every DTO edge case in this slice.
- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
  - Add generated schema assertions for the new operation type, target kind, supported payload fields, closed-world rejection of unknown payload fields, and the `dateTimeRelative` minute description.
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
  - Add valid `asset.updateMetadata` planning examples.
  - Add common mistake entries for unsupported metadata fields/place names and missing coordinate pairs.
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`
  - Add tests that examples parse, expected operation type lists include `asset.updateMetadata`, and validation correction lookup returns actionable metadata hints.

## Task 1: DTO Contract And Payload Validation

**Files:**

- Modify: `server/src/enum.ts`
- Modify: `server/src/dtos/agent-operation.dto.ts`
- Test: `server/src/dtos/agent-operation.dto.spec.ts`

- [x] **Step 1: Write failing DTO tests**

Add a helper near the other operation helpers in `server/src/dtos/agent-operation.dto.spec.ts`:

```ts
const makeAssetUpdateMetadataOperation = (payload: Record<string, unknown>) => ({
  type: AgentOperationType.AssetUpdateMetadata,
  summary: 'Update selected photo metadata.',
  targetKind: AgentOperationTargetKind.AssetBatch,
  assetIds: [factory.uuid()],
  payload,
});
```

Add the happy-path coverage:

```ts
it.each([
  ['description', { description: 'Berlin weekend' }],
  ['clear description', { description: '' }],
  ['rating', { rating: 5 }],
  ['clear rating', { rating: null }],
  ['absolute datetime', { dateTimeOriginal: '1998-06-01T12:00:00.000Z' }],
  ['relative datetime minutes', { dateTimeRelative: 120 }],
  ['timezone', { timeZone: 'Europe/Berlin' }],
  ['explicit coordinates', { latitude: 48.8566, longitude: 2.3522 }],
  [
    'combined metadata fields',
    {
      description: 'Paris scan',
      rating: 4,
      dateTimeOriginal: '1998-06-01T12:00:00.000Z',
      timeZone: 'Europe/Paris',
      latitude: 48.8566,
      longitude: 2.3522,
    },
  ],
])('accepts asset.updateMetadata with %s payload', (_name, payload) => {
  const result = AgentProposeAlbumOperationsDto.schema.safeParse({
    summary: 'Update selected photo metadata.',
    operations: [makeAssetUpdateMetadataOperation(payload)],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.operations[0]).toMatchObject({
      type: AgentOperationType.AssetUpdateMetadata,
      targetKind: AgentOperationTargetKind.AssetBatch,
      payload,
    });
  }
});
```

Add trim coverage:

```ts
it('trims non-empty asset.updateMetadata descriptions', () => {
  const result = AgentProposeAlbumOperationsDto.schema.safeParse({
    summary: 'Update selected photo metadata.',
    operations: [makeAssetUpdateMetadataOperation({ description: '  Berlin weekend  ' })],
  });

  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.operations[0].payload).toMatchObject({ description: 'Berlin weekend' });
  }
});
```

Add target and selection regressions:

```ts
it('requires asset.updateMetadata to use an asset_batch target and one asset source mechanism', () => {
  expectIssue(
    AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid metadata target.',
      operations: [
        {
          ...makeAssetUpdateMetadataOperation({ rating: 5 }),
          targetKind: AgentOperationTargetKind.ExistingAlbum,
          targetId: factory.uuid(),
        },
      ],
    }),
    ['operations', 0, 'targetKind'],
    'asset.updateMetadata requires an asset_batch target',
  );

  expectIssue(
    AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid metadata selection.',
      operations: [{ ...makeAssetUpdateMetadataOperation({ rating: 5 }), assetIds: undefined }],
    }),
    ['operations', 0],
    'Provide exactly one of assetSource, assetIds, or assetSelectionHandleId',
  );
});
```

Add validation coverage for every Slice 1 payload edge:

```ts
it.each([
  {
    name: 'empty payload',
    payload: {},
    path: ['operations', 0, 'payload'],
    message: 'Provide at least one metadata field to update',
  },
  {
    name: 'unknown placeName field',
    payload: { placeName: 'Paris' },
    path: ['operations', 0, 'payload'],
    message: 'Unrecognized key',
  },
  {
    name: 'unknown city field',
    payload: { city: 'Paris' },
    path: ['operations', 0, 'payload'],
    message: 'Unrecognized key',
  },
  {
    name: 'unknown country field',
    payload: { country: 'France' },
    path: ['operations', 0, 'payload'],
    message: 'Unrecognized key',
  },
  {
    name: 'unknown title field',
    payload: { title: 'Paris scan' },
    path: ['operations', 0, 'payload'],
    message: 'Unrecognized key',
  },
  {
    name: 'overlong description',
    payload: { description: 'a'.repeat(1001) },
    path: ['operations', 0, 'payload', 'description'],
    message: 'Too big',
  },
  {
    name: 'rating zero',
    payload: { rating: 0 },
    path: ['operations', 0, 'payload', 'rating'],
    message: 'Invalid input',
  },
  {
    name: 'negative rating',
    payload: { rating: -1 },
    path: ['operations', 0, 'payload', 'rating'],
    message: 'Invalid input',
  },
  {
    name: 'rating above five',
    payload: { rating: 6 },
    path: ['operations', 0, 'payload', 'rating'],
    message: 'Invalid input',
  },
  {
    name: 'invalid datetime',
    payload: { dateTimeOriginal: 'June 1998' },
    path: ['operations', 0, 'payload', 'dateTimeOriginal'],
    message: 'Invalid ISO datetime',
  },
  {
    name: 'absolute and relative datetime',
    payload: { dateTimeOriginal: '1998-06-01T12:00:00.000Z', dateTimeRelative: 60 },
    path: ['operations', 0, 'payload'],
    message: 'Choose dateTimeOriginal or dateTimeRelative, not both',
  },
  {
    name: 'zero relative datetime alone',
    payload: { dateTimeRelative: 0 },
    path: ['operations', 0, 'payload', 'dateTimeRelative'],
    message: 'dateTimeRelative: 0 is a no-op unless another metadata field changes',
  },
  {
    name: 'non-integer relative datetime',
    payload: { dateTimeRelative: 1.5 },
    path: ['operations', 0, 'payload', 'dateTimeRelative'],
    message: 'Invalid input',
  },
  {
    name: 'blank timezone',
    payload: { timeZone: '' },
    path: ['operations', 0, 'payload', 'timeZone'],
    message: 'Invalid IANA time zone',
  },
  {
    name: 'invalid timezone',
    payload: { timeZone: 'Mars/Olympus' },
    path: ['operations', 0, 'payload', 'timeZone'],
    message: 'Invalid IANA time zone',
  },
  {
    name: 'latitude without longitude',
    payload: { latitude: 48.8566 },
    path: ['operations', 0, 'payload', 'longitude'],
    message: 'Provide both latitude and longitude',
  },
  {
    name: 'longitude without latitude',
    payload: { longitude: 2.3522 },
    path: ['operations', 0, 'payload', 'latitude'],
    message: 'Provide both latitude and longitude',
  },
  {
    name: 'null latitude',
    payload: { latitude: null, longitude: 2.3522 },
    path: ['operations', 0, 'payload', 'latitude'],
    message: 'Invalid input',
  },
  {
    name: 'null longitude',
    payload: { latitude: 48.8566, longitude: null },
    path: ['operations', 0, 'payload', 'longitude'],
    message: 'Invalid input',
  },
  {
    name: 'latitude out of range',
    payload: { latitude: 91, longitude: 2.3522 },
    path: ['operations', 0, 'payload', 'latitude'],
    message: 'Too big',
  },
  {
    name: 'longitude out of range',
    payload: { latitude: 48.8566, longitude: 181 },
    path: ['operations', 0, 'payload', 'longitude'],
    message: 'Too big',
  },
  {
    name: 'non-finite coordinate',
    payload: { latitude: Number.POSITIVE_INFINITY, longitude: 2.3522 },
    path: ['operations', 0, 'payload', 'latitude'],
    message: 'Invalid input',
  },
])('rejects invalid asset.updateMetadata payload: $name', ({ payload, path, message }) => {
  expectIssue(
    AgentProposeAlbumOperationsDto.schema.safeParse({
      summary: 'Invalid metadata update.',
      operations: [makeAssetUpdateMetadataOperation(payload)],
    }),
    path,
    message,
  );
});
```

Update the existing “accepts one valid sample for each expanded operation type” test to include a valid `asset.updateMetadata` operation after the other asset batch operations.

- [x] **Step 2: Run focused DTO tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "asset.updateMetadata|expanded operation type"
```

Expected red failure:

- TypeScript/test runtime reports `AgentOperationType.AssetUpdateMetadata` is undefined, or the schema rejects `asset.updateMetadata` as an invalid discriminator value.

- [x] **Step 3: Implement the minimal DTO schema**

In `server/src/enum.ts`, add:

```ts
AssetUpdateMetadata = 'asset.updateMetadata',
```

near the other `Asset*` operation types.

In `server/src/dtos/agent-operation.dto.ts`, import the existing coordinate validators:

```ts
import { isoDatetimeToDate, latitudeSchema, longitudeSchema } from 'src/validation';
```

Add helper validation near the other asset payload schemas:

```ts
const ianaTimeZoneSchema = z
  .string()
  .trim()
  .refine((timeZone) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA time zone');

const assetUpdateMetadataPayloadSchema = z
  .strictObject({
    description: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .describe('Asset description. Use an empty string to clear the description.'),
    rating: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.null()])
      .optional()
      .describe('Star rating 1-5, or null to clear the rating.'),
    dateTimeOriginal: z.iso.datetime().optional().describe('Absolute asset capture date/time as an ISO datetime.'),
    dateTimeRelative: z.number().int().optional().describe('Relative time offset in integer minutes.'),
    timeZone: ianaTimeZoneSchema.optional().describe('IANA time zone, for example Europe/Berlin.'),
    latitude: latitudeSchema
      .optional()
      .describe('Explicit GPS latitude. Provide longitude too; place names are not accepted.'),
    longitude: longitudeSchema
      .optional()
      .describe('Explicit GPS longitude. Provide latitude too; place names are not accepted.'),
  })
  .superRefine((payload, ctx) => {
    if (Object.keys(payload).length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Provide at least one metadata field to update' });
    }

    if (payload.dateTimeOriginal !== undefined && payload.dateTimeRelative !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Choose dateTimeOriginal or dateTimeRelative, not both',
      });
    }

    if (payload.dateTimeRelative === 0 && Object.keys(payload).length === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateTimeRelative'],
        message: 'dateTimeRelative: 0 is a no-op unless another metadata field changes',
      });
    }

    if (Number(payload.latitude !== undefined) + Number(payload.longitude !== undefined) === 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [payload.latitude === undefined ? 'latitude' : 'longitude'],
        message: 'Provide both latitude and longitude',
      });
    }
  });
```

Add:

```ts
const updateMetadataOperationSchema = z
  .strictObject({
    type: z.literal(AgentOperationType.AssetUpdateMetadata).meta({ id: 'AgentAssetUpdateMetadataOperationType' }),
    ...assetBatchBase,
    payload: assetUpdateMetadataPayloadSchema,
  })
  .superRefine((operation, ctx) => {
    validateAssetSelection(operation, ctx);
    validateStandaloneTarget(
      operation,
      ctx,
      AgentOperationTargetKind.AssetBatch,
      AgentOperationType.AssetUpdateMetadata,
    );
  });
```

Include `updateMetadataOperationSchema` in `AgentGalleryOperationInputSchema` after the other non-pixel asset batch operations.

- [x] **Step 4: Re-run focused DTO tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts -t "asset.updateMetadata|expanded operation type"
```

Expected green result:

- All new `asset.updateMetadata` DTO tests pass.
- Existing expanded-operation sample test passes with the new operation included.

## Task 2: MCP Schema And Correction Contract

**Files:**

- Modify: `server/src/services/agent-mcp-tool-registry.service.spec.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.ts`
- Modify: `server/src/services/agent-mcp-tool-contract.service.spec.ts`

- [x] **Step 1: Write failing MCP schema tests**

In `server/src/services/agent-mcp-tool-registry.service.spec.ts`, update the existing `advertises expanded operation types and target kinds in planning tool schemas` test to assert:

```ts
expect(planningSchemaJson).toContain(AgentOperationType.AssetUpdateMetadata);
expect(planningSchemaJson).toContain('dateTimeRelative');
expect(planningSchemaJson).toContain('integer minutes');
expect(planningSchemaJson).toContain('place names are not accepted');
```

Add a focused closed-world payload schema assertion:

```ts
it('exposes asset.updateMetadata payload schema as a closed-world metadata object', () => {
  const proposal = sut.listTools().find((tool) => tool.name === AgentToolName.ProposeAlbumOperations);
  const serialized = JSON.stringify(proposal?.inputSchema);

  expect(serialized).toContain(AgentOperationType.AssetUpdateMetadata);
  expect(serialized).toContain('description');
  expect(serialized).toContain('rating');
  expect(serialized).toContain('dateTimeOriginal');
  expect(serialized).toContain('dateTimeRelative');
  expect(serialized).toContain('timeZone');
  expect(serialized).toContain('latitude');
  expect(serialized).toContain('longitude');
  expect(serialized).toContain('"additionalProperties":false');
  expect(serialized).not.toContain('placeName');
  expect(serialized).not.toContain('city');
  expect(serialized).not.toContain('country');
  expect(serialized).not.toContain('title');
});
```

- [x] **Step 2: Write failing planning-contract correction tests**

In `server/src/services/agent-mcp-tool-contract.service.spec.ts`:

Update `expectedPlanningOperationTypes` to include `AgentOperationType.AssetUpdateMetadata`.

Add expectations that `ProposeAlbumOperations` examples include parseable metadata examples:

```ts
it('documents asset metadata update planning examples', () => {
  const contract = sut.getPlanningToolContract(AgentToolName.ProposeAlbumOperations);
  const exampleNames = contract?.examples.map((example) => example.name);

  expect(exampleNames).toEqual(
    expect.arrayContaining(['update-asset-description', 'set-asset-rating', 'set-asset-coordinates']),
  );

  for (const name of ['update-asset-description', 'set-asset-rating', 'set-asset-coordinates']) {
    const example = contract?.examples.find((candidate) => candidate.name === name);
    expect(example).toBeDefined();
    expect(
      AgentOperationPlanToolRequestSchemas[AgentToolName.ProposeAlbumOperations].safeParse(example?.arguments).success,
    ).toBe(true);
  }
});
```

Add validation correction lookup coverage:

```ts
it('provides asset metadata correction hints for place names and missing coordinates', () => {
  for (const unsupportedField of ['placeName', 'city', 'country', 'title']) {
    const correction = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
      requestShape: 'tool-arguments',
      issues: [{ path: 'operations.0.payload', message: `Unrecognized key: "${unsupportedField}"` }],
    });

    expect(correction?.mistakeId).toBe(`planning-asset-metadata-unsupported-${unsupportedField.toLowerCase()}`);
    expect(correction?.hint).toContain('latitude and longitude');
    expect(correction?.hint).toContain('does not resolve place names');
  }

  const missingLongitude = sut.getPlanningToolValidationCorrection(AgentToolName.ProposeAlbumOperations, {
    requestShape: 'tool-arguments',
    issues: [{ path: 'operations.0.payload.longitude', message: 'Provide both latitude and longitude' }],
  });

  expect(missingLongitude?.mistakeId).toBe('planning-asset-metadata-missing-coordinate');
  expect(missingLongitude?.hint).toContain('Provide both latitude and longitude');
});
```

- [x] **Step 3: Run focused MCP/contract tests and verify red**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts -t "asset.updateMetadata|expanded operation types"
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts -t "metadata|planning operation types|correction hints"
```

Expected red failure:

- Registry schema assertions fail until the DTO schema and descriptions are present.
- Contract tests fail until examples and common mistakes are added.

- [x] **Step 4: Implement minimal contract metadata**

In `server/src/services/agent-mcp-tool-contract.service.ts`, add these examples to `planningProposalExamples` near the other asset batch examples:

```ts
{
  name: 'update-asset-description',
  description: 'Update selected asset descriptions.',
  arguments: {
    summary: 'Update selected photo descriptions.',
    operations: [
      {
        type: AgentOperationType.AssetUpdateMetadata,
        summary: 'Set selected photo descriptions.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [exampleAssetId, exampleSecondAssetId],
        payload: { description: 'Berlin weekend' },
      },
    ],
  },
},
{
  name: 'set-asset-rating',
  description: 'Set selected asset ratings.',
  arguments: {
    summary: 'Rate selected photos five stars.',
    operations: [
      {
        type: AgentOperationType.AssetUpdateMetadata,
        summary: 'Rate selected photos five stars.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [exampleAssetId],
        payload: { rating: 5 },
      },
    ],
  },
},
{
  name: 'set-asset-coordinates',
  description: 'Set selected asset coordinates using explicit latitude and longitude.',
  arguments: {
    summary: 'Set selected photo coordinates.',
    operations: [
      {
        type: AgentOperationType.AssetUpdateMetadata,
        summary: 'Set selected photo coordinates.',
        targetKind: AgentOperationTargetKind.AssetBatch,
        assetIds: [exampleAssetId],
        payload: { latitude: 48.8566, longitude: 2.3522 },
      },
    ],
  },
},
```

Add field-specific common mistakes before the generic asset-batch target mistakes so they do not collide with the existing `space.updateDetails` `Unrecognized key` hint:

```ts
...(['placeName', 'city', 'country', 'title'] as const).map((field) => ({
  id: `planning-asset-metadata-unsupported-${field.toLowerCase()}`,
  match: { issuePath: 'operations.0.payload', messageIncludes: field },
  hint:
    'asset.updateMetadata supports explicit latitude and longitude only. Gallery does not resolve place names here; ask the user for coordinates instead of sending placeName, city, country, or title fields.',
  exampleName: 'set-asset-coordinates',
})),
{
  id: 'planning-asset-metadata-missing-coordinate',
  match: { messageIncludes: 'Provide both latitude and longitude' },
  hint: 'Provide both latitude and longitude for asset.updateMetadata coordinate updates. If the user only gave a place name or one coordinate, ask for the missing explicit coordinate.',
  exampleName: 'set-asset-coordinates',
},
```

- [x] **Step 5: Re-run focused MCP/contract tests and verify green**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-registry.service.spec.ts -t "asset.updateMetadata|expanded operation types"
pnpm --dir server exec vitest --config test/vitest.config.mjs src/services/agent-mcp-tool-contract.service.spec.ts -t "metadata|planning operation types|correction hints"
```

Expected green result:

- Registry tests confirm generated schema exposes `asset.updateMetadata`, supported fields, closed-world payloads, and minute-offset descriptions.
- Contract tests confirm examples parse and correction hints are actionable.

## Task 3: Slice Verification And Commit

- [x] **Step 1: Run the full surrounding server unit tests touched by this slice**

Run:

```bash
pnpm --dir server exec vitest --config test/vitest.config.mjs src/dtos/agent-operation.dto.spec.ts src/services/agent-mcp-tool-registry.service.spec.ts src/services/agent-mcp-tool-contract.service.spec.ts
```

Expected green result:

- All three touched spec files pass.

- [x] **Step 2: Run static validation**

Run:

```bash
pnpm --dir server run check
pnpm --dir server run lint
git diff --check
```

Expected green result:

- TypeScript compile passes.
- ESLint passes with zero warnings.
- `git diff --check` prints no whitespace errors.

- [x] **Step 3: Inspect the diff**

Run:

```bash
git diff -- server/src/enum.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts
```

Check:

- No permission, service apply, UI, assistant-flow, or docs/capability-matrix behavior was implemented in this slice.
- `asset.updateMetadata` target validation uses `asset_batch`, not `image_edit_batch`.
- Payload is strict and does not accept `placeName`, `city`, `country`, `title`, or nullable coordinates.
- `dateTimeRelative` is documented and tested as integer minutes.

- [x] **Step 4: Commit**

Commit only this slice:

```bash
git add server/src/enum.ts server/src/dtos/agent-operation.dto.ts server/src/dtos/agent-operation.dto.spec.ts server/src/services/agent-mcp-tool-registry.service.spec.ts server/src/services/agent-mcp-tool-contract.service.ts server/src/services/agent-mcp-tool-contract.service.spec.ts docs/superpowers/plans/2026-05-25-pi-agent-asset-metadata-edits-slice-1.md
git commit -m "feat: add pi agent metadata operation contract"
```

## Plan Review Checklist

- [x] TDD order is explicit for DTO, MCP schema, and correction contract behavior.
- [x] Every Slice 1 spec edge case is named in a failing test.
- [x] File paths and operation names match the current codebase.
- [x] The plan does not implement Slice 2 permissions, Slice 3 materialization, Slice 4 apply, Slice 5 UI, Slice 6 assistant flow, or Slice 7 docs.
- [x] Targeted and surrounding verification commands are listed with expected red/green results.
