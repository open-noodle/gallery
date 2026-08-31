import { CronExpression } from '@nestjs/schedule';
import { ReleaseChannel } from 'src/dtos/system-config.dto';
import {
  AudioCodec,
  Colorspace,
  CQMode,
  HlsVideoResolution,
  ImageFormat,
  LogLevel,
  OAuthTokenEndpointAuthMethod,
  QueueName,
  ToneMapping,
  TranscodeHardwareAcceleration,
  TranscodePolicy,
  VideoCodec,
  VideoContainer,
} from 'src/enum';
import { ConcurrentQueueName, FullsizeImageOptions, ImageOptions } from 'src/types';

export type ClassificationFaceExclusion = 'off' | 'any_assigned_face' | 'named_people' | 'named_visible_people';

export type SystemConfig = {
  backup: {
    database: {
      enabled: boolean;
      cronExpression: string;
      keepLastAmount: number;
    };
  };
  ffmpeg: {
    crf: number;
    threads: number;
    preset: string;
    targetVideoCodec: VideoCodec;
    acceptedVideoCodecs: VideoCodec[];
    targetAudioCodec: AudioCodec;
    acceptedAudioCodecs: AudioCodec[];
    acceptedContainers: VideoContainer[];
    targetResolution: string;
    maxBitrate: string;
    bframes: number;
    refs: number;
    gopSize: number;
    temporalAQ: boolean;
    cqMode: CQMode;
    twoPass: boolean;
    preferredHwDevice: string;
    transcode: TranscodePolicy;
    accel: TranscodeHardwareAcceleration;
    accelDecode: boolean;
    tonemap: ToneMapping;
    realtime: {
      enabled: boolean;
      videoCodecs: VideoCodec[];
      resolutions: HlsVideoResolution[];
    };
  };
  integrityChecks: {
    missingFiles: {
      enabled: boolean;
      cronExpression: string;
    };
    untrackedFiles: {
      enabled: boolean;
      cronExpression: string;
    };
    checksumFiles: {
      enabled: boolean;
      cronExpression: string;
      timeLimit: number;
      percentageLimit: number;
    };
  };
  job: Record<ConcurrentQueueName, { concurrency: number }>;
  logging: {
    enabled: boolean;
    level: LogLevel;
  };
  machineLearning: {
    enabled: boolean;
    urls: string[];
    availabilityChecks: {
      enabled: boolean;
      timeout: number;
      interval: number;
    };
    clip: {
      enabled: boolean;
      modelName: string;
      maxDistance: number;
    };
    duplicateDetection: {
      enabled: boolean;
      maxDistance: number;
    };
    facialRecognition: {
      enabled: boolean;
      modelName: string;
      minScore: number;
      minFaces: number;
      maxDistance: number;
      suggestions: {
        enabled: boolean;
        maxDistance: number;
      };
    };
    ocr: {
      enabled: boolean;
      modelName: string;
      minDetectionScore: number;
      minRecognitionScore: number;
      maxResolution: number;
    };
    petDetection: {
      enabled: boolean;
      modelName: string;
      minScore: number;
    };
  };
  map: {
    enabled: boolean;
    lightStyle: string;
    darkStyle: string;
  };
  reverseGeocoding: {
    enabled: boolean;
  };
  metadata: {
    faces: {
      import: boolean;
    };
  };
  oauth: {
    autoLaunch: boolean;
    autoRegister: boolean;
    buttonText: string;
    clientId: string;
    clientSecret: string;
    defaultStorageQuota: number | null;
    enabled: boolean;
    issuerUrl: string;
    endSessionEndpoint: string;
    mobileOverrideEnabled: boolean;
    mobileRedirectUri: string;
    prompt: string;
    scope: string;
    signingAlgorithm: string;
    profileSigningAlgorithm: string;
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod;
    timeout: number;
    allowInsecureRequests: boolean;
    storageLabelClaim: string;
    storageQuotaClaim: string;
    roleClaim: string;
  };
  passwordLogin: {
    enabled: boolean;
  };
  storageTemplate: {
    enabled: boolean;
    hashVerificationEnabled: boolean;
    template: string;
  };
  image: {
    thumbnail: ImageOptions;
    preview: ImageOptions;
    colorspace: Colorspace;
    extractEmbedded: boolean;
    fullsize: FullsizeImageOptions;
  };
  newVersionCheck: {
    enabled: boolean;
    channel: ReleaseChannel;
  };
  nightlyTasks: {
    startTime: string;
    databaseCleanup: boolean;
    missingThumbnails: boolean;
    clusterNewFaces: boolean;
    generateMemories: boolean;
    syncQuotaUsage: boolean;
  };
  memories: {
    retentionDays: number;
    /** @deprecated superseded by `types['birthday']`; kept for back-compat */
    birthday: boolean;
    /** @deprecated superseded by `types['recent_trip']`; kept for back-compat */
    recentTrips: boolean;
    /** sparse admin availability overrides, memory-type key -> enabled */
    types: Record<string, boolean>;
    themeMaxDistance: number;
    personThrowbackDormancyMonths: number;
  };
  trash: {
    enabled: boolean;
    days: number;
  };
  theme: {
    customCss: string;
  };
  library: {
    scan: {
      enabled: boolean;
      cronExpression: string;
    };
    watch: {
      enabled: boolean;
    };
  };
  notifications: {
    smtp: {
      enabled: boolean;
      from: string;
      replyTo: string;
      transport: {
        ignoreCert: boolean;
        host: string;
        port: number;
        secure: boolean;
        username: string;
        password: string;
      };
    };
  };
  templates: {
    email: {
      welcomeTemplate: string;
      albumInviteTemplate: string;
      albumUpdateTemplate: string;
    };
  };
  server: {
    externalDomain: string;
    loginPageMessage: string;
    publicUsers: boolean;
    mergePeopleAcrossOwners: boolean;
  };
  classification: {
    enabled: boolean;
    categories: Array<{
      name: string;
      prompts: string[];
      similarity: number;
      action: 'tag' | 'tag_and_archive';
      enabled: boolean;
      faceExclusion: ClassificationFaceExclusion;
    }>;
  };
  // Gallery-fork: opt-in accounting for server-generated files (thumbnails, transcodes).
  storageUsage: {
    includeDerivatives: boolean;
  };
  // Gallery-fork: family relationships. `enabled` gates the whole feature; `defaultAccess`
  // applies to users with no explicit family_access row. Off by default so an upgrade
  // behaves exactly as it did before.
  familyTree: {
    enabled: boolean;
    defaultAccess: 'none' | 'view' | 'contribute';
  };
  user: {
    deleteDelay: number;
  };
};

