import { AssetRepository } from 'src/repositories/asset.repository';
import { MemoryRepository } from 'src/repositories/memory.repository';
import { PersonRepository } from 'src/repositories/person.repository';
import { BirthdayMemoryRule } from 'src/services/memory-rules/birthday.rule';
import { MemoryRule } from 'src/services/memory-rules/memory-rule.interface';
import { MEMORY_TYPE_METADATA } from 'src/services/memory-rules/memory-type.metadata';
import { RecentTripMemoryRule } from 'src/services/memory-rules/recent-trip.rule';

export interface MemoryRuleDeps {
  personRepository: PersonRepository;
  assetRepository: AssetRepository;
  memoryRepository: MemoryRepository;
}

/** per rule-kind key, how to construct its MemoryRule */
const RULE_FACTORIES: Record<string, (deps: MemoryRuleDeps) => MemoryRule> = {
  birthday: (deps) => new BirthdayMemoryRule(deps.personRepository, deps.assetRepository),
  recent_trip: (deps) => new RecentTripMemoryRule(deps.assetRepository, deps.memoryRepository),
};

/** instantiate the rule-kind memory rules whose key is in `enabledKeys` (in registry order, deduped) */
export const createMemoryRules = (enabledKeys: Iterable<string>, deps: MemoryRuleDeps): MemoryRule[] => {
  const keys = new Set(enabledKeys);
  return MEMORY_TYPE_METADATA.filter((m) => m.kind === 'rule' && keys.has(m.key)).map((m) =>
    RULE_FACTORIES[m.key](deps),
  );
};
