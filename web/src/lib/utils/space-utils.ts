import { SharedSpaceRole, type SharedSpaceResponseDto } from '@immich/sdk';

/**
 * The literal key union rather than `string`, so `$t()` still type-checks these against `en.json`.
 * (`Translations` itself is declared inside `declare module 'svelte-i18n'`, so it cannot be named
 * here.)
 */
export type SpaceRoleLabelKey = 'owner' | 'role_editor' | 'role_viewer';

/**
 * i18n key for a member's role in a space.
 *
 * `SharedSpaceRole` is a lowercase English enum (`owner` / `editor` / `viewer`); printing it — even
 * dressed up with CSS `capitalize` — leaves the role untranslated in every locale (#946). Unknown
 * roles fall back to the least-privileged label rather than leaking the raw value.
 */
export function spaceRoleLabelKey(role: string): SpaceRoleLabelKey {
  switch (role) {
    case SharedSpaceRole.Owner: {
      return 'owner';
    }
    case SharedSpaceRole.Editor: {
      return 'role_editor';
    }
    default: {
      return 'role_viewer';
    }
  }
}

export interface SplitResult {
  pinned: SharedSpaceResponseDto[];
  unpinned: SharedSpaceResponseDto[];
  showSection: boolean;
}

export function splitPinnedSpaces(spaces: SharedSpaceResponseDto[], pinnedIds: string[]): SplitResult {
  const pinnedSet = new Set(pinnedIds);
  const pinned = spaces.filter((s) => pinnedSet.has(s.id));
  const unpinned = spaces.filter((s) => !pinnedSet.has(s.id));
  const showSection = pinned.length > 0 && unpinned.length > 0;
  return { pinned, unpinned, showSection };
}
