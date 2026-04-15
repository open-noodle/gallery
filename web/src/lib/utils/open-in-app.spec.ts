import { describe, expect, it } from 'vitest';
import { pathToDeepLink } from './open-in-app';

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
