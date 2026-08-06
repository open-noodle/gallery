import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AgentPermissionPlanSchema,
  AgentSessionCreateDto,
  AgentSessionResponseDto,
  AgentSessionUpdateDto,
} from 'src/dtos/agent-session.dto';
import { AgentApprovalMode, AgentPermissionPreset, AgentProviderType, AgentSessionStatus } from 'src/enum';
import type { AgentNormalizedPermissionPlanSnapshot } from 'src/types/agent-session.types';
import type z from 'zod';

type AgentSessionCreateInput = z.input<typeof AgentSessionCreateDto.schema>;

const providerCredentialId = '3fe388e4-2078-44d7-b36c-000000000001';
const maxInitialContextBytes = 16_384;
const fullWriteScope = {
  createAlbum: true,
  addAssets: true,
  updateDetails: true,
  setCover: true,
  removeAssets: true,
  createSpace: true,
  addAssetsToSpaces: true,
  removeAssetsFromSpaces: true,
  updateSpaceDetails: true,
  editAssets: true,
  favoriteAssets: true,
  archiveAssets: true,
  tagAssets: true,
  updateAssetMetadata: true,
  addMembersToSpaces: true,
  removeMembersFromSpaces: true,
  updateSpaceMemberRoles: true,
  trashAssets: true,
  createSharedLinks: true,
  shareAlbums: true,
  lockAssets: true,
  deleteContainers: true,
  manageStacks: true,
  managePeople: true,
};
const expandedWriteScopeKeys = [
  'removeAssets',
  'createSpace',
  'addAssetsToSpaces',
  'removeAssetsFromSpaces',
  'updateSpaceDetails',
  'editAssets',
  'favoriteAssets',
  'archiveAssets',
  'tagAssets',
  'updateAssetMetadata',
  'addMembersToSpaces',
  'removeMembersFromSpaces',
  'updateSpaceMemberRoles',
  'trashAssets',
  'createSharedLinks',
  'shareAlbums',
  'lockAssets',
  'deleteContainers',
  'manageStacks',
  'managePeople',
];

const makePermissionPlan = (): AgentNormalizedPermissionPlanSnapshot => ({
  read: {
    metadata: true,
    previews: true,
    originals: true,
  },
  providerExposure: {
    metadata: true,
    previews: true,
    originals: true,
    allowOriginalsForExternalProviders: false,
  },
  assetScope: {
    owned: true,
    sharedSpaces: true,
    locked: false,
  },
  writeScope: {
    ...fullWriteScope,
  },
  limits: {
    maxAssetsPerToolCall: 20,
    maxAssetsPerSession: 100,
    maxPreviewsPerToolCall: 10,
    maxPreviewsPerSession: 50,
    maxOriginalsPerToolCall: 5,
    maxOriginalsPerSession: 25,
    expiresInMinutes: 60,
  },
});

const makeCustomCreateInput = (overrides: Partial<AgentSessionCreateInput> = {}): AgentSessionCreateInput => ({
  providerCredentialId,
  model: 'gpt-5',
  permissionPreset: AgentPermissionPreset.Custom,
  approvalMode: AgentApprovalMode.AskOnEscalation,
  permissionPlan: makePermissionPlan(),
  ...overrides,
});

const jsonByteLength = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

const makeInitialContext = (targetBytes: number) => {
  const emptyContext = { payload: '' };
  const payloadLength = targetBytes - jsonByteLength(emptyContext);

  if (payloadLength < 0) {
    throw new Error('targetBytes is smaller than the empty initial context JSON');
  }

  const context = { payload: 'x'.repeat(payloadLength) };
  expect(jsonByteLength(context)).toBe(targetBytes);
  return context;
};

const expectIssue = (input: AgentSessionCreateInput, path: (string | number)[], message: string) => {
  const result = AgentSessionCreateDto.schema.safeParse(input);

  expect(result.success).toBe(false);
  if (result.success) {
    return;
  }

  expect(result.error.issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path,
        message,
      }),
    ]),
  );
};

