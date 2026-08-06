import {
  AgentProviderType,
  AgentToolApprovalDecision,
  AgentToolCallStatus,
  AgentToolDataClass,
  AgentToolName,
} from 'src/enum';
import { AgentToolCallRepository } from 'src/repositories/agent-tool-call.repository';

const uuid = (suffix: string) => `00000000-0000-4000-8000-${suffix.padStart(12, '0')}`;

describe(AgentToolCallRepository.name, () => {
  it('preserves response metadata when transitionWithSessionLimit denies a claimed tool call', async () => {
    const sessionId = uuid('1');
    const toolCallId = uuid('2');
    const responseMetadata = {
      resultSize: {
        returnedItems: 0,
        hasMore: false,
        nextPage: null,
        estimatedBytes: null,
        truncated: false,
        omittedFields: [],
      },
    };

    let capturedUpdate: Record<string, unknown> | undefined;
    const toolCall = {
      id: toolCallId,
      sessionId,
      toolName: AgentToolName.ReadAssetMetadata,
      status: AgentToolCallStatus.Denied,
      approvalDecision: AgentToolApprovalDecision.Denied,
      requestSummary: 'Read metadata',
      responseSummary: null,
      redactedRequestMetadata: { assetIds: [uuid('3')] },
      redactedResponseMetadata: responseMetadata,
      dataClass: AgentToolDataClass.Metadata,
      assetCount: 0,
      albumCount: 0,
      providerSnapshot: {
        providerCredentialId: null,
        providerType: AgentProviderType.OpenAI,
        label: 'OpenAI',
        baseUrl: null,
        model: 'gpt-5.1',
      },
      startedAt: new Date('2026-05-21T09:00:00.000Z'),
      completedAt: new Date('2026-05-21T10:00:00.000Z'),
      error: 'Session policy allows at most 1 assets per session',
    };

    const selectSessionChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ id: sessionId }),
    };
    const selectCountChain = {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      executeTakeFirstOrThrow: vi.fn().mockResolvedValue({ assetCount: 1 }),
    };
    const updateChain = {
      set: vi.fn((update: Record<string, unknown>) => {
        capturedUpdate = update;
        return updateChain;
      }),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      executeTakeFirst: vi.fn().mockResolvedValue(toolCall),
    };
    const trx = {
      selectFrom: vi.fn((table: string) => (table === 'agent_session' ? selectSessionChain : selectCountChain)),
      updateTable: vi.fn(() => updateChain),
    };
    const db = {
      transaction: vi.fn(() => ({
        execute: vi.fn((callback) => callback(trx)),
      })),
    };
    const sut = new AgentToolCallRepository(db as never);

    const result = await sut.transitionWithSessionLimit(
      sessionId,
      toolCallId,
      AgentToolCallStatus.Executing,
      {
        status: AgentToolCallStatus.Completed,
        approvalDecision: AgentToolApprovalDecision.Approved,
        responseSummary: 'Would have returned metadata',
        redactedResponseMetadata: responseMetadata,
        assetCount: 2,
        albumCount: 0,
        completedAt: new Date('2026-05-21T10:00:00.000Z'),
        error: null,
      },
      AgentToolDataClass.Metadata,
      1,
    );

    expect(result.status).toBe('limit-exceeded');
    expect(capturedUpdate?.redactedResponseMetadata).toEqual(responseMetadata);
  });
});
