import { mergeScopedPeople, type MergeScopedPeopleDto } from '@immich/sdk';
import {
  CrossOwnerMergeErrorCode,
  getCrossOwnerMergeErrorCode,
  runScopedMergeWithCrossOwnerConfirmation,
} from '$lib/utils/cross-owner-merge';

vi.mock('@immich/sdk', () => ({
  isHttpError: (error: unknown) => !!(error as { __http?: boolean })?.__http,
  mergeScopedPeople: vi.fn(),
}));

const httpError = (status: number, data: Record<string, unknown>) => ({ __http: true, status, data, message: 'raw' });

// Void endpoints (e.g. /people/same-person) return the body unparsed, so `data` is a raw string.
const httpErrorRaw = (status: number, data: Record<string, unknown>) =>
  httpError(status, JSON.stringify(data) as unknown as Record<string, unknown>);

const dto = {
  target: { type: 'person', id: 'target' },
  sources: [{ type: 'space-person', id: 'source', spaceId: 'space-1' }],
} as MergeScopedPeopleDto;

describe('getCrossOwnerMergeErrorCode', () => {
  it('reads the code from a structured http error', () => {
    expect(getCrossOwnerMergeErrorCode(httpError(403, { code: 'cross_owner_merge_blocked' }))).toBe(
      CrossOwnerMergeErrorCode.Blocked,
    );
  });

  it('reads the code from a raw (unparsed) string body', () => {
    expect(getCrossOwnerMergeErrorCode(httpErrorRaw(403, { code: 'cross_owner_merge_blocked' }))).toBe(
      CrossOwnerMergeErrorCode.Blocked,
    );
  });

  it('returns undefined for a non-json string body', () => {
    expect(
      getCrossOwnerMergeErrorCode(httpError(500, 'Internal Server Error' as unknown as Record<string, unknown>)),
    ).toBeUndefined();
  });

  it('returns undefined for non-http errors', () => {
    expect(getCrossOwnerMergeErrorCode(new Error('boom'))).toBeUndefined();
  });
});

describe('runScopedMergeWithCrossOwnerConfirmation', () => {
  beforeEach(() => {
    vi.mocked(mergeScopedPeople).mockReset();
  });

  it('commits a same-owner merge without asking for confirmation', async () => {
    vi.mocked(mergeScopedPeople).mockResolvedValue(undefined as never);
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(true);
    expect(mergeScopedPeople).toHaveBeenCalledTimes(1);
    expect(mergeScopedPeople).toHaveBeenCalledWith({ mergeScopedPeopleDto: dto });
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('shows the descriptive message and does not retry when blocked', async () => {
    vi.mocked(mergeScopedPeople).mockRejectedValueOnce(
      httpError(403, { code: CrossOwnerMergeErrorCode.Blocked, message: 'An administrator can enable it.' }),
    );
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(onBlocked).toHaveBeenCalledWith('An administrator can enable it.');
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(mergeScopedPeople).toHaveBeenCalledTimes(1);
  });

  it('invokes onBlocked (not a rethrow) when the blocked code arrives in a raw string body', async () => {
    vi.mocked(mergeScopedPeople).mockRejectedValueOnce(
      httpErrorRaw(403, { code: CrossOwnerMergeErrorCode.Blocked, message: 'An administrator can enable it.' }),
    );
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(onBlocked).toHaveBeenCalledWith('An administrator can enable it.');
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(mergeScopedPeople).toHaveBeenCalledTimes(1);
  });

  it('shows the confirm dialog and re-runs with the acknowledgement when the code arrives in a raw string body', async () => {
    vi.mocked(mergeScopedPeople)
      .mockRejectedValueOnce(
        httpErrorRaw(409, { code: CrossOwnerMergeErrorCode.ConfirmationRequired, impactedOwnerCount: 2 }),
      )
      .mockResolvedValueOnce(undefined as never);
    const confirmCrossOwner = vi.fn().mockResolvedValue(true);
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(true);
    expect(confirmCrossOwner).toHaveBeenCalledTimes(1);
    expect(mergeScopedPeople).toHaveBeenCalledTimes(2);
    expect(mergeScopedPeople).toHaveBeenLastCalledWith({
      mergeScopedPeopleDto: { ...dto, confirmCrossOwner: true },
    });
  });

  it('re-runs with the cross-owner acknowledgement once the user confirms', async () => {
    vi.mocked(mergeScopedPeople)
      .mockRejectedValueOnce(
        httpError(409, { code: CrossOwnerMergeErrorCode.ConfirmationRequired, impactedOwnerCount: 2 }),
      )
      .mockResolvedValueOnce(undefined as never);
    const confirmCrossOwner = vi.fn().mockResolvedValue(true);
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(true);
    expect(confirmCrossOwner).toHaveBeenCalledTimes(1);
    expect(mergeScopedPeople).toHaveBeenCalledTimes(2);
    expect(mergeScopedPeople).toHaveBeenLastCalledWith({
      mergeScopedPeopleDto: { ...dto, confirmCrossOwner: true },
    });
  });

  it('does not merge when the user declines the confirmation', async () => {
    vi.mocked(mergeScopedPeople).mockRejectedValueOnce(
      httpError(409, { code: CrossOwnerMergeErrorCode.ConfirmationRequired, impactedOwnerCount: 1 }),
    );
    const confirmCrossOwner = vi.fn().mockResolvedValue(false);
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(confirmCrossOwner).toHaveBeenCalledTimes(1);
    expect(mergeScopedPeople).toHaveBeenCalledTimes(1);
  });

  it('rethrows unrelated errors', async () => {
    vi.mocked(mergeScopedPeople).mockRejectedValueOnce(new Error('network'));

    await expect(
      runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner: vi.fn(), onBlocked: vi.fn() }),
    ).rejects.toThrow('network');
  });
});
