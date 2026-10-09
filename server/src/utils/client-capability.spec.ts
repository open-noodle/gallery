import { ClientCapability, clientSupports } from 'src/utils/client-capability.js';

describe('clientSupports', () => {
  it.each([
    { appVersion: '5.7.0', expected: true },
    { appVersion: '5.7.1', expected: true },
    { appVersion: '5.8.0', expected: true },
    { appVersion: '6.0.0', expected: true },
    { appVersion: '5.6.0', expected: false },
    { appVersion: '5.6.9', expected: false },
    { appVersion: '1.0.0', expected: false },
  ])('should be $expected for app version $appVersion', ({ appVersion, expected }) => {
    expect(clientSupports(appVersion, ClientCapability.AdjustEdits)).toBe(expected);
  });

  it.each([
    // A release candidate is cut before the release it leads up to, so it must sort *below* it -
    // the v5.7.0 RCs predate the Adjust tool and must not be told they support it.
    { appVersion: '5.7.0-rc.0' },
    { appVersion: '5.7.0-rc.1' },
    { appVersion: '5.7.0-beta' },
  ])('should treat the prerelease $appVersion as older than its own release', ({ appVersion }) => {
    expect(clientSupports(appVersion, ClientCapability.AdjustEdits)).toBe(false);
  });

  it.each([
    // null is what every non-mobile client reports (the user agent only carries a version for
    // Gallery/Immich mobile builds), plus mobile sessions older than the appVersion column.
    { label: 'null', appVersion: null },
    { label: 'undefined', appVersion: undefined },
    { label: 'an empty string', appVersion: '' },
    { label: 'an unparseable version', appVersion: 'nightly' },
  ])('should not claim support when the version is $label', ({ appVersion }) => {
    expect(clientSupports(appVersion, ClientCapability.AdjustEdits)).toBe(false);
  });

  it('should ignore build metadata and a leading v', () => {
    expect(clientSupports('v5.7.0', ClientCapability.AdjustEdits)).toBe(true);
    expect(clientSupports('5.7.0+build.42', ClientCapability.AdjustEdits)).toBe(true);
  });
});
