import { MemoryType } from 'src/enum';

export type MemoryTypeKind = 'on_this_day' | 'rule';

export interface MemoryTypeMetadata {
  /** stable config key; for rule-kind it MUST equal the rule's `id` */
  key: string;
  kind: MemoryTypeKind;
  /** default enable state for both admin availability and per-user toggle */
  defaultEnabled: boolean;
  /** whether an admin can globally disable this type */
  adminConfigurable: boolean;
  /**
   * Fewest assets a generated memory of this type may still hold after overlap reservation
   * (spec §6.4). Below this it is deleted rather than shown. Set from the smallest sample the
   * rule can actually emit — which is not its pool gate for the burst-collapsing trip rules.
   * `on_this_day` is the deliberate exception: its floor is above what it can emit, which is
   * how the one-photo "N years ago" card gets removed.
   */
  minAssets: number;
}

export const MEMORY_TYPE_METADATA: MemoryTypeMetadata[] = [
  { key: 'on_this_day', kind: 'on_this_day', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
  { key: 'birthday', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
  { key: 'recent_trip', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 2 },
  { key: 'month_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 8 },
  { key: 'favorites_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
  { key: 'on_this_day_place', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
  { key: 'season_recap', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 10 },
  { key: 'people_together', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 4 },
  { key: 'video_moments', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 3 },
  { key: 'trip_anniversary', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 2 },
  { key: 'themed', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 5 },
  { key: 'person_throwback', kind: 'rule', defaultEnabled: true, adminConfigurable: true, minAssets: 4 },
];

export const MEMORY_TYPE_KEYS = MEMORY_TYPE_METADATA.map((m) => m.key);

/** legacy SystemConfig.memories boolean field name per type key, for back-compat folding */
export const LEGACY_MEMORY_CONFIG_KEYS: Record<string, 'birthday' | 'recentTrips'> = {
  birthday: 'birthday',
  recent_trip: 'recentTrips',
};

export const getMemoryTypeMetadata = (key: string): MemoryTypeMetadata | undefined =>
  MEMORY_TYPE_METADATA.find((m) => m.key === key);

/** full map of key -> defaultEnabled; used as the per-user preferences default */
export const buildDefaultMemoryTypeMap = (): Record<string, boolean> =>
  Object.fromEntries(MEMORY_TYPE_METADATA.map((m) => [m.key, m.defaultEnabled]));

/** derive the config key of a persisted memory record */
export const getMemoryTypeKeyForMemory = (type: MemoryType, data: unknown): string | undefined => {
  if (type === MemoryType.OnThisDay) {
    return 'on_this_day';
  }
  if (type === MemoryType.Rule) {
    const ruleId = (data as { ruleId?: unknown } | null | undefined)?.ruleId;
    return typeof ruleId === 'string' ? ruleId : undefined;
  }
  return undefined;
};

type AdminMemoriesConfig = {
  types?: Record<string, boolean>;
  // deprecated legacy fields, still honored for back-compat
  birthday?: boolean;
  recentTrips?: boolean;
};

/**
 * Resolve which type keys are globally available, applying precedence:
 * explicit `types[key]` > legacy bool (`birthday`/`recentTrips`) > `metadata.defaultEnabled`.
 * Keys not present in the registry are ignored.
 */
export const getAdminAvailableMemoryTypeKeys = (config: AdminMemoriesConfig): Set<string> => {
  const available = new Set<string>();
  for (const meta of MEMORY_TYPE_METADATA) {
    const explicit = config.types?.[meta.key];
    if (explicit !== undefined) {
      if (explicit) {
        available.add(meta.key);
      }
      continue;
    }

    const legacyField = LEGACY_MEMORY_CONFIG_KEYS[meta.key];
    const legacy = legacyField ? config[legacyField] : undefined;
    if (legacy !== undefined) {
      if (legacy) {
        available.add(meta.key);
      }
      continue;
    }

    if (meta.defaultEnabled) {
      available.add(meta.key);
    }
  }
  return available;
};

/** per-user enable for a known key: override > metadata.defaultEnabled. Unknown key -> false. */
export const isMemoryTypeEnabledForUser = (userTypes: Record<string, boolean> | undefined, key: string): boolean => {
  const override = userTypes?.[key];
  if (override !== undefined) {
    return override;
  }
  return getMemoryTypeMetadata(key)?.defaultEnabled ?? false;
};

/** Floor for a registry key; 0 (never removed for size) for an unknown or absent key. */
export const getMemoryTypeFloor = (key: string | undefined): number =>
  (key === undefined ? undefined : getMemoryTypeMetadata(key)?.minAssets) ?? 0;
