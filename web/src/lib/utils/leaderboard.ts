import { UserAvatarColor, type SharedSpaceMemberResponseDto } from '@immich/sdk';

export type LeaderboardUser = {
  id: string;
  name: string;
  email: string;
  profileImagePath: string;
  avatarColor: UserAvatarColor;
  profileChangedAt: string;
};

export type LeaderboardRow = {
  user: LeaderboardUser;
  /** Ranking input, not displayed - `value` is the rendered string, which may be '—'. */
  total: number;
  detail: string;
  value: string;
  isMe: boolean;
};

/**
 * A space member as UserAvatar wants them. Same adaptation space-activity-feed.svelte does, with
 * one difference: a member carries a real profileChangedAt, so it is passed through rather than
 * blanked - that value is the profile image's cache-buster, and dropping it serves a stale
 * avatar after someone changes their picture.
 *
 * Lives in a plain .ts module rather than game-leaderboard.svelte's `<script module>` block:
 * bare `tsc --noEmit` cannot see a named VALUE export re-exported from a .svelte file
 * (`declare module '*.svelte'` types only the default export - `tsc --listFiles` confirms .svelte
 * files never enter its program at all), only svelte-check resolves it. Same limitation already
 * documented at sidebar-shell.spec.ts:15 for a .svelte module's named export. game-leaderboard.svelte
 * re-exports this so a .svelte caller (Task 9, the play page) still gets both from one import.
 */
export const toAvatarUser = (member: SharedSpaceMemberResponseDto): LeaderboardUser => ({
  id: member.userId,
  name: member.name,
  email: member.email,
  profileImagePath: member.profileImagePath ?? '',
  avatarColor: (member.avatarColor as UserAvatarColor) ?? UserAvatarColor.Primary,
  profileChangedAt: member.profileChangedAt ?? '',
});
