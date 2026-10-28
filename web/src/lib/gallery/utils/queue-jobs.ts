import { JobName, QueueName, type QueueJobTypeCountsDto } from '@immich/sdk';
import type { IconLike } from '@immich/ui';
import { mdiCloudSyncOutline, mdiPaw, mdiPawOutline, mdiTagFaces, mdiTagMultipleOutline } from '@mdi/js';
import type { MessageFormatter } from 'svelte-i18n';

export type QueueJobTypeCounts = QueueJobTypeCountsDto;

export const formatSampledJobTypeCount = (count: number, formatNumber: (count: number) => string) => {
  return count > 1000 ? `${formatNumber(1000)}+` : formatNumber(count);
};

export const getQueueJobTypeLabel = (name: JobName) => {
  switch (name) {
    case JobName.FacialRecognition:
    case JobName.FacialRecognitionQueueAll: {
      return 'Facial recognition';
    }
    case JobName.SharedSpaceFaceMatch:
    case JobName.SharedSpaceFaceMatchAll:
    case JobName.SharedSpaceFaceMatchPage: {
      return 'Shared space face matching';
    }
    case JobName.SharedSpacePersonDedup: {
      return 'Shared space people dedup';
    }
    case JobName.SharedSpaceIdentityReconciliation: {
      return 'Shared space identity reconciliation';
    }
    case JobName.SharedSpacePersonMetadataBackfill: {
      return 'Shared space metadata propagation';
    }
    case JobName.FaceIdentityBackfill: {
      return 'Face identity backfill';
    }
    case JobName.FaceSuggestionMaintenance: {
      return 'Face suggestion maintenance';
    }
    case JobName.PersonSuggestionScan:
    case JobName.PersonSuggestionScanQueueAll: {
      return 'Personal face suggestion scan';
    }
    case JobName.SpacePersonSuggestionScan:
    case JobName.SpacePersonSuggestionScanQueueAll: {
      return 'Shared-space face suggestion scan';
    }
    case JobName.PetRecognition:
    case JobName.PetRecognitionQueueAll: {
      return 'Pet recognition';
    }
    default: {
      return name.replaceAll(/([a-z])([A-Z])/g, '$1 $2');
    }
  }
};

type GalleryQueueName =
  | QueueName.PeopleBackfill
  | QueueName.PetDetection
  | QueueName.PetRecognition
  | QueueName.StorageBackendMigration
  | QueueName.Classification;

/** Fork queues, spread into upstream's `asQueueItem` map. */
export const galleryQueueItems = (
  $t: MessageFormatter,
): Record<GalleryQueueName, { icon: IconLike; title: string; subtitle?: string }> => ({
  [QueueName.PeopleBackfill]: {
    icon: mdiTagFaces,
    title: $t('admin.people_backfill_job'),
    subtitle: $t('admin.people_backfill_job_description'),
  },
  [QueueName.PetDetection]: {
    icon: mdiPaw,
    title: $t('admin.machine_learning_pet_detection'),
    subtitle: $t('admin.pet_detection_job_description'),
  },
  [QueueName.PetRecognition]: {
    icon: mdiPawOutline,
    title: $t('admin.machine_learning_pet_recognition'),
    subtitle: $t('admin.pet_recognition_job_description'),
  },
  [QueueName.StorageBackendMigration]: {
    icon: mdiCloudSyncOutline,
    title: 'Storage Backend Migration',
  },
  [QueueName.Classification]: {
    icon: mdiTagMultipleOutline,
    title: 'Auto-Classification',
    subtitle: 'Automatically classify and tag photos',
  },
});
