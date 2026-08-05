import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/svelte';
import StorageSpace from '$lib/components/shared-components/side-bar/StorageSpace.svelte';
import RailStorage from '$lib/components/shared-components/side-bar/rail-storage.svelte';
import { getByteUnitString } from '$lib/utils/byte-units';

const mocks = vi.hoisted(() => ({
  authManager: { authenticated: true, user: { quotaSizeInBytes: null as number | null, quotaUsageInBytes: 0 } },
  userInteraction: {
    serverInfo: { diskSizeRaw: 0, diskUseRaw: 0 } as { diskSizeRaw: number; diskUseRaw: number } | undefined,
  },
}));

vi.mock('$lib/managers/auth-manager.svelte', () => ({ authManager: mocks.authManager }));
vi.mock('$lib/stores/user.svelte', () => ({ userInteraction: mocks.userInteraction }));
vi.mock('$lib/utils/auth', () => ({ requestServerInfo: vi.fn() }));

// Spied (not stubbed): both StorageSpace and rail-storage keep computing real byte-unit
// strings, but the parity block below inspects the spy's call arguments to compare what each
// component derived internally - without adding test-only markup to the upstream component.
vi.mock('$lib/utils/byte-units', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/utils/byte-units')>();
  return { ...actual, getByteUnitString: vi.fn(actual.getByteUnitString) };
});

const bytes = () => {
  const node = screen.getByTestId('rail-storage');
  return { used: Number(node.dataset.used), available: Number(node.dataset.available) };
};

// Both StorageSpace and rail-storage call getByteUnitString with maxPrecision 3 only for the
// tooltip `title` (StorageSpace also calls it with the default precision for its on-screen
// Meter label, which this filter excludes). In both components' markup the `used` value is
// evaluated before `available`, so the first two matching calls are that component's
// used/available bytes, in that order.
const precisionThreeTitleBytes = () => {
  const [usedCall, availableCall] = vi.mocked(getByteUnitString).mock.calls.filter((call) => call[2] === 3);
  return { used: usedCall?.[0], available: availableCall?.[0] };
};

describe('rail-storage', () => {
  beforeEach(() => {
    mocks.authManager.authenticated = true;
    mocks.authManager.user = { quotaSizeInBytes: null, quotaUsageInBytes: 0 };
    mocks.userInteraction.serverInfo = { diskSizeRaw: 50_000_000_000, diskUseRaw: 12_000_000_000 };
  });

  it('renders the storage icon with an accessible label', () => {
    render(RailStorage);

    expect(screen.getByTestId('rail-storage')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'storage' })).toBeInTheDocument();
  });

  // Spec coverage 21. This must assert NUMBERS, not the tooltip: under test $t() returns
  // the raw key, so the title is the literal string 'storage_usage' for any byte values -
  // a title comparison would pass no matter how wrong the derivation got. This table pins
  // rail-storage's OWN derivation against regressions to its own code; it does not detect
  // rail-storage silently drifting away from StorageSpace after an upstream change to the
  // latter - the "parity with StorageSpace" block below is what covers that.
  it.each`
    scenario                    | quotaSize         | quotaUsed        | diskSize          | diskUse           | used              | available
    ${'no quota, server disk'}  | ${null}           | ${0}             | ${50_000_000_000} | ${12_000_000_000} | ${12_000_000_000} | ${50_000_000_000}
    ${'quota overrides disk'}   | ${20_000_000_000} | ${5_000_000_000} | ${50_000_000_000} | ${12_000_000_000} | ${5_000_000_000}  | ${20_000_000_000}
    ${'zero quota is honoured'} | ${0}              | ${0}             | ${50_000_000_000} | ${12_000_000_000} | ${0}              | ${0}
  `('derives bytes for $scenario', ({ quotaSize, quotaUsed, diskSize, diskUse, used, available }) => {
    mocks.authManager.user = { quotaSizeInBytes: quotaSize, quotaUsageInBytes: quotaUsed };
    mocks.userInteraction.serverInfo = { diskSizeRaw: diskSize, diskUseRaw: diskUse };

    render(RailStorage);

    expect(bytes()).toEqual({ used, available });
  });

  it('falls back to zero when the server info has not arrived', () => {
    mocks.userInteraction.serverInfo = undefined;

    render(RailStorage);

    expect(bytes()).toEqual({ used: 0, available: 0 });
  });

  it('uses server disk figures when unauthenticated even if a quota exists', () => {
    mocks.authManager.authenticated = false;
    mocks.authManager.user = { quotaSizeInBytes: 20_000_000_000, quotaUsageInBytes: 5_000_000_000 };

    render(RailStorage);

    expect(bytes()).toEqual({ used: 12_000_000_000, available: 50_000_000_000 });
  });
});

// Compensating control for duplicating StorageSpace's used/available derivation into
// rail-storage.svelte: render both components against the same store state and assert they
// report identical bytes. If an upstream change to StorageSpace's quota-vs-disk logic ever
// diverges from rail-storage's frozen copy, this fails - even though the byte-derivation
// table above (which only exercises rail-storage's own code) would keep passing.
describe('rail-storage parity with StorageSpace', () => {
  beforeEach(() => {
    mocks.authManager.authenticated = true;
    vi.mocked(getByteUnitString).mockClear();
  });

  it.each`
    scenario                   | quotaSize         | quotaUsed        | diskSize          | diskUse
    ${'quota set'}             | ${20_000_000_000} | ${5_000_000_000} | ${50_000_000_000} | ${12_000_000_000}
    ${'no quota, server disk'} | ${null}           | ${0}             | ${50_000_000_000} | ${12_000_000_000}
  `('reports identical bytes to StorageSpace for $scenario', ({ quotaSize, quotaUsed, diskSize, diskUse }) => {
    mocks.authManager.user = { quotaSizeInBytes: quotaSize, quotaUsageInBytes: quotaUsed };
    mocks.userInteraction.serverInfo = { diskSizeRaw: diskSize, diskUseRaw: diskUse };

    render(StorageSpace);
    const storageSpaceBytes = precisionThreeTitleBytes();
    vi.mocked(getByteUnitString).mockClear();

    render(RailStorage);
    const railStorageBytes = precisionThreeTitleBytes();

    expect(railStorageBytes).toEqual(storageSpaceBytes);
  });
});