describe('AgentPermissionPlanSchema', () => {
  it('requires custom permission plans to include updateAssetMetadata', () => {
    const missingUpdateAssetMetadata = {
      ...fullWriteScope,
      updateAssetMetadata: undefined,
    };

    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: missingUpdateAssetMetadata,
      limits: {
        maxAssetsPerToolCall: 500,
        maxAssetsPerSession: 5000,
        maxPreviewsPerToolCall: 100,
        maxPreviewsPerSession: 500,
        maxOriginalsPerToolCall: 25,
        maxOriginalsPerSession: 50,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['writeScope', 'updateAssetMetadata'],
        message: 'Invalid input: expected boolean, received undefined',
      }),
    ]);
  });

  it('requires shared-space member write-scope flags in custom permission plans', () => {
    const permissionPlan = makePermissionPlan();
    const writeScope = { ...permissionPlan.writeScope };
    delete (writeScope as Partial<typeof writeScope>).addMembersToSpaces;

    const result = AgentPermissionPlanSchema.safeParse({ ...permissionPlan, writeScope });

    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([
      expect.objectContaining({
        path: ['writeScope', 'addMembersToSpaces'],
        message: 'Invalid input: expected boolean, received undefined',
      }),
    ]);
  });

  it('accepts preview and original per-session limits when matching reads are enabled', () => {
    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: fullWriteScope,
      limits: {
        maxAssetsPerToolCall: 500,
        maxAssetsPerSession: 5000,
        maxPreviewsPerToolCall: 100,
        maxPreviewsPerSession: 500,
        maxOriginalsPerToolCall: 25,
        maxOriginalsPerSession: 50,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(true);
  });

  it('accepts legacy permission plans without preview and original per-session limits', () => {
    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: fullWriteScope,
      limits: {
        maxAssetsPerToolCall: 500,
        maxAssetsPerSession: 5000,
        maxPreviewsPerToolCall: 100,
        maxOriginalsPerToolCall: 25,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects preview and original session limits that exceed total asset session limits', () => {
    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: fullWriteScope,
      limits: {
        maxAssetsPerToolCall: 100,
        maxAssetsPerSession: 100,
        maxPreviewsPerToolCall: 10,
        maxPreviewsPerSession: 101,
        maxOriginalsPerToolCall: 5,
        maxOriginalsPerSession: 101,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'preview session limit cannot exceed the asset session limit',
        'original session limit cannot exceed the asset session limit',
      ]),
    );
  });

  it('rejects positive preview and original session limits without matching reads', () => {
    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: false, originals: false },
      providerExposure: {
        metadata: true,
        previews: false,
        originals: false,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: fullWriteScope,
      limits: {
        maxAssetsPerToolCall: 100,
        maxAssetsPerSession: 100,
        maxPreviewsPerToolCall: 0,
        maxPreviewsPerSession: 1,
        maxOriginalsPerToolCall: 0,
        maxOriginalsPerSession: 1,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'preview session limits require preview reads',
        'original session limits require original reads',
      ]),
    );
  });

  it('rejects preview and original session limits below matching per-tool-call limits', () => {
    const result = AgentPermissionPlanSchema.safeParse({
      read: { metadata: true, previews: true, originals: true },
      providerExposure: {
        metadata: true,
        previews: true,
        originals: true,
        allowOriginalsForExternalProviders: false,
      },
      assetScope: { owned: true, sharedSpaces: true, locked: false },
      writeScope: fullWriteScope,
      limits: {
        maxAssetsPerToolCall: 100,
        maxAssetsPerSession: 100,
        maxPreviewsPerToolCall: 10,
        maxPreviewsPerSession: 9,
        maxOriginalsPerToolCall: 5,
        maxOriginalsPerSession: 4,
        expiresInMinutes: 120,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toEqual(
      expect.arrayContaining([
        'preview session limit must be at least the preview per-tool-call limit',
        'original session limit must be at least the original per-tool-call limit',
      ]),
    );
  });
});

describe('Generated agent permission contracts', () => {
  it('marks expanded write-scope keys as required in the generated OpenAPI contract', () => {
    const openApi = JSON.parse(
      readFileSync(resolve(process.cwd(), '../open-api/immich-openapi-specs.json'), 'utf8'),
    ) as {
      components: {
        schemas: {
          AgentPermissionPlan: {
            properties: { writeScope: { required: string[] } };
          };
        };
      };
    };

    expect(openApi.components.schemas.AgentPermissionPlan.properties.writeScope.required).toEqual(
      expect.arrayContaining(Object.keys(fullWriteScope)),
    );
  });

  it('exposes expanded write-scope fields and operation enums in the generated TypeScript SDK', () => {
    const sdk = readFileSync(resolve(process.cwd(), '../packages/sdk/src/fetch-client.ts'), 'utf8');

    for (const key of expandedWriteScopeKeys) {
      expect(sdk).toContain(`${key}: boolean`);
    }

    expect(sdk).toContain('AlbumRemoveAssets = "album.removeAssets"');
    expect(sdk).toContain('SpaceCreate = "space.create"');
    expect(sdk).toContain('SpaceAddAssets = "space.addAssets"');
    expect(sdk).toContain('SpaceRemoveAssets = "space.removeAssets"');
    expect(sdk).toContain('SpaceUpdateDetails = "space.updateDetails"');
    expect(sdk).toContain('AssetRotate = "asset.rotate"');
    expect(sdk).toContain('AssetSetFavorite = "asset.setFavorite"');
    expect(sdk).toContain('AssetSetArchive = "asset.setArchive"');
    expect(sdk).toContain('AssetAddTag = "asset.addTag"');
    expect(sdk).toContain('AssetRemoveTag = "asset.removeTag"');
    expect(sdk).toContain('AssetTrash = "asset.trash"');
    expect(sdk).toContain('AssetRestore = "asset.restore"');
    expect(sdk).toContain('ShareLinkCreate = "shareLink.create"');
    expect(sdk).toContain('NewSpace = "new_space"');
    expect(sdk).toContain('ExistingSpace = "existing_space"');
    expect(sdk).toContain('AssetBatch = "asset_batch"');
    expect(sdk).toContain('ImageEditBatch = "image_edit_batch"');
    expect(sdk).toContain('Album = "album"');
    expect(sdk).toContain('Space = "space"');
    expect(sdk).toContain('Person = "person"');
    expect(sdk).toContain('Tag = "tag"');
  });
});

describe('AgentSessionResponseDto', () => {
  it('normalizes legacy permission snapshots with missing expanded write-scope keys to false', () => {
    const now = '2026-05-17T12:00:00.000Z';
    const result = AgentSessionResponseDto.schema.safeParse({
      id: '3fe388e4-2078-44d7-b36c-000000000010',
      status: AgentSessionStatus.Running,
      title: null,
      providerCredentialId,
      credentialSnapshot: {
        id: providerCredentialId,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI personal',
        baseUrl: null,
        models: ['gpt-5'],
        defaultModel: 'gpt-5',
      },
      modelSnapshot: { providerCredentialId, model: 'gpt-5' },
      permissionPreset: AgentPermissionPreset.Careful,
      permissionPlanSnapshot: {
        ...makePermissionPlan(),
        writeScope: { createAlbum: true, addAssets: true, updateDetails: true, setCover: true },
      },
      approvalMode: AgentApprovalMode.Strict,
      runnerEndpoint: null,
      runnerSessionId: null,
      runnerCapabilitiesSnapshot: null,
      initialContextSnapshot: {},
      createdAt: now,
      updatedAt: now,
      endedAt: null,
    });

    expect(result.success).toBe(true);
    expect(result.data?.permissionPlanSnapshot.writeScope).toMatchObject({
      createAlbum: true,
      addAssets: true,
      updateDetails: true,
      setCover: true,
      removeAssets: false,
      createSpace: false,
      addAssetsToSpaces: false,
      removeAssetsFromSpaces: false,
      updateSpaceDetails: false,
      editAssets: false,
      favoriteAssets: false,
      archiveAssets: false,
      tagAssets: false,
      updateAssetMetadata: false,
      addMembersToSpaces: false,
      removeMembersFromSpaces: false,
      updateSpaceMemberRoles: false,
      createSharedLinks: false,
    });
  });
});

describe('AgentSessionCreateDto', () => {
  it('should accept a valid custom session request', () => {
    const result = AgentSessionCreateDto.schema.safeParse(makeCustomCreateInput());

    expect(result.success).toBe(true);
  });

  it('should reject custom preset without permissionPlan', () => {
    expectIssue(
      makeCustomCreateInput({ permissionPlan: undefined }),
      ['permissionPlan'],
      'permissionPlan is required when permissionPreset is custom',
    );
  });

  it('should reject permissionPlan for non-custom presets', () => {
    expectIssue(
      makeCustomCreateInput({ permissionPreset: AgentPermissionPreset.Careful }),
      ['permissionPlan'],
      'permissionPlan is only accepted when permissionPreset is custom',
    );
  });

  it.each([
    {
      name: 'metadata',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.read.metadata = false;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'providerExposure', 'metadata'],
      message: 'metadata exposure requires metadata reads',
    },
    {
      name: 'previews',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.read.previews = false;
        permissionPlan.limits.maxPreviewsPerToolCall = 0;
        permissionPlan.limits.maxPreviewsPerSession = 0;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'providerExposure', 'previews'],
      message: 'preview exposure requires preview reads',
    },
    {
      name: 'originals',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.read.originals = false;
        permissionPlan.limits.maxOriginalsPerToolCall = 0;
        permissionPlan.limits.maxOriginalsPerSession = 0;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'providerExposure', 'originals'],
      message: 'original exposure requires original reads',
    },
  ])('should reject $name provider exposure without corresponding read access', ({ makeInput, path, message }) => {
    expectIssue(makeInput(), path, message);
  });

  it.each([
    {
      name: 'preview',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.read.previews = false;
        permissionPlan.providerExposure.previews = false;
        permissionPlan.limits.maxPreviewsPerSession = 0;
        permissionPlan.limits.maxPreviewsPerToolCall = 1;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'limits', 'maxPreviewsPerToolCall'],
      message: 'preview limits require preview reads',
    },
    {
      name: 'original',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.read.originals = false;
        permissionPlan.providerExposure.originals = false;
        permissionPlan.limits.maxOriginalsPerSession = 0;
        permissionPlan.limits.maxOriginalsPerToolCall = 1;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'limits', 'maxOriginalsPerToolCall'],
      message: 'original limits require original reads',
    },
  ])('should reject positive $name limits without corresponding read access', ({ makeInput, path, message }) => {
    expectIssue(makeInput(), path, message);
  });

  it('should reject a session asset limit below the per-tool-call asset limit', () => {
    const permissionPlan = makePermissionPlan();
    permissionPlan.limits.maxAssetsPerToolCall = 20;
    permissionPlan.limits.maxAssetsPerSession = 19;

    expectIssue(
      makeCustomCreateInput({ permissionPlan }),
      ['permissionPlan', 'limits', 'maxAssetsPerSession'],
      'session asset limit must be at least the per-tool-call asset limit',
    );
  });

  it.each([
    {
      name: 'preview',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.limits.maxAssetsPerToolCall = 5;
        permissionPlan.limits.maxPreviewsPerToolCall = 6;
        permissionPlan.limits.maxOriginalsPerToolCall = 5;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'limits', 'maxPreviewsPerToolCall'],
      message: 'preview limit cannot exceed the per-tool-call asset limit',
    },
    {
      name: 'original',
      makeInput: () => {
        const permissionPlan = makePermissionPlan();
        permissionPlan.limits.maxAssetsPerToolCall = 5;
        permissionPlan.limits.maxPreviewsPerToolCall = 5;
        permissionPlan.limits.maxOriginalsPerToolCall = 6;
        return makeCustomCreateInput({ permissionPlan });
      },
      path: ['permissionPlan', 'limits', 'maxOriginalsPerToolCall'],
      message: 'original limit cannot exceed the per-tool-call asset limit',
    },
  ])('should reject $name per-call limits above the per-tool-call asset limit', ({ makeInput, path, message }) => {
    expectIssue(makeInput(), path, message);
  });

  it('should accept initialContext at exactly 16 KiB JSON', () => {
    const result = AgentSessionCreateDto.schema.safeParse(
      makeCustomCreateInput({ initialContext: makeInitialContext(maxInitialContextBytes) }),
    );

    expect(result.success).toBe(true);
  });

  it('should reject initialContext over 16 KiB JSON', () => {
    expectIssue(
      makeCustomCreateInput({ initialContext: makeInitialContext(maxInitialContextBytes + 1) }),
      ['initialContext'],
      'initialContext must be 16 KiB or less',
    );
  });
});

describe('AgentSessionUpdateDto', () => {
  it('accepts a trimmed title and clearing the title', () => {
    expect(AgentSessionUpdateDto.schema.safeParse({ title: '  Album cleanup  ' })).toMatchObject({
      success: true,
      data: { title: 'Album cleanup' },
    });
    expect(AgentSessionUpdateDto.schema.safeParse({ title: null })).toMatchObject({
      success: true,
      data: { title: null },
    });
  });

  it.each([
    { name: 'missing', input: {}, message: 'Invalid input: expected string, received undefined' },
    { name: 'blank', input: { title: '   ' }, message: 'Too small: expected string to have >=1 characters' },
    {
      name: 'too long',
      input: { title: 'x'.repeat(121) },
      message: 'Too big: expected string to have <=120 characters',
    },
  ])('rejects $name title updates', ({ input, message }) => {
    const result = AgentSessionUpdateDto.schema.safeParse(input);

    expect(result.success).toBe(false);
    if (result.success) {
      return;
    }

    expect(result.error.issues).toEqual([expect.objectContaining({ path: ['title'], message })]);
  });
});
