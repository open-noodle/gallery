import type { AgentSessionResponseDto } from '@immich/sdk';
import {
  AgentApprovalMode,
  AgentPermissionPreset,
  AgentProviderType,
  AgentRunnerStatusReason,
  AgentSessionStatus,
  ProviderType,
} from '@immich/sdk';
import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { load } from './+page';

const { authenticate, getFormatter } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));

const runnerStatus = {
  configured: false,
  healthy: false,
  reason: AgentRunnerStatusReason.NotConfigured,
  version: null,
  capabilities: null,
  checkedAt: '2026-05-14T00:00:00.000Z',
};

const credentials = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    providerType: ProviderType.Openai,
    label: 'OpenAI personal',
    baseUrl: null,
    models: ['gpt-5.1'],
    defaultModel: 'gpt-5.1',
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    lastUsedAt: null,
  },
];

const sessions: AgentSessionResponseDto[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    status: AgentSessionStatus.Running,
    providerCredentialId: credentials[0].id,
    approvalMode: AgentApprovalMode.Strict,
    permissionPreset: AgentPermissionPreset.Careful,
    credentialSnapshot: {
      id: credentials[0].id,
      providerType: AgentProviderType.Openai,
      label: 'OpenAI personal',
      baseUrl: null,
      models: ['gpt-5.1'],
      defaultModel: 'gpt-5.1',
    },
    modelSnapshot: { providerCredentialId: credentials[0].id, model: 'gpt-5.1' },
    permissionPlanSnapshot: {
      assetScope: { locked: false, owned: true, sharedSpaces: false },
      limits: {
        maxAssetsPerSession: 100,
        maxAssetsPerToolCall: 50,
        maxOriginalsPerToolCall: 10,
        maxPreviewsPerToolCall: 50,
        expiresInMinutes: null,
      },
      providerExposure: { allowOriginalsForExternalProviders: false, metadata: true, originals: false, previews: true },
      read: { metadata: true, originals: false, previews: true },
      writeScope: {
        addAssets: true,
        addAssetsToSpaces: true,
        addMembersToSpaces: true,
        archiveAssets: true,
        createAlbum: true,
        createSpace: true,
        editAssets: true,
        favoriteAssets: true,
        removeAssets: true,
        removeAssetsFromSpaces: true,
        removeMembersFromSpaces: true,
        setCover: true,
        tagAssets: true,
        updateDetails: true,
        updateAssetMetadata: true,
        updateSpaceDetails: true,
        updateSpaceMemberRoles: true,
        trashAssets: true,
        createSharedLinks: false,
        manageStacks: false,
        managePeople: false,
        shareAlbums: false,
        lockAssets: false,
        deleteContainers: false,
      },
    },
    initialContextSnapshot: {},
    runnerCapabilitiesSnapshot: { protocolVersion: '1', tools: [], models: ['gpt-5.1'], streaming: true },
    runnerEndpoint: null,
    runnerSessionId: null,
    createdAt: '2026-05-14T00:00:00.000Z',
    updatedAt: '2026-05-14T00:00:00.000Z',
    endedAt: null,
  },
];

describe('/assistant load', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
    sdkMock.getAgentRunnerStatus.mockResolvedValue(runnerStatus);
    sdkMock.getAgentProviderCredentials.mockResolvedValue(credentials);
    sdkMock.getAgentSessions.mockResolvedValue(sessions);
  });

  it('authenticates the user and returns translated metadata with runner status, credentials, sessions, and requested session', async () => {
    const url = new URL(`https://gallery.test/assistant?session=${sessions[0].id}`);

    await expect(load({ url } as never)).resolves.toEqual({
      meta: { title: 'assistant' },
      runnerStatus,
      credentials,
      sessions,
      requestedSessionId: sessions[0].id,
    });

    expect(authenticate).toHaveBeenCalledWith(url);
    expect(sdkMock.getAgentRunnerStatus).toHaveBeenCalledWith();
    expect(sdkMock.getAgentProviderCredentials).toHaveBeenCalledWith();
    expect(sdkMock.getAgentSessions).toHaveBeenCalledWith();
  });

  it('returns an empty credential list', async () => {
    sdkMock.getAgentProviderCredentials.mockResolvedValue([]);

    await expect(load({ url: new URL('https://gallery.test/assistant') } as never)).resolves.toEqual(
      expect.objectContaining({ credentials: [] }),
    );
  });

  it('returns null requestedSessionId when the query is missing and preserves an empty query value', async () => {
    await expect(load({ url: new URL('https://gallery.test/assistant') } as never)).resolves.toEqual(
      expect.objectContaining({ requestedSessionId: null }),
    );

    await expect(load({ url: new URL('https://gallery.test/assistant?session=') } as never)).resolves.toEqual(
      expect.objectContaining({ requestedSessionId: '' }),
    );
  });

  it('does not call agent APIs when authentication fails', async () => {
    const error = new Error('not authenticated');
    authenticate.mockRejectedValue(error);

    await expect(load({ url: new URL('https://gallery.test/assistant') } as never)).rejects.toBe(error);

    expect(sdkMock.getAgentRunnerStatus).not.toHaveBeenCalled();
    expect(sdkMock.getAgentProviderCredentials).not.toHaveBeenCalled();
    expect(sdkMock.getAgentSessions).not.toHaveBeenCalled();
  });

  it('does not swallow agent API failures', async () => {
    const error = new Error('runner status failed');
    sdkMock.getAgentRunnerStatus.mockRejectedValue(error);

    await expect(load({ url: new URL('https://gallery.test/assistant') } as never)).rejects.toBe(error);

    expect(sdkMock.getAgentProviderCredentials).toHaveBeenCalledWith();
    expect(sdkMock.getAgentSessions).toHaveBeenCalledWith();
  });
});
