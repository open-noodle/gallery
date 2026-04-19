import { ADMIN_VISIBLE_QUEUES } from '$lib/constants';
import { authManager } from '$lib/managers/auth-manager.svelte';
import { isAlmostExactWordMatch } from '$lib/managers/cmdk-match';
import { themeManager } from '$lib/managers/theme-manager.svelte';
import ShortcutsModal from '$lib/modals/ShortcutsModal.svelte';
import SpaceCreateModal from '$lib/modals/SpaceCreateModal.svelte';
import { asQueueItem } from '$lib/services/queue.service';
import { clearEntries } from '$lib/stores/cmdk-recent';
import { createAlbumAndRedirect } from '$lib/utils/album-utils';
import { openFileUploadDialog } from '$lib/utils/file-uploader';
import { handleError } from '$lib/utils/handle-error';
import { emptyQueue, QueueCommand, QueueName, runQueueCommandLegacy, type ServerFeaturesDto } from '@immich/sdk';
import { modalManager, toastManager } from '@immich/ui';
import {
  mdiAccountMultiplePlus,
  mdiAccountSearchOutline,
  mdiBrain,
  mdiBroom,
  mdiCloudUploadOutline,
  mdiFaceRecognition,
  mdiImageOutline,
  mdiInformationOutline,
  mdiKeyboardOutline,
  mdiLogoutVariant,
  mdiPauseCircleOutline,
  mdiPlayCircleOutline,
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

async function runQueue(name: QueueName) {
  const $t = get(t);
  const item = asQueueItem($t, { name });
  try {
    await runQueueCommandLegacy({
      name,
      queueCommandDto: { command: QueueCommand.Start, force: false },
    });
    toastManager.primary($t('cmdk_cmd_job_started', { values: { job: item.title } }));
  } catch (error) {
    handleError(error, $t('errors.something_went_wrong'));
  }
}

async function bulkQueueCommand(command: QueueCommand.Pause | QueueCommand.Resume) {
  const results = await Promise.allSettled(
    ADMIN_VISIBLE_QUEUES.map((name) => runQueueCommandLegacy({ name, queueCommandDto: { command } })),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  const $t = get(t);
  if (failed > 0) {
    toastManager.warning($t('cmdk_cmd_bulk_partial', { values: { failed, total: results.length } }));
    return;
  }
  toastManager.primary($t(command === QueueCommand.Pause ? 'cmdk_cmd_all_paused' : 'cmdk_cmd_all_resumed'));
}

async function clearAllFailedJobs() {
  const results = await Promise.allSettled(
    ADMIN_VISIBLE_QUEUES.map((name) => emptyQueue({ name, queueDeleteDto: { failed: true } })),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  const $t = get(t);
  if (failed > 0) {
    toastManager.warning($t('cmdk_cmd_bulk_partial', { values: { failed, total: results.length } }));
    return;
  }
  toastManager.primary($t('cmdk_cmd_failed_cleared'));
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
  {
    id: 'cmd:run_thumbnail_gen',
    labelKey: 'cmdk_cmd_run_thumbnail_gen_label',
    descriptionKey: 'cmdk_cmd_run_thumbnail_gen_description',
    icon: mdiImageOutline,
    adminOnly: true,
    handler: () => runQueue(QueueName.ThumbnailGeneration),
  },
  {
    id: 'cmd:run_metadata_extraction',
    labelKey: 'cmdk_cmd_run_metadata_extraction_label',
    descriptionKey: 'cmdk_cmd_run_metadata_extraction_description',
    icon: mdiInformationOutline,
    adminOnly: true,
    handler: () => runQueue(QueueName.MetadataExtraction),
  },
  {
    id: 'cmd:run_smart_search',
    labelKey: 'cmdk_cmd_run_smart_search_label',
    descriptionKey: 'cmdk_cmd_run_smart_search_description',
    icon: mdiBrain,
    adminOnly: true,
    handler: () => runQueue(QueueName.SmartSearch),
  },
  {
    id: 'cmd:run_face_detection',
    labelKey: 'cmdk_cmd_run_face_detection_label',
    descriptionKey: 'cmdk_cmd_run_face_detection_description',
    icon: mdiFaceRecognition,
    adminOnly: true,
    handler: () => runQueue(QueueName.FaceDetection),
  },
  {
    id: 'cmd:run_face_recognition',
    labelKey: 'cmdk_cmd_run_face_recognition_label',
    descriptionKey: 'cmdk_cmd_run_face_recognition_description',
    icon: mdiAccountSearchOutline,
    adminOnly: true,
    handler: () => runQueue(QueueName.FacialRecognition),
  },
  {
    id: 'cmd:pause_all_queues',
    labelKey: 'cmdk_cmd_pause_all_queues_label',
    descriptionKey: 'cmdk_cmd_pause_all_queues_description',
    icon: mdiPauseCircleOutline,
    adminOnly: true,
    handler: () => bulkQueueCommand(QueueCommand.Pause),
  },
  {
    id: 'cmd:resume_all_queues',
    labelKey: 'cmdk_cmd_resume_all_queues_label',
    descriptionKey: 'cmdk_cmd_resume_all_queues_description',
    icon: mdiPlayCircleOutline,
    adminOnly: true,
    handler: () => bulkQueueCommand(QueueCommand.Resume),
  },
  {
    id: 'cmd:clear_failed_jobs',
    labelKey: 'cmdk_cmd_clear_failed_jobs_label',
    descriptionKey: 'cmdk_cmd_clear_failed_jobs_description',
    icon: mdiBroom,
    adminOnly: true,
    handler: () => clearAllFailedJobs(),
  },
];

export function isAlmostExactCommandMatch(query: string, label: string): boolean {
  return isAlmostExactWordMatch(query, label, MIN_MATCH_LENGTH);
}
