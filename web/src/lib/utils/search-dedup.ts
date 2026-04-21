/**
 * Append new paginated items to an existing array, de-duplicating by `id`.
 *
 * Used by smart-search-results.svelte to guard against the same asset.id
 * appearing on adjacent paginated responses from searchSmart. The server
 * does not currently apply a stable tiebreaker to identical CLIP distances
 * (byte-identical image content), so offset pagination can yield the same
 * asset.id on both pages 1 and 2. Dedup here prevents Svelte's keyed
 * {#each} from crashing with each_key_duplicate.
 *
 * Pure function by design — both for testability and because the dedup
 * is load-bearing (this is the only cross-page duplicate guard now).
 */
export function dedupeAppend<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const existingIds = new Set(existing.map((a) => a.id));
  return existing.concat(incoming.filter((a) => !existingIds.has(a.id)));
}
