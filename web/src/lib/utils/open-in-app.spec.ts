import { describe, expect, it } from 'vitest';
import { detectPlatform, isDismissed, isEligible, pathToDeepLink } from './open-in-app';

const UUID = '550e8400-e29b-41d4-a716-446655440000';
const UUID2 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

describe('pathToDeepLink', () => {
  it.each([
    [`/photos/${UUID}`, `immich://asset?id=${UUID}`],
    [`/albums/${UUID}`, `immich://album?id=${UUID}`],
    [`/albums/${UUID}/${UUID2}`, `immich://asset?id=${UUID2}`],
    [`/people/${UUID}`, `immich://people?id=${UUID}`],
    [`/memory/${UUID}`, `immich://memory?id=${UUID}`],
    [`/memory`, `immich://memory`],
    [`/spaces/${UUID}`, `immich://space?id=${UUID}`],
    [`/spaces/${UUID}/photos/${UUID2}`, `immich://asset?id=${UUID2}`],
    // Trailing slashes (server redirects, hand-pasted URLs)
    [`/photos/${UUID}/`, `immich://asset?id=${UUID}`],
    [`/spaces/${UUID}/`, `immich://space?id=${UUID}`],
    [`/memory/`, `immich://memory`],
  ])('maps %s → %s', (path, expected) => {
    expect(pathToDeepLink(path)).toBe(expected);
  });

  it.each([
    '/photos',
    '/photos/not-a-uuid',
    '/albums',
    '/spaces',
    '/share/abc123',
    '/map',
    '/admin/users',
    '/onboarding',
    '/auth/login',
    '/install',
  ])('returns null for ineligible path %s', (path) => {
    expect(pathToDeepLink(path)).toBeNull();
  });
});

const UA = {
  iPhone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
  iPadOld: 'Mozilla/5.0 (iPad; CPU OS 12_0 like Mac OS X) AppleWebKit/605.1.15',
  iPadAsMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
  pixel:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  desktopSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15',
};

describe('detectPlatform', () => {
  it('detects iPhone as ios', () => expect(detectPlatform(UA.iPhone, 0)).toBe('ios'));
  it('detects classic iPad as ios', () => expect(detectPlatform(UA.iPadOld, 0)).toBe('ios'));
  it('detects modern iPad-as-Mac (touch points > 1) as ios', () => expect(detectPlatform(UA.iPadAsMac, 5)).toBe('ios'));
  it('detects desktop Safari (touch points = 0) as null', () => expect(detectPlatform(UA.desktopSafari, 0)).toBeNull());
  it('detects Pixel as android', () => expect(detectPlatform(UA.pixel, 5)).toBe('android'));
  it('detects desktop Chrome as null', () => expect(detectPlatform(UA.desktopChrome, 0)).toBeNull());
});

describe('isDismissed', () => {
  const NOW = new Date('2026-04-16T12:00:00Z');

  it('returns false when value is null', () => expect(isDismissed(null, NOW)).toBe(false));
  it('returns false when expiry is in the past', () => expect(isDismissed('2026-04-15T12:00:00Z', NOW)).toBe(false));
  it('returns true when expiry is in the future', () => expect(isDismissed('2026-05-16T12:00:00Z', NOW)).toBe(true));
  it('returns false when value is malformed (graceful)', () => expect(isDismissed('not-a-date', NOW)).toBe(false));
  it('returns false when value is empty string', () => expect(isDismissed('', NOW)).toBe(false));
});

describe('isEligible', () => {
  const NOW = new Date('2026-04-16T12:00:00Z');
  const UUID_LOCAL = '550e8400-e29b-41d4-a716-446655440000';

  const baseOpts = {
    userAgent: UA.iPhone,
    maxTouchPoints: 0,
    pathname: `/photos/${UUID_LOCAL}`,
    isAuthenticated: true,
    coldEntry: true,
    dismissedUntil: null,
    now: NOW,
  };

  it('returns eligible with deep link + platform when all gates pass', () => {
    expect(isEligible(baseOpts)).toEqual({
      eligible: true,
      platform: 'ios',
      deepLink: `immich://asset?id=${UUID_LOCAL}`,
    });
  });

  it.each([
    ['cold entry false', { coldEntry: false }],
    ['unauthenticated', { isAuthenticated: false }],
    ['dismissed in future', { dismissedUntil: '2026-05-16T12:00:00Z' }],
    ['desktop UA', { userAgent: UA.desktopChrome }],
    ['unmatched route', { pathname: '/share/abc' }],
    ['invalid uuid in path', { pathname: '/photos/not-a-uuid' }],
  ])('returns ineligible when %s', (_label, override) => {
    expect(isEligible({ ...baseOpts, ...override })).toEqual({ eligible: false });
  });
});