export type MachineLearningConfig = SystemConfig['machineLearning'];

export const defaults = Object.freeze<SystemConfig>({
  backup: {
    database: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_2AM,
      keepLastAmount: 14,
    },
  },
  ffmpeg: {
    crf: 23,
    threads: 0,
    preset: 'ultrafast',
    targetVideoCodec: VideoCodec.H264,
    acceptedVideoCodecs: [VideoCodec.H264],
    targetAudioCodec: AudioCodec.Aac,
    acceptedAudioCodecs: [AudioCodec.Aac, AudioCodec.Mp3, AudioCodec.Opus],
    acceptedContainers: [VideoContainer.Mov, VideoContainer.Ogg, VideoContainer.Webm],
    targetResolution: '720',
    maxBitrate: '0',
    bframes: -1,
    refs: 0,
    gopSize: 0,
    temporalAQ: false,
    cqMode: CQMode.Auto,
    twoPass: false,
    preferredHwDevice: 'auto',
    transcode: TranscodePolicy.Required,
    tonemap: ToneMapping.Hable,
    accel: TranscodeHardwareAcceleration.Disabled,
    accelDecode: true,
    realtime: {
      enabled: false,
      videoCodecs: [VideoCodec.H264, VideoCodec.Hevc],
      resolutions: [HlsVideoResolution.p480, HlsVideoResolution.p720, HlsVideoResolution.p1080],
    },
  },
  integrityChecks: {
    missingFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
    },
    untrackedFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
    },
    checksumFiles: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_3AM,
      timeLimit: 60 * 60 * 1000, // 1 hour
      percentageLimit: 1, // 100% of assets
    },
  },
  job: {
    [QueueName.BackgroundTask]: { concurrency: 5 },
    [QueueName.PeopleBackfill]: { concurrency: 1 },
    [QueueName.SmartSearch]: { concurrency: 2 },
    [QueueName.MetadataExtraction]: { concurrency: 5 },
    [QueueName.FaceDetection]: { concurrency: 2 },
    [QueueName.Search]: { concurrency: 5 },
    [QueueName.Sidecar]: { concurrency: 5 },
    [QueueName.Library]: { concurrency: 5 },
    [QueueName.Migration]: { concurrency: 5 },
    [QueueName.ThumbnailGeneration]: { concurrency: 3 },
    [QueueName.VideoConversion]: { concurrency: 1 },
    [QueueName.Notification]: { concurrency: 5 },
    [QueueName.Ocr]: { concurrency: 1 },
    [QueueName.PetDetection]: { concurrency: 1 },
    [QueueName.Workflow]: { concurrency: 5 },
    [QueueName.IntegrityCheck]: { concurrency: 1 },
    [QueueName.Editor]: { concurrency: 2 },
    [QueueName.Classification]: { concurrency: 1 },
  },
  logging: {
    enabled: true,
    level: LogLevel.Log,
  },
  machineLearning: {
    enabled: process.env.IMMICH_MACHINE_LEARNING_ENABLED !== 'false',
    urls: [process.env.IMMICH_MACHINE_LEARNING_URL || 'http://immich-machine-learning:3003'],
    availabilityChecks: {
      enabled: true,
      timeout: 2000,
      interval: 30_000,
    },
    clip: {
      enabled: true,
      modelName: 'ViT-B-32__openai',
      maxDistance: 0,
    },
    duplicateDetection: {
      enabled: true,
      maxDistance: 0.01,
    },
    facialRecognition: {
      enabled: true,
      modelName: 'buffalo_l',
      minScore: 0.7,
      maxDistance: 0.5,
      minFaces: 3,
      suggestions: {
        enabled: true,
        maxDistance: 0.7,
      },
    },
    ocr: {
      enabled: true,
      modelName: 'PP-OCRv5_mobile',
      minDetectionScore: 0.5,
      minRecognitionScore: 0.8,
      maxResolution: 736,
    },
    petDetection: {
      enabled: false,
      modelName: 'yolo11s',
      minScore: 0.6,
    },
  },
  map: {
    enabled: true,
    lightStyle: 'https://tiles.openfreemap.org/styles/positron',
    darkStyle: 'https://tiles.openfreemap.org/styles/dark',
  },
  reverseGeocoding: {
    enabled: true,
  },
  metadata: {
    faces: {
      import: false,
    },
  },
  oauth: {
    autoLaunch: false,
    autoRegister: true,
    buttonText: 'Login with OAuth',
    clientId: '',
    clientSecret: '',
    defaultStorageQuota: null,
    enabled: false,
    issuerUrl: '',
    endSessionEndpoint: '',
    mobileOverrideEnabled: false,
    mobileRedirectUri: '',
    prompt: '',
    scope: 'openid email profile',
    signingAlgorithm: 'RS256',
    profileSigningAlgorithm: 'none',
    storageLabelClaim: 'preferred_username',
    storageQuotaClaim: 'immich_quota',
    roleClaim: 'immich_role',
    tokenEndpointAuthMethod: OAuthTokenEndpointAuthMethod.ClientSecretPost,
    timeout: 30_000,
    allowInsecureRequests: false,
  },
  passwordLogin: {
    enabled: true,
  },
  storageTemplate: {
    enabled: false,
    hashVerificationEnabled: true,
    template: '{{y}}/{{y}}-{{MM}}-{{dd}}/{{filename}}',
  },
  image: {
    thumbnail: {
      format: ImageFormat.Webp,
      size: 250,
      quality: 80,
      progressive: false,
    },
    preview: {
      format: ImageFormat.Jpeg,
      size: 1440,
      quality: 80,
      progressive: false,
    },
    colorspace: Colorspace.P3,
    extractEmbedded: false,
    fullsize: {
      enabled: false,
      format: ImageFormat.Jpeg,
      quality: 80,
      progressive: false,
    },
  },
  newVersionCheck: {
    // Gallery polls its own release endpoint at version.opennoodle.de/gallery
    // (see config.repository.ts versionCheck.url).
    enabled: true,
    channel: ReleaseChannel.Stable,
  },
  nightlyTasks: {
    startTime: '00:00',
    databaseCleanup: true,
    generateMemories: true,
    syncQuotaUsage: true,
    missingThumbnails: true,
    clusterNewFaces: true,
  },
  memories: {
    retentionDays: 365,
    birthday: true,
    recentTrips: true,
    types: {},
    // CLIP text->image distances sit far higher than the image->image thresholds used elsewhere
    // (duplicateDetection 0.01, facialRecognition 0.5) because of the modality gap: even a perfect
    // textual match rarely drops below ~0.6. Matches the 0.75 the admin UI recommends for
    // `machineLearning.clip.maxDistance`, the same metric over the same embeddings.
    themeMaxDistance: 0.75,
    personThrowbackDormancyMonths: 6,
  },
  trash: {
    enabled: true,
    days: 30,
  },
  theme: {
    customCss: '',
  },
  library: {
    scan: {
      enabled: true,
      cronExpression: CronExpression.EVERY_DAY_AT_MIDNIGHT,
    },
    watch: {
      enabled: false,
    },
  },
  server: {
    externalDomain: '',
    loginPageMessage: '',
    publicUsers: true,
    mergePeopleAcrossOwners: false,
  },
  notifications: {
    smtp: {
      enabled: false,
      from: '',
      replyTo: '',
      transport: {
        ignoreCert: false,
        host: '',
        port: 587,
        secure: false,
        username: '',
        password: '',
      },
    },
  },
  templates: {
    email: {
      welcomeTemplate: '',
      albumInviteTemplate: '',
      albumUpdateTemplate: '',
    },
  },
  classification: {
    enabled: true,
    categories: [],
  },
  // Gallery-fork: defaults to false, so out of the box storage usage matches upstream Immich
  // and counts original files only.
  storageUsage: {
    includeDerivatives: false,
  },
  familyTree: {
    enabled: false,
    defaultAccess: 'none',
  },
  user: {
    deleteDelay: 7,
  },
});
