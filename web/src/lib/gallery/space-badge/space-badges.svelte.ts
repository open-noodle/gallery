import { getAssetSpaces, type SharedSpaceResponseDto } from '@immich/sdk';
import { SvelteMap } from 'svelte/reactivity';
import { eventManager } from '$lib/managers/event-manager.svelte';
import { loadSpaces, userInteraction } from '$lib/stores/user.svelte';

// The thumbnails one render mounts ask together; a scroll asks again a moment later.
const BATCH_DELAY_MS = 50;
const BATCH_SIZE = 500;
// loadSpaces shows an error each time it fails: after a failure, wait before asking for the list again.
const SPACES_RETRY_MS = 60_000;
const NO_SPACE_IDS: string[] = [];
const NO_SPACES: SharedSpaceResponseDto[] = [];
const STALE = -1;

interface Answer {
  spaceIds: string[];
  /** The round it was asked in; an older one is shown until a fresh answer replaces it. */
  round: number;
}

/**
 * Which of the user's spaces show each thumbnail's asset. Mounted thumbnails ask in batches; answers are kept and
 * asked again when they may have changed: at once for the assets a space or album change names, and for every
 * mounted thumbnail after a change that names none or a move to another page.
 */
class SpaceBadges {
  #answers = new SvelteMap<string, Answer>();
  #round = $state(0);
  #session = 0;
  #pending = new Set<string>();
  #inFlight = new Set<string>();
  #staleInFlight = new Set<string>();
  #timer: ReturnType<typeof setTimeout> | undefined;
  // The last spaces list, shown while the shared one reloads after a space change.
  #spaces = $state<SharedSpaceResponseDto[]>();
  #spacesAskedAt = 0;

  constructor() {
    $effect.root(() => {
      $effect(() => {
        if (userInteraction.recentSpaces) {
          this.#spaces = userInteraction.recentSpaces;
        }
      });
    });
  }

  /** Asks the server about the asset unless a current answer is known or on its way. */
  request(assetId: string) {
    // Read first, so a new round asks again about every mounted thumbnail, the ones without an answer included.
    const round = this.#round;
    const answer = this.#answers.get(assetId);
    if ((answer && answer.round >= round) || this.#pending.has(assetId) || this.#inFlight.has(assetId)) {
      return;
    }
    this.#pending.add(assetId);
    if (!this.#timer) {
      this.#timer = setTimeout(() => void this.#flush(), BATCH_DELAY_MS);
    }
  }

  /** Whether the asset is known to be in one of the user's spaces. */
  inSomeSpace(assetId: string) {
    return (this.#answers.get(assetId)?.spaceIds.length ?? 0) > 0;
  }

  /** The user's spaces showing the asset, or undefined until both the asset and the spaces are known. */
  spacesOf(assetId: string): SharedSpaceResponseDto[] | undefined {
    const ids = this.#answers.get(assetId)?.spaceIds;
    if (ids?.length === 0) {
      return NO_SPACES;
    }
    const spaces = userInteraction.recentSpaces ?? this.#spaces;
    return ids && spaces ? spaces.filter((space) => ids.includes(space.id)) : undefined;
  }

  /** Asks again about the given assets, keeping their badges until the answer. */
  refresh(assetIds: string[]) {
    for (const assetId of assetIds) {
      if (this.#inFlight.has(assetId)) {
        this.#staleInFlight.add(assetId);
      }
      const answer = this.#answers.get(assetId);
      if (answer) {
        this.#answers.set(assetId, { ...answer, round: STALE });
      }
    }
  }

  /** Asks again about every mounted thumbnail, keeping the badges until the answers. */
  refreshAll() {
    this.#round++;
  }

  /** Forgets everything, and drops the answers still on their way. */
  reset() {
    this.#session++;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    for (const set of [this.#pending, this.#inFlight, this.#staleInFlight]) {
      set.clear();
    }
    this.#answers.clear();
    this.#spaces = undefined;
    this.#spacesAskedAt = 0;
  }

  /** The spaces list changed: it may be loaded again at once. */
  spacesChanged() {
    this.#spacesAskedAt = 0;
  }

  async #flush() {
    this.#timer = undefined;
    const session = this.#session;
    const round = this.#round;
    const assetIds = [...this.#pending];
    this.#pending.clear();
    for (const assetId of assetIds) {
      this.#inFlight.add(assetId);
    }
    let found = false;
    for (let index = 0; index < assetIds.length; index += BATCH_SIZE) {
      const batch = assetIds.slice(index, index + BATCH_SIZE);
      try {
        const { assets } = await getAssetSpaces({ assetSpacesDto: { assetIds: batch } });
        if (session !== this.#session) {
          return;
        }
        const spaceIds = new Map(assets.map((asset) => [asset.assetId, asset.spaceIds]));
        found ||= assets.some((asset) => asset.spaceIds.length > 0);
        for (const assetId of batch) {
          const stale = this.#staleInFlight.delete(assetId);
          this.#answers.set(assetId, { spaceIds: spaceIds.get(assetId) ?? NO_SPACE_IDS, round: stale ? STALE : round });
        }
      } catch {
        // A badge is a hint: without an answer the thumbnail shows none, and asks again on the next batch or page.
      } finally {
        if (session === this.#session) {
          for (const assetId of batch) {
            this.#inFlight.delete(assetId);
            this.#staleInFlight.delete(assetId);
          }
        }
      }
    }
    if (found) {
      this.#ensureSpaces();
    }
  }

  // The colours come from the spaces list, which only an asset in a space needs.
  #ensureSpaces() {
    if (userInteraction.recentSpaces || Date.now() - this.#spacesAskedAt < SPACES_RETRY_MS) {
      return;
    }
    this.#spacesAskedAt = Date.now();
    loadSpaces();
  }
}

export const spaceBadges = new SpaceBadges();

// eslint-disable-next-line unicorn/no-top-level-side-effects
eventManager.on({
  SpaceAddAssets: ({ assetIds }) => {
    spaceBadges.spacesChanged();
    spaceBadges.refresh(assetIds);
  },
  SpaceRemoveAssets: ({ assetIds }) => {
    spaceBadges.spacesChanged();
    spaceBadges.refresh(assetIds);
  },
  SpaceLinkAlbum: () => {
    spaceBadges.spacesChanged();
    spaceBadges.refreshAll();
  },
  SpaceUnlinkAlbum: () => {
    spaceBadges.spacesChanged();
    spaceBadges.refreshAll();
  },
  // A new colour: asking again brings the spaces list back, and the old colour shows until it is there.
  SpaceUpdate: () => {
    spaceBadges.spacesChanged();
    spaceBadges.refreshAll();
  },
  AlbumAddAssets: ({ assetIds }) => spaceBadges.refresh(assetIds),
  AlbumRemoveAssets: ({ assetIds }) => spaceBadges.refresh(assetIds),
  AlbumDelete: () => spaceBadges.refreshAll(),
  // Changes made elsewhere (another tab or device, another member, a library) show on the next page.
  AppNavigate: () => spaceBadges.refreshAll(),
  AuthLogout: () => spaceBadges.reset(),
});
