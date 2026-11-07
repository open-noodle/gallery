type AlbumStackOptions = { albumId?: string; withStacked?: boolean };

type Dependencies = {
  options: () => AlbumStackOptions;
  reload: () => Promise<void>;
  destroyed: () => boolean;
};

/**
When a stacked album timeline reloads instead of patching itself (specs/2026-11-01-album-stack-collapse-design.md).
An album collapses each stack to one of its own members, picked by the server (`album-stack-collapse.ts`), so a
local patch cannot know which member to show and would insert stack members the album does not hold. TimelineManager
reloads instead, after stack edits and after album membership changes that can change the pick. The album pages also
trigger it from `AlbumStackEvents`, because in Safari the manager's own event subscription can miss events; triggers
in the same task share one reload.
*/
export class AlbumStackReload {
  #queued = false;

  constructor(private readonly deps: Dependencies) {}

  /** Queues the reload. Returns whether this is a stacked album timeline, i.e. whether the caller should not patch. */
  request(): boolean {
    const { withStacked, albumId } = this.deps.options();
    if (!withStacked || !albumId) {
      return false;
    }
    if (!this.#queued) {
      this.#queued = true;
      queueMicrotask(() => {
        this.#queued = false;
        if (!this.deps.destroyed()) {
          void this.deps.reload();
        }
      });
    }
    return true;
  }

  /** A photo added to the album can outrank the stack-mate it shows (the primary does). */
  onAlbumAddAssets(albumIds: string[]) {
    const { albumId } = this.deps.options();
    if (albumId && albumIds.includes(albumId)) {
      this.request();
    }
  }
}
