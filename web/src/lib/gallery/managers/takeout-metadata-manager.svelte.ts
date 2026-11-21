/** The pending-metadata journal belongs to Gallery, so its manager stays in the fork namespace. */
class TakeoutMetadataManager {
  // Only ids are persisted, never descriptions or coordinates. The fallback survives storage
  // failures in the current page; localStorage also survives reopening the importer.
  #pending = new Set<string>();

  hasPending(key: string): boolean {
    try {
      return this.#pending.has(key) || localStorage.getItem(key) === 'pending';
    } catch {
      return this.#pending.has(key);
    }
  }

  setPending(key: string, value: boolean): void {
    if (value) {
      this.#pending.add(key);
    } else {
      this.#pending.delete(key);
    }
    try {
      if (value) {
        localStorage.setItem(key, 'pending');
      } else {
        localStorage.removeItem(key);
      }
    } catch {
      // Uploading still works when storage is unavailable.
    }
  }
}

export const takeoutMetadataManager = new TakeoutMetadataManager();
