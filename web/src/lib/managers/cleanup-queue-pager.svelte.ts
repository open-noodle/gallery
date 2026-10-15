import {
  getCleanupQueue,
  type CleanupAssetDto,
  type CleanupBurstGroupDto,
  type CleanupListQueue,
  type CleanupQueuePageDto,
} from '@immich/sdk';

export const CLEANUP_PAGE_SIZE = 100;

export type CleanupQueueFilters = Omit<Parameters<typeof getCleanupQueue>[0], 'queue' | 'cursor' | 'limit'>;

export type Removed<T> = { item: T; index: number };

const removeFrom = <T>(list: T[], ids: Iterable<string>, keyOf: (entry: T) => string) => {
  const keys = new Set(ids);
  const kept: T[] = [];
  const removed: Removed<T>[] = [];
  for (const [index, entry] of list.entries()) {
    if (keys.has(keyOf(entry))) {
      removed.push({ item: entry, index });
    } else {
      kept.push(entry);
    }
  }
  return { kept, removed };
};

/** Puts removed entries back at their old positions, as far as the list still reaches. */
const restoreInto = <T>(list: T[], removed: Removed<T>[], keyOf: (entry: T) => string) => {
  const next = [...list];
  const present = new Set(next.map((entry) => keyOf(entry)));
  for (const { item, index } of [...removed].sort((a, b) => a.index - b.index)) {
    if (!present.has(keyOf(item))) {
      next.splice(Math.min(index, next.length), 0, item);
    }
  }
  return next;
};

/**
 * Keyset pagination over one Cleanup queue. `reset` starts again from the first page, for when a
 * filter changes; a request still in flight from before the reset is dropped when it lands.
 */
export class CleanupQueuePager {
  items = $state<CleanupAssetDto[]>([]);
  groups = $state<CleanupBurstGroupDto[]>([]);
  loading = $state(false);
  done = $state(false);
  /** Set when a page fails, so an infinite-scroll sentinel does not retry in a loop. */
  failed = $state(false);
  #cursor: string | undefined;
  #generation = 0;

  constructor(
    private readonly queue: CleanupListQueue,
    private readonly filters: () => CleanupQueueFilters = () => ({}),
    private readonly fetchPage: typeof getCleanupQueue = getCleanupQueue,
  ) {}

  reset() {
    this.#generation++;
    this.#cursor = undefined;
    this.items = [];
    this.groups = [];
    this.loading = false;
    this.done = false;
    this.failed = false;
  }

  /** Loads the next page. Throws on failure, after setting `failed`. */
  async loadMore() {
    if (this.loading || this.done) {
      return;
    }
    const generation = this.#generation;
    this.loading = true;
    this.failed = false;
    let page: CleanupQueuePageDto;
    try {
      page = await this.fetchPage({
        queue: this.queue,
        cursor: this.#cursor,
        limit: CLEANUP_PAGE_SIZE,
        ...this.filters(),
      });
    } catch (error) {
      if (generation === this.#generation) {
        this.failed = true;
        this.loading = false;
      }
      throw error;
    }
    if (generation !== this.#generation) {
      return;
    }
    this.items.push(...page.items);
    this.groups.push(...page.groups);
    this.#cursor = page.nextCursor ?? undefined;
    this.done = page.nextCursor === null;
    this.loading = false;
  }

  /** Drops items by id and returns them with their positions, so `restoreItems` can put them back. */
  removeItems(ids: Iterable<string>) {
    const { kept, removed } = removeFrom(this.items, ids, (item) => item.id);
    this.items = kept;
    return removed;
  }

  restoreItems(removed: Removed<CleanupAssetDto>[]) {
    this.items = restoreInto(this.items, removed, (item) => item.id);
  }

  /** Drops whole burst groups by group id. */
  removeGroups(groupIds: Iterable<string>) {
    const { kept, removed } = removeFrom(this.groups, groupIds, (group) => group.groupId);
    this.groups = kept;
    return removed;
  }

  restoreGroups(removed: Removed<CleanupBurstGroupDto>[]) {
    this.groups = restoreInto(this.groups, removed, (group) => group.groupId);
  }
}
