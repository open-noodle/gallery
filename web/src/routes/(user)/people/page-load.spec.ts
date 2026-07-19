import { sdkMock } from '$lib/__mocks__/sdk.mock';
import { PEOPLE_PAGE_SIZE } from '$lib/constants';
import { load } from './+page';

const { authenticate, getFormatter, featureFlagsMock } = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getFormatter: vi.fn(),
  featureFlagsMock: {
    valueOrUndefined: undefined as { peopleStatistics: boolean } | undefined,
  },
}));

vi.mock('$lib/utils/auth', () => ({ authenticate }));
vi.mock('$lib/utils/i18n', () => ({ getFormatter }));
vi.mock('$lib/managers/feature-flags-manager.svelte', () => ({ featureFlagsManager: featureFlagsMock }));

describe('people page load', () => {
  const peopleResponse = {
    people: [],
    total: 12,
    hidden: 2,
    hasNextPage: false,
  };

  const statisticsResponse = {
    total: 12,
    hidden: 2,
    detectedFaceCount: 2901,
  };

  let parent: ReturnType<typeof vi.fn>;

  const runLoad = (url: URL) => load({ url, parent } as never);

  beforeEach(() => {
    vi.resetAllMocks();
    getFormatter.mockResolvedValue((key: string) => key);
    sdkMock.getAllPeople.mockResolvedValue(peopleResponse);
    sdkMock.getPeopleStatistics.mockResolvedValue(statisticsResponse);
    parent = vi.fn().mockResolvedValue({});
    featureFlagsMock.valueOrUndefined = { peopleStatistics: true };
  });

  it('authenticates, awaits parent, and loads a bounded first page with overview statistics when enabled', async () => {
    const url = new URL('https://gallery.test/people');

    await expect(runLoad(url)).resolves.toEqual({
      people: peopleResponse,
      peopleStatistics: statisticsResponse,
      meta: { title: 'people' },
    });

    expect(authenticate).toHaveBeenCalledWith(url);
    // parent() resolves only after the root layout's init() runs, which is what guarantees the
    // feature-flags manager is populated before we read it.
    expect(parent).toHaveBeenCalled();
    expect(sdkMock.getAllPeople).toHaveBeenCalledWith({
      withHidden: true,
      withSharedSpaces: true,
      size: PEOPLE_PAGE_SIZE,
    });
    expect(sdkMock.getPeopleStatistics).toHaveBeenCalledWith({ withSharedSpaces: true });
    expect(sdkMock.getPeopleFaceStatistics).not.toHaveBeenCalled();
  });

  it('skips the overview statistics query when the peopleStatistics flag is disabled', async () => {
    featureFlagsMock.valueOrUndefined = { peopleStatistics: false };
    const url = new URL('https://gallery.test/people');

    await expect(runLoad(url)).resolves.toEqual({
      people: peopleResponse,
      peopleStatistics: null,
      meta: { title: 'people' },
    });

    // People still load (with the bounded size); only the discarded stats query is skipped.
    expect(sdkMock.getAllPeople).toHaveBeenCalledWith({
      withHidden: true,
      withSharedSpaces: true,
      size: PEOPLE_PAGE_SIZE,
    });
    expect(sdkMock.getPeopleStatistics).not.toHaveBeenCalled();
  });

  it('treats an uninitialized feature-flags manager as statistics-disabled', async () => {
    // In maintenance mode the root layout skips featureFlagsManager.init(), so valueOrUndefined is
    // undefined. Fail safe: skip the stats query rather than throw.
    featureFlagsMock.valueOrUndefined = undefined;
    const url = new URL('https://gallery.test/people');

    const result = await runLoad(url);

    expect(result.peopleStatistics).toBeNull();
    expect(sdkMock.getPeopleStatistics).not.toHaveBeenCalled();
    expect(sdkMock.getAllPeople).toHaveBeenCalled();
  });

  it('does not forward unsupported search parameters to overview statistics', async () => {
    const url = new URL('https://gallery.test/people?searchedPeople=Ali&closestPersonId=p1&closestAssetId=a1');

    await runLoad(url);

    expect(sdkMock.getPeopleStatistics).toHaveBeenCalledWith({ withSharedSpaces: true });
  });

  it('keeps the people list when overview statistics fail', async () => {
    const url = new URL('https://gallery.test/people');
    sdkMock.getPeopleStatistics.mockRejectedValue(new Error('stats unavailable'));

    await expect(runLoad(url)).resolves.toEqual({
      people: peopleResponse,
      peopleStatistics: null,
      meta: { title: 'people' },
    });
  });

  it('still rejects when the people list fails', async () => {
    const url = new URL('https://gallery.test/people');
    const error = new Error('people unavailable');
    sdkMock.getAllPeople.mockRejectedValue(error);

    await expect(runLoad(url)).rejects.toThrow(error);
  });
});
