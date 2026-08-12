import { getAlbumInfo, getUser } from '@immich/sdk';
import type { FilterState } from '$lib/components/filter-panel/filter-panel';

/**
 * Lazy, by-id resolution of the `albumId` / `ownerId` filter chips' labels.
 *
 * The two feeders behind the `personNames` / `tagNames` maps cannot name an album or an owner:
 * `FilterSuggestionsResponseDto` carries no albums/owners, and the typed-search name cache is
 * sessionStorage written at click time — empty on a reload and on a link someone else sent you,
 * which is exactly the case that matters for URL-backed, shareable filters. Without this, the chip
 * falls back to `?? id` and shows a raw UUID.
 *
 * Resolution is BY ID (`getAlbumInfo` / `getUser`), never by listing: listing would fetch every
 * album to name one, and `getAllAlbums()` only returns albums the viewer owns or is shared on — so
 * an `?albumId=` link to an album reachable another way would still degrade to a UUID.
 *
 * A page may seed the maps from data it already has in scope (a Space's `members`, an album's
 * `albumUsers`); a seeded id is then never fetched.
 */

/**
 * In-flight resolutions, keyed `album:<id>` / `user:<id>`, so a re-render (or two surfaces sharing
 * an id) cannot issue a second request for an id whose first request has not landed yet. A settled
 * id needs no entry: it is either in the names map (hit) or worth retrying (miss).
 *
 * The cached promise resolves to the fetched VALUE (`string | undefined`), not to a map write.
 * Two surfaces can call `resolveFilterNames` with the *same id* but *different* `names` map
 * instances (e.g. a client-side nav from `/photos?albumId=X` to `/map?albumId=X` while the first
 * request is still in flight) — each caller must still write the resolved name into its own map.
 * If the shared closure captured and wrote only the first caller's map, the second caller's map —
 * and the chip reading from it — would never receive the name.
 */
const inFlight = new Map<string, Promise<string | undefined>>();

async function resolveOnce(key: string, resolve: () => Promise<string | undefined>): Promise<string | undefined> {
  const pending = inFlight.get(key);
  if (pending) {
    return pending;
  }

  const promise = resolve().finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

/**
 * Fills `albumNames` / `ownerNames` in place for any id in `filters` they do not already hold.
 *
 * Never throws and never toasts: an album or user the viewer cannot read is a chip that keeps its
 * `?? id` fallback, not a page-breaking error. (A rejection here would be unhandled — the callers
 * are `$effect`s.)
 */
export async function resolveFilterNames(
  filters: FilterState,
  names: { albumNames: Map<string, string>; ownerNames: Map<string, string> },
): Promise<void> {
  const { albumId, ownerId } = filters;
  const tasks: Promise<void>[] = [];

  if (albumId && !names.albumNames.has(albumId)) {
    tasks.push(
      resolveOnce(`album:${albumId}`, async () => {
        try {
          const album = await getAlbumInfo({ id: albumId });
          return album?.albumName;
        } catch {
          // Fail soft — the chip keeps showing the id.
          return undefined;
        }
      }).then((albumName) => {
        if (albumName) {
          names.albumNames.set(albumId, albumName);
        }
      }),
    );
  }

  if (ownerId && !names.ownerNames.has(ownerId)) {
    tasks.push(
      resolveOnce(`user:${ownerId}`, async () => {
        try {
          const user = await getUser({ id: ownerId });
          return user?.name;
        } catch {
          // Fail soft — the chip keeps showing the id.
          return undefined;
        }
      }).then((ownerName) => {
        if (ownerName) {
          names.ownerNames.set(ownerId, ownerName);
        }
      }),
    );
  }

  await Promise.all(tasks);
}
