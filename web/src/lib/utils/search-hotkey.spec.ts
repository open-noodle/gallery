import { isApplePlatform, searchHotkeyLabel } from '$lib/utils/search-hotkey';

describe('search hotkey label', () => {
  it.each(['MacIntel', 'iPhone', 'iPad', 'iPod'])('uses ⌘K on %s', (platform) => {
    expect(isApplePlatform(platform)).toBe(true);
    expect(searchHotkeyLabel(platform)).toBe('⌘K');
  });

  it.each(['Linux x86_64', 'Win32', 'Linux armv8l', ''])('uses Ctrl+K on "%s"', (platform) => {
    expect(isApplePlatform(platform)).toBe(false);
    expect(searchHotkeyLabel(platform)).toBe('Ctrl+K');
  });
});
