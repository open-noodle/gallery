import type { ResponseOf } from '#test/common/types.ts';
import { QueueName } from '@immich/sdk';

// Gallery's fields on the payloads upstream's mock API serves (test/common/payloads.ts). Gallery's DTOs carry
// required fields upstream's do not, so upstream's payload literals pass through these helpers. The admin config
// values are the server's defaults (server/src/dtos/config.dto.ts), for the paths upstream's payload lacks.

type AdminConfig = ResponseOf<'getAdminConfig'>;
type Queues = ResponseOf<'getQueuesLegacy'>;

const galleryAdminConfigDefaults = {
  backup: { beta: false, database: { s3: { enabled: false } } },
  ffmpeg: { dataSaver: { enabled: false, targetVideoCodec: 'hevc', targetResolution: '720', maxBitrate: '1500k' } },
  job: {
    peopleBackfill: { concurrency: 1 },
    petDetection: { concurrency: 1 },
    classification: { concurrency: 1 },
    qualityAnalysis: { concurrency: 2 },
    spatialScene: { concurrency: 1 },
  },
  machineLearning: {
    clip: { maxDistance: 0 },
    petDetection: { enabled: false, modelName: 'rfdetr-nano', minScore: 0.3 },
    petRecognition: { enabled: false, modelName: 'pet-recognition-base', maxDistance: 0.55, minFaces: 1 },
    spatialScene: {
      enabled: false,
      modelName: 'depth-anything-v2-small',
      offer: 'suitable',
      minBoundarySharpness: 0.03,
      minEdgeDensity: 0.02,
      minForegroundRatio: 0.01,
      maxForegroundRatio: 0.75,
      minFaceHeight: 0.03,
    },
    facialRecognition: {
      suggestions: { enabled: true, maxDistance: 0.7 },
      video: { enabled: false, sampleInterval: 2, sceneDetection: true, maxFrames: 1800, tiledDetection: false },
    },
  },
  nightlyTasks: { clusterNewPets: true },
  server: { mergePeopleAcrossOwners: false, spaceEditorsCanAddMembers: false, spaceEditorsCanChangeRoles: false },
  memories: {
    retentionDays: 365,
    birthday: true,
    recentTrips: true,
    types: {},
    themeMaxDistance: 0.75,
    personThrowbackDormancyMonths: 6,
  },
  classification: { enabled: true, categories: [] },
  storageUsage: { includeDerivatives: false },
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const mergeDefaults = (defaults: Record<string, unknown>, value: Record<string, unknown>): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...defaults, ...value };
  for (const [key, fallback] of Object.entries(defaults)) {
    const current = value[key];
    if (isObject(fallback) && isObject(current)) {
      result[key] = mergeDefaults(fallback, current);
    }
  }
  return result;
};

/** Upstream's payload literals are typed against upstream's DTOs, which lack Gallery's required fields. */
export type UpstreamShape<T> = T extends unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: UpstreamShape<T[K]> }
    : T;

/** Upstream's admin config payload, with Gallery's server defaults under it. */
export const withGalleryAdminConfig =
  (adminConfig: (overrides?: Partial<AdminConfig>) => UpstreamShape<AdminConfig>) =>
  (overrides: Partial<AdminConfig> = {}): AdminConfig =>
    mergeDefaults(
      galleryAdminConfigDefaults,
      adminConfig(overrides) as Record<string, unknown>,
    ) as unknown as AdminConfig;

export const galleryServerConfig = { availableMemoryTypes: [] } satisfies Partial<ResponseOf<'getServerConfig'>>;

export const galleryServerFeatures = {
  peopleStatistics: false,
  s3Storage: false,
  smartSearchHasCutoff: false,
} satisfies Partial<ResponseOf<'getServerFeatures'>>;

const idleQueue = () => ({
  jobCounts: { active: 0, completed: 0, delayed: 0, failed: 0, paused: 0, waiting: 0 },
  queueStatus: { isActive: false, isPaused: false },
});

/** Upstream's queue payload plus an idle entry for every Gallery queue. */
export const withGalleryQueues = (queues: () => UpstreamShape<Queues>) => (): Queues => {
  const all = { ...(queues() as Record<string, unknown>) };
  for (const name of Object.values(QueueName)) {
    all[name] ??= idleQueue();
  }
  return all as unknown as Queues;
};
