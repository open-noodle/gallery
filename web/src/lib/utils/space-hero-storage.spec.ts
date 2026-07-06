import { loadHeroCollapsed, persistHeroCollapsed } from './space-hero-storage';

const STORAGE_KEY = 'gallery-space-hero-collapsed';

describe('space-hero-storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('loadHeroCollapsed', () => {
    it('should return false when no localStorage entry exists', () => {
      expect(loadHeroCollapsed('space-1')).toBe(false);
    });

    it('should return stored value for a known spaceId', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      expect(loadHeroCollapsed('space-1')).toBe(true);
    });

    it('should return false for an unknown spaceId in existing record', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      expect(loadHeroCollapsed('space-2')).toBe(false);
    });

    it('should return false when localStorage contains invalid JSON', () => {
      localStorage.setItem(STORAGE_KEY, '{corrupted!!!');
      expect(loadHeroCollapsed('space-1')).toBe(false);
    });

    it('should return false when localStorage value is non-object', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify('not-an-object'));
      expect(loadHeroCollapsed('space-1')).toBe(false);
    });
  });

  describe('persistHeroCollapsed', () => {
    it('should create a new record when none exists', () => {
      persistHeroCollapsed('space-1', true);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(true);
    });

    it('should update existing record without losing other entries', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      persistHeroCollapsed('space-2', true);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(true);
      expect(stored['space-2']).toBe(true);
    });

    it('should overwrite value for existing spaceId', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ 'space-1': true }));
      persistHeroCollapsed('space-1', false);
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, boolean>;
      expect(stored['space-1']).toBe(false);
    });
  });
});
