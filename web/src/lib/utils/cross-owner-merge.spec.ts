import { mergeScopedPeople, type MergeScopedPeopleDto } from '@immich/sdk';
import {
  CrossOwnerMergeErrorCode,
  getCrossOwnerMergeErrorCode,
  runMergeWithCrossOwnerConfirmation,
  runScopedMergeWithCrossOwnerConfirmation,
} from '$lib/utils/cross-owner-merge';

vi.mock('@immich/sdk', () => ({
  isHttpError: (error: unknown) => !!(error as { __http?: boolean })?.__http,
  mergeScopedPeople: vi.fn(),
}));

const toastDanger = vi.fn();
vi.mock('@immich/ui', () => ({
  toastManager: { danger: (...args: unknown[]) => toastDanger(...args) },
  modalManager: { showDialog: vi.fn() },
}));

// A minimal readable store whose value is a passthrough translator, so `get(t)(key)` returns the key.
vi.mock('svelte-i18n', () => ({
  t: {
    subscribe: (run: (value: (key: string) => string) => void) => {
      run((key: string) => key);
      return () => {};
    },
  },
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

  it('invokes the localized blocked toast and does not retry when blocked', async () => {
    vi.mocked(mergeScopedPeople).mockRejectedValueOnce(
      httpError(403, { code: CrossOwnerMergeErrorCode.Blocked, message: 'An administrator can enable it.' }),
    );
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runScopedMergeWithCrossOwnerConfirmation(dto, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
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
    expect(onBlocked).toHaveBeenCalledTimes(1);
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

// Generic runner: wraps ANY merge call (classic `mergePerson`, scoped `mergeScopedPeople`, in-space
// `mergeSpacePeople`), not just the scoped endpoint. `runScopedMergeWithCrossOwnerConfirmation` above
// is now a thin wrapper over this — these tests exercise it directly with a bare merge function so
// they don't depend on any particular SDK call shape.
describe('runMergeWithCrossOwnerConfirmation', () => {
  beforeEach(() => toastDanger.mockClear());

  it('commits when the merge succeeds, without asking for confirmation', async () => {
    const merge = vi.fn().mockResolvedValue(undefined);
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(true);
    expect(merge).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledWith();
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(onBlocked).not.toHaveBeenCalled();
  });

  it('invokes the localized blocked toast and does not retry when blocked', async () => {
    const merge = vi
      .fn()
      .mockRejectedValueOnce(
        httpError(403, { code: CrossOwnerMergeErrorCode.Blocked, message: 'An administrator can enable it.' }),
      );
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('invokes onBlocked (not a rethrow) when the blocked code arrives in a raw string body', async () => {
    const merge = vi
      .fn()
      .mockRejectedValueOnce(
        httpErrorRaw(403, { code: CrossOwnerMergeErrorCode.Blocked, message: 'An administrator can enable it.' }),
      );
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('shows the confirm dialog and re-runs with the cross-owner acknowledgement once the user confirms', async () => {
    const merge = vi
      .fn()
      .mockRejectedValueOnce(
        httpError(409, { code: CrossOwnerMergeErrorCode.ConfirmationRequired, impactedOwnerCount: 2 }),
      )
      .mockResolvedValueOnce(undefined);
    const confirmCrossOwner = vi.fn().mockResolvedValue(true);
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(true);
    expect(confirmCrossOwner).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(2);
    expect(merge).toHaveBeenLastCalledWith(true);
  });

  it('does not merge when the user declines the confirmation', async () => {
    const merge = vi
      .fn()
      .mockRejectedValueOnce(
        httpError(409, { code: CrossOwnerMergeErrorCode.ConfirmationRequired, impactedOwnerCount: 1 }),
      );
    const confirmCrossOwner = vi.fn().mockResolvedValue(false);
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(confirmCrossOwner).toHaveBeenCalledTimes(1);
    expect(merge).toHaveBeenCalledTimes(1);
  });

  // #733 review L7: the other terminal merge errors get a localized toast instead of the raw truncated server
  // sentence, and are not retried or re-thrown.
  it('shows a localized toast for a known terminal merge error (not-accessible) without retrying or rethrowing', async () => {
    const merge = vi.fn().mockRejectedValueOnce(httpError(400, { code: 'merge_not_accessible', message: 'raw' }));
    const confirmCrossOwner = vi.fn();
    const onBlocked = vi.fn();

    const committed = await runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner, onBlocked });

    expect(committed).toBe(false);
    expect(toastDanger).toHaveBeenCalledWith('merge_error_not_accessible');
    expect(onBlocked).not.toHaveBeenCalled();
    expect(confirmCrossOwner).not.toHaveBeenCalled();
    expect(merge).toHaveBeenCalledTimes(1);
  });

  it('shows the localized retry toast for a concurrent-change conflict', async () => {
    const merge = vi.fn().mockRejectedValueOnce(httpError(409, { code: 'merge_conflict', message: 'raw conflict' }));

    const committed = await runMergeWithCrossOwnerConfirmation(merge, {
      confirmCrossOwner: vi.fn(),
      onBlocked: vi.fn(),
    });

    expect(committed).toBe(false);
    expect(toastDanger).toHaveBeenCalledWith('merge_error_conflict');
  });

  it('rethrows a terminal error whose code is not a known merge code (no toast)', async () => {
    const merge = vi.fn().mockRejectedValueOnce(httpError(400, { code: 'some_unknown_code', message: 'boom' }));

    await expect(
      runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner: vi.fn(), onBlocked: vi.fn() }),
    ).rejects.toMatchObject({ status: 400 });
    expect(toastDanger).not.toHaveBeenCalled();
  });

  it('rethrows unrelated errors', async () => {
    const merge = vi.fn().mockRejectedValueOnce(new Error('network'));

    await expect(
      runMergeWithCrossOwnerConfirmation(merge, { confirmCrossOwner: vi.fn(), onBlocked: vi.fn() }),
    ).rejects.toThrow('network');
  });
});
