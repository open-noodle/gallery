import { SystemConfig } from 'src/dtos/config.dto.js';
import { GalleryPersonRepository } from 'src/gallery/repositories/gallery-person.repository.js';
import { MemoryRuleAssetRepository } from 'src/gallery/repositories/memory-rule-asset.repository.js';
import { FavoritesThrowbackMemoryRule } from 'src/gallery/services/memory-rules/favorites-throwback.rule.js';
import { MemoryRule } from 'src/gallery/services/memory-rules/memory-rule.interface.js';
import { MEMORY_TYPE_METADATA } from 'src/gallery/services/memory-rules/memory-type.metadata.js';
import { MonthRecapMemoryRule } from 'src/gallery/services/memory-rules/month-recap.rule.js';
import { OnThisDayPlaceMemoryRule } from 'src/gallery/services/memory-rules/on-this-day-place.rule.js';
import { PeopleTogetherMemoryRule } from 'src/gallery/services/memory-rules/people-together.rule.js';
import {
  DEFAULT_DORMANCY_MONTHS,
  PersonThrowbackMemoryRule,
} from 'src/gallery/services/memory-rules/person-throwback.rule.js';
import { RecentTripMemoryRule } from 'src/gallery/services/memory-rules/recent-trip.rule.js';
import { SeasonRecapMemoryRule } from 'src/gallery/services/memory-rules/season-recap.rule.js';
import { ThemeSearchPort } from 'src/gallery/services/memory-rules/theme-search.port.js';
import { ThemedMemoryRule } from 'src/gallery/services/memory-rules/themed.rule.js';
import { TripAnniversaryMemoryRule } from 'src/gallery/services/memory-rules/trip-anniversary.rule.js';
import { VideoMomentsMemoryRule } from 'src/gallery/services/memory-rules/video-moments.rule.js';
import { MemoryRepository } from 'src/repositories/memory.repository.js';

export interface MemoryRuleDeps {
  galleryPersonRepository: GalleryPersonRepository;
  memoryRuleAssetRepository: MemoryRuleAssetRepository;
  memoryRepository: MemoryRepository;
  themeSearchPort: ThemeSearchPort;
  /**
   * Admin-tunable knobs from `SystemConfig['memories']`. Optional so callers that construct rules
   * without config (tests, tooling) fall back to each rule's own default.
   */
  memories?: Pick<SystemConfig['memories'], 'personThrowbackDormancyMonths'>;
}

/** per rule-kind key, how to construct its MemoryRule */
const RULE_FACTORIES: Record<string, (deps: MemoryRuleDeps) => MemoryRule> = {
  recent_trip: (deps) => new RecentTripMemoryRule(deps.memoryRuleAssetRepository, deps.memoryRepository),
  month_recap: (deps) => new MonthRecapMemoryRule(deps.memoryRuleAssetRepository),
  favorites_throwback: (deps) => new FavoritesThrowbackMemoryRule(deps.memoryRuleAssetRepository),
  on_this_day_place: (deps) => new OnThisDayPlaceMemoryRule(deps.memoryRuleAssetRepository),
  season_recap: (deps) => new SeasonRecapMemoryRule(deps.memoryRuleAssetRepository),
  people_together: (deps) => new PeopleTogetherMemoryRule(deps.memoryRuleAssetRepository),
  video_moments: (deps) => new VideoMomentsMemoryRule(deps.memoryRuleAssetRepository),
  trip_anniversary: (deps) => new TripAnniversaryMemoryRule(deps.memoryRuleAssetRepository),
  themed: (deps) => new ThemedMemoryRule(deps.themeSearchPort),
  person_throwback: (deps) =>
    new PersonThrowbackMemoryRule(
      deps.galleryPersonRepository,
      deps.memoryRuleAssetRepository,
      deps.memories?.personThrowbackDormancyMonths ?? DEFAULT_DORMANCY_MONTHS,
    ),
};

/** instantiate the rule-kind memory rules whose key is in `enabledKeys` (in registry order, deduped) */
export const createMemoryRules = (enabledKeys: Iterable<string>, deps: MemoryRuleDeps): MemoryRule[] => {
  const keys = new Set(enabledKeys);
  return MEMORY_TYPE_METADATA.filter((m) => m.kind === 'rule' && keys.has(m.key)).map((m) =>
    RULE_FACTORIES[m.key](deps),
  );
};
