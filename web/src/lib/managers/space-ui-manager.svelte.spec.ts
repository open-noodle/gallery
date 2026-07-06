import { beforeEach, describe, expect, it } from 'vitest';
import { spaceUiManager } from './space-ui-manager.svelte';

describe('spaceUiManager', () => {
  beforeEach(() => {
    spaceUiManager.reset();
  });

  it('starts with no intent and visible chrome', () => {
    expect(spaceUiManager.intent).toBeNull();
    expect(spaceUiManager.chromeHidden).toBe(false);
    expect(spaceUiManager.coverCollapsed).toBe(false);
  });

  it('records an add-photos intent and clears it on consume', () => {
    spaceUiManager.requestAddPhotos();
    expect(spaceUiManager.intent).toBe('add-assets');
    expect(spaceUiManager.consumeIntent()).toBe('add-assets');
    expect(spaceUiManager.intent).toBeNull();
  });

  it('records a change-cover intent and clears it on consume', () => {
    spaceUiManager.requestChangeCover();
    expect(spaceUiManager.intent).toBe('set-cover');
    expect(spaceUiManager.consumeIntent()).toBe('set-cover');
    expect(spaceUiManager.intent).toBeNull();
  });

  it('consume is idempotent — a second consume returns null', () => {
    spaceUiManager.requestAddPhotos();
    spaceUiManager.consumeIntent();
    expect(spaceUiManager.consumeIntent()).toBeNull();
  });

  it('toggles chromeHidden and coverCollapsed', () => {
    spaceUiManager.setChromeHidden(true);
    spaceUiManager.setCoverCollapsed(true);
    expect(spaceUiManager.chromeHidden).toBe(true);
    expect(spaceUiManager.coverCollapsed).toBe(true);
  });

  it('reset() clears all state', () => {
    spaceUiManager.requestAddPhotos();
    spaceUiManager.setChromeHidden(true);
    spaceUiManager.setCoverCollapsed(true);
    spaceUiManager.reset();
    expect(spaceUiManager.intent).toBeNull();
    expect(spaceUiManager.chromeHidden).toBe(false);
    expect(spaceUiManager.coverCollapsed).toBe(false);
  });
});
