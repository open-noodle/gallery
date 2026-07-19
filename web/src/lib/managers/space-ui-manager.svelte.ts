export type SpaceIntent = 'add-assets' | 'set-cover' | null;

/**
 * Cross-route UI state for the space shell.
 *
 * The shell layout (app bar) lives above the per-tab content, but two actions —
 * "Add photos" and "Change cover" — are fulfilled by the Photos page's selection
 * modes. The layout records an intent here and navigates to the Photos route; the
 * Photos page consumes it on mount (and reactively while already mounted), then it
 * is cleared so a later manual visit does not re-enter a selection mode.
 *
 * `chromeHidden` lets the Photos page hide the shell app bar + cover + tabs while a
 * full-screen selection mode is active. `coverCollapsed` is driven by Timeline scroll.
 */
class SpaceUiManager {
  intent = $state<SpaceIntent>(null);
  chromeHidden = $state(false);
  coverCollapsed = $state(false);

  requestAddPhotos() {
    this.intent = 'add-assets';
  }

  requestChangeCover() {
    this.intent = 'set-cover';
  }

  consumeIntent(): SpaceIntent {
    const intent = this.intent;
    this.intent = null;
    return intent;
  }

  setChromeHidden(value: boolean) {
    this.chromeHidden = value;
  }

  setCoverCollapsed(value: boolean) {
    this.coverCollapsed = value;
  }

  reset() {
    this.intent = null;
    this.chromeHidden = false;
    this.coverCollapsed = false;
  }
}

export const spaceUiManager = new SpaceUiManager();
