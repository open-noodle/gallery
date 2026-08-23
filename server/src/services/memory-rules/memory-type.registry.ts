import { SystemConfig } from 'src/config';
import { AssetRepository } from 'src/repositories/asset.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { BirthdayMemoryRule } from 'src/services/memory-rules/birthday.rule';
import { FavoritesThrowbackMemoryRule } from 'src/services/memory-rules/favorites-throwback.rule';
import { MemoryRule } from 'src/services/memory-rules/memory-rule.interface';
import { MEMORY_TYPE_METADATA } from 'src/services/memory-rules/memory-type.metadata';
import { MonthRecapMemoryRule } from 'src/services/memory-rules/month-recap.rule';
import { OnThisDayPlaceMemoryRule } from 'src/services/memory-rules/on-this-day-place.rule';
import { PeopleTogetherMemoryRule } from 'src/services/memory-rules/people-together.rule';
import { DEFAULT_DORMANCY_MONTHS, PersonThrowbackMemoryRule } from 'src/services/memory-rules/person-throwback.rule';
import { RecentTripMemoryRule } from 'src/services/memory-rules/recent-trip.rule';
import { SeasonRecapMemoryRule } from 'src/services/memory-rules/season-recap.rule';
import { ThemeSearchPort } from 'src/services/memory-rules/theme-search.port';
import { ThemedMemoryRule } from 'src/services/memory-rules/themed.rule';
import { TripAnniversaryMemoryRule } from 'src/services/memory-rules/trip-anniversary.rule';
import { VideoMomentsMemoryRule } from 'src/services/memory-rules/video-moments.rule';

export interface MemoryRuleDeps {
  personRepository: PersonRepository;
  assetRepository: AssetRepository;
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
  birthday: (deps) => new BirthdayMemoryRule(deps.personRepository, deps.assetRepository),
  recent_trip: (deps) => new RecentTripMemoryRule(deps.assetRepository, deps.memoryRepository),
  month_recap: (deps) => new MonthRecapMemoryRule(deps.assetRepository),
  favorites_throwback: (deps) => new FavoritesThrowbackMemoryRule(deps.assetRepository),
  on_this_day_place: (deps) => new OnThisDayPlaceMemoryRule(deps.assetRepository),
  season_recap: (deps) => new SeasonRecapMemoryRule(deps.assetRepository),
  people_together: (deps) => new PeopleTogetherMemoryRule(deps.assetRepository),
  video_moments: (deps) => new VideoMomentsMemoryRule(deps.assetRepository),
  trip_anniversary: (deps) => new TripAnniversaryMemoryRule(deps.assetRepository),
  themed: (deps) => new ThemedMemoryRule(deps.themeSearchPort),
  person_throwback: (deps) =>
    new PersonThrowbackMemoryRule(
      deps.personRepository,
      deps.assetRepository,
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
