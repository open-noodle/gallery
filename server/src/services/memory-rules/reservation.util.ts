/**
 * Decides which photos each memory keeps when several are visible on the same day, so no photo
 * appears in two of them. Pure and dependency-free: the service supplies already-resolved
 * priorities and floors, and applies the returned plan. See spec §6.2.
 */

export interface ReservableMemory {
  id: string;
  assetIds: string[];
  /** higher claims first; encodes rank and score in one number (spec §6.3) */
  priority: number;
  /** fewest assets this memory may keep; below it, the memory is removed */
  floor: number;
  /**
   * False for a memory that may claim assets but must never be stripped or deleted — saved
   * memories, API-created memories, and rule memories whose rule is gone (spec §6.2.1).
   */
  managed: boolean;
}

export interface ReservationPlan {
  /** assets to remove from a memory that survives */
  strip: { memoryId: string; assetIds: string[] }[];
  /** memories to delete outright */
  remove: string[];
}

/**
 * Greedy, highest priority first. A memory that falls below its floor is removed and claims
 * nothing, so the assets it would have held stay available to the next memory in line.
 */
export const planReservation = (memories: ReservableMemory[]): ReservationPlan => {
  const ordered = [...memories].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });

  const claimed = new Set<string>();
  const strip: { memoryId: string; assetIds: string[] }[] = [];
  const remove: string[] = [];

  for (const memory of ordered) {
    const unique = [...new Set(memory.assetIds)];

    if (!memory.managed) {
      for (const assetId of unique) {
        claimed.add(assetId);
      }
      continue;
    }

    const keep = unique.filter((assetId) => !claimed.has(assetId));

    if (keep.length < memory.floor) {
      remove.push(memory.id);
      continue;
    }

    const dropped = unique.filter((assetId) => claimed.has(assetId));
    if (dropped.length > 0) {
      strip.push({ memoryId: memory.id, assetIds: dropped });
    }

    for (const assetId of keep) {
      claimed.add(assetId);
    }
  }

  return { strip, remove };
};
