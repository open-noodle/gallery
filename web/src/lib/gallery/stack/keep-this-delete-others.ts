import type { StackResponseDto } from '@immich/sdk';
import type { MessageFormatter } from 'svelte-i18n';

/**
 * The "Keep this, delete others" confirmation. Inside an album it says the other photos leave the whole library, not
 * just the album, since the album collapses the stack and may not even hold them
 * (specs/2026-11-01-album-stack-collapse-design.md).
 */
export const keepThisDeleteOthersPrompt = ($t: MessageFormatter, stack: StackResponseDto, inAlbum: boolean) =>
  inAlbum
    ? $t('confirm_keep_this_delete_others_in_album', { values: { count: stack.assets.length - 1 } })
    : $t('confirm_keep_this_delete_others');
