import { PersistedLocalStorage } from '$lib/utils/persisted';

/**
 * How an album shows its collapsed stacks (specs/2026-11-01-album-stack-collapse-design.md), kept per browser like the
 * album's "show owners" toggle. Both default to the whole stack.
 */
class AlbumStackPreferences {
  #countInAlbum = new PersistedLocalStorage<boolean>('gallery-album-stack-count-in-album', false);
  #stripInAlbum = new PersistedLocalStorage<boolean>('gallery-album-stack-strip-in-album', false);

  /** The stack badge counts only the photos in this album, not the whole stack. */
  get countInAlbum() {
    return this.#countInAlbum.current;
  }

  set countInAlbum(value: boolean) {
    this.#countInAlbum.current = value;
  }

  /** The viewer's stack strip shows only the photos in this album, not the whole stack. */
  get stripInAlbum() {
    return this.#stripInAlbum.current;
  }

  set stripInAlbum(value: boolean) {
    this.#stripInAlbum.current = value;
  }
}

export const albumStackPreferences = new AlbumStackPreferences();
