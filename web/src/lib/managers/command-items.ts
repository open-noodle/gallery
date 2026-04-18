import { authManager } from '$lib/managers/auth-manager.svelte';
import { isAlmostExactWordMatch } from '$lib/managers/cmdk-match';
import { themeManager } from '$lib/managers/theme-manager.svelte';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
import SpaceCreateModal from '$lib/modals/SpaceCreateModal.svelte';
import { clearEntries } from '$lib/stores/cmdk-recent';
import { createAlbumAndRedirect } from '$lib/utils/album-utils';
import { openFileUploadDialog } from '$lib/utils/file-uploader';
import type { ServerFeaturesDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import {
  mdiAccountMultiplePlus,
  mdiCloudUploadOutline,
  mdiKeyboardOutline,
  mdiLogoutVariant,
  mdiPlaylistPlus,
  mdiRestore,
  mdiThemeLightDark,
} from '@mdi/js';
import { t } from 'svelte-i18n';
import { get } from 'svelte/store';

const MIN_MATCH_LENGTH = 3;

export interface CommandItem {
  id: `cmd:${string}`;
  labelKey: string;
  descriptionKey: string;
  icon: string;
  handler: () => void | Promise<unknown>;
  /** Reserved for v1.3.1 admin verbs. Not used by any v1.3.0 item. */
  adminOnly?: boolean;
  /** Reserved for future feature-flag gating. Not used in v1.3.0. */
  featureFlag?: keyof ServerFeaturesDto;
}

export const COMMAND_ITEMS: readonly CommandItem[] = [
  {
    id: 'cmd:theme',
    labelKey: 'theme',
    descriptionKey: 'cmdk_cmd_theme_description',
    icon: mdiThemeLightDark,
    handler: () => themeManager.toggleTheme(),
  },
  {
    id: 'cmd:upload',
    labelKey: 'upload',
    descriptionKey: 'cmdk_cmd_upload_description',
    icon: mdiCloudUploadOutline,
    handler: () => openFileUploadDialog(),
  },
  {
    id: 'cmd:new_album',
    labelKey: 'new_album',
    descriptionKey: 'cmdk_cmd_new_album_description',
    icon: mdiPlaylistPlus,
    handler: () => createAlbumAndRedirect(),
  },
  {
    id: 'cmd:create_space',
    labelKey: 'create_space',
    descriptionKey: 'cmdk_cmd_create_space_description',
    icon: mdiAccountMultiplePlus,
    handler: () => modalManager.show(SpaceCreateModal, {}),
  },
  {
    id: 'cmd:signout',
    labelKey: 'sign_out',
    descriptionKey: 'cmdk_cmd_sign_out_description',
    icon: mdiLogoutVariant,
    handler: () => {
      toastManager.info(get(t)('signing_out'));
      return authManager.logout();
    },
  },
  {
    id: 'cmd:shortcuts',
    labelKey: 'keyboard_shortcuts',
    descriptionKey: 'cmdk_cmd_keyboard_shortcuts_description',
    icon: mdiKeyboardOutline,
    handler: () => modalManager.show(ShortcutsModal, {}),
  },
  {
    id: 'cmd:clear_recents',
    labelKey: 'cmdk_clear_recents',
    descriptionKey: 'cmdk_cmd_clear_recents_description',
    icon: mdiRestore,
    handler: () => clearEntries(),
  },
];

export function isAlmostExactCommandMatch(query: string, label: string): boolean {
  return isAlmostExactWordMatch(query, label, MIN_MATCH_LENGTH);
}
