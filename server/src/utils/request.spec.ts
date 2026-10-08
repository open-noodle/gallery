import { getAppVersionFromUA, isMobileAppUA } from 'src/utils/request.js';

describe(getAppVersionFromUA.name, () => {
  it('should get the app version for android', () => {
    expect(getAppVersionFromUA('immich-android/1.123.4')).toEqual('1.123.4');
  });

  it('should get the app version for ios', () => {
    expect(getAppVersionFromUA('immich-ios/1.123.4')).toEqual('1.123.4');
  });

  it('should get the app version for unknown', () => {
    expect(getAppVersionFromUA('immich-unknown/1.123.4')).toEqual('1.123.4');
  });

  describe('legacy format', () => {
    it('should get the app version from the old android format', () => {
      expect(getAppVersionFromUA('Immich_Android_1.123.4')).toEqual('1.123.4');
    });

    it('should get the app version from the old ios format', () => {
      expect(getAppVersionFromUA('Immich_iOS_1.123.4')).toEqual('1.123.4');
    });

    it('should get the app version from the old unknown format', () => {
      expect(getAppVersionFromUA('Immich_Unknown_1.123.4')).toEqual('1.123.4');
    });
  });
});

describe(isMobileAppUA.name, () => {
  it.each(['immich-android/1.123.4', 'immich-ios/1.123.4', 'immich-unknown/1.123.4'])(
    'should recognize %s',
    (userAgent) => {
      expect(isMobileAppUA(userAgent)).toBe(true);
    },
  );

  it.each(['Immich_Android_1.123.4', 'Immich_iOS_1.123.4', 'Immich_Unknown_1.123.4'])(
    'should recognize the legacy format %s',
    (userAgent) => {
      expect(isMobileAppUA(userAgent)).toBe(true);
    },
  );

  // The reason this exists as a separate check rather than `getAppVersionFromUA(ua) !== null`:
  // these are mobile apps with no usable version, and callers must not confuse them with the
  // non-mobile clients below, which also have no version.
  it.each(['immich-android/', 'Immich_iOS_'])('should recognize %s despite having no version', (userAgent) => {
    expect(getAppVersionFromUA(userAgent)).toBeNull();
    expect(isMobileAppUA(userAgent)).toBe(true);
  });

  it.each([
    '',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    'immich-cli/2.2.80',
    'node',
    // Not anchored at the start, so a UA that merely mentions the app does not count.
    'curl/8.5.0 immich-android/5.6.0',
  ])('should not recognize %s', (userAgent) => {
    expect(isMobileAppUA(userAgent)).toBe(false);
  });
});
